import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { syncRouter } from "../src/server/sync.js";

test("sync: racing writes to one account from the same base version: exactly one wins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-"));
  // Two routers on one directory stand in for two worker processes.
  const servers = [];
  for (let i = 0; i < 2; i++) {
    const app = express();
    app.use("/s", syncRouter({ dir, ratePerMinute: 1000 }));
    servers.push(await new Promise((r) => { const s = app.listen(0, () => r(s)); }));
  }
  try {
    const id = "0123456789abcdef0123456789abcdef";
    const put = (server, data, baseVersion) =>
      fetch(`http://localhost:${server.address().port}/s/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${"ab".repeat(16)}` },
        body: JSON.stringify({ data, baseVersion }),
      }).then((r) => r.status);
    assert.equal(await put(servers[0], "AAAA", 0), 201);
    const statuses = await Promise.all(Array.from({ length: 10 }, (_, i) => put(servers[i % 2], `QkJC${i}A==`.slice(0, 8), 1)));
    assert.equal(statuses.filter((s) => s === 200).length, 1, `one write wins, the rest see 409: ${statuses}`);
    assert.equal(statuses.filter((s) => s === 409).length, 9);
  } finally {
    servers.forEach((s) => s.close());
    await rm(dir, { recursive: true, force: true });
  }
});
