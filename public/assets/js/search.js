"use strict";

/**
 * Turns whatever was typed into the omnibox into a real URL.
 *
 *   shadow://settings        -> shadow://settings (internal page)
 *   chrome-extension://...   -> unchanged (extension page)
 *   https://example.com      -> unchanged
 *   example.com/path         -> https://example.com/path
 *   anything else            -> the search engine template with %s filled in
 *
 * The result is a plain URL; encoding it for the proxy is tabs.js' job.
 *
 * @param {string} input
 * @param {string} template search URL containing %s
 * @returns {string}
 */
function resolveInput(input, template) {
  input = String(input ?? "").trim();
  template = template || "https://duckduckgo.com/?q=%s";

  if (input.startsWith("shadow://") || input === "about:blank") return input;
  if (/^chrome-extension:\/\//i.test(input)) return input;
  // Site-absolute local path (e.g. /pages/embed/, /arcade/snake/) — a Shadow page,
  // not something to proxy or search for. "//" is protocol-relative, so exclude it.
  if (/^\/[^/]/.test(input)) return input;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      return new URL(input).toString();
    } catch (err) {}
  }

  // "example.com", "localhost:3000", "10.0.0.1/admin" — but not "what is 2.5"
  if (!/\s/.test(input)) {
    try {
      const url = new URL(`https://${input}`);
      const host = url.hostname;
      if (host.includes(".") || host === "localhost") {
        if (host === "localhost" || /^[\d.]+$/.test(host)) url.protocol = "http:";
        return url.toString();
      }
    } catch (err) {}
  }

  return template.replace("%s", encodeURIComponent(input));
}

// Old name, kept for anything still calling it.
function search(input, template) {
  return resolveInput(input, template);
}
