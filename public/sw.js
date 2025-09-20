importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts("/uv/uv.client.js");
importScripts(__uv$config.sw || "/uv/uv.sw.js");
importScripts("/assets/js/settings_manager_sw.js");
importScripts("/assets/js/history_helper_sw.js");
importScripts("/scram/scramjet.all.js");

self.settings = new SettingsManager();
self.history = new HistoryHelper();

const uv = new UVServiceWorker();

let scramjet;
try {
  const { ScramjetServiceWorker } = $scramjetLoadWorker();
  scramjet = new ScramjetServiceWorker();
} catch (e) {
  console.error("[SW] Failed to initialize Scramjet service worker:", e);
  scramjet = null;
}

uv.on("request", async (event) => {
  event.data.headers["user-agent"] =
    (await self.settings.get("user-agent")) ?? event.data.headers["user-agent"];
});

self.addEventListener("message", (event) => {
  const { reason, data } = event.data;
  if (reason === "save-open-tabs") {
    self.history.setOpen(data);
  }
});

self.addEventListener("fetch", async (event) => {
  const url = event.request.url;
  
  try {
    if (scramjet && url.includes('/scramjet/')) {
      let shouldHandle = false;
      try {
        shouldHandle = scramjet.route && scramjet.route(event);
      } catch (routeError) {
        shouldHandle = true;
      }
      
      if (shouldHandle) {
        event.respondWith((async () => {
          try {
            return await scramjet.fetch(event);
          } catch (e) {
            console.error("[SW] Scramjet fetch error:", e);
            return new Response(`Scramjet Error: ${e.message}`, { status: 500 });
          }
        })());
        return;
      }
    }
    
    if (typeof __uv$config !== 'undefined' && url.startsWith(location.origin + __uv$config.prefix)) {
      event.respondWith((async () => {
        try {
          return await uv.fetch(event);
        } catch (e) {
          console.error("[SW] UV fetch error:", e);
          return new Response(`UV Error: ${e.message}`, { status: 500 });
        }
      })());
      return;
    }
    
    event.respondWith((async () => {
      try {
        return await fetch(event.request);
      } catch (e) {
        console.error("[SW] Normal fetch error:", e);
        return new Response(`Fetch Error: ${e.message}`, { status: 500 });
      }
    })());
    
  } catch (e) {
    console.error("[SW] General fetch handler error:", e);
    event.respondWith((async () => {
      return new Response(`Service Worker Error: ${e.message}`, { status: 500 });
    })());
  }
});