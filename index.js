import compression from "compression";
import express from "express";
import wisp from "wisp-server-node";
import * as cheerio from "cheerio"
import { createServer } from "http";
import { fileURLToPath } from "url";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { dynamicPath } from "@nebula-services/dynamic";
import { join } from "path";
const publicPath = fileURLToPath(new URL("./public/", import.meta.url));
let port = 8080;
const app = express();
const server = createServer();
app.use(compression());
app.use(express.static(publicPath, { maxAge: 604800000 })); //1 week
app.use("/epoxy/", express.static(epoxyPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/uv/", express.static(uvPath));
app.use("/dynamic/", express.static(dynamicPath));
app.use("/privacy", express.static(publicPath + '/privacy.html'));

app.get("/search-api", async (req, res) => {
  const response = await fetch(`http://api.duckduckgo.com/ac?q=${req.query.term}&format=json`).then((i) => i.json());
  res.send(response);
})

app.get("/user-agents", async (req, res) => {
    let text = await fetch("https://useragents.me/")
    text = await text.text()
    const $ = cheerio.load(text)
    res.send($('#most-common-desktop-useragents-json-csv > div:eq(0) > textarea').val())
})

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
  else
    socket.end();
});

server.on("listening", () => {
  const address = server.address();;
  console.log('\n\n\n\n\n\n\n\n\x1b[35m\x1b[2m\x1b[1m%s\x1b[0m\n', 'Shadow has started!\nSprinting on port ' + address.port);
  setTimeout(function(){console.log('\n')}, 750)
  setTimeout(function(){console.log('\n')}, 1000)
  setTimeout(function(){console.log(`
┌────────────┬─────────────┬────────────┐
│ wisp       │ browser     │ api        │
├────────────┼─────────────┼────────────┤
│ \x1b[32mrunning   \x1b[0m │ \x1b[32mrunning    \x1b[0m │ \x1b[32mrunning    \x1b[0m│
└────────────┴─────────────┴────────────┘
`);}, 1500)

});

server.listen(port);
