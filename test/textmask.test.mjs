import test from "node:test";
import assert from "node:assert/strict";
import { MASK_TABLE, cssString, maskString } from "../public/assets/js/textmask.js";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

test("all ASCII letters and digits map to distinct PUA characters and mask only once", () => {
  const alphabet = maskString(ALNUM);
  assert.match(alphabet, /^[\uE000-\uF8FF]{62}$/u);
  assert.equal(new Set(alphabet).size, ALNUM.length);
  const decode = Object.fromEntries(Object.entries(MASK_TABLE).map(([real, masked]) => [masked, real]));
  const text = "Play Minecraft 42 — Café, cafe\u0301, Ελληνικά & 🎮!";
  const masked = maskString(text);
  assert.equal(masked.replace(/[\uE000-\uF8FF]/gu, (c) => decode[c]), text);
  assert.ok(masked.includes("é") && masked.includes("e\u0301") && masked.includes("Ελληνικά"));
  assert.equal(maskString(masked), masked);
});

test("CSS display strings escape text that could be read as CSS syntax", () => {
  assert.equal(cssString('A"\\\n5;}'), '"\\41 \\22 \\5c \\a \\35 ;}"');
});
