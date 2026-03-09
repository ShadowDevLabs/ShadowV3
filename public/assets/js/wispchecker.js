import { WispWebSocket } from "./wispclient.js";

// Escape special regex characters in a string so it can be used safely in RegExp
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deleteSnippet(str, snippet) {
    return str.replace(new RegExp(escapeRegExp(snippet), 'g'), '');
}

export async function checkWispUrl(url) {
    if (await checkWispServer(url)) return url;

    const patternsToRemove = [
        "https://",
        "http://",
        "ws://",
        "wss://",
        "/wisp/",
        "/wisp",
        "/"
    ];

    for (const pattern of patternsToRemove) {
        url = deleteSnippet(url, pattern);
    }

    url = `wss://${url}/wisp/`;
    if (await checkWispServer(url)) {
        return url
    }

    return `wss://${location.host}/wisp/`
}

export async function checkWispServer(url) {
    console.log("[WISP] Checking url: " + url);
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
        }, 500); // Wait 0.5 seconds for a connection

        ws.addEventListener("close", () => {
            clearTimeout(timeout); // Clear timeout on closure
        });
    });
}