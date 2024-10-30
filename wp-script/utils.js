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

function htmlToMarkdown(html) {
  const turndownService = new TurndownService();

  turndownService.addRule("imageParser", {
    filter: "img", // Targeting <img> elements
    replacement: (content, node) => {
      const src = node.getAttribute("src") || "";
      const alt = node.getAttribute("alt") || "";
      const title = node.getAttribute("title") || "";

      // Custom Markdown formatting for images
      return `![${alt || `image-${Date.now().toString()}`}](${src}${
        title ? ` "${title}"` : ""
      })`;
    },
  });

  turndownService.addRule('imageParser', {
    filter: ['img', 'a'],
    replacement: function (content, node) {
      // If this is an anchor tag containing only an image, just return the image markdown
      if (node.nodeName === 'A' && node.firstChild && node.firstChild.nodeName === 'IMG') {
        const img = node.firstChild;
        const src = img.getAttribute("src") || "";
        const alt = img.getAttribute("alt") || "";
        const title = img.getAttribute("title") || "";

        return `![${alt || `image-${Date.now().toString()}`}](${src}${
          title ? ` "${title}"` : ""
        })`;
      }
      
      // If this is a standalone image
      if (node.nodeName === 'IMG') {
        const src = node.getAttribute("src") || "";
        const alt = node.getAttribute("alt") || "";
        const title = node.getAttribute("title") || "";

        return `![${alt || `image-${Date.now().toString()}`}](${src}${
          title ? ` "${title}"` : ""
        })`;
      }

      // For regular links, use default behavior
      return content;
    }
  });

  return turndownService.turndown(html);
}

function convertNodesToMarkdown(nodes) {
  let markdown = "";
  nodes.forEach((node) => {
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
        throw new Error(`Unsupported node type: ${node.type}`);
    }
  });

  return markdown.trim();
}

function parseMarkdownToJson(markdown) {
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
      const children = parseInlineParagraphFormatting(entity.text);
      jsonOutput.push({ type: "paragraph", children });
    },
    image(entity) {
      jsonOutput.push({ 
        type: "image", 
        image: {
          url: entity.src || entity.href,
          alternativeText: entity.text || entity.alt || 'image'
        } 
      });
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
    gfm: true, // Enable GitHub Flavored Markdown
    breaks: true, // Enable line breaks
    pedantic: false,
    smartLists: true
  });

  marked.parse(markdown);
  return jsonOutput;
}

async function fetchWPData(BASE_URL, POSTS_PATH) {
  const url = new URL(POSTS_PATH, BASE_URL).href;
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

async function importWPData(data) {
  const BASE_URL = "http://localhost:1337";
  const PATH = "/api/posts";
  const url = new URL(PATH, BASE_URL).href;

  try {
    await Promise.all(
      data.map(async (entity) => {
        const markdown = await htmlToMarkdown(entity.content.rendered);
        const json = parseMarkdownToJson(markdown);
        const newContent = convertNodesToMarkdown(json);

        // console.log("content to send");
        console.log("##########################");
        console.log(markdown);
        console.log("##########################");

        const strapiData = {
          title: entity.title.rendered,
          slug: entity.slug + "-" + Date.now(),
          content: newContent,
          blocksContent: json,
        };

        // console.log("##########################");
        // console.dir(json, { depth: null });
        // console.log("##########################");

        // console.log("strapi data to send");
        // console.dir(strapiData, { depth: null });

        const data = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: strapiData,
          }),
        })

        const post = await data.json();
        // console.dir(post, { depth: null });
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
