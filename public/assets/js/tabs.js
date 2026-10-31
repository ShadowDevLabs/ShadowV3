import { HistoryHelper } from "/assets/js/history_helper.js";
import { SettingsManager } from "/assets/js/settings_manager.js";
const searchInput = document.getElementById("__shadow-search-bar");
const addTabButton = document.getElementById("add-tab");

class Tab {
  constructor() {
    this.activeTabIndex = -1;
    this.tabsArr = [];
    this.brokenSites = fetch('/v1/api/broken-sites').then(res => res.json());
    this.brokenSitesLastUpdated = 0;
    this.history = new HistoryHelper();
    this.settings = new SettingsManager();
    document.getElementById("uv-form").addEventListener("submit", (e) => {
      e.preventDefault();
      searchInput.blur();
      const url = searchInput.value;
      tabs.load(url);
    });
    window.addEventListener("settings", (e) => {
      const detail = e.detail;
      switch (detail.key) {
        case "search-engine":
          this.searchEngine = detail.newValue;
          break;
        case "search-suggestions":
          this.searchSuggestions = detail.newValue;
          break;
        case "search-suggestions-engine":
          this.searchSuggestionsEngine = detail.newValue;
          break;
        default:
          break;
      }
    });
    this.defaults = [{ "key": "search-suggestions", "value": true }, { "key": "history", "value": true }, { "key": "save-tabs", "value": true }, { "key": "search-suggestions-engine", "value": "google" }, { "key": "shortenUrls", "value": true }, { "key": "search-engine", "value":  "https://duckduckgo.com/?q=%s" }];
    this.setDefaults();
    this.init().finally(() => self.stopLoad());
    this.getSuggestions = async (query) => await fetch(`/v1/api/search-suggestions?query=${query}`, { headers: { engine: this.searchSuggestionsEngine } }).then(response => { return response.json() });
    this.hideSuggestions = () => document.getElementById("suggestions").classList.add("hidden");
  }

  async setDefaults() {
    const arr = this.defaults;
    for (const i of arr) {
      await this.settings.default(i.key, i.value);
    }
  }

  async init() {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    //The controller stays bound to the worker it's given, so a returning visitor's old worker has to be replaced first or every request hangs
    await registration.update().catch(() => {});
    const pending = registration.installing ?? registration.waiting;
    if (pending) await new Promise((resolve) => pending.addEventListener("statechange", () => { if (pending.state === "activated") resolve(); }));
    const { active } = await navigator.serviceWorker.ready;
    this.controller = new $scramjetController.Controller({
      serviceworker: active,
      transport: await this.createTransport(),
      config: {
        scramjetPath: `/scramjet/scramjet.js?v=${$scramjet.versionInfo.version}`,
        injectPath: `/controller/controller.inject.js?v=${$scramjetController.VERSION}`,
      },
    });
    await this.controller.wait();
    this.searchSuggestionsEngine = await this.settings.get("search-suggestions-engine")
    this.searchSuggestions = await this.settings.get("search-suggestions")
    this.searchEngine = await this.settings.get("search-engine");
    const open = await this.history.getOpen()
    if (await this.settings.get("save-tabs") && open && open.length > 0) {
      await this.loadAllTabs();
    }
    else await this.createTab();
  }

  async updateSearchEngine() {
    this.searchEngine = await this.settings.get("search-engine");
  }


  async load(src, i = this.activeTabIndex) {
    this.hideSuggestions();
    const broken = await this.checkSite(src);
    if (broken && await this.brokenDisclaimer(broken)) {
      src = broken;
    };
    await this.setTransport();
    const { frame } = this.tabsArr[i];
    src = self.search(src.trim(), this.searchEngine, (url) => $scramjet.rewriteUrl(url, frame.context, { origin: new URL(location.href), base: new URL(location.href) }));
    this.tabsArr[i].iframe.src = src;
    this.tabsArr[i].src = src;
    if (i === this.activeTabIndex && document.activeElement !== searchInput) searchInput.value = this.parseUrl(false, src);
    this.saveTabs();
    return true;
  }

  async createTab(src = this.tabsArr.length === 0 ? "shadow://home" : "shadow://new", title) {
    //Create a tab object to be put in the array
    const tab = {
      tab: document.createElement("div"),
      title: title || null, //Optional
      iframe: document.createElement("iframe"),
      img: document.createElement("img"),
      src: this.parseUrl(false, src),
    };
    //Add it to the array so that we can easily access each tab and all its elements later (gng i cant spell)
    this.tabsArr.push(tab);
    //Setup the tab in the tab bar
    tab.tab.classList.add("tab");
    this.createTabItems(tab);
    tab.tab.addEventListener("click", (e) =>
      this.switchTab(
        this.tabsArr.findIndex((obj) => obj.tab === tab.tab),
        e,
      ),
    );
    tab.iframe.title = "Content IFrame";
    document.getElementById("iframes-container").appendChild(tab.iframe);
    document
      .getElementById("tabs-container")
      .insertBefore(tab.tab, addTabButton);
    this.switchTab(this.tabsArr.findIndex((obj) => obj.tab === tab.tab));
    //After switchTab, appending the iframe fires a load for about:blank before the tab is active
    this.setupFrame(tab);
    await this.load(tab.src);
    this.activeTabIndex = this.tabsArr.length - 1;
    return true;
  }

  //What used to be injected into every proxied page by uv.config.js
  setupFrame(tab) {
    tab.frame = this.controller.createFrame(tab.iframe, { plugins: [new $scramjetUtils.HttpCachePlugin()] });
    const plugin = new $scramjet.Plugin("shadow");
    plugin.tap(tab.frame.hooks.init.post, ({ window, client }) => {
      window.open = (url) => {
        this.createTab(url ? new URL(url, client.url).href : undefined);
        return null;
      };
    });
    plugin.tap(tab.frame.hooks.fetch.request, async (_, props) => {
      const userAgent = await this.settings.get("user-agent");
      if (userAgent) props.init.headers = [...props.init.headers.filter(([name]) => name.toLowerCase() !== "user-agent"), ["user-agent", userAgent]];
    });
    tab.iframe.addEventListener("load", () => {
      const i = this.tabsArr.indexOf(tab);
      this.updateOmni();
      this.setTab(i);
      tab.iframe.contentWindow.addEventListener("click", () => this.hideSuggestions());
      //Update history on everything EXCEPT for shadow:// urls
      const { title, icon, src } = this.getTabInfo(i);
      if (!src.startsWith("shadow://") && src !== "about:blank") this.updateHistory(src, title, icon);
    });
  }

  //Functions to create all the elements used by the tab in the tab bar
  createTabItems(tab) {
    //Tab icon
    tab.img.className = "tab-icon";
    tab.img.alt = "Favicon";
    if (tab.src.startsWith('shadow://')) {
      const favicon = `/assets/imgs/icons/pages/${tab.src.replace('shadow://', '')}.png`;
      tab.img.src = favicon;
    }

    tab.img.onerror = () => { tab.img.style.display = "none"; };
    tab.tab.appendChild(tab.img);
    //Tab title
    const titleContainer = document.createElement("div");
    titleContainer.className = "tab-title";
    tab.tab.appendChild(titleContainer);
    //Close button
    const closeBtn = document.createElement("span");
    closeBtn.className = "close-tab-button";
    closeBtn.innerHTML = "&#x2715;";
    closeBtn.addEventListener("click", (e) =>
      tabs.closeTab(tabs.tabsArr.findIndex((obj) => obj === tab)),
    );
    tab.tab.appendChild(closeBtn);
  }

  closeTab(i, force = false) {
    const isActive = this.activeTabIndex === i;
    if (isActive) {
      //Delete elements
      this.tabsArr[i].iframe.remove();
      this.tabsArr[i].tab.remove();
      //Remove obj from array
      this.tabsArr.splice(i, 1);
      if (this.tabsArr.length <= 0 && !force) {
        this.createTab();
      }
      const closest = i != 0 ? i - 1 : 0; //If the active tab is NOT the first one, go down one in the tab list. If it is, leave it at 0 for the next tab.
      this.switchTab(closest);
      this.activeTabIndex = closest;
    } else {
      //Delete elements
      this.tabsArr[i].iframe.remove();
      this.tabsArr[i].tab.remove();
      //Set new active tab index if the tab moves
      if (this.tabsArr.length - 1 === this.activeTabIndex) {
        this.activeTabIndex -= 1;
      }
      //Remove obj from array
      this.tabsArr.splice(i, 1);
    }
    this.saveTabs();
  }

  switchTab(i, e) {
    //I gave up commenting my code, good luck!
    try {
      if (!e || e.target != this.tabsArr[i].tab.querySelector(".close-tab-button")) {
        try {
          document.querySelectorAll('.active').forEach(elem => elem.classList.remove('active'));
        } catch (err) {
          console.log(`[TABS] No active tab (${err})`);
        }
        this.tabsArr[i].iframe.classList.add("active");
        this.tabsArr[i].tab.classList.add("active");
        this.activeTabIndex = i;
      } else {
      }
      this.updateOmni();
      this.setTab();
    } catch (e) {
      /*Silence goofy errors*/
    }
    this.saveTabs();
  }

  updateOmni() {
    if (document.activeElement != searchInput) {
      let currentSrc = this.parseUrl();
      let fullUrl = currentSrc;
      //Will finish eventually, cool feature that shortens urls until you click on them kinda like how operagx does it
      // if(this.await this.settings.get("shortenUrls")) {
      //   currentSrc = currentSrc.subString(0, currentSrc.lastIndexOf("?"));
      //}
      searchInput.value = currentSrc;
    }
  }

  parseUrl(i = this.activeTabIndex, src) {
    if (!src) {
      const frameLocation = this.tabsArr[i].iframe.contentDocument.location;
      //A frame stays on about:blank until its first page commits, show where it's going
      src = frameLocation.href === "about:blank" ? this.tabsArr[i].src : frameLocation.pathname;
    }
    src = src.replace(location.origin, "");
    //The prefix has per session ids (/~/sj/<controller>/<frame>/<url>), so saved tabs have to hold the real url
    const proxied = src.match(/^\/~\/sj\/[^/]+\/[^/]+\/(.*)$/);
    if (proxied) return decodeURIComponent(proxied[1]);
    //Tabs saved before the switch to Scramjet hold UV's xor encoded urls
    if (src.startsWith("/uv/service/")) return decodeURIComponent(src.replace("/uv/service/", "")).replace(/^[^?]*/, (url) => [...url].map((c, j) => j % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c).join(""));
    //Games open their embed page by relative path, it's a local page and is never proxied
    if (src.startsWith("embed.html")) return "shadow://" + src.replace(".html", "");
    //shadow:// urls, about:blank and anything typed or opened by a page
    if (!src.startsWith("/")) return src;
    return "shadow://" + src.replace(".html", "").replace("/pages/", "").replace(/\//g, "")

    //   if (src.startsWith("shadow://")) return src;
    //   switch (
    //   src.replace(location.href, "").replace(".html", "").replace("/pages/", "").replace(/\//g, "")
    //   ) {
    //     case "settings":
    //       return "shadow://settings";
    //     case "home":
    //       return "shadow://home";
    //     case "new":
    //       return "shadow://new";
    //     case "extensions":
    //       return "shadow://extensions";
    //     case "extensionsmanage":
    //       return "shadow://extensions/manage";
    //     case "games":
    //     case "books":
    //       return "shadow://games";
    //     case "history":
    //       return "shadow://history";
    //     case "privacy":
    //       return "shadow://privacy"
    //     case "ai":
    //       return "shadow://ai"
    //     case "credits":
    //       return "shadow://credits"
    //     default:
    //       
    //   }
  }

  async displaySearchSuggestions(value = searchInput.value) {
    if (this.searchSuggestions && !value.startsWith("shadow://")) {
      const suggestions = (await this.getSuggestions(value));
      suggestions.length = suggestions.length > 5 ? 5 : suggestions.length;
      const suggestionsContainer = document.getElementById('suggestions');
      suggestionsContainer.classList.remove("hidden");
      if (suggestions.length < 5) {
        for (let i = suggestions.length; i < 5; i++) {
          suggestionsContainer.children[i].classList.add("hidden");
        }
      }
      suggestions.forEach((text, i) => {
        const elem = suggestionsContainer.children[i];
        elem.classList.remove("hidden");
        elem.innerText = text;
        elem.dataset.url = text;
      });
    } else if (value.startsWith("shadow://")) {
      document.getElementById('suggestions').classList.add("hidden");
    }
  }

  getTabInfo(i = this.activeTabIndex) {
    const src = this.parseUrl(i);
    let icon;
    if (src.startsWith("shadow://")) {
      icon = `/assets/imgs/icons/pages/${src.replace("shadow://", "")}.png`;
    } else {
      icon = `https://www.google.com/s2/favicons?domain=${src.replace(/^[a-z]+:\/\//, "").split("/")[0]}&sz=24`;
    }
    const title = this.tabsArr[i].title || this.tabsArr[i].iframe.contentDocument.title;

    const obj = {
      title,
      icon,
      src
    }
    return obj;
  }

  setTab(i = this.activeTabIndex) {
    const { title, icon } = this.getTabInfo(i);
    const { img, tab } = this.tabsArr[i];

    //This runs for every tab every 5 seconds and assigning src refetches the image
    if (img.getAttribute("src") !== icon) {
      img.src = icon;
      if (img.style.display === "none") img.style.display = "block";
    }

    //Set the title for a tab
    const titleElement = tab.querySelector(".tab-title");
    if (titleElement.textContent !== title) titleElement.textContent = title;
  }

  async saveTabs() {
    const tabSrc = this.tabsArr.map(tab => this.parseUrl(false, tab.src));
    try {
      (await navigator.serviceWorker.getRegistration()).active.postMessage({
        reason: "save-open-tabs", data: [...tabSrc, this.activeTabIndex]
      });
    } catch (e) {
      console.log(`[ATL] Issue with sending request to service worker: ${e}`)
    }
  }

  async loadAllTabs() {
    const openTabs = await this.history.getOpen();
    for (let i = 0; i < openTabs.length - 1; i++) {
      await this.createTab(openTabs[i]);
    }
    this.switchTab(openTabs[openTabs.length - 1]);
    this.history.clear("open-tabs");
    for (let i = 0; i < this.tabsArr.length; i++) {
      this.setTab(i);
    }
    return true;
  }

  async brokenDisclaimer(url = "error") {
    const disclaimer = document.querySelector('.disclaimer');
    const popup = document.querySelector('.overlay');
    popup.style.display = 'block';
    disclaimer.children[1].innerText = disclaimer.children[1].innerText.replace("{site}", url);
    disclaimer.style.display = 'block';
    return new Promise((resolve) => {
      disclaimer.children[2].onclick = () => { resolve(true); popup.style.display = "none"; disclaimer.style.display = 'none'; }
      disclaimer.children[3].onclick = () => { resolve(false); popup.style.display = "none"; disclaimer.style.display = 'none'; }
    });
  }

  refresh(i = this.activeTabIndex) {
    this.tabsArr[i].iframe.contentWindow.location.reload();
  }

  forward(i = this.activeTabIndex) {
    this.tabsArr[i].iframe.contentWindow.history.forward();
  }

  backward(i = this.activeTabIndex) {
    this.tabsArr[i].iframe.contentWindow.history.back();
  }

  async checkSite(url) {
    url = /^https:\/\//i.test(url) ? url : `https://${url}`;
    let sites = await this.brokenSites;
    if (this.brokenSitesLastUpdated <= Date.now() - 300000 /*5 minutes*/) {
      this.brokenSites = fetch(`/v1/api/broken-sites`).then((res) => res.json());
      this.brokenSitesLastUpdated = Date.now();
      sites = await this.brokenSites;
    }

    if (sites && Object.prototype.hasOwnProperty.call(sites, url)) {
      return sites[url];
    } else {
      return false;
    }
  }

  async updateHistory(src, title, icon) {
    if (await this.settings.get("history")) {
      const obj = {
        url: src,
        time: Date.now(),
        title,
        icon
      };
      await this.history.add(obj);
    }
  }

  toggleDevTools() {
    const { contentWindow, contentDocument } = this.tabsArr[this.activeTabIndex].iframe;
    const toggle = () => {
      if (contentWindow.eruda._isInit) contentWindow.eruda.destroy();
      else {
        contentWindow.eruda.init();
        contentWindow.eruda.show();
      }
    };
    if (contentWindow.eruda) return toggle();
    const script = contentDocument.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = toggle;
    contentDocument.head.append(script);
  }

  async setTransport(url, transport) {
    const created = await this.createTransport(url, transport);
    if (created) this.controller.setTransport(created);
    return true;
  }

  //Returns null when nothing changed, load() calls this on every navigation and a new client would drop the wisp connection
  async createTransport(url, transport) {
    url = url ?? (await this.settings.get("server") || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`);
    transport = transport ?? (await this.settings.get("transport") || "/epoxy/index.mjs");
    if (transport.includes("baremod")) transport = "/epoxy/index.mjs";
    this.settings.set("server", url);
    this.settings.set("transport", transport);
    if (this.transportKey === transport + url) return null;
    this.transportKey = transport + url;
    const { default: Transport } = await import(transport);
    return new Transport({ wisp: url });
  }

}

const tabs = new Tab();
window.tabs = tabs;

let suggestionTimer;
searchInput.onkeydown = (e) => {
  clearTimeout(suggestionTimer);
  if (e.key === "Enter") return;

  const query =
    e.key.length > 1
      ? (e.key === "Backspace"
          ? searchInput.value.slice(0, -1)
          : searchInput.value)
      : searchInput.value + e.key;

  suggestionTimer = setTimeout(() => tabs.displaySearchSuggestions(query), 150);
};
searchInput.onfocus = () => { if (searchInput.value != "") tabs.displaySearchSuggestions(); };
document.onclick = (e) => { if (e.target !== searchInput) tabs.hideSuggestions(); };
window.onmessage = (message) => { if (message.data === "hide-suggestions") tabs.hideSuggestions(); };

setInterval(function () {
  for (let i = 0; i < tabs.tabsArr.length; i++) {
    tabs.setTab(i);
  }
}, 5000);
