//NO TOUCHY
//Steal 95% of the code from inject.js and add proper extension loading and stuffs
/* 
Manifest layout: 
{
  "id": {
    "enabled": true
    "name": "",
    "code": "",
    "icon": "",
    "features": {
      "menu-bar": {
        "icon": "",
        "onclick": "",
        "label": ""
      }
      TODO: Add permissions for manipulating tabs (Open, close, load, etc)
    }
  }
}

*/

import { SettingsManager } from "./settings_manager.js";

class Extensions {
  constructor() {
    this.settings = new SettingsManager();
    (async function () {
      this.extensions = await this.settings.get("extensions");
      init(await checkDev());
    })();
  }

  init(a) {
    this.extensions.forEach((i) => {
      if (!a.includes(i)) {
        this.load(i.constructor.name /* Extension ID*/);
      } else {
        console.log(
          `[EXT] Extension with ID ${i.constructor.name} will not be loaded. User denied due to being a ${i.origin} extension`,
        );
      }
    });
  }

  async checkDev() {
    let devExts = [];
    this.extensions.forEach((i) => {
      if (i.origin !== "store") {
        devExts.append(i.name);
      }
    });
    if (devExts.length > 0 && (await parent.devAlert(devExts))) {
      return [];
    }
    return devExts;
  }

  load(id) {
    const extension = this.get(id);
    if (extension && extension.enabled) {
      switch (extension.features) {
        case menu - bar:
          parent.updateMenu(extension.features["menu-bar"]);
          break;
        default:
          break;
      }
      switch (extension.type) {
        case listen:
          document.addEventListener("fetch", (i) => {
            eval(extension.code);
          });
          break;
        case run:
          eval(extension.code);
          break;
        default:
          let tag = document.createElement("script");
          tag.innerHTML = extension.code;
          document.head.append(tag);
          break;
      }
    }
  }

  get(id) {
    this.update();
    return this.extensions[id] || false;
  }
  get(id) {
    this.update();
    return this.extensions[id] || false;
  }

  async update() {
    this.extensions = await this.settings.get("extensions");
  }
}
