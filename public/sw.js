importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts(__uv$config.sw || "/uv/uv.sw.js");
importScripts("/assets/settings_manager_sw.js")
self.settings = new SettingsManager();


const uv = new UVServiceWorker();
uv.on("request", async (event) => {
  event.data.headers["user-agent"] = await self.settings.get("user-agent") ?? event.data.headers["user-agent"]
});


self.addEventListener("fetch", async (event) => {
  if (event.request.url.startsWith(location.origin + __uv$config.prefix)) {
    event.respondWith((async () => await uv.fetch(event))());
  }
  else event.respondWith((async () => await fetch(event.request))());
});