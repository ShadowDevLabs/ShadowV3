// "Hide page text" (Settings → General): the text of proxied pages, as filters that scan a page
// for keywords read it. Looks the same on screen, but 24 Latin letters become their look-alikes
// from Cyrillic (a → а, e → е, o → о, …), so "minecraft" in the page is "mіnесrаft" and no
// keyword list matches it. Words made only of letters without a twin (b d f g h k l m n q r t u
// v w z) stay as they are. No font files are involved, so every font works: a font without
// Cyrillic draws those letters from a fallback font.
//
// It runs after the page has loaded (frameworks compare their HTML with what they render while
// loading), then on new text as it appears. Masking is idempotent: masked text masks to itself,
// so the observer never loops on its own writes. Page scripts that read their own text get the
// masked text; what the user types (inputs, text areas, editors) is left alone.

const LOOKALIKE = {
  a: "а", c: "с", e: "е", i: "і", j: "ј", o: "о", p: "р", s: "ѕ", x: "х", y: "у",
  A: "А", B: "В", C: "С", E: "Е", H: "Н", I: "І", J: "Ј", K: "К", M: "М", O: "О", P: "Р", S: "Ѕ", T: "Т", X: "Х",
};
const SWAPPABLE = new RegExp(`[${Object.keys(LOOKALIKE).join("")}]`, "g");

/** The masked form of a string. maskString(maskString(s)) === maskString(s). */
export const maskString = (text) => text.replace(SWAPPABLE, (c) => LOOKALIKE[c]);

// Not page text: code that runs, styles, and what the user is typing.
const SKIP = "script,style,noscript,template,textarea,[contenteditable]:not([contenteditable=false])";
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "script", "style"]); // SVG keeps lowercase
// The same test as SKIP for one element, without running a selector (the walk does it per element).
const skipped = (el) => SKIP_TAGS.has(el.tagName) || (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false");
// Text that shows as tooltips, image text, hints and screen-reader labels.
const ATTRS = ["title", "alt", "placeholder", "aria-label"];
const BUTTON_TYPES = /^(?:button|submit|reset)$/i; // <input value="…"> shown as a button's text
const HAS_SWAPPABLE = /[aceijopsxyABCEHIJKMOPSTX]/;

// Decoys: a few blocks of school-subject sentences per page, laid out but clipped to nothing.
// A filter that reads the page's text (textContent or innerText) finds them; people don't see
// them and screen readers skip them (aria-hidden). They are never masked.
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
    const value = node.nodeValue;
    if (!value || !HAS_SWAPPABLE.test(value)) return;
    const parent = node.parentElement;
    if (decoySet.has(parent) || (!inside && parent?.closest(SKIP))) return;
    node.nodeValue = maskString(value);
  };
  const maskAttr = (el, name) => {
    const value = el.getAttribute(name);
    if (value && HAS_SWAPPABLE.test(value)) el.setAttribute(name, maskString(value));
  };
  const shadows = new WeakSet();
  const maskElement = (el) => {
    for (const name of ATTRS) maskAttr(el, name);
    if (el.tagName === "INPUT" && BUTTON_TYPES.test(el.type)) maskAttr(el, "value");
    // Web components keep their text in their own (open) shadow tree: mask and watch it too.
    if (el.shadowRoot && !shadows.has(el.shadowRoot)) {
      shadows.add(el.shadowRoot);
      watch(el.shadowRoot);
      queue.add(el.shadowRoot);
    }
  };
  // Skips whole <script>/<style>/editor subtrees instead of looking at each node inside them.
  const filter = { acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (skipped(n) || decoySet.has(n)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) };
  const walk = (root) => doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, filter);
  const maskNode = (node) => (node.nodeType === Node.TEXT_NODE ? maskText(node, true) : maskElement(node)); // from walks only
  const maskTree = (root) => {
    if (root.nodeType === Node.TEXT_NODE) return maskText(root);
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (decoySet.has(root) || root.closest(SKIP)) return;
      maskElement(root);
    }
    const walker = walk(root);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) maskNode(node);
  };

  // New and changed text, batched: one pass per frame however many mutations arrive.
  let queue = new Set();
  const flush = () => {
    const batch = queue;
    queue = new Set();
    for (const node of batch) if (node.isConnected) maskTree(node);
    if (decoys.some((el) => !el.isConnected)) placeDecoys();
  };
  const observer = new MutationObserver((records) => {
    const wasEmpty = queue.size === 0;
    for (const r of records) {
      if (r.type === "childList") for (const node of r.addedNodes) queue.add(node);
      else queue.add(r.target); // characterData, or one of the attributes below
    }
    if (wasEmpty && queue.size) win.requestAnimationFrame(flush);
  });
  // Masking writes only what changes and masked text masks to itself, so these never loop.
  const watch = (root) =>
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, "value"] });

  let started = false;
  const start = () => {
    if (started || !doc.documentElement) return;
    started = true;
    watch(doc.documentElement); // the whole document, <title> included, and a replaced <body>
    placeDecoys();
    // The existing text in slices, so a long page never holds up input for more than a few ms.
    const walker = walk(doc.documentElement);
    // 5 ms of work per slice, not the idle deadline: on a busy page (ads) the browser is never
    // idle and the timeout fallback hands over a deadline of 0, which would mask one node a slice.
    const slice = () => {
      const until = performance.now() + 5;
      let node;
      while ((node = walker.nextNode())) {
        maskNode(node);
        if (performance.now() > until) return win.requestIdleCallback(slice, { timeout: 100 });
      }
      if (queue.size) win.requestAnimationFrame(flush); // shadow trees found on the way
    };
    win.requestIdleCallback(slice, { timeout: 500 });
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
