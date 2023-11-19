window.addEventListener('load', function() {
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.style.display = 'none';
  });
  
  
  const tabs = [];
  let currentTabIndex = -1;
  
  const backButton = document.getElementById("back-button");
  const forwardButton = document.getElementById("forward-button");
  const refreshButton = document.getElementById("refresh-button");
  const searchInput = document.getElementById("search-bar");
  const tabsContainer = document.getElementById("tabs-container");
  const iframesContainer = document.getElementById("iframes-container");
  const addTabButton = document.getElementById("add-tab");
  
  function updateTabTitleFromIframe(iframe, faviconSrc, title) {
    const tab = tabs[currentTabIndex];
    const src = iframe.src;
    const modifiedSrc = src.replace(window.location.origin, "").replace("/uv/service/", "");
    const faviconImg = document.createElement('img');
    faviconImg.className = "favicon";
    faviconImg.src = faviconSrc || `https://www.google.com/s2/favicons?domain=${modifiedSrc}&sz=64`;
    tab.textContent = '';
    const closeButton = document.createElement("span");
    closeButton.className = "close-tab-button";
    closeButton.innerHTML = "&#10006;";
    closeButton.addEventListener("click", () => closeTab(tabs.indexOf(tab)));
    tab.appendChild(faviconImg);
    tab.appendChild(document.createTextNode(' '));
    const tabTitle = title || iframe.contentDocument.title;
    tab.appendChild(document.createTextNode(tabTitle));
    tab.appendChild(closeButton);
}

  
  function createTab(title, url) {
    const tab = document.createElement("div");
    tab.className = "tab";
    tab.textContent = title;
    tab.addEventListener("click", () => switchTab(tabs.indexOf(tab)));
    tabsContainer.insertBefore(tab, addTabButton);
    tabs.push(tab);
  
    const closeButton = document.createElement("span");
    closeButton.className = "close-tab-button";
    closeButton.innerHTML = "&#10006;";
    closeButton.addEventListener("click", () => closeTab(tabs.indexOf(tab)));
    tab.appendChild(closeButton);
  
    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframesContainer.appendChild(iframe);
    switchTab(tabs.indexOf(tab)); 
  }
  
  
  function switchTab(index) {
    if (currentTabIndex !== -1) {
      tabs[currentTabIndex].classList.remove("active");
      iframesContainer.children[currentTabIndex].classList.remove("active");
    }
  
    currentTabIndex = index;
  
    tabs[index].classList.add("active");
    iframesContainer.children[index].classList.add("active");
  
    let currentSrc = iframesContainer.children[index].src;
    if (currentSrc.includes(window.location.origin)) {
      currentSrc = currentSrc.replace(window.location.origin, "shadow:/");
      if (currentSrc.includes(".html")) {
        currentSrc = currentSrc.replace(".html", "");
      }
    }
    searchInput.value = currentSrc;
  }
  
  function loadUrl(url, faviconsrc) {
    if (url !== "") {
      if (currentTabIndex !== -1) {
        const iframe = iframesContainer.children[currentTabIndex];
        iframe.src = url;
        updateTabTitleFromIframe(iframe, "/icons/loading.gif", " ");
        if(!faviconsrc){
          let favicon;
          console.log(url.replace("/pages/", "").replace(".html", ""))
          switch (url.replace("/pages/", "").replace(".html", "")) {
          case "settings":
            favicon = "/favicon/settings.ico"
            break;
          case "home":
            favicon = "/favicon/home.png"
            break;
          case "new":
            favicon = "/favicon/new.ico"
            break;
          case "extensions":
            favicon = "/favicon/extensions.png"
            break;
          case "chat":
            favicon = "/favicon/chat.png"
            break;
          default:
            favicon = "/favicon/default.ico"
            break;
        }
          updateTabTitleFromIframe(iframe, favicon);
        } else {
          iframe.onload = function () {
            const faviconsrc2 = `https://www.google.com/s2/favicons?domain=${faviconsrc}&sz=64`;
            updateTabTitleFromIframe(iframe, faviconsrc2);
        };
      }
      }
    }
  }
  
  function closeTab(index) {
    if (index === currentTabIndex) {
      if (tabs.length > 1) {
        if (index === tabs.length - 1) {
          switchTab(index - 1);
        } else {
          switchTab(index + 1);
        }
      } else {
        searchInput.value = "";
      }
    }
  
    tabsContainer.removeChild(tabs[index]);
    iframesContainer.removeChild(iframesContainer.children[index]);
    tabs.splice(index, 1);
    if (index < currentTabIndex) {
      currentTabIndex--;
    }
  }
  
  function goBack() {
    if (currentTabIndex !== -1) {
      iframesContainer.children[currentTabIndex].contentWindow.history.back();
    }
  }
  
  function goForward() {
    if (currentTabIndex !== -1) {
      iframesContainer.children[currentTabIndex].contentWindow.history.forward();
    }
  }
  
  function refresh() {
    if (currentTabIndex !== -1) {
      iframesContainer.children[currentTabIndex].contentWindow.location.reload();
    }
  }
  
  backButton.addEventListener("click", goBack);
  forwardButton.addEventListener("click", goForward);
  refreshButton.addEventListener("click", refresh);

  addTabButton.addEventListener("click", function () {
    createTab("New Tab", "new.html");
  });
  

  createTab("Home", "/home");
  const menuButton = document.getElementById("menu-button");
  const dropdown = document.getElementById("myDropdown");
  let isDropdownVisible = false;
  const menuButtons = dropdown.querySelectorAll("button[data-add-tab]");
  
  menuButtons.forEach((button) => {
    button.addEventListener("click", () => {
      dropdown.style.display = "none";
      isDropdownVisible = false;
    });
  });
  
  function toggleDropdown() {
    if (isDropdownVisible) {
      dropdown.style.display = "none";
    } else {
      dropdown.style.display = "block";
    }
    isDropdownVisible = !isDropdownVisible;
  }
  
  function closeMenu(event) {
    if (isDropdownVisible) {
      if (event.target !== menuButton && !dropdown.contains(event.target) && event.target !== menuButton) {
        dropdown.style.display = "none";
        isDropdownVisible = false;
      }
    }
  }
  
  menuButton.addEventListener("click", toggleDropdown);
  document.addEventListener("click", closeMenu);
  

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("uv-form");
    const address = document.getElementById("search-bar");
    const searchEngine = document.getElementById("uv-search-engine");
    const error = document.getElementById("uv-error");
    const errorCode = document.getElementById("uv-error-code");
    let mainurl = localStorage.getItem('mainurl');

    const registerServiceWorker = registerSW().catch((err) => {
      error.textContent = "Failed to register service worker.";
      errorCode.textContent = err.toString();
      throw err;
    });
  
    window.addEventListener('load', async () => {
      await registerServiceWorker();
    });
  
    window.addEventListener('storage', function(event) {
      if (event.key === 'mainurl') {
        var mainurl = localStorage.getItem('mainurl');
        loadUrl(__uv$config.prefix + __uv$config.encodeUrl(mainurl), mainurl);
      }
    });
    
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await registerServiceWorker;
      const url = search(address.value, searchEngine.value);
      if(!url.startsWith("/")) loadUrl(__uv$config.prefix + __uv$config.encodeUrl(url), url); else loadUrl(url, false)
    });
  });
  
// Menu Buttons

function iframefullscreen() {
  const iframe = iframesContainer.children[currentTabIndex];
  if (iframe.requestFullscreen) {
    iframe.requestFullscreen();
  } else if (iframe.mozRequestFullScreen) {
    iframe.mozRequestFullScreen();
  } else if (iframe.webkitRequestFullscreen) {
    iframe.webkitRequestFullscreen();
  } else if (iframe.msRequestFullscreen) {
    iframe.msRequestFullscreen();
  }
}


function abtblank() {
  const url = location.href;
  const width = window.innerWidth;
  const height = window.innerHeight;

  let inFrame;

  try {
    inFrame = window !== top;
  } catch (e) {
    inFrame = true;
  }

  if (!inFrame && !navigator.userAgent.includes("Firefox")) {
    const popup = window.open("about:blank", name, `width=${width},height=${height}`);

    if (!popup || popup.closed) {
      alert("Allow popups and redirects to hide this from showing up in your history.");
    } else {
      const doc = popup.document;
      const iframe = doc.createElement("iframe");
      const style = iframe.style;
      const link = doc.createElement("link");


      iframe.src = url;
      style.position = "fixed";
      style.top = style.bottom = style.left = style.right = 0;
      style.border = style.outline = "none";
      style.width = style.height = "100%";

      doc.head.appendChild(link);
      doc.body.appendChild(iframe);
      window.location.replace("https://google.com");
    }
  }
}


function iframeabtblank() {
  const iframe = iframesContainer.children[currentTabIndex];
  const url = iframe.src;
  const width = window.innerWidth;
  const height = window.innerHeight;

  let inFrame;

  try {
    inFrame = window !== top;
  } catch (e) {
    inFrame = true;
  }

  if (!inFrame && !navigator.userAgent.includes("Firefox")) {
    const popup = window.open("about:blank", `width=${width},height=${height}`);

    if (!popup || popup.closed) {
      alert("Allow popups and redirects to hide this from showing up in your history.");
    } else {
      const doc = popup.document;
      const iframe = doc.createElement("iframe");
      const style = iframe.style;
      const link = doc.createElement("link");


      iframe.src = url;
      style.position = "fixed";
      style.top = style.bottom = style.left = style.right = 0;
      style.border = style.outline = "none";
      style.width = style.height = "100%";

      doc.head.appendChild(link);
      doc.body.appendChild(iframe);
      window.location.replace("https://google.com");
    }
  }
}


function exit() {
  var confirm = window.confirm("Are you sure you want to close this tab?");
  if (confirm) {
      window.close();
  }
}