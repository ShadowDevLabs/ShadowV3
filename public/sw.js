// Shadow service worker.
//
// With Scramjet v2 the worker is only a router for proxied traffic: those
// requests are forwarded over a MessagePort to the page's Controller, which does
// the rewriting and the network I/O. Extension resources (chrome-extension://…)
// are served by Sapphire. On top of that, it stale-while-revalidate caches
// Shadow's own static assets so repeat visits are instant and the origin (and
// the mirror fleet) take far fewer hits.
importScripts("/dist/sapphire-sw-router.js");
importScripts("/controller/controller.sw.js");
importScripts("/assets/js/settings_manager_sw.js");
importScripts("/assets/js/history_helper_sw.js");

self.settings = new SettingsManager();
self.history = new HistoryHelper();

// Bump to invalidate the static cache after a shell asset change that can't wait
// for the background refresh (rare — SWR already keeps assets fresh within a load).
const STATIC_CACHE = "shadow-static-v1";
const CACHEABLE_EXT = /\.(css|js|mjs|png|jpe?g|svg|ico|webp|gif|woff2?|ttf|otf|json|wasm)$/i;
// Never cache: the proxy runtime routes, the live config/transport, API responses.
const NO_CACHE = /^\/(wisp|epoxy|libcurl|v1\/api)(\/|$)/;

function isCacheableStatic(url, request) {
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    request.mode !== "navigate" &&
    CACHEABLE_EXT.test(url.pathname) &&
    !NO_CACHE.test(url.pathname)
  );
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok && res.type === "basic") cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("shadow-static-") && k !== STATIC_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const { reason, data } = event.data ?? {};
  if (reason === "save-open-tabs") {
    event.waitUntil?.(self.history.setOpen(data));
  }
});

self.addEventListener("fetch", (event) => {
  if ($sapphireRouter.shouldRoute(event)) {
    event.respondWith($sapphireRouter.route(event));
    return;
  }
  if ($scramjetController.shouldRoute(event)) {
    event.respondWith($scramjetController.route(event));
    return;
  }
  // Shadow's own static assets: serve from cache, refresh in the background.
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }
  if (isCacheableStatic(url, event.request)) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
  // Everything else (navigations, APIs, the proxy) goes to the network untouched.
});
