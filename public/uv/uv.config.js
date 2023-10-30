/*global Ultraviolet*/
self.__uv$config = {
    prefix: '/uv/service/',
    bare: '',
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: '/uv/uv.handler.js',
    client: '/uv/uv.client.js',
    bundle: '/uv/uv.bundle.js',
    config: '/uv/uv.config.js',
    sw: '/uv/uv.sw.js',
};

if (typeof window != 'undefined' && window.document) {
    window.onload = parent.autoLoad();
    let bareServer = localStorage.getItem("bare");
    self.__uv$config.bare = bareServer;

    function inject(content, type) {
        switch(type) {
        case "js":
            const elementJS = document.createElement("script");
            elementJS.innerHTML = content;
            document.body.appendChild(elementJS);
            break;
        case "css":
            const elementCSS = document.createElement("style");
            elementCSS.innerHTML = content;
            document.head.appendChild(elementCSS);
            break;
        default:
            const element = document.createElement("div");
            element.innerHTML = content;
            document.body.prepend(element);
            break;
        }
    }
}