import TurndownService from "turndown";
import { CONFIG } from "../config.js";

import {
  getFilename,
  normalizeUrl,
  normalizeFilename,
  downloadAndUploadFile,
} from "./utils.js";

import { ImageCacheManager } from "../lib/image-cache.js";

export async function htmlToMarkdown(html) {
  if (!html || typeof html !== "string") {
    throw new Error("Invalid HTML input");
  }

  try {
    const turndownService = new TurndownService();

    turndownService.addRule("imageParser", {
      filter: ["img", "a"],
      replacement: function (content, node) {
        // If this is an anchor tag containing only an image
        if (
          node.nodeName === "A" &&
          node.firstChild &&
          node.firstChild.nodeName === "IMG"
        ) {
          const img = node.firstChild;
          const src = img.getAttribute("src") || "";
          const alt = img.getAttribute("alt") || "";
          const title = img.getAttribute("title") || "";

          // Return the original markdown format for now
          return `![${alt || "image"}](${src}${title ? ` "${title}"` : ""})`;
        }

        // If this is a standalone image
        if (node.nodeName === "IMG") {
          const src = node.getAttribute("src") || "";
          const alt = node.getAttribute("alt") || "";
          const title = node.getAttribute("title") || "";

          // Return the original markdown format for now
          return `![${alt || "image"}](${src}${title ? ` "${title}"` : ""})`;
        }

        // For regular links, use default behavior
        return content;
      },
    });

    // First convert to markdown with original URLs
    const markdown = turndownService.turndown(html);

    // Then process all images in the markdown
    const processedMarkdown = await processMarkdownImages(markdown);
    return processedMarkdown;
  } catch (error) {
    console.error("Error converting HTML to Markdown:", error);
    throw error;
  }
}

async function processMarkdownImages(markdown) {
  const imageRegex = /!\[(.*?)\]\((.*?)(?:\s+"(.*?)")?\)/g;
  const cacheManager = ImageCacheManager.getInstance();

  console.log("\n=== Processing Images ===");
  console.log("Initial cache status:", cacheManager.getStats());

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
          console.log(
            `Duplicate file detected: ${sourceFilename} matches ${existingFile.filename}`
          );
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
        throw new Error("Invalid upload response format");
      }

      const uploadedImage = {
        url: `${CONFIG.API.BASE_URL}${uploadData.url}`,
        filename: uploadData.name,
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
      console.error("Failed to process image:", src, error);
      stats.failed++;
    }
  }

  console.log("\n=== Processing Complete ===");
  console.log("Stats:", {
    ...stats,
    cacheSize: cacheManager.getStats().size,
  });

  return result;
}

const createMarkdownImage = (filename, url, title = "") => {
  return `![${filename}](${url}${title ? ` "${title}"` : ""})`;
};
