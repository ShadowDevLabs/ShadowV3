import express from "express";
import basicAuth from "express-basic-auth"
import wisp from "wisp-server-node";
import http from "http";
import cookieParser from 'cookie-parser';
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

import dotenv from 'dotenv';
dotenv.config();

const version = process.env.npm_package_version;
const publicPath = fileURLToPath(new URL("./public/", import.meta.url));
const app = express();
const server = createServer();
if (Object.keys(users).length > 0) app.use(basicAuth({ users, challenge: true }));
app.use(express.static(publicPath, { maxAge: 604800000 })); //1 week
app.use('/books/files/', (req, res) => {
    const sourceUrl = `http://phantom.lol/books/files${req.url}`;
    http.get(sourceUrl, (sourceResponse) => {
        res.writeHead(sourceResponse.statusCode, sourceResponse.headers);
        sourceResponse.pipe(res);
    }).on('error', (err) => {
        res.statusCode = 500;
        res.end(`Error fetching file: ${err.message}`);
    });
});
app.use("/epoxy/", express.static(epoxyPath));
app.use("/libcurl/", express.static(libcurlPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/uv/", express.static(uvPath));
app.use("/privacy", express.static(publicPath + "/privacy.html"));

app.get("/v1/api/version", (req, res) => {
    if (req.query.v && req.query.v != version) {
        res.status(400).send(version);
        return;
    }
    res.status(200).send(version);
});

app.get("/v1/api/broken-sites", async (req, res) => {
    res.status(200).send(await brokenSites());
})

app.get("/v1/api/search-suggestions", async (req, res) => {
    let response;
    let results = [];
    const query = req.query.query;
    switch (req.headers.engine ?? "google") {
        case "duckduckgo":
            response = await fetch(
                `http://api.duckduckgo.com/ac?q=${query}&format=json`
            ).then((i) => i.json());
            results = response.map(result => result.phrase);
            break;

        case "google":
            response = await fetch(
                `http://suggestqueries.google.com/complete/search?client=firefox&q=${query}`
            ).then((i) => i.json());
            results = response[1];
            break;

        case "yandex":
            response = await fetch(
                `https://suggest.yandex.com/suggest?part=${query}`
            ).then((i) => i.json());
            results = response[1].map(suggestion => suggestion);
            break;

        default:
            res.status(400).send('How?');
            return;
    }

    res.send(results);
});


// AI STUFF

app.use(cookieParser()); 
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "putyoursecretkeyhere",
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 1000 * 60 * 30
  }
}));

const { generateToken, validateRequest } = doubleCsrf({
  getSecret: () => "your-secret-key",
  cookieName: undefined,
  size: 64,
  getTokenFromRequest: (req) => req.headers["x-csrf-token"]
});

// Middleware to protect routes
const csrfProtection = (req, res, next) => {
  try {
    validateRequest(req, res);
    next();
  } catch (error) {
    res.status(403).json({
      error: "Invalid CSRF token",
      message: error.message
    });
  }
};

function requireSession(req, res, next) {
  if (req.session?.hasSession) return next();
  res.status(401).json({ error: "Missing or invalid session" });
}

// Route to get CSRF token
app.get('/csrf-token', (req, res) => {
  req.session.hasSession = true;
  res.json({ csrfToken: generateToken(req, res) });
});


const models = ["gpt-5-mini", "shuttle-3.5", "gpt-5"];
app.post('/ask', requireSession, csrfProtection, async (req, res) => {
    const { messages, model } = req.body;
    const temperature = req.body.temperature || 0.7;
    const max_tokens = req.body.max_tokens || 512;

    if (!Array.isArray(messages)) {
        return res.status(400).json({ error: 'msgs need to be in an array format.' });
    }

    const requestedModel = models.includes(model) ? model : "shuttle-3.5";

    try {
        const response = await fetch("https://api.shuttleai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.SHUTTLEAI_API_KEY}`
            },
            body: JSON.stringify({
                model: requestedModel,
                messages
        })
        });

        const data = await response.json();

        if (!data?.choices?.[0]?.message?.content) {
            console.error("Unexpected response:", data);
            return res.status(500).json({ error: "Unexpected response from AI API" });
        }

        res.json({
            model: requestedModel,
            message: data.choices[0].message.content
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

server.on("request", (req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    app(req, res);
});

server.on("upgrade", (req, socket, head) => {
    if (req.url.endsWith("/wisp/"))
        wisp.routeRequest(req, socket, head);
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
