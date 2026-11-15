// Per-site compatibility patches.
//
// Scramjet rewrites almost everything, but some sites still need a nudge: a bit
// of CSS to undo a layout that assumes it owns the top frame, or a small script
// to stub something the proxy can't provide. tabs.js calls applySitePatches()
// once per top-level proxied document, matched by hostname.
//
// Two kinds of patch:
//   - CSS patches live in /assets/data/site-patches.json so they can be added
//     without touching code (and shipped/edited per deployment). Shape:
//       [{ "match": "example.com", "css": "…", "note": "why" }]
//   - JS patches live in JS_PATCHES below, because they need a function.
//
// `match` is a hostname rule: "example.com" (exact or any subdomain),
// "*.example.com" (subdomains only), or "~substring" (hostname contains it).
//
// NOTE: the entries here are a small, deliberately-safe starting set. Real
// per-site fixes have to be written and checked against the live site — this
// build environment has no outside network, so anything beyond "it injects and
// doesn't throw" is unverified. Each patch is wrapped in try/catch and is a
// no-op when its target isn't present, so a stale patch can't break a page.

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

// Script patches. Each entry is { match, run(win, url), note }, where `run`
// executes inside the proxied page's own realm. Set `all: true` instead of a
// match to run on every page. Keep each tiny, guarded (wrap DOM access in your
// own checks), and reversible — a patch must be a no-op when its target isn't
// there, so a stale one can't break an unrelated page.
//
// Shipped empty on purpose: real script fixes have to be written against a live
// site, which this build environment can't reach. The framework below loads and
// runs whatever you add here. Template:
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
 * Apply every patch matching `url`'s hostname to the proxied window `win`.
 * Safe to call more than once per document; patches de-dupe themselves.
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
