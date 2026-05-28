import express from "express";
import basicAuth from "express-basic-auth";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import http from "http";
import cookieParser from "cookie-parser";
import * as cheerio from "cheerio";
import { doubleCsrf } from "csrf-csrf";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { join } from "path";
import { users, port, brokenSites } from "./config.js";
import session from "express-session";

import dotenv from "dotenv";
dotenv.config();

const version = process.env.npm_package_version;
const publicPath = fileURLToPath(new URL("./public/", import.meta.url));
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
app.use("/epoxy/", express.static(epoxyPath));
app.use("/libcurl/", express.static(libcurlPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/uv/", express.static(uvPath));
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
  const query = req.query.query;
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

const AI_MINUTE_LIMIT = 10;
const AI_DAY_LIMIT = 250;
const AI_MINUTE_WINDOW_MS = 60 * 1000;
const DEFAULT_AI_MODEL = "gpt-5.4-mini";
const AI_MODELS = new Set([
  DEFAULT_AI_MODEL,
  "gpt-5.4",
  "claude-sonnet-4.6",
  "gemini-3-flash-preview",
]);
const aiRequestLimits = new Map();

function getDayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function getRateLimitKey(req) {
  return (
    req.get("x-shadow-fingerprint")?.trim() || req.sessionID || req.ip || "anonymous"
  );
}

function readMessageText(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === "text" ? String(part.text || "") : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

function getModelName(model) {
  if (typeof model !== "string") return DEFAULT_AI_MODEL;

  const trimmed = model.trim();
  return trimmed && AI_MODELS.has(trimmed) ? trimmed : DEFAULT_AI_MODEL;
}

async function postAiRequest(messages, model) {
  const response = await fetch("https://api.navy/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NAVY_API_KEY}`,
    },
    body: JSON.stringify({ messages, model }),
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMessage = data?.error?.message || data?.error || "AI provider request failed";
    return { ok: false, status: response.status, error: errorMessage };
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) {
    return { ok: false, status: 500, error: "Unexpected response from AI API" };
  }

  return { ok: true, reply };
}

function getAiLimitState(limitKey, now) {
  const currentDay = getDayKey(now);
  const existingState = aiRequestLimits.get(limitKey);

  if (!existingState) {
    const freshState = {
      dayKey: currentDay,
      dayCount: 0,
      minuteHits: [],
    };
    aiRequestLimits.set(limitKey, freshState);
    return freshState;
  }

  existingState.minuteHits = existingState.minuteHits.filter(
    (hitTime) => now - hitTime < AI_MINUTE_WINDOW_MS,
  );

  if (existingState.dayKey !== currentDay) {
    existingState.dayKey = currentDay;
    existingState.dayCount = 0;
  }

  return existingState;
}

function checkAiRateLimit(req) {
  const now = Date.now();
  const limitKey = getRateLimitKey(req);
  const state = getAiLimitState(limitKey, now);

  if (state.minuteHits.length >= AI_MINUTE_LIMIT) {
    const oldestHit = state.minuteHits[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((AI_MINUTE_WINDOW_MS - (now - oldestHit)) / 1000),
    );
    return {
      allowed: false,
      status: 429,
      error: "Rate limit reached. Try again in a minute.",
      retryAfterSeconds,
    };
  }

  if (state.dayCount >= AI_DAY_LIMIT) {
    const nextReset = new Date(now);
    nextReset.setUTCHours(24, 0, 0, 0);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((nextReset.getTime() - now) / 1000),
    );
    return {
      allowed: false,
      status: 429,
      error: "Daily rate limit reached. Try again tomorrow.",
      retryAfterSeconds,
    };
  }

  state.minuteHits.push(now);
  state.dayCount += 1;
  aiRequestLimits.set(limitKey, state);

  return { allowed: true };
}

app.post("/ask", express.json({ limit: "12mb" }), requireSession, csrfProtection, async (req, res) => {
  const { messages, model } = req.body;

  if (!Array.isArray(messages)) {
    return res
      .status(400)
      .json({ error: "msgs need to be in an array format." });
  }

  const rateLimitCheck = checkAiRateLimit(req);
  if (!rateLimitCheck.allowed) {
    if (typeof rateLimitCheck.retryAfterSeconds === "number") {
      res.setHeader("Retry-After", String(rateLimitCheck.retryAfterSeconds));
    }
    return res.status(rateLimitCheck.status).json({ error: rateLimitCheck.error });
  }

  const selectedModel = getModelName(model);
  const aiResult = await postAiRequest(messages, selectedModel);

  if (!aiResult.ok) {
    return res.status(aiResult.status).json({ error: aiResult.error });
  }

  res.json({
    model: selectedModel,
    message: aiResult.reply,
  });
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
