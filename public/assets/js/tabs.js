import { HistoryHelper } from "/assets/js/history_helper.js";
import { SettingsManager } from "/assets/js/settings_manager.js";
import { Controller, Sapphire, ShadowPlugin } from "/dist/shadow-proxy.js";
import { ExtensionUI } from "/assets/js/extension_ui.js";
import { showMenu, hideMenu, toast } from "/assets/js/ui.js";
import { applySitePatches } from "/assets/js/site-patches.js";
import { openCommandPalette, openFind, closeFind, resetFind } from "/assets/js/features.js";

const searchInput = document.getElementById("__shadow-search-bar");
const addTabButton = document.getElementById("add-tab");
const tabStrip = document.getElementById("tabs-container");
const iframesContainer = document.getElementById("iframes-container");

const DEFAULT_ICON = "/assets/imgs/icons/logo.png";
const MAX_CLOSED_TABS = 25;
const wsScheme = location.protocol === "https:" ? "wss" : "ws";
const defaultWisp = `${wsScheme}://${location.host}/wisp/`;

// Proxied URLs look like /~/s/<controller id>/<frame id>/<encoded url>. The ids are
// random per page load, so an encoded URL is never valid after a reload — anything
// that has to survive one (saved tabs, history, bookmarks) stores the real URL.
//
// The codec functions are stringified into every proxied document by the
// controller, so they must be self-contained (no closures, no imports).
const proxyConfig = {
  prefix: "/~/s/",
  codec: {
    // Same XOR scheme Ultraviolet used: keeps hostnames out of the URL bar/filters.
    encode: (url) => {
      if (!url) return url;
      let out = "";
      for (let i = 0; i < url.length; i++)
        out += i % 2 ? String.fromCharCode(url.charCodeAt(i) ^ 2) : url[i];
      return encodeURIComponent(out);
    },
    decode: (url) => {
      if (!url) return url;
      const [input, ...search] = url.split("?");
      const dec = decodeURIComponent(input);
      let out = "";
      for (let i = 0; i < dec.length; i++)
        out += i % 2 ? String.fromCharCode(dec.charCodeAt(i) ^ 2) : dec[i];
      return out + (search.length ? "?" + search.join("?") : "");
    },
  },
};

// Sapphire only knows how to undo Scramjet's default codec; scripts/build.mjs
// patches it to ask us when it sees a URL encoded with ours.
globalThis.__shadowUnproxy = (ref) => {
  const path = new URL(String(ref), location.href).pathname;
  if (!path.startsWith(proxyConfig.prefix)) return ref;
  // <prefix><controller id>/<frame id>/<encoded url>
  const encoded = path.slice(proxyConfig.prefix.length).split("/").slice(2).join("/");
  return encoded ? proxyConfig.codec.decode(encoded) : ref;
};

const isInternal = (url) => url.startsWith("shadow://");
// A same-origin Shadow page loaded straight into the iframe (arcade embed, games),
// never run through the proxy.
const isLocalPath = (url) => /^\/[^/]/.test(url);
const internalPath = (url) => `/pages/${url.slice("shadow://".length)}.html`;
const internalIcon = (url) =>
  `/assets/imgs/icons/pages/${url.slice("shadow://".length).split("/")[0]}.png`;

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

class Tab {
  constructor() {
    this.activeTabIndex = -1;
    this.tabsArr = [];
    this.closedTabs = [];
    this.nextTabId = 1;
    this.controller = null;
    this.sapphire = null;
    this.extensions = null;
    this.transport = null;
    this.transportKey = null;
    this.proxyError = null;
    this.userAgent = null;
    this.brokenSites = fetch("/v1/api/broken-sites")
      .then((res) => res.json())
      .catch(() => ({}));
    this.brokenSitesLastUpdated = Date.now();
    this.history = new HistoryHelper();
    this.settings = new SettingsManager();

    document.getElementById("uv-form").addEventListener("submit", (e) => {
      e.preventDefault();
      searchInput.blur();
      this.load(searchInput.value);
    });

    window.addEventListener("settings", (e) => {
      const { key, newValue } = e.detail;
      switch (key) {
        case "search-engine":
          this.searchEngine = newValue;
          break;
        case "search-suggestions":
          this.searchSuggestions = newValue;
          break;
        case "search-suggestions-engine":
          this.searchSuggestionsEngine = newValue;
          break;
        case "user-agent":
          this.userAgent = newValue || null;
          break;
        case "panic-key":
          this.panicKey = newValue || null;
          break;
        case "panic-url":
          this.panicUrl = newValue || "https://www.google.com";
          break;
        default:
          break;
      }
    });

    this.defaults = [
      { key: "search-suggestions", value: true },
      { key: "history", value: true },
      { key: "save-tabs", value: true },
      { key: "search-suggestions-engine", value: "google" },
      { key: "shortenUrls", value: true },
      { key: "search-engine", value: "https://duckduckgo.com/?q=%s" },
    ];

    this.getSuggestions = async (query) =>
      await fetch(
        `/v1/api/search-suggestions?query=${encodeURIComponent(query)}`,
        { headers: { engine: this.searchSuggestionsEngine } },
      ).then((response) => response.json());
    this.hideSuggestions = () =>
      document.getElementById("suggestions").classList.add("hidden");

    this.ready = this.init();
  }

  // ---------------------------------------------------------------- startup

  async setDefaults() {
    for (const i of this.defaults) {
      await this.settings.default(i.key, i.value);
    }
  }

  async init() {
    await this.setDefaults();
    this.searchSuggestionsEngine = await this.settings.get("search-suggestions-engine");
    this.searchSuggestions = await this.settings.get("search-suggestions");
    this.searchEngine = await this.settings.get("search-engine");
    this.userAgent = (await this.settings.get("user-agent")) || null;
    await this.settings.default("panic-url", "https://classroom.google.com");
    this.panicKey = (await this.settings.get("panic-key")) || null;
    this.panicUrl = (await this.settings.get("panic-url")) || "https://www.google.com";

    try {
      await this.bootProxy();
    } catch (e) {
      // Internal pages still work without the proxy; proxied loads show the error.
      this.proxyError = e;
      console.error("[PROXY] Failed to start Scramjet:", e);
    }

    // /?url=<address> opens straight to a page (used by "Open Tab in Abt:Blank").
    const params = new URLSearchParams(location.search);
    const deepLink = params.get("url");
    if (deepLink !== null) {
      params.delete("url");
      const query = params.toString();
      history.replaceState(null, "", location.pathname + (query ? `?${query}` : ""));
    }

    const open = await this.history.getOpen();
    if (!deepLink && (await this.settings.get("save-tabs")) && Array.isArray(open) && open.length > 1) {
      await this.loadAllTabs(open);
    }
    if (deepLink) await this.createTab(deepLink);
    if (this.tabsArr.length === 0) await this.createTab();
    return true;
  }

  /** Service worker -> transport -> Scramjet controller -> Sapphire (extensions). */
  async bootProxy() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("This browser doesn't support service workers.");
    }
    if (typeof $scramjet === "undefined" || typeof $scramjetController === "undefined") {
      throw new Error("Scramjet failed to load.");
    }

    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      // First visit (or a hard reload): wait for the worker to claim this page.
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    }
    const serviceworker = navigator.serviceWorker.controller ?? registration.active;
    if (!serviceworker) throw new Error("The service worker never became active.");

    await this.setTransport();

    this.controller = new Controller({
      serviceworker,
      transport: this.transport,
      config: proxyConfig,
    });
    await this.controller.wait();

    this.extensions = new ExtensionUI(this);
    this.sapphire = new Sapphire({ host: this.hostBindings() });
    this.sapphire.attachController(this.controller);
    this.extensions.attach(this.sapphire);
    try {
      await this.sapphire.init(); // starts previously installed extensions
    } catch (e) {
      console.error("[EXT] Failed to restore extensions:", e);
    }
    this.extensions.render();
  }

  /** What Sapphire needs from the browser shell to back chrome.tabs & friends. */
  hostBindings() {
    const byId = (id) => this.tabsArr.find((t) => t.id === id);
    const indexOf = (id) => this.tabsArr.findIndex((t) => t.id === id);
    return {
      getTabId: (win) => this.tabsArr.find((t) => t.iframe.contentWindow === win)?.id ?? null,
      getTab: (id) => {
        const tab = byId(id);
        return tab ? this.tabInfoFor(tab) : null;
      },
      getAllTabs: () => this.tabsArr.map((tab) => this.tabInfoFor(tab)),
      getActiveTabId: () => this.tabsArr[this.activeTabIndex]?.id ?? null,
      getTabWindow: (id) => byId(id)?.iframe.contentWindow ?? null,
      createTab: async (url, { active } = { active: true }) => {
        await this.createTab(url || "shadow://new", undefined, { active: active !== false });
        return this.tabsArr[this.tabsArr.length - 1].id;
      },
      navigateTab: (id, url) => {
        if (id === null) return void this.createTab(url);
        const i = indexOf(id);
        if (i !== -1) this.load(url, i);
      },
      closeTab: (id) => {
        const i = indexOf(id);
        if (i !== -1) this.closeTab(i);
      },
      reloadTab: (id) => {
        const i = indexOf(id);
        if (i !== -1) this.refresh(i);
      },
      activateTab: (id) => {
        const i = indexOf(id);
        if (i !== -1) this.switchTab(i);
      },
      goBack: (id) => {
        const i = indexOf(id);
        if (i !== -1) this.backward(i);
      },
      goForward: (id) => {
        const i = indexOf(id);
        if (i !== -1) this.forward(i);
      },
      search: (text) => this.load(text),
      openPopup: (extId, tabId) => this.extensions.openPopup(extId, tabId),
      closePopup: () => this.extensions.hidePopup(),
      createNotification: (extId, id, options, callbacks) =>
        this.extensions.notify(extId, id, options, callbacks),
      clearNotification: (extId, id) => this.extensions.clearNotification(extId, id),
      showContextMenu: (request) => this.extensions.showContextMenu(request),
      requestPermissions: (extId, permissions, origins) =>
        this.extensions.requestPermissions(extId, permissions, origins),
    };
  }

  tabInfoFor(tab) {
    const index = this.tabsArr.indexOf(tab);
    return {
      id: tab.id,
      windowId: 1,
      index,
      url: this.currentUrl(tab),
      title: this.titleFor(tab),
      active: index === this.activeTabIndex,
      pinned: tab.pinned,
      status: tab.loading ? "loading" : "complete",
      favIconUrl: tab.img.src || undefined,
    };
  }

  // ---------------------------------------------------------------- transport

  async setTransport(url, transport) {
    url = url ?? ((await this.settings.get("server")) || defaultWisp);
    transport = transport ?? ((await this.settings.get("transport")) || "/epoxy/index.mjs");
    if (!/^\/(epoxy|libcurl)\/index\.mjs$/.test(transport)) transport = "/epoxy/index.mjs";
    // A saved "default server" URL follows the page's scheme (wss on https, ws on http).
    try {
      const parsed = new URL(url);
      if (parsed.host === location.host) url = defaultWisp;
    } catch {
      url = defaultWisp;
    }

    const key = `${transport}|${url}`;
    if (key !== this.transportKey) {
      const { default: Transport } = await import(transport);
      const instance = new Transport({ wisp: url });
      await instance.init?.();
      this.transport = instance;
      this.transportKey = key;
      this.controller?.setTransport(instance);
    }
    this.settings.set("server", url);
    this.settings.set("transport", transport);
    return true;
  }

  // ---------------------------------------------------------------- navigation

  async updateSearchEngine() {
    this.searchEngine = await this.settings.get("search-engine");
  }

  async load(src, i = this.activeTabIndex) {
    this.hideSuggestions();
    const tab = this.tabsArr[i];
    if (!tab || typeof src !== "string" || !src.trim()) return false;

    let url = self.resolveInput(src, this.searchEngine);
    if (/^https?:/i.test(url)) {
      const broken = await this.checkSite(url);
      if (broken && (await this.brokenDisclaimer(broken))) {
        url = self.resolveInput(broken, this.searchEngine);
      }
    }

    tab.url = url;
    tab.pendingUrl = null;
    this.setLoading(tab, true);
    if (i === this.activeTabIndex) resetFind();

    if (isInternal(url)) {
      tab.iframe.src = internalPath(url);
    } else if (isLocalPath(url)) {
      tab.iframe.src = url;
    } else if (url === "about:blank") {
      tab.iframe.src = url;
    } else if (!this.controller) {
      this.showProxyError(tab, url);
    } else {
      tab.frame.go(this.sapphire.resolveUrl(url));
    }
    this.renderTab(tab);
    if (i === this.activeTabIndex) this.updateOmni();
    this.saveTabs();
    return true;
  }

  showProxyError(tab, url) {
    const doc = `<!doctype html><meta charset="utf-8"><title>Proxy unavailable</title>
<body style="font-family:Poppins,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:520px;padding:24px"><h2>Shadow couldn't start the proxy</h2>
<p id="m"></p><p id="u" style="opacity:.6;word-break:break-all"></p>
<p>Try reloading the page, or use a current version of Chrome, Edge or Firefox.</p></div></body>`;
    tab.iframe.srcdoc = doc;
    tab.iframe.addEventListener(
      "load",
      () => {
        try {
          const d = tab.iframe.contentDocument;
          d.getElementById("m").textContent = String(this.proxyError?.message ?? this.proxyError ?? "");
          d.getElementById("u").textContent = url;
        } catch {}
      },
      { once: true },
    );
  }

  /**
   * @param {string} [src] URL / search text / shadow:// page
   * @param {string} [title] fixed title for the tab
   * @param {{active?: boolean, lazy?: boolean, pinned?: boolean, index?: number}} [options]
   *   lazy tabs aren't loaded until they're first shown (used when restoring a session).
   */
  async createTab(
    src = this.tabsArr.length === 0 ? "shadow://home" : "shadow://new",
    title,
    { active = true, lazy = false, pinned = false, index } = {},
  ) {
    const tab = {
      id: this.nextTabId++,
      tab: document.createElement("div"),
      title: title || null,
      iframe: document.createElement("iframe"),
      img: document.createElement("img"),
      frame: null,
      url: self.resolveInput(src, this.searchEngine),
      pendingUrl: null,
      pinned: false,
      loading: false,
      zoom: 1,
      lastHistoryUrl: null,
    };

    tab.tab.classList.add("tab");
    tab.tab.dataset.tabId = String(tab.id);
    this.createTabItems(tab);
    tab.iframe.title = "Content IFrame";
    tab.iframe.allow = "fullscreen; clipboard-read; clipboard-write; autoplay";
    tab.iframe.addEventListener("load", () => this.onFrameLoad(tab));
    iframesContainer.appendChild(tab.iframe);

    if (this.controller) {
      tab.frame = this.controller.createFrame(tab.iframe, {
        plugins: [
          this.sapphire.createPlugin(tab.id),
          new ShadowPlugin({
            onDocument: (ctx) => this.onDocument(tab, ctx),
            getUserAgent: () => this.userAgent,
          }),
        ],
      });
    }

    const at = typeof index === "number" ? Math.min(Math.max(index, 0), this.tabsArr.length) : this.tabsArr.length;
    this.tabsArr.splice(at, 0, tab);
    if (at <= this.activeTabIndex) this.activeTabIndex++;
    tabStrip.insertBefore(tab.tab, this.tabsArr[at + 1]?.tab ?? addTabButton);
    if (pinned) this.setPinned(at, true, false);
    this.sapphire?.notifyTabCreated(tab.id);

    if (lazy && !active) {
      tab.pendingUrl = tab.url;
      this.renderTab(tab);
    } else {
      if (active) this.switchTab(this.tabsArr.indexOf(tab));
      await this.load(tab.url, this.tabsArr.indexOf(tab));
    }
    return true;
  }

  createTabItems(tab) {
    tab.img.className = "tab-icon";
    tab.img.alt = "";
    tab.img.draggable = false;
    tab.img.onerror = () => {
      if (!tab.img.src.endsWith(DEFAULT_ICON)) tab.img.src = DEFAULT_ICON;
    };
    tab.tab.appendChild(tab.img);

    const spinner = document.createElement("span");
    spinner.className = "tab-spinner";
    tab.tab.appendChild(spinner);

    const titleContainer = document.createElement("div");
    titleContainer.className = "tab-title";
    tab.tab.appendChild(titleContainer);

    const closeBtn = document.createElement("span");
    closeBtn.className = "close-tab-button";
    closeBtn.innerHTML = "&#x2715;";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeTab(this.tabsArr.indexOf(tab));
    });
    tab.tab.appendChild(closeBtn);

    tab.tab.addEventListener("click", () => this.switchTab(this.tabsArr.indexOf(tab)));
    // Middle click closes, like every other browser.
    tab.tab.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.closeTab(this.tabsArr.indexOf(tab));
      }
    });
    tab.tab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showTabMenu(this.tabsArr.indexOf(tab), e.clientX, e.clientY);
    });
    this.makeDraggable(tab);
  }

  closeTab(i = this.activeTabIndex, force = false) {
    const tab = this.tabsArr[i];
    if (!tab) return;

    const url = tab.pendingUrl ?? this.currentUrl(tab);
    if (url && url !== "shadow://new" && url !== "about:blank") {
      this.closedTabs.push({ url, pinned: tab.pinned, index: i });
      if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift();
    }

    const wasActive = this.activeTabIndex === i;
    tab.iframe.remove();
    tab.tab.remove();
    this.tabsArr.splice(i, 1);
    if (tab.frame && this.controller) {
      const at = this.controller.frames.indexOf(tab.frame);
      if (at !== -1) this.controller.frames.splice(at, 1);
    }
    this.sapphire?.notifyTabRemoved(tab.id);

    if (this.tabsArr.length === 0) {
      this.activeTabIndex = -1;
      if (!force) this.createTab();
    } else if (wasActive) {
      this.switchTab(Math.min(i, this.tabsArr.length - 1));
    } else if (i < this.activeTabIndex) {
      this.activeTabIndex -= 1;
    }
    this.saveTabs();
  }

  reopenClosedTab() {
    const closed = this.closedTabs.pop();
    if (!closed) return false;
    this.createTab(closed.url, undefined, { pinned: closed.pinned, index: closed.index });
    return true;
  }

  duplicateTab(i = this.activeTabIndex) {
    const tab = this.tabsArr[i];
    if (!tab) return;
    this.createTab(tab.pendingUrl ?? this.currentUrl(tab), undefined, { index: i + 1 });
  }

  closeOtherTabs(i = this.activeTabIndex) {
    const keep = this.tabsArr[i];
    for (const tab of [...this.tabsArr]) {
      if (tab !== keep && !tab.pinned) this.closeTab(this.tabsArr.indexOf(tab));
    }
  }

  closeTabsToRight(i = this.activeTabIndex) {
    for (const tab of this.tabsArr.slice(i + 1)) {
      if (!tab.pinned) this.closeTab(this.tabsArr.indexOf(tab));
    }
  }

  /** Pinned tabs collapse to their icon and stay at the start of the strip. */
  setPinned(i, pinned, save = true) {
    const tab = this.tabsArr[i];
    if (!tab || tab.pinned === pinned) return;
    tab.pinned = pinned;
    tab.tab.classList.toggle("pinned", pinned);
    const pinnedCount = this.tabsArr.filter((t) => t.pinned && t !== tab).length;
    this.moveTab(i, pinnedCount, save);
  }

  /** Reorders the strip only — iframes never move in the DOM, so nothing reloads. */
  moveTab(from, to, save = true) {
    if (from === to || !this.tabsArr[from]) return;
    const active = this.tabsArr[this.activeTabIndex];
    const [tab] = this.tabsArr.splice(from, 1);
    // Pinned tabs always sit before unpinned ones.
    const pinnedOthers = this.tabsArr.filter((t) => t.pinned).length;
    to = tab.pinned ? Math.min(to, pinnedOthers) : Math.max(to, pinnedOthers);
    to = Math.min(Math.max(to, 0), this.tabsArr.length);
    this.tabsArr.splice(to, 0, tab);
    tabStrip.insertBefore(tab.tab, this.tabsArr[to + 1]?.tab ?? addTabButton);
    this.activeTabIndex = this.tabsArr.indexOf(active);
    if (save) this.saveTabs();
  }

  makeDraggable(tab) {
    const el = tab.tab;
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      this.dragging = tab;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(tab.id));
    });
    el.addEventListener("dragend", () => {
      this.dragging = null;
      el.classList.remove("dragging");
      this.saveTabs();
    });
    el.addEventListener("dragover", (e) => {
      const dragged = this.dragging;
      if (!dragged || dragged === tab) return;
      e.preventDefault();
      // Pinned and unpinned tabs each stay in their own group.
      if (dragged.pinned !== tab.pinned) return;
      const rect = el.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      const from = this.tabsArr.indexOf(dragged);
      let to = this.tabsArr.indexOf(tab);
      if (from < to && before) to -= 1;
      if (from > to && !before) to += 1;
      this.moveTab(from, to, false);
    });
  }

  showTabMenu(i, x, y) {
    const tab = this.tabsArr[i];
    if (!tab) return;
    showMenu(x, y, [
      { label: "Reload", onclick: () => this.refresh(i) },
      { label: "Duplicate", onclick: () => this.duplicateTab(i) },
      { label: tab.pinned ? "Unpin" : "Pin", onclick: () => this.setPinned(i, !tab.pinned) },
      { separator: true },
      { label: "Close", onclick: () => this.closeTab(i) },
      { label: "Close other tabs", onclick: () => this.closeOtherTabs(i), disabled: this.tabsArr.length < 2 },
      { label: "Close tabs to the right", onclick: () => this.closeTabsToRight(i), disabled: i >= this.tabsArr.length - 1 },
      { separator: true },
      { label: "Reopen closed tab", onclick: () => this.reopenClosedTab(), disabled: this.closedTabs.length === 0 },
    ]);
  }

  switchTab(i) {
    const tab = this.tabsArr[i];
    if (!tab) return;
    document
      .querySelectorAll(".tab.active, #iframes-container > iframe.active")
      .forEach((elem) => elem.classList.remove("active"));
    tab.iframe.classList.add("active");
    tab.tab.classList.add("active");
    this.activeTabIndex = i;
    tab.tab.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    this.extensions?.hidePopup();

    if (tab.pendingUrl) {
      this.load(tab.pendingUrl, i); // restored tab, shown for the first time
    } else {
      this.updateOmni();
      this.renderTab(tab);
    }
    this.sapphire?.notifyTabActivated(tab.id);
    this.extensions?.render();
    this.saveTabs();
  }

  // ---------------------------------------------------------------- frame events

  /**
   * Called by ShadowPlugin for every proxied document (top level and subframes)
   * as soon as Scramjet has initialised it. This replaces the old onload hook
   * that lived in uv.config.js and the 5 second polling loop.
   */
  onDocument(tab, { window: win, isTopLevel, client }) {
    const refresh = () => this.noteNavigation(tab);

    win.addEventListener("keydown", (e) => this.handleKey(e), true);
    win.addEventListener("mousedown", () => this.dismissOverlays(), true);

    // target="_blank" links and window.open() become Shadow tabs instead of
    // escaping into real browser tabs.
    win.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const link = e.target?.closest?.("a[href]");
      if (!link) return;
      const newTab = link.target === "_blank" || e.ctrlKey || e.metaKey;
      if (!newTab) return;
      const href = link.href; // the element's own (Scramjet) getter returns the real URL
      if (!/^https?:/i.test(href)) return;
      e.preventDefault();
      this.createTab(href, undefined, { active: !(e.ctrlKey || e.metaKey), index: this.tabsArr.indexOf(tab) + 1 });
    });
    win.open = (url) => {
      let target = "shadow://new";
      try {
        if (url) target = new URL(String(url), String(client.url)).href;
      } catch {}
      this.createTab(target, undefined, { index: this.tabsArr.indexOf(tab) + 1 });
      return null;
    };

    if (!isTopLevel) return;

    tab.url = String(client.url);
    win.addEventListener("beforeunload", () => this.setLoading(tab, true));
    win.addEventListener("DOMContentLoaded", refresh);
    win.addEventListener("popstate", refresh);
    win.addEventListener("hashchange", refresh);
    for (const method of ["pushState", "replaceState"]) {
      const original = win.history[method];
      if (typeof original !== "function") continue;
      win.history[method] = function (...args) {
        const result = original.apply(this, args);
        queueMicrotask(refresh);
        return result;
      };
    }
    // Title / favicon changes after load (SPAs, unread counters, …)
    win.addEventListener("DOMContentLoaded", () => {
      const head = win.document.head;
      if (!head) return;
      let queued = false;
      new win.MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(() => {
          queued = false;
          this.renderTab(tab);
        }, 100);
      }).observe(head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href"] });
    });
    // Site-specific compatibility fixups (assets/js/site-patches.js), matched by host.
    try { applySitePatches(win, String(client.url)); } catch (e) { console.debug("[site-patch]", e); }
    refresh();
  }

  /** iframe "load": fires for internal pages and proxied pages alike. */
  onFrameLoad(tab) {
    this.setLoading(tab, false);
    try {
      const win = tab.iframe.contentWindow;
      // Internal pages aren't run through Scramjet, so wire their shortcuts here.
      if (win && !this.isProxied(tab) && !win.__shadowWired) {
        win.__shadowWired = true;
        win.addEventListener("keydown", (e) => this.handleKey(e), true);
        win.addEventListener("mousedown", () => this.dismissOverlays(), true);
      }
    } catch {}
    this.applyZoom(tab);
    this.noteNavigation(tab);
  }

  /** The tab's URL may have changed: refresh the strip, omnibox, history, saved tabs. */
  noteNavigation(tab) {
    if (!this.tabsArr.includes(tab)) return;
    const url = this.currentUrl(tab);
    if (url && url !== "about:blank") tab.url = url;
    // Websites assume a white canvas; Shadow's own pages paint their own background.
    tab.iframe.classList.toggle("proxied", this.isProxied(tab));
    this.renderTab(tab);
    if (this.tabsArr[this.activeTabIndex] === tab) {
      this.updateOmni();
      this.extensions?.render();
    }
    if (/^https?:/i.test(url) && url !== tab.lastHistoryUrl && !tab.loading) {
      tab.lastHistoryUrl = url;
      this.updateHistory(
        url,
        this.titleFor(tab),
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostnameOf(url))}&sz=24`,
      );
    }
    this.saveTabs();
  }

  dismissOverlays() {
    this.hideSuggestions();
    hideMenu();
    this.extensions?.hidePopup();
    closeFind();
    if (this.immersive) this.toggleImmersive(false);
    window.closeMenu?.({ target: document.body });
  }

  setLoading(tab, loading) {
    tab.loading = loading;
    tab.tab.classList.toggle("loading", loading);
  }

  // ---------------------------------------------------------------- tab state

  isProxied(tab) {
    try {
      return !!tab.frame && tab.iframe.contentWindow.location.pathname.startsWith(tab.frame.prefix);
    } catch {
      return false;
    }
  }

  /** The real URL a tab is showing: https://…, shadow://…, or chrome-extension://… */
  currentUrl(tab) {
    if (tab.pendingUrl) return tab.pendingUrl;
    let loc;
    try {
      loc = tab.iframe.contentWindow.location;
      if (!loc || loc.href === "about:blank" || loc.href === "about:srcdoc") return tab.url;
    } catch {
      return tab.url;
    }
    if (tab.frame && loc.pathname.startsWith(tab.frame.prefix)) {
      try {
        const real = $scramjet.unrewriteUrl(loc.href, tab.frame.context);
        return this.sapphire.displayUrl(real);
      } catch {
        return tab.url;
      }
    }
    if (loc.origin !== location.origin) return tab.url;
    const page = loc.pathname.replace(".html", "").replace("/pages/", "").replace(/\//g, "");
    return "shadow://" + (page || "home");
  }

  // Kept for pages/bookmarks that call tabs.parseUrl().
  parseUrl(i = this.activeTabIndex) {
    const tab = this.tabsArr[i];
    return tab ? this.currentUrl(tab) : "";
  }

  titleFor(tab) {
    if (tab.title) return tab.title;
    let title = "";
    if (!tab.pendingUrl) {
      try {
        title = tab.iframe.contentDocument?.title ?? "";
      } catch {}
    }
    if (title) return title;
    const url = tab.pendingUrl ?? tab.url ?? "";
    if (isInternal(url)) {
      const name = url.slice("shadow://".length) || "home";
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return hostnameOf(url) || url || "New Tab";
  }

  iconFor(tab) {
    const url = tab.pendingUrl ?? this.currentUrl(tab) ?? "";
    if (isInternal(url)) return internalIcon(url);
    if (!tab.pendingUrl && this.isProxied(tab)) {
      try {
        const doc = tab.iframe.contentDocument;
        const link = doc?.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]');
        if (link) {
          // Scramjet already rewrote the attribute in the document, so the raw
          // value is a proxied URL that loads through this tab's frame. Read it
          // with this window's untouched getAttribute — the frame's own one is
          // hooked to hand pages back the original, unproxied value.
          const raw = Element.prototype.getAttribute.call(link, "href");
          if (raw) return new URL(raw, tab.iframe.contentWindow.location.href).href;
        }
        if (/^https?:/i.test(url)) {
          return $scramjet.rewriteUrl(new URL("/favicon.ico", url).href, tab.frame.context, {
            origin: new URL(location.href),
            base: new URL(location.href),
          });
        }
      } catch {}
    }
    const host = hostnameOf(url);
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : DEFAULT_ICON;
  }

  renderTab(tab) {
    const title = this.titleFor(tab);
    const titleEl = tab.tab.querySelector(".tab-title");
    if (titleEl.textContent !== title) titleEl.textContent = title;
    tab.tab.title = title;
    const icon = this.iconFor(tab);
    if (tab.iconUrl !== icon) {
      tab.iconUrl = icon;
      tab.img.src = icon;
    }
  }

  updateOmni() {
    const tab = this.tabsArr[this.activeTabIndex];
    if (!tab || document.activeElement === searchInput) return;
    const url = this.currentUrl(tab) ?? "";
    searchInput.value = url === "shadow://new" || url === "shadow://home" ? "" : url;
  }

  getTabInfo(i = this.activeTabIndex) {
    const tab = this.tabsArr[i];
    if (!tab) return { title: "", icon: DEFAULT_ICON, src: "" };
    return { title: this.titleFor(tab), icon: this.iconFor(tab), src: this.currentUrl(tab) };
  }

  /** Refreshes a tab's title and icon. Internal pages call this through parent.setTab(). */
  async setTab(i = this.activeTabIndex) {
    const tab = this.tabsArr[i];
    if (tab) this.renderTab(tab);
    return true;
  }

  // ---------------------------------------------------------------- suggestions

  async displaySearchSuggestions(value = searchInput.value) {
    const container = document.getElementById("suggestions");
    if (!this.searchSuggestions || !value || value.startsWith("shadow://")) {
      container.classList.add("hidden");
      return;
    }
    const token = (this.suggestToken = (this.suggestToken ?? 0) + 1);
    let suggestions = [];
    try {
      suggestions = (await this.getSuggestions(value)) ?? [];
    } catch {
      return;
    }
    // A newer keystroke already asked for suggestions; drop this stale answer.
    if (token !== this.suggestToken || document.activeElement !== searchInput) return;
    suggestions = suggestions.slice(0, 5);
    if (suggestions.length === 0) {
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");
    [...container.children].forEach((elem, i) => {
      const text = suggestions[i];
      elem.classList.toggle("hidden", text === undefined);
      if (text !== undefined) {
        elem.innerText = text;
        elem.dataset.url = text;
      }
    });
  }

  // ---------------------------------------------------------------- session

  saveTabs() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveTabsNow(), 250);
  }

  async saveTabsNow() {
    if (this.restoring) return;
    const entries = this.tabsArr.map((tab) => ({
      url: tab.pendingUrl ?? tab.url,
      pinned: tab.pinned,
    }));
    try {
      (await navigator.serviceWorker.getRegistration()).active.postMessage({
        reason: "save-open-tabs",
        data: [...entries, this.activeTabIndex],
      });
    } catch (e) {
      console.log(`[ATL] Issue with sending request to service worker: ${e}`);
    }
  }

  /**
   * Saved tabs are [...entries, activeIndex]. Entries are {url, pinned}; sessions
   * saved before the Scramjet migration are strings holding Ultraviolet-encoded
   * paths, which are decoded here so nobody loses their tabs on update.
   */
  async loadAllTabs(open) {
    const legacyDecode = (src) => {
      const prefix = "/uv/service/";
      if (src.startsWith(prefix)) return proxyConfig.codec.decode(src.slice(prefix.length));
      if (src.startsWith("/pages/")) return "shadow://" + src.replace("/pages/", "").replace(".html", "");
      return src;
    };
    const entries = open
      .slice(0, -1)
      .map((entry) => (typeof entry === "string" ? { url: legacyDecode(entry), pinned: false } : entry))
      .filter((entry) => entry && typeof entry.url === "string" && entry.url);
    if (entries.length === 0) return false;
    let active = Number(open[open.length - 1]);
    if (!Number.isInteger(active) || active < 0 || active >= entries.length) active = 0;

    this.restoring = true;
    try {
      for (const entry of entries) {
        // Only the active tab loads now; the rest load when first clicked.
        await this.createTab(entry.url, undefined, { active: false, lazy: true, pinned: !!entry.pinned });
      }
    } finally {
      this.restoring = false;
    }
    this.switchTab(active);
    return true;
  }

  async brokenDisclaimer(url = "error") {
    const disclaimer = document.querySelector(".disclaimer");
    const popup = document.querySelector(".overlay");
    popup.style.display = "block";
    document.getElementById("siteRedirect").innerText = url;
    disclaimer.style.display = "block";
    return new Promise((resolve) => {
      const [yes, no] = disclaimer.querySelectorAll("button");
      const done = (value) => {
        popup.style.display = "none";
        disclaimer.style.display = "none";
        resolve(value);
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
    });
  }

  refresh(i = this.activeTabIndex) {
    const tab = this.tabsArr[i];
    if (!tab) return;
    if (tab.pendingUrl) return void this.load(tab.pendingUrl, i);
    this.setLoading(tab, true);
    tab.iframe.contentWindow.location.reload();
  }

  forward(i = this.activeTabIndex) {
    this.tabsArr[i]?.iframe.contentWindow.history.forward();
  }

  backward(i = this.activeTabIndex) {
    this.tabsArr[i]?.iframe.contentWindow.history.back();
  }

  async checkSite(url) {
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      return false;
    }
    if (this.brokenSitesLastUpdated <= Date.now() - 300000 /*5 minutes*/) {
      this.brokenSites = fetch(`/v1/api/broken-sites`)
        .then((res) => res.json())
        .catch(() => ({}));
      this.brokenSitesLastUpdated = Date.now();
    }
    const sites = await this.brokenSites;
    return sites && Object.prototype.hasOwnProperty.call(sites, origin) ? sites[origin] : false;
  }

  async updateHistory(src, title, icon) {
    if (await this.settings.get("history")) {
      await this.history.add({ url: src, time: Date.now(), title, icon });
    }
  }

  // ---------------------------------------------------------------- devtools

  /** Toggles Eruda (an in-page devtools console) inside the active tab. */
  async toggleDevTools(i = this.activeTabIndex) {
    const tab = this.tabsArr[i];
    const win = tab?.iframe.contentWindow;
    if (!win) return;
    try {
      if (win.eruda?._isInit) {
        win.eruda.destroy();
        return;
      }
      if (!win.eruda) {
        this.erudaSource ??= fetch("/eruda/eruda.js").then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        });
        const source = await this.erudaSource;
        // Run it with the frame's own Function constructor so it lands in that realm
        // without going through the proxy's script rewriting.
        new win.Function(source).call(win);
      }
      win.eruda.init();
      win.eruda.show();
    } catch (e) {
      this.erudaSource = null;
      console.error("[DEVTOOLS]", e);
      toast("Couldn't open devtools on this page.");
    }
  }

  // ---------------------------------------------------------------- keyboard

  /**
   * Shortcuts use Alt because the real browser owns the Ctrl ones. Bound on the
   * shell and inside every tab, so they work wherever focus is.
   */
  // ---------------------------------------------------------------- view

  /** Page zoom for one tab. action: "in" | "out" | "reset" | a number. */
  setZoom(i, action) {
    const tab = this.tabsArr[i];
    if (!tab) return;
    const steps = [0.3, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    if (typeof action === "number") tab.zoom = action;
    else if (action === "reset") tab.zoom = 1;
    else {
      const idx = steps.reduce((best, v, n) => (Math.abs(v - tab.zoom) < Math.abs(steps[best] - tab.zoom) ? n : best), 0);
      tab.zoom = steps[Math.max(0, Math.min(steps.length - 1, idx + (action === "in" ? 1 : -1)))];
    }
    this.applyZoom(tab);
    if (tab.zoom !== 1) toast(`Zoom ${Math.round(tab.zoom * 100)}%`, { timeout: 1000 });
  }

  applyZoom(tab) {
    try {
      const body = tab.iframe.contentDocument?.body;
      if (body) body.style.zoom = tab.zoom === 1 ? "" : String(tab.zoom);
    } catch {}
  }

  /** Immersive mode: hide the shell chrome so the page fills the window. */
  toggleImmersive(force) {
    this.immersive = force === undefined ? !this.immersive : force;
    document.body.classList.toggle("immersive", this.immersive);
    if (this.immersive) toast("Immersive mode — Alt+Enter or Esc to exit", { timeout: 1600 });
  }

  handleKey(e) {
    // Panic key: one press anywhere (shell or inside a page) jumps the whole
    // window to a safe site. Ignored while typing so the key can still be typed.
    if (this.panicKey && e.key === this.panicKey) {
      const el = e.target;
      const typing = el && (/^(input|textarea|select)$/i.test(el.tagName || "") || el.isContentEditable);
      if (!typing) {
        e.preventDefault();
        try {
          window.top.location.href = this.panicUrl || "https://www.google.com";
        } catch {
          window.location.href = this.panicUrl || "https://www.google.com";
        }
        return true;
      }
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const n = this.tabsArr.length;
      let handled = true;
      if (key === "t" && e.shiftKey) this.reopenClosedTab();
      else if (key === "t") this.createTab();
      else if (key === "w") this.closeTab();
      else if (key === "r") this.refresh();
      else if (key === "d") this.duplicateTab();
      else if (key === "p") this.setPinned(this.activeTabIndex, !this.tabsArr[this.activeTabIndex]?.pinned);
      else if (key === "k") openCommandPalette(this);
      else if (key === "f") openFind(this);
      else if (key === "Enter") this.toggleImmersive();
      else if (key === "=" || key === "+") this.setZoom(this.activeTabIndex, "in");
      else if (key === "-" || key === "_") this.setZoom(this.activeTabIndex, "out");
      else if (key === "0") this.setZoom(this.activeTabIndex, "reset");
      else if (key === "l") {
        window.focus();
        searchInput.focus();
        searchInput.select();
      } else if (key === "ArrowLeft") this.backward();
      else if (key === "ArrowRight") this.forward();
      else if (key === "PageDown" || key === "]") this.switchTab((this.activeTabIndex + 1) % n);
      else if (key === "PageUp" || key === "[") this.switchTab((this.activeTabIndex - 1 + n) % n);
      else if (/^[1-9]$/.test(key)) this.switchTab(key === "9" ? n - 1 : Math.min(Number(key), n) - 1);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
    }
    if (e.key === "Escape") this.dismissOverlays();
    // Extension keyboard commands (manifest "commands").
    try {
      if (this.sapphire?.handleKeyboardEvent(e)) {
        e.preventDefault();
        return true;
      }
    } catch {}
    return false;
  }
}

const tabs = new Tab();
window.tabs = tabs;

document.addEventListener("keydown", (e) => tabs.handleKey(e));

let suggestTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => tabs.displaySearchSuggestions(searchInput.value), 120);
});
searchInput.addEventListener("focus", () => {
  if (searchInput.value != "") tabs.displaySearchSuggestions();
});
searchInput.addEventListener("blur", () => setTimeout(() => tabs.updateOmni(), 150));
document.addEventListener("click", (e) => {
  if (e.target !== searchInput) tabs.hideSuggestions();
});
window.addEventListener("message", (message) => {
  if (message.data === "hide-suggestions") tabs.hideSuggestions();
});
// Double-click the empty part of the tab strip for a new tab.
tabStrip.addEventListener("dblclick", (e) => {
  if (e.target === tabStrip) tabs.createTab();
});
window.addEventListener("pagehide", () => tabs.saveTabsNow());
