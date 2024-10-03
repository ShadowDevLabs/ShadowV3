import { HistoryHelper } from "/assets/history-helper.js";
import { SettingsManager } from "/assets/settings_manager.js";

const searchInput = document.getElementById("search-bar");
const addTabButton = document.getElementById("add-tab");

class Tab {
  constructor() {
    window.onerror = (e) => {
      window.errorLogger.newError(e);
    }
    this.activeTabIndex = -1
    this.tabsArr = [];
    this.history = new HistoryHelper();
    this.settings = new SettingsManager();
    this.connection = new BareMux.BareMuxConnection("/baremux/worker.js");
    document.getElementById("uv-form").addEventListener("submit", (e) => {
      e.preventDefault();
      searchInput.blur();
      const url = searchInput.value;
      tabs.load(url);
    });
    this.decode = (i) => {
      return self.__uv$config.decodeUrl(i);
    };
    window.addEventListener("settings", (e) => {
      const detail = e.detail;
      if (detail.key === "backend") {
        this.backend = detail.newValue;
      } 
      if(detail.key === "searchEngine") {
        this.searchEngine = detail.newValue;
      }
    });
    this.defaults = [{ "key": "shortenUrls", "value": true }, { "key": "searchEngine", "value": "https://www.google.com/search?q=%s" }]
    this.setDefaults();
    this.init();
  }

  async setDefaults(...arr) {
    arr = arr ?? this.defaults
    arr.forEach(async i => {
      this.settings.default(arr[i].key, arr[i].value)
    });
  }

  async init() {
    this.searchEngine = await this.settings.get("searchEngine");
    this.backend = await this.settings.get("backend") || "uv";
    if (
      await this.settings.get("saveTabs") &&
      window.confirm(
        "Session ended unexpectedly, do you want to reopen your tabs?",
      )
    )
      this.loadAllTabs();
    else this.createTab();
  }

  async updateSearchEngine() {
    this.searchEngine = await this.settings.get("searchEngine");
  }


  async load(src, i = this.activeTabIndex) {
    const iframe = this.tabsArr[i].iframe;
    this.setTransport();
    const url = self.search(src, this.searchEngine, this.backend);
    iframe.src = url;
    this.updateHistory(src, i);
  }

  createTab(src = this.tabsArr.length === 0 ? "shadow://home" : "shadow://new") {
    //Functions to create all the elements used by the tab in the tab bar
    function createTabItems() {
      //Tab icon
      tab.img.className = "tab-icon";
      tab.img.alt = "Favicon"
      if (src.startsWith('shadow://')) {
        let favicon = src.replace('shadow://', '');
        favicon = `icons/pages/${favicon}.png`;
        tab.img.src = favicon;
      }

      //tab.img.onerror = `${(tab.img.style.display = "none")}`; //
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
        tabs.closeTab(tabs.tabsArr.findIndex((obj) => obj.tab === tab.tab)),
      );
      tab.tab.appendChild(closeBtn);
    }

    //Create a tab object to be put in the array
    let tab = {
      tab: document.createElement("div"),
      iframe: document.createElement("iframe"),
      img: document.createElement("img"),
      src: src,
    };
    //Add it to the array so that we can easily access each tab and all its elementes later
    this.tabsArr.push(tab);
    //Setup the tab in the tab bar
    tab.tab.classList.add("tab");
    createTabItems();
    tab.tab.addEventListener("click", (e) =>
      this.switchTab(
        this.tabsArr.findIndex((obj) => obj.tab === tab.tab),
        e,
      ),
    );
    tab.iframe.title = "Content Iframe"
    document.getElementById("iframes-container").appendChild(tab.iframe);
    document
      .getElementById("tabs-container")
      .insertBefore(tab.tab, addTabButton);
    this.switchTab(this.tabsArr.findIndex((obj) => obj.tab === tab.tab));
    this.load(tab.src);
    this.activeTabIndex = this.tabsArr.length - 1;
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
  }
  switchTab(i, e) {
    try {
      if (!e || e.target != this.tabsArr[i].tab.querySelector(".close-tab-button")) {
        try {
          this.tabsArr[this.activeTabIndex].iframe.classList.remove("active");
          this.tabsArr[this.activeTabIndex].tab.classList.remove("active");
        } catch (err) {
          console.log(`No active tab (${err})`);
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
  }
  updateOmni() {
    if (document.activeElement != searchInput) {
      let currentSrc = this.getSrc();
      let fullUrl = currentSrc;
      //Will finish eventually, cool feature that shortens urls until you click on them kinda like how operagx does it
      // if(this.await this.settings.get("shortenUrls")) {
      //   currentSrc = currentSrc.subString(0, currentSrc.lastIndexOf("?"));
      //}
      searchInput.value = currentSrc;
    }
  }
  getSrc(i = this.activeTabIndex) {
    const src = this.tabsArr[i].iframe.contentDocument.location.href;
    if (src === "about:blank") {
      return "about:blank";
    }
    switch (
    src.replace(location.href, "").replace(".html", "").replace(/\//g, "")
    ) {
      case "settings":
        return "shadow://settings";
      case "home":
        return "shadow://home";
      case "new":
        return "shadow://new";
      case "extensions":
        return "shadow://extensions";
      case "extensionsmanage":
        return "shadow://extensions/manage";
      case "books":
        return "shadow://games";
      default:
        return this.decode(
          src.replace(location.origin, "").replace("/uv/service/", ""),
        );
    }
  }
  async setTab(i = this.activeTabIndex) {
    //Set the icon for the tab
    let iconUrl;
    const src = this.getSrc(i);
    if (src.startsWith("shadow://")) {
      iconUrl = `/icons/pages/${this.getSrc(i).replace("shadow://", "")}`;
    } else if (src === "about:blank") {
      return;
    } else {
      try {
        iconUrl = `https://www.google.com/s2/favicons?domain=${src}&sz=24`;
      } catch (e) { }
      this.tabsArr[i].img.src = iconUrl;
    }
    //Set the title for a tab
    let title = this.tabsArr[i].iframe.contentDocument.title;
    this.tabsArr[i].tab.querySelector(".tab-title").textContent = title;
  }
  async saveTabs() {
    const openTabs = [];
    for (let i = 0; i < this.tabsArr.length; i++) {
      openTabs.push(this.getSrc(i));
    }
    await this.settings.set("activeTabs", JSON.stringify(openTabs));
  }
  async loadAllTabs() {
    this.tabsArr.forEach((tab, i) => {
      console.log(i);
      this.closeTab(i);
    });

    JSON.parse(await this.settings.get("activeTabs")).forEach((i) => {
      this.createTab(i);
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
  async updateHistory(src, i) {
    if (await this.settings.get("historyEnabled")) {
      let history = JSON.parse(await this.history.get()) ?? [];
      const obj = {
        url: src,
        time: Date.now,
        title: this.getSrc(i),
      };
      history.push(obj);
      await this.history.add(history);
    }
  }
  async setTransport(url, transport) {
    url = url ?? (await this.settings.get("server") || `wss://${location.host}/wisp/`);
    transport = transport ?? (await this.settings.get("transport") || "/epoxy/index.mjs");
    if (url.startsWith("ws")) {
      this.connection.setTransport(transport, [{ wisp: url }]);
      await this.settings.set("server", url);
      await this.settings.set("transport", transport);
    } else {
      this.connection.setTransport(transport, [url]);
      await this.settings.set("server", url);
      await this.settings.set("transport", transport);
    }
  }
}

const tabs = new Tab();
window.tabs = tabs;

setInterval(function () {
  for (let i = 0; i < tabs.tabsArr.length; i++) {
    tabs.setTab(i);
  }
}, 5000);

document.onvisibilitychange = async (e) => {
  if (await tabs.settings.get("saveTabs") && document.visibilityState === "hidden") {
    tabs.saveTabs();
  }
}; 
