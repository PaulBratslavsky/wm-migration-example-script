import { marked } from "marked";
import { CONFIG } from "../config.js";

import {
  isBoldMarkdown,
  parseInlineParagraphFormatting,
} from "./utils.js";

export async function parseMarkdownToObject(markdown) {
  const objectOutput = [];

  const renderer = {
    heading(entity) {
      const headingBlock = {
        type: "heading",
        children: [
          {
            type: "text",
            text: entity.text,
            ...(isBoldMarkdown(entity.text) && { bold: true }),
          },
        ],
        level: entity.depth,
      };
      objectOutput.push(headingBlock);
    },

    async paragraph(entity) {
      const isImage = /!\[(.*?)\]\((.*?)\)/.test(entity.text);

      if (isImage) {
        objectOutput.push({ 
          type: "paragraph", 
          children: [{ type: "text", text: entity.text }] 
        });
      } else {
        // For non-image paragraphs, parse formatting as usual
        const children = parseInlineParagraphFormatting(entity.text);
        objectOutput.push({ type: "paragraph", children });
      }

    },

    list(entity, ordered) {
      const items = entity.items.map((item) => ({
        type: "list-item",
        children: parseInlineParagraphFormatting(item.text || item),
      }));

      objectOutput.push({
        type: "list",
        format: ordered ? "ordered" : "unordered",
        children: items,
      });
    },

    hr() {
      objectOutput.push({ type: "thematicBreak" });
    },

    blockquote(entity) {
      const text = entity.text.replace(/\n/g, " ").trim();
        objectOutput.push(createTextBlock("quote", text));
    },

    code(code, language) {
      objectOutput.push({
        type: "code",
        language: language || "",
        children: [{ type: "text", text: code.trim() }],
      });
    },
  };

  marked.use({
    renderer,
    gfm: true,
    breaks: true,
    pedantic: false,
    smartLists: true,
  });

  await marked.parse(markdown);
  return objectOutput;
}

async function fetchImageData(filename) {
  if (!filename) return null;

  try {
    const BASE_URL = CONFIG.API.BASE_URL;
    const url = new URL("/api/upload/files", BASE_URL);
    url.searchParams.set("filters[name][$eq]", filename);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const imageData = await response.json();
    return imageData[0];
  } catch (error) {
    console.error("Error fetching image data:", error);
    return null;
  }
}


function processImageData(imageData) {
  if (!imageData) return null;

  // Create a deep copy to avoid mutating the original data
  const processed = JSON.parse(JSON.stringify(imageData));

  // Append base URL to the main image URL if it starts with /
  if (processed.url?.startsWith('/')) {
    processed.url = `${CONFIG.API.BASE_URL}${processed.url}`;
  }

  // Process formats if they exist
  if (processed.formats) {
    Object.keys(processed.formats).forEach(format => {
      if (processed.formats[format]?.url?.startsWith('/')) {
        processed.formats[format].url = `${CONFIG.API.BASE_URL}${processed.formats[format].url}`;
      }
    });
  }

  // Set alternativeText to filename if it's null
  if (!processed.alternativeText) {
    processed.alternativeText = processed.name;
  }

  return processed;
}
// TODO: TO IMPLEMENT LATER
async function createImageBlock(entity) {
  const filename = entity?.tokens[0]?.text;
  const imageData = await fetchImageData(filename);

  return {
    type: "image",
    image: processImageData(imageData),
    children: [{ type: "text", text: "" }],
  };
}

function createTextBlock(type, text, options = {}) {
  return {
    type,
    children: parseInlineParagraphFormatting(text),
    ...options,
  };
}