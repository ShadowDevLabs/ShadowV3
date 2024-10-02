import { SettingsManager } from "./settings_manager.js";

const settings = new SettingsManager();

async function changeTheme(selectedTheme) {
  changetheme(selectedTheme);
  await settings.set("theme", selectedTheme);
}

function changetheme(theme) {
  const root = document.documentElement;
  root.className = theme;
}

window.addEventListener("storage", function (e) {
  if (e.key === "theme") {
    const newTheme = e.newValue;
    if (newTheme) {
      changetheme(newTheme);
    }
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const theme =  await settings.get("theme");
  if (theme) {
    changetheme(theme);
    try {
      document.getElementById("themeSelector").value = theme;
    } catch (e) {}
  }
});
