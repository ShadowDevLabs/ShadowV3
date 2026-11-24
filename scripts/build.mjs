// Bundles the client pieces that need a build step into public/dist/:
//
//   shadow-proxy.js          Sapphire (chrome.* extension emulation) + Shadow's own
//                            Scramjet frame plugin, as one ES module.
//   sapphire-sw-router.js    Sapphire's service-worker router (serves extension files).
//   markdown.js              marked + DOMPurify, for the AI page: replies become sanitized HTML.
//
// Scramjet and scramjet-controller themselves are prebuilt IIFE bundles served
// straight out of node_modules by index.js; the bundle above picks them up from
// globalThis.$scramjet / $scramjetController.
//
// Runs on `npm install` (postinstall), `npm run build`, and on server start if
// the output is missing.
import { build as esbuild } from "esbuild";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const outDir = join(root, "public", "dist");

export const outputs = [
  join(outDir, "shadow-proxy.js"),
  join(outDir, "sapphire-sw-router.js"),
  join(outDir, "markdown.js"),
];

// --- Patches to a dependency ------------------------------------------------
// Applied in memory to Sapphire's src/frames.ts while bundling; node_modules is not modified.
// Each "from" must appear exactly once: if Sapphire changes it, the build fails loudly instead of
// shipping a silently broken bundle. Re-check the patch then, or drop it if upstream fixed it.
const SAPPHIRE_PATCHES = [
  // unproxyUrl() recovers real URLs from proxied ones with a regex that only matches Scramjet's
  // default encodeURIComponent codec. Shadow uses an XOR codec so hostnames don't sit in the
  // address bar in plain text, and with it MV3 extension service workers can't importScripts()
  // their own files. Fall back to globalThis.__shadowUnproxy (public/assets/js/tabs.js, where the
  // codec lives).
  [
    "if (!m) return ref;",
    'if (!m) { try { const fn = globalThis.__shadowUnproxy; if (typeof fn === "function") return fn(ref); } catch {} return ref; }',
  ],
  // A message from an extension page to its service worker arrived with event.source null. In
  // Chrome it is always the sending Client, and workers answer with event.source.postMessage()
  // (Momentum's does for every message, so it threw on each one). Give it a Client that replies
  // through the page's navigator.serviceWorker, like a real one, and the waitUntil() of a worker's
  // ExtendableMessageEvent.
  [
    'const event = new bgWin.MessageEvent("message", { data: message, ports, origin: extensionUrl(ext.id, "").slice(0, -1) });',
    'const event = new bgWin.MessageEvent("message", { data: message, ports, origin: extensionUrl(ext.id, "").slice(0, -1) });' +
      " Object.defineProperty(event, \"waitUntil\", { value: () => {} });" +
      " Object.defineProperty(event, \"source\", { value: { id: String(ctx.id), url: ctx.url, type: \"window\", frameType: \"top-level\", focused: true, visibilityState: \"visible\"," +
      " postMessage: (data: unknown, t?: Transferable[] | { transfer?: Transferable[] }) => { const reply = new win.MessageEvent(\"message\", { data, ports: (Array.isArray(t) ? t : (t?.transfer ?? [])) as MessagePort[], origin: extensionUrl(ext.id, \"\").slice(0, -1) });" +
      " setTimeout(() => { target.dispatchEvent(reply); const h = container.onmessage; if (typeof h === \"function\") (h as (e: Event) => void).call(container, reply); }, 0); } } });",
  ],
];
function sapphirePatch(sapphireRoot) {
  const target = join(sapphireRoot, "src", "frames.ts");
  return {
    name: "shadow-sapphire-patches",
    setup(b) {
      let applied = false;
      b.onLoad({ filter: /[\\/]frames\.ts$/ }, async (args) => {
        if (args.path !== target) return undefined;
        let source = await readFile(args.path, "utf8");
        for (const [from, to] of SAPPHIRE_PATCHES) {
          if (source.split(from).length !== 2) {
            throw new Error(`Sapphire's src/frames.ts no longer looks the way scripts/build.mjs expects; update or remove this patch: ${from}`);
          }
          source = source.replace(from, () => to);
        }
        applied = true;
        return { contents: source, loader: "ts" };
      });
      b.onEnd(() => {
        if (!applied) throw new Error("The Sapphire patches were never applied (src/frames.ts not bundled?).");
      });
    },
  };
}

export async function build({ quiet = false } = {}) {
  const sapphireRoot = dirname(require.resolve("@x8r/sapphire/package.json"));
  const common = {
    bundle: true,
    target: "es2022",
    minify: true,
    sourcemap: false,
    logLevel: quiet ? "silent" : "warning",
    legalComments: "none",
  };

  await Promise.all([
    esbuild({
      ...common,
      entryPoints: [join(root, "src", "client", "proxy-entry.js")],
      format: "esm",
      outfile: outputs[0],
      plugins: [sapphirePatch(sapphireRoot)],
    }),
    esbuild({
      ...common,
      entryPoints: [join(sapphireRoot, "src", "router", "swEntry.ts")],
      format: "iife",
      outfile: outputs[1],
    }),
    esbuild({
      ...common,
      entryPoints: [join(root, "src", "client", "markdown-entry.js")],
      format: "esm",
      outfile: outputs[2],
    }),
  ]);
  if (!quiet) console.log("[build] wrote public/dist/");
}

export const isBuilt = () => outputs.every((f) => existsSync(f));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await build();
  } catch (e) {
    // Don't fail `npm install` over this: index.js retries on start and reports it.
    console.error("[build] failed:", e?.message ?? e);
    process.exitCode = process.env.npm_lifecycle_event === "postinstall" ? 0 : 1;
  }
}
