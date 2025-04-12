importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts("/uv/uv.client.js");
importScripts(__uv$config.sw || "/uv/uv.sw.js");
importScripts("/assets/js/settings_manager_sw.js")
importScripts("/assets/js/history_helper_sw.js")
self.settings = new SettingsManager();
self.history = new HistoryHelper();


const uv = new UVServiceWorker();
uv.on("request", async (event) => {
  event.data.headers["user-agent"] = await self.settings.get("user-agent") ?? event.data.headers["user-agent"]
});

self.addEventListener("message", (event) => {
  const { reason, data } = event.data
  if(reason === "save-open-tabs") {
    self.history.setOpen(data); 
  }
})

self.addEventListener("fetch", async (event) => {
  if (event.request.url.startsWith(location.origin + __uv$config.prefix)) {
    event.respondWith((async () => await uv.fetch(event))());
  }
  else event.respondWith((async () => await fetch(event.request))());
});