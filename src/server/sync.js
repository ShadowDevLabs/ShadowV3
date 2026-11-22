// Cloud sync storage: the "tiny account layer".
//
// The server never sees anything readable. A browser derives three things from
// its sync code (see public/assets/js/sync.js): an account id, an auth token and
// an encryption key. Only the first two ever leave the device:
//
//   GET    /v1/api/sync/:id   -> { version, updatedAt, data }      (404 if none)
//   PUT    /v1/api/sync/:id   <- { data, baseVersion }              -> { version }
//                                409 + the current record if baseVersion is stale
//   DELETE /v1/api/sync/:id
//
// all with `Authorization: Bearer <token>`. `data` is an opaque AES-GCM blob. The
// first PUT for an id claims it; after that the token has to match (its SHA-256
// is what's stored, so neither the files nor the access logs contain a usable
// credential).
//
// One JSON file per account under SYNC_DIR (default ./data/sync). With several
// app servers behind one name, point SYNC_DIR at shared storage. Environment:
//   SYNC_DISABLED=1          turn the endpoints off (they answer 503)
//   SYNC_DIR=/path           where records live
//   SYNC_MAX_ACCOUNTS=20000  refuse new accounts past this many
//   SYNC_MAX_BYTES=65536     largest accepted blob
import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { rateLimit } from "./ratelimit.js";

const ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[0-9a-f]{32,128}$/;

export function syncRouter({
  dir = process.env.SYNC_DIR || resolve("data/sync"),
  maxAccounts = Number(process.env.SYNC_MAX_ACCOUNTS) || 20000,
  maxBytes = Number(process.env.SYNC_MAX_BYTES) || 65536,
  disabled = process.env.SYNC_DISABLED === "1",
  ratePerMinute = 40,
} = {}) {
  const router = express.Router();
  let ready = null; // resolves true once the directory is usable, false if it never will be
  const limit = rateLimit(ratePerMinute, "Too many sync requests; try again in a minute.");

  const prepare = () =>
    (ready ??= fs
      .mkdir(dir, { recursive: true })
      .then(() => true)
      .catch((e) => {
        console.warn(`[sync] storage unavailable (${e.code ?? e.message}); sync is off`);
        return false;
      }));

  const fileFor = (id) => join(dir, `${id}.json`);
  const hash = (token) => createHash("sha256").update(token).digest("hex");
  const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  async function read(id) {
    try {
      return JSON.parse(await fs.readFile(fileFor(id), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  async function write(id, record) {
    const tmp = `${fileFor(id)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record));
    await fs.rename(tmp, fileFor(id));
  }

  // Writes to one account never interleave, also between worker processes (SHADOW_WORKERS):
  // the lock is a file that only one process can create.
  async function withLock(id, run) {
    const lock = `${fileFor(id)}.lock`;
    for (let waited = 0; ; waited += 20) {
      try {
        await fs.writeFile(lock, String(process.pid), { flag: "wx" });
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        if (waited >= 3000) await fs.rm(lock, { force: true }); // left by a crashed process: writes take milliseconds
        else await new Promise((r) => setTimeout(r, 20));
      }
    }
    try {
      return await run();
    } finally {
      await fs.rm(lock, { force: true });
    }
  }
  // Counted on disk, so every worker process sees the same number. Only new accounts pay for it.
  const accountCount = async () => (await fs.readdir(dir)).filter((name) => name.endsWith(".json")).length;

  router.use(async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (disabled || !(await prepare())) return res.status(503).json({ error: "Sync isn't available on this server." });
    limit(req, res, next); // soft: it only has to stop a runaway client or a casual flood
  });

  router.param("id", (req, res, next, id) => {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (!ID.test(id) || !TOKEN.test(token)) return res.status(400).json({ error: "Bad sync credentials." });
    req.syncToken = hash(token);
    next();
  });

  router.get("/:id", async (req, res) => {
    try {
      const record = await read(req.params.id);
      if (!record) return res.status(404).json({ error: "No synced data yet." });
      if (!sameHash(record.auth, req.syncToken)) return res.status(403).json({ error: "Wrong sync code." });
      res.json({ version: record.version, updatedAt: record.updatedAt, data: record.data });
    } catch (e) {
      console.error("[sync] read failed:", e);
      res.status(500).json({ error: "Sync storage error." });
    }
  });

  router.put("/:id", express.json({ limit: maxBytes + 4096 }), async (req, res) => {
    const { data, baseVersion } = req.body ?? {};
    if (typeof data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(data)) return res.status(400).json({ error: "Bad sync payload." });
    if (data.length > maxBytes) return res.status(413).json({ error: "Synced data is too large." });
    try {
      await withLock(req.params.id, async () => {
        const record = await read(req.params.id);
        if (!record) {
          if ((await accountCount()) >= maxAccounts) return res.status(507).json({ error: "This server isn't accepting new sync accounts." });
          await write(req.params.id, { auth: req.syncToken, version: 1, updatedAt: Date.now(), data });
          return res.status(201).json({ version: 1 });
        }
        if (!sameHash(record.auth, req.syncToken)) return res.status(403).json({ error: "Wrong sync code." });
        if (Number(baseVersion) !== record.version) {
          // Someone else (another device) wrote since this client last read.
          return res.status(409).json({ version: record.version, updatedAt: record.updatedAt, data: record.data });
        }
        const version = record.version + 1;
        await write(req.params.id, { auth: record.auth, version, updatedAt: Date.now(), data });
        res.json({ version });
      });
    } catch (e) {
      console.error("[sync] write failed:", e);
      if (!res.headersSent) res.status(500).json({ error: "Sync storage error." });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await withLock(req.params.id, async () => {
        const record = await read(req.params.id);
        if (!record) return res.status(204).end();
        if (!sameHash(record.auth, req.syncToken)) return res.status(403).json({ error: "Wrong sync code." });
        await fs.unlink(fileFor(req.params.id));
        res.status(204).end();
      });
    } catch (e) {
      console.error("[sync] delete failed:", e);
      if (!res.headersSent) res.status(500).json({ error: "Sync storage error." });
    }
  });

  // Body-parser errors (too large, malformed JSON) as JSON instead of the HTML error page.
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status === 413 ? 413 : 400).json({ error: err.status === 413 ? "Synced data is too large." : "Bad sync payload." });
  });

  return router;
}
