// Page tools for the browser shell: reader mode, translate, screenshot / clip,
// media controls (picture-in-picture, save video), forced dark mode, and the
// right-click menu for proxied pages. tabs.js wires the shortcuts and hooks;
// everything here works on the active tab's document, which is same-origin
// with the shell because every proxied page is served from Shadow's origin.
import { showMenu, toast, dialog, h } from "/assets/js/ui.js";
import { filenameFor } from "/assets/js/downloads.js";

const activeTab = (tabs) => tabs.tabsArr[tabs.activeTabIndex];

function docOf(tab) {
  try {
    return tab?.iframe.contentDocument ?? null;
  } catch {
    return null;
  }
}

/** Every document in a tab we can reach: the page and its same-origin subframes. */
function* documentsIn(win, depth = 0) {
  let doc;
  try {
    doc = win.document;
  } catch {
    return;
  }
  if (!doc) return;
  yield { win, doc, depth };
  if (depth > 4) return;
  for (let i = 0; i < win.frames.length; i++) yield* documentsIn(win.frames[i], depth + 1);
}

/** A URL the shell can load for something inside a proxied tab (image, favicon…). */
function loadableUrl(tabs, tab, value) {
  if (!value) return "";
  try {
    const url = new URL(value, tab.iframe.contentWindow.location.href);
    if (url.protocol === "data:" || url.protocol === "blob:") return url.href;
    if (url.origin === location.origin && tab.frame && url.pathname.startsWith(tab.frame.prefix)) return url.href; // already proxied
    if (!/^https?:$/.test(url.protocol) || !tab.frame) return "";
    return $scramjet.rewriteUrl(url.href, tab.frame.context, { origin: new URL(location.href), base: new URL(location.href) });
  } catch {
    return "";
  }
}

// ================================================================= reader mode

const READER_SKIP = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "NAV", "ASIDE", "FOOTER", "FORM", "BUTTON", "INPUT", "SELECT", "TEXTAREA",
  "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "LINK", "META", "TEMPLATE", "DIALOG", "AUDIO", "VIDEO",
]);
const READER_KEEP = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "A", "IMG", "FIGURE", "FIGCAPTION", "BLOCKQUOTE", "UL", "OL", "LI",
  "PRE", "CODE", "EM", "STRONG", "B", "I", "U", "S", "BR", "HR", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH",
  "SUP", "SUB", "MARK", "SMALL", "DL", "DT", "DD", "TIME", "CITE", "Q", "ABBR",
]);
const READER_JUNK = /(^|[\s_-])(comments?|share|sharing|social|promo|advert|ads?|sidebar|related|newsletter|cookie|banner|popup|modal|breadcrumbs?|pagination|toolbar|menu)([\s_-]|$)/i;

/** Readability-style pick: the element whose paragraphs carry the most text. */
function pickArticle(doc) {
  const scores = new Map();
  const add = (el, points) => el && el !== doc.documentElement && scores.set(el, (scores.get(el) ?? 0) + points);
  for (const p of doc.querySelectorAll("p, pre, blockquote, li")) {
    const text = p.textContent.trim();
    if (text.length < 40) continue;
    if (p.closest("nav, aside, footer, form, header nav")) continue;
    const points = 1 + Math.min(text.length / 100, 4) + (text.match(/[,，、]/g)?.length ?? 0) * 0.3;
    add(p.parentElement, points);
    add(p.parentElement?.parentElement, points / 2);
    add(p.parentElement?.parentElement?.parentElement, points / 4);
  }
  let best = null;
  let bestScore = 0;
  for (const [el, raw] of scores) {
    const text = el.textContent.length || 1;
    let linkText = 0;
    for (const a of el.querySelectorAll("a")) linkText += a.textContent.length;
    let score = raw * (1 - Math.min(linkText / text, 1));
    if (/^(ARTICLE|MAIN)$/.test(el.tagName) || el.getAttribute("role") === "main") score *= 1.4;
    if (READER_JUNK.test(`${el.className} ${el.id}`)) score *= 0.3;
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return bestScore >= 6 ? best : (doc.querySelector("article, main, [role=main]") ?? null);
}

/** Copies the readable parts of `source` into `target` (in the reader document). */
function copyReadable(tabs, tab, source, target, out) {
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue) target.append(out.createTextNode(node.nodeValue));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toUpperCase();
    if (READER_SKIP.has(tag)) continue;
    if (node.hidden || node.getAttribute("aria-hidden") === "true") continue;
    if (tag !== "ARTICLE" && READER_JUNK.test(`${typeof node.className === "string" ? node.className : ""} ${node.id}`)) continue;

    if (tag === "IMG") {
      const real = node.currentSrc || node.src || node.getAttribute("data-src") || "";
      const src = loadableUrl(tabs, tab, real);
      const width = Number(node.getAttribute("width")) || node.naturalWidth || 0;
      if (!src || (width && width < 60)) continue; // tracking pixels, icons
      const img = out.createElement("img");
      img.src = src;
      img.alt = node.alt || "";
      img.loading = "lazy";
      target.append(img);
      continue;
    }
    if (tag === "PICTURE") {
      copyReadable(tabs, tab, node, target, out);
      continue;
    }
    if (!READER_KEEP.has(tag)) {
      // Unknown wrappers (div, section, span…): keep their content, drop the box.
      const block = /^(DIV|SECTION|ARTICLE|MAIN|HEADER)$/.test(tag);
      const holder = block ? out.createElement("div") : target;
      copyReadable(tabs, tab, node, holder, out);
      if (block && holder.childNodes.length) target.append(holder);
      continue;
    }
    const el = out.createElement(tag.toLowerCase());
    if (tag === "A") {
      let href = "";
      try {
        href = node.href; // the page's own getter hands back the real URL
      } catch {}
      if (/^https?:/i.test(href)) {
        el.setAttribute("href", href);
        el.setAttribute("rel", "noreferrer");
      }
    }
    if ((tag === "TD" || tag === "TH") && node.colSpan > 1) el.colSpan = node.colSpan;
    copyReadable(tabs, tab, node, el, out);
    if (el.childNodes.length || tag === "BR" || tag === "HR") target.append(el);
  }
}

const READER_CSS = `
:host { display: block; flex: 1 1 0; min-height: 0; }
.scroll { height: 100%; overflow-y: auto; background: var(--bg); color: var(--fg); color-scheme: light;
  --bg:#fbfaf7; --fg:#1d1d1f; --muted:#6b6b70; --link:#1a5fb4; --rule:#e2e0da; }
.scroll.dark { color-scheme: dark; --bg:#16171b; --fg:#e6e6ea; --muted:#9a9aa3; --link:#8ab4f8; --rule:#2c2d33; }
.scroll.sepia { --bg:#f4ecd8; --fg:#433422; --muted:#7a6a55; --link:#8a4b12; --rule:#dccfb4; }
.page { margin: 0 auto; padding: 48px 24px 96px; max-width: 46rem; text-align: left;
  font: var(--size, 19px)/1.7 Georgia, "Iowan Old Style", "Times New Roman", serif; overflow-wrap: break-word; }
.page.sans { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 0.5em; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.reader-title { font-size: 2em; margin-top: 0; }
.reader-source { color: var(--muted); font: 14px system-ui, sans-serif; margin-bottom: 2.5em; }
a { color: var(--link); text-underline-offset: 2px; }
img { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 1.2em auto; }
figure { margin: 1.5em 0; } figcaption { color: var(--muted); font-size: 0.8em; text-align: center; }
blockquote { margin: 1.2em 0; padding: 0 1.2em; border-left: 3px solid var(--rule); color: var(--muted); }
pre { overflow: auto; padding: 14px; background: color-mix(in srgb, var(--fg) 7%, transparent); border-radius: 8px; font-size: 0.8em; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
table { border-collapse: collapse; width: 100%; font-size: 0.85em; } td, th { border: 1px solid var(--rule); padding: 6px 10px; text-align: left; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2em 0; }
`;

let readerEl = null;
let readerTab = null;

export function readerIsOpen() {
  return !!readerEl;
}

export function closeReader() {
  readerEl?.remove();
  readerEl = null;
  readerTab = null;
}

export async function toggleReader(tabs) {
  if (readerEl) return closeReader();
  const tab = activeTab(tabs);
  const doc = docOf(tab);
  if (!doc?.body) return toast("There's nothing to read on this page yet.", { timeout: 2500 });
  const article = pickArticle(doc);
  if (!article) return toast("Reader mode couldn't find an article on this page.", { timeout: 3000 });

  const prefs = (await tabs.settings.get("reader")) ?? {};
  const state = { theme: prefs.theme ?? "auto", size: prefs.size ?? 19, sans: !!prefs.sans };

  // The article is rebuilt inside a shadow root in the shell: its styles are
  // isolated from the shell's, and its (proxied) images load like the tab icons
  // do. Nothing from the page is parsed as HTML here — copyReadable() creates
  // every element itself from a whitelist — so nothing of the page's can run.
  const host = h("div", { class: "reader-host", tabIndex: -1 });
  const root = host.attachShadow({ mode: "open" });
  const scroll = h("div", { class: "scroll" });
  const page = h("div", { class: "page" });
  scroll.append(page);
  root.append(h("style", {}, READER_CSS), scroll);

  const savePrefs = () => tabs.settings.set("reader", state);
  const apply = () => {
    const dark = state.theme === "dark" || (state.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    scroll.className = `scroll${state.theme === "sepia" ? " sepia" : dark ? " dark" : ""}`;
    page.style.setProperty("--size", `${state.size}px`);
    page.classList.toggle("sans", state.sans);
  };
  const button = (label, title, run) =>
    h("button", { type: "button", title, onclick: () => (run(), apply(), savePrefs()) }, label);

  readerEl = h(
    "div",
    { id: "reader-view" },
    h(
      "div",
      { class: "reader-bar" },
      h("strong", {}, "Reader"),
      h("span", { class: "reader-spacer" }),
      button("A−", "Smaller text", () => (state.size = Math.max(14, state.size - 1))),
      button("A+", "Larger text", () => (state.size = Math.min(30, state.size + 1))),
      button("Aa", "Serif / sans-serif", () => (state.sans = !state.sans)),
      button("◐", "Light / sepia / dark", () => {
        const order = ["auto", "light", "sepia", "dark"];
        state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
        toast(`Reader theme: ${state.theme}`, { timeout: 900 });
      }),
      h("button", { type: "button", title: "Close reader (Esc)", onclick: closeReader }, "✕"),
    ),
    host,
  );
  readerTab = tab;

  const title = doc.querySelector("h1")?.textContent.trim() || doc.title || tabs.titleFor(tab);
  const url = tabs.currentUrl(tab);
  let hostName = "";
  try {
    hostName = new URL(url).hostname;
  } catch {}
  const words = article.textContent.trim().split(/\s+/).length;
  const content = document.createElement("div");
  copyReadable(tabs, tab, article, content, document);
  // The page's own <h1> usually repeats the title we just printed.
  const first = content.querySelector("h1");
  if (first && first.textContent.trim() === title) first.remove();
  page.append(
    h("h1", { class: "reader-title" }, title),
    h("div", { class: "reader-source" }, `${hostName}${hostName ? " · " : ""}${Math.max(1, Math.round(words / 230))} min read`),
    content,
  );
  apply();
  document.getElementById("iframes-container").append(readerEl);

  root.addEventListener("click", (e) => {
    const link = e.target.closest?.("a[href]");
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute("href");
    closeReader();
    if (e.ctrlKey || e.metaKey || e.shiftKey) tabs.createTab(href);
    else tabs.load(href);
  });
  readerEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeReader();
    }
  });
  host.focus();
}

/** tabs.js calls this when a tab navigates, closes or loses focus. */
export function readerTabChanged(tab) {
  if (readerEl && (!tab || tab === readerTab)) closeReader();
}

// ================================================================= translate

const LANGUAGES = [
  ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"],
  ["nl", "Dutch"], ["pl", "Polish"], ["ru", "Russian"], ["uk", "Ukrainian"], ["tr", "Turkish"], ["ar", "Arabic"],
  ["he", "Hebrew"], ["hi", "Hindi"], ["bn", "Bengali"], ["ur", "Urdu"], ["id", "Indonesian"], ["vi", "Vietnamese"],
  ["th", "Thai"], ["zh-CN", "Chinese (Simplified)"], ["zh-TW", "Chinese (Traditional)"], ["ja", "Japanese"],
  ["ko", "Korean"], ["tl", "Filipino"], ["sw", "Swahili"], ["el", "Greek"], ["sv", "Swedish"], ["ro", "Romanian"],
];

export async function translatePage(tabs, { ask = false } = {}) {
  const tab = activeTab(tabs);
  const url = tab ? tabs.currentUrl(tab) : "";
  if (!/^https?:/i.test(url)) return toast("Only websites can be translated.", { timeout: 2500 });
  // Already a translated copy: go back to the original.
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "translate.google.com" && parsed.searchParams.get("u")) return tabs.load(parsed.searchParams.get("u"));
    if (parsed.hostname.endsWith(".translate.goog")) {
      const host = parsed.hostname.slice(0, -".translate.goog".length).replace(/--/g, "\u0000").replace(/-/g, ".").replace(/\u0000/g, "-");
      for (const key of [...parsed.searchParams.keys()]) if (key.startsWith("_x_tr_")) parsed.searchParams.delete(key);
      return tabs.load(`https://${host}${parsed.pathname}${parsed.search}${parsed.hash}`);
    }
  } catch {}

  let lang = await tabs.settings.get("translate-lang");
  if (!lang || ask) {
    const guess = navigator.language?.split("-")[0] || "en";
    const result = await dialog({
      title: "Translate this page",
      message: "The page is reloaded through Google Translate. Run Translate again to go back to the original.",
      confirm: "Translate",
      fields: [
        {
          name: "lang",
          label: "Translate to",
          value: lang || (LANGUAGES.some(([code]) => code === guess) ? guess : "en"),
          options: LANGUAGES.map(([value, label]) => ({ value, label })),
        },
      ],
    });
    if (!result) return;
    lang = result.lang;
    tabs.settings.set("translate-lang", lang);
  }
  tabs.load(`https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(lang)}&u=${encodeURIComponent(url)}`);
}

// ================================================================= screenshot

async function grabFrame() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("This browser can't capture the screen.");
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser" },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
  });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // The first frame can still show the share prompt fading out.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return canvas;
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

function cropCanvas(source, x, y, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  canvas.getContext("2d").drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const canvasBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

/**
 * Captures the active tab's page. The browser asks which surface to share; the
 * capture is the whole Shadow window, which is cropped down to the page here.
 * Then a clip overlay lets the user keep everything or drag out a region.
 */
export async function screenshot(tabs) {
  const tab = activeTab(tabs);
  if (!tab) return;
  tabs.dismissOverlays();
  let full;
  try {
    full = await grabFrame();
  } catch (e) {
    if (e?.name === "NotAllowedError") return toast("Screenshot cancelled.", { timeout: 2000 });
    console.error("[screenshot]", e);
    return toast(`Couldn't take a screenshot: ${e?.message ?? e}`, { timeout: 4000 });
  }
  // The capture is the whole viewport; scale from CSS pixels to captured pixels.
  const rect = tab.iframe.getBoundingClientRect();
  const sx = full.width / window.innerWidth;
  const sy = full.height / window.innerHeight;
  const page = cropCanvas(full, rect.left * sx, rect.top * sy, rect.width * sx, rect.height * sy);
  const base = filenameFor(tabs.currentUrl(tab), "", tabs.titleFor(tab)).replace(/\.[a-z0-9]{1,8}$/i, "") || "screenshot";
  showClipOverlay(tabs, page, `${base}.png`);
}

function showClipOverlay(tabs, canvas, name) {
  const overlay = h("div", { id: "clip-overlay" });
  const stage = h("div", { class: "clip-stage" });
  canvas.className = "clip-image";
  const selection = h("div", { class: "clip-selection", hidden: true });
  stage.append(canvas, selection);
  let region = null; // in canvas pixels

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const result = () => (region ? cropCanvas(canvas, region.x, region.y, region.w, region.h) : canvas);
  const save = async () => {
    const blob = await canvasBlob(result());
    close();
    tabs.downloads.fromBlob(blob, name, "");
  };
  const copy = async () => {
    try {
      const blob = await canvasBlob(result());
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Screenshot copied.", { timeout: 1500 });
      close();
    } catch (e) {
      toast("Couldn't copy the image — save it instead.", { timeout: 3000 });
    }
  };
  const hint = h("span", { class: "clip-hint" }, "Drag to clip a region, or save the whole page.");
  const bar = h(
    "div",
    { class: "clip-bar" },
    hint,
    h("button", { type: "button", onclick: copy }, "Copy"),
    h("button", { type: "button", class: "primary", onclick: save }, "Save"),
    h("button", { type: "button", onclick: close }, "Cancel"),
  );
  overlay.append(bar, stage);

  let start = null;
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(r.width, e.clientX - r.left)),
      y: Math.max(0, Math.min(r.height, e.clientY - r.top)),
      r,
    };
  };
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    start = point(e);
    stage.setPointerCapture(e.pointerId);
    selection.hidden = true;
    region = null;
    e.preventDefault();
  });
  stage.addEventListener("pointermove", (e) => {
    if (!start) return;
    const now = point(e);
    const x = Math.min(start.x, now.x);
    const y = Math.min(start.y, now.y);
    const w = Math.abs(now.x - start.x);
    const hgt = Math.abs(now.y - start.y);
    Object.assign(selection.style, { left: `${canvas.offsetLeft + x}px`, top: `${canvas.offsetTop + y}px`, width: `${w}px`, height: `${hgt}px` });
    selection.hidden = w < 4 || hgt < 4;
    const scale = canvas.width / now.r.width;
    region = selection.hidden ? null : { x: x * scale, y: y * scale, w: w * scale, h: hgt * scale };
    hint.textContent = region ? `${Math.round(region.w)} × ${Math.round(region.h)} px selected` : "Drag to clip a region, or save the whole page.";
  });
  stage.addEventListener("pointerup", () => (start = null));

  function onKey(e) {
    e.stopPropagation();
    if (e.key === "Escape") close();
    else if (e.key === "Enter") save();
  }
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
}

// ================================================================= media

/** The video the user most likely means: one that's playing, else the biggest. */
export function findVideo(tabs, tab = activeTab(tabs)) {
  let best = null;
  let bestScore = -1;
  let win;
  try {
    win = tab?.iframe.contentWindow;
  } catch {}
  if (!win) return null;
  for (const { doc, win: owner } of documentsIn(win)) {
    for (const video of doc.querySelectorAll("video")) {
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (!area && !video.currentSrc) continue;
      const score = area + (!video.paused && !video.ended ? 1e9 : 0);
      if (score > bestScore) {
        best = { video, doc, win: owner };
        bestScore = score;
      }
    }
  }
  return best;
}

export async function togglePictureInPicture(tabs) {
  const found = findVideo(tabs);
  if (!found) return toast("No video on this page.", { timeout: 2000 });
  const { video, doc } = found;
  try {
    if (doc.pictureInPictureElement) return await doc.exitPictureInPicture();
    if (!doc.pictureInPictureEnabled && !document.pictureInPictureEnabled) throw new Error("not supported here");
    video.disablePictureInPicture = false; // sites often switch it off
    video.removeAttribute("disablepictureinpicture");
    await video.requestPictureInPicture();
  } catch (e) {
    console.debug("[pip]", e);
    toast(`Picture-in-picture isn't available for this video (${e?.message ?? e}).`, { timeout: 3500 });
  }
}

export function videoSource(video) {
  // .src goes through the page's own getter (the real URL); currentSrc is the
  // proxied address, kept as a fallback since it can still be fetched from here.
  const candidates = [video.src, ...[...video.querySelectorAll("source")].map((s) => s.src), video.currentSrc];
  return candidates.find((src) => src && !/^blob:|^mediasource:/i.test(src)) ?? "";
}

export function downloadVideo(tabs) {
  const found = findVideo(tabs);
  if (!found) return toast("No video on this page.", { timeout: 2000 });
  const src = videoSource(found.video);
  if (!src) {
    return toast("This video is streamed in chunks, so there's no single file to save.", { timeout: 4000 });
  }
  toast("Downloading video…", { timeout: 1500 });
  tabs.downloads.start({ url: src, win: found.win, name: "" });
}

// ================================================================= dark mode

const DARK_ID = "__shadow-dark";
const INVERT = "invert(1) hue-rotate(180deg)";
const DARK_MEDIA = `img, picture, video, canvas, embed, object, svg image, [style*="background-image"] { filter: ${INVERT} !important; }
picture img, a > picture { filter: none !important; }`;
const DARK_TOP = `:where(html) { background-color: #fff; }
html { filter: ${INVERT} !important; color-scheme: light !important; }
${DARK_MEDIA}`;

function luminance(color) {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
  if (a < 0.5) return null; // effectively transparent
  const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** True when the page already paints itself dark, so inverting would make it light. */
function alreadyDark(win) {
  try {
    const doc = win.document;
    for (const el of [doc.body, doc.documentElement]) {
      if (!el) continue;
      const lum = luminance(win.getComputedStyle(el).backgroundColor);
      if (lum !== null) return lum < 0.2;
    }
  } catch {}
  return false; // no background set anywhere: the canvas is white
}

/** Adds or removes the dark stylesheet in one document. */
export function setDarkMode(win, isTop, enabled) {
  let doc;
  try {
    doc = win.document;
  } catch {
    return;
  }
  if (!doc?.documentElement) return;
  const existing = doc.getElementById(DARK_ID);
  if (!enabled || (isTop && alreadyDark(win))) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = doc.createElement("style");
  style.id = DARK_ID;
  style.textContent = isTop ? DARK_TOP : DARK_MEDIA;
  (doc.head ?? doc.documentElement).append(style);
}

/** Re-evaluates every document of a tab (used when the toggle or site rule changes). */
export function refreshTabDarkMode(tabs, tab) {
  let win;
  try {
    win = tab.iframe.contentWindow;
  } catch {}
  if (!win) return;
  const enabled = tabs.isProxied(tab) && tabs.darkModeFor(tab);
  let topDark = false;
  for (const { win: frame, depth } of documentsIn(win)) {
    if (depth === 0) {
      setDarkMode(frame, true, enabled);
      topDark = !!frame.document.getElementById(DARK_ID);
    } else {
      // Subframes are inverted by the top document's filter; they only need
      // their media flipped back — and only if the top really was inverted.
      setDarkMode(frame, false, topDark);
    }
  }
}

// ================================================================= page menu

function translateToShell(win, x, y) {
  try {
    let current = win;
    while (current && current.frameElement) {
      const rect = current.frameElement.getBoundingClientRect();
      x += rect.left;
      y += rect.top;
      current = current.parent === current ? null : current.parent;
    }
  } catch {}
  return { x, y };
}

/**
 * Right-click menu for a proxied page. Shift+right-click (or right-clicking
 * twice) falls through to the browser's own menu.
 *
 * @param extensionItems entries Sapphire collected for this click, already in
 *   showMenu() shape (see ExtensionUI.menuItems()).
 */
export function showPageMenu(tabs, tab, win, event, extensionItems = []) {
  const target = event.target;
  const doc = win.document;
  const link = target?.closest?.("a[href]");
  let linkUrl = "";
  try {
    linkUrl = link ? link.href : "";
  } catch {}
  if (!/^https?:/i.test(linkUrl)) linkUrl = "";

  const tag = target?.tagName?.toLowerCase();
  const image = tag === "img" ? target : null;
  const media = tag === "video" || tag === "audio" ? target : null;
  let imageUrl = "";
  try {
    imageUrl = image ? image.currentSrc || image.src : "";
  } catch {}
  const selection = (win.getSelection?.()?.toString() ?? "").trim();
  const editable = !!target && (target.isContentEditable || tag === "input" || tag === "textarea");
  const index = () => tabs.tabsArr.indexOf(tab);
  const copy = (text, what) =>
    navigator.clipboard.writeText(text).then(
      () => toast(`${what} copied.`, { timeout: 1200 }),
      () => toast("Couldn't reach the clipboard.", { timeout: 2000 }),
    );
  const exec = (command) => {
    try {
      win.focus();
      doc.execCommand(command);
    } catch {}
  };

  const items = [];
  if (linkUrl) {
    items.push(
      { label: "Open link in new tab", onclick: () => tabs.createTab(linkUrl, undefined, { active: false, index: index() + 1, private: tab.private }) },
      { label: "Open link in private tab", onclick: () => tabs.createTab(linkUrl, undefined, { index: index() + 1, private: true }) },
      { label: "Open link in split view", onclick: () => tabs.openInSplit(linkUrl) },
      { label: "Copy link address", onclick: () => copy(linkUrl, "Link") },
      { label: "Save link as…", onclick: () => tabs.downloads.start({ url: linkUrl, win, name: link.getAttribute("download") || "" }) },
      { separator: true },
    );
  }
  if (image && imageUrl) {
    items.push(
      { label: "Open image in new tab", onclick: () => tabs.createTab(imageUrl, undefined, { index: index() + 1, private: tab.private }) },
      { label: "Save image as…", onclick: () => tabs.downloads.start({ url: imageUrl, win, name: "" }) },
      { label: "Copy image address", onclick: () => copy(imageUrl, "Image address") },
      { separator: true },
    );
  }
  if (media) {
    const src = videoSource(media);
    items.push(
      { label: media.paused ? "Play" : "Pause", onclick: () => (media.paused ? media.play() : media.pause()) },
      { label: media.muted ? "Unmute" : "Mute", onclick: () => (media.muted = !media.muted) },
      { label: media.loop ? "Stop looping" : "Loop", onclick: () => (media.loop = !media.loop) },
    );
    if (tag === "video") {
      items.push({
        label: "Picture in picture",
        onclick: () => {
          media.disablePictureInPicture = false;
          media.requestPictureInPicture?.().catch((e) => toast(`Picture-in-picture failed (${e.message}).`, { timeout: 3000 }));
        },
      });
    }
    items.push(
      { label: `Save ${tag} as…`, disabled: !src, onclick: () => tabs.downloads.start({ url: src, win, name: "" }) },
      { separator: true },
    );
  }
  if (selection) {
    const short = selection.length > 24 ? `${selection.slice(0, 24)}…` : selection;
    items.push(
      { label: "Copy", onclick: () => copy(selection, "Selection") },
      { label: `Search for “${short}”`, onclick: () => tabs.createTab(selection, undefined, { index: index() + 1, private: tab.private }) },
      { separator: true },
    );
  }
  if (editable) {
    items.push(
      { label: "Cut", onclick: () => exec("cut") },
      ...(selection ? [] : [{ label: "Copy", onclick: () => exec("copy") }]),
      {
        label: "Paste",
        onclick: async () => {
          try {
            const text = await navigator.clipboard.readText();
            win.focus();
            target.focus();
            if (!doc.execCommand("insertText", false, text) && "value" in target) target.value += text;
          } catch {
            toast("Allow clipboard access to paste from here, or press Ctrl+V.", { timeout: 3000 });
          }
        },
      },
      { label: "Select all", onclick: () => exec("selectAll") },
      { separator: true },
    );
  }
  if (!linkUrl && !image && !media && !selection && !editable) {
    items.push(
      { label: "Back", onclick: () => tabs.backward(index()) },
      { label: "Forward", onclick: () => tabs.forward(index()) },
      { label: "Reload", onclick: () => tabs.refresh(index()) },
      { separator: true },
      { label: "Bookmark this page", onclick: () => window.bookmarksManager?.toggleCurrent() },
      { label: "Save page as…", onclick: () => savePage(tabs, tab) },
      { label: "Reader mode", onclick: () => toggleReader(tabs) },
      { label: "Translate page", onclick: () => translatePage(tabs, { ask: true }) },
      { label: "Take screenshot", onclick: () => screenshot(tabs) },
      { separator: true },
    );
  }
  if (extensionItems.length) items.push(...extensionItems, { separator: true });
  items.push(
    { label: "Copy page address", onclick: () => copy(tabs.currentUrl(tab), "Address") },
    { label: "Inspect (devtools)", onclick: () => tabs.toggleDevTools(index()) },
  );

  const { x, y } = translateToShell(win, event.clientX, event.clientY);
  showMenu(x, y, items);
}

/** Saves the page's HTML as the site sent it (fetched again, not the rewritten DOM). */
export function savePage(tabs, tab = activeTab(tabs)) {
  const url = tab ? tabs.currentUrl(tab) : "";
  if (!/^https?:/i.test(url)) return toast("Only websites can be saved.", { timeout: 2500 });
  const name = filenameFor(url, "text/html", tabs.titleFor(tab));
  tabs.downloads.start({ url, win: tab.iframe.contentWindow, name });
}

/** Main menu → Page tools. */
export function toolsMenuItems(tabs) {
  const tab = activeTab(tabs);
  const web = !!tab && /^https?:/i.test(tabs.currentUrl(tab) ?? "");
  const video = web ? findVideo(tabs) : null;
  return [
    { label: "Find in page", shortcut: "Alt+F", onclick: () => tabs.openFind() },
    { label: "Reader mode", shortcut: "Alt+Shift+R", checked: readerIsOpen(), onclick: () => toggleReader(tabs) },
    { label: "Translate page…", disabled: !web, onclick: () => translatePage(tabs, { ask: true }) },
    { label: "Take screenshot", shortcut: "Alt+Shift+S", onclick: () => screenshot(tabs) },
    { label: "Save page as…", disabled: !web, onclick: () => savePage(tabs) },
    { separator: true },
    { label: "Picture in picture", disabled: !video, onclick: () => togglePictureInPicture(tabs) },
    { label: "Download this video", disabled: !video, onclick: () => downloadVideo(tabs) },
    { separator: true },
    { label: "Dark mode for every site", checked: !!tabs.forceDark, onclick: () => tabs.setForceDark(!tabs.forceDark) },
    { label: "Site settings…", disabled: !web, onclick: () => tabs.showSitePanel() },
  ];
}
