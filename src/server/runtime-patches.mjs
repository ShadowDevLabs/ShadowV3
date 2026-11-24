// Speed fixes to the proxy runtime, applied as its files are served (obfuscation.mjs, or index.js
// with obfuscation off). Each target must match exactly once, so startup fails if a package update changes it.
// it, startup fails here instead of shipping an unpatched runtime. Re-check or drop the patch then.
const PATCHES = {
  "/scramjet/scramjet.js": [
    // Scramjet recompiles its 600 KB rewriter wasm on every rewriter handout, on the page's thread. Compile
    // once and keep it on `c`, the rewriter pool array (the function's own name, h, is shadowed there).
    ["(0,n.QR)({module:new WebAssembly.Module(i)})", "(0,n.QR)({module:c.wasm??=new WebAssembly.Module(i)})"],
    // The base URL getter walked the whole document for <base> on every URL. Search <head> only.
    [
      'const e=r.natives.call("Document.prototype.querySelector",r.global.document,"base");',
      'const h=r.descriptors.get("Document.prototype.head",r.global.document),e=h?r.natives.call("Element.prototype.querySelector",h,"base"):null;',
    ],
    // The Storage proxy returned null for methods sites add to Storage.prototype (Momentum's getObject). Prototype wins now.
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
