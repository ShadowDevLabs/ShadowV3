import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cipherTable, cipherFont, readCmap, createFontCipher, pageFonts } from "../src/server/fontcipher.mjs";

const random = (label) => [...label].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 7);
const cmapOf = (font) => {
  for (let i = 0; i < font.readUInt16BE(4); i++)
    if (font.toString("latin1", 12 + i * 16, 16 + i * 16) === "cmap") return readCmap(font, font.readUInt32BE(20 + i * 16));
};
const ALNUM = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];

test("every letter and digit becomes its own Coptic letter, with case kept", () => {
  const table = cipherTable(random);
  assert.equal(new Set(ALNUM.map((c) => table[c])).size, ALNUM.length);
  for (const c of ALNUM) assert.match(table[c], /^[Ⲁ-ⳣ]$/);
  for (const c of "abcdefghijklmnopqrstuvwxyz") {
    assert.equal(table[c.toUpperCase()], table[c].toUpperCase(), "uppercasing served text uppercases the real letter");
    assert.equal(table[c].toLowerCase(), table[c]);
  }
  assert.notDeepEqual(cipherTable((l) => random(l + "x")), table, "another seed, another table");
});

test("the ciphered font keeps every original character and draws each Coptic one as its real letter", () => {
  const table = cipherTable(random);
  const original = readFileSync(new URL("../src/server/fonts/Poppins-400.ttf", import.meta.url));
  const before = cmapOf(original), after = cmapOf(cipherFont(original, table));
  for (const [code, gid] of before) assert.equal(after.get(code), gid);
  for (const [real, shown] of Object.entries(table)) {
    assert.equal(after.get(shown.codePointAt(0)), before.get(real.codePointAt(0)), real);
    if (/\d/.test(real)) assert.equal(after.get(shown.toUpperCase().codePointAt(0)), before.get(real.codePointAt(0)), "uppercased digit");
  }
  assert.equal(after.size, before.size + 26 * 2 + 10 * 2);
});

test("pages get Coptic text, fonts under their own names and the in-page script; code and forms stay", () => {
  const table = cipherTable(random);
  const back = Object.fromEntries(Object.entries(table).map(([a, b]) => [b, a]));
  const { render } = createFontCipher(table);
  const page = '<html><head><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600"><title>Proxy</title></head>' +
    '<body><p onclick="x>1">Unblocked proxy &amp; games 42</p><script>let proxy = "proxy";</script>' +
    "<select><option>proxy</option></select><code>proxy</code></body></html>";
  const out = render(page, (key) => `/f/${key}.ttf`);
  const text = out.match(/<p onclick="x>1">(.*?)<\/p>/)[1];
  assert.ok(!/[A-Za-z0-9]/.test(text.replace("&amp;", "")), "no Latin letters or digits left in the text");
  assert.equal(text.replace(/[Ⲁ-ⳣ]/g, (c) => back[c]), "Unblocked proxy &amp; games 42");
  assert.ok(out.includes('<script>let proxy = "proxy";</script><select><option>proxy</option></select><code>proxy</code>'));
  assert.ok(out.includes('@font-face{font-family:"Poppins";src:url(/f/Poppins-400.ttf)') && out.includes("url(/f/Poppins-600.ttf)"));
  assert.ok(!out.includes("Poppins-500"), "only the weights the page loads");
  const script = out.match(/<\/style><script>([\s\S]*?)<\/script><\/head>/)[1];
  assert.ok(!/[^\x20-\x7e\n]/.test(script), "the script is plain ASCII");
  new Function(script); // parses
  assert.equal(render("<p>proxy</p>", () => ""), "<p>proxy</p>", "pages that load no font we cipher are left alone");
});

test("a page's fonts are read from its links and its stylesheets' imports", () => {
  const fonts = (text) => Object.fromEntries(pageFonts(text));
  assert.deepEqual(fonts("css2?family=Poppins:wght@300;400;600&display=swap"), { Poppins: [300, 400, 600] });
  assert.deepEqual(fonts("css2?family=Poppins:ital,wght@0,100;0,900;1,100"), { Poppins: [100, 900] }, "upright weights only");
  assert.deepEqual(fonts("css2?family=Poppins&display=swap"), { Poppins: [400] });
  assert.deepEqual(fonts("css2?family=Roboto:wght@300&amp;family=Open+Sans&amp;family=Material+Symbols+Outlined:opsz@48"),
    { Roboto: [300], "Open Sans": [400] }, "every family we cipher, none we don't");
  assert.deepEqual(fonts('@import url("https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600");'),
    { "Bebas Neue": [400], "DM Sans": [400, 500] });
});
