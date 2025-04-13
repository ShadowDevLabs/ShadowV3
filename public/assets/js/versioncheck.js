import { SettingsManager } from "./settings_manager.js";

const settings = new SettingsManager();

onload = async () => {
  if (
    (await fetch("/version")).headers["version"] !=
    await settings.get.getItem("version")
  )
    caches.keys().then((list) => list.map((key) => caches.delete(key)));
  location.reload();
};
