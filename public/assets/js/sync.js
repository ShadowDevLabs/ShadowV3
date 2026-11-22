// Cloud sync: settings, bookmarks, shortcuts, workspaces, site settings and the
// list of open tabs, shared between a user's devices.
//
// The "account" is a sync code generated on the first device and typed into the
// others. Everything is derived from it locally (PBKDF2): an account id and auth
// token for the server, and an AES-GCM key that never leaves the browser — the
// server (src/server/sync.js) stores one opaque blob per account.
//
// Merging is deliberately simple: each device remembers which keys it changed
// since its last sync. On pull, the remote copy wins except for those keys; on
// push, a stale write is rejected by the server (409) and retried after a pull.
import { SettingsManager } from "/assets/js/settings_manager.js";
import { toast } from "/assets/js/ui.js";

const API = "/v1/api/sync/";
const settings = new SettingsManager();

// Settings that follow the user. Device-specific ones (proxy server, transport,
// wallpaper image, cloaking) and sync's own state stay local.
const SYNCED = [
  "theme", "custom", "theme-css",
  "search-engine", "search-suggestions", "search-suggestions-engine",
  "history", "save-tabs", "bookmarks-bar", "vertical-tabs", "force-dark", "translate-lang",
  "downloads-autosave", "history-group-by-site", "reader",
  "bookmarks", "shortcuts", "workspaces", "site-settings",
];
const MAX_VALUE_BYTES = 24 * 1024;
const PUSH_DELAY = 4000;
const TAB_PUSH_INTERVAL = 5 * 60 * 1000;
const PULL_INTERVAL = 5 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O/1/I/L/U look-alikes

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (bytes) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function generateCode() {
  const values = crypto.getRandomValues(new Uint8Array(20));
  const chars = [...values].map((v) => ALPHABET[v % ALPHABET.length]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

export const normalizeCode = (code) => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function deriveKeys(code) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(normalizeCode(code)), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode("shadow-sync-v1"), iterations: 250_000 }, material, 512),
  );
  return {
    id: hex(bits.subarray(0, 16)),
    token: hex(bits.subarray(16, 32)),
    key: await crypto.subtle.importKey("raw", bits.subarray(32, 64), "AES-GCM", false, ["encrypt", "decrypt"]),
  };
}

async function encrypt(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value))));
  const out = new Uint8Array(iv.length + body.length);
  out.set(iv);
  out.set(body, iv.length);
  return b64(out);
}

async function decrypt(key, text) {
  const bytes = unb64(text);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

class ShadowSync {
  constructor() {
    this.keys = null;
    this.version = 0;
    this.dirty = new Set();
    this.devices = {};
    this.deviceId = "";
    this.deviceName = "";
    this.lastSync = 0;
    this.lastError = "";
    this.applying = false; // true while writing pulled values, so they aren't marked dirty
    this.listeners = new Set();
    this.ready = this.init();
  }

  get enabled() {
    return !!this.keys;
  }

  async init() {
    const [code, version, dirty, deviceId, deviceName, lastSync] = await Promise.all(
      ["sync-code", "sync-version", "sync-dirty", "sync-device-id", "sync-device-name", "sync-last"].map((key) => settings.get(key)),
    );
    this.deviceId = deviceId || hex(crypto.getRandomValues(new Uint8Array(6)));
    if (!deviceId) settings.set("sync-device-id", this.deviceId);
    this.deviceName = deviceName || guessDeviceName();
    this.version = Number(version) || 0;
    this.lastSync = Number(lastSync) || 0;
    this.dirty = new Set(Array.isArray(dirty) ? dirty : []);

    try {
      new BroadcastChannel("shadow-settings").addEventListener("message", (e) => this.noteChange(e.data?.key));
    } catch {}
    window.addEventListener("online", () => this.enabled && this.sync().catch(() => {}));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.enabled && Date.now() - this.lastSync > PULL_INTERVAL) this.sync().catch(() => {});
    });
    setInterval(() => {
      if (this.enabled && !document.hidden && navigator.onLine) this.sync({ tabs: true }).catch(() => {});
    }, TAB_PUSH_INTERVAL);

    if (code && crypto.subtle) {
      this.code = code;
      this.keys = await deriveKeys(code);
      this.sync().catch(() => {});
    }
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit() {
    for (const callback of this.listeners) {
      try {
        callback();
      } catch {}
    }
  }

  noteChange(key) {
    if (!this.enabled || this.applying || !SYNCED.includes(key)) return;
    this.dirty.add(key);
    settings.set("sync-dirty", [...this.dirty]);
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.sync().catch(() => {}), PUSH_DELAY);
  }

  // ---------------------------------------------------------------- account

  /** Start syncing with a new code (returns it) or join with an existing one. */
  async connect(code) {
    if (!crypto.subtle) throw new Error("Sync needs a secure (https) page.");
    const joining = !!code;
    code = joining ? normalizeCode(code) : normalizeCode(generateCode());
    if (code.length < 16) throw new Error("That sync code is too short.");
    const keys = await deriveKeys(code);
    if (joining) {
      const res = await this.request(keys, "GET");
      if (res.status === 404) throw new Error("No synced data was found for that code. Check it and try again.");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Sync server error (${res.status}).`);
    }
    this.keys = keys;
    this.code = code;
    this.version = 0;
    // A new account starts from this device's data; a joined one from the remote copy.
    this.dirty = new Set(joining ? [] : SYNCED);
    await Promise.all([settings.set("sync-code", code), settings.set("sync-version", 0), settings.set("sync-dirty", [...this.dirty])]);
    await this.sync();
    return formatCode(code);
  }

  /** Stop syncing on this device. `wipe` also deletes the server copy for every device. */
  async disconnect({ wipe = false } = {}) {
    if (wipe && this.keys) {
      const res = await this.request(this.keys, "DELETE");
      if (!res.ok && res.status !== 404) throw new Error(`Couldn't delete the synced data (${res.status}).`);
    }
    this.keys = null;
    this.code = "";
    this.version = 0;
    this.devices = {};
    this.dirty.clear();
    clearTimeout(this.pushTimer);
    await Promise.all(["sync-code", "sync-version", "sync-dirty", "sync-last"].map((key) => settings.remove(key)));
    this.emit();
  }

  get displayCode() {
    return this.code ? formatCode(this.code) : "";
  }

  async setDeviceName(name) {
    this.deviceName = String(name ?? "").trim().slice(0, 40) || guessDeviceName();
    await settings.set("sync-device-name", this.deviceName);
    if (this.enabled) this.sync({ tabs: true }).catch(() => {});
  }

  // ---------------------------------------------------------------- transport

  request(keys, method, body) {
    return fetch(API + keys.id, {
      method,
      cache: "no-store",
      headers: { authorization: `Bearer ${keys.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // ---------------------------------------------------------------- sync

  /** Pull, merge, and push if this device has anything new. Calls are serialized. */
  sync(options = {}) {
    const run = () => this.syncNow(options);
    this.queue = (this.queue ?? Promise.resolve()).then(run, run);
    return this.queue;
  }

  async syncNow({ tabs = false } = {}) {
    if (!this.keys) return;
    try {
      const res = await this.request(this.keys, "GET");
      if (res.ok) {
        const record = await res.json();
        if (record.version !== this.version) await this.applyRemote(await decrypt(this.keys.key, record.data), record.version);
      } else if (res.status === 404) {
        // Nothing on the server (new account, or it was wiped): push everything.
        this.version = 0;
        for (const key of SYNCED) this.dirty.add(key);
      } else {
        throw new Error((await res.json().catch(() => ({}))).error ?? `Sync server error (${res.status}).`);
      }

      const mine = this.devices[this.deviceId];
      const tabsStale = !mine || Date.now() - (mine.at ?? 0) > TAB_PUSH_INTERVAL - 5000;
      if (this.dirty.size || this.version === 0 || (tabs && tabsStale) || !mine) await this.push();
      this.lastError = "";
      this.lastSync = Date.now();
      settings.set("sync-last", this.lastSync);
    } catch (e) {
      this.lastError = e?.name === "OperationError" ? "This sync code can't decrypt the stored data." : String(e?.message ?? e);
      console.debug("[sync]", e);
      throw e;
    } finally {
      this.emit();
    }
  }

  async applyRemote(remote, version) {
    this.applying = true;
    let changed = false;
    try {
      for (const key of SYNCED) {
        if (this.dirty.has(key) || !(key in (remote.settings ?? {}))) continue;
        const value = remote.settings[key];
        if (JSON.stringify(await settings.get(key)) === JSON.stringify(value)) continue;
        await settings.set(key, value);
        changed = true;
      }
    } finally {
      // Let the BroadcastChannel echoes of those writes arrive before listening again.
      setTimeout(() => (this.applying = false), 250);
    }
    this.devices = remote.devices && typeof remote.devices === "object" ? remote.devices : {};
    this.version = version;
    await settings.set("sync-version", version);
    if (changed) {
      const theme = await settings.get("theme");
      if (theme) {
        localStorage.setItem("theme", theme);
        window.changeTheme?.(theme);
      }
    }
  }

  async buildPayload() {
    const values = {};
    for (const key of SYNCED) {
      const value = await settings.get(key);
      if (value === undefined) continue;
      if (JSON.stringify(value).length > MAX_VALUE_BYTES) continue; // oversized values stay local
      values[key] = value;
    }
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const devices = Object.fromEntries(Object.entries(this.devices).filter(([id, device]) => id !== this.deviceId && (device?.at ?? 0) > cutoff));
    devices[this.deviceId] = { name: this.deviceName, at: Date.now(), tabs: this.localTabs() };
    this.devices = devices;
    return { v: 1, settings: values, devices };
  }

  /** This device's open tabs (private tabs, blank pages and local blobs left out). */
  localTabs() {
    const tabs = window.tabs;
    if (!tabs) return [];
    return tabs.tabsArr
      .filter((tab) => !tab.private)
      .map((tab) => ({ url: tab.pendingUrl ?? tab.url, title: String(tabs.titleFor(tab) ?? "").slice(0, 80) }))
      .filter((tab) => /^(https?|shadow):/i.test(tab.url ?? "") && tab.url !== "shadow://new" && tab.url.length < 500)
      .slice(0, 30);
  }

  async push(retry = true) {
    const pushed = [...this.dirty];
    const data = await encrypt(this.keys.key, await this.buildPayload());
    const res = await this.request(this.keys, "PUT", { data, baseVersion: this.version });
    if (res.status === 409 && retry) {
      const record = await res.json();
      await this.applyRemote(await decrypt(this.keys.key, record.data), record.version);
      return this.push(false);
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Sync server error (${res.status}).`);
    this.version = (await res.json()).version;
    for (const key of pushed) this.dirty.delete(key);
    await Promise.all([settings.set("sync-version", this.version), settings.set("sync-dirty", [...this.dirty])]);
  }

  // ---------------------------------------------------------------- other devices

  /** [{device, url, title}] for every tab open on the user's other devices. */
  remoteTabs() {
    const out = [];
    for (const [id, device] of Object.entries(this.devices)) {
      if (id === this.deviceId || !Array.isArray(device?.tabs)) continue;
      for (const tab of device.tabs) out.push({ device: device.name || "Other device", url: tab.url, title: tab.title });
    }
    return out;
  }

  otherDevices() {
    return Object.entries(this.devices)
      .filter(([id]) => id !== this.deviceId)
      .map(([id, device]) => ({ id, name: device?.name || "Other device", at: device?.at ?? 0, tabs: Array.isArray(device?.tabs) ? device.tabs : [] }))
      .sort((a, b) => b.at - a.at);
  }
}

function formatCode(code) {
  return normalizeCode(code).match(/.{1,5}/g)?.join("-") ?? "";
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  const os = /CrOS/.test(ua) ? "Chromebook" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} · ${browser}`;
}

export const shadowSync = new ShadowSync();
window.shadowSync = shadowSync;
shadowSync.onChange(() => {
  if (shadowSync.lastError && shadowSync.lastError !== shadowSync.shownError && !document.hidden && navigator.onLine) {
    shadowSync.shownError = shadowSync.lastError;
    toast(shadowSync.lastError, { title: "Sync problem", timeout: 5000 });
  }
});
