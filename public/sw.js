importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts(__uv$config.sw || "/uv/uv.sw.js");
importScripts("/dynamic/dynamic.config.js");
importScripts("/dynamic/dynamic.worker.js");

const uv = new UVServiceWorker();
self.dynamic = new Dynamic(self.__dynamic$config);

self.addEventListener("fetch", (event) => {
  if (
    event.request.url.startsWith(location.origin + self.__dynamic$config.prefix)
  )
    event.respondWith(
      (async () => {
        if (await self.dynamic.route(event))
          return await self.dynamic.fetch(event);

        await fetch(event.request);
      })(),
    );
  else if (event.request.url.startsWith(location.origin + __uv$config.prefix))
    event.respondWith((async () => await uv.fetch(event))());
  else event.respondWith((async () => await fetch(event.request))());
});
