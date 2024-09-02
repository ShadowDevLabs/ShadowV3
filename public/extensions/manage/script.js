/*
extension = {
    enabled: true,
    name: extName,
    icon: extIcon,
    description: extDesc,
    code: extCode
  }
*/

class ExtensionsLoader {
  constructor() {
    this.extensions = JSON.parse(localStorage.getItem("extensions"));
    this.container = document.getElementsByClassName("extensions-list")[0];
    this.default = document.getElementsByClassName("extension")[0];
    Object.keys(this.extensions).forEach((i) => {
      this.load(i);
    });
  }

  load(ext) {
    let i = this.default.cloneNode(true);
    i.setAttribute("__ext-id", ext);
    let img = i.getElementsByClassName("__ext-img")[0];
    let name = i.getElementsByClassName("__ext-name")[0];
    let desc = i.getElementsByClassName("__ext-desc")[0];
    ext = this.extensions[ext];
    if (!ext.enabled) {
      i.getElementsByClassName("switch")[1].checked = false;
    }
    img.src = ext.icon;
    name.innerText = ext.name;
    desc.innerText = ext.description;
    let x = this.container.children.length;
    i.setAttribute("num", x);
    i.getElementsByClassName("slider")[0].setAttribute(
      "for",
      `toggleSwitch${x}`,
    );
    i
      .getElementsByClassName("switch")[0]
      .getElementsByClassName("switch")[0].id = `toggleSwitch${x}`;
    this.container.appendChild(i);
  }
}
