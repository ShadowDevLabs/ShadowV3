// Production entry (npm start): runs index.js in SHADOW_WORKERS processes that share one port,
// so proxy traffic uses more than one CPU core. SHADOW_WORKERS unset or 1: a single process.
import "dotenv/config";
import cluster from "node:cluster";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build, isBuilt } from "./scripts/build.mjs";

// Every proxied connection starts with a DNS lookup on libuv's threadpool (4 threads by default),
// where they'd queue under load. Read when a process starts, so set before any worker exists.
process.env.UV_THREADPOOL_SIZE ||= "32";

const workers = Math.max(1, Math.floor(Number(process.env.SHADOW_WORKERS)) || 1);
if (workers === 1) {
  await import("./index.js");
} else {
  // Workers must serve the same seeded paths, or a page from one 404s its assets on another.
  if (!process.env.SHADOW_UI_SEED) {
    process.env.SHADOW_UI_SEED = randomBytes(16).toString("hex");
    console.warn("[cluster] SHADOW_UI_SEED is not set: using a random one until the next restart");
  }
  if (!isBuilt()) await build({ quiet: true }); // once here, not raced by every worker
  cluster.setupPrimary({ exec: fileURLToPath(new URL("./index.js", import.meta.url)), args: process.argv.slice(2) });
  const fork = () => Object.assign(cluster.fork(), { startedAt: Date.now() });
  for (let i = 0; i < workers; i++) fork();
  cluster.on("exit", (worker, code, signal) => {
    console.error(`[cluster] worker ${worker.process.pid} exited (${signal ?? code})`);
    // One that dies right after starting would die again: stop instead of looping.
    if (Date.now() - worker.startedAt < 10_000) {
      console.error("[cluster] it crashed during startup; stopping");
      process.exit(1);
    }
    fork();
  });
}
