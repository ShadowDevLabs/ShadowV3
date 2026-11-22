import { SettingsManager } from "./settings_manager.js";

(async function () {
  const settings = new SettingsManager();

  if (await settings.get("close-protection")) {
    top.onbeforeunload = function (e) { e.preventDefault(); return true; /* Prevent automatic tab closing */ };
  }

  var tab = await settings.get("tab");
  if (tab) {
    try {
      var tabData = tab;
    } catch {
      var tabData = {};
    }
  } else {
    var tabData = {};
  }

  if (tabData.title) {
    document.getElementById("title").value = tabData.title;
  }
  if (tabData.icon) {
    document.getElementById("icon").value = tabData.icon;
  }

  var settingsDefaultTab = {
    title: "Shadow",
    icon: "/assets/imgs/icons/logo.png",
  };

  self.setTitle = async function (title = "") {
    if (title) {
      document.title = title;
    } else {
      document.title = settingsDefaultTab.title;
    }
    var tab = await settings.get("tab");
    if (tab) {
      try {
        var tabData = tab;
      } catch {
        var tabData = {};
      }
    } else {
      var tabData = {};
    }
    if (title) {
      tabData.title = title;
    } else {
      delete tabData.title;
    }
    await settings.set("tab", tabData);
  }

  self.setFavicon = async function (icon) {
    if (icon) {
      document.querySelector("link[rel='icon']").href = icon;
    } else {
      document.querySelector("link[rel='icon']").href = settingsDefaultTab.icon;
    }
    var tab = await settings.get("tab");
    if (tab) {
      try {
        var tabData = tab;
      } catch {
        var tabData = {};
      }
    } else {
      var tabData = {};
    }
    if (icon) {
      tabData.icon = icon;
    } else {
      delete tabData.icon;
    }
    await settings.set("tab", tabData);
  }

  self.setCloak = function () {
    var cloak = document.getElementById("premadecloaks").value;
    switch (cloak) {
      case "search":
        setTitle("Google Search");
        setFavicon("/assets/imgs/icons/cloaks/Google Search.png");
        break;
      case "drive":
        setTitle("Google Drive");
        setFavicon("/assets/imgs/icons/cloaks/Google Drive.png");
        break;
      case "youtube":
        setTitle("YouTube");
        setFavicon("/assets/imgs/icons/cloaks/YouTube.png");
        break;
      case "gmail":
        setTitle("Gmail");
        setFavicon("/assets/imgs/icons/cloaks/Gmail.png");
        break;
      case "calendar":
        setTitle("Google Calendar");
        setFavicon("/assets/imgs/icons/cloaks/Calendar.png");
        break;
      case "meets":
        setTitle("Google Meet");
        setFavicon("/assets/imgs/icons/cloaks/Meet.png");
        break;
      case "classroom":
        setTitle("Google Classroom");
        setFavicon("/assets/imgs/icons/cloaks/Classroom.svg");
        break;
      case "canvas":
        setTitle("Canvas");
        setFavicon("/assets/imgs/icons/cloaks/Canvas.ico");
        break;
      case "zoom":
        setTitle("Zoom");
        setFavicon("/assets/imgs/icons/cloaks/Zoom.ico");

        break;
      case "khan":
        setTitle("Khan Academy");
        setFavicon("/assets/imgs/icons/cloaks/Khan Academy.ico");

        break;
    }
  }

  self.resetTab = async function () {
    document.title = settingsDefaultTab.title;
    document.querySelector("link[rel='icon']").href = settingsDefaultTab.icon;
    document.getElementById("title").value = "";
    document.getElementById("icon").value = "";
    var tabData = {
      title: settingsDefaultTab.title,
      icon: settingsDefaultTab.icon,
    };
    await settings.get("tab", tabData);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (await settings.get("tab")) {
      updateTabItem();
    }

    window.addEventListener("settings", function (event) {
      if (event.detail.key === "tab") {
        updateTabItem();
      }
    });

    async function updateTabItem() {
      var tabItem = await settings.get("tab");
      document.title = tabItem.title;
      var favicon = document.querySelector('link[rel="icon"]');
      if (favicon) {
        // Cloaks saved before the icons were refreshed point at files that no longer exist.
        const renamed = { "Google Search.ico": "Google Search.png", "Google Drive.ico": "Google Drive.png", "YouTube.ico": "YouTube.png",
          "Gmail.ico": "Gmail.png", "Calendar.ico": "Calendar.png", "Meet.ico": "Meet.png", "Classroom.png": "Classroom.svg" };
        favicon.href = String(tabItem.icon ?? "").replace(/(\/cloaks\/)([^/]+)$/, (m, dir, file) => dir + (renamed[file] ?? file));
      }
    }
  });
})();