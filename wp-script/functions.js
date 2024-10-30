import { marked } from "marked";
import TurndownService from "turndown";

import {
  getFilename,
  isValidNode,
  isValidUrl,
  isBoldMarkdown,
  normalizeUrl,
  normalizeFilename
} from "./utils.js";

import { ImageCacheManager } from "./image-cache.js";

const CONFIG = {
  API: {
    BASE_URL: "http://localhost:1337",
    UPLOAD_PATH: "/api/upload",
    POSTS_PATH: "/api/posts"
  }
};


function parseInlineParagraphFormatting(text) {
  const patterns = [
    { regex: /\*\*(.*?)\*\*/g, key: "bold" },
    { regex: /_(.*?)_/g, key: "italic" },
    { regex: /~~(.*?)~~/g, key: "strikethrough" },
    { regex: /<u>(.*?)<\/u>/g, key: "underline" },
    { regex: /\[(.*?)\]\((.*?)\)/g, key: "link" },
  ];

  let nodes = [];
  let remainingText = text;

  for (const { regex, key } of patterns) {
    let match;
    while ((match = regex.exec(remainingText)) !== null) {
      const beforeMatch = remainingText.slice(0, match.index);
      if (beforeMatch) {
        nodes.push({ type: "text", text: beforeMatch });
      }

      if (key === "link") {
        if (!isValidUrl(match[2])) {
          console.warn(`Invalid URL found: ${match[2]}`);
          nodes.push({ type: "text", text: match[0] });
        } else {
          nodes.push({
            type: "link",
            url: match[2],
            children: [{ type: "text", text: match[1] }],
          });
        }
      } else {
        nodes.push({
          type: "text",
          text: match[1],
          [key]: true,
        });
      }

      remainingText = remainingText.slice(match.index + match[0].length);
      regex.lastIndex = 0; // Reset regex index to avoid skipping.
    }
  }

  if (remainingText) {
    nodes.push({ type: "text", text: remainingText });
  }

  return nodes;
}

async function htmlToMarkdown(html) {
  if (!html || typeof html !== 'string') {
    throw new Error('Invalid HTML input');
  }

  try {
    const turndownService = new TurndownService();

    turndownService.addRule('imageParser', {
      filter: ['img', 'a'],
      replacement: function (content, node) {
        // If this is an anchor tag containing only an image
        if (node.nodeName === 'A' && node.firstChild && node.firstChild.nodeName === 'IMG') {
          const img = node.firstChild;
          const src = img.getAttribute("src") || "";
          const alt = img.getAttribute("alt") || "";
          const title = img.getAttribute("title") || "";
          
          // Return the original markdown format for now
          return `![${alt || 'image'}](${src}${title ? ` "${title}"` : ""})`;
        }
        
        // If this is a standalone image
        if (node.nodeName === 'IMG') {
          const src = node.getAttribute("src") || "";
          const alt = node.getAttribute("alt") || "";
          const title = node.getAttribute("title") || "";
          
          // Return the original markdown format for now
          return `![${alt || 'image'}](${src}${title ? ` "${title}"` : ""})`;
        }

        // For regular links, use default behavior
        return content;
      }
    });

    // First convert to markdown with original URLs
    const markdown = turndownService.turndown(html);
    
    // Then process all images in the markdown
    const processedMarkdown = await processMarkdownImages(markdown);
    return processedMarkdown;
  } catch (error) {
    console.error('Error converting HTML to Markdown:', error);
    throw error;
  }
}


// Helper function to create markdown image
const createMarkdownImage = (filename, url, title = '') => {
  return `![${filename}](${url}${title ? ` "${title}"` : ''})`;
};

// const createMarkdownImage = (filename, url) => {
//   return `![${filename}](${url})`;
// };


// Update the processMarkdownImages function
async function processMarkdownImages(markdown) {
  const imageRegex = /!\[(.*?)\]\((.*?)(?:\s+"(.*?)")?\)/g;
  const cacheManager = ImageCacheManager.getInstance();
  
  console.log('\n=== Processing Images ===');
  console.log('Initial cache status:', cacheManager.getStats());
  
  const matches = Array.from(markdown.matchAll(imageRegex));
  let result = markdown;
  let stats = { processed: 0, cached: 0, uploaded: 0, failed: 0 };
  
  // Track both filenames and URLs
  const processedFiles = new Map(); // normalized filename -> { url, filename }

  for (const [fullMatch, alt, src, title] of matches) {
    try {
      stats.processed++;
      const normalizedSrc = normalizeUrl(src);
      
      // Debug logging
      console.log(`Processing image: ${src}`);
      console.log(`Normalized URL: ${normalizedSrc}`);
      
      // Check cache first
      if (cacheManager.has(normalizedSrc)) {
        const cached = cacheManager.get(normalizedSrc);
        stats.cached++;
        console.log(`Cache hit: ${cached.filename}`);
        result = result.replace(
          fullMatch,
          createMarkdownImage(cached.filename, cached.url, title)
        );
        continue;
      }

      // Check if we've already processed this file
      const sourceFilename = getFilename(normalizedSrc);
      if (sourceFilename) {
        const normalizedSourceName = normalizeFilename(sourceFilename);
        const existingFile = processedFiles.get(normalizedSourceName);
        
        if (existingFile) {
          console.log(`Duplicate file detected: ${sourceFilename} matches ${existingFile.filename}`);
          // Use the existing file's data
          cacheManager.set(normalizedSrc, existingFile);
          stats.cached++;
          result = result.replace(
            fullMatch,
            createMarkdownImage(existingFile.filename, existingFile.url, title)
          );
          continue;
        }
      }

      console.log(`Cache miss - uploading: ${normalizedSrc}`);
      const response = await downloadAndUploadFile(
        normalizedSrc, 
        `${CONFIG.API.BASE_URL}${CONFIG.API.UPLOAD_PATH}`
      );
      const [uploadData] = await response.json();
      
      if (!uploadData?.url || !uploadData?.name) {
        throw new Error('Invalid upload response format');
      }

      const uploadedImage = {
        url: `${CONFIG.API.BASE_URL}${uploadData.url}`,
        filename: uploadData.name
      };
      
      // Store both the normalized filename and URL
      if (sourceFilename) {
        processedFiles.set(normalizeFilename(uploadData.name), uploadedImage);
      }
      cacheManager.set(normalizedSrc, uploadedImage);
      stats.uploaded++;
      
      result = result.replace(
        fullMatch,
        createMarkdownImage(uploadedImage.filename, uploadedImage.url, title)
      );
    } catch (error) {
      console.error('Failed to process image:', src, error);
      stats.failed++;
    }
  }

  console.log('\n=== Processing Complete ===');
  console.log('Stats:', {
    ...stats,
    cacheSize: cacheManager.getStats().size
  });
  
  return result;
}

async function parseMarkdownToJson(markdown) {
  const jsonOutput = [];
  
  const renderer = {
    heading(entity) {
      const isBold = isBoldMarkdown(entity.text);
      const headingBlock = {
        type: "heading",
        children: [
          { type: "text", text: entity.text, ...(isBold && { bold: true }) },
        ],
        level: entity.depth,
      };
      jsonOutput.push(headingBlock);
    },
    paragraph(entity) {
      // Check if the text is an image markdown syntax
      const imageRegex = /!\[(.*?)\]\((.*?)\)/;
      if (imageRegex.test(entity.text)) {
        // If it's an image, treat it as a single text node without parsing for formatting
        jsonOutput.push({ 
          type: "paragraph", 
          children: [{ type: "text", text: entity.text }] 
        });
      } else {
        // For non-image paragraphs, parse formatting as usual
        const children = parseInlineParagraphFormatting(entity.text);
        jsonOutput.push({ type: "paragraph", children });
      }
    },

    list(entity, ordered) {
      const items = entity.items.map(item => ({
        type: "list-item",
        children: parseInlineParagraphFormatting(item.text || item)
      }));
      
      jsonOutput.push({
        type: "list",
        format: ordered ? "ordered" : "unordered",
        children: items
      });
    },
    hr() {
      jsonOutput.push({
        type: "thematicBreak"
      });
    },
    blockquote(entity) {
      const text = entity.text.replace(/\n/g, ' ').trim();
      jsonOutput.push({
        type: "quote",
        children: parseInlineParagraphFormatting(text)
      });
    },
    code(code, language) {
      jsonOutput.push({
        type: "code",
        language: language || "",
        children: [{ 
          type: "text", 
          text: code.trim() 
        }]
      });
    }
  };

  marked.use({ 
    renderer,
    gfm: true, 
    breaks: true, 
    pedantic: false,
    smartLists: true
  });
  
  await marked.parse(markdown);
  return jsonOutput;
}

function convertNodesToMarkdown(nodes) {
  // Add type validation for specific node types
  const validateNode = (node, expectedProps) => {
    return expectedProps.every(prop => 
      prop in node && node[prop] !== undefined && node[prop] !== null
    );
  };


  // Handle non-array input
  if (!nodes) return '';
  if (!Array.isArray(nodes)) {
    // If single node object is passed
    if (typeof nodes === 'object') {
      nodes = [nodes];
    } else {
      return String(nodes);
    }
  }

  let markdown = "";
  nodes.forEach((node) => {
    // Replace current validation with isValidNode
    if (!isValidNode(node)) {
      console.warn('Invalid node encountered:', node);
      return;
    }

    switch (node.type) {
      case "heading":
        if (!validateNode(node, ['level', 'children'])) {
          console.warn('Invalid heading node:', node);
          return;
        }
        const headingLevel = "#".repeat(node.level);
        markdown += `${headingLevel} ${convertNodesToMarkdown(
          node.children
        )}\n\n`;
        break;
      case "paragraph":
        markdown += `${convertNodesToMarkdown(node.children)}\n\n`;
        break;
      case "text":
        let text = node.text;
        if (node.bold) text = `**${text}**`;
        if (node.italic) text = `*${text}*`;
        if (node.underline) text = `<u>${text}</u>`;
        if (node.strikethrough) text = `~~${text}~~`;
        if (node.code) text = `\`${text}\``;
        markdown += text;
        break;
      case "link":
        const linkText = convertNodesToMarkdown(node.children);
        markdown += `[${linkText}](${node.url})`;
        break;
      case "image":
        const { url, alternativeText = "image" } = node.image;
        markdown += `![${alternativeText}](${url})\n\n`;
        break;
      case "list":
        const isOrdered = node.format === "ordered";
        node.children.forEach((item, index) => {
          const prefix = isOrdered ? `${index + 1}. ` : "- ";
          markdown += `${prefix}${convertNodesToMarkdown(item.children)}\n`;
        });
        markdown += "\n";
        break;
      case "quote":
        markdown += `> ${convertNodesToMarkdown(node.children)}\n\n`;
        break;
      case "code":
        const codeLanguage = node.language || "";
        markdown += `\`\`\`${codeLanguage}\n${convertNodesToMarkdown(
          node.children
        )}\n\`\`\`\n\n`;
        break;
      case "list-item":
        markdown += `${convertNodesToMarkdown(node.children)}`;
        break;
      case "thematicBreak":
        markdown += "---\n\n";
        break;
      default:
        console.warn(`Unsupported node type: ${node.type}`, node);
        // Instead of throwing, we'll skip invalid nodes
        return;
    }
  });

  return markdown.trim();
}

async function fetchWPData(BASE_URL, POSTS_PATH) {
  const url = new URL(POSTS_PATH, BASE_URL).href;
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

async function downloadAndUploadFile(url, uploadUrl) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    // Extract filename from URL or use a default one
    const filename = url.split('/').pop().split('#')[0].split('?')[0] || 'image';
    
    // Create a File object instead of using blob directly
    const file = new File([blob], filename, { type: blob.type });
    const formData = new FormData();
    formData.append('files', file);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => ({}));
      throw new Error(`Upload failed: ${uploadResponse.status} ${JSON.stringify(errorData)}`);
    }

    return uploadResponse;
  } catch (error) {
    console.error('File processing failed:', error);
    throw error;
  }
}

async function importWPData(data) {
  if (!Array.isArray(data)) {
    throw new Error('Input data must be an array');
  }

  const url = new URL(CONFIG.API.POSTS_PATH, CONFIG.API.BASE_URL).href;
  
  const results = await Promise.allSettled(
    data.map(async (entity) => {
      try {
        const markdown = await htmlToMarkdown(entity.content.rendered);
        const json = await parseMarkdownToJson(markdown);
        const newContent = convertNodesToMarkdown(json);

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: {
              title: entity.title.rendered,
              slug: entity.slug,
              content: newContent,
              blocksContent: json,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`HTTP error! status: ${response.status}, details: ${JSON.stringify(errorData)}`);
        }

        return await response.json();
      } catch (error) {
        throw new Error(`Failed to process entity ${entity.id}: ${error.message}`);
      }
    })
  );

  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length > 0) {
    console.error('Some imports failed:', failures.map(f => f.reason));
  }

  return results;
}

// Update validateConfig to initialize properly
function validateConfig() {
  const required = ['BASE_URL', 'UPLOAD_PATH', 'POSTS_PATH'];
  const missing = required.filter(key => !CONFIG.API[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  try {
    if (!isValidUrl(CONFIG.API.BASE_URL)) {
      throw new Error('Invalid BASE_URL in configuration');
    }
  } catch (error) {
    throw new Error(`Configuration validation failed: ${error.message}`);
  }
}

// Initialize config validation immediately
validateConfig();

export {
  isBoldMarkdown,
  parseInlineParagraphFormatting,
  fetchWPData,
  htmlToMarkdown,
  convertNodesToMarkdown,
  parseMarkdownToJson,
  importWPData,
  ImageCacheManager
};
