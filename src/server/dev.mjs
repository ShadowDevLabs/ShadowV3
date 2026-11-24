// Development mode (npm run dev, via dev.js): no caching. Never loaded in production.
//
// - Every response is sent with no-store, so a manual reload always shows the files as they are.
// - The service worker is served with DEV = true, which turns off its own file cache.
// (Server files restart the process: node --watch. Pages are never reloaded for you.)
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function installDev(app, publicPath) {
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

  console.log("[dev] development mode: obfuscation off, no caching");
}
