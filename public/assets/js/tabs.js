import { HistoryHelper } from "/assets/js/history_helper.js";
import { SettingsManager } from "/assets/js/settings_manager.js";
import { ExtensionUI } from "/assets/js/extension_ui.js";
import { showMenu, hideMenu, menuOpenFor, hidePopover, toast, svgIcon, faviconFor } from "/assets/js/ui.js";
import { TabGroups } from "/assets/js/tabgroups.js";
import { watchAudio, setTabMuted, forgetAudio, sameOriginFrames, ICON_SOUND, ICON_MUTED } from "/assets/js/tabaudio.js";
import { applySitePatches } from "/assets/js/site-patches.js";
import { openCommandPalette, openFind, closeFind, resetFind } from "/assets/js/features.js";
import { Downloads, isInlineType, filenameFromDisposition } from "/assets/js/downloads.js";
import { SiteSettings, showSitePanel } from "/assets/js/sitesettings.js";
import { Workspaces } from "/assets/js/workspaces.js";
import { maskDocument } from "/assets/js/textmask.js";
import {
  showPageMenu,
  toolsMenuItems,
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
// that never opens a website never downloads or boots any of it.
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
// A site whose icon can't be loaded gets a plain globe, not Shadow's logo.
const GLOBE_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>')}`;
const googleFavicon = (host) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
const MAX_CLOSED_TABS = 25;
// Recently closed tabs survive a reload of the shell (but not the browser tab closing).
const CLOSED_TABS_KEY = "shadow-closed-tabs";
// Back/Forward entries kept per tab.
const MAX_TAB_HISTORY = 50;
const wsScheme = location.protocol === "https:" ? "wss" : "ws";
const defaultWisp = `${wsScheme}://${location.host}/wisp/`;

// Proxied URLs look like /~/s/<controller id>/<frame id>/<encoded url>. The ids are
// random per page load, so an encoded URL is never valid after a reload — anything
// that has to survive one (saved tabs, history, bookmarks) stores the real URL.
//
// The codec functions are stringified into every proxied document by the
// controller, so they must be self-contained (no closures, no imports).
// The server usually swaps both for per-deploy ones first (loadProxyConfig).
const uvCodec = {
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
};
const proxyConfig = { prefix: "/~/s/", codec: uvCodec };

/** A codec that XORs character i by key digit i (0-7). The key is inlined so the functions stay self-contained. */
function keyedCodec(key) {
  const xor = `for(var k="${key}",o="",i=0;i<s.length;i++)o+=String.fromCharCode(s.charCodeAt(i)^(k.charCodeAt(i%k.length)-48));`;
  return {
    encode: new Function("u", `if(!u)return u;var s=u;${xor}return encodeURIComponent(o);`),
    decode: new Function("u", `if(!u)return u;var p=u.split("?"),s=decodeURIComponent(p[0]);${xor}return p.length>1?o+"?"+p.slice(1).join("?"):o;`),
  };
}

/** Takes this deployment's proxy prefix and codec from the server; keeps the built-in ones if it has none. */
async function loadProxyConfig() {
  try {
    const { prefix, codecKey } = await fetch("/v1/api/config", { cache: "no-store" }).then((r) => r.json());
    // Validated: the key is pasted into function source above.
    if (/^\/[a-z0-9]+\/$/.test(prefix ?? "")) proxyConfig.prefix = prefix;
    if (/^[0-7]{4,64}$/.test(codecKey ?? "")) proxyConfig.codec = keyedCodec(codecKey);
  } catch {
    // offline or an older server: the defaults work everywhere
  }
}

// Sapphire only knows how to undo Scramjet's default codec; scripts/build.mjs
// patches it to ask us when it sees a URL encoded with ours.
globalThis.__shadowUnproxy = (ref) => {
  const path = new URL(String(ref), location.href).pathname;
  if (!path.startsWith(proxyConfig.prefix)) return ref;
  // <prefix><controller id>/<frame id>/<encoded url>
  const encoded = path.slice(proxyConfig.prefix.length).split("/").slice(2).join("/");
  return encoded ? proxyConfig.codec.decode(encoded) : ref;
};

// Material Symbols path data for the toolbar menu (see showMainMenu).
const ICON = {
  newTab: "M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z",
  private: "M240-80q-33 0-56.5-23.500T160-160v-400q0-33 23.500-56.5T240-640h40v-80q0-83 58.500-141.500T480-920q83 0 141.500 58.500T680-720v80h40q33 0 56.5 23.500T800-560v400q0 33-23.500 56.5T720-80H240Zm0-80h480v-400H240v400Zm240-120q33 0 56.5-23.500T560-360q0-33-23.500-56.5T480-440q-33 0-56.5 23.500T400-360q0 33 23.500 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z",
  reopen: "M280-200v-80h284q63 0 109.500-40T720-420q0-60-46.500-100T564-560H312l104 104-56 56-200-200 200-200 56 56-104 104h252q97 0 166.500 63T800-420q0 94-69.500 157T564-200H280Z",
  downloads: "M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.500-23.500T160-240v-120h80v120h480v-120h80v120q0 33-23.500 56.500T720-160H240Z",
  history: "M480-120q-138 0-240.500-91.500T122-440h82q14 104 92.500 172T480-200q117 0 198.500-81.500T760-480q0-117-81.500-198.500T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.500-99T480-840q75 0 140.500 28.500t114 77q48.500 48.500 77 114T840-480q0 75-28.500 140.500t-77 114q-48.500 48.500-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z",
  workspaces: "M480-118 120-398l66-50 294 228 294-228 66 50-360 280Zm0-202L120-600l360-280 360 280-360 280Zm0-280Zm0 178 230-178-230-178-230 178 230 178Z",
  view: "M160-160q-33 0-56.500-23.500T80-240v-480q0-33 23.500-56.500T160-800h640q33 0 56.500 23.500T880-720v480q0 33-23.500 56.500T800-160H160Zm0-80h280v-480H160v480Zm360 0h280v-480H520v480Z",
  tools: "M120-520v-320h320v320H120Zm0 400v-320h320v320H120Zm400-400v-320h320v320H520Zm0 400v-320h320v320H520Z",
  settings: "m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z",
  extensions: "M352-120H200q-33 0-56.500-23.500T120-200v-152q48 0 84-30.500t36-77.500q0-47-36-77.500T120-568v-152q0-33 23.500-56.500T200-800h160q0-42 29-71t71-29q42 0 71 29t29 71h160q33 0 56.500 23.500T800-720v160q42 0 71 29t29 71q0 42-29 71t-71 29v160q0 33-23.500 56.500T720-120H568q0-50-31.500-85T460-240q-45 0-76.500 35T352-120Zm-152-80h85q24-66 77-93t98-27q45 0 98 27t77 93h85v-240h80q8 0 14-6t6-14q0-8-6-14t-14-6h-80v-240H480v-80q0-8-6-14t-14-6q-8 0-14 6t-6 14v80H200v88q54 20 87 67t33 105q0 57-33 104t-87 68v88Zm260-260Z",
  games: "M189-160q-60 0-102.5-43T42-307q0-9 1-18t3-18l84-336q14-54 57-87.5t98-33.5h390q55 0 98 33.5t57 87.5l84 336q2 9 3.5 18.5T919-306q0 61-43.5 103.5T771-160q-42 0-78-22t-54-60l-28-58q-5-10-15-15t-21-5H385q-11 0-21 5t-15 15l-28 58q-18 38-54 60t-78 22Zm3-80q19 0 34.5-10t23.5-27l28-57q15-31 44-48.5t63-17.5h190q34 0 63 18t45 48l28 57q8 17 23.5 27t34.5 10q28 0 48-18.5t21-46.5q0 1-2-19l-84-335q-7-27-28-44t-49-17H285q-28 0-49.5 17T208-659l-84 335q-2 6-2 18 0 28 20.5 47t49.5 19Zm348-280q17 0 28.5-11.5T580-560q0-17-11.5-28.5T540-600q-17 0-28.5 11.5T500-560q0 17 11.5 28.5T540-520Zm80-80q17 0 28.5-11.5T660-640q0-17-11.5-28.5T620-680q-17 0-28.5 11.5T580-640q0 17 11.5 28.5T620-600Zm0 160q17 0 28.5-11.5T660-480q0-17-11.5-28.5T620-520q-17 0-28.5 11.5T580-480q0 17 11.5 28.5T620-440Zm80-80q17 0 28.5-11.5T740-560q0-17-11.5-28.5T700-600q-17 0-28.5 11.5T660-560q0 17 11.5 28.5T700-520Zm-360 60q13 0 21.5-8.5T370-490v-40h40q13 0 21.5-8.5T440-560q0-13-8.5-21.5T410-590h-40v-40q0-13-8.5-21.5T340-660q-13 0-21.5 8.5T310-630v40h-40q-13 0-21.5 8.5T240-560q0 13 8.5 21.5T270-530h40v40q0 13 8.5 21.5T340-460Zm140-20Z",
  more: "M240-400q-33 0-56.500-23.500T160-480q0-33 23.500-56.500T240-560q33 0 56.500 23.500T320-480q0 33-23.500 56.500T240-400Zm240 0q-33 0-56.500-23.500T400-480q0-33 23.500-56.500T480-560q33 0 56.500 23.500T560-480q0 33-23.500 56.500T480-400Zm240 0q-33 0-56.500-23.500T640-480q0-33 23.500-56.500T720-560q33 0 56.500 23.500T800-480q0 33-23.500 56.500T720-400Z",
  bookmark: "m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Z",
  zoom: "M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Zm-40-60v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Z",
  fullscreen: "M120-120v-200h80v120h120v80H120Zm520 0v-80h120v-120h80v200H640ZM120-640v-200h200v80H200v120h-80Zm640 0v-120H640v-80h200v200h-80Z",
};

const isInternal = (url) => url.startsWith("shadow://");
// A same-origin Shadow page loaded straight into the iframe (arcade embed, games),
// or a blob: this page made (an opened download) — never run through the proxy.
const isLocalPath = (url) => /^\/[^/\\]/.test(url) || url.startsWith(`blob:${location.origin}/`);
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

/** A small icon for a URL in a menu (recently closed, back/forward lists). */
const menuIconFor = (url) => (isInternal(url) ? internalIcon(url) : /^https?:/i.test(url) ? faviconFor(url) : DEFAULT_ICON);

class Tab {
  constructor() {
    this.activeTabIndex = -1;
    this.tabsArr = [];
    this.closedTabs = [];
    try {
      const stored = JSON.parse(sessionStorage.getItem(CLOSED_TABS_KEY) || "[]");
      if (Array.isArray(stored)) {
        this.closedTabs = stored
          .filter((entry) => entry && typeof entry.url === "string" && entry.url)
          .slice(-MAX_CLOSED_TABS)
          .map((entry) => ({ url: entry.url, title: String(entry.title ?? ""), pinned: !!entry.pinned, index: Number(entry.index) || 0 }));
      }
    } catch {}
    this.groups = new TabGroups(this, tabStrip);
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
    await Promise.all(this.defaults.map((i) => this.settings.default(i.key, i.value)));
  }

  async init() {
    await this.setDefaults();
    this.searchSuggestionsEngine = await this.settings.get("search-suggestions-engine");
    this.searchSuggestions = await this.settings.get("search-suggestions");
    this.searchEngine = await this.settings.get("search-engine");
    await this.settings.default("panic-url", "https://classroom.google.com");
    const [userAgent, panicKey, forceDark, maskText, autoSave, verticalTabs] = await Promise.all([
      this.settings.get("user-agent"),
      this.settings.get("panic-key"),
      this.settings.get("force-dark"),
      this.settings.get("mask-text"),
      this.settings.get("downloads-autosave"),
      this.settings.get("vertical-tabs"),
      this.siteSettings.ready,
    ]);
    this.userAgent = userAgent || null;
    this.panicKey = panicKey || null;
    this.panicUrl = (await this.settings.get("panic-url")) || "https://www.google.com";
    this.forceDark = !!forceDark;
    this.maskText = maskText !== false;
    this.downloads.autoSave = autoSave !== false;
    this.setVerticalTabs(!!verticalTabs, false);

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

    if (!deepLink && (await this.settings.get("save-tabs"))) {
      const open = await this.history.getOpen();
      if (Array.isArray(open) && open.length > 1) await this.loadAllTabs(open);
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
    const configReady = loadProxyConfig();
    const controllerUrl = "/controller/controller.api.js";
    const bundleUrl = "/dist/shadow-proxy.js";
    // Fetch dependencies together while keeping execution in dependency order.
    const apiPreload = Object.assign(document.createElement("link"), { rel: "preload", as: "script", href: controllerUrl });
    const bundlePreload = Object.assign(document.createElement("link"), { rel: "modulepreload", href: bundleUrl });
    document.head.append(apiPreload, bundlePreload);
    try {
      if (typeof $scramjet === "undefined") await loadScript("/scramjet/scramjet.js");
      if (typeof $scramjetController === "undefined") await loadScript(controllerUrl);
      if (typeof $scramjet === "undefined" || typeof $scramjetController === "undefined") {
        throw new Error("Scramjet failed to load.");
      }
      ({ Controller, Sapphire, ShadowPlugin } = await import(bundleUrl));
    } finally {
      apiPreload.remove();
      bundlePreload.remove();
    }

    const registration = await this.registerServiceWorker();
    await navigator.serviceWorker.ready;
    // First visit (or a hard reload), or a new worker after a deploy or a new seed: it takes over
    // as soon as it installs (skipWaiting + claim), so wait for it. Otherwise the controller below
    // binds to the worker that is about to be replaced, and no proxied page loads until a reload.
    if (!navigator.serviceWorker.controller || registration.installing || registration.waiting) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    }
    const serviceworker = navigator.serviceWorker.controller ?? registration.active;
    if (!serviceworker) throw new Error("The service worker never became active.");

    await Promise.all([this.setTransport(), configReady]);

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
        // (Not "the last tab": a new tab doesn't always land at the end.)
        const id = this.nextTabId;
        await this.createTab(url || "shadow://new", undefined, { active: active !== false });
        return id;
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
      audible: !!tab.audio?.audible,
      mutedInfo: { muted: !!tab.muted },
      status: tab.loading ? "loading" : "complete",
      favIconUrl: tab.img.src || undefined,
    };
  }

  // ---------------------------------------------------------------- transport

  async setTransport(url, transport) {
    url = url ?? ((await this.settings.get("server")) || defaultWisp);
    transport = transport ?? ((await this.settings.get("transport")) || "/epoxy/index.mjs");
    // The server may serve these from seeded paths (it rewrites both strings below), so a value
    // saved before that, or under an older seed, is matched by name.
    const transports = ["/epoxy/index.mjs", "/libcurl/index.mjs"];
    if (!transports.includes(transport)) transport = transports[/libcurl/.test(transport) ? 1 : 0];
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

  /**
   * @param {{history?: boolean}} [options] history=false is Back/Forward revisiting
   *   an entry (goToHistory), which must not add a new one.
   */
  async load(src, i = this.activeTabIndex, { history = true } = {}) {
    this.hideSuggestions();
    const tab = this.tabsArr[i];
    if (!tab || typeof src !== "string" || !src.trim()) return false;
    if (history) {
      // Typed, clicked in the shell, or opened by it: a navigation the user asked for.
      tab.shellNav = true;
      tab.expecting = false;
    }

    let url = self.resolveInput(src, this.searchEngine);
    if (/^https?:/i.test(url)) {
      const broken = await this.checkSite(url);
      if (broken && (await this.brokenDisclaimer(broken))) {
        url = self.resolveInput(broken, this.searchEngine);
      }
    }

    // The tab went away while the broken-site prompt was up.
    if (!this.tabsArr.includes(tab)) return false;
    // A fixed title/icon (a game's name, set by createTab or the embed page)
    // belongs to the page it was given for, not to wherever the tab goes next.
    if (tab.fixedFor !== url) {
      tab.title = null;
      tab.icon = null;
      tab.fixedFor = null;
    }
    tab.url = url;
    tab.pendingUrl = null;
    tab.proxyFailed = false;
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

    // srcdoc (the "proxy unavailable" notice) wins over src for as long as it's set.
    tab.iframe.removeAttribute("srcdoc");
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
    tab.proxyFailed = true; // reload retries the address instead of this notice
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
   * @param {{active?: boolean, lazy?: boolean, pinned?: boolean, index?: number, private?: boolean, groupId?: string|null}} [options]
   *   lazy tabs aren't loaded until they're first shown (used when restoring a session).
   *   private tabs leave no trace in history, the saved session or "reopen closed tab".
   *   groupId puts the tab in a tab group; left out, a tab opened at a position
   *   (a link opened beside its page) joins the group of the tab before it.
   */
  async createTab(
    src = this.tabsArr.length === 0 ? "shadow://home" : "shadow://new",
    title,
    { active = true, lazy = false, pinned = false, index, private: isPrivate = false, groupId } = {},
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
      icon: null,
      fixedFor: null,
      proxyFailed: false,
      groupId: null,
      muted: false,
      audio: null,
      audioEl: null,
      // Back/Forward: this tab's own list of pages (see recordHistory).
      hist: [],
      histIndex: -1,
      userActed: false,
      shellNav: false,
      expecting: false,
      leavingUrl: null,
    };
    if (tab.title) tab.fixedFor = tab.url;

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
    else {
      if (groupId === undefined && typeof index === "number") groupId = this.tabsArr[at - 1]?.groupId ?? null;
      if (groupId && this.groups.get(groupId)) {
        if (typeof index === "number") tab.groupId = groupId;
        else this.groups.add(tab, groupId); // no position asked for: the end of the group
      }
      this.groups.settle(tab);
    }
    this.groups.render();
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
    // The site's own icon failed (none, or it doesn't load through the proxy): try Google's copy of
    // it, then a globe. Only the tab's internal pages fall back to Shadow's logo.
    tab.img.onerror = () => {
      const url = tab.pendingUrl ?? tab.url ?? "";
      const host = /^https?:/i.test(url) && hostnameOf(url);
      const next = !host ? DEFAULT_ICON : tab.img.src === googleFavicon(host) ? GLOBE_ICON : googleFavicon(host);
      if (tab.img.src !== next && tab.img.src !== GLOBE_ICON) tab.img.src = next;
    };
    tab.tab.appendChild(tab.img);

    const spinner = document.createElement("span");
    spinner.className = "tab-spinner";
    tab.tab.appendChild(spinner);

    const titleContainer = document.createElement("div");
    titleContainer.className = "tab-title";
    tab.tab.appendChild(titleContainer);

    // Speaker: shown while the tab is making sound (or muted); click to mute.
    const audioBtn = document.createElement("span");
    audioBtn.className = "tab-audio";
    audioBtn.setAttribute("role", "button");
    audioBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleMute(this.tabsArr.indexOf(tab));
    });
    tab.audioEl = audioBtn;
    tab.tab.appendChild(audioBtn);

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
      this.closedTabs.push({ url, title: this.titleFor(tab), pinned: tab.pinned, index: i, groupId: tab.groupId });
      if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift();
      this.saveClosedTabs();
    }
    forgetAudio(tab);

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
    this.groups.render(); // a group that just lost its last tab goes with it

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

  saveClosedTabs() {
    try {
      sessionStorage.setItem(CLOSED_TABS_KEY, JSON.stringify(this.closedTabs.map(({ url, title, pinned, index }) => ({ url, title, pinned, index }))));
    } catch {}
  }

  /** Reopens the most recently closed tab, or a specific entry of this.closedTabs. */
  reopenClosedTab(entry) {
    const at = entry ? this.closedTabs.indexOf(entry) : this.closedTabs.length - 1;
    if (at < 0) return false;
    const [closed] = this.closedTabs.splice(at, 1);
    this.saveClosedTabs();
    this.createTab(closed.url, undefined, {
      pinned: closed.pinned,
      index: closed.index,
      // Back into its group if that group is still around.
      groupId: closed.groupId && this.groups.get(closed.groupId) ? closed.groupId : null,
    });
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
    if (pinned) tab.groupId = null; // pinned tabs live outside groups
    tab.tab.classList.toggle("pinned", pinned);
    const pinnedCount = this.tabsArr.filter((t) => t.pinned && t !== tab).length;
    this.moveTab(i, pinnedCount, save);
  }

  /** Reorders the strip only — iframes never move in the DOM, so nothing reloads. */
  moveTab(from, to, save = true, { regroup = true } = {}) {
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
    // Dropped between two tabs of a group it joins them; away from its own, it leaves.
    if (regroup) this.groups.settle(tab);
    this.groups.render();
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
      if (this.draggingGroup) {
        if (tab.groupId === this.draggingGroup) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const before = this.verticalTabs ? e.clientY < rect.top + rect.height / 2 : e.clientX < rect.left + rect.width / 2;
        this.groups.moveGroup(this.draggingGroup, tab, before);
        return;
      }
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
      { label: tab.muted ? "Unmute tab" : "Mute tab", onclick: () => this.toggleMute(this.tabsArr.indexOf(tab)) },
      ...this.groups.menuItemsFor(tab),
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
    // A tab inside a folded group can't be the one on screen: unfold it.
    if (this.groups.of(tab)?.collapsed) this.groups.setCollapsed(tab.groupId, false);
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
    const refresh = (how) => this.noteNavigation(tab, typeof how === "string" ? how : undefined);
    if (this.maskText) {
      try {
        maskDocument(win);
      } catch (e) {
        console.warn("[shadow] text masking failed", e);
      }
    }

    win.addEventListener(
      "keydown",
      (e) => {
        tab.userActed = true;
        this.handleKey(e);
      },
      true,
    );
    win.addEventListener(
      "mousedown",
      () => {
        tab.userActed = true;
        this.dismissOverlays();
        this.focusPane(tab);
      },
      true,
    );
    try {
      watchAudio(this, tab, win);
    } catch {}
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
    win.addEventListener("DOMContentLoaded", () => refresh());
    win.addEventListener("popstate", () => refresh("traverse"));
    win.addEventListener("hashchange", () => refresh());
    const historyProto = Object.getPrototypeOf(win.history);
    for (const method of ["pushState", "replaceState"]) {
      if (typeof historyProto?.[method] !== "function") continue;
      const how = method === "replaceState" ? "replace" : undefined;
      win.history[method] = function (...args) {
        // Looked up per call, not kept: the page fixes in src/client/proxy-entry.js wrap the
        // prototype's methods, and may do so after this runs.
        const result = historyProto[method].apply(this, args);
        queueMicrotask(() => refresh(how));
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
        win.addEventListener(
          "keydown",
          (e) => {
            tab.userActed = true;
            this.handleKey(e);
          },
          true,
        );
        win.addEventListener(
          "mousedown",
          () => {
            tab.userActed = true;
            this.dismissOverlays();
            this.focusPane(tab);
          },
          true,
        );
      }
      // Shadow's own pages and the games they embed don't go through Scramjet,
      // so there's no earlier moment to hook their audio than this.
      if (win && !this.isProxied(tab)) for (const frame of sameOriginFrames(win)) watchAudio(this, tab, frame);
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
  noteNavigation(tab, how) {
    if (!this.tabsArr.includes(tab)) return;
    const url = this.currentUrl(tab);
    if (url && url !== "about:blank") tab.url = url;
    this.recordHistory(tab, url, how);
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

  // ---------------------------------------------------------------- back / forward

  /**
   * Each tab keeps its own list of pages. (The browser only has one history for
   * the whole window, shared by every tab's iframe, so history.back() in one tab
   * would undo whichever tab navigated last.)
   *
   * A page becomes a new entry when the user caused the navigation: something
   * typed or clicked in the shell, or a click / key press in the page since the
   * last entry. Navigations a page makes on its own (redirects, replaceState)
   * replace the current entry instead, so Back never bounces off a redirect.
   *
   * @param {"replace" | "traverse"} [how] replaceState, or the page moving
   *   through history itself (popstate)
   */
  recordHistory(tab, url, how) {
    if (!url || url === "about:blank") return;
    const current = tab.hist[tab.histIndex];
    if (tab.expecting) {
      // Our own Back/Forward is on its way; the page being left is still showing.
      if (url === tab.leavingUrl) return;
      tab.expecting = false;
      tab.leavingUrl = null;
      if (current && current.url !== url) {
        current.url = url; // the entry redirected somewhere else this time
        current.title = "";
      }
    } else {
      if (current?.url === url) return;
      if (how === "traverse") {
        if (tab.hist[tab.histIndex - 1]?.url === url) tab.histIndex -= 1;
        else if (tab.hist[tab.histIndex + 1]?.url === url) tab.histIndex += 1;
        else how = undefined;
      }
      if (how !== "traverse") {
        if (current && (how === "replace" || !(tab.userActed || tab.shellNav))) {
          current.url = url;
          current.title = "";
        } else {
          tab.hist.length = tab.histIndex + 1; // anything "forward" is gone
          tab.hist.push({ url, title: "" });
          if (tab.hist.length > MAX_TAB_HISTORY) tab.hist.shift();
          tab.histIndex = tab.hist.length - 1;
        }
      }
    }
    tab.userActed = false;
    tab.shellNav = false;
    if (this.tabsArr[this.activeTabIndex] === tab) this.updateNavButtons();
  }

  /** Revisits entry `to` of a tab's own history. */
  goToHistory(tab, to) {
    const entry = tab?.hist[to];
    const i = this.tabsArr.indexOf(tab);
    if (!entry || i === -1 || to === tab.histIndex) return;
    tab.leavingUrl = tab.hist[tab.histIndex]?.url ?? null;
    tab.histIndex = to;
    tab.expecting = true;
    this.updateNavButtons();
    this.load(entry.url, i, { history: false });
  }

  updateNavButtons() {
    const tab = this.tabsArr[this.activeTabIndex];
    document.getElementById("back-button")?.classList.toggle("disabled", !tab || tab.histIndex <= 0);
    document.getElementById("forward-button")?.classList.toggle("disabled", !tab || tab.histIndex >= tab.hist.length - 1);
  }

  /** Right-click on Back / Forward: the pages that button can reach, nearest first. */
  showHistoryMenu(direction, anchor) {
    const tab = this.tabsArr[this.activeTabIndex];
    if (!tab) return;
    if (menuOpenFor(anchor)) return hideMenu();
    const indexes = [];
    if (direction < 0) for (let n = tab.histIndex - 1; n >= 0; n--) indexes.push(n);
    else for (let n = tab.histIndex + 1; n < tab.hist.length; n++) indexes.push(n);
    if (indexes.length === 0) return;
    showMenu(
      0,
      0,
      indexes.slice(0, 15).map((n) => {
        const entry = tab.hist[n];
        return { label: entry.title || entry.url, title: entry.url, image: menuIconFor(entry.url), onclick: () => this.goToHistory(tab, n) };
      }),
      { anchor, align: "start" },
    );
  }

  // ---------------------------------------------------------------- sound

  toggleMute(i = this.activeTabIndex) {
    const tab = this.tabsArr[i];
    if (!tab) return;
    setTabMuted(this, tab, !tab.muted);
    toast(tab.muted ? "Tab muted." : "Tab unmuted.", { timeout: 1200 });
  }

  /** Shows / hides a tab's speaker button (tabaudio.js calls this when its state changes). */
  renderAudio(tab) {
    const audible = !!tab.audio?.audible;
    const state = tab.muted ? "muted" : audible ? "sound" : "";
    tab.tab.classList.toggle("audible", state === "sound");
    tab.tab.classList.toggle("muted", state === "muted");
    const button = tab.audioEl;
    if (!button || button.dataset.state === state) return;
    button.dataset.state = state;
    button.replaceChildren(...(state ? [svgIcon(state === "muted" ? ICON_MUTED : ICON_SOUND, 16)] : []));
    button.title = state === "muted" ? "Unmute tab" : "Mute tab";
  }

  dismissOverlays({ keepReader = false } = {}) {
    this.hideSuggestions();
    hideMenu();
    hidePopover();
    this.extensions?.hidePopup();
    closeFind();
    if (!keepReader && readerIsOpen()) closeReader();
    if (this.immersive) this.toggleImmersive(false);
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
    if (/^shadow:\/\/(?:home|new)$/.test(tab.pendingUrl ?? tab.url ?? "")) return "New Tab"; // the start page too, whatever its <title>
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
    if (tab.icon) return tab.icon;
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
    return host ? googleFavicon(host) : DEFAULT_ICON;
  }

  renderTab(tab) {
    const title = this.titleFor(tab);
    const titleEl = tab.tab.querySelector(".tab-title");
    if (titleEl.textContent !== title) titleEl.textContent = title;
    tab.tab.title = title;
    // The Back/Forward list shows page titles; a page's title is only known once it has loaded.
    const entry = tab.hist[tab.histIndex];
    if (entry && !tab.loading && !tab.expecting && !tab.pendingUrl) entry.title = title;
    const icon = this.iconFor(tab);
    if (tab.iconUrl !== icon) {
      tab.iconUrl = icon;
      tab.img.src = icon;
    }
  }

  updateOmni() {
    const tab = this.tabsArr[this.activeTabIndex];
    this.updateNavButtons();
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
    // Hang the list from the address bar itself, wherever the layout has put it
    // (vertical tabs, extension buttons and the downloads button all move it).
    const form = document.getElementById("uv-form").getBoundingClientRect();
    const wrap = container.parentElement.getBoundingClientRect();
    container.style.marginLeft = `${Math.round(form.left - wrap.left + 16)}px`;
    container.style.width = `${Math.round(form.width - 32)}px`;
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
      group: this.groups.serialize(tab),
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
      if (src.startsWith(prefix)) return uvCodec.decode(src.slice(prefix.length));
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
    const restored = [];
    try {
      for (const entry of entries) {
        // Only the active tab loads now; the rest load when first clicked.
        const id = this.nextTabId;
        await this.createTab(entry.url, undefined, { active: false, lazy: true, pinned: !!entry.pinned });
        restored.push(this.tabsArr.find((tab) => tab.id === id));
      }
      this.groups.restore(restored, entries.map((entry) => entry.group));
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
    if (tab.proxyFailed) return void this.load(tab.url, i);
    this.setLoading(tab, true);
    try {
      tab.iframe.contentWindow.location.reload();
    } catch {
      this.load(tab.url, i);
    }
  }

  forward(i = this.activeTabIndex) {
    const tab = this.tabsArr[i];
    if (tab) this.goToHistory(tab, tab.histIndex + 1);
  }

  backward(i = this.activeTabIndex) {
    const tab = this.tabsArr[i];
    if (tab) this.goToHistory(tab, tab.histIndex - 1);
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
  setZoom(i, action, { quiet = false } = {}) {
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
    // The menu's zoom row shows the level itself.
    if (!quiet) toast(`Zoom ${Math.round(tab.zoom * 100)}%`, { timeout: 1000 });
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
      case "mask-text": // pages loaded from now on
        this.maskText = (await this.settings.get(key)) !== false;
        break;
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

  /**
   * The toolbar (three dots) menu. Drops from the button, right edges aligned;
   * View, Page tools and More open beside their row.
   */
  showMainMenu(anchor = document.getElementById("menu-button")) {
    if (menuOpenFor(anchor)) return hideMenu();
    hidePopover();
    this.hideSuggestions();
    const bookmarks = window.bookmarksManager;
    const zoomed = () => `${Math.round((this.tabsArr[this.activeTabIndex]?.zoom ?? 1) * 100)}%`;
    const zoom = (action) => this.setZoom(this.activeTabIndex, action, { quiet: true });
    showMenu(
      0,
      0,
      [
        { label: "New tab", icon: ICON.newTab, shortcut: "Alt+T", onclick: () => this.createTab("shadow://new") },
        { label: "New private tab", icon: ICON.private, shortcut: "Alt+Shift+N", onclick: () => this.createTab("shadow://new", undefined, { private: true }) },
        { label: "Reopen closed tab", icon: ICON.reopen, shortcut: "Alt+Shift+T", disabled: this.closedTabs.length === 0, onclick: () => this.reopenClosedTab() },
        { separator: true },
        { label: bookmarks?.isBookmarked() ? "Remove bookmark" : "Bookmark this page", icon: ICON.bookmark, onclick: () => bookmarks?.toggleCurrent() },
        { label: "Downloads", icon: ICON.downloads, shortcut: "Alt+J", onclick: () => this.downloads.togglePanel(true) },
        { label: "History", icon: ICON.history, submenu: () => this.historyMenuItems() },
        { label: "Workspaces", icon: ICON.workspaces, onclick: () => this.workspaces.showPanel(anchor) },
        { separator: true },
        {
          label: "Zoom",
          icon: ICON.zoom,
          controls: [
            { label: "\u2212", title: "Zoom out (Alt+-)", onclick: () => zoom("out") },
            { text: zoomed },
            { label: "+", title: "Zoom in (Alt+=)", onclick: () => zoom("in") },
            { icon: ICON.fullscreen, title: "Fullscreen", close: true, onclick: () => window.iframefullscreen?.() },
          ],
        },
        { separator: true },
        { label: "View", icon: ICON.view, submenu: () => this.viewMenuItems() },
        { label: "Page tools", icon: ICON.tools, submenu: () => toolsMenuItems(this) },
        { separator: true },
        { label: "Settings", icon: ICON.settings, onclick: () => this.createTab("shadow://settings") },
        { label: "Extensions", icon: ICON.extensions, onclick: () => this.createTab("shadow://extensions") },
        { label: "G@me$", icon: ICON.games, onclick: () => this.createTab("shadow://books") },
        { label: "More", icon: ICON.more, submenu: () => this.moreMenuItems() },
      ],
      { anchor, width: 290 },
    );
  }

  /** Main menu → History: the history page and the tabs closed most recently. */
  historyMenuItems() {
    const closed = this.closedTabs.slice(-8).reverse();
    return [
      { label: "Show full history", icon: ICON.history, onclick: () => this.createTab("shadow://history") },
      { separator: true },
      { header: true, label: "Recently closed" },
      ...(closed.length
        ? closed.map((entry) => ({ label: entry.title || entry.url, title: entry.url, image: menuIconFor(entry.url), onclick: () => this.reopenClosedTab(entry) }))
        : [{ label: "No tabs closed yet", disabled: true }]),
    ];
  }

  /** Main menu → View. */
  viewMenuItems() {
    const bookmarks = window.bookmarksManager;
    return [
      { label: "Split view", shortcut: "Alt+S", checked: !!this.split, onclick: () => this.toggleSplit() },
      { label: "Vertical tabs", shortcut: "Alt+V", checked: this.verticalTabs, onclick: () => this.setVerticalTabs(!this.verticalTabs) },
      { label: "Bookmarks bar", shortcut: "Alt+B", checked: !!bookmarks?.visible, onclick: () => bookmarks?.setVisible(!bookmarks.visible) },
      { label: "Immersive mode", shortcut: "Alt+Enter", checked: !!this.immersive, onclick: () => this.toggleImmersive() },
      { separator: true },
      { label: "Reset zoom", shortcut: "Alt+0", checked: false, disabled: (this.tabsArr[this.activeTabIndex]?.zoom ?? 1) === 1, onclick: () => this.setZoom(this.activeTabIndex, "reset") },
    ];
  }

  /** Main menu → More: the less-used destinations and window actions. */
  moreMenuItems() {
    const pwa = window.shadowPwa;
    return [
      { label: "Store", onclick: () => this.createTab("shadow://store") },
      { label: "AI", onclick: () => this.createTab("shadow://ai") },
      { label: "Chat", onclick: () => toast("Coming in Shadow 3.1.1", { timeout: 2500 }) },
      { label: "Discord", onclick: () => this.createTab("discord.gg/goshadow") },
      { separator: true },
      { label: "Command palette", shortcut: "Alt+K", onclick: () => openCommandPalette(this) },
      { label: "Open in about:blank", onclick: () => window.abtblank?.() },
      { label: "Open tab in about:blank", onclick: () => window.iframeabtblank?.() },
      ...(pwa?.canInstall ? [{ label: "Install Shadow", onclick: () => pwa.install() }] : []),
      { separator: true },
      { label: "Devtools", onclick: () => this.toggleDevTools() },
      {
        label: "Copy debug info",
        onclick: () =>
          navigator.clipboard.writeText(window.dewasper.dump()).then(
            () => toast("Debug info copied.", { timeout: 1500 }),
            () => toast("Couldn't reach the clipboard.", { timeout: 2000 }),
          ),
      },
    ];
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
      else if (key === "m") this.toggleMute();
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
// Right-click Back / Forward for the list of pages behind them.
for (const [id, direction] of [["back-button", -1], ["forward-button", 1]]) {
  const button = document.getElementById(id);
  button?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    tabs.showHistoryMenu(direction, button);
  });
}
const menuButton = document.getElementById("menu-button");
menuButton?.addEventListener("click", () => tabs.showMainMenu(menuButton));
menuButton?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowDown") return;
  e.preventDefault();
  e.stopPropagation();
  tabs.showMainMenu(menuButton);
});
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
