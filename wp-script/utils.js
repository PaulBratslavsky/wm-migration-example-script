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
  return turndownService.turndown(html);
}

function convertNodesToMarkdown(nodes) {
  let markdown = "";
  nodes.forEach((node) => {
    switch (node.type) {
      case "heading":
        const headingLevel = "#".repeat(node.level);
        markdown += `${headingLevel} ${convertNodesToMarkdown(node.children)}\n\n`;
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
        const { url: imageUrl, alternativeText: altText = "" } = node.image;
        markdown += `![${altText}](${imageUrl})\n\n`;
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
        markdown += `\`\`\`${codeLanguage}\n${convertNodesToMarkdown(node.children)}\n\`\`\`\n\n`;
        break;
      case "list-item":
        markdown += `${convertNodesToMarkdown(node.children)}`;
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
          { type: "text", text: entity.text, ...(isBold && { bold: true }) }
        ],
        level: entity.depth,
      };
      jsonOutput.push(headingBlock);
    },
    paragraph(entity) {
      const children = parseInlineParagraphFormatting(entity.text);
      jsonOutput.push({ type: "paragraph", children });
    },
  };

  marked.use({ renderer });
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

        console.log("content to send");
        console.dir(newContent, { depth: null });

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
        })

        const post = await data.json();
        console.dir(post, { depth: null });
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
  importWPData
};
