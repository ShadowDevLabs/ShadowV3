// Shadow service worker.
//
// With Scramjet v2 the worker is only a router: proxied requests are forwarded
// over a MessagePort to the page's Controller, which does the rewriting and the
// network I/O. Extension resources (chrome-extension://…) are served by Sapphire.
importScripts("/dist/sapphire-sw-router.js");
importScripts("/controller/controller.sw.js");
importScripts("/assets/js/settings_manager_sw.js");
importScripts("/assets/js/history_helper_sw.js");

self.settings = new SettingsManager();
self.history = new HistoryHelper();

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
  }
  // Everything else (Shadow's own pages and assets) goes to the network untouched.
});
