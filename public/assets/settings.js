var tab = localStorage.getItem("tab");
if (tab) {
  try {
    var tabData = JSON.parse(tab);
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
  icon: "/icons/logo.png",
};

function setTitle(title = "") {
  if (title) {
    document.title = title;
  } else {
    document.title = settingsDefaultTab.title;
  }
  var tab = localStorage.getItem("tab");
  if (tab) {
    try {
      var tabData = JSON.parse(tab);
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
  localStorage.setItem("tab", JSON.stringify(tabData));
}

function setFavicon(icon) {
  if (icon) {
    document.querySelector("link[rel='icon']").href = icon;
  } else {
    document.querySelector("link[rel='icon']").href = settingsDefaultTab.icon;
  }
  var tab = localStorage.getItem("tab");
  if (tab) {
    try {
      var tabData = JSON.parse(tab);
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
  localStorage.setItem("tab", JSON.stringify(tabData));
}

function setCloak() {
  var cloak = document.getElementById("premadecloaks").value;
  switch (cloak) {
    case "search":
      setTitle("Google Search");
      setFavicon("/icons/cloaks/Google Search.ico");
      break;
    case "drive":
      setTitle("Google Drive");
      setFavicon("/icons/cloaks/Google Drive.ico");
      break;
    case "youtube":
      setTitle("YouTube");
      setFavicon("/icons/cloaks/YouTube.ico");
      break;
    case "gmail":
      setTitle("Gmail");
      setFavicon("/icons/cloaks/Gmail.ico");
      break;
    case "calendar":
      setTitle("Google Calendar");
      setFavicon("/icons/cloaks/Calendar.ico");
      break;
    case "meets":
      setTitle("Google Meet");
      setFavicon("/icons/cloaks/Meet.ico");
      break;
    case "classroom":
      setTitle("Google Classroom");
      setFavicon("/icons/cloaks/Classroom.png");
      break;
    case "canvas":
      setTitle("Canvas");
      setFavicon("/icons/cloaks/Canvas.ico");
      break;
    case "zoom":
      setTitle("Zoom");
      setFavicon("/icons/cloaks/Zoom.ico");

      break;
    case "khan":
      setTitle("Khan Academy");
      setFavicon("/icons/cloaks/Khan Academy.ico");

      break;
  }
}

function resetTab() {
  document.title = settingsDefaultTab.title;
  document.querySelector("link[rel='icon']").href = settingsDefaultTab.icon;
  document.getElementById("title").value = "";
  document.getElementById("icon").value = "";
  var tabData = {
    title: settingsDefaultTab.title,
    icon: settingsDefaultTab.icon,
  };
  localStorage.setItem("tab", JSON.stringify(tabData));
}

document.addEventListener("DOMContentLoaded", function () {
  if (localStorage.getItem("tab")) {
    updateTabItem();
  }

  window.addEventListener("storage", function (event) {
    if (event.key === "tab") {
      updateTabItem();
    }
  });

  function updateTabItem() {
    var tabItem = JSON.parse(localStorage.getItem("tab"));
    document.title = tabItem.title;
    var favicon = document.querySelector('link[rel="icon"]');
    if (favicon) {
      favicon.href = tabItem.icon;
    }
  }
});
