import express from "express";
import basicAuth from "express-basic-auth"
import wisp from "wisp-server-node";
import * as cheerio from "cheerio";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { bareModulePath } from "@mercuryworkshop/bare-as-module3"
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { createBareServer } from "@nebula-services/bare-server-node";
import { dynamicPath } from "@nebula-services/dynamic";
// import { path as gamesPath } from "3hk0-static";
import { join } from "path";
import { users, port, brokenSites } from "./config.js";
const version = process.env.npm_package_version;
const publicPath = fileURLToPath(new URL("./public/", import.meta.url));
const bare = createBareServer("/bare/");
const app = express();
const server = createServer();
if (Object.keys(users).length > 0) app.use(basicAuth({ users, challenge: true }));
app.use(express.static(publicPath, { maxAge: 604800000 })); //1 week
// app.use("/books/files/", express.static(gamesPath))
app.use("/epoxy/", express.static(epoxyPath));
app.use("/libcurl/", express.static(libcurlPath));
app.use("/baremod/", express.static(bareModulePath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/uv/", express.static(uvPath));
app.use("/dynamic/", express.static(dynamicPath));
app.use("/privacy", express.static(publicPath + "/privacy.html"));

app.get("/api/version", (req, res) => {
  if (req.query.v && req.query.v != version) {
    res.status(400).send(version);
    return;
  }
  res.status(200).send(version);
});

app.get("/api/broken-site", async (req, res) => {
  res.status(200).send(await brokenSites());
})

app.get("/api/search-api", async (req, res) => {
  let response;
  let results = [];
  const query = req.query.query;
switch (req.headers.engine) {
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
    console.log(response[1])
    results = response[1];
    break;

  case "yandex":
    response = await fetch(
      `https://suggest.yandex.com/suggest?part=${query}`
    ).then((i) => i.json());
    results = response[1].map(suggestion => suggestion);
    break;

  default:
    res.status(400).send('Unsupported search engine');
    return;
}

res.send(results);
});


app.get("/api/user-agents", async (req, res) => {
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
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else if (req.url.endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
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
│ Wisp       │ Bare        │ API's      │
├────────────┼─────────────┼────────────┤
│ \x1b[32mrunning   \x1b[0m │ \x1b[32mrunning    \x1b[0m │ \x1b[32mrunning    \x1b[0m│
└────────────┴─────────────┴────────────┘
`);
  }, 1500);
});

server.listen(process.argv[2] || port);
