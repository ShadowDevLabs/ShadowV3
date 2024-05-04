
function setTransport(url = `wss://${location.host}/wisp/`) {
    SetTransport("EpxMod.EpoxyClient", { wisp: url });
}