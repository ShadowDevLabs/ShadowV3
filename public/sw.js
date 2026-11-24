// Shadow service worker.
//
// Proxied requests go to the page's Controller for rewriting. Sapphire serves extension files.
// Shadow's own assets are cached stale-while-revalidate, the shell is precached, and pages work offline.
importScripts("/dist/sapphire-sw-router.js");
importScripts("/controller/controller.sw.js");
importScripts("/assets/js/settings_manager_sw.js");
importScripts("/assets/js/history_helper_sw.js");

self.settings = new SettingsManager();
self.history = new HistoryHelper();

// Bump to invalidate the static cache when a change can't wait for the background refresh.
const STATIC_CACHE = "shadow-static-v3";
// Shadow's own HTML pages, kept for offline use (network first, see pageRequest()).
const PAGE_CACHE = "shadow-pages-v1";
const CACHEABLE_EXT = /\.(css|js|mjs|png|jpe?g|svg|ico|webp|gif|woff2?|ttf|otf|json|wasm)$/i;
// Never cache: the proxy runtime routes, the live config/transport, API responses.
const NO_CACHE = /^\/(wisp|epoxy|libcurl|v1\/api)(\/|$)/;

// The dev server (src/server/dev.mjs) serves this file with DEV = true: nothing is cached, so an
// edited file shows on the next reload.
const DEV = false;

function isCacheableStatic(url, request) {
  return (
    !DEV &&
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

// Fetched at install so the shell works offline from the first visit. Missing entries are skipped.
const PRECACHE_PAGES = [
  "/",
  "/new.html",
  "/history.html",
  "/downloads.html",
  "/home/",
  "/books/",
  "/settings/",
  "/pages/embed/",
  "/pages/new.html",
  "/pages/home.html",
  "/pages/books.html",
  "/pages/games.html",
  "/pages/history.html",
  "/pages/downloads.html",
  "/pages/settings.html",
];
const PRECACHE_ASSETS = [
  ...["index", "loading", "themes", "shell", "features", "main", "home", "books", "history", "settings"].map((n) => `/css/${n}.css`),
  ...[
    "autoblank", "settings", "debugger", "versioncheck", "search", "options", "themes", "tabs", "bookmarks", "sync", "pwa",
    "history_helper", "settings_manager", "extension_ui", "ui", "site-patches", "features", "downloads", "sitesettings",
    "workspaces", "pagetools", "tabgroups", "tabaudio", "main", "history",
  ].map((n) => `/assets/js/${n}.js`),
  "/assets/data/site-patches.json",
  "/books/script.js",
  "/books/learningcourses.json",
  "/home/script.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/assets/imgs/icons/logo.png",
  "/assets/imgs/icons/app/icon-192.png",
];

// Shadow's pages are static and only read their query string client-side, so one
// cached copy per path serves every ?url=… variant.
const pageKey = (url) => url.origin + url.pathname;

// With obfuscation on, the server fills this with its random CSS/JS paths, replacing the ones in
// PRECACHE_ASSETS. Older cached CSS/JS is dropped on activate.
const UI_ASSETS = null;

async function precache() {
  if (DEV) return;
  const pages = await caches.open(PAGE_CACHE);
  const assets = await caches.open(STATIC_CACHE);
  const add = async (cache, path, key) => {
    try {
      const res = await fetch(path, { credentials: "same-origin" });
      if (res.ok && res.type === "basic") await cache.put(key, res);
    } catch {}
  };
  await Promise.all([
    ...PRECACHE_PAGES.map((path) => add(pages, path, self.location.origin + path)),
    ...(UI_ASSETS ? [...UI_ASSETS, ...PRECACHE_ASSETS.filter((path) => !/\.(?:css|m?js)$/.test(path))] : PRECACHE_ASSETS)
      .map((path) => add(assets, path, path)),
  ]);
}

/** Navigations to Shadow's own pages: network first, cached copy when offline. */
async function pageRequest(request, url) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") cache.put(pageKey(url), res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(pageKey(url));
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("shadow-static-") && k !== STATIC_CACHE).map((k) => caches.delete(k)));
      if (UI_ASSETS) {
        const current = new Set(UI_ASSETS);
        const assets = await caches.open(STATIC_CACHE);
        for (const request of await assets.keys()) {
          const { pathname } = new URL(request.url);
          if (/\.(?:css|m?js)$/.test(pathname) && !current.has(pathname)) await assets.delete(request);
        }
      }
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
    return;
  }
  if (
    event.request.mode === "navigate" &&
    event.request.method === "GET" &&
    url.origin === self.location.origin &&
    !NO_CACHE.test(url.pathname)
  ) {
    event.respondWith(pageRequest(event.request, url));
  }
  // Everything else (APIs, the proxy runtime) goes to the network untouched.
});
