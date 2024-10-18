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

self.__shadow = {
  erudaState: false,
  eruda: null
}

self.addEventListener("message", (e) => {
  if (e.data === "__shadow$toggleEruda") {
    if (__shadow.eruda._devTools && !__shadow.eruda._devTools._isShow) { 
      __shadow.erudaState = true;
      __shadow.eruda.show();
    } else if (__shadow.erudaState) {
      __shadow.erudaState = false;
      __shadow.eruda.destroy();
    } else {
      __shadow.erudaState = true;
      __shadow.eruda.init();
      __shadow.eruda.show();
    }
  }
})

if (typeof window === "object" && self.constructor === Window) {
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/eruda";
  script.onload = () => {
    self.__shadow.eruda = eruda
  }
  document.head.append(script);
  try {
    parent.tabs.updateOmni();
    parent.tabs.setTab();
  } catch (e) {
    console.log(`error in updating omnibox: ${e}`)
  }
}
