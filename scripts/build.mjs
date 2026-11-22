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

// --- The one patch we apply to a dependency -----------------------------------
// Sapphire 0.1.4 recovers real URLs from proxied ones in unproxyUrl()
// (src/frames.ts) with a regex that only matches Scramjet's default
// encodeURIComponent codec. Shadow uses an XOR codec so hostnames don't sit in
// the address bar in plain text, and with it MV3 extension service workers
// can't importScripts() their own files. The patch below adds a fallback to
// globalThis.__shadowUnproxy (defined in public/assets/js/tabs.js, where the
// codec lives). It is applied in memory while bundling; node_modules is not
// modified. If Sapphire changes that function the build fails loudly instead of
// shipping a silently broken bundle — re-check the patch, or drop it if upstream
// has learned about custom codecs.
const UNPROXY_ORIGINAL = "if (!m) return ref;";
const UNPROXY_PATCHED =
  'if (!m) { try { const fn = globalThis.__shadowUnproxy; if (typeof fn === "function") return fn(ref); } catch {} return ref; }';

function sapphirePatch(sapphireRoot) {
  const target = join(sapphireRoot, "src", "frames.ts");
  return {
    name: "shadow-sapphire-codec-patch",
    setup(b) {
      let applied = false;
      b.onLoad({ filter: /[\\/]frames\.ts$/ }, async (args) => {
        if (args.path !== target) return undefined;
        const source = await readFile(args.path, "utf8");
        const start = source.indexOf("export function unproxyUrl(");
        const at = start === -1 ? -1 : source.indexOf(UNPROXY_ORIGINAL, start);
        if (at === -1 || at - start > 200) {
          throw new Error(
            "Sapphire's unproxyUrl() no longer looks the way scripts/build.mjs expects; update or remove the codec patch.",
          );
        }
        applied = true;
        return {
          contents: source.slice(0, at) + UNPROXY_PATCHED + source.slice(at + UNPROXY_ORIGINAL.length),
          loader: "ts",
        };
      });
      b.onEnd(() => {
        if (!applied) throw new Error("The Sapphire codec patch was never applied (src/frames.ts not bundled?).");
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
