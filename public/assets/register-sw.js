const stockSW = "/uv/sw.js";
const isServiceWorkerSupported = 'serviceWorker' in navigator;
if('undefined' === typeof window) importScripts("https://cdn.rawgit.com/mozilla/localForage/master/dist/localforage.js");

function isLocalhost() {
  return (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname.startsWith("192.168.")
  );
}

async function registerSW() {
  if (!isServiceWorkerSupported) {
    return Promise.reject(new Error("Your browser doesn't support service workers."));
  }

  if (location.protocol === "https:" || isLocalhost()) {
    return navigator.serviceWorker.register(stockSW, {
      scope: __uv$config.prefix,
    });
  } else {
    return Promise.reject(new Error("Service workers cannot be registered without HTTPS."));
  }
}



