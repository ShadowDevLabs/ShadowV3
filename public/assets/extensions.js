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

class Extensions {
    constructor() {
      this.extensions = JSON.parse(localStorage.getItem("extensions"));
      let devExts = []
      this.extensions.forEach(i => {
        if(i.origin !== "store") {
          devExts.append(i.name)
        }
      });
      if(devExts.length !== 0) {
        parent.devAlert(devExts)
      }
    }
    
    load(id) {
      const extension = this.getInfo(id)
      if(!extension || !extension.enabled) {
        switch(extension.features) {
            case menu-bar: 
                parent.updateMenu(extension.features["menu-bar"]);
            default:
                break;
        }
        switch(extension.type) {
          case listen: 
            document.addEventListener("fetch", (i) => {
              eval(code)
            })
          case inject:
          default:
            let tag = document.createElement("script");
            tag.innerHTML = extension.code;
            document.head.append(tag);
        }
      }
    }

    getInfo(id) {
    return JSON.parse(localStorage.getItem("extensions"))[id] || false
    }
}