// Speed fixes to the proxy runtime, applied as its files are served (obfuscation.mjs, or index.js
// with obfuscation off). Each target must appear exactly once: after a package update that changes
// it, startup fails here instead of shipping an unpatched runtime. Re-check or drop the patch then.
const PATCHES = {
  "/scramjet/scramjet.js": [
    // Scramjet compiles its 600 KB rewriter wasm again every time it hands out a rewriter (each
    // script and page it rewrites), synchronously on the page's thread, though initSync ignores
    // the module after the first time. Compile once and keep it on `c`, the rewriter pool array
    // in the enclosing scope (the function's own name, h, is shadowed by a local there).
    ["(0,n.QR)({module:new WebAssembly.Module(i)})", "(0,n.QR)({module:c.wasm??=new WebAssembly.Module(i)})"],
    // Its base URL getter runs on every URL it rewrites and searched the whole document for
    // <base>: with no <base> (most pages) that's a walk over every element, each time. Search
    // <head> only, where <base> belongs (one put in <body> is then ignored).
    [
      'const e=r.natives.call("Document.prototype.querySelector",r.global.document,"base");',
      'const h=r.descriptors.get("Document.prototype.head",r.global.document),e=h?r.natives.call("Element.prototype.querySelector",h,"base"):null;',
    ],
    // Its localStorage/sessionStorage proxy read every unknown property as a stored item, so methods
    // a site or extension adds to Storage.prototype (Momentum's getObject) came back null. Like the
    // real Storage, the prototype wins.
    [
      'default:if(r in Object.prototype||"symbol"==typeof r)return(0,i.rF)(t,r);',
      'default:if(r in Object.prototype||"symbol"==typeof r||r in Object.getPrototypeOf(t))return(0,i.rF)(t,r);',
    ],
    // And key(n) returned the n-th item's value instead of its name, so loops over the keys broke.
    [
      'case"key":return r=>{let n=(0,i.BR)(t).filter(t=>t.startsWith(e.url.host));return t.getItem(n[r])};',
      'case"key":return r=>{let n=(0,i.BR)(t).filter(t=>t.startsWith(e.url.host+"@"));return n[r]?.slice(e.url.host.length+1)??null};',
    ],
  ],
};

/** `text` (a runtime file served at `url`) with its patches applied. */
export function patchRuntime(url, text) {
  for (const [from, to] of PATCHES[url] ?? []) {
    if (text.split(from).length !== 2) throw new Error(`[runtime-patches] ${url}: expected this once, check it after a package update: ${from}`);
    text = text.replace(from, () => to);
  }
  return text;
}
