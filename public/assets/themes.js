import { SettingsManager } from "./settings_manager.js";

const settings = new SettingsManager();

export async function changeTheme(selectedTheme) {
  setTheme(selectedTheme);
  if (parent !== window) parent.changeTheme(selectedTheme);
  await settings.set("theme", selectedTheme);
  localStorage.setItem("theme", selectedTheme);
}

function setRootVars(variables) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(key, value);
  }
}

function clearRootVars(variableKeys) {
  const root = document.documentElement;
  variableKeys.forEach(key => root.style.removeProperty(key));
}

export async function setTheme(theme) {
  const root = document.documentElement;

  const cssVariables = {
    '--background-color': '',
    '--tab-background': '',
    '--tab-border': '',
    '--text-color': '',
    '--accent-color': ''
  };

  if (theme === "custom") {
    const customTheme = JSON.parse(await settings.get("custom"));
    root.className = "custom";
    cssVariables['--background-color'] = customTheme.backgroundColor;
    cssVariables['--tab-background'] = customTheme.tabBackground;
    cssVariables['--tab-border'] = customTheme.tabBorder;
    cssVariables['--text-color'] = customTheme.textColor;
    cssVariables['--accent-color'] = customTheme.accentColor;
  } else {
    root.className = theme;
    clearRootVars(Object.keys(cssVariables));
  }

  setRootVars(cssVariables);
}

window.addEventListener("storage", function (e) {
  if (e.key === "theme") {
    setTheme(e.newValue);
  } else if (e.key === "custom") {
    if (localStorage.getItem("theme") === "custom") {
      setTheme("custom");
    }
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const theme = localStorage.getItem("theme") || await settings.get("theme");
  if (theme) {
    setTheme(theme);
    const themeSelector = document.getElementById("themeSelector");
    if (themeSelector) {
      themeSelector.value = theme;
    }
  }
});

function shadeColor(color, percent) {
  let R = parseInt(color.substring(1, 3), 16);
  let G = parseInt(color.substring(3, 5), 16);
  let B = parseInt(color.substring(5, 7), 16);

  R = parseInt((R * (100 + percent)) / 100);
  G = parseInt((G * (100 + percent)) / 100);
  B = parseInt((B * (100 + percent)) / 100);

  R = R < 255 ? R : 255;
  G = G < 255 ? G : 255;
  B = B < 255 ? B : 255;

  const RR = R.toString(16).padStart(2, '0');
  const GG = G.toString(16).padStart(2, '0');
  const BB = B.toString(16).padStart(2, '0');

  return `#${RR}${GG}${BB}`;
}

function genTheme(baseColor) {
  const themeVariables = {
    backgroundColor: shadeColor(baseColor, -75),
    tabBackground: shadeColor(baseColor, -40),
    tabBorder: shadeColor(baseColor, 20),
    textColor: '#ffffff',
    accentColor: shadeColor(baseColor, 30),
  };

  return themeVariables;
}

export async function applyCustomTheme() {
  const color = document.getElementById('themeColorPicker').value;
  const themeVars = genTheme(color);
  await settings.set("custom", JSON.stringify(themeVars, null, 2));
  changeTheme("custom");
}
