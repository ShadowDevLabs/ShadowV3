import express from "express";
import basicAuth from "express-basic-auth";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import https from "https";
import compression from "compression";
import cookieParser from "cookie-parser";
import * as cheerio from "cheerio";
import { doubleCsrf } from "csrf-csrf";
import { createServer } from "http";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { users, port, brokenSites } from "./config.js";
import session from "express-session";
import { build, isBuilt } from "./scripts/build.mjs";
import { installObfuscation } from "./src/server/obfuscation.mjs";
import { syncRouter } from "./src/server/sync.js";

import dotenv from "dotenv";
dotenv.config();

const require = createRequire(import.meta.url);
const version =
  process.env.npm_package_version ?? require("./package.json").version;
const publicPath = fileURLToPath(new URL("./public/", import.meta.url));

const { scramjetPath } = require("@mercuryworkshop/scramjet/path");
// These packages only export ".", so resolve the entry file and take its directory (dist/).
const controllerPath = dirname(
  require.resolve("@mercuryworkshop/scramjet-controller"),
);
const epoxyPath = dirname(require.resolve("@mercuryworkshop/epoxy-transport"));
const libcurlPath = dirname(
  require.resolve("@mercuryworkshop/libcurl-transport"),
);
const erudaPath = dirname(require.resolve("eruda"));

if (!isBuilt()) {
  console.log("[build] public/dist is missing, building it now...");
  await build({ quiet: true });
}
const app = express();
const server = createServer(app);
app.disable("x-powered-by");
// gzip/brotli for text responses (scripts, styles, pages, JSON, wasm): the shell's
// JavaScript and the Scramjet runtime go out at roughly a quarter of their size.
app.use(compression());

/**
 * Small in-memory cache with a time limit and a size cap, for upstream lookups
 * that many users ask for at once (suggestions, extension metadata, …).
 */
function ttlCache(ttl, max) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttl) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { at: Date.now(), value });
      // Map keeps insertion order, so the first key is the oldest entry.
      while (map.size > max) map.delete(map.keys().next().value);
    },
  };
}

/** fetch() that gives up instead of holding a request open on a slow upstream. */
function fetchWithTimeout(url, options = {}, ms = 5000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
}
if (Object.keys(users).length > 0)
  app.use(basicAuth({ users, challenge: true }));
app.use((req, res, next) => {
  if (req.method === 'POST') {
    const len = parseInt(req.headers['content-length'], 10);
    if (req.path !== '/ask' && len > 102400) {
      return res.status(413).end();
    }
  }
  next();
});
// Proxy runtime, served straight from node_modules.
//   /scramjet/    scramjet.js + scramjet.wasm (rewriter + client)
//   /controller/  controller.api.js (page), controller.inject.js (proxied docs), controller.sw.js (service worker)
//   /epoxy/, /libcurl/  wisp transports, picked in settings
const runtimeStatic = { maxAge: 3600000 }; // 1 hour: these change whenever the packages are bumped
app.use("/scramjet/", express.static(scramjetPath, runtimeStatic));
app.use("/controller/", express.static(controllerPath, runtimeStatic));
app.use("/epoxy/", express.static(epoxyPath, runtimeStatic));
app.use("/libcurl/", express.static(libcurlPath, runtimeStatic));
// In-page devtools console (menu -> Devtools), served locally so it doesn't depend on a CDN.
app.use("/eruda/", express.static(erudaPath, runtimeStatic));
// Our own bundles (scripts/build.mjs). Revalidated on every load so a redeploy takes effect immediately.
app.use("/dist/", express.static(join(publicPath, "dist"), { maxAge: 0 }));
app.get("/sw.js", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(join(publicPath, "sw.js"));
});
installObfuscation(app, { publicPath });
app.use("/privacy", express.static(publicPath + "/privacy.html"));

// Shadow's own files. Images and fonts rarely change, so they're cached for a
// week. Pages, scripts, styles and data are revalidated instead (a cheap 304
// when nothing changed): the service worker already serves them instantly from
// its own cache and refreshes in the background, and a long max-age here would
// make that refresh read the browser's stale copy, hiding a deploy for days.
app.use(
  express.static(publicPath, {
    maxAge: 604800000,
    setHeaders(res, filePath) {
      if (/\.(html?|js|mjs|css|json|webmanifest)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      }
    },
  }),
);
// Game assets, for deployments that don't have the games submodule checked out
// (when it is, express.static above has already answered). Fetched over https:
// the plain-http address only answers with a redirect to https, which sent every
// visitor's browser to phantom.lol directly instead of through this mirror.
const gamesAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
app.use("/books/files/", (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
  const baseUrl = new URL("https://phantom.lol/books/files/");

  const mountPath = "/books/files/";
  const originalUrl = req.originalUrl || req.url || "";
  const suffix = originalUrl.startsWith(mountPath)
    ? originalUrl.slice(mountPath.length)
    : "";

  const [rawPath, rawQuery = ""] = suffix.split("?");

  if (rawPath.includes("..") || rawPath.includes("\\")) {
    res.status(400).end("Invalid path");
    return;
  }

  let safePath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") + safePath;
  baseUrl.search = rawQuery ? `?${rawQuery}` : "";

  const sourceUrl = baseUrl.toString();

  // Pass along what lets the upstream answer cheaply (ranges, 304s).
  const headers = {};
  for (const name of ["range", "if-none-match", "if-modified-since", "accept"]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const upstream = https
    .get(sourceUrl, { headers, timeout: 20000, agent: gamesAgent, method: req.method }, (sourceResponse) => {
      const outHeaders = { ...sourceResponse.headers };
      // Game assets never change in place: let browsers (and any CDN in front)
      // keep them instead of pulling every file through this server again.
      if (sourceResponse.statusCode === 200 && !outHeaders["cache-control"]) {
        outHeaders["cache-control"] = "public, max-age=86400";
      }
      res.writeHead(sourceResponse.statusCode, outHeaders);
      sourceResponse.pipe(res);
      sourceResponse.on("error", () => res.destroy());
    })
    .on("timeout", () => upstream.destroy(new Error("upstream timed out")))
    .on("error", (err) => {
      if (res.headersSent) return res.destroy();
      res.statusCode = 502;
      res.end(`Error fetching file: ${err.message}`);
    });
  // The visitor left: stop downloading on their behalf.
  res.on("close", () => upstream.destroy());
});

app.get("/v1/api/version", (req, res) => {
  if (req.query.v && req.query.v != version) {
    res.status(400).send(version);
    return;
  }
  res.status(200).send(version);
});

// Encrypted settings/bookmarks/tabs sync between a user's devices (src/server/sync.js).
app.use("/v1/api/sync", syncRouter());

// Asked for by every page load; the file behind it is read at most once a minute.
let brokenSitesCache = null;
app.get("/v1/api/broken-sites", async (req, res) => {
  if (!brokenSitesCache || Date.now() - brokenSitesCache.at > 60000) {
    try {
      brokenSitesCache = { at: Date.now(), value: await brokenSites() };
    } catch (error) {
      console.error("[broken-sites]", error?.message ?? error);
      brokenSitesCache = { at: Date.now(), value: brokenSitesCache?.value ?? {} };
    }
  }
  res.set("Cache-Control", "public, max-age=300");
  res.status(200).send(brokenSitesCache.value);
});

// Address-bar suggestions: one request per keystroke per user, so answers are
// cached here (the same prefixes are typed over and over) and in the browser.
const suggestionCache = ttlCache(10 * 60 * 1000, 5000);
const SUGGEST_SOURCES = {
  duckduckgo: {
    url: (q) => `https://duckduckgo.com/ac/?q=${q}&type=list`,
    pick: (body) => (Array.isArray(body?.[1]) ? body[1] : Array.isArray(body) ? body.map((r) => r?.phrase) : []),
  },
  google: {
    url: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&q=${q}`,
    pick: (body) => body?.[1] ?? [],
  },
  yandex: {
    url: (q) => `https://suggest.yandex.com/suggest?part=${q}`,
    pick: (body) => body?.[1] ?? [],
  },
};
app.get("/v1/api/search-suggestions", async (req, res) => {
  const engine = String(req.headers.engine ?? "google");
  const source = SUGGEST_SOURCES[engine];
  if (!source) return res.status(400).send("How?");
  const text = String(req.query.query ?? "").trim().slice(0, 200);
  res.set("Vary", "engine");
  if (!text) return res.json([]);

  const key = `${engine}|${text.toLowerCase()}`;
  let results = suggestionCache.get(key);
  if (!results) {
    try {
      const body = await fetchWithTimeout(source.url(encodeURIComponent(text)), {}, 3000).then((r) => r.json());
      results = source
        .pick(body)
        .filter((entry) => typeof entry === "string")
        .slice(0, 10);
      suggestionCache.set(key, results);
    } catch {
      // Suggestions are a nicety: a slow or failing upstream means none, not a 500.
      return res.json([]);
    }
  }
  res.set("Cache-Control", "private, max-age=300");
  res.json(results);
});

// Downloads an extension package from the Chrome Web Store so the client can
// install it (the store doesn't send CORS headers, so the browser can't).
const CRX_MAX_BYTES = 64 * 1024 * 1024;
app.get("/v1/api/crx/:id", async (req, res) => {
  const id = req.params.id;
  if (!/^[a-p]{32}$/.test(id)) {
    return res.status(400).json({ error: "Not a Chrome Web Store extension ID" });
  }
  try {
    const upstream = await fetchWithTimeout(
      `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=138.0&acceptformat=crx2,crx3&x=id%3D${id}%26uc`,
      {},
      30000,
    );
    if (!upstream.ok) {
      return res
        .status(upstream.status === 204 ? 404 : 502)
        .json({ error: "The Chrome Web Store has no package for that ID" });
    }
    // Refuse oversized packages before buffering them.
    if (Number(upstream.headers.get("content-length")) > CRX_MAX_BYTES) {
      await upstream.body?.cancel().catch(() => {});
      return res.status(413).json({ error: "Extension package is too large" });
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length === 0) {
      return res
        .status(404)
        .json({ error: "The Chrome Web Store has no package for that ID" });
    }
    if (body.length > CRX_MAX_BYTES) {
      return res.status(413).json({ error: "Extension package is too large" });
    }
    res.set("Content-Type", "application/x-chrome-extension");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(body);
  } catch (error) {
    console.error("[crx]", error);
    res.status(502).json({ error: "Could not reach the Chrome Web Store" });
  }
});

// Live metadata (name, icon, description) for a Web Store extension, scraped from
// its public detail page so the storefront can sync with the real store instead
// of relying on a hand-written catalog. Cached in memory so 30k users don't turn
// into 30k scrapes.
const EXT_META_TTL = 6 * 60 * 60 * 1000; // 6h
const extMetaCache = ttlCache(EXT_META_TTL, 5000); // id -> data
app.get("/v1/api/ext-meta/:id", async (req, res) => {
  const id = req.params.id;
  if (!/^[a-p]{32}$/.test(id)) return res.status(400).json({ error: "Bad extension ID" });

  const hit = extMetaCache.get(id);
  if (hit) {
    res.set("Cache-Control", "public, max-age=21600");
    return res.json(hit);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const page = await fetch(`https://chromewebstore.google.com/detail/${id}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ShadowStore/1.0)", "Accept-Language": "en" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!page.ok) return res.status(page.status === 404 ? 404 : 502).json({ error: "Not found in the Web Store" });

    const $ = cheerio.load(await page.text());
    const pick = (sel, attr) => $(sel).attr(attr)?.trim() || "";
    const metaName = pick('meta[property="og:title"]', "content").replace(/\s*-\s*Chrome Web Store\s*$/i, "");
    const data = {
      id,
      name: metaName || null,
      icon: pick('meta[property="og:image"]', "content") || null,
      description: pick('meta[property="og:description"]', "content") || null,
      url: pick('meta[property="og:url"]', "content") || `https://chromewebstore.google.com/detail/${id}`,
    };
    if (!data.name && !data.icon) return res.status(502).json({ error: "Could not parse store page" });
    // A removed/invalid item redirects to the store home, whose og: tags are
    // generic. Treat that as not-found so the client keeps its catalog data.
    if (data.name === "Chrome Web Store" || /chromewebstore\.google\.com\/?$/.test(data.url)) {
      return res.status(404).json({ error: "Not found in the Web Store" });
    }
    extMetaCache.set(id, data);
    res.set("Cache-Control", "public, max-age=21600");
    res.json(data);
  } catch (error) {
    console.error("[ext-meta]", error?.name || error);
    res.status(502).json({ error: "Could not reach the Chrome Web Store" });
  }
});

// AI STUFF

// Sessions exist only for the AI endpoints below. They used to be mounted for
// every request that got this far with saveUninitialized on, so each stray 404
// left a session behind in memory for half an hour.
const sessionStore = new session.MemoryStore();
const aiSession = [
  cookieParser(),
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || "putyoursecretkeyhere",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 1000 * 60 * 30,
    },
  }),
];
// The memory store only drops an expired session when that session is asked for
// again; listing them is what sweeps out the ones nobody came back for.
setInterval(() => sessionStore.all(() => {}), 10 * 60 * 1000).unref();

const { generateToken, validateRequest } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || "your-secret-key",
  cookieName: undefined,
  size: 64,
  getTokenFromRequest: (req) => req.headers["x-csrf-token"],
});

// Middleware to protect routes
const csrfProtection = (req, res, next) => {
  try {
    validateRequest(req, res);
    next();
  } catch (error) {
    res.status(403).json({
      error: "Invalid CSRF token",
      message: error.message,
    });
  }
};

function requireSession(req, res, next) {
  if (req.session?.hasSession) return next();
  res.status(401).json({ error: "Missing or invalid session" });
}

// Route to get CSRF token
app.get("/csrf-token", aiSession, (req, res) => {
  req.session.hasSession = true;
  res.json({ csrfToken: generateToken(req, res) });
});

app.post("/ask", aiSession, express.json({ limit: "12mb" }), requireSession, csrfProtection, async (req, res) => {
  const { messages, model } = req.body;

  if (!Array.isArray(messages)) {
    return res
      .status(400)
      .json({ error: "msgs need to be in an array format." });
  }

  const requestedModel =
    typeof model === "string" && model.trim() ? model.trim() : "shuttleai/auto";

  try {
    const response = await fetchWithTimeout(
      "https://api.shuttleai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SHUTTLEAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: requestedModel,
          messages,
        }),
      },
      120000,
    );

    const data = await response.json();

    if (!response.ok) {
      const apiMessage =
        data?.error?.message || data?.error || "AI provider request failed";
      return res.status(response.status).json({ error: apiMessage });
    }

    if (!data?.choices?.[0]?.message?.content) {
      console.error("Unexpected response:", data);
      return res.status(500).json({ error: "Unexpected response from AI API" });
    }

    res.json({
      model: requestedModel,
      message: data.choices[0].message.content,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to Retrieve Request" });
  }
});

// The list changes about weekly; scrape it once a day, not once per visitor.
let userAgentsCache = null;
app.get("/v1/api/user-agents", async (req, res) => {
  if (!userAgentsCache || Date.now() - userAgentsCache.at > 24 * 60 * 60 * 1000) {
    try {
      const page = await fetchWithTimeout("https://useragents.me/", {}, 8000).then((r) => r.text());
      const $ = cheerio.load(page);
      const value = $("#most-common-desktop-useragents-json-csv > div:eq(0) > textarea").val();
      if (!value) throw new Error("list not found in the page");
      userAgentsCache = { at: Date.now(), value };
    } catch (error) {
      console.error("[user-agents]", error?.message ?? error);
      if (!userAgentsCache) return res.status(502).send("[]");
    }
  }
  res.set("Cache-Control", "public, max-age=3600");
  res.send(userAgentsCache.value);
});

app.use((req, res) => {
  res.status(404);
  res.sendFile(join(publicPath, "404.html"));
});

// Local development only: lets the proxy reach localhost / LAN targets.
if (process.env.WISP_ALLOW_PRIVATE === "1") {
  wisp.options.allow_loopback_ips = true;
  wisp.options.allow_private_ips = true;
}

server.on("upgrade", (req, socket, head) => {
  if (req.url.endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
  else socket.end();
});

server.on("listening", () => {
  const address = server.address();
  console.log(
    "\n\n\n\x1b[35m\x1b[2m\x1b[1m%s\x1b[0m\n",
    `Shadow ${version} has started!\nSprinting on port ${address.port}`,
  );

  setTimeout(function () {
    console.log("\n");
  }, 750);
  setTimeout(function () {
    console.log("\n");
  }, 1000);
  setTimeout(function () {
    console.log(`
┌────────────┬─────────────┬────────────┐
│ Wisp       │ Site        │ API's      │
├────────────┼─────────────┼────────────┤
│ \x1b[32mrunning   \x1b[0m │ \x1b[32mrunning    \x1b[0m │ \x1b[32mrunning    \x1b[0m│
└────────────┴─────────────┴────────────┘
`);
  }, 1500);
});

server.listen(process.argv[2] || port);
