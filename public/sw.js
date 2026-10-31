importScripts("/controller/controller.sw.js");
importScripts("/assets/js/history_helper_sw.js")
self.history = new HistoryHelper();

self.addEventListener("message", (event) => {
  const { reason, data } = event.data
  if(reason === "save-open-tabs") {
    self.history.setOpen(data);
  }
})

self.addEventListener("fetch", (event) => {
  if ($scramjetController.shouldRoute(event)) {
    event.respondWith($scramjetController.route(event));
  }
  // Files are cached for a week, revalidate the app's own pages, scripts and styles so a deploy reaches returning visitors.
  // Everything else (images, fonts, game files, ?v= pinned scripts) keeps the normal HTTP cache.
  else {
    const { request } = event;
    const url = new URL(request.url);
    const isAppFile = request.mode === "navigate" || ((request.destination === "script" || request.destination === "style") && !url.search);
    if (url.origin === location.origin && isAppFile && !url.pathname.startsWith("/books/files/")) {
      event.respondWith(fetch(request, { cache: "no-cache" }));
    }
  }
});
