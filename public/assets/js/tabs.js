import { HistoryHelper } from "/assets/js/history_helper.js";
import { SettingsManager } from "/assets/js/settings_manager.js";
import { BareMuxConnection } from "/baremux/index.mjs";
const searchInput = document.getElementById("__shadow-search-bar");
const addTabButton = document.getElementById("add-tab");

class Tab {
  constructor() {
    this.activeTabIndex = -1;
    this.tabsArr = [];
    this.brokenSites = fetch('/v1/api/broken-sites').then(res => res.json());
    this.history = new HistoryHelper();
    this.settings = new SettingsManager();
    this.connection = new BareMuxConnection("/baremux/worker.js");
    this.scramjet = null;
    
    // Initialize Scramjet
    this.initScramjet();
    
    document.getElementById("uv-form").addEventListener("submit", (e) => {
      e.preventDefault();
      searchInput.blur();
      const url = searchInput.value;
      tabs.load(url);
    });
    
    this.decode = (i) => {
      if (typeof self.__uv$config !== 'undefined') {
        return self.__uv$config.decodeUrl(i);
      }
      return i; // Fallback if UV config is not available
    };
    this.encode = (i) => {
      if (typeof self.__uv$config !== 'undefined') {
        return self.__uv$config.encodeUrl(i);
      }
      return i; // Fallback if UV config is not available
    };
    
    window.addEventListener("settings", (e) => {
      const detail = e.detail;
      switch (detail.key) {
        case "backend":
          this.backend = detail.newValue;
          break;
        case "search-engine":
          this.searchEngine = detail.newValue;
          break;
        case "search-suggestions":
          this.searchSuggestions = detail.newValue;
          break;
        case "search-suggestions-engine":
          this.searchSuggestionsEngine = detail.newValue;
          break
        default:
          break;
      }
    });
    
    this.defaults = [
      { "key": "search-suggestions", "value": true }, 
      { "key": "history", "value": true }, 
      { "key": "save-tabs", "value": true }, 
      { "key": "search-suggestions-engine", "value": "google" }, 
      { "key": "shortenUrls", "value": true }, 
      { "key": "search-engine", "value": "https://www.google.com/search?q=%s" },
      { "key": "backend", "value": "uv" }
    ];
    
    this.setDefaults();
    this.setTransport();
    this.init();
    
    this.getSuggestions = async (query) => await fetch(`/v1/api/search-suggestions?query=${query}`, { headers: { engine: this.searchSuggestionsEngine } }).then(response => { return response.json() });
    this.hideSuggestions = () => document.getElementById("suggestions").classList.add("hidden");
    
    this.getPrefix = () => {
      switch (this.backend) {
        case "scramjet":
          return ""; // Scramjet doesn't use a traditional prefix
        case "uv":
        default:
          return (typeof __uv$config !== 'undefined') ? __uv$config.prefix : "/uv/service/";
          break;
      }
    }
  }

  async initScramjet() {
    try {
      if (typeof $scramjetLoadController !== 'undefined') {
        const { ScramjetController } = $scramjetLoadController();
        this.scramjet = new ScramjetController({
          files: {
            wasm: "/scram/scramjet.wasm.wasm",
            all: "/scram/scramjet.all.js",
            sync: "/scram/scramjet.sync.js",
          },
        });
        
        if (navigator.serviceWorker) {
          await this.scramjet.init();
          
          // Make sure service worker is registered
          try {
            await navigator.serviceWorker.register("./sw.js");
          } catch (e) {
            console.warn("[TABS] Service worker registration failed:", e);
          }
          
          console.log("[TABS] Scramjet initialized successfully");
        } else {
          console.warn("[TABS] Service workers not supported, Scramjet unavailable");
          this.scramjet = null;
        }
      } else {
        console.warn("[TABS] Scramjet controller not available");
      }
    } catch (e) {
      console.error("[TABS] Failed to initialize Scramjet:", e);
      this.scramjet = null;
    }
  }

  encodeUrl(url) {
    switch (this.backend) {
      case "scramjet":
        if (this.scramjet) {
          return this.scramjet.encodeUrl(url);
        }
        // Fallback to UV if Scramjet fails
        return self.__uv$config.encodeUrl(url);
      case "uv":
      default:
        return self.__uv$config.encodeUrl(url);
    }
  }

  decodeUrl(url) {
    switch (this.backend) {
      case "scramjet":
        if (this.scramjet && url.includes("/scramjet/")) {
          try {
            return this.scramjet.decodeUrl(url);
          } catch (e) {
            console.warn("[TABS] Scramjet decode failed, falling back to UV:", e);
          }
        }
        return self.__uv$config.decodeUrl(url);
      case "uv":
      default:
        return self.__uv$config.decodeUrl(url);
    }
  }

  async setDefaults() {
    const arr = this.defaults;
    arr.forEach(async i => {
      this.settings.default(i.key, i.value)
    });
  }

  async init() {
    this.searchSuggestionsEngine = await this.settings.get("search-suggestions-engine")
    this.searchSuggestions = await this.settings.get("search-suggestions")
    this.searchEngine = await this.settings.get("search-engine");
    this.backend = await this.settings.get("backend") || "uv";
    const open = await this.history.getOpen()
    if (await this.settings.get("save-tabs") && open && open.length > 0) {
      await this.loadAllTabs();
    }
    else await this.createTab();
    self.stopLoad();
  }

  async updateSearchEngine() {
    this.searchEngine = await this.settings.get("search-engine");
  }

  async load(src, i = this.activeTabIndex) {
    this.hideSuggestions();
    
    // Handle shadow:// URLs - don't process them through proxies
    if (src.startsWith("shadow://")) {
      this.tabsArr[i].iframe.src = `/pages/${src.replace("shadow://", "")}.html`;
      this.tabsArr[i].src = src;
      this.saveTabs();
      return true;
    }
    
    const broken = await this.checkSite(src);
    if (broken && await this.brokenDisclaimer(broken)) {
      src = broken;
    };
    await this.setTransport();
    
    // Process the URL based on backend
    let processedUrl;
    if (this.backend === "scramjet" && this.scramjet) {
      // For Scramjet: first get the clean URL, then encode it
      let cleanUrl = this.search(src.trim(), this.searchEngine);
      processedUrl = this.scramjet.encodeUrl(cleanUrl);
    } else {
      // For UV: use the existing search function
      processedUrl = self.search ? self.search(src.trim(), this.searchEngine, this.backend) : this.search(src.trim(), this.searchEngine);
      if (this.backend === "uv" && typeof self.__uv$config !== 'undefined') {
        // Make sure we add UV prefix if not already there
        if (!processedUrl.startsWith(self.__uv$config.prefix)) {
          processedUrl = self.__uv$config.prefix + self.__uv$config.encodeUrl(processedUrl);
        }
      }
    }
    
    this.tabsArr[i].iframe.src = processedUrl;
    this.tabsArr[i].src = processedUrl;
    this.saveTabs();
    return true;
  }

  search(input, template = "https://www.google.com/search?q=%s") {
    try {
      // Check if it's already a valid URL
      return new URL(input).toString();
    } catch (err) {}
    
    try {
      // Try to make it a URL with http://
      let url = new URL(`http://${input}`);
      if (url.hostname.includes(".")) {
        return url.toString();
      }
    } catch (err) {}
    
    // Treat as search query
    return template.replace("%s", encodeURIComponent(input));
  }

  searchWithBackend(input, template = "https://www.google.com/search?q=%s") {
    let finalUrl;
    
    try {
      // Check if it's already a valid URL
      finalUrl = new URL(input).toString();
    } catch (err) {
      try {
        // Try to make it a URL with http://
        let url = new URL(`http://${input}`);
        if (url.hostname.includes(".")) {
          finalUrl = url.toString();
        } else {
          throw new Error("Not a valid domain");
        }
      } catch (err) {
        // Treat as search query
        finalUrl = template.replace("%s", encodeURIComponent(input));
      }
    }
    
    // Now encode based on backend
    if (this.backend === "scramjet" && this.scramjet) {
      return this.scramjet.encodeUrl(finalUrl);
    } else {
      return this.getPrefix() + this.encodeUrl(finalUrl);
    }
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
    tab.iframe.title = "Content IFrame"
    document.getElementById("iframes-container").appendChild(tab.iframe);
    document
      .getElementById("tabs-container")
      .insertBefore(tab.tab, addTabButton);
    this.switchTab(this.tabsArr.findIndex((obj) => obj.tab === tab.tab));
    await this.load(tab.src);
    this.activeTabIndex = this.tabsArr.length - 1;
    return true;
  }

  //Functions to create all the elements used by the tab in the tab bar
  createTabItems(tab) {
    //Tab icon
    tab.img.className = "tab-icon";
    tab.img.alt = "Favicon"
    if (tab.src.startsWith('shadow://')) {
      const favicon = `/assets/imgs/icons/pages/${tab.src.replace('shadow://', '')}.png`;
      tab.img.src = favicon;
    }

    tab.img.onerror = `${(tab.img.style.display = "none;")}`;
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
    src = src || this.tabsArr[i].iframe.contentDocument.location.pathname;
    console.log(src)
    if (src === "about:blank") return src;
    
    // Handle Scramjet URLs - Scramjet uses its own internal routing
    if (this.backend === "scramjet" && this.scramjet) {
      try {
        return this.scramjet.decodeUrl(src);
      } catch (e) {
        console.warn("[TABS] Scramjet decode failed:", e);
      }
    }
    
    // Handle UV URLs
    if (src.startsWith("/uv/service")) {
      return this.decode(src.replace(location.origin, "").replace(this.getPrefix(), ""));
    }
    
    if (src.startsWith("shadow://")) return src;
    return "shadow://" + src.replace(".html", "").replace("/pages/", "").replace(/\//g, "")
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
      icon = `https://www.google.com/s2/favicons/imgs/icons?domain=${src}&sz=24`;
    }
    const title = this.tabsArr[this.activeTabIndex].title || this.tabsArr[i].iframe.contentDocument.title;

    const obj = {
      title,
      icon,
      src
    }
    return obj;
  }

  async setTab(i = this.activeTabIndex) {
    const { title, icon } = this.getTabInfo(i);

    //Set the icon for the tab
    this.tabsArr[i].img.src = icon
    if (this.tabsArr[i].img.style.display == "none;") this.tabsArr[i].img.style.display = "block;";

    //Set the title for a tab
    this.tabsArr[i].tab.querySelector(".tab-title").textContent = title;

    //Allow functions to wait for the image to load before proceeding
    return new Promise(resolve => { this.tabsArr[i].img.onload = () => resolve(true) });
  }

  async saveTabs() {
    const tabSrc = this.tabsArr.map(tab => {
      const src = tab.src
      return (src.startsWith("/pages/")) ? this.parseUrl(false, src) : src;
    });
    try {
      (await navigator.serviceWorker.getRegistration()).active.postMessage({
        reason: "save-open-tabs", data: [...tabSrc, this.activeTabIndex]
      });
    } catch (e) {
      console.log(`[ATL] Issue with sending request to service worker: ${e}`)
    }
  }

  async loadAllTabs() {
    try {
      await fetch("/uv/service/hvtrs8%2F-ezaopne%2Ccmm"); //DO NOT REMOVE, HOLDS THIS ENTIRE BUGGY AH FEATURE TOGETHER (doesnt even fix sometimes)
    } catch (_) { }
    const openTabs = await this.history.getOpen();
    for (let i = 0; i < openTabs.length - 1; i++) {
      await this.createTab(openTabs[i]);
    }
    this.switchTab(openTabs[openTabs.length - 1]);
    this.history.clear("open-tabs");
    for (let i = 0; i < this.tabsArr.length - 1; i++) {
      this.setTab(i);
    }
    //Only await the last tab to load, provides the effect of all the tabs being loaded by the time loading screen goes away while loading all the tabs in parallel
    await this.setTab(this.tabsArr.length - 1);
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
    if (await this.brokenSites.lastUpdated <= Date.now - 300000 /*5 minutes*/) {
      fetch(`/v1/api/broken-sites`).then((res) => { this.brokenSites = res.json(); });
    }

    if ((await this.brokenSites).hasOwnProperty(url)) {
      return (await this.brokenSites)[url];
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
    this.tabsArr[this.activeTabIndex].iframe.contentWindow.postMessage("__shadow$toggleEruda");
  }

  async setTransport(url, transport) {
    url = url ?? (await this.settings.get("server") || `wss://${location.host}/wisp/`);
    transport = transport ?? (await this.settings.get("transport") || "/epoxy/index.mjs");
    
    const wispUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";
    
    try {
      switch (transport) {
        case "/epoxy/index.mjs":
          await this.connection.setTransport("/epoxy/index.mjs", [{ wisp: wispUrl }]);
          break;
        case "/libcurl/index.mjs":
          await this.connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
          break;
        case "/bareasmodule/index.mjs":
          const bareUrl = await this.settings.get("bareUrl") || url;
          await this.connection.setTransport("/bareasmodule/index.mjs", [bareUrl]);
          break;
        default:
          if (transport.includes("baremod")) transport = "/epoxy/index.mjs";
          await this.connection.setTransport(transport, [{ wisp: url }]);
          break;
      }
    } catch (e) {
      console.warn("[TABS] Transport setup failed:", e);
      // Fallback to epoxy
      await this.connection.setTransport("/epoxy/index.mjs", [{ wisp: wispUrl }]);
    }
    
    this.settings.set("server", url);
    this.settings.set("transport", transport);
    return true;
  }

  // Method to switch backends dynamically
  async switchBackend(backend) {
    this.backend = backend;
    await this.settings.set("backend", backend);
    
    if (backend === "scramjet" && !this.scramjet) {
      await this.initScramjet();
    }
    
    console.log(`[TABS] Switched to ${backend} backend`);
    
    // Trigger a settings event so other parts of the code can react
    window.dispatchEvent(new CustomEvent('settings', {
      detail: {
        key: 'backend',
        newValue: backend
      }
    }));
  }

  // Helper method to check current backend status
  getBackendStatus() {
    return {
      currentBackend: this.backend,
      scramjetAvailable: !!this.scramjet,
      uvAvailable: typeof self.__uv$config !== 'undefined'
    };
  }
}

const tabs = new Tab();
window.tabs = tabs;
https://humble-chainsaw-9p49r4xxr763p4jg-8080.app.github.dev/
searchInput.onkeydown = (e) => { if (e.key !== "Enter") tabs.displaySearchSuggestions(e.key.length > 1 ? (e.key === "Backspace" ? searchInput.value.slice(0, -1) : searchInput.value) : searchInput.value + e.key); };
searchInput.onfocus = () => { if (searchInput.value != "") tabs.displaySearchSuggestions(); };
document.onclick = (e) => { if (e.target !== searchInput) tabs.hideSuggestions(); };
window.onmessage = (message) => { if (message.data === "hide-suggestions") tabs.hideSuggestions(); };

setInterval(function () {
  for (let i = 0; i < tabs.tabsArr.length; i++) {
    tabs.setTab(i);
  }
}, 5000);