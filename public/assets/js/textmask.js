// "Hide page text" masks Latin letters and digits after the proxied page has loaded.
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const FIRST_PUA = 0xefc0;
export const MASK_TABLE = Object.fromEntries([...ALNUM].map((c, i) => [c, String.fromCharCode(FIRST_PUA + i)]));
const PUA = new RegExp(`[${MASK_TABLE.A}-${MASK_TABLE[9]}]`, "g");
const unmaskString = (text) => text.replace(PUA, (c) => ALNUM[c.charCodeAt(0) - FIRST_PUA]);
const DISPLAY_TAG = "shadow-page-text";
const SOURCE_TAG = "shadow-page-source";
const DISPLAY_TEXT = "--shadow-page-text";
const CSS_ESCAPES = Array.from({ length: 128 }, (_, n) => `\\${n.toString(16)} `);

// Keep the display string escaped in CSS, including quotes and line breaks from the page.
export const cssString = (text) => `"${text.replace(/[A-Za-z0-9"\\\x00-\x1f\x7f]/g, (c) => CSS_ESCAPES[c.charCodeAt(0)])}"`;

/** The masked form of a string. maskString(maskString(s)) === maskString(s). */
export const maskString = (text) => text.replace(/[A-Za-z0-9](?!\p{M})/gu, (c) => MASK_TABLE[c]);

// Code, editable text, and text displayed by native controls use their original characters.
const SKIP_ELEMENTS = "head,script,style,noscript,template,textarea,select,option,datalist,svg,math";
const SKIP = `${SKIP_ELEMENTS},[contenteditable]:not([contenteditable=false])`;
const SKIP_TAGS = new Set(SKIP_ELEMENTS.split(","));
// The same test as SKIP for one element, without running a selector (the walk does it per element).
const skipped = (el) => SKIP_TAGS.has(el.localName) || (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false");
const HAS_SWAPPABLE = /[A-Za-z0-9]/;

// Decoys: a few clipped, aria-hidden blocks of school-subject text per page, for filters that read
// textContent/innerText. People and screen readers never see them. Never masked.
const EDU = [
  "Photosynthesis converts light energy into chemical energy stored in glucose.",
  "The mitochondria produce most of the cell's supply of adenosine triphosphate.",
  "A linear equation in slope-intercept form is written as y = mx + b.",
  "The Pythagorean theorem states that a squared plus b squared equals c squared.",
  "The Declaration of Independence was adopted on July 4, 1776.",
  "The water cycle includes evaporation, condensation, precipitation and collection.",
  "Newton's second law states that force equals mass times acceleration.",
  "A noun names a person, place, thing or idea; a verb expresses an action.",
  "The thesis statement presents the main argument of an essay.",
  "Plate tectonics explains the movement of the Earth's lithosphere.",
  "The Industrial Revolution began in Great Britain in the late eighteenth century.",
  "Fractions with the same denominator are added by adding their numerators.",
  "The periodic table organizes elements by atomic number and electron configuration.",
  "The three branches of government are the legislative, executive and judicial.",
  "Supply and demand determine the market price of goods and services.",
  "A haiku is a short poem of three lines with five, seven and five syllables.",
  "DNA carries genetic instructions for growth, development and reproduction.",
  "The area of a circle equals pi multiplied by the radius squared.",
  "Primary sources are first-hand accounts created at the time of an event.",
  "Ecosystems include living organisms and the physical environment they share.",
  "Kinetic energy is the energy an object has because of its motion.",
  "The Renaissance was a period of renewed interest in art, science and learning.",
  "A simile compares two things using the words like or as.",
  "Prime numbers have exactly two factors: one and the number itself.",
];
const HIDDEN = "position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;border:0!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important;pointer-events:none!important";
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const randomClass = () => String.fromCharCode(97 + Math.floor(Math.random() * 26)) + Math.random().toString(36).slice(2, 8);

/** Masks a proxied document's text now and as it changes. `win` is the proxied window. */
export function maskDocument(win) {
  const doc = win.document;
  if (!win.CSSStyleSheet?.prototype.replaceSync || !("adoptedStyleSheets" in doc)) return;
  const sheet = new win.CSSStyleSheet();
  sheet.replaceSync(`
    ${DISPLAY_TAG} { all: unset !important; display: contents !important; }
    ${DISPLAY_TAG}::before { all: unset !important; content: var(${DISPLAY_TEXT}) !important; }
    ${SOURCE_TAG} { display: none !important; }
  `);
  const displayTemplate = doc.createElement(DISPLAY_TAG);
  displayTemplate.appendChild(doc.createElement(SOURCE_TAG)).hidden = true;
  const displays = new WeakSet();
  const sources = new WeakMap();

  const showText = (node, entry, original, masked) => {
    entry.display.style.setProperty(DISPLAY_TEXT, cssString(original));
    entry.masked = masked;
    if (node.data !== masked) node.data = masked;
  };

  const release = (node, entry) => {
    sources.delete(node);
    entry.display.remove();
    node.data = unmaskString(node.data);
    return node.data;
  };

  const decoys = [];
  const decoySet = new WeakSet();
  // At random places in <body> (never first: that would shift :first-child styles), and back in
  // when a page swaps its content out.
  const placeDecoys = () => {
    const body = doc.body;
    if (!body) return;
    if (!decoys.length) {
      for (let n = 3 + Math.floor(Math.random() * 3); n > 0; n--) {
        const el = doc.createElement("div");
        el.className = randomClass();
        el.setAttribute("aria-hidden", "true");
        el.style.cssText = HIDDEN;
        el.textContent = Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => pick(EDU)).join(" ");
        decoys.push(el);
        decoySet.add(el);
      }
    }
    for (const el of decoys) {
      if (el.isConnected) continue;
      const kids = body.children;
      body.insertBefore(el, kids.length > 1 ? kids[1 + Math.floor(Math.random() * (kids.length - 1))] : null);
    }
  };
  // `inside`: the caller already knows no ancestor is skipped (a walk that rejects skipped subtrees).
  const maskText = (node, inside = false) => {
    let value = node.data;
    const entry = sources.get(node);
    if (entry) {
      if (node.parentNode === entry.source) {
        if (value === entry.masked) return;
        // An in-place edit can leave some of the previous masked characters intact.
        const original = unmaskString(value);
        showText(node, entry, original, maskString(original));
        return;
      }
      value = release(node, entry);
    }
    if (!value || !HAS_SWAPPABLE.test(value) || value.search(PUA) !== -1) return;
    const parent = node.parentNode;
    if (!parent || decoySet.has(parent) || (!inside && parent.closest?.(SKIP))) return;
    const masked = maskString(value);
    if (masked === value) return;
    const display = displayTemplate.cloneNode(true);
    const source = display.firstChild;
    displays.add(display);
    const render = { display, source };
    sources.set(node, render);
    // shortcut: sites that require the original Text to stay a direct child can use masking off.
    const next = node.nextSibling;
    source.append(node);
    showText(node, render, value, masked);
    parent.insertBefore(display, next);
  };
  const shadows = new WeakSet();
  const maskElement = (el) => {
    // Web components keep their text in their own (open) shadow tree: mask and watch it too.
    if (el.shadowRoot && !shadows.has(el.shadowRoot)) {
      shadows.add(el.shadowRoot);
      watch(el.shadowRoot);
      queue.add(el.shadowRoot);
    }
  };
  // Skips whole <script>/<style>/editor subtrees instead of looking at each node inside them.
  const filter = { acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (skipped(n) || decoySet.has(n) || displays.has(n)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) };
  const walk = (root) => doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, filter);
  const maskNode = (node) => (node.nodeType === Node.TEXT_NODE ? maskText(node, true) : maskElement(node)); // from walks only
  const queue = new Set();
  let walker, scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    if (win.scheduler?.postTask) win.scheduler.postTask(flush, { priority: "background" });
    else if (win.requestIdleCallback) win.requestIdleCallback(flush, { timeout: 100 });
    else win.requestAnimationFrame(flush);
  };
  const flush = () => {
    // Bound both the first walk and later batches so large page updates yield to input.
    const until = performance.now() + 5;
    const roots = queue.values();
    do {
      if (walker?.root.isConnected) {
        if (!walker.currentNode.isConnected) walker.currentNode = walker.root;
        const node = walker.nextNode();
        if (node) {
          maskNode(node);
          continue;
        }
      }
      walker = undefined;
      const root = roots.next().value;
      if (!root) break;
      queue.delete(root);
      if (!root.isConnected) continue;
      if (root.nodeType === Node.TEXT_NODE) {
        maskText(root);
        continue;
      }
      if (root.nodeType === Node.ELEMENT_NODE) {
        if (displays.has(root) || decoySet.has(root) || root.closest(SKIP)) continue;
        maskElement(root);
        const child = root.firstChild;
        if (!child) continue;
        if (child.nodeType === Node.TEXT_NODE && !child.nextSibling) {
          maskText(child, true);
          continue;
        }
      }
      walker = walk(root);
    } while (performance.now() < until);
    if (decoys.some((el) => !el.isConnected)) placeDecoys();
    scheduled = false;
    if (walker || queue.size) schedule();
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") {
        if (sources.get(r.target)?.masked !== r.target.data) queue.add(r.target);
        continue;
      }
      for (const node of r.removedNodes) {
        const entry = sources.get(node);
        if (entry && node.parentNode !== entry.source) release(node, entry);
      }
      for (const node of r.addedNodes) {
        if (!displays.has(node) && sources.get(node)?.source !== r.target) queue.add(node);
      }
    }
    if (queue.size) schedule();
  });
  // Masking writes only what changes and masked text masks to itself, so these never loop.
  const watch = (root) => {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  };

  let started = false;
  const start = () => {
    if (started || !doc.documentElement) return;
    started = true;
    watch(doc); // includes a replaced <body>
    placeDecoys();
    queue.add(doc.documentElement);
    schedule();
  };
  // Shortly after the HTML is in, not at "load", which pages full of ads may not reach for a long
  // time. The delay leaves frameworks (React, Vue, …) time to check their HTML against what they render.
  if (doc.readyState === "complete") start();
  else {
    win.addEventListener("load", start, { once: true });
    const soon = () => win.setTimeout(start, 1000);
    if (doc.readyState === "interactive") soon();
    else doc.addEventListener("DOMContentLoaded", soon, { once: true });
  }
}
