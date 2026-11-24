// Which tabs are making sound, and muting them.
//
// Browsers can't report or mute iframe audio, so tabs.js calls watchAudio() to watch each document from inside.
//
//   <audio>/<video>   events caught at the document, play() wrapped to catch detached elements. Muting sets .muted.
//   Web Audio         routed through our gain node (mute) and an analyser (is it audible).
// Best effort; never break the page.

const MEDIA_EVENTS = ["play", "playing", "pause", "ended", "emptied", "volumechange", "loadeddata"];
// How long a Web Audio context counts as audible after the last sound seen.
const HOLD_MS = 3000;
const POLL_MS = 1200;

const patchedWindows = new WeakSet();
const trackedElements = new WeakSet();
/** Elements this module muted (as opposed to the page or the user). */
const mutedByShell = new WeakSet();

let pollTimer = null;
let pollTabs = null;

function stateOf(tab) {
  return (tab.audio ??= { els: new Set(), ctxs: new Set(), audible: false });
}

function elementPlaying(el) {
  try {
    if (el.paused || el.ended || el.readyState < 2) return false;
    if (el.volume === 0) return false;
    if (el.muted && !mutedByShell.has(el)) return false; // silenced by the page itself
    // Chrome can say whether any audio was actually decoded (silent videos, GIF-style clips).
    if ("webkitAudioDecodedByteCount" in el && el.webkitAudioDecodedByteCount === 0) return false;
    return true;
  } catch {
    return false;
  }
}

function contextLoud(record, now) {
  try {
    if (record.ctx.state !== "running") return false;
    record.analyser.getByteTimeDomainData(record.buf);
    for (let i = 0; i < record.buf.length; i++) {
      if (Math.abs(record.buf[i] - 128) > 1) {
        record.loudAt = now;
        break;
      }
    }
  } catch {}
  return now - record.loudAt < HOLD_MS;
}

/** Re-reads a tab's state; returns true when "audible" flipped. */
function refresh(tab) {
  const audio = tab.audio;
  if (!audio) return false;
  const now = Date.now();
  let audible = false;
  for (const el of audio.els) {
    // Elements of a document that's gone can't be heard any more.
    if (!el.ownerDocument?.defaultView) audio.els.delete(el);
    else if (elementPlaying(el)) audible = true;
  }
  for (const record of audio.ctxs) {
    if (record.ctx.state === "closed") audio.ctxs.delete(record);
    else if (contextLoud(record, now)) audible = true;
  }
  if (audible === audio.audible) return false;
  audio.audible = audible;
  return true;
}

function startPolling(tabs) {
  pollTabs = tabs;
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    let watching = false;
    for (const tab of pollTabs.tabsArr) {
      if (!tab.audio) continue;
      if (refresh(tab)) pollTabs.renderAudio(tab);
      if (tab.audio.els.size || tab.audio.ctxs.size) watching = true;
    }
    // Nothing left to watch: stop ticking until something plays again.
    if (!watching) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, POLL_MS);
}

function applyMute(tab, el) {
  try {
    if (tab.muted) {
      if (!el.muted) {
        el.muted = true;
        mutedByShell.add(el);
      }
    } else if (mutedByShell.has(el)) {
      mutedByShell.delete(el);
      el.muted = false;
    }
  } catch {}
}

/** Hooks one document (top level or a subframe) of a tab. */
export function watchAudio(tabs, tab, win) {
  if (!win || patchedWindows.has(win)) return;
  patchedWindows.add(win);
  const audio = stateOf(tab);
  const update = () => {
    if (refresh(tab)) tabs.renderAudio(tab);
  };

  const track = (el) => {
    if (!el || trackedElements.has(el)) return;
    trackedElements.add(el);
    audio.els.add(el);
    for (const type of MEDIA_EVENTS) el.addEventListener(type, update);
    applyMute(tab, el);
    startPolling(tabs);
  };

  try {
    // Media events don't bubble, but they can be caught on the way down.
    for (const type of MEDIA_EVENTS) {
      win.document.addEventListener(
        type,
        (e) => {
          if (e.target instanceof win.HTMLMediaElement) {
            track(e.target);
            update();
          }
        },
        true,
      );
    }
    const mediaProto = win.HTMLMediaElement.prototype;
    const play = mediaProto.play;
    mediaProto.play = function (...args) {
      try {
        track(this);
      } catch {}
      return play.apply(this, args);
    };
  } catch {}

  try {
    const nodeProto = win.AudioNode?.prototype;
    const Destination = win.AudioDestinationNode;
    if (nodeProto && Destination) {
      const connect = nodeProto.connect;
      const disconnect = nodeProto.disconnect;
      const records = new WeakMap();
      const recordFor = (ctx) => {
        let record = records.get(ctx);
        if (record) return record;
        const input = ctx.createGain();
        const gate = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        gate.gain.value = tab.muted ? 0 : 1;
        connect.call(input, gate);
        connect.call(gate, ctx.destination);
        connect.call(input, analyser);
        record = { ctx, input, gate, analyser, buf: new Uint8Array(analyser.fftSize), loudAt: 0, win };
        records.set(ctx, record);
        audio.ctxs.add(record);
        startPolling(tabs);
        return record;
      };
      // Offline contexts render to a buffer, not to the speakers: leave them be.
      const live = (target) => target instanceof Destination && !(win.OfflineAudioContext && target.context instanceof win.OfflineAudioContext);
      nodeProto.connect = function (...args) {
        const target = args[0];
        if (live(target)) {
          let routed = false;
          try {
            connect.call(this, recordFor(target.context).input, args[1] ?? 0);
            routed = true;
          } catch {}
          if (routed) return target;
        }
        return connect.apply(this, args);
      };
      nodeProto.disconnect = function (...args) {
        const target = args[0];
        if (live(target)) {
          const record = records.get(target.context);
          if (record) {
            try {
              return args.length > 1 ? disconnect.call(this, record.input, args[1]) : disconnect.call(this, record.input);
            } catch {}
          }
        }
        return disconnect.apply(this, args);
      };
    }
  } catch {}

  // The document is going away: forget what it was playing.
  win.addEventListener("pagehide", () => {
    for (const el of audio.els) if (el.ownerDocument === win.document) audio.els.delete(el);
    for (const record of audio.ctxs) if (record.win === win) audio.ctxs.delete(record);
    update();
  });
}

/** A window and every frame under it that this page is allowed to look into. */
export function sameOriginFrames(win, out = []) {
  try {
    if (!win?.document) return out;
    out.push(win);
    for (let i = 0; i < win.frames.length; i++) sameOriginFrames(win.frames[i], out);
  } catch {}
  return out;
}

export function setTabMuted(tabs, tab, muted) {
  tab.muted = !!muted;
  const audio = stateOf(tab);
  for (const el of audio.els) applyMute(tab, el);
  for (const record of audio.ctxs) {
    try {
      record.gate.gain.value = tab.muted ? 0 : 1;
    } catch {}
  }
  // Media that hasn't made a sound yet (so isn't tracked) but is on the page.
  for (const win of sameOriginFrames(tab.iframe.contentWindow)) {
    try {
      for (const el of win.document.querySelectorAll("audio, video")) applyMute(tab, el);
    } catch {}
  }
  refresh(tab);
  tabs.renderAudio(tab);
}

/** A closed tab, or one whose page was replaced: nothing left to track. */
export function forgetAudio(tab) {
  if (!tab.audio) return;
  tab.audio.els.clear();
  tab.audio.ctxs.clear();
  tab.audio.audible = false;
}

// Speaker and speaker-with-a-cross, drawn for the 0 -960 960 960 icon grid.
const BODY = "M160-600h160l200-160v560L320-360H160Z";
export const ICON_SOUND = `${BODY}M600-640A180 180 0 0 1 600-320L600-380A120 120 0 0 0 600-580Z`;
export const ICON_MUTED = `${BODY}M612-580l28-28 100 100 100-100 28 28-100 100 100 100-28 28-100-100-100 100-28-28 100-100Z`;
