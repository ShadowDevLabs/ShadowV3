importScripts('/baremux/index.mjs')
importScripts('/epoxy/index.js');
importScripts('/uv/uv.bundle.js');
importScripts('/uv/uv.config.js');
importScripts('/uv/uv.sw.js');
importScripts('/dynamic/dynamic.config.js');
importScripts('/dynamic/dynamic.client.js');
importScripts('/dynamic/dynamic.worker.js');
importScripts('/dynamic/dynamic.handler.js');

const uv = new UVServiceWorker();

self.addEventListener('fetch', event => {
    event.respondWith(
        (async ()=>{
            if(event.request.url.startsWith(location.origin + __uv$config.prefix)) {
                return await uv.fetch(event);
            }
            return await fetch(event.request);
        })()
    );
});