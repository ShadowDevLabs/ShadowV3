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
    '--background': '',
    '--home-bg': '',
    '--primary': '',
    '--primary-dark': '',
    '--secondary': '',
    '--accent': '',
    '--accent-light': '',
    '--accent-glow': '',
    '--border': '',
    '--text': '',
    '--text-muted': '',
    '--hover-danger': '',
    '--active-tab': ''
  };

  if (theme === "custom") {
    const customTheme = JSON.parse(await settings.get("custom"));
    root.className = "custom";
    cssVariables['--background'] = customTheme.background;
    cssVariables['--home-bg'] = customTheme.homeBg;
    cssVariables['--primary'] = customTheme.primary;
    cssVariables['--primary-dark'] = customTheme.primaryDark;
    cssVariables['--secondary'] = customTheme.secondary;
    cssVariables['--accent'] = customTheme.accent;
    cssVariables['--accent-light'] = customTheme.accentLight;
    cssVariables['--accent-glow'] = customTheme.accentGlow;
    cssVariables['--border'] = customTheme.border;
    cssVariables['--text'] = customTheme.text;
    cssVariables['--text-muted'] = customTheme.textMuted;
    cssVariables['--hover-danger'] = customTheme.hoverDanger;
    cssVariables['--active-tab'] = customTheme.activeTab;
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

function hexToRgb(hex) {
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}


function genTheme(baseColor) {
  const themeVariables = {
    background: `linear-gradient(145deg, ${shadeColor(baseColor, -75)}, ${shadeColor(baseColor, -60)})`,
    homeBg: `linear-gradient(145deg, ${shadeColor(baseColor, -45)}, ${shadeColor(baseColor, -75)}, ${shadeColor(baseColor, -90)})`,
    primary: shadeColor(baseColor, -75),
    primaryDark: shadeColor(baseColor, -85),
    secondary: shadeColor(baseColor, -65),
    accent: shadeColor(baseColor, 20),
    accentLight: shadeColor(baseColor, 40),
    accentGlow: `rgba(${hexToRgb(baseColor)}, 0.2)`,
    border: `rgba(${hexToRgb(baseColor)}, 0.3)`,
    text: '#fff',
    textMuted: `rgba(${hexToRgb(shadeColor(baseColor, 60))}, 0.8)`,
    hoverDanger: '#f87171',
    activeTab: `linear-gradient(145deg, ${shadeColor(baseColor, -20)}, ${shadeColor(baseColor, -65)})`
  };
  return themeVariables;
}

export async function applyCustomTheme() {
  const color = document.getElementById('themeColorPicker').value;
  const themeVars = genTheme(color);
  await settings.set("custom", JSON.stringify(themeVars, null, 2));
  changeTheme("custom");
}
