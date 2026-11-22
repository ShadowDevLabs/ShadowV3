// Entry for public/dist/markdown.js (see scripts/build.mjs): Markdown to HTML that is safe to
// put in innerHTML. marked keeps raw HTML from its input, so a reply can carry <img onerror=…>.
import { marked } from "marked";
import DOMPurify from "dompurify";

export const renderMarkdown = (text) => DOMPurify.sanitize(marked.parse(String(text ?? "")));
