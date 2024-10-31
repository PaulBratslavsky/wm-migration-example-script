import { CONFIG } from "../config.js";

// Update validateConfig to initialize properly
export function validateConfig() {
  const required = ["BASE_URL", "UPLOAD_PATH", "POSTS_PATH"];
  const missing = required.filter((key) => !CONFIG.API[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }

  try {
    if (!isValidUrl(CONFIG.API.BASE_URL)) {
      throw new Error("Invalid BASE_URL in configuration");
    }
  } catch (error) {
    throw new Error(`Configuration validation failed: ${error.message}`);
  }
}


export function getFilename(url) {
  try {
    return url.split('/').pop().split('#')[0].split('?')[0];
  } catch (error) {
    console.error('Failed to extract filename:', error);
    return null;
  }
};

export function isValidNode(node) {
  return node && typeof node === 'object' && typeof node.type === 'string';
}

export function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

export function isBoldMarkdown(text) {
  const boldPattern = /(\*\*|__)(.*?)\1/g;
  return boldPattern.test(text);
}

export function normalizeUrl(url) {
  try {
    // Remove query parameters and hash
    const cleanUrl = url.split(/[?#]/)[0].toLowerCase();
    
    // Remove common URL parameters and variations
    return cleanUrl
      .replace(/\/(quality|width|height)\/\d+\//g, '/') // Remove size parameters
      .replace(/[-_]\d+x\d+/g, '')  // Remove dimensions in filename
      .replace(/\/(small|medium|large|thumbnail)\//g, '/') // Remove size indicators
      .replace(/\/{2,}/g, '/'); // Replace multiple slashes with single slash
  } catch (error) {
    console.error('Invalid URL:', url);
    return url;
  }
};

export function normalizeFilename(filename) {
  return filename
    .toLowerCase()
    .replace(/[_-]/g, '') // Remove underscores and hyphens
    .replace(/\.[^/.]+$/, ''); // Remove extension
};

// Helper function to process link matches
export function processLinkMatch(match) {
  if (!isValidUrl(match[2])) {
    console.warn(`Invalid URL found: ${match[2]}`);
    return { type: "text", text: match[0] };
  }
  return {
    type: "link",
    url: match[2],
    children: [{ type: "text", text: match[1] }],
  };
}

export function parseInlineParagraphFormatting(text) {
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

      nodes.push(
        key === "link"
          ? processLinkMatch(match)
          : { type: "text", text: match[1], [key]: true }
      );

      remainingText = remainingText.slice(match.index + match[0].length);
      regex.lastIndex = 0;
    }
  }

  if (remainingText) {
    nodes.push({ type: "text", text: remainingText });
  }

  return nodes;
}


export async function downloadAndUploadFile(url, uploadUrl) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download: ${response.status} ${response.statusText}`
      );
    }

    const blob = await response.blob();
    // Extract filename from URL or use a default one
    const filename =
      url.split("/").pop().split("#")[0].split("?")[0] || "image";

    // Create a File object instead of using blob directly
    const file = new File([blob], filename, { type: blob.type });
    const formData = new FormData();
    formData.append("files", file);

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => ({}));
      throw new Error(
        `Upload failed: ${uploadResponse.status} ${JSON.stringify(errorData)}`
      );
    }

    return uploadResponse;
  } catch (error) {
    console.error("File processing failed:", error);
    throw error;
  }
}







// TODO: SIDE IDEA I HAD SAVE FOR LATER
export function convertNodesToMarkdown(nodes) {
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