/*global Ultraviolet*/
self.__uv$config = {
    prefix: "/uv/service/",
    bare: "/bare/",
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: "/uv/uv.handler.js",
    client: "/uv/uv.client.js",
    bundle: "/uv/uv.bundle.js",
    config: "/uv/uv.config.js",
    sw: "/uv/uv.sw.js",
  };
  //NO TOUCHY NC
var extLoaded;
  
  onload = init;
  
  function init() {
    loadExtensions();
    let tries;
    try {
      parent.updateOmni();
      parent.setTab();
    } catch (e) {
      console.warn("Error with sending update request to omnibox, are you in an iframe?",);
      console.log(e);
      if (tries <= 2) setTimeout(init, 2500);
      tries++;
    }
  }
  
  function loadExtensions() {
    if (!extLoaded) {
      try {
        let tag = document.createElement("script");
        tag.src = "/assets/extensions.js";
        extLoaded = true;
        console.log("Extensions loaded!")
        console.log(tag)
      } catch (e) {
        console.warn("Error loading extensions: ",e)
      }
    }
  }
  