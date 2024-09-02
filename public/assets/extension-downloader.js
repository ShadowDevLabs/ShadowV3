class ExtensionDownloader extends Extensions {
  async download(id) {
    const i = await fetch(`${location.host}/v1/extensions/ext?${id}`);
    if (i.status != "404") {
      let exts = localStorage.getItem("extensions");
      exts[i.constructor.name] = JSON.parse(i[info]);
      localStorage.setItem("extensions", exts);
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
