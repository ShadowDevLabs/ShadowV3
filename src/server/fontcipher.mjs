// Font cipher: page text is served as Coptic letters (a->ⲭ, A->Ⲭ, ...). Each web font is re-served
// under its own name with Coptic code points mapped to the real glyphs. People see normal text; scrapers,
// filters and copy/paste get Coptic. Only the character map grows.

import { readFileSync } from "node:fs";

// The web fonts the pages load from Google Fonts, as Google serves them (fonts/<Name>-<weight>.ttf).
// Add a family or weight here and in fonts/ when a page starts loading it.
const FONTS = {
  "Poppins": [100, 200, 300, 400, 500, 600, 700, 800, 900],
  "Roboto": [300, 400, 700],
  "DM Sans": [400, 500],
  "Open Sans": [400],
  "Rubik": [400],
  "Bebas Neue": [400],
};
const fontKey = (family, weight) => `${family.replaceAll(" ", "")}-${weight}`;

/** family -> upright weights, for every Google Fonts family the page (and its CSS) loads that we have. */
export function pageFonts(text) {
  const found = new Map();
  for (const [, name, spec = ""] of text.replaceAll("&amp;", "&").matchAll(/family=([^:&"')\s]+)(?::([^&"')\s]*))?/g)) {
    const family = decodeURIComponent(name.replaceAll("+", " "));
    if (!FONTS[family]) continue;
    const ital = spec.match(/^ital,wght@([\d,;.]+)/);
    const weights = ital ? ital[1].split(";").filter((p) => p.startsWith("0,")).map((p) => +p.slice(2))
      : spec.match(/^wght@([\d;]+)/)?.[1].split(";").map(Number) ?? [400];
    found.set(family, [...new Set([...(found.get(family) ?? []), ...weights.filter((w) => FONTS[family].includes(w))])]);
  }
  return found;
}
const LOWER = "abcdefghijklmnopqrstuvwxyz", DIGITS = "0123456789";
const COPTIC = 0x2c80; // 50 case pairs: U+2C80 Ⲁ / U+2C81 ⲁ, U+2C82 / U+2C83, …

/**
 * Real character -> the Coptic one it's served as. Each letter gets a seeded case pair so
 * text-transform still works; digits too. `random(label)` is 32 bits.
 */
export function cipherTable(random) {
  const pairs = [...Array(50).keys()];
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = random(`pair${i}`) % (i + 1);
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  const table = {};
  [...LOWER, ...DIGITS].forEach((c, i) => {
    const lower = String.fromCodePoint(COPTIC + 2 * pairs[i] + 1);
    table[c] = lower;
    if (LOWER.includes(c)) table[c.toUpperCase()] = lower.toUpperCase();
  });
  return table;
}

/** Code point -> glyph id, from the font's Unicode cmap (format 12 or 4). */
export function readCmap(font, cmap) {
  let best;
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8, platform = font.readUInt16BE(rec), encoding = font.readUInt16BE(rec + 2);
    const sub = cmap + font.readUInt32BE(rec + 4), format = font.readUInt16BE(sub);
    if (format === 12 && (platform === 0 || encoding === 10)) { best = sub; break; } // full Unicode wins
    if (format === 4 && (platform === 0 || (platform === 3 && encoding === 1))) best ??= sub;
  }
  if (best === undefined) throw new Error("font has no Unicode cmap");
  const map = new Map();
  if (font.readUInt16BE(best) === 12) {
    for (let g = 0; g < font.readUInt32BE(best + 12); g++) {
      const o = best + 16 + g * 12, start = font.readUInt32BE(o), gid = font.readUInt32BE(o + 8);
      for (let c = start; c <= font.readUInt32BE(o + 4); c++) map.set(c, gid + c - start);
    }
    return map;
  }
  const segX2 = font.readUInt16BE(best + 6);
  const ends = best + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  for (let s = 0; s < segX2; s += 2) {
    const start = font.readUInt16BE(starts + s), end = font.readUInt16BE(ends + s);
    const delta = font.readUInt16BE(deltas + s), range = font.readUInt16BE(ranges + s);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let gid = range ? font.readUInt16BE(ranges + s + range + (c - start) * 2) : c;
      if (range && gid === 0) continue;
      gid = (gid + delta) & 0xffff;
      if (gid) map.set(c, gid);
    }
  }
  return map;
}

/** A cmap table holding one format-4 subtable, for Unicode and Windows BMP. */
function writeCmap(map) {
  const segments = [];
  for (const c of [...map.keys()].filter((c) => c < 0xffff).sort((a, b) => a - b)) {
    const last = segments.at(-1), gid = map.get(c);
    if (last && c === last.end + 1 && gid - c === last.gid - last.start) last.end = c;
    else segments.push({ start: c, end: c, gid });
  }
  segments.push({ start: 0xffff, end: 0xffff, gid: 0 }); // the required last segment
  const n = segments.length, length = 16 + n * 8;
  if (length > 0xffff) throw new Error("cmap too large for format 4");
  const out = Buffer.alloc(20 + length);
  out.writeUInt16BE(2, 2); // version 0, two encoding records sharing the subtable
  out.writeUInt16BE(0, 4); out.writeUInt16BE(3, 6); out.writeUInt32BE(20, 8);
  out.writeUInt16BE(3, 12); out.writeUInt16BE(1, 14); out.writeUInt32BE(20, 16);
  const sub = out.subarray(20), power = 2 ** Math.floor(Math.log2(n));
  sub.writeUInt16BE(4, 0); sub.writeUInt16BE(length, 2); sub.writeUInt16BE(n * 2, 6);
  sub.writeUInt16BE(power * 2, 8); sub.writeUInt16BE(Math.log2(power), 10); sub.writeUInt16BE((n - power) * 2, 12);
  segments.forEach((s, i) => {
    sub.writeUInt16BE(s.end, 14 + i * 2);
    sub.writeUInt16BE(s.start, 16 + n * 2 + i * 2);
    sub.writeUInt16BE((s.gid - s.start) & 0xffff, 16 + n * 4 + i * 2); // idRangeOffset stays 0
  });
  return out;
}

const checksum = (buf, at, length) => {
  let sum = 0;
  for (let i = at; i < at + length; i += 4) sum = (sum + buf.readUInt32BE(i)) >>> 0;
  return sum;
};

/** The font with `table`'s code points added, drawing the glyphs of the characters they stand for. */
export function cipherFont(font, table) {
  const count = font.readUInt16BE(4), tables = [];
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16, offset = font.readUInt32BE(rec + 8);
    tables.push({ tag: font.toString("latin1", rec, rec + 4), data: font.subarray(offset, offset + font.readUInt32BE(rec + 12)) });
  }
  const cmap = tables.find((t) => t.tag === "cmap");
  const map = readCmap(cmap.data, 0), swapped = new Map(map);
  for (const [real, shown] of Object.entries(table)) {
    const gid = map.get(real.codePointAt(0));
    if (gid === undefined) continue;
    swapped.set(shown.codePointAt(0), gid);
    if (DIGITS.includes(real)) swapped.set(shown.toUpperCase().codePointAt(0), gid);
  }
  cmap.data = writeCmap(swapped);

  const pad = (n) => (n + 3) & ~3;
  const out = Buffer.alloc(tables.reduce((size, t) => size + pad(t.data.length), 12 + count * 16));
  font.copy(out, 0, 0, 12);
  let at = 12 + count * 16, head;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    t.data.copy(out, at);
    if (t.tag === "head") { head = at; out.writeUInt32BE(0, at + 8); } // checkSumAdjustment is set last
    out.write(t.tag, rec, "latin1");
    out.writeUInt32BE(checksum(out, at, pad(t.data.length)), rec + 4);
    out.writeUInt32BE(at, rec + 8);
    out.writeUInt32BE(t.data.length, rec + 12);
    at += pad(t.data.length);
  });
  out.writeUInt32BE((0xb1b0afba - checksum(out, 0, out.length)) >>> 0, head + 8);
  return out;
}

// One HTML token: a comment, an element whose text must stay real (raw text, form options,
// code, SVG) taken whole, a tag, or a run of text.
const htmlToken = /<!--[\s\S]*?-->|<(script|style|textarea|title|select|svg|math|code|pre|kbd|samp|noscript)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</y;

// JSON with every non-ASCII character escaped, so it survives in any page encoding.
const ascii = (value) => JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/**
 * The in-page half. Keeps text in ciphered fonts swapped (including text added later, via
 * MutationObserver) and swaps back text in fonts we don't cipher (monospace, icons, italics).
 */
const client = (encode, decode, families) => `(()=>{
const E=${ascii(encode)},D=${ascii(decode)},F=new Set(${ascii(families)});
const G=/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|emoji|math|fangsong|-apple-system)$|symbols|icons|awesome/;
const S=/^(SCRIPT|STYLE|TEXTAREA|TITLE|OPTION|SELECT|NOSCRIPT|CODE|PRE|KBD|SAMP)$/;
let m=new Map;
const mode=e=>{let r=m.get(e);if(r!==undefined)return r;r=0;
if(!S.test(e.nodeName)&&!e.isContentEditable){const c=getComputedStyle(e);r=-1;
if(c.fontStyle==="normal")for(const n of c.fontFamily.split(",")){const k=n.trim().replace(/^["']|["']$/g,"").toLowerCase();if(F.has(k)){r=1;break}if(G.test(k))break}}
m.set(e,r);return r};
const swap=(t,r)=>r>0?t.replace(/[A-Za-z0-9]/g,c=>E[c]):t.replace(/[\\u2c80-\\u2ce3]/g,c=>D[c]||c);
const text=n=>{const p=n.parentElement,r=p&&mode(p);if(!r)return;const t=n.data,v=swap(t,r);if(v!==t)n.data=v};
const hint=e=>{if(e.nodeName==="INPUT"&&e.hasAttribute("placeholder")&&mode(e)>0){const t=e.getAttribute("placeholder"),v=swap(t,1);if(v!==t)e.setAttribute("placeholder",v)}};
const walk=n=>{if(n.nodeType===3)return text(n);if(n.nodeType!==1)return;hint(n);const w=document.createTreeWalker(n,5);while(w.nextNode()){const x=w.currentNode;x.nodeType===3?text(x):hint(x)}};
new MutationObserver(rs=>{m=new Map;for(const r of rs)r.type==="characterData"?text(r.target):r.type==="attributes"?hint(r.target):r.addedNodes.forEach(walk)})
.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["placeholder"]});
document.addEventListener("DOMContentLoaded",()=>{m=new Map;walk(document.body)});
})()`;

/**
 * Takes `table` from cipherTable. Returns the ciphered fonts (key -> TTF), the client script, and a
 * function that swaps a page's text and adds both, given each font's URL and the page's CSS.
 */
export function createFontCipher(table) {
  const fonts = new Map();
  for (const [family, weights] of Object.entries(FONTS))
    for (const w of weights) {
      const key = fontKey(family, w);
      fonts.set(key, cipherFont(readFileSync(new URL(`./fonts/${key}.ttf`, import.meta.url)), table));
    }
  const decode = {};
  for (const [real, shown] of Object.entries(table)) {
    decode[shown] = real;
    if (DIGITS.includes(real)) decode[shown.toUpperCase()] = real;
  }
  const encode = (text) => text.replace(/&#?\w+;|[A-Za-z0-9]/g, (m) => table[m] ?? m); // entities stay as they are

  const render = (html, fontUrl, css = "") => {
    const loaded = pageFonts(html + css);
    if (!loaded.size) return html; // no text on this page is drawn in a font we cipher
    let out = "";
    htmlToken.lastIndex = 0;
    for (let m; (m = htmlToken.exec(html)); ) out += m[0][0] === "<" ? m[0] : encode(m[0]);
    // Declared after the page's Google Fonts with the same names and weights, so these win.
    const faces = [...loaded].flatMap(([family, weights]) => weights.map((w) =>
      `@font-face{font-family:"${family}";src:url(${fontUrl(fontKey(family, w))}) format("truetype");font-weight:${w};font-display:block}`)).join("");
    const head = `<style>${faces}</style><script>${client(table, decode, [...loaded.keys()].map((f) => f.toLowerCase()))}</script>`;
    return /<\/head>/i.test(out) ? out.replace(/<\/head>/i, () => head + "</head>") : head + out;
  };
  return { fonts, encode, render };
}
