import {
  fetchWPData,
  importWPData,
} from "./functions.js";

const BASE_URL = "http://wp-migration.local";
const POSTS_PATH = "/wp-json/wp/v2/posts";

// http://wp-migration.local/wp-json/wp/v2/posts

const data = await fetchWPData(BASE_URL, POSTS_PATH);
const response = await importWPData(data);

