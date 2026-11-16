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
  await applyCustomizations();
}

// ---------------------------------------------------------------- customizer
// Layered on top of whichever theme is active (Settings → Themes → Customize):
//   theme-accent     a hex color that replaces the theme's accent colors
//   theme-wallpaper  an image (URL or data: URL) behind Shadow's own pages
//   theme-css        free-form CSS added to the shell and every internal page
const ACCENT_VARS = ["--accent", "--accent-light", "--accent-glow", "--border"];
const isShell = window === window.top || !!document.getElementById("tabs-container");

export async function applyCustomizations() {
  const root = document.documentElement;
  const [accent, wallpaper, css] = await Promise.all([
    settings.get("theme-accent"),
    settings.get("theme-wallpaper"),
    settings.get("theme-css"),
  ]);

  if (typeof accent === "string" && /^#[0-9a-f]{6}$/i.test(accent)) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-light", shadeColor(accent, 30));
    root.style.setProperty("--accent-glow", `rgba(${hexToRgb(accent)}, 0.2)`);
    root.style.setProperty("--border", `rgba(${hexToRgb(accent)}, 0.3)`);
    root.dataset.customAccent = "1";
  } else if (root.dataset.customAccent) {
    // Back to the theme's own values (a "custom" theme re-sets them in setTheme).
    delete root.dataset.customAccent;
    if (root.className !== "custom") ACCENT_VARS.forEach((key) => root.style.removeProperty(key));
    else return setTheme("custom");
  }

  let style = document.getElementById("shadow-customizer");
  const rules = [];
  if (typeof wallpaper === "string" && wallpaper && !isShell) {
    root.style.setProperty("--home-bg", `url(${JSON.stringify(wallpaper)})`);
    rules.push(
      `body { background-image: var(--home-bg) !important; background-size: cover !important; background-position: center !important; background-attachment: fixed !important; }`,
      `.bg-dots { display: none !important; }`,
    );
    root.dataset.customWallpaper = "1";
  } else if (root.dataset.customWallpaper) {
    delete root.dataset.customWallpaper;
    if (root.className !== "custom") root.style.removeProperty("--home-bg");
  }
  if (typeof css === "string" && css.trim()) rules.push(css);
  if (rules.length === 0) return void style?.remove();
  if (!style) {
    style = document.createElement("style");
    style.id = "shadow-customizer";
    (document.head ?? root).append(style);
  }
  style.textContent = rules.join("\n");
}

// Any frame changing one of these re-applies them everywhere.
try {
  new BroadcastChannel("shadow-settings").addEventListener("message", (e) => {
    if (typeof e.data?.key === "string" && e.data.key.startsWith("theme-")) applyCustomizations();
  });
} catch {}

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
  if (!theme) applyCustomizations();
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
