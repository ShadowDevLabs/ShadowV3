self.__uv$config = {
    prefix: "/legacy_uv/service/",
    bare: "/bare/",
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: "/uv/uv.handler.js",
    client: "/uv/uv.client.js",
    bundle: "/uv/uv.bundle.js",
    config: "/uv/uv.config.js",
    sw: "/uv/uv.sw.js",
  };

  self._open = self.open;
  self.open = (url, title, _) => parent.tabs.createTab(url, title);
  
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
  
  self.onload = () => {
    if (typeof window === "object" && self.constructor === Window) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/eruda";
      script.onload = () => {
        self.__shadow.eruda = eruda;
      }
      document.head.append(script);
      document.onclick = (e) => { if(e.target.id !== "__shadow-search-bar") parent.postMessage("hide-suggestions"); }
      try {
        parent.updateOmni();
        parent.setTab();
        //Update history on everything EXCEPT for shadow:// urls
        if (__uv) parent.tabs.updateHistory(__uv.location.href, document.title, `https://www.google.com/s2/favassets/imgs/icons?domain=${__uv.location.href}&sz=24`);
      } catch (e) {
        console.log(`[LOAD] Error in initializing tab: ${e}`);
      }
    }
  }