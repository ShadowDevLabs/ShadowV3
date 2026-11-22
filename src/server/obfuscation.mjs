// Anti-fingerprinting for Shadow's own pages, wired in index.js by
// installObfuscation(). Three pieces, all derived from one seed (SHADOW_UI_SEED,
// random per start when unset) so mirrors that share a seed serve the same thing:
//
//   1. DOM renaming: every id and class the shell's HTML, CSS and JS use gets a
//      random name, the same in every file (see "Shell DOM renaming" below).
//      Every CSS/JS file is served minified from a random path (/abcde/k3j9x0q2mz.js),
//      inline <script>/<style> are minified and HTML comments are dropped.
//   2. Cloak (SHADOW_CLOAK): the shell's <title>, meta tags, favicon, language and
//      loading-screen brand are swapped for another site's.
//   3. Proxy URLs: /v1/api/config gives the page a per-deploy codec key and proxy
//      prefix (public/assets/js/tabs.js, loadProxyConfig), so proxied URLs differ
//      between deployments.
//   4. Font cipher (fontcipher.mjs): every piece of text is kept as seeded Coptic letters
//      that copies of the pages' web fonts draw as the real letters.
//
// SHADOW_DOMAINS gives each listed domain its own seed, for Caddy on_demand TLS fronting many domains.
// SHADOW_OBFUSCATE=off turns it all off. This is evasion, not security: the same
// kind of thing Ultraviolet's cloak and Holy Unblocker's rewriter do.

import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { transformSync } from "esbuild";
import { cipherTable, createFontCipher } from "./fontcipher.mjs";

// Placeholders: replace with the sites you want the shell to pass as.
export const CLOAK_PRESETS = {
  off: null,
  ixl: { title: "IXL | Math, Language Arts, Science, Social Studies, and Spanish",
    description: "IXL is the world's most popular subscription-based learning site for K-12.",
    siteName: "IXL Learning", url: "https://www.ixl.com", favicon: "https://www.ixl.com/favicon.ico", lang: "en" },
  classroom: { title: "Classes", description: "Sign in to continue to Google Classroom.",
    siteName: "Google Classroom", url: "https://classroom.google.com", favicon: "/assets/imgs/icons/cloaks/Classroom.png", lang: "en" },
  khan: { title: "Dashboard | Khan Academy",
    description: "Learn for free about math, art, computer programming, economics, and more.",
    siteName: "Khan Academy", url: "https://www.khanacademy.org", favicon: "/assets/imgs/icons/cloaks/Khan Academy.ico", lang: "en" },
  canvas: { title: "Dashboard", description: "Canvas by Instructure.",
    siteName: "Canvas", url: "https://canvas.instructure.com", favicon: "/assets/imgs/icons/cloaks/Canvas.ico", lang: "en" },
  drive: { title: "My Drive - Google Drive", description: "Sign in to continue to Google Drive.",
    siteName: "Google Drive", url: "https://drive.google.com", favicon: "/assets/imgs/icons/cloaks/Google Drive.ico", lang: "en" },
};

const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const ALNUM = ALPHA + "0123456789";
/** A name that starts with a letter, read off hash bytes. */
const word = (bytes, length) => {
  let out = ALPHA[bytes[0] % 26];
  for (let i = 1; out.length < length; i++) out += ALNUM[bytes[i] % 36];
  return out;
};
const derive = (seed, label) => crypto.createHmac("sha256", seed).update(label).digest();

/** SHADOW_CLOAK: a preset name, "random" (picked by the seed, the default) or "off". Unknown names count as random. */
export function resolveCloak(choice, seed) {
  choice = (choice ?? "random").toLowerCase();
  if (choice === "off") return null;
  if (Object.hasOwn(CLOAK_PRESETS, choice)) return CLOAK_PRESETS[choice];
  const names = Object.keys(CLOAK_PRESETS).filter((name) => CLOAK_PRESETS[name]);
  return CLOAK_PRESETS[names[derive(seed, "cloak")[0] % names.length]];
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * Replaces the <!--CLOAK:START-->…<!--CLOAK:END--> block, the <html lang> and the
 * "ShadowV3" brand. The markers never reach the browser: they'd be a signature.
 */
export function applyCloak(html, cloak) {
  const markers = /[ \t]*<!--CLOAK:START-->\n?([\s\S]*?)[ \t]*<!--CLOAK:END-->\n?/;
  if (!cloak) return html.replace(markers, (m, original) => original);
  const block = `  <title>${escapeHtml(cloak.title)}</title>
  <meta name="description" content="${escapeHtml(cloak.description)}" />
  <meta property="og:title" content="${escapeHtml(cloak.title)}" />
  <meta property="og:description" content="${escapeHtml(cloak.description)}" />
  <meta property="og:site_name" content="${escapeHtml(cloak.siteName)}" />
  <meta property="og:url" content="${escapeHtml(cloak.url)}" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="${escapeHtml(cloak.favicon)}" />
`;
  return html
    .replace(markers, () => block)
    .replace(/<html lang="[^"]*"/, () => `<html lang="${escapeHtml(cloak.lang ?? "en")}"`)
    .replaceAll("ShadowV3", () => escapeHtml(cloak.siteName));
}

/** The proxy prefix and codec key the page builds its codec from (served at /v1/api/config). */
export function proxyConfig(seed, reserved = new Set()) {
  let prefix;
  for (let n = 0; !prefix || reserved.has(prefix); n++) prefix = word(derive(seed, `prefix${n}`), 6);
  // One XOR amount (0-7) per character: keeps proxied URLs short and mostly printable.
  const codecKey = [...derive(seed, "codec").subarray(0, 11)].map((b) => b % 8).join("");
  return { prefix: `/${prefix}/`, codecKey };
}

// ---------------------------------------------------------------------------
// Shell DOM renaming. Every id and class the shell's own
// HTML, CSS and JS use is discovered at startup and given a random name, the
// same in every file. A name is renamed only where it is certainly a DOM name:
//   CSS   .name / #name in selectors (never in property values)
//   HTML  id, class, for, aria-* references, href="#name", inline <style>/<script>/on*
//   JS    string literals passed to getElementById, classList.*, querySelector*,
//         closest, matches, assigned to .className, under a `class:` key, a literal
//         that is itself a selector (".x"/"#x"), and class=/id= inside markup strings
// A name that also shows up as plain data (any other bare JS literal, an HTML
// value=/data-* attribute, a JSON string, a "-suffix"/"prefix-" fragment that is
// concatenated into ids) keeps its original name everywhere, so it can't break.

const IDENT = /^-?[A-Za-z_][\w-]*$/;
const skipDirectories = new Set(["/dist", "/books/files", "/assets/imgs"]);
const externalName = /^fa(?:-|$)/; // Font Awesome: styled by a stylesheet we don't serve

function readUiSources(directory, urlPath, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const url = `${urlPath}/${entry.name}`;
    const file = join(directory, entry.name);
    if (entry.isDirectory() && !skipDirectories.has(url)) readUiSources(file, url, files);
    else if (entry.isFile() && /\.(?:html|css|m?js|json)$/.test(url)) files.set(url, readFileSync(file, "utf8"));
  }
}

const swapList = (list, swap) => list.replace(/[^\s]+/g, (n) => (IDENT.test(n) ? swap(n) : n));
const swapSelector = (sel, swap) => sel.replace(/([.#])(-?[A-Za-z_][\w-]*)/g, (m, sigil, n) => sigil + swap(n));

function rewriteCss(text, swap) {
  // A selector is the text before a "{", back to the previous "{", "}" or ";".
  return text.replace(/(^|[{};])([^{};]*)(?=\{)/g, (m, lead, prelude) =>
    lead + (prelude.trimStart().startsWith("@") ? prelude : swapSelector(prelude, swap)));
}

const markupAttr = /(\s)(id|class|for|aria-(?:controls|labelledby|describedby|owns|activedescendant)|href|xlink:href)=(["'])([^"'<>]*)/gi;
function rewriteMarkupAttrs(text, swap) {
  return text.replace(markupAttr, (m, space, attr, quote, value) => {
    const name = attr.toLowerCase();
    if (name.endsWith("href")) return value.startsWith("#") ? `${space}${attr}=${quote}${swapSelector(value, swap)}` : m;
    return `${space}${attr}=${quote}${swapList(value, swap)}`;
  });
}

function rewriteHtml(text, swap, keep) {
  if (keep) for (const m of text.matchAll(/\s(?:value|data-[\w-]+)=["']([^"']*)["']/g)) keep.add(m[1].trim());
  return rewriteMarkupAttrs(text, swap)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, body, c) => a + rewriteCss(body, swap) + c)
    .replace(/(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, body, c) => a + rewriteJs(body, swap, keep) + c)
    .replace(/(\son\w+=)(?:"([^"]*)"|'([^']*)')/gi, (m, a, dq, sq) =>
      dq !== undefined ? `${a}"${rewriteJs(dq, swap, keep)}"` : `${a}'${rewriteJs(sq, swap, keep)}'`);
}

/** [start, end) of every string literal and template-literal chunk in a script. */
function stringSpans(src) {
  const spans = [], templates = [];
  let depth = 0, last = "", i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2); if (i < 0) break; i += 2; continue; }
    if (c === '"' || c === "'") {
      const start = ++i;
      while (i < src.length && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      spans.push([start, i++]);
      last = c;
      continue;
    }
    if (c === "`" || (c === "}" && templates.at(-1) === depth)) {
      if (c === "}") templates.pop();
      const start = ++i;
      while (i < src.length && src[i] !== "`" && !(src[i] === "$" && src[i + 1] === "{")) i += src[i] === "\\" ? 2 : 1;
      spans.push([start, i]);
      if (src[i] === "$") { templates.push(depth); i += 2; last = "{"; } else { i++; last = "`"; }
      continue;
    }
    const regexAllowed = last === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) ||
      /\b(?:return|typeof|case|do|else|in|of|void|yield|await)$/.test(src.slice(Math.max(0, i - 7), i).trimEnd());
    if (c === "/" && regexAllowed) {
      let inClass = false;
      for (i++; i < src.length && src[i] !== "\n" && (inClass || src[i] !== "/"); i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
      }
      i++;
      last = ")";
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return spans;
}

const listContext = /(?:getElementById|classList\.(?:add|remove|toggle|contains|replace))\(\s*(?:(["'`])[\w\s-]*\1\s*,\s*)*$|(?:\.className\s*[+]?=|\bclass(?:Name)?["']?\s*:)\s*$|setAttribute\(\s*(["'])(?:id|class)\2\s*,\s*$/;
const selectorContext = /(?:querySelector(?:All)?|closest|matches)\(\s*$/;
// "sel { prop: value; … }": CSS built in a script (style.textContent = `…`).
const cssRule = /[.#][A-Za-z_-][^{};]*\{\s*(?:[\w-]+\s*:[^{};]+;?\s*)+\}/;

function rewriteJs(src, swap, keep) {
  let out = "", at = 0;
  const weak = keep ? (n) => n : swap; // a bare ".x" literal renames x but isn't proof that x is a DOM name
  for (const [start, end] of stringSpans(src)) {
    const value = src.slice(start, end);
    const before = src.slice(Math.max(0, start - 81), start - 1);
    let next = value;
    if (listContext.test(before)) next = swapList(value, swap);
    else if (selectorContext.test(before)) next = swapSelector(value, swap);
    else if (cssRule.test(value)) next = rewriteMarkupAttrs(rewriteCss(value, swap), swap); // a stylesheet, maybe inside markup
    else if (/^\s*[.#][A-Za-z_-]/.test(value) && !value.includes("/")) next = swapSelector(value, weak);
    else if (value.includes("<")) next = rewriteMarkupAttrs(value, swap);
    else if (keep) {
      const parts = value.trim().split(/\s+/);
      if (parts.every((p) => IDENT.test(p))) parts.forEach((p) => keep.add(p));
      if (/^-[\w-]+$|^[\w-]+-$/.test(value)) keep.add(`fragment:${value}`);
    }
    out += src.slice(at, start) + next;
    at = end;
  }
  return out + src.slice(at);
}

function rewriteUiText(path, text, swap, keep) {
  if (path.endsWith(".css")) return rewriteCss(text, swap);
  if (path.endsWith(".html")) return rewriteHtml(text, swap, keep);
  if (path.endsWith(".json")) {
    if (keep) for (const m of text.matchAll(/"([^"\\]*)"/g)) keep.add(m[1].trim());
    return text;
  }
  return rewriteJs(text, swap, keep);
}

function randomNames(names, taken, seed) {
  const map = new Map(), used = new Set(taken);
  for (const original of [...names].sort()) {
    for (let attempt = 0; !map.has(original); attempt++) {
      const h = derive(seed, `${original}\0${attempt}`);
      const name = word(h.subarray(1), 5 + (h[0] % 5));
      if (!used.has(name)) { used.add(name); map.set(original, name); }
    }
  }
  return map;
}

/**
 * Discovers every DOM name in `sources` (url path -> text) and returns the random
 * map, each CSS/JS file's random path (`assetPath`) and a renderer that applies both.
 * `reserved` holds top-level names the asset folder must not take.
 */
export function buildUiRewrite(sources, seed, reserved = new Set()) {
  const found = new Set(), keep = new Set();
  const record = (n) => (found.add(n), n);
  for (const [path, text] of sources) rewriteUiText(path, text, record, keep);
  const fragments = [...keep].filter((k) => k.startsWith("fragment:")).map((k) => k.slice(9));
  const renamable = [...found].filter((n) =>
    !keep.has(n) && !externalName.test(n) && !fragments.some((f) => (f.startsWith("-") ? n.endsWith(f) : n.startsWith(f))));
  const map = randomNames(renamable, found, seed);
  const swap = (n) => map.get(n) ?? n;
  // The content hash is in every asset path, so a changed file gets a new URL.
  const build = crypto.createHash("sha256").update(seed).update(JSON.stringify([...sources])).digest("hex");
  let assetDir;
  for (let n = 0; !assetDir || reserved.has(assetDir); n++) assetDir = word(derive(seed, `assets${n}`), 5);
  const assetPath = (path) => `/${assetDir}/${word(derive(build, path), 10)}.${path.endsWith(".css") ? "css" : "js"}`;
  const render = (path, text) => rewriteUiText(path, text, swap, null).replace(assetReference, (original, quote, reference) => {
    const url = new URL(reference, new URL(path, "http://shadow.invalid"));
    if (!sources.has(url.pathname)) return original;
    return `${quote}${assetPath(url.pathname)}${url.search}${url.hash}${quote}`;
  });
  return { map, assetPath, render };
}

// Quoted references to the shell's own CSS/JS (link/script tags, imports, the
// service worker): rendered pages load them from their random paths instead.
const assetReference = /(["'`])((?!\/\/)[\w./%-]+\.(?:css|m?js)(?:\?[^"'\s`#]*)?(?:#[^"'\s`]*)?)\1/g;

/** Minifies CSS/JS (and the scripts, styles and comments in HTML) so served files don't read like their source. */
export function minifyAsset(path, text) {
  const minify = (code, loader) => {
    try {
      return transformSync(code, { loader, minify: true, legalComments: "none" }).code.trim();
    } catch (e) {
      console.warn(`[obfuscation] left ${path} unminified: ${e.message.split("\n")[0]}`);
      return code;
    }
  };
  if (path.endsWith(".css")) return minify(text, "css");
  if (!path.endsWith(".html")) return minify(text, "js");
  return text
    .replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi, (m, open, attrs, body, close) => {
      const type = attrs.match(/\btype=["']?([^"'\s>]+)/i)?.[1];
      const isJs = !type || /^(?:module|text\/javascript)$/i.test(type); // not JSON-LD, templates, …
      return /\bsrc=/i.test(attrs) || !isJs || !body.trim() ? m : open + minify(body, "js") + close;
    })
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, open, body, close) => open + minify(body, "css") + close)
    .replace(/(<script\b[\s\S]*?<\/script>)|<!--(?!\[if)[\s\S]*?-->\n?/gi, (m, script) => script ?? "");
}

/**
 * SHADOW_DOMAINS: the comma-separated domains this server answers for. Each one gets its own
 * seed (so its own names, paths, cloak, prefix and codec); its subdomains share it, so the
 * number of sites built stays the number of domains listed. Returns a host -> listed domain
 * lookup (undefined when unlisted), also used for Caddy's on_demand TLS (/v1/api/tls-ask in index.js).
 */
export function domainMatcher(list = "") {
  const domains = list.split(",").map((d) => d.trim().toLowerCase().replace(/^\*?\./, "")).filter(Boolean);
  return (host) => {
    host = String(host ?? "").toLowerCase().replace(/\.$/, "");
    return domains.find((d) => host === d || host.endsWith(`.${d}`));
  };
}

// Globals and message names the runtime shares between the page, the worker and every proxied page,
// where a site's scripts can see them. Seeded per site. Sapphire's own names stay: extensions save them.
const runtimeName = /(?<![\w$])(?:\$scram[\w$]*|\$controller\$\w+|\$sw\$\w+|\$sapphireRouter|__scramjet_controller_channel)(?![\w$])/g;
const COOKIE_DB = `_${word(derive("shadow", "cookie-db"), 11)}`;

const replaceOnce = (text, from, to) => {
  if (text.split(from).length !== 2) throw new Error(`[obfuscation] expected ${from} once in the Scramjet controller; check it after a package update`);
  return text.replace(from, () => to);
};

/**
 * Everything one seed serves: the proxy config, the Wisp path and every file by request path.
 * `runtime` (well-known url -> bytes) is the proxy runtime: Scramjet, its controller, the
 * transports, eruda and public/dist. It moves to seeded paths, and every reference to its
 * well-known paths, in the shell and in the runtime itself, follows.
 */
function buildSite(seed, publicPath, reserved, runtime) {
  const config = proxyConfig(seed, reserved);
  const cloak = resolveCloak(process.env.SHADOW_CLOAK, seed);
  const sources = new Map();
  readUiSources(publicPath, "", sources);
  sources.set("/index.html", applyCloak(sources.get("/index.html") ?? "", cloak));

  let runtimeDir;
  for (let n = 0; !runtimeDir || reserved.has(runtimeDir); n++) runtimeDir = word(derive(seed, `runtime${n}`), 5);
  const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
  // The content hash is in the name, so a package update gets a new URL. .mjs is served as .js: modules go by MIME type.
  const moved = new Map([...runtime].map(([url, bytes]) =>
    [url, `/${runtimeDir}/${word(derive(seed, url + sha(bytes)), 10)}${url.endsWith(".wasm") ? ".wasm" : ".js"}`]));
  const wispPath = `/${word(derive(seed, "wisp"), 7)}/`;
  // Seeded names of the same length (see runtimeName), so the wasm's copies can be swapped in place.
  // Plain words, not "$…": a page full of random $-globals would be a pattern of its own.
  const names = new Map();
  const rename = (name) => {
    if (!names.has(name)) names.set(name, word(derive(seed, `name${name}`), name.length));
    return names.get(name);
  };
  const scramtag = word(derive(seed, "scramtag"), 8);
  const moveRuntime = (text) => {
    for (const [from, to] of moved) text = text.replaceAll(from, to);
    text = text.replace(runtimeName, rename).replaceAll("scramtag", scramtag);
    // Only this server's own Wisp endpoint: custom Wisp servers keep /wisp/.
    return text.replaceAll("${location.host}/wisp/", `\${location.host}${wispPath}`);
  };
  for (const [path, text] of sources) sources.set(path, moveRuntime(text));
  const { render, assetPath } = buildUiRewrite(sources, seed, new Set([...reserved, runtimeDir, config.prefix.slice(1, -1)]));
  const assets = [...sources.keys()].filter((path) => /\.(?:css|m?js)$/.test(path));
  // The worker precaches every current CSS/JS path and drops older ones.
  const swSource = sources.get("/sw.js")?.replace("const UI_ASSETS = null;", () => `const UI_ASSETS = ${JSON.stringify(assets.map(assetPath))};`);

  const served = new Map(); // request path -> { body, etag, cache, worker }
  const add = (url, body, cache, worker = false) =>
    served.set(url, { body, cache, worker, etag: `W/"${crypto.createHash("sha256").update(body).digest("hex").slice(0, 32)}"` });
  // Font cipher: pages carry Coptic letters that only this seed's fonts draw as real text.
  const table = cipherTable((label) => derive(seed, `cipher${label}`).readUInt32BE(0));
  const cipher = createFontCipher(table);
  const fontUrl = (key) => assetPath(`/fonts/${key}.ttf`).replace(/\.js$/, ".ttf");
  for (const [key, font] of cipher.fonts) add(fontUrl(key), font, "public, max-age=31536000, immutable");
  // The page's own stylesheets, for the Google Fonts they @import.
  const linkedCss = (path, html) => [...html.matchAll(/href=["']([^"']+\.css)["']/g)]
    .map((m) => sources.get(new URL(m[1], new URL(path, "http://shadow.invalid")).pathname) ?? "").join("\n");
  for (const [path, source] of sources) {
    if (path.endsWith(".json")) continue;
    const body = minifyAsset(path, render(path, path === "/sw.js" ? swSource : source));
    if (path.endsWith(".html")) add(path, cipher.render(body, fontUrl, linkedCss(path, source)), "public, max-age=0, must-revalidate");
    else if (path === "/sw.js") {
      add(assetPath(path), body, "no-cache", true);
      add(path, body, "no-cache", true); // workers registered at /sw.js before update to this one: the original imports paths that are gone
    }
    else {
      add(assetPath(path), body, "public, max-age=31536000, immutable"); // the path changes whenever the file does
      add(path, body, "public, max-age=0, must-revalidate"); // the original URL gets the same renamed copy, never a mismatched one
    }
  }

  // Scramjet hides the script the controller injects into every proxied page, and its virtual wasm
  // loader, from the page's stack traces and performance entries by file name (maskedfiles): rename
  // them there too, and hide scramjet.js, which upstream leaves visible, as well.
  const basename = (url) => moved.has(url) && posix.basename(moved.get(url));
  const injectName = basename("/controller/controller.inject.js");
  const scramjetName = basename("/scramjet/scramjet.js");
  const virtualWasm = `${word(derive(seed, "virtualwasm"), 8)}.js`;
  // The wasm last: it takes the names the scripts were given.
  for (const [url, bytes] of [...runtime].sort(([a], [b]) => a.endsWith(".wasm") - b.endsWith(".wasm"))) {
    const tag = derive(seed, `tag${url}`).subarray(0, 16); // per-deploy bytes, so no two deploys share a file hash
    let body;
    if (url.endsWith(".wasm")) {
      // The rewriter writes some runtime names into rewritten code itself ("$scramerr(", "/*scramtag").
      // Longest first, so "$scramjet" can't eat into "$scramjet$setrealmfn".
      let text = bytes.toString("latin1").replaceAll("scramtag", scramtag);
      for (const [from, to] of [...names].sort(([a], [b]) => b.length - a.length)) text = text.replaceAll(from, to);
      if (/\$scram|scramtag/.test(text)) throw new Error(`[obfuscation] ${url} still names a runtime global the scripts don't; check it after a package update`);
      body = Buffer.concat([Buffer.from(text, "latin1"), Buffer.from([0, 18, 1, 0x78]), tag]); // a custom section "x": still valid wasm
    } else {
      body = moveRuntime(bytes.toString("utf8")).replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "");
      if (url === "/controller/controller.api.js") {
        body = replaceOnce(body, 'virtualWasmPath:"scramjet.wasm.js"', `virtualWasmPath:"${virtualWasm}"`);
        body = replaceOnce(body, 'maskedfiles:["inject.js","scramjet.wasm.js"]', `maskedfiles:${JSON.stringify([injectName, virtualWasm, scramjetName].filter(Boolean))}`);
        // The cookie jar of every proxied site: a fixed name, so a new seed doesn't log everyone out.
        body = replaceOnce(body, 'indexedDB.open("__scramjet_controller"', `indexedDB.open("${COOKIE_DB}"`);
      }
      body += `\n/*${tag.toString("hex")}*/`;
    }
    add(moved.get(url), body, "public, max-age=31536000, immutable");
  }
  return { config, served, wispPath };
}

/**
 * Wires all of it into the app, before the generic express.static(publicPath) so it wins for the
 * same paths. `runtime` maps each proxy runtime file's well-known url to its file on disk
 * (see buildSite); the caller mounts those well-known paths only when this returns undefined
 * (turned off). Otherwise returns { page(path, host), wispPath(host) }: the served body of a page,
 * for handlers that send one themselves, and the path the Wisp server answers at.
 *
 * Each SHADOW_DOMAINS domain gets a site built from its own seed, on its first request.
 * Any other Host header gets the default site, so a made-up Host can't make the server build more.
 */
export function installObfuscation(app, { publicPath, runtime = new Map() }) {
  const enabled = process.env.SHADOW_OBFUSCATE !== "off";
  const seed = process.env.SHADOW_UI_SEED || crypto.randomBytes(16).toString("hex");
  const listedDomain = domainMatcher(process.env.SHADOW_DOMAINS);

  const reserved = new Set(readdirSync(publicPath));
  // Minified once here, the same for every seed (the seeded steps come after, in buildSite).
  const runtimeBytes = new Map([...runtime].map(([url, file]) =>
    [url, url.endsWith(".wasm") ? readFileSync(file) : Buffer.from(minifyAsset(url, readFileSync(file, "utf8")))]));
  const sites = new Map(); // listed domain ("" = default) -> site; one per listed domain at most
  const site = (host) => {
    const domain = listedDomain(host) ?? "";
    if (!sites.has(domain)) sites.set(domain, buildSite(domain ? derive(seed, `host:${domain}`).toString("hex") : seed, publicPath, reserved, runtimeBytes));
    return sites.get(domain);
  };

  app.get("/v1/api/config", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(enabled ? site(req.hostname).config : {}); // {} = the page keeps its built-in codec
  });
  if (!enabled) return;
  site(); // build the default site at startup, so a broken source fails now and not on a request

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let path;
    try {
      path = posix.normalize(decodeURIComponent(req.path));
    } catch {
      return next();
    }
    if (path.endsWith("/")) path += "index.html";
    if (path === "/privacy") path = "/privacy.html";
    const asset = site(req.hostname).served.get(path);
    if (!asset) return next();
    res.set("Cache-Control", asset.cache);
    if (asset.worker) res.set("Service-Worker-Allowed", "/"); // registered with scope "/" from outside its folder
    res.set("ETag", asset.etag);
    res.vary("Host"); // one URL, a different body per domain: shared caches must not mix them
    res.type(posix.extname(path)).send(asset.body);
  });
  return { page: (path, host) => site(host).served.get(path)?.body, wispPath: (host) => site(host).wispPath };
}
