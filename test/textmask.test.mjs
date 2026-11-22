import test from "node:test";
import assert from "node:assert/strict";
import { maskString } from "../public/assets/js/textmask.js";

// What a reader sees: each look-alike reads as its Latin letter.
const CYRILLIC = "асеіјорѕхуАВСЕНІЈКМОРЅТХ";
const LATIN = "aceijopsxyABCEHIJKMOPSTX";
const asSeen = (s) => s.replace(/./gu, (c) => (CYRILLIC.includes(c) ? LATIN[CYRILLIC.indexOf(c)] : c));

test("masked text reads the same, contains no keyword, and masking twice changes nothing", () => {
  const text = "Play Minecraft free — 100% unblocked games, SPORTS & casino!";
  const masked = maskString(text);
  assert.equal(asSeen(masked), text);
  for (const word of ["minecraft", "games", "casino", "unblocked", "sports", "play", "free"]) {
    assert.ok(!masked.toLowerCase().includes(word), `"${word}" is still findable`);
  }
  assert.equal(maskString(masked), masked, "idempotent, so the page observer never loops on its own writes");
  assert.equal(maskString("100% — !"), "100% — !", "text without letters is left alone");
  assert.equal(maskString("fun hunt"), "fun hunt", "words with no look-alike letter stay readable (a known limit)");
});
