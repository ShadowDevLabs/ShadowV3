import { SettingsManager } from "./settings_manager.js";

const settings = new SettingsManager();

onload = async () => {
  if (
    (await fetch("/v1/api/version")).headers["version"] !=
    await settings.get("version")
  ) {
    caches.keys().then((list) => list.map((key) => caches.delete(key)));
    await settings.set("version", (await fetch("/v1/api/version")).headers["version"]);
    location.reload();
  }
};