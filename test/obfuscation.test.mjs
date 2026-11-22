import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildUiRewrite, minifyAsset, applyCloak, resolveCloak, proxyConfig, CLOAK_PRESETS } from "../src/server/obfuscation.mjs";

test("cloak swaps the head block, lang and brand, and never leaks its markers", () => {
  const page = `<html lang="en"><head>\n  <!--CLOAK:START-->\n  <title>Shadow</title>\n  <!--CLOAK:END-->\n</head><span>ShadowV3</span>`;
  const cloak = { ...CLOAK_PRESETS.ixl, title: 'A "quoted" <title>', lang: "fr" };
  const out = applyCloak(page, cloak);
  assert.ok(out.includes("<title>A &quot;quoted&quot; &lt;title&gt;</title>") && out.includes('<html lang="fr"'));
  assert.ok(!out.includes("CLOAK") && !out.includes("ShadowV3") && !out.includes("<title>Shadow</title>"));
  const off = applyCloak(page, null);
  assert.ok(off.includes("<title>Shadow</title>") && !off.includes("CLOAK") && off.includes("ShadowV3"));
  assert.equal(resolveCloak("off", "s"), null);
  assert.equal(resolveCloak("nope", "s"), CLOAK_PRESETS.example1);
  assert.equal(resolveCloak("random", "s"), resolveCloak("random", "s"), "random is fixed by the seed");
});

test("proxy config is seeded, avoids reserved paths, and its codec round-trips", () => {
  const a = proxyConfig("seed");
  assert.deepEqual(a, proxyConfig("seed"));
  assert.match(a.prefix, /^\/[a-z][a-z0-9]{5}\/$/);
  assert.match(a.codecKey, /^[0-7]{11}$/);
  assert.notEqual(proxyConfig("seed", new Set([a.prefix.slice(1, -1)])).prefix, a.prefix);

  // The client's keyedCodec, taken from tabs.js so this tests the shipped code.
  const source = readFileSync(new URL("../public/assets/js/tabs.js", import.meta.url), "utf8");
  const keyedCodec = new Function(source.match(/function keyedCodec[\s\S]*?\n}\n/)[0] + "return keyedCodec;")();
  const { encode, decode } = keyedCodec(a.codecKey);
  for (const url of ["https://example.com/a/b?x=1&y=ü", "https://日本.jp/😀", ""]) {
    assert.ok(!encode(url).includes("/"));
    assert.equal(decode(encode(url)), url);
  }
  assert.equal(decode(encode("https://a.b/c") + "?q=1"), "https://a.b/c?q=1");
});

test("DOM names are renamed consistently; names used as data are kept", () => {
  const sources = new Map([
    ["/index.html", `<div id="panel" class="card hot"><label for="panel">x</label></div><option value="dark">
<script src="/app.js"></script>`],
    ["/site.css", `.card:hover > #panel, .hot { color: red; overflow: hidden }\n:root.dark { --a: #fff }\n@media (max-width: 9px) { .card { margin: 0 } }`],
    ["/app.js", `document.getElementById("panel").classList.toggle("hot", true);
document.querySelector(".card #panel");
el.innerHTML = \`<i class="card \${x}">\`;
localStorage.setItem("panel-size", 1); // a key, not a DOM name
const tab = "tab-" + id; // fragment: anything starting with tab- stays
const re = /"card"/; // regex, not a string
style.textContent = \`
  * { box-sizing: border-box; }
  .card { color: red; }\`;`],
    ["/more.css", `.tab-x { }`],
  ]);
  const { map, render, assetPath } = buildUiRewrite(sources, "seed");
  for (const name of ["panel", "card", "hot"]) assert.match(map.get(name), /^[a-z][a-z0-9]{4,8}$/);
  assert.ok(!map.has("dark"), "value= data keeps its name");
  assert.ok(!map.has("tab-x"), "names built from a fragment keep their name");

  const [panel, card, hot] = ["panel", "card", "hot"].map((n) => map.get(n));
  const html = render("/index.html", sources.get("/index.html"));
  assert.ok(html.includes(`id="${panel}" class="${card} ${hot}"`) && html.includes(`for="${panel}"`));
  assert.match(assetPath("/app.js"), /^\/[a-z][a-z0-9]{4}\/[a-z][a-z0-9]{9}\.js$/);
  assert.ok(html.includes(`src="${assetPath("/app.js")}"`), "script tags load the random path");
  assert.ok(buildUiRewrite(sources, "seed", new Set([assetPath("/app.js").split("/")[1]])).assetPath("/app.js").split("/")[1] !== assetPath("/app.js").split("/")[1], "the asset folder avoids reserved names");
  const css = render("/site.css", sources.get("/site.css"));
  assert.ok(css.includes(`.${card}:hover > #${panel}, .${hot} { color: red; overflow: hidden }`) && css.includes(`#fff`));
  assert.ok(css.includes(`{ .${card} {`));
  const js = render("/app.js", sources.get("/app.js"));
  assert.ok(js.includes(`getElementById("${panel}").classList.toggle("${hot}"`));
  assert.ok(js.includes(`".${card} #${panel}"`) && js.includes(`class="${card} \${x}"`));
  assert.ok(js.includes(`"panel-size"`) && js.includes(`/"card"/`));
  assert.ok(js.includes(`  .${card} { color: red; }`), "CSS built inside a script is renamed too");

  assert.notEqual(buildUiRewrite(sources, "other").map.get("card"), card, "a new seed gives new names");
});

test("minifying strips comments and readable code but leaves data scripts alone", () => {
  const html = `<!-- note --><script>
  // secret
  function hello(name) { return "hi " + name; }
</script>
<script type="application/ld+json">{ "a": 1 }</script><script src="/x.js"></script><style>/* c */ .a { color: red; }</style>`;
  const out = minifyAsset("/p.html", html);
  assert.ok(!out.includes("note") && !out.includes("secret") && !out.includes("/* c */"));
  assert.ok(out.includes("function hello(") && out.includes('{ "a": 1 }') && out.includes('<script src="/x.js"></script>'));
  assert.equal(minifyAsset("/a.css", ".a {\n  color: red;\n}\n"), ".a{color:red}");
  assert.equal(minifyAsset("/broken.js", "let = ;"), "let = ;", "a file esbuild can't parse is served as is");
});

