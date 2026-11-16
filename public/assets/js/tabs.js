import { HistoryHelper } from "/assets/js/history_helper.js";
import { SettingsManager } from "/assets/js/settings_manager.js";
import { ExtensionUI } from "/assets/js/extension_ui.js";
import { showMenu, hideMenu, hidePopover, toast } from "/assets/js/ui.js";
import { applySitePatches } from "/assets/js/site-patches.js";
import { openCommandPalette, openFind, closeFind, resetFind } from "/assets/js/features.js";
import { Downloads, isInlineType, filenameFromDisposition } from "/assets/js/downloads.js";
import { SiteSettings, showSitePanel } from "/assets/js/sitesettings.js";
import { Workspaces } from "/assets/js/workspaces.js";
import {
  showPageMenu,
  showToolsMenu,
  toggleReader,
  closeReader,
  readerIsOpen,
  readerTabChanged,
  translatePage,
  screenshot,
  togglePictureInPicture,
  downloadVideo,
  setDarkMode,
  refreshTabDarkMode,
} from "/assets/js/pagetools.js";

// Scramjet, its controller and /dist/shadow-proxy.js (Sapphire + ShadowPlugin) are
// only loaded when the first proxied page is opened — see Tab.bootProxy(). A visit
// that only plays the built-in games never downloads or boots any of it.
let Controller, Sapphire, ShadowPlugin;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-lazy="${src}"]`)) return resolve();
    const el = document.createElement("script");
    el.src = src;
    el.dataset.lazy = src;
    el.onload = () => resolve();
    el.onerror = () => {
      el.remove();
      reject(new Error(`Couldn't load ${src}`));
    };
    document.head.append(el);
  });
}

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
// or a blob: this page made (an opened download) — never run through the proxy.
const isLocalPath = (url) => /^\/[^/]/.test(url) || url.startsWith(`blob:${location.origin}/`);
// Pages that talk to the extension runtime, so they need the proxy booted first.
const needsProxy = (url) => /^shadow:\/\/(extensions|store)\b/.test(url);
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
    this.siteSettings = new SiteSettings(this.settings);
    this.downloads = new Downloads(this);
    this.workspaces = new Workspaces(this);
    /** Split view: {left, right} tab objects while two tabs share the window, else null. */
    this.split = null;
    this.forceDark = false;
    this.verticalTabs = false;
    this.proxyBoot = null;
    this.warmed = new Map();

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
    // Changes made in other frames (the settings page, sync) arrive here.
    try {
      new BroadcastChannel("shadow-settings").addEventListener("message", (e) => this.onRemoteSetting(e.data?.key));
    } catch {}

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
    this.forceDark = !!(await this.settings.get("force-dark"));
    this.downloads.autoSave = (await this.settings.get("downloads-autosave")) !== false;
    this.setVerticalTabs(!!(await this.settings.get("vertical-tabs")), false);
    await this.siteSettings.ready;

    // The service worker also caches the shell and saves the session, so it is
    // registered up front; Scramjet itself waits for the first proxied page.
    this.registerServiceWorker().catch((e) => console.debug("[SW]", e));
    if (await this.hasExtensions()) {
      // Installed extensions have background pages and toolbar buttons that
      // should be there from the start, so boot right away for those users.
      this.ensureProxy().catch(() => {});
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

  registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return Promise.reject(new Error("This browser doesn't support service workers."));
    }
    this.swRegistration ??= navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return this.swRegistration;
  }

  /** Whether any extension is installed, without booting the extension runtime. */
  async hasExtensions() {
    const known = await this.settings.get("has-extensions");
    if (typeof known === "boolean") return known;
    // Never recorded (first run of this version): look for Sapphire's database.
    try {
      if (!indexedDB.databases) return true;
      return (await indexedDB.databases()).some((db) => db.name === "sapphire_extensions");
    } catch {
      return true;
    }
  }

  /**
   * Boots the proxy once, on first use. Resolves when proxied pages can load;
   * rejects (and can be retried by the next call) if it couldn't start.
   */
  ensureProxy() {
    if (this.controller) return Promise.resolve();
    this.proxyBoot ??= this.bootProxy().then(
      () => {
        this.proxyError = null;
      },
      (e) => {
        this.proxyError = e;
        this.proxyBoot = null;
        console.error("[PROXY] Failed to start Scramjet:", e);
        throw e;
      },
    );
    return this.proxyBoot;
  }

  /** Service worker -> transport -> Scramjet controller -> Sapphire (extensions). */
  async bootProxy() {
    // Classic scripts that set $scramjet / $scramjetController; the bundle
    // imported right after builds on those globals, so the order matters.
    if (typeof $scramjet === "undefined") await loadScript("/scramjet/scramjet.js");
    if (typeof $scramjetController === "undefined") await loadScript("/controller/controller.api.js");
    if (typeof $scramjet === "undefined" || typeof $scramjetController === "undefined") {
      throw new Error("Scramjet failed to load.");
    }
    ({ Controller, Sapphire, ShadowPlugin } = await import("/dist/shadow-proxy.js"));

    await this.registerServiceWorker();
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

    const controller = new Controller({
      serviceworker,
      transport: this.transport,
      config: proxyConfig,
    });
    await controller.wait();

    this.extensions = new ExtensionUI(this);
    this.sapphire = new Sapphire({ host: this.hostBindings() });
    this.sapphire.attachController(controller);
    this.extensions.attach(this.sapphire);
    try {
      await this.sapphire.init(); // starts previously installed extensions
    } catch (e) {
      console.error("[EXT] Failed to restore extensions:", e);
    }
    // Only now can proxied pages load: every tab opened so far gets its frame.
    this.controller = controller;
    for (const tab of this.tabsArr) {
      this.ensureFrame(tab);
      this.sapphire.notifyTabCreated(tab.id);
    }
    const rememberExtensions = () => {
      try {
        const has = this.sapphire.getInstalledExtensions(null).length > 0;
        if (has !== this.knownHasExtensions) this.settings.set("has-extensions", (this.knownHasExtensions = has));
      } catch {}
    };
    this.sapphire.onChange(rememberExtensions);
    rememberExtensions();
    this.extensions.render();
  }

  /** Attaches a Scramjet frame (and the extension + Shadow plugins) to a tab's iframe. */
  ensureFrame(tab) {
    if (tab.frame || !this.controller) return;
    const plugins = [
      new ShadowPlugin({
        onDocument: (ctx) => this.onDocument(tab, ctx),
        getUserAgent: () => this.siteSettings.userAgentFor(this.hostFor(tab)) ?? this.userAgent,
        onNavigationResponse: (info) => this.onNavigationResponse(tab, info),
        onResponse: (info) => this.onProxyResponse(tab, info),
      }),
    ];
    if (this.sapphire) plugins.unshift(this.sapphire.createPlugin(tab.id));
    tab.frame = this.controller.createFrame(tab.iframe, { plugins });
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
      // Sapphire's contextmenu listener runs just before ours (onDocument): park
      // its entries so they're shown inside the page menu. If nothing picks them
      // up, they get a menu of their own.
      showContextMenu: (request) => {
        this.pendingExtMenu = request;
        setTimeout(() => {
          if (this.pendingExtMenu !== request) return;
          this.pendingExtMenu = null;
          this.extensions.showContextMenu(request);
        }, 60);
      },
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
      incognito: !!tab.private,
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
    const token = (tab.navToken = (tab.navToken ?? 0) + 1);
    this.setLoading(tab, true);
    if (i === this.activeTabIndex) resetFind();
    readerTabChanged(tab);
    this.renderTab(tab);
    if (i === this.activeTabIndex) this.updateOmni();

    const proxied = !isInternal(url) && !isLocalPath(url) && url !== "about:blank";
    if (proxied || needsProxy(url)) {
      try {
        await this.ensureProxy();
      } catch {
        // Internal pages still work without the proxy; proxied loads show the error.
      }
      // The tab was closed or sent somewhere else while the proxy was starting.
      if (!this.tabsArr.includes(tab) || tab.navToken !== token) return false;
    }

    if (isInternal(url)) {
      tab.iframe.src = internalPath(url);
    } else if (!proxied) {
      tab.iframe.src = url;
    } else if (!this.controller) {
      this.showProxyError(tab, url);
    } else {
      this.ensureFrame(tab);
      tab.frame.go(this.sapphire.resolveUrl(url));
    }
    this.saveTabs();
    return true;
  }

  showProxyError(tab, url) {
    const doc = `<!doctype html><meta charset="utf-8"><title>Proxy unavailable</title>
<body style="font-family:Poppins,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:520px;padding:24px"><h2>Shadow couldn't start the proxy</h2>
<p id="m"></p><p id="u" style="opacity:.6;word-break:break-all"></p>
<p>Try reloading the page, or use a current version of Chrome, Edge or Firefox.</p></div></body>`;
    this.setLoading(tab, false);
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
   * @param {{active?: boolean, lazy?: boolean, pinned?: boolean, index?: number, private?: boolean}} [options]
   *   lazy tabs aren't loaded until they're first shown (used when restoring a session).
   *   private tabs leave no trace in history, the saved session or "reopen closed tab".
   */
  async createTab(
    src = this.tabsArr.length === 0 ? "shadow://home" : "shadow://new",
    title,
    { active = true, lazy = false, pinned = false, index, private: isPrivate = false } = {},
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
      private: !!isPrivate,
      loading: false,
      zoom: 1,
      lastHistoryUrl: null,
    };

    tab.tab.classList.add("tab");
    tab.tab.classList.toggle("private", tab.private);
    tab.tab.dataset.tabId = String(tab.id);
    this.createTabItems(tab);
    tab.iframe.title = "Content IFrame";
    tab.iframe.allow = "fullscreen; clipboard-read; clipboard-write; autoplay";
    tab.iframe.addEventListener("load", () => this.onFrameLoad(tab));
    iframesContainer.appendChild(tab.iframe);

    // Before the proxy has booted there is no frame yet; bootProxy() adds one
    // to every open tab when it finishes.
    this.ensureFrame(tab);

    const at = typeof index === "number" ? Math.min(Math.max(index, 0), this.tabsArr.length) : this.tabsArr.length;
    this.tabsArr.splice(at, 0, tab);
    if (at <= this.activeTabIndex) this.activeTabIndex++;
    tabStrip.insertBefore(tab.tab, this.tabsArr[at + 1]?.tab ?? addTabButton);
    if (pinned) this.setPinned(at, true, false);
    if (this.controller) this.sapphire?.notifyTabCreated(tab.id);

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

  /**
   * @param {boolean} [force] don't open a fresh tab when the last one closes
   * @param {{remember?: boolean}} [options] remember=false keeps it out of "reopen closed tab"
   */
  closeTab(i = this.activeTabIndex, force = false, { remember = true } = {}) {
    const tab = this.tabsArr[i];
    if (!tab) return;

    const url = tab.pendingUrl ?? this.currentUrl(tab);
    if (remember && !tab.private && url && url !== "shadow://new" && url !== "about:blank" && !url.startsWith("blob:")) {
      this.closedTabs.push({ url, pinned: tab.pinned, index: i });
      if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift();
    }

    readerTabChanged(tab);
    if (this.split && (this.split.left === tab || this.split.right === tab)) {
      // The other half takes over the whole window.
      const other = this.split.left === tab ? this.split.right : this.split.left;
      this.endSplit();
      if (this.tabsArr[this.activeTabIndex] === tab) this.switchTab(this.tabsArr.indexOf(other));
    }
    const wasActive = this.activeTabIndex === i;
    tab.iframe.remove();
    tab.tab.remove();
    this.tabsArr.splice(i, 1);
    if (tab.frame && this.controller) {
      const at = this.controller.frames.indexOf(tab.frame);
      if (at !== -1) this.controller.frames.splice(at, 1);
    }
    if (this.controller) this.sapphire?.notifyTabRemoved(tab.id);

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
    this.createTab(tab.pendingUrl ?? this.currentUrl(tab), undefined, { index: i + 1, private: tab.private });
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
      const before = this.verticalTabs ? e.clientY < rect.top + rect.height / 2 : e.clientX < rect.left + rect.width / 2;
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
    const inSplit = !!this.split && (this.split.left === tab || this.split.right === tab);
    showMenu(x, y, [
      { label: "Reload", onclick: () => this.refresh(i) },
      { label: "Duplicate", onclick: () => this.duplicateTab(i) },
      { label: tab.pinned ? "Unpin" : "Pin", onclick: () => this.setPinned(i, !tab.pinned) },
      inSplit
        ? { label: "Exit split view", onclick: () => this.endSplit() }
        : { label: "Open in split view", onclick: () => this.splitWith(i), disabled: this.tabsArr.length < 2 || i === this.activeTabIndex },
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
    const previous = this.tabsArr[this.activeTabIndex];
    if (previous !== tab) readerTabChanged();
    if (this.split && tab !== this.split.left && tab !== this.split.right) {
      // A tab from outside the pair replaces whichever half has focus.
      const side = previous === this.split.right ? "right" : "left";
      this.split[side] = tab;
    }
    document
      .querySelectorAll(".tab.active, #iframes-container > iframe.active")
      .forEach((elem) => elem.classList.remove("active"));
    tab.iframe.classList.add("active");
    tab.tab.classList.add("active");
    this.activeTabIndex = i;
    this.renderSplit();
    tab.tab.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    this.extensions?.hidePopup();

    if (tab.pendingUrl) {
      this.load(tab.pendingUrl, i); // restored tab, shown for the first time
    } else {
      this.updateOmni();
      this.renderTab(tab);
    }
    if (this.controller) this.sapphire?.notifyTabActivated(tab.id);
    this.extensions?.render();
    this.saveTabs();
  }

  // ---------------------------------------------------------------- split view

  /** Shows tab `i` beside the active tab. */
  splitWith(i) {
    const other = this.tabsArr[i];
    const active = this.tabsArr[this.activeTabIndex];
    if (!other || !active || other === active) return;
    this.split = { left: active, right: other };
    this.renderSplit();
    if (other.pendingUrl) this.load(other.pendingUrl, i); // a restored tab that hasn't loaded yet
  }

  /** Opens a URL in a new tab beside the active one. */
  async openInSplit(url = "shadow://new") {
    const active = this.tabsArr[this.activeTabIndex];
    await this.createTab(url, undefined, { active: false, index: this.activeTabIndex + 1, private: active?.private });
    this.splitWith(this.tabsArr.indexOf(active) + 1);
  }

  /** Menu / Alt+S: split with the neighbouring tab (or a new one), or leave split view. */
  toggleSplit() {
    if (this.split) return this.endSplit();
    if (this.tabsArr.length < 2) return void this.openInSplit();
    const i = this.activeTabIndex;
    this.splitWith(i + 1 < this.tabsArr.length ? i + 1 : i - 1);
  }

  endSplit() {
    if (!this.split) return;
    this.split = null;
    this.renderSplit();
  }

  renderSplit() {
    const split = this.split;
    iframesContainer.classList.toggle("split", !!split);
    for (const tab of this.tabsArr) {
      tab.iframe.classList.toggle("split-left", !!split && split.left === tab);
      tab.iframe.classList.toggle("split-right", !!split && split.right === tab);
      tab.tab.classList.toggle("in-split", !!split && (split.left === tab || split.right === tab));
    }
    let divider = document.getElementById("split-divider");
    if (!split) return void divider?.remove();
    if (!divider) {
      divider = document.createElement("div");
      divider.id = "split-divider";
      divider.title = "Drag to resize, double-click to reset";
      // Iframes swallow pointer events, so they're made inert while dragging.
      divider.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        divider.setPointerCapture(e.pointerId);
        iframesContainer.classList.add("resizing");
      });
      divider.addEventListener("pointermove", (e) => {
        if (!iframesContainer.classList.contains("resizing")) return;
        const rect = iframesContainer.getBoundingClientRect();
        const ratio = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
        iframesContainer.style.setProperty("--split", String(ratio));
      });
      const stop = () => iframesContainer.classList.remove("resizing");
      divider.addEventListener("pointerup", stop);
      divider.addEventListener("pointercancel", stop);
      divider.addEventListener("dblclick", () => iframesContainer.style.removeProperty("--split"));
      iframesContainer.append(divider);
    }
  }

  /** A click or key press landed in a tab's page: in split view that half takes focus. */
  focusPane(tab) {
    if (!this.split || this.tabsArr[this.activeTabIndex] === tab) return;
    if (tab === this.split.left || tab === this.split.right) this.switchTab(this.tabsArr.indexOf(tab));
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
    win.addEventListener(
      "mousedown",
      () => {
        this.dismissOverlays();
        this.focusPane(tab);
      },
      true,
    );
    // Our own right-click menu. Shift+right-click keeps the browser's.
    win.addEventListener(
      "contextmenu",
      (e) => {
        if (e.shiftKey) return;
        e.preventDefault();
        const ext = this.pendingExtMenu; // parked by Sapphire's listener, which runs first
        this.pendingExtMenu = null;
        this.focusPane(tab);
        showPageMenu(this, tab, win, e, ext ? this.extensions.menuItems(ext) : []);
      },
      true,
    );
    // Forced dark mode goes in as early as possible so the page doesn't flash
    // white; it is re-checked once the page's own styles have loaded.
    const dark = () => setDarkMode(win, isTopLevel, this.darkModeFor(tab) && (isTopLevel || !!tab.iframe.contentDocument?.getElementById("__shadow-dark")));
    try {
      dark();
      win.addEventListener("DOMContentLoaded", dark);
      win.addEventListener("load", dark);
    } catch {}

    // target="_blank" links and window.open() become Shadow tabs instead of
    // escaping into real browser tabs.
    win.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const link = e.target?.closest?.("a[href]");
      if (!link) return;
      const href = link.href; // the element's own (Scramjet) getter returns the real URL
      // <a download>: fetch it into the downloads manager instead of navigating.
      if (link.hasAttribute("download") && /^(https?|blob|data):/i.test(href)) {
        e.preventDefault();
        this.downloads.start({ url: href, win, name: link.getAttribute("download") || "" });
        return;
      }
      const newTab = link.target === "_blank" || e.ctrlKey || e.metaKey;
      if (!newTab) return;
      if (!/^https?:/i.test(href)) return;
      e.preventDefault();
      this.createTab(href, undefined, { active: !(e.ctrlKey || e.metaKey), index: this.tabsArr.indexOf(tab) + 1, private: tab.private });
    });
    win.open = (url) => {
      let target = "shadow://new";
      try {
        if (url) target = new URL(String(url), String(client.url)).href;
      } catch {}
      this.createTab(target, undefined, { index: this.tabsArr.indexOf(tab) + 1, private: tab.private });
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
        win.addEventListener(
          "mousedown",
          () => {
            this.dismissOverlays();
            this.focusPane(tab);
          },
          true,
        );
      }
    } catch {}
    this.noteNavigation(tab);
    this.applyZoom(tab);
  }

  /**
   * A document navigation got its response (ShadowPlugin, before any rewriting).
   * Attachments and types the browser can't show are taken over by the downloads
   * manager; returning true tells the plugin to answer the navigation with
   * "204 No Content", which leaves the tab on the page it was on.
   */
  onNavigationResponse(tab, { url, headers, body }) {
    const header = (name) => headers.find(([key]) => key.toLowerCase() === name)?.[1] ?? "";
    const disposition = header("content-disposition");
    const type = header("content-type");
    const attachment = /^\s*attachment/i.test(disposition);
    if (!attachment && isInlineType(type)) return false;

    this.downloads.fromBody({
      body,
      url,
      name: filenameFromDisposition(disposition),
      mime: type,
      size: Number(header("content-length")),
    });
    // Nothing navigates, so undo the "loading" state the click put the tab in.
    setTimeout(() => {
      if (!this.tabsArr.includes(tab)) return;
      this.setLoading(tab, false);
      let blank = true;
      try {
        const href = tab.iframe.contentWindow.location.href;
        blank = href === "about:blank" || href === "about:srcdoc";
      } catch {}
      if (blank) {
        // The tab was opened just for this file (a download link in a new tab).
        if (this.tabsArr.length > 1) this.closeTab(this.tabsArr.indexOf(tab), false, { remember: false });
        else this.load("shadow://new", this.tabsArr.indexOf(tab));
      } else {
        this.noteNavigation(tab);
      }
    }, 0);
    return true;
  }

  /** Every proxied response, after rewriting: the place for per-site response rules. */
  onProxyResponse(tab, { url, destination, headers }) {
    if (destination !== "document" && destination !== "iframe") return;
    // The top document decides by its own host; frames follow the tab they're in.
    let host = this.hostFor(tab);
    if (destination === "document") {
      try {
        host = new URL(url).hostname;
      } catch {}
    }
    if (this.siteSettings.get(host).js === false) {
      // Scramjet strips the site's own CSP; this one switches scripts off entirely.
      headers.set("content-security-policy", "script-src 'none'");
    }
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
    // Per-site zoom: applied when the tab lands on a different site.
    const host = this.hostFor(tab);
    if (host !== tab.zoomHost) {
      tab.zoomHost = host;
      tab.zoom = this.siteSettings.get(host).zoom ?? 1;
      this.applyZoom(tab);
    }
    if (!tab.private && /^https?:/i.test(url) && url !== tab.lastHistoryUrl && !tab.loading) {
      tab.lastHistoryUrl = url;
      this.updateHistory(
        url,
        this.titleFor(tab),
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostnameOf(url))}&sz=24`,
      );
    }
    this.saveTabs();
  }

  dismissOverlays({ keepReader = false } = {}) {
    this.hideSuggestions();
    hideMenu();
    hidePopover();
    this.extensions?.hidePopup();
    closeFind();
    if (!keepReader && readerIsOpen()) closeReader();
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
    if (loc.origin !== location.origin || loc.protocol === "blob:") return tab.url;
    // Local pages that aren't shadow:// pages (the arcade, embeds) keep their path.
    if (isLocalPath(tab.url ?? "") && !tab.url.startsWith("blob:") && loc.pathname.startsWith(tab.url.split(/[?#]/)[0].replace(/[^/]*$/, ""))) return tab.url;
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
    searchInput.value = url === "shadow://new" || url === "shadow://home" || url.startsWith("blob:") ? "" : url;
    document.getElementById("uv-form").classList.toggle("private", !!tab.private);
    window.bookmarksManager?.updateStar(url);
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
    // Private tabs and opened downloads (blob: URLs die with the page) aren't saved.
    const saved = this.tabsArr.filter((tab) => !tab.private && !(tab.pendingUrl ?? tab.url ?? "").startsWith("blob:"));
    const entries = saved.map((tab) => ({
      url: tab.pendingUrl ?? tab.url,
      pinned: tab.pinned,
    }));
    const active = Math.max(0, saved.indexOf(this.tabsArr[this.activeTabIndex]));
    try {
      (await navigator.serviceWorker.getRegistration()).active.postMessage({
        reason: "save-open-tabs",
        data: [...entries, active],
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
    const host = this.hostFor(tab);
    if (host) {
      tab.zoomHost = host;
      this.siteSettings.set(host, { zoom: tab.zoom });
      // Other tabs on the same site follow, like in any other browser.
      for (const other of this.tabsArr) {
        if (other !== tab && this.hostFor(other) === host) {
          other.zoom = tab.zoom;
          this.applyZoom(other);
        }
      }
    }
    if (tab.zoom !== 1) toast(`Zoom ${Math.round(tab.zoom * 100)}%`, { timeout: 1000 });
  }

  // ---------------------------------------------------------------- per-site state

  /** Hostname of the website a tab is showing ("" for Shadow's own pages). */
  hostFor(tab) {
    const url = tab?.pendingUrl ?? tab?.url ?? "";
    return /^https?:/i.test(url) ? hostnameOf(url) : "";
  }

  darkModeFor(tab) {
    const site = this.siteSettings.get(this.hostFor(tab)).dark;
    return site ?? this.forceDark;
  }

  setForceDark(on) {
    this.forceDark = !!on;
    this.settings.set("force-dark", this.forceDark);
    this.refreshDarkMode();
    toast(`Dark mode for every site: ${this.forceDark ? "on" : "off"}`, { timeout: 1500 });
  }

  refreshDarkMode() {
    for (const tab of this.tabsArr) refreshTabDarkMode(this, tab);
  }

  showSitePanel() {
    showSitePanel(this, document.getElementById("site-button"));
  }

  openFind() {
    openFind(this);
  }

  /** A setting changed in another frame (settings page, sync): pick up the ones cached here. */
  async onRemoteSetting(key) {
    switch (key) {
      case "force-dark": {
        const on = !!(await this.settings.get(key));
        if (on !== this.forceDark) {
          this.forceDark = on;
          this.refreshDarkMode();
        }
        break;
      }
      case "vertical-tabs":
        this.setVerticalTabs(!!(await this.settings.get(key)), false);
        break;
      case "site-settings":
        await this.siteSettings.load();
        this.refreshDarkMode();
        break;
      case "workspaces":
        await this.workspaces.load();
        break;
      case "bookmarks":
      case "bookmarks-bar":
        await window.bookmarksManager?.load();
        break;
      case "downloads-autosave":
        this.downloads.autoSave = (await this.settings.get(key)) !== false;
        break;
      case "search-engine":
      case "search-suggestions":
      case "search-suggestions-engine":
      case "user-agent":
      case "panic-key":
      case "panic-url": {
        const value = await this.settings.get(key);
        window.dispatchEvent(new CustomEvent("settings", { detail: { key, newValue: value } }));
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- layout

  setVerticalTabs(on, save = true) {
    this.verticalTabs = !!on;
    document.body.classList.toggle("vertical-tabs", this.verticalTabs);
    if (save) this.settings.set("vertical-tabs", this.verticalTabs);
    window.bookmarksManager?.layout();
  }

  /** The toolbar menu's "View" entry. */
  showViewMenu(x, y) {
    const bookmarks = window.bookmarksManager;
    showMenu(x, y, [
      { label: "Split view", checked: !!this.split, onclick: () => this.toggleSplit() },
      { label: "Vertical tabs", checked: this.verticalTabs, onclick: () => this.setVerticalTabs(!this.verticalTabs) },
      { label: "Bookmarks bar", checked: !!bookmarks?.visible, onclick: () => bookmarks?.setVisible(!bookmarks.visible) },
      { label: "Immersive mode", checked: !!this.immersive, onclick: () => this.toggleImmersive() },
      { separator: true },
      { label: "Zoom in", onclick: () => this.setZoom(this.activeTabIndex, "in") },
      { label: "Zoom out", onclick: () => this.setZoom(this.activeTabIndex, "out") },
      { label: "Reset zoom", onclick: () => this.setZoom(this.activeTabIndex, "reset") },
    ]);
  }

  showToolsMenu(x, y) {
    showToolsMenu(this, x, y);
  }

  /** The toolbar menu's "More" entry: the less-used destinations and window actions. */
  showMoreMenu(x, y) {
    const pwa = window.shadowPwa;
    showMenu(x, y, [
      { label: "Store", onclick: () => this.createTab("shadow://store") },
      { label: "AI", onclick: () => this.createTab("shadow://ai") },
      { label: "Chat", onclick: () => toast("Coming in Shadow 3.1.1", { timeout: 2500 }) },
      { label: "Discord", onclick: () => this.createTab("discord.gg/goshadow") },
      { separator: true },
      { label: "Fullscreen", onclick: () => window.iframefullscreen?.() },
      { label: "Open in about:blank", onclick: () => window.abtblank?.() },
      { label: "Open tab in about:blank", onclick: () => window.iframeabtblank?.() },
      ...(pwa?.canInstall ? [{ label: "Install Shadow", onclick: () => pwa.install() }] : []),
      { separator: true },
      { label: "Devtools", onclick: () => this.toggleDevTools() },
      { label: "Copy debug info", onclick: () => navigator.clipboard.writeText(window.dewasper.dump()).then(() => toast("Debug info copied.", { timeout: 1500 })) },
    ]);
  }

  // ---------------------------------------------------------------- prewarm

  /**
   * Opens the connection to a site the user is probably about to visit (hovering
   * a bookmark or suggestion, typing an address), so the real navigation skips
   * the DNS + TLS setup. One cheap HEAD per origin, rate limited.
   */
  prewarm(input) {
    let url;
    try {
      url = new URL(self.resolveInput(String(input ?? ""), this.searchEngine));
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol)) return;
    if (!this.controller) {
      // First sign of intent to browse: get the proxy itself ready instead.
      this.ensureProxy().catch(() => {});
      return;
    }
    const now = Date.now();
    const last = this.warmed.get(url.origin);
    if (last && now - last < 120_000) return;
    if ([...this.warmed.values()].filter((t) => now - t < 10_000).length >= 4) return;
    if (this.warmed.size > 200) this.warmed.clear();
    this.warmed.set(url.origin, now);
    try {
      const headers = [["user-agent", this.userAgent ?? navigator.userAgent]];
      Promise.resolve(this.transport.request(new URL(url.origin + "/"), "HEAD", null, headers, undefined))
        .then((res) => res?.body?.cancel?.())
        .catch(() => {});
    } catch {}
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
      else if (key === "n" && e.shiftKey) this.createTab("shadow://new", undefined, { private: true });
      else if (key === "w") this.closeTab();
      else if (key === "r" && e.shiftKey) toggleReader(this);
      else if (key === "r") this.refresh();
      else if (key === "s" && e.shiftKey) screenshot(this);
      else if (key === "s") this.toggleSplit();
      else if (key === "b") window.bookmarksManager?.setVisible(!window.bookmarksManager.visible);
      else if (key === "j") this.downloads.togglePanel();
      else if (key === "v") this.setVerticalTabs(!this.verticalTabs);
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
// Someone clicking into the address bar is about to browse: get the proxy ready
// now, and warm up the connection to wherever they seem to be headed.
searchInput.addEventListener("focus", () => tabs.prewarm(tabs.searchEngine?.replace("%s", "") ?? ""));
let warmTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(warmTimer);
  const value = searchInput.value.trim();
  if (value.length < 4 || value.startsWith("shadow://")) return;
  warmTimer = setTimeout(() => tabs.prewarm(value), 350);
});
document.getElementById("suggestions").addEventListener("mouseover", (e) => {
  const item = e.target.closest?.(".suggestion-item");
  if (item?.dataset.url) tabs.prewarm(item.dataset.url);
});
document.getElementById("site-button")?.addEventListener("click", () => tabs.showSitePanel());
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
