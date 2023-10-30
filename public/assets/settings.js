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
  title: "Shadow Settings",
  icon: "/favicon/favicon-32x32.png",
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
      setFavicon("/cloaks/Google Search.ico");
      location.reload();
      break;
    case "drive":
      setTitle("Google Drive");
      setFavicon("/cloaks/Google Drive.ico");
      location.reload();
      break;
    case "youtube":
      setTitle("YouTube");
      setFavicon("/cloaks/YouTube.ico");
      location.reload();
      break;
    case "gmail":
      setTitle("Gmail");
      setFavicon("/cloaks/Gmail.ico");
      location.reload();
      break;
    case "calendar":
      setTitle("Google Calendar");
      setFavicon("/cloaks/Calendar.ico");
      location.reload();
      break;
    case "meets":
      setTitle("Google Meet");
      setFavicon("/cloaks/Meet.ico");
      location.reload();
      break;
    case "classroom":
      setTitle("Google Classroom");
      setFavicon("/cloaks/Classroom.png");
      location.reload();
      break;
    case "canvas":
      setTitle("Canvas");
      setFavicon("/cloaks/Canvas.ico");
      location.reload();
      break;
    case "zoom":
      setTitle("Zoom");
      setFavicon("/cloaks/Zoom.ico");
      location.reload();
      break;
    case "khan":
      setTitle("Khan Academy");
      setFavicon("/cloaks/Khan Academy.ico");
      location.reload();
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
    icon: settingsDefaultTab.icon
  };
  localStorage.setItem("tab", JSON.stringify(tabData));
}
