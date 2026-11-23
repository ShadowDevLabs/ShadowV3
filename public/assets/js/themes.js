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

// Themes that were removed: anyone still on one (saved or synced) gets the default look and card.
const RETIRED_THEMES = ["redsunset", "kayspink", "operagx", "golden"];

export async function setTheme(theme) {
  if (RETIRED_THEMES.includes(theme)) theme = "default";
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
// Layered on top of whichever theme is active (Settings → Themes → Wallpaper & CSS):
//   theme-wallpaper  an image (URL or data: URL) behind Shadow's own pages
//   theme-css        free-form CSS added to the shell and every internal page
const isShell = window === window.top || !!document.getElementById("tabs-container");

export async function applyCustomizations() {
  const root = document.documentElement;
  const [wallpaper, css] = await Promise.all([settings.get("theme-wallpaper"), settings.get("theme-css")]);

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
  let theme = localStorage.getItem("theme") || await settings.get("theme");
  if (RETIRED_THEMES.includes(theme)) theme = "default";
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


// Builds every theme variable from the four colors the Custom Theme pickers offer.
function genTheme({ bg, surface, accent, text }) {
  const rgb = (hex, a) => `rgba(${hexToRgb(hex)}, ${a})`;
  return {
    background: `linear-gradient(145deg, ${bg}, ${surface})`,
    homeBg: `linear-gradient(145deg, ${surface}, ${bg})`,
    primary: bg,
    primaryDark: shadeColor(bg, -40),
    secondary: surface,
    accent,
    accentLight: mixWhite(accent, 0.45),
    accentGlow: rgb(accent, 0.2),
    border: rgb(accent, 0.3),
    text,
    textMuted: rgb(text, 0.7),
    hoverDanger: '#f87171',
    activeTab: `linear-gradient(145deg, ${rgb(accent, 0.35)}, ${surface})`
  };
}

function mixWhite(hex, amount) {
  return "#" + [1, 3, 5].map((i) => {
    const c = parseInt(hex.substring(i, i + 2), 16);
    return Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0");
  }).join("");
}

const PICKERS = { bg: "customBg", surface: "customSurface", accent: "customAccent", text: "customText" };

// Start the pickers from whatever theme is showing, so a tweak begins from it.
export function fillCustomPickers() {
  const style = getComputedStyle(document.documentElement);
  const from = { bg: "--primary", surface: "--secondary", accent: "--accent", text: "--text" };
  for (const [key, id] of Object.entries(PICKERS)) {
    const value = style.getPropertyValue(from[key]).trim();
    const input = document.getElementById(id);
    if (input && /^#[0-9a-f]{6}$/i.test(value)) input.value = value;
  }
}

export async function applyCustomTheme() {
  const colors = Object.fromEntries(Object.entries(PICKERS).map(([key, id]) => [key, document.getElementById(id).value]));
  await settings.set("custom", JSON.stringify(genTheme(colors), null, 2));
  changeTheme("custom");
}
