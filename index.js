import express from "express";
import basicAuth from "express-basic-auth";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import http from "http";
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
app.use("/privacy", express.static(publicPath + "/privacy.html"));

app.use(express.static(publicPath, { maxAge: 604800000 })); //1 week
app.use("/books/files/", (req, res) => {
  const baseUrl = new URL("http://phantom.lol/books/files/");

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

  http
    .get(sourceUrl, (sourceResponse) => {
      res.writeHead(sourceResponse.statusCode, sourceResponse.headers);
      sourceResponse.pipe(res);
    })
    .on("error", (err) => {
      res.statusCode = 500;
      res.end(`Error fetching file: ${err.message}`);
    });
});

app.get("/v1/api/version", (req, res) => {
  if (req.query.v && req.query.v != version) {
    res.status(400).send(version);
    return;
  }
  res.status(200).send(version);
});

app.get("/v1/api/broken-sites", async (req, res) => {
  res.status(200).send(await brokenSites());
});

app.get("/v1/api/search-suggestions", async (req, res) => {
  let response;
  let results = [];
  const query = encodeURIComponent(String(req.query.query ?? ""));
  switch (req.headers.engine ?? "google") {
    case "duckduckgo":
      response = await fetch(
        `http://api.duckduckgo.com/ac?q=${query}&format=json`,
      ).then((i) => i.json());
      results = response.map((result) => result.phrase);
      break;

    case "google":
      response = await fetch(
        `http://suggestqueries.google.com/complete/search?client=firefox&q=${query}`,
      ).then((i) => i.json());
      results = response[1];
      break;

    case "yandex":
      response = await fetch(
        `https://suggest.yandex.com/suggest?part=${query}`,
      ).then((i) => i.json());
      results = response[1].map((suggestion) => suggestion);
      break;

    default:
      res.status(400).send("How?");
      return;
  }

  res.send(results);
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
    const upstream = await fetch(
      `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=138.0&acceptformat=crx2,crx3&x=id%3D${id}%26uc`,
    );
    if (!upstream.ok) {
      return res
        .status(upstream.status === 204 ? 404 : 502)
        .json({ error: "The Chrome Web Store has no package for that ID" });
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
const extMetaCache = new Map(); // id -> { at, data }
const EXT_META_TTL = 6 * 60 * 60 * 1000; // 6h
app.get("/v1/api/ext-meta/:id", async (req, res) => {
  const id = req.params.id;
  if (!/^[a-p]{32}$/.test(id)) return res.status(400).json({ error: "Bad extension ID" });

  const hit = extMetaCache.get(id);
  if (hit && Date.now() - hit.at < EXT_META_TTL) {
    res.set("Cache-Control", "public, max-age=21600");
    return res.json(hit.data);
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
    extMetaCache.set(id, { at: Date.now(), data });
    res.set("Cache-Control", "public, max-age=21600");
    res.json(data);
  } catch (error) {
    console.error("[ext-meta]", error?.name || error);
    res.status(502).json({ error: "Could not reach the Chrome Web Store" });
  }
});

// AI STUFF

app.use(cookieParser());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "putyoursecretkeyhere",
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 1000 * 60 * 30,
    },
  }),
);

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
app.get("/csrf-token", (req, res) => {
  req.session.hasSession = true;
  res.json({ csrfToken: generateToken(req, res) });
});

app.post("/ask", express.json({ limit: "12mb" }), requireSession, csrfProtection, async (req, res) => {
  const { messages, model } = req.body;

  if (!Array.isArray(messages)) {
    return res
      .status(400)
      .json({ error: "msgs need to be in an array format." });
  }

  const requestedModel =
    typeof model === "string" && model.trim() ? model.trim() : "shuttleai/auto";

  try {
    const response = await fetch(
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

app.get("/v1/api/user-agents", async (req, res) => {
  let text = await fetch("https://useragents.me/");
  text = await text.text();
  const $ = cheerio.load(text);
  res.send(
    $("#most-common-desktop-useragents-json-csv > div:eq(0) > textarea").val(),
  );
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
