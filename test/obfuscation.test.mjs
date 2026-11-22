import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { buildUiRewrite, minifyAsset, applyCloak, resolveCloak, proxyConfig, CLOAK_PRESETS, domainMatcher, installObfuscation } from "../src/server/obfuscation.mjs";

test("cloak swaps the head block, lang and brand, and never leaks its markers", () => {
  const page = `<html lang="en"><head>\n  <!--CLOAK:START-->\n  <title>Shadow</title>\n  <!--CLOAK:END-->\n</head><span>ShadowV3</span>`;
  const cloak = { ...CLOAK_PRESETS.ixl, title: 'A "quoted" <title>', lang: "fr" };
  const out = applyCloak(page, cloak);
  assert.ok(out.includes("<title>A &quot;quoted&quot; &lt;title&gt;</title>") && out.includes('<html lang="fr"'));
  assert.ok(!out.includes("CLOAK") && !out.includes("ShadowV3") && !out.includes("<title>Shadow</title>"));
  const off = applyCloak(page, null);
  assert.ok(off.includes("<title>Shadow</title>") && !off.includes("CLOAK") && off.includes("ShadowV3"));
  assert.equal(resolveCloak("off", "s"), null);
  assert.equal(resolveCloak("khan", "s"), CLOAK_PRESETS.khan);
  assert.equal(resolveCloak("random", "s"), resolveCloak("random", "s"), "random is fixed by the seed");
  assert.equal(resolveCloak("nope", "s"), resolveCloak("random", "s"), "unknown names count as random");
  assert.equal(resolveCloak(undefined, "s"), resolveCloak("random", "s"), "random is the default");
  for (let i = 0; i < 50; i++) assert.ok(resolveCloak("random", `seed${i}`), "random never picks off");
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


test("SHADOW_DOMAINS: each listed domain gets its own site, shared by its subdomains; other hosts get the default", () => {
  const listed = domainMatcher("a.test, *.b.test");
  assert.equal(listed("a.test"), "a.test");
  assert.equal(listed("X.A.test"), "a.test");
  assert.equal(listed("c.b.test."), "b.test");
  for (const host of ["evila.test", "a.test.evil", "", undefined]) assert.equal(listed(host), undefined);
  assert.equal(domainMatcher("")("a.test"), undefined);

  // A cache of one site: every switch between domains evicts one and rebuilds the other.
  Object.assign(process.env, { SHADOW_DOMAINS: "a.test,b.test", SHADOW_UI_SEED: "s", SHADOW_OBFUSCATE: "on", SHADOW_SITE_CACHE: "1" });
  const routes = {};
  const app = { get: (path, fn) => (routes[path] = fn), use() {} };
  const { page } = installObfuscation(app, { publicPath: fileURLToPath(new URL("../public", import.meta.url)) });
  for (const name of ["SHADOW_DOMAINS", "SHADOW_UI_SEED", "SHADOW_OBFUSCATE", "SHADOW_SITE_CACHE"]) delete process.env[name];
  const first = page("/index.html", "a.test");
  page("/index.html", "b.test");
  assert.equal(page("/index.html", "a.test"), first, "a site rebuilt after eviction is the same site");
  const call = (path, req) => { let out; routes[path](req, { set() {}, json: (v) => (out = v) }); return out; };
  const config = (hostname) => call("/v1/api/config", { hostname });
  assert.notDeepEqual(config("a.test"), config("b.test"));
  assert.deepEqual(config("a.test"), config("A.test"));
  assert.deepEqual(config("a.test"), config("random1.a.test."), "subdomains share their domain's site: no build per made-up host");
  assert.deepEqual(config("evil.test"), config("localhost")); // unlisted hosts share the default site
  assert.notEqual(page("/index.html", "a.test"), page("/index.html", "b.test"));
});

test("the proxy runtime moves to seeded paths, references follow, and it still loads", () => {
  const require = createRequire(import.meta.url);
  const publicPath = fileURLToPath(new URL("../public", import.meta.url));
  const scramjet = require("@mercuryworkshop/scramjet/path").scramjetPath;
  const controller = dirname(require.resolve("@mercuryworkshop/scramjet-controller"));
  const runtime = new Map([
    ["/scramjet/scramjet.js", join(scramjet, "scramjet.js")],
    ["/scramjet/scramjet.wasm", join(scramjet, "scramjet.wasm")],
    ["/controller/controller.api.js", join(controller, "controller.api.js")],
    ["/controller/controller.inject.js", join(controller, "controller.inject.js")],
    ["/controller/controller.sw.js", join(controller, "controller.sw.js")],
    ["/epoxy/index.mjs", join(dirname(require.resolve("@mercuryworkshop/epoxy-transport")), "index.mjs")],
  ]);
  Object.assign(process.env, { SHADOW_UI_SEED: "s", SHADOW_OBFUSCATE: "on" });
  const { page, wispPath } = installObfuscation({ get() {}, use() {} }, { publicPath, runtime });
  for (const name of ["SHADOW_UI_SEED", "SHADOW_OBFUSCATE"]) delete process.env[name];

  const tabs = page("/assets/js/tabs.js");
  const worker = page("/sw.js");
  for (const body of [tabs, worker, page("/settings/index.html")]) {
    assert.ok(!/["'`]\/(?:scramjet|controller|epoxy)\//.test(body), "no well-known runtime path is left");
  }
  assert.match(wispPath(), /^\/[a-z0-9]{7}\/$/);
  assert.ok(tabs.includes(`\${location.host}${wispPath()}`) && !tabs.includes("${location.host}/wisp/"));

  const moved = (body) => [...body.matchAll(/["'`](\/[a-z0-9]{5}\/[a-z0-9]{10}\.(?:js|wasm))["'`]/g)].map((m) => m[1]);
  const api = [...new Set(moved(tabs))].map((path) => page(path)).find((body) => body?.includes("injectPath:"));
  assert.ok(api, "tabs.js loads the controller from its seeded path");
  const [scramjetJs, injectJs, wasmPath] = ["scramjetPath", "injectPath", "wasmPath"].map((key) => api.match(new RegExp(`${key}:"([^"]+)"`))[1]);
  assert.ok(page(scramjetJs)?.includes("globals:{wrapfn:"), "scramjet.js is served where the controller looks");
  for (const body of [tabs, worker, api, page(scramjetJs), page(injectJs)]) {
    assert.ok(!/\$scram|scramtag|__scramjet_controller"/.test(body), "no Scramjet global, marker or database name is left");
  }
  assert.ok(page(injectJs), "the inject script is served where the controller looks");
  assert.ok(api.includes(`maskedfiles:["${injectJs.split("/").pop()}",`), "the inject script stays hidden from stack traces");
  assert.ok(!api.includes("sourceMappingURL"));
  const wasm = page(wasmPath);
  assert.ok(WebAssembly.validate(wasm), "the wasm with its seeded section is still valid");
  assert.ok(!/\$scram|scramtag/.test(wasm.toString("latin1")), "the names the rewriter writes into pages are renamed in the wasm too");
  assert.notDeepEqual(wasm.subarray(0, readFileSync(runtime.get("/scramjet/scramjet.wasm")).length + 1), readFileSync(runtime.get("/scramjet/scramjet.wasm")), "its bytes differ per deploy");
  assert.ok(moved(worker).length && moved(worker).every((path) => page(path) !== undefined), "everything the worker imports is served");
});
