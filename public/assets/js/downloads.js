// Downloads manager.
//
// Files reach it three ways:
//   - a navigation whose response is an attachment (or a type the browser can't
//     display): the proxy plugin hands the raw response over instead of letting
//     the iframe swallow it (see ShadowPlugin in src/client/proxy-entry.js);
//   - <a download> links, the page menu's "Save link/image/video", and the
//     screenshot tool, which call start() / fromBlob();
// Each one is streamed into a Blob here, in the page, so there's a progress bar,
// a list (shadow://downloads) and a copy that can be opened in a tab or saved
// again — handy on machines where the browser's own downloads are locked down.
import { SettingsManager } from "/assets/js/settings_manager.js";
import { toast, showPopover, hidePopover, popoverOpenFor, h, formatBytes, hostnameOf } from "/assets/js/ui.js";

const LIST_KEY = "downloads";
const MAX_LISTED = 100;
// Finished files up to this size are also kept in IndexedDB so they survive a reload.
const MAX_PERSIST_BYTES = 64 * 1024 * 1024;
const MAX_PERSIST_TOTAL = 256 * 1024 * 1024;
const BLOB_DB = "shadow-downloads";
const BLOB_STORE = "blobs";

const MIME_EXT = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/json": "json",
  "application/x-msdownload": "exe",
  "application/vnd.android.package-archive": "apk",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "text/plain": "txt",
  "text/html": "html",
  "text/css": "css",
  "text/csv": "csv",
};

/** Types a browser shows inline when navigated to; anything else is a download. */
export function isInlineType(contentType) {
  const type = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!type) return true; // unknown: let the browser sniff it
  if (/^(text|image|audio|video|font)\//.test(type)) return true;
  if (/[+/](xml|json)$/.test(type)) return true;
  return [
    "application/pdf",
    "application/javascript",
    "application/ecmascript",
    "application/x-javascript",
    "application/xhtml+xml",
    "application/wasm",
    "multipart/x-mixed-replace",
  ].includes(type);
}

/** filename from a Content-Disposition header (RFC 6266: filename*= wins over filename=). */
export function filenameFromDisposition(disposition) {
  if (!disposition) return "";
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim());
    } catch {}
  }
  const plain = /filename\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]+)/i.exec(disposition);
  if (!plain) return "";
  const value = plain[2] !== undefined ? plain[2].replace(/\\(.)/g, "$1") : plain[1].trim();
  try {
    // Some servers percent-encode the plain form too.
    return /%[0-9a-f]{2}/i.test(value) ? decodeURIComponent(value) : value;
  } catch {
    return value;
  }
}

export function sanitizeFilename(name) {
  name = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return name.slice(0, 180);
}

export function filenameFor(url, mime, suggested) {
  let name = sanitizeFilename(suggested);
  if (!name) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        name = sanitizeFilename(decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? ""));
        if (!name) name = sanitizeFilename(parsed.hostname);
      }
    } catch {}
  }
  if (!name) name = "download";
  const ext = MIME_EXT[String(mime ?? "").split(";")[0].trim().toLowerCase()];
  if (ext && !/\.[a-z0-9]{1,8}$/i.test(name)) name += `.${ext}`;
  return name;
}

function openBlobDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BLOB_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(BLOB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function blobStore(mode, run) {
  const db = await openBlobDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, mode);
      const request = run(tx.objectStore(BLOB_STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export class Downloads {
  constructor(tabs) {
    this.tabs = tabs;
    this.settings = new SettingsManager();
    /** newest first */
    this.items = [];
    this.listeners = new Set();
    this.nextId = Date.now();
    this.button = document.getElementById("downloads-button");
    this.button?.addEventListener("click", () => this.togglePanel());
    this.ready = this.load();
  }

  async load() {
    const stored = await this.settings.get(LIST_KEY);
    if (Array.isArray(stored)) {
      const live = new Set(this.items.map((item) => item.id));
      for (const entry of stored) {
        if (!entry || live.has(entry.id)) continue;
        // Anything still "in progress" in storage died with the previous page.
        this.items.push({ ...entry, state: entry.state === "progress" ? "failed" : entry.state, error: entry.state === "progress" ? "Interrupted" : entry.error });
      }
      this.items.sort((a, b) => b.startedAt - a.startedAt);
    }
    this.changed(false);
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  changed(persist = true) {
    if (persist) this.persist();
    this.renderButton();
    if (popoverOpenFor(this.button)) this.renderPanel();
    for (const callback of this.listeners) {
      try {
        callback();
      } catch (e) {
        console.error("[downloads]", e);
      }
    }
  }

  persist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      const list = this.items.slice(0, MAX_LISTED).map(({ id, name, url, mime, size, received, state, startedAt, error, stored }) => ({
        id, name, url, mime, size, received, state, startedAt, error, stored,
      }));
      this.settings.set(LIST_KEY, list);
    }, 300);
  }

  create({ url, name, mime, size }) {
    const item = {
      id: this.nextId++,
      name: filenameFor(url, mime, name),
      url: /^(https?|shadow):/i.test(url ?? "") ? url : "",
      mime: String(mime ?? "").split(";")[0].trim(),
      size: Number.isFinite(size) && size > 0 ? size : 0,
      received: 0,
      state: "progress",
      startedAt: Date.now(),
      error: "",
      stored: false,
      blob: null,
      abort: null,
    };
    this.items.unshift(item);
    this.button?.classList.add("attention");
    setTimeout(() => this.button?.classList.remove("attention"), 1200);
    return item;
  }

  /**
   * Consume a response body into a download.
   * @param {{body: ReadableStream|Blob|ArrayBuffer|string|null, url?: string, name?: string,
   *   mime?: string, size?: number, abort?: AbortController}} source
   */
  async fromBody({ body, url, name, mime, size, abort }) {
    const item = this.create({ url, name, mime, size });
    item.abort = abort ?? null;
    this.changed();
    try {
      let blob;
      // Duck-typed: bodies from a proxied page's fetch() belong to that frame's
      // realm, so `instanceof ReadableStream` / `instanceof Blob` would say no.
      if (typeof body?.getReader === "function") {
        const reader = body.getReader();
        item.cancelStream = () => reader.cancel().catch(() => {});
        const chunks = [];
        let last = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (item.state !== "progress") return item; // cancelled while reading
          chunks.push(value);
          item.received += value.byteLength;
          const now = performance.now();
          if (now - last > 150) {
            last = now;
            this.changed(false);
          }
        }
        blob = new Blob(chunks, { type: item.mime || "application/octet-stream" });
      } else {
        blob = new Blob([body ?? ""], { type: item.mime || body?.type || "application/octet-stream" });
      }
      if (item.state !== "progress") return item;
      this.finish(item, blob);
    } catch (e) {
      if (item.state === "progress") {
        item.state = "failed";
        item.error = String(e?.message ?? e ?? "Download failed");
        this.changed();
        toast(`Couldn't download ${item.name}.`, { timeout: 4000 });
      }
    }
    return item;
  }

  /** A file that already exists in memory (screenshots, generated files). */
  fromBlob(blob, name, url = "") {
    const item = this.create({ url, name, mime: blob.type, size: blob.size });
    this.finish(item, blob);
    return item;
  }

  /**
   * Fetch a URL into a download. `win` is the proxied page it belongs to: its
   * own fetch() goes through the proxy with that site's cookies. URLs that are
   * already proxied (or local) are fetched from here directly.
   */
  async start({ url, name, win }) {
    const abort = new AbortController();
    let response;
    const local = (() => {
      try {
        return new URL(url, location.href).origin === location.origin;
      } catch {
        return false;
      }
    })();
    // An already-proxied address (a <video>'s currentSrc, say): name the file
    // after the real URL behind it, not the encoded proxy path.
    let realUrl = url;
    if (local) {
      try {
        const real = globalThis.__shadowUnproxy?.(url);
        if (/^https?:/i.test(real ?? "")) realUrl = real;
      } catch {}
    }
    try {
      const fetcher = !local && win?.fetch ? win.fetch.bind(win) : fetch;
      response = await fetcher(url, { signal: abort.signal, credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (e) {
      const item = this.create({ url: realUrl, name });
      item.state = "failed";
      item.error = String(e?.message ?? e);
      this.changed();
      toast(`Couldn't download ${item.name}.`, { timeout: 4000 });
      return item;
    }
    const mime = response.headers.get("content-type") ?? "";
    return this.fromBody({
      body: response.body ?? (await response.blob()),
      url: realUrl,
      name: name || filenameFromDisposition(response.headers.get("content-disposition")),
      mime,
      size: Number(response.headers.get("content-length")),
      abort,
    });
  }

  finish(item, blob) {
    item.blob = blob;
    item.size = item.received = blob.size;
    item.state = "done";
    item.abort = null;
    this.changed();
    this.store(item).catch((e) => console.debug("[downloads] not persisted:", e));
    if (this.autoSave !== false) this.save(item);
    toast(item.name, {
      title: "Download complete",
      timeout: 5000,
      onclick: () => this.togglePanel(true),
    });
  }

  /** Keep the file in IndexedDB (within the size budget), evicting the oldest. */
  async store(item) {
    if (!item.blob || item.blob.size > MAX_PERSIST_BYTES) return;
    let total = item.blob.size;
    for (const other of this.items) {
      if (other === item || !other.stored) continue;
      total += other.size;
      if (total > MAX_PERSIST_TOTAL) {
        other.stored = false;
        blobStore("readwrite", (s) => s.delete(other.id)).catch(() => {});
      }
    }
    await blobStore("readwrite", (s) => s.put(item.blob, item.id));
    item.stored = true;
    this.persist();
  }

  /** The file's bytes, from memory or IndexedDB; null when they're gone. */
  async blobFor(item) {
    if (item.blob) return item.blob;
    if (!item.stored) return null;
    try {
      item.blob = (await blobStore("readonly", (s) => s.get(item.id))) ?? null;
    } catch {
      item.blob = null;
    }
    if (!item.blob) {
      item.stored = false;
      this.persist();
    }
    return item.blob;
  }

  /** Hand the file to the browser's own download (saves to disk). */
  async save(item) {
    const blob = await this.blobFor(item);
    if (!blob) return this.retry(item);
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = item.name;
    a.style.display = "none";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return true;
  }

  /** Show the file in a Shadow tab (images, PDFs, text, media). */
  async open(item) {
    const blob = await this.blobFor(item);
    if (!blob) return toast("That file is no longer stored — download it again.", { timeout: 3000 });
    item.objectUrl ??= URL.createObjectURL(blob);
    this.tabs.createTab(item.objectUrl, item.name);
  }

  retry(item) {
    if (!item.url) return toast("There's no address to download that from again.", { timeout: 3000 });
    this.remove(item);
    const tab = this.tabs.tabsArr[this.tabs.activeTabIndex];
    return this.start({ url: item.url, name: item.name, win: this.tabs.isProxied(tab) ? tab.iframe.contentWindow : null });
  }

  cancel(item) {
    if (item.state !== "progress") return;
    item.state = "canceled";
    item.abort?.abort();
    item.cancelStream?.();
    this.changed();
  }

  remove(item) {
    this.cancel(item);
    const at = this.items.indexOf(item);
    if (at !== -1) this.items.splice(at, 1);
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    if (item.stored) blobStore("readwrite", (s) => s.delete(item.id)).catch(() => {});
    this.changed();
  }

  clear() {
    for (const item of [...this.items]) {
      if (item.state !== "progress") this.remove(item);
    }
  }

  // ---------------------------------------------------------------- UI

  get active() {
    return this.items.filter((item) => item.state === "progress");
  }

  renderButton() {
    if (!this.button) return;
    const active = this.active;
    this.button.hidden = this.items.length === 0;
    this.button.classList.toggle("busy", active.length > 0);
    const known = active.filter((item) => item.size);
    const ratio = known.length
      ? known.reduce((sum, item) => sum + item.received, 0) / known.reduce((sum, item) => sum + item.size, 0)
      : 0;
    this.button.style.setProperty("--progress", `${Math.round(ratio * 100)}%`);
    this.button.title = active.length ? `Downloading ${active.length} file${active.length > 1 ? "s" : ""}` : "Downloads";
  }

  togglePanel(forceOpen = false) {
    if (!this.button) return;
    if (this.items.length === 0 && this.button.hidden) this.button.hidden = false;
    if (forceOpen && popoverOpenFor(this.button)) return;
    showPopover(this.button, (panel) => this.renderPanel(panel), { owner: this.button, width: 360 });
  }

  renderPanel(panel = document.querySelector(".shadow-popover")) {
    if (!panel) return;
    panel.textContent = "";
    panel.classList.add("downloads-panel");
    panel.append(
      h(
        "div",
        { class: "popover-title" },
        h("strong", {}, "Downloads"),
        h(
          "button",
          {
            type: "button",
            class: "link",
            onclick: () => {
              hidePopover();
              this.tabs.createTab("shadow://downloads");
            },
          },
          "Show all",
        ),
      ),
    );
    if (this.items.length === 0) {
      panel.append(h("p", { class: "muted" }, "Files you download will show up here."));
      return;
    }
    const list = h("div", { class: "download-list" });
    for (const item of this.items.slice(0, 6)) list.append(this.renderItem(item));
    panel.append(list);
  }

  /** One row; shared by the panel and shadow://downloads (which passes its own document's `h`). */
  renderItem(item, make = h) {
    const done = item.state === "done";
    const available = done && (item.blob || item.stored);
    const percent = item.size ? Math.min(100, Math.round((item.received / item.size) * 100)) : null;
    const status =
      item.state === "progress"
        ? `${formatBytes(item.received)}${item.size ? ` of ${formatBytes(item.size)}` : ""}`
        : item.state === "failed"
          ? `Failed${item.error ? ` — ${item.error}` : ""}`
          : item.state === "canceled"
            ? "Cancelled"
            : `${formatBytes(item.size)}${item.url ? ` · ${hostnameOf(item.url)}` : ""}${available ? "" : " · not stored"}`;
    const action = (label, title, run) => make("button", { type: "button", title, onclick: (e) => (e.stopPropagation(), run()) }, label);
    const row = make(
      "div",
      { class: `download-item ${item.state}`, title: item.url || item.name },
      make(
        "div",
        { class: "download-main" },
        make("div", { class: "download-name" }, item.name),
        make("div", { class: "download-status" }, status),
        item.state === "progress"
          ? make("div", { class: "download-bar" + (percent === null ? " indeterminate" : "") }, make("span", { style: { width: `${percent ?? 35}%` } }))
          : null,
      ),
      make(
        "div",
        { class: "download-actions" },
        item.state === "progress" ? action("✕", "Cancel", () => this.cancel(item)) : null,
        available ? action("Open", "Open in a tab", () => this.open(item)) : null,
        available ? action("Save", "Save to this device", () => this.save(item)) : null,
        !available && item.state !== "progress" && item.url ? action("Retry", "Download again", () => this.retry(item)) : null,
        item.state !== "progress" ? action("✕", "Remove from list", () => this.remove(item)) : null,
      ),
    );
    return row;
  }
}
