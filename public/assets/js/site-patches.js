// Per-site compatibility patches.
//
// CSS or script tweaks for sites that still break after Scramjet. tabs.js calls applySitePatches()
// once per top-level proxied document.
//
//   - CSS: /assets/data/site-patches.json, [{ "match": "example.com", "css": "…", "note": "why" }]
//   - JS: JS_PATCHES below
//
// `match`: "example.com" (host or subdomain), "*.example.com" (subdomains only), "~text" (host contains it).
// Patches are wrapped in try/catch and should do nothing when their target is missing.

function hostMatches(rule, host) {
  if (!rule || !host) return false;
  host = host.toLowerCase();
  rule = rule.toLowerCase();
  if (rule.startsWith("~")) return host.includes(rule.slice(1));
  if (rule.startsWith("*.")) {
    const base = rule.slice(2);
    return host.endsWith("." + base);
  }
  return host === rule || host.endsWith("." + rule);
}

// Script patches: { match, run(win, url), note }. `all: true` runs everywhere. Empty for now.
//
//   { match: "docs.google.com", note: "why",
//     run(win) { const el = win.document.querySelector("…"); if (el) el.remove(); } },
const JS_PATCHES = [];

let cssPatchesPromise = null;
function loadCssPatches() {
  if (!cssPatchesPromise) {
    cssPatchesPromise = fetch("/assets/data/site-patches.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => (Array.isArray(list) ? list.filter((p) => p && p.match && p.css) : []))
      .catch(() => []);
  }
  return cssPatchesPromise;
}

function injectCss(win, css, key) {
  try {
    const doc = win.document;
    if (!doc || doc.getElementById(key)) return;
    const style = doc.createElement("style");
    style.id = key;
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style);
  } catch (e) {
    console.debug("[site-patch] css inject failed", e);
  }
}

/**
 * Applies every patch matching `url`'s host to `win`. Safe to call twice.
 */
export async function applySitePatches(win, url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  if (!host) return;

  for (const patch of JS_PATCHES) {
    if (!(patch.all || hostMatches(patch.match, host))) continue;
    try {
      patch.run(win, url);
    } catch (e) {
      console.debug("[site-patch] js patch failed for", patch.match, e);
    }
  }

  const css = await loadCssPatches();
  css.forEach((patch, i) => {
    if (!hostMatches(patch.match, host)) return;
    injectCss(win, patch.css, `__shadow-patch-${i}`);
  });
}
