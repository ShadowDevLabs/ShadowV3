// Per-deploy anti-fingerprinting for the Shadow shell. Opt-in: nothing here runs
// until index.js calls installObfuscation(app, { publicPath, express }) — see
// OBFUSCATION.md for the one-line wiring. Disable at runtime with
// SHADOW_OBFUSCATE=off (ids become stable again, handy for debugging).
//
// Three independent pieces, generated once per process so two deployments (and
// the mirror domains) don't share one static signature a filter can match on:
//
//   1. A random URL-codec key + proxy prefix, served to the client at
//      /v1/api/config. The client builds its codec from the key (see the
//      snippet in OBFUSCATION.md), so proxied URLs differ between deployments.
//   2. A token rewrite: a fixed set of identifying DOM ids / class prefixes /
//      brand strings in the served HTML/CSS/JS are swapped for random names,
//      consistently across every text asset. An id and every reference to it
//      change together, so the page still works.
//   3. A document cloak: the shell page's <title>, meta and favicon are changed 
//      for an another present/website to fight against scrapers whether it's a known site or not like (example1, example2).
//
// This is evasion, not security — the same category of thing Ultraviolet's cloak
// and Holy Unblocker's rewriter already do for the same reason.

import crypto from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const OBFUSCATE = process.env.SHADOW_OBFUSCATE !== "off";

// DOM signatures a scraper is likely to key on. A prefix like "shadow-menu" also
// covers "shadow-menu-item" etc. Keep these mutually non-substring; replacement
// is longest-first so a token that is a prefix of another is handled after it.
const SIGNATURE_TOKENS = [
  "__shadow-search-bar",
  "menu-dropdown",
  "tabs-container",
  "iframes-container",
  "bookmarks-container",
  "disclaimerSite",
  "loading-screen",
  "shadow-menu",
  "shadow-toast",
  "ShadowV3",
];

const CLOAK_PRESETS = {
  off: null,
  example1: {
    title: "Example Site 1",
    description: "This is an example website.",
    siteName: "Example Site 1",
    url: "https://example.com",
    favicon: "https://example.com/favicon.ico",
    lang: "en"
  },
  example2: {
    title: "Example Site 2",
    description: "This is another example website.",
    siteName: "Example Site 2",
    url: "https://example.org",
    favicon: "https://example.org/favicon.ico",
    lang: "en"
  },
};

function randToken(length = 8) {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  const alnum = alpha + "0123456789";
  let out = alpha[crypto.randomInt(alpha.length)];
  for (let i = 1; i < length; i++) out += alnum[crypto.randomInt(alnum.length)];
  return out;
}

function buildTokenMap() {
  if (!OBFUSCATE) return [];
  return [...SIGNATURE_TOKENS]
    .sort((a, b) => b.length - a.length)
    .map((token) => ({ token, replacement: randToken(token.length > 12 ? 12 : 8) }));
}

function resolveCloak() {
  const choice = (process.env.SHADOW_CLOAK ?? "example1").toLowerCase();
  if (choice === "random") {
    const names = Object.keys(CLOAK_PRESETS).filter((n) => CLOAK_PRESETS[n]);
    return CLOAK_PRESETS[names[crypto.randomInt(names.length)]];
  }
  return CLOAK_PRESETS[choice] ?? CLOAK_PRESETS.example1;
}

const state = {
  enabled: OBFUSCATE,
  prefix: OBFUSCATE ? `/${randToken(6)}/` : "/~/s/",
  codecKey: OBFUSCATE ? crypto.randomBytes(12).toString("hex") : "7f3a9c2e5b1d",
  tokenMap: buildTokenMap(),
  cloak: resolveCloak(),
};

/** The subset the browser needs to reproduce the codec and find proxied URLs. */
export function clientConfig() {
  return { prefix: state.prefix, codecKey: state.codecKey, obfuscated: state.enabled };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function applyCloak(html) {
  const cloak = state.cloak;
  if (!cloak) return html;
  const block = `
  <title>${escapeHtml(cloak.title)}</title>
  <meta name="description" content="${escapeHtml(cloak.description)}" />
  <meta property="og:title" content="${escapeHtml(cloak.title)}" />
  <meta property="og:description" content="${escapeHtml(cloak.description)}" />
  <meta property="og:site_name" content="${escapeHtml(cloak.siteName)}" />
  <meta property="og:url" content="${escapeHtml(cloak.url)}" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="${escapeHtml(cloak.favicon)}" />`;
  const replaced = html.replace(/<!--CLOAK:START-->[\s\S]*?<!--CLOAK:END-->/, `<!--CLOAK:START-->${block}\n  <!--CLOAK:END-->`);
  return cloak.lang ? replaced.replace(/<html lang="[^"]*"/, `<html lang="${escapeHtml(cloak.lang)}"`) : replaced;
}

/** Rewrites a served text asset: signature tokens, then (for index.html) the cloak. */
export function rewriteText(relPath, text) {
  let out = text;
  for (const { token, replacement } of state.tokenMap) out = out.split(token).join(replacement);
  if (relPath === "index.html") out = applyCloak(out);
  return out;
}

export const isObfuscated = () => state.enabled;
const needsRewrite = () => state.tokenMap.length > 0 || !!state.cloak;
export { CLOAK_PRESETS };

/**
 * Wire obfuscation into the Express app: the /v1/api/config endpoint and the
 * HTML/CSS/JS rewrite middleware. Call this once, immediately BEFORE the generic
 * `app.use(express.static(publicPath, …))` so it wins for the same paths. The
 * runtime bundles (/dist, /scramjet, /controller, /epoxy, /libcurl, /eruda) are
 * mounted earlier and never reach here.
 */
export function installObfuscation(app, { publicPath, express }) {
  app.get("/v1/api/config", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(clientConfig());
  });

  if (!needsRewrite()) return;

  const REWRITE_EXT = new Set([".html", ".css", ".js"]);
  const cache = new Map(); // relPath -> { body, etag }

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let rel = decodeURIComponent(req.path.replace(/^\/+/, ""));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    if (rel.includes("..")) return next();
    const dot = rel.lastIndexOf(".");
    const ext = dot === -1 ? "" : rel.slice(dot).toLowerCase();
    if (!REWRITE_EXT.has(ext)) return next();

    const abs = join(publicPath, rel);
    if (!abs.startsWith(publicPath) || !existsSync(abs) || !statSync(abs).isFile()) return next();

    let entry = cache.get(rel);
    if (!entry) {
      const body = rewriteText(rel, readFileSync(abs, "utf8"));
      const etag = '"' + crypto.createHash("sha1").update(body).digest("hex").slice(0, 16) + '"';
      entry = { body, etag };
      cache.set(rel, entry);
    }
    const type = ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : "application/javascript";
    res.set("Content-Type", `${type}; charset=utf-8`);
    res.set("Cache-Control", rel === "index.html" ? "no-cache" : "public, max-age=3600");
    res.set("ETag", entry.etag);
    if (req.headers["if-none-match"] === entry.etag) return res.status(304).end();
    res.send(req.method === "HEAD" ? undefined : entry.body);
  });
}
