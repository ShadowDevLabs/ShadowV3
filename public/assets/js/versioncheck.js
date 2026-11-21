// After a deploy, drop the service worker's cached copies of Shadow's own files
// and reload once, so nobody keeps running a mix of old and new scripts.
import { SettingsManager } from "./settings_manager.js";

const settings = new SettingsManager();
const RELOADED = "shadow-version-reload";

async function checkVersion() {
  let current;
  try {
    const res = await fetch("/v1/api/version", { cache: "no-store" });
    if (!res.ok) return;
    current = (await res.text()).trim();
  } catch {
    return; // offline: nothing to compare against
  }
  if (!current) return;
  const known = await settings.get("version");
  if (known === current) return sessionStorage.removeItem(RELOADED);
  await settings.set("version", current);
  // First visit: there's nothing older to throw away.
  if (known === undefined) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("shadow-")).map((key) => caches.delete(key)));
  } catch {}
  // Once per session at most, whatever happens above.
  if (sessionStorage.getItem(RELOADED)) return;
  sessionStorage.setItem(RELOADED, "1");
  window.onbeforeunload = null;
  location.reload();
}

if (document.readyState === "complete") checkVersion();
else window.addEventListener("load", checkVersion, { once: true });
