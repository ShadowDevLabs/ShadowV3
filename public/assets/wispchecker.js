import { WispWebSocket } from "./wispclient.js";

String.prototype.delete = function (snippet) {
    return this.replace(new RegExp(snippet, 'g'), '');
};

export async function checkWispUrl(url) {
    //ISTG DONT ASK THIS IS THE BEST I CAN DO :SOB:
    if(checkWispServer(url)) return url;

    url = `wss://${url.delete("https://").delete("http://").delete("ws://").delete("wss://").delete("/wisp/").delete("/wisp").delete("/bare/").delete("/bare").delete("/")}/wisp/`
    if (await checkWispServer(url)) {
        return url
    }

    return `wss://${location.origin}/wisp/`
}

export async function checkBareUrl(url) {
    //ISTG DONT ASK THIS IS THE BEST I CAN DO :SOB:
    if(checkBareServer(url)) return url;

    url = `https://${url.delete("https://").delete("http://").delete("ws://").delete("wss://").delete("/wisp/").delete("/wisp").delete("/bare").delete("/bare/").delete("/")}/bare/`
    if (await checkBareServer(url)) {
        return url
    }

    return `wss://${location.origin}/wisp/`
}

export async function checkWispServer(url) {
    console.log("Checking url: " + url);
    const ws = new WispWebSocket(url);

    return new Promise((resolve) => {
        ws.addEventListener("open", () => {
            ws.close(); // Close the WebSocket once opened
            resolve(true); // Resolve promise as successful
        });

        ws.addEventListener("error", () => {
            console.error(`WebSocket connection failed for: ${url}`);
            resolve(false); // Resolve promise as unsuccessful on error
        });

        ws.addEventListener("close", (event) => {
            if (event.code !== 1000) { // 1000 is normal closure
                console.warn(`WebSocket closed unexpectedly: ${event.reason}`);
            }
        });

        // Timeout to handle cases where the connection never opens
        const timeout = setTimeout(() => {
            ws.close(); // Close WebSocket if not opened
            resolve(false); // Resolve as unsuccessful
        }, 500); // Wait 5 seconds for a connection

        ws.addEventListener("close", () => {
            clearTimeout(timeout); // Clear timeout on closure
        });
    });
}


async function checkBareServer(url) {
    console.log("Checking url: " + url);
    const headers = new Headers({
        "x-bare-url": "https://www.google.com",
        "X-Bare-Headers": JSON.stringify({
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9"
        })
    });

    try {
        const res = await fetch(url, { headers });
        console.log(res);
        const status = res.headers.get("X-Bare-Status");
        if (status === "200" || status === "302") return true;
    } catch (error) {
        console.error("Fetch error:", error);
    }

    return false;
}
