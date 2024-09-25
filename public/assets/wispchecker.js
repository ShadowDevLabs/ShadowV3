import { WispWebSocket } from "./wispclient";

export function checkWispUrl(url) {
    if(url.startsWith("wss://") && _checkWispUrl(url)) return url;
    if(url.startsWith("https") && _checkWispUrl(url.replace("https://", "wss://"))) return url.replace("https://", "wss://");
    if(url.startsWith("http") && _checkWispUrl(url.replace("http://", "ws://"))) return url.replace("http://", "ws://");
    if(_checkWispUrl("wss://"+url)) return "wss://"+url;
    if(_checkWispUrl("wss://"+url+"/wisp/")) return "wss://"+url+"/wisp/";
    if(url.startsWith("wss://") && _checkWispUrl(url+"/wisp/")) return url+"wisp";
    if(url.startsWith("https") && _checkWispUrl(url.replace("https://", "wss://")+"/wisp/")) return url.replace("https://", "wss://");
    if(url.startsWith("http") && _checkWispUrl(url.replace("http://", "ws://")+"/wisp/")) return url.replace("http://", "ws://");
}

function _checkWispUrl(url) {
    const ws = new WispWebSocket(url);
    ws.addEventListener("open", () => {
        ws.close();
        return true
    });
    ws.close();
    return false
}

async function _checkBareUrl(url) {
    const res = await fetch(url).response.json();
    if(res.project.name.includes("bare")) {
        return true;
    }
    return false
}