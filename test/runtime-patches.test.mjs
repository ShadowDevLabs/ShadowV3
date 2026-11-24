import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { patchRuntime } from "../src/server/runtime-patches.mjs";

const require = createRequire(import.meta.url);
const scramjet = join(require("@mercuryworkshop/scramjet/path").scramjetPath, "scramjet.js");

// Scramjet's Storage proxy handler, cut out of the patched bundle and run against a fake Storage.
function storageProxy(host) {
  const text = patchRuntime("/scramjet/scramjet.js", readFileSync(scramjet, "utf8"));
  const start = text.indexOf("function n(e,t){let r={get(t,r){");
  const end = text.indexOf("n=new Proxy(t.localStorage,r)", start);
  assert.ok(start > 0 && end > start, "Storage handler not found in scramjet.js");
  const handler = text.slice(start + "function n(e,t){let r=".length, text.lastIndexOf("}", end - 2) + 1);
  const i = { BR: (o) => Object.keys(o), lK: (o) => Reflect.ownKeys(o), rF: (o, k) => Reflect.get(o, k) };
  const make = new Function("e", "i", `return ${handler};`);
  class FakeStorage {
    getItem(k) { return Object.hasOwn(this, k) ? this[k] : null; }
    setItem(k, v) { this[k] = String(v); }
    removeItem(k) { delete this[k]; }
  }
  const real = new FakeStorage();
  real.theme = "shadow's own"; // the shell's own key: never visible to the page
  return { real, FakeStorage, proxy: new Proxy(real, make({ url: { host } }, i)) };
}

test("proxied localStorage keeps Storage.prototype methods and returns key names", () => {
  const { proxy, FakeStorage } = storageProxy("example.com");
  FakeStorage.prototype.getObject = function (k) { return JSON.parse(this.getItem(k)); };
  proxy.setItem("a", "[1,2]");
  proxy.setItem("b", "x");
  assert.deepEqual(proxy.getObject("a"), [1, 2]);
  assert.deepEqual([proxy.key(0), proxy.key(1), proxy.key(2)], ["a", "b", null]);
  assert.equal(proxy.a, "[1,2]");
  assert.equal(proxy.theme, null);
});
