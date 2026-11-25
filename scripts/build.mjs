// Bundles the client pieces that need a build step into public/dist/:
//
//   shadow-proxy.js          Sapphire (chrome.* emulation) + Shadow's Scramjet frame plugin
//   sapphire-sw-router.js    Sapphire's service-worker router
//   sapphire-sw-router.js    Sapphire's service-worker router (serves extension files).
//   markdown.js              marked + DOMPurify, for the AI page: replies become sanitized HTML.
//
// Scramjet itself is prebuilt and served from node_modules by index.js.
// Runs on postinstall, `npm run build`, and on start if the output is missing.
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
// Applied in memory to Sapphire's src/ files. Each "from" must match exactly once, so the build
// fails if Sapphire changes. Re-check or drop the patch then.
// Extension files are stored gzipped ({ gz }) when that saves space: uBlock Lite is 33 MB raw, 9 MB
// gzipped, which matters on a Chromebook. Files stored raw by an older build still read as before.
const SAPPHIRE_FILE_STORE = {
  "db.ts": [
    [
      'export const EXT_STATE_STORE = "extension_state";',
      'export const EXT_STATE_STORE = "extension_state";' +
        "\nconst gzipPipe = (data: ArrayBuffer, s: CompressionStream | DecompressionStream) => new Response(new Blob([data]).stream().pipeThrough(s)).arrayBuffer();" +
        '\nexport async function packFile(ab: ArrayBuffer): Promise<unknown> { const gz = await gzipPipe(ab, new CompressionStream("gzip")); return gz.byteLength < ab.byteLength * 0.9 ? { gz } : ab; }' +
        '\nexport async function dbGetFile(key: string): Promise<ArrayBuffer | undefined> { const v = await dbGet<ArrayBuffer | { gz: ArrayBuffer }>(EXT_FILES_STORE, key); return v && "gz" in v ? gzipPipe(v.gz, new DecompressionStream("gzip")) : v; }',
    ],
  ],
  "extensions.ts": [
    ["dbWriteMany, dbDelete,", "dbWriteMany, dbDelete, packFile,"],
    [
      "const entries = [...pkg.files].map(([path, ab]) => [`${pkg.id}/${path}`, ab] as [string, unknown]);",
      "const entries = await Promise.all([...pkg.files].map(async ([path, ab]) => [`${pkg.id}/${path}`, await packFile(ab)] as [string, unknown]));",
    ],
  ],
  "files.ts": [
    ['import { dbGet, dbGetAllKeysPrefix, EXT_FILES_STORE } from "./db";', 'import { dbGetFile, dbGetAllKeysPrefix, EXT_FILES_STORE } from "./db";'],
    ["await dbGet<ArrayBuffer>(EXT_FILES_STORE, `${this.extId}/${p}`)", "await dbGetFile(`${this.extId}/${p}`)"],
  ],
  "router/SapphireRouter.ts": [
    ['import { dbGet, dbGetAllKeys, EXT_FILES_STORE } from "../db";', 'import { dbGetFile, dbGetAllKeys, EXT_FILES_STORE } from "../db";'],
    ["await dbGet<ArrayBuffer>(EXT_FILES_STORE, `${extId}/${path}`)", "await dbGetFile(`${extId}/${path}`)"],
  ],
};
const SAPPHIRE_FRAMES = [
  // unproxyUrl() only matches Scramjet's default codec, so with our XOR codec MV3 extension workers
  // can't importScripts() their own files. Fall back to globalThis.__shadowUnproxy (see tabs.js).
  [
    "if (!m) return ref;",
    'if (!m) { try { const fn = globalThis.__shadowUnproxy; if (typeof fn === "function") return fn(ref); } catch {} return ref; }',
  ],
  // Extension page messages reached the worker with event.source null (Momentum's threw each time).
  // Supply a Client that replies via navigator.serviceWorker, plus waitUntil().
  [
    'const event = new bgWin.MessageEvent("message", { data: message, ports, origin: extensionUrl(ext.id, "").slice(0, -1) });',
    'const event = new bgWin.MessageEvent("message", { data: message, ports, origin: extensionUrl(ext.id, "").slice(0, -1) });' +
      " Object.defineProperty(event, \"waitUntil\", { value: () => {} });" +
      " Object.defineProperty(event, \"source\", { value: { id: String(ctx.id), url: ctx.url, type: \"window\", frameType: \"top-level\", focused: true, visibilityState: \"visible\"," +
      " postMessage: (data: unknown, t?: Transferable[] | { transfer?: Transferable[] }) => { const reply = new win.MessageEvent(\"message\", { data, ports: (Array.isArray(t) ? t : (t?.transfer ?? [])) as MessagePort[], origin: extensionUrl(ext.id, \"\").slice(0, -1) });" +
      " setTimeout(() => { target.dispatchEvent(reply); const h = container.onmessage; if (typeof h === \"function\") (h as (e: Event) => void).call(container, reply); }, 0); } } });",
  ],
];
const SAPPHIRE_PATCHES = { ...SAPPHIRE_FILE_STORE, "frames.ts": SAPPHIRE_FRAMES };

/** Patches Sapphire's sources as esbuild loads them; records each file it patched in `applied`. */
function sapphirePatch(sapphireRoot, applied) {
  const targets = new Map(Object.keys(SAPPHIRE_PATCHES).map((file) => [join(sapphireRoot, "src", file), file]));
  return {
    name: "shadow-sapphire-patches",
    setup(b) {
      b.onLoad({ filter: /\.ts$/ }, async (args) => {
        const file = targets.get(args.path);
        if (!file) return undefined;
        let source = await readFile(args.path, "utf8");
        for (const [from, to] of SAPPHIRE_PATCHES[file]) {
          if (source.split(from).length !== 2) {
            throw new Error(`Sapphire's src/${file} no longer looks the way scripts/build.mjs expects; update or remove this patch: ${from}`);
          }
          source = source.replace(from, () => to);
        }
        applied.add(file);
        return { contents: source, loader: "ts" };
      });
    },
  };
}

export async function build({ quiet = false } = {}) {
  const sapphireRoot = dirname(require.resolve("@x8r/sapphire/package.json"));
  const applied = new Set();
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
      plugins: [sapphirePatch(sapphireRoot, applied)],
    }),
    // The router reads extension files too, so it gets the same patches.
    esbuild({
      ...common,
      entryPoints: [join(sapphireRoot, "src", "router", "swEntry.ts")],
      format: "iife",
      outfile: outputs[1],
      plugins: [sapphirePatch(sapphireRoot, applied)],
    }),
    esbuild({
      ...common,
      entryPoints: [join(root, "src", "client", "markdown-entry.js")],
      format: "esm",
      outfile: outputs[2],
    }),
  ]);
  const missing = Object.keys(SAPPHIRE_PATCHES).filter((file) => !applied.has(file));
  if (missing.length) throw new Error(`Sapphire patches never applied (not bundled?): ${missing.join(", ")}`);
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
