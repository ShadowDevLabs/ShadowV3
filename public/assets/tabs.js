localStorage.setItem("shortenUrls", true);

const error = document.getElementById("uv-error");
const errorCode = document.getElementById("uv-error-code");

const decode = (i) => {
  return self.__uv$config.decodeUrl(i);
};
const searchInput = document.getElementById("search-bar");
const searchEngine = document.getElementById("uv-search-engine");
const addTabButton = document.getElementById("add-tab");
var activeTabIndex = -1;
var tabsArr = [];

class Tab {
  constructor() {
    this.connection = new BareMux.BareMuxConnection("/baremux/worker.js");
    document.getElementById("uv-form").addEventListener("submit", (e) => {
      e.preventDefault();
      searchInput.blur();
      const url = searchInput.value;
      tabs.load(url);
    });
    if (
      localStorage.getItem("saveTabs") &&
      window.confirm(
        "Session ended unexpectedly, do you want to reopen your tabs?",
      )
    )
      this.loadAllTabs();
    else this.createTab();
    this.backend = localStorage.getItem("backend") || "uv";
    window.addEventListener("storage", (e) => {
      if (e.key === "backend") {
        this.backend = e.newValue;
      }
    });
  }
  async load(src, i = activeTabIndex) {
    const iframe = tabsArr[i].iframe;
    this.setTransport();
    const url = self.search(src, searchEngine.value, this.backend);
    iframe.src = url;
    //this.updateHistory(src, i);
  }
  createTab(src = tabsArr.length === 0 ? "shadow://home" : "shadow://new") {
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
        tabs.closeTab(tabsArr.findIndex((obj) => obj.tab === tab.tab)),
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
    tabsArr.push(tab);
    //Setup the tab in the tab bar
    tab.tab.classList.add("tab");
    createTabItems();
    tab.tab.addEventListener("click", (e) =>
      this.switchTab(
        tabsArr.findIndex((obj) => obj.tab === tab.tab),
        e,
      ),
    );
    tab.iframe.title = "Content Iframe"
    document.getElementById("iframes-container").appendChild(tab.iframe);
    document
      .getElementById("tabs-container")
      .insertBefore(tab.tab, addTabButton);
    this.switchTab(tabsArr.findIndex((obj) => obj.tab === tab.tab));
    this.load(tab.src);
    activeTabIndex = tabsArr.length - 1;
  }
  closeTab(i, force = false) {
    const isActive = activeTabIndex === i;
    if (isActive) {
      //Delete elements
      tabsArr[i].iframe.remove();
      tabsArr[i].tab.remove();
      //Remove obj from array
      tabsArr.splice(i, 1);
      if (tabsArr.length <= 0 && !force) {
        this.createTab();
      }
      const closest = i != 0 ? i - 1 : 0; //If the active tab is NOT the first one, go down one in the tab list. If it is, leave it at 0 for the next tab.
      this.switchTab(closest);
      activeTabIndex = closest;
    } else {
      //Delete elements
      tabsArr[i].iframe.remove();
      tabsArr[i].tab.remove();
      //Set new active tab index if the tab moves
      if (tabsArr.length - 1 === activeTabIndex) {
        activeTabIndex -= 1;
      }
      //Remove obj from array
      tabsArr.splice(i, 1);
    }
  }
  switchTab(i, e) {
    try {
      if (!e || e.target != tabsArr[i].tab.querySelector(".close-tab-button")) {
        try {
          tabsArr[activeTabIndex].iframe.classList.remove("active");
          tabsArr[activeTabIndex].tab.classList.remove("active");
        } catch (err) {
          console.log(`No active tab (${err})`);
        }
        tabsArr[i].iframe.classList.add("active");
        tabsArr[i].tab.classList.add("active");
        activeTabIndex = i;
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
      // if(localStorage.getItem("shortenUrls")) {
      //   currentSrc = currentSrc.subString(0, currentSrc.lastIndexOf("?"));
      //}
      searchInput.value = currentSrc;
    }
  }
  getSrc(i = activeTabIndex) {
    const src = tabsArr[i].iframe.contentDocument.location.href;
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
        return decode(
          src.replace(location.origin, "").replace("/uv/service/", ""),
        );
    }
  }
  async setTab(i = activeTabIndex) {
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
      tabsArr[i].img.src = iconUrl;
    }
    //Set the title for a tab
    let title = tabsArr[i].iframe.contentDocument.title;
    tabsArr[i].tab.querySelector(".tab-title").textContent = title;
  }
  saveTabs() {
    const openTabs = [];
    for (let i = 0; i < tabsArr.length; i++) {
      openTabs.push(this.getSrc(i));
    }
    localStorage.setItem("activeTabs", JSON.stringify(openTabs));
  }
  loadAllTabs() {
    tabsArr.forEach((tab, i) => {
      console.log(i);
      this.closeTab(i);
    });

    JSON.parse(localStorage.getItem("activeTabs")).forEach((i) => {
      this.createTab(i);
    });
  }
  refresh(i = activeTabIndex) {
    tabsArr[i].iframe.contentWindow.location.reload();
  }
  forward(i = activeTabIndex) {
    tabsArr[i].iframe.contentWindow.history.forward();
  }
  backward(i = activeTabIndex) {
    tabsArr[i].iframe.contentWindow.history.back();
  }
  updateHistory(src, i) {
    //To enable & disable we would just set it to "off"
    let history = JSON.parse(localStorage.getItem("history")) || [];
    if (history !== "off") {
      const obj = {
        url: src,
        time: Date.now,
        title: this.getSrc(i),
      };
      history.push(obj);
      localStorage.setItem("history", history);
    }
  }
  setTransport(
    url = localStorage.getItem("server") || `wss://${location.host}/wisp/`,
    transport = localStorage.getItem("transport") || "/epoxy/index.mjs",
  ) {
    url =
      url || localStorage.getItem("server") || `wss://${location.host}/wisp/`;
    if (url.startsWith("ws")) {
      this.connection.setTransport(transport, [{ wisp: url }]);
      localStorage.setItem("server", url);
      localStorage.setItem("transport", transport);
    } else {
      this.connection.setTransport(transport, [url]);
      localStorage.setItem("server", url);
      localStorage.setItem("transport", transport);
    }
  }
}

const tabs = new Tab();
window.tabs = tabs;

setInterval(function () {
  for (let i = 0; i < tabsArr.length; i++) {
    tabs.setTab(i);
  }
}, 5000);
onbeforeunload = (i) => {
  if (localStorage.getItem("saveTabs")) {
    tabs.saveTabs();
  }
};
