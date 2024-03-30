localStorage.setItem("shortenUrls", true)

const error = document.getElementById("uv-error");
const errorCode = document.getElementById("uv-error-code");

const decode = (i) => {
   return self.__uv$config.decodeUrl(i);
}
const encode = (i) => {
    return self.__uv$config.encodeUrl(i);
}
const searchInput = document.getElementById("search-bar");
const tabsContainer = document.getElementById("tabs-container");
const iframesContainer = document.getElementById("iframes-container");
const searchEngine = document.getElementById("uv-search-engine");
const addTabButton = document.getElementById("add-tab");
var activeTabIndex = -1;
var tabsArr = [];

class Tab {
   constructor() {
      document.getElementById("uv-form").addEventListener("submit", async (e) => {
         e.preventDefault();
         searchInput.blur()
         searchInput.value;
         const url = searchInput.value
         tabs.load(url) 
      });
      this.fullUrl = ""
      if(localStorage.getItem("saveTabs") && window.confirm("Session ended unexpectedly, do you want to reopen your tabs?")) this.loadAllTabs(); else this.createTab();
    };
   async load(src, i = activeTabIndex) {
      const iframe = tabsArr[i].iframe;
      const url = self.search(src, searchEngine.value);
      iframe.src = url;
   };
   createTab(src = tabsArr.length === 0 ? "shadow://home" : "shadow://new") {
      //Functions to create all the elements used by the tab in the tab bar
      function createTabItems() {
         //Tab icon
         tab.img.className = "tab-icon";
         tab.tab.appendChild(tab.img);
         //Tab title
         const titleContainer = document.createElement("div");
         titleContainer.className = "tab-title";
         tab.tab.appendChild(titleContainer);
         //Close button
         const closeBtn = document.createElement("span");
         closeBtn.className = "close-tab-button";
         closeBtn.innerHTML = "&#x2715;";
         closeBtn.addEventListener("click", (e) => tabs.closeTab(tabsArr.findIndex((obj) => obj.tab === tab.tab)));
         tab.tab.appendChild(closeBtn);
      }

      //Create a tab object to be put in the array
      let tab = {
         tab: document.createElement("div"),
         iframe: document.createElement("iframe"),
         img: document.createElement("img"),
         src: src
      }
      //Add it to the array so that we can easily access each tab and all its elementes later
      tabsArr.push(tab);
      //Setup the tab in the tab bar
      tab.tab.classList.add("tab");
      createTabItems();
      tab.tab.addEventListener("click", (e) => this.switchTab(tabsArr.findIndex((obj) => obj.tab === tab.tab), e));
      document.getElementById("iframes-container").appendChild(tab.iframe);
      document.getElementById("tabs-container").insertBefore(tab.tab, addTabButton);
      this.switchTab(tabsArr.findIndex((obj) => obj.tab === tab.tab));
      this.load(tab.src);
      activeTabIndex = tabsArr.length - 1;
   };
   closeTab(i, force = false) {
        const isActive = activeTabIndex === i;
        if(isActive) {
            //Delete elements
            tabsArr[i].iframe.remove(); 
            tabsArr[i].tab.remove();
            //Remove obj from array
            tabsArr.splice(i, 1);
         if(tabsArr.length <= 0 && !force) {
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
            if((tabsArr.length - 1) === activeTabIndex) {
                activeTabIndex -= 1
            }
            //Remove obj from array
            tabsArr.splice(i, 1);
        }
   }
   switchTab(i, e) {
        try {
      if (!e || (e.target != tabsArr[i].tab.querySelector(".close-tab-button"))) {
         try {
            tabsArr[activeTabIndex].iframe.classList.remove("active")
            tabsArr[activeTabIndex].tab.classList.remove("active")
         } catch (err) {
            console.log(`No active tab (${err})`)
         }
         tabsArr[i].iframe.classList.add("active")
         tabsArr[i].tab.classList.add("active")
         activeTabIndex = i
      } else {
      }
        this.updateOmni();
        this.setTab();
    } catch (e) {/*Silence goofy errors*/}
   };
   updateOmni() {
      if(document.activeElement!=searchInput) {
      let currentSrc = this.getSrc();
      this.fullUrl = currentSrc;
      // if(localStorage.getItem("shortenUrls")) {
      //   currentSrc = currentSrc.subString(0, currentSrc.lastIndexOf("?"));
      //}
      searchInput.value = currentSrc;
      }
   };
   getSrc(i = activeTabIndex) {
      const src = tabsArr[i].iframe.contentDocument.location.href;
      if(src==="about:blank") {
         return "about:blank";
      }
        switch (src.replace(location.href, "").replace(".html","").replace(/\//g, "")) {
            case "settings":
                return "shadow://settings"
            case "home":
                return "shadow://home"
            case "new":
                return "shadow://new"
            case "extensions":
                return "shadow://extensions"
            case "extensionsmanage":
                return "shadow://extensions/manage"
            default:
                //console.log(src.replace(location.href, "").replace(".html","").replace(/\//g, ""))
				return decode(src.replace(location.origin, "").replace("/uv/service/", ""));
        }
   };
   async setTab(i = activeTabIndex) {
      //Set the icon for the tab
      let iconUrl;
      const src = this.getSrc(i)
      if(src.startsWith("shadow://")) {
        iconUrl = `/icons/pages/${this.getSrc(i).replace("shadow://","")}.html`
      } else if(src === "about:blank") {
          return
      } else {
      try {
         iconUrl = `https://www.google.com/s2/favicons?domain=${src}&sz=24`
      } catch(e){}
      tabsArr[i].img.src = iconUrl
      }
        //Set the title for a tab
      let title = tabsArr[i].iframe.contentDocument.title
      tabsArr[i].tab.querySelector(".tab-title").textContent = title
   };
   saveTabs() {
      const openTabs = []
      for (let i = 0; i < tabsArr.length; i++) {
         openTabs.push(this.getSrc(i));
      }
      localStorage.setItem("activeTabs", JSON.stringify(openTabs));
   };
   loadAllTabs() {
        tabsArr.forEach((tab, i) => {
            console.log(i);
            this.closeTab(i);
        });

      JSON.parse(localStorage.getItem("activeTabs")).forEach(i => {
         this.createTab(i)
      })
   };
   refresh(i = activeTabIndex) {
      tabsArr[i].iframe.contentWindow.history.refresh();
   };
   forward(i = activeTabIndex) {
      tabsArr[i].iframe.contentWindow.history.forward();
   };
   backward(i = activeTabIndex) {
      tabsArr[i].iframe.contentWindow.history.backward();
   }
}

const tabs = new Tab();

setInterval(function() {
   for(let i = 0; i < tabsArr.length; i++) {
   tabs.setTab(i);
   }
}, 5000)
onbeforeunload = (i) => {
   if (localStorage.getItem("saveTabs")) {
      tabs.saveTabs();
   }
}

