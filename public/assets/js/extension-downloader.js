import { SettingsManager } from "./settings_manager.js";

class ExtensionDownloader extends Extensions {
  constructor() {
    this.settings = new SettingsManager();
  }

  async download(id) {
    const i = await fetch(`${location.host}/v1/extensions/ext?${id}`);
    if (i.status !== 404) {
      let exts = this.settings.get("extensions");
      exts[i.constructor.name] = JSON.parse(i[info]);
      this.settings.set("extensions", exts);
      return true;
    } else {
      console.log("Extension ID not found");
      return false;
    }
  }

  async getInfo(id) {
    const i = await fetch(`${location.host}/v1/extensions/info?${id}`);
    return 0;
  }
}
