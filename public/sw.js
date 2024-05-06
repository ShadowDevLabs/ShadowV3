importScripts("/epoxy/index.js");
importScripts("/bareTransport.js");
importScripts("/bareTransport.js");
importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts(__uv$config.sw || "/uv/uv.sw.js");
importScripts("/dynamic/dynamic.config.js");
importScripts("/dynamic/dynamic.worker.js");

const uv = new UVServiceWorker();
const dyn = new Dynamic(self.__dynamic$config);

self.addEventListener("fetch", (event) => {
  if (event.request.url.startsWith(location.origin + self.__dynamic$config.prefix)) {
    event.respondWith((async function () {
        try {
          await dyn;
        } catch (error) {}
        if (await self.dynamic.route(event)) {
          return await self.dynamic.fetch(event);
        }
        await fetch(event.request);
      })()
    );
  } else if (event.request.url.startsWith(location.origin + __uv$config.prefix)) {
    event.respondWith(
      (async function () {return await uv.fetch(event);})()
    );
  } else {
    event.respondWith((async function () {
        return await fetch(event.request);
      })()
    );
  }
});