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

if (typeof window === "object" && self.constructor === Window) {
  try {
    parent.tabs.updateOmni();
  } catch(e) {
    console.log(`error in updating omnibox: ${e}`)
  }
}
