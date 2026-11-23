// Development mode (npm run dev, via dev.js): no caching, live reload. Never loaded in production.
//
// - Every response is sent with no-store, so the browser never keeps an old file.
// - The service worker is served with DEV = true, which turns off its own file cache.
// - Every HTML page gets a tiny script that listens on /__dev/reload and reloads the window
//   when anything under public/ changes. (Server files restart the process: node --watch.)
import { watch, readFileSync, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const CLIENT = `<script>(()=>{if(window!==top)return;const s=new EventSource("/__dev/reload");s.onmessage=()=>location.reload();})()</script>`;

export function installDev(app, publicPath) {
  const clients = new Set();
  let timer;
  watch(publicPath, { recursive: true }, (event, file) => {
    if (!file || /(^|[\\/])dist[\\/]/.test(file)) return; // build output, not a source edit
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`[dev] ${file} changed, reloading`);
      for (const res of clients) res.write("data: reload\n\n"), res.flush?.();
    }, 80); // an editor's save is often several writes
  });

  app.get("/__dev/reload", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.flushHeaders();
    res.write(": connected\n\n");
    res.flush?.();
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });

  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const setHeader = res.setHeader.bind(res);
    // express.static sets its own Cache-Control later; keep ours.
    res.setHeader = (name, value) => (name.toLowerCase() === "cache-control" ? res : setHeader(name, value));
    next();
  });

  app.get("/sw.js", (req, res) => {
    const sw = readFileSync(join(publicPath, "sw.js"), "utf8").replace("const DEV = false;", "const DEV = true;");
    res.type("js").send(sw);
  });

  app.get(/(\.html|\/)$/, (req, res, next) => {
    let path;
    try { path = decodeURIComponent(req.path); } catch { return next(); } // a malformed address: the normal 404
    const file = normalize(join(publicPath, path, req.path.endsWith("/") ? "index.html" : ""));
    if (!file.startsWith(normalize(publicPath)) || !existsSync(file) || !statSync(file).isFile()) return next();
    const html = readFileSync(file, "utf8");
    const end = html.lastIndexOf("</body>"); // the last one: a script may spell "</body>" in a string
    res.type("html").send(end < 0 ? html + CLIENT : html.slice(0, end) + CLIENT + html.slice(end));
  });

  console.log("[dev] development mode: obfuscation off, no caching, live reload on");
}
