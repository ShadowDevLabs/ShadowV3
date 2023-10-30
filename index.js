import compression from "compression";
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { join } from "path";
import { hostname } from "os";
import cors from "cors";
import { createBareServer } from "@tomphttp/bare-server-node";
const publicPath = fileURLToPath(new URL("./public/", import.meta.url));

let port = 8080;

const bare = createBareServer("/bare/");
const app = express();
const server = createServer();

app.use(compression());
app.use(cors());
app.use(express.static(publicPath, { maxAge: "1y" }));

app.use("/uv/", express.static(uvPath));

app.use((req, res) => {
  res.status(404);
  res.sendFile(join(publicPath, "404.html"));
});

server.on("request", (req, res) => {
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

server.on("listening", () => {
  const address = server.address();

  console.log("Listening on:");
  console.log(`\thttp://localhost:${address.port}`);
  console.log(`\thttp://${hostname()}:${address.port}`);
  console.log(
    `\thttp://${
      address.family === "IPv6" ? `[${address.address}]` : address.address
    }:${address.port}`
  );
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close();
  bare.close();
}

server.listen(port);
