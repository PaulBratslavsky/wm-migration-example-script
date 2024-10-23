import {
  fetchWPData,
  importWPData,
} from "./utils.js";

const BASE_URL = "http://wordpress-demo.local";
const POSTS_PATH = "/wp-json/wp/v2/posts";


const data = await fetchWPData(BASE_URL, POSTS_PATH);
const response = await importWPData(data);

console.dir(response, { depth: null });