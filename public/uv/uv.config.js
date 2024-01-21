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

onload = () => {
    try {
        parent.updateOmni();
        parent.setTab();
    }
    catch (e) {
        console.warn("Error with sending update request to omnibox, are you in an iframe?");
        console.log(e)
    }
}