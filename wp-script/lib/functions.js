import { CONFIG } from "../config.js";
import { validateConfig } from "./utils.js";

import { parseMarkdownToObject } from "./parse-markdown-to-object.js";
import { htmlToMarkdown } from "./html-to-markdown.js";

async function fetchWPData(BASE_URL, POSTS_PATH) {
  const url = new URL(POSTS_PATH, BASE_URL).href;
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

async function importWPData(data) {
  if (!Array.isArray(data)) throw new Error("Input data must be an array");

  const url = new URL(CONFIG.API.POSTS_PATH, CONFIG.API.BASE_URL).href;

  const results = await Promise.allSettled(
    data.map(async (entity) => {
      try {
        const markdown = await htmlToMarkdown(entity.content.rendered);
        const json = await parseMarkdownToObject(markdown);

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: {
              title: entity.title.rendered,
              slug: entity.slug,
              content: markdown,
              blocksContent: json,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            `HTTP error! status: ${response.status}, details: ${JSON.stringify(
              errorData
            )}`
          );
        }

        return await response.json();
      } catch (error) {
        throw new Error(
          `Failed to process entity ${entity.id}: ${error.message}`
        );
      }
    })
  );

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    console.error(
      "Some imports failed:",
      failures.map((f) => f.reason)
    );
  }

  return results;
}

validateConfig();

export { fetchWPData, importWPData };
