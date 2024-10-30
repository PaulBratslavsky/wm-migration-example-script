import { marked } from "marked";
import TurndownService from "turndown";

function isBoldMarkdown(text) {
  const boldPattern = /(\*\*|__)(.*?)\1/g;
  return boldPattern.test(text);
}

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
        nodes.push({
          type: "link",
          url: match[2],
          children: [{ type: "text", text: match[1] }],
        });
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
}

// New helper function to process images after markdown conversion
async function processMarkdownImages(markdown) {
  const imageRegex = /!\[(.*?)\]\((.*?)(?:\s+"(.*?)")?\)/g;
  const uploadUrl = 'http://localhost:1337/api/upload';
  
  let result = markdown;
  const promises = [];
  let matches = [];
  
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    const [fullMatch, alt, src, title] = match;
    const promise = (async () => {
      try {
        const response = await downloadAndUploadFile(src, uploadUrl);
        const data = await response.json();
        const uploadedImageUrl = `http://localhost:1337${data[0].url}`;
        
        // Get the original filename and ensure it uses underscores
        const originalName = src.split('/').pop();
        const formattedName = originalName.replace(/-/g, '_');

        return {
          fullMatch,
          replacement: `![${formattedName}](${uploadedImageUrl}${title ? ` "${title}"` : ""})`
        };

      } catch (error) {
        console.error('Failed to upload image:', error);
        return { fullMatch, replacement: fullMatch };
      }
    })();
    promises.push(promise);
    matches.push(fullMatch);
  }

  // Wait for all uploads to complete
  const results = await Promise.all(promises);
  
  // Replace all matches with their uploaded versions
  results.forEach(({ fullMatch, replacement }) => {
    result = result.replace(fullMatch, replacement);
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
    // async image(entity) {
    //   const downloadUrl = entity.src || entity.href;
    //   const uploadUrl = 'http://localhost:1337/api/upload';
    //   await downloadAndUploadFile(downloadUrl, uploadUrl);

    //   jsonOutput.push({ 
    //     type: "image", 
    //     image: {
    //       url: entity.src || entity.href,
    //       alternativeText: entity.text || entity.alt || 'image'
    //     } 
    //   });
    // },
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
  console.log("############### nodes ##########"); 
  console.dir(nodes, { depth: null });
  console.log("############ me #############"); 
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
    // Skip invalid nodes
    if (!node || !node.type) {
      console.warn('Invalid node encountered:', node);
      return;
    }

    switch (node.type) {
      case "heading":
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

async function downloadAndUploadFile(downloadUrl, uploadUrl) {
  try {
    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Failed to download file: ${downloadResponse.status}`);
    }
    const fileBlob = await downloadResponse.blob();

    const formData = new FormData();
    // Extract filename from URL and replace hyphens with underscores
    const fileName = downloadUrl.split('/').pop().replace(/-/g, '_') || `image-${Date.now()}`;
    formData.append(
      "files",
      new Blob([fileBlob], { type: fileBlob.type }),
      fileName
    );

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });
      
    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with status: ${uploadResponse.status}`);
    }

    return uploadResponse;
  } catch (error) {
    console.error('Error during file transfer:', error.message);
    throw error;
  }
}

async function importWPData(data) {
  const BASE_URL = "http://localhost:1337";
  const PATH = "/api/posts";
  const url = new URL(PATH, BASE_URL).href;

  try {
    await Promise.all(
      data.map(async (entity) => {
        const markdown = await htmlToMarkdown(entity.content.rendered);
        const json = await parseMarkdownToJson(markdown);
        const newContent = convertNodesToMarkdown(json);

        const strapiData = {
          title: entity.title.rendered,
          slug: entity.slug + "-" + Date.now(),
          content: newContent,
          blocksContent: json,
        };

        const data = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: strapiData,
          }),
        });

        const post = await data.json();
      })
    );
  } catch (error) {
    console.dir(error, { depth: null });
  }
}

export {
  isBoldMarkdown,
  parseInlineParagraphFormatting,
  fetchWPData,
  htmlToMarkdown,
  convertNodesToMarkdown,
  parseMarkdownToJson,
  importWPData,
};
