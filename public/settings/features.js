// Settings page: browser layout toggles, wallpaper/CSS and cloud sync.
// (The older sections are wired by the inline script in index.html.)
import { SettingsManager } from "/assets/js/settings_manager.js";
import { applyCustomizations } from "/assets/js/themes.js";

const settings = new SettingsManager();
const $ = (id) => document.getElementById(id);
const shell = (() => {
  try {
    return parent !== window && parent.tabs ? parent : null;
  } catch {
    return null;
  }
})();

// ---------------------------------------------------------------- browser toggles
// The shell hears about each of these through the settings broadcast channel.

async function bindSwitch(id, key, { fallback = false, apply } = {}) {
  const input = $(id);
  const stored = await settings.get(key);
  input.checked = stored === undefined ? fallback : !!stored;
  input.addEventListener("change", async () => {
    await settings.set(key, input.checked);
    apply?.(input.checked);
  });
}

bindSwitch("verticalTabsSwitch", "vertical-tabs");
bindSwitch("bookmarksBarSwitch", "bookmarks-bar", { fallback: true });
bindSwitch("forceDarkSwitch", "force-dark");
bindSwitch("downloadsAutosaveSwitch", "downloads-autosave", { fallback: true });

// ---------------------------------------------------------------- customizer

const status = $("customizeStatus");
const flash = (text) => {
  status.textContent = text;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => (status.textContent = ""), 2500);
};
// Every frame (and the shell) re-applies on the broadcast; this frame does it directly.
const saveCustom = async (key, value) => {
  if (value === undefined || value === "") await settings.remove(key);
  else await settings.set(key, value);
  // remove() doesn't broadcast, so nudge the other frames ourselves.
  try {
    const channel = new BroadcastChannel("shadow-settings");
    channel.postMessage({ key });
    channel.close();
  } catch {}
  await applyCustomizations();
};

(async () => {
  const [wallpaper, css] = await Promise.all([settings.get("theme-wallpaper"), settings.get("theme-css")]);
  if (wallpaper && !wallpaper.startsWith("data:")) $("wallpaperUrl").value = wallpaper;
  if (css) $("customCss").value = css;
})();


$("wallpaperUrl").addEventListener("change", (e) => {
  const url = e.target.value.trim();
  if (url && !/^https?:\/\//i.test(url)) return flash("Enter an http(s) image address.");
  saveCustom("theme-wallpaper", url).then(() => flash(url ? "Wallpaper set." : "Wallpaper removed."));
});
$("wallpaperPick").addEventListener("click", () => $("wallpaperFile").click());
$("wallpaperFile").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return flash("That image is over 2 MB — pick a smaller one.");
  const reader = new FileReader();
  reader.onload = () => {
    $("wallpaperUrl").value = "";
    saveCustom("theme-wallpaper", reader.result).then(() => flash("Wallpaper set."));
  };
  reader.readAsDataURL(file);
});
$("wallpaperClear").addEventListener("click", () => {
  $("wallpaperUrl").value = "";
  saveCustom("theme-wallpaper", "").then(() => flash("Wallpaper removed."));
});
$("customCssApply").addEventListener("click", () => saveCustom("theme-css", $("customCss").value).then(() => flash("Custom CSS applied.")));

// ---------------------------------------------------------------- sync

const sync = shell?.shadowSync ?? null;
const syncStatus = $("syncStatus");

function renderSync() {
  if (!sync) {
    $("syncOff").hidden = true;
    syncStatus.textContent = "Open Settings inside Shadow to set up sync.";
    return;
  }
  $("syncOff").hidden = sync.enabled;
  $("syncOn").hidden = !sync.enabled;
  if (!sync.enabled) {
    $("syncDevicesSection").hidden = true;
    return;
  }
  $("syncCode").value = sync.displayCode;
  if (document.activeElement !== $("syncDeviceName")) $("syncDeviceName").value = sync.deviceName;
  syncStatus.textContent = sync.lastError
    ? `Sync problem: ${sync.lastError}`
    : sync.lastSync
      ? `Last synced ${new Date(sync.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
      : "Syncing…";

  const devices = sync.otherDevices();
  const box = $("syncDevices");
  box.textContent = "";
  $("syncDevicesSection").hidden = devices.length === 0;
  for (const device of devices) {
    const title = document.createElement("p");
    title.className = "section-text";
    const name = document.createElement("b");
    name.textContent = device.name;
    title.append(name, ` — ${device.tabs.length} tab${device.tabs.length === 1 ? "" : "s"}, seen ${new Date(device.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`);
    box.append(title);
    for (const tab of device.tabs) {
      const link = document.createElement("a");
      link.href = "#";
      link.className = "section-text";
      link.style.cssText = "display:block; margin: 2px 0 2px 14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color: var(--accent-light);";
      link.textContent = tab.title || tab.url;
      link.title = tab.url;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        shell.tabs.createTab(tab.url);
      });
      box.append(link);
    }
  }
}

async function attempt(button, run) {
  button.disabled = true;
  syncStatus.textContent = "Working…";
  try {
    await run();
  } catch (e) {
    syncStatus.textContent = String(e?.message ?? e);
    button.disabled = false;
    return;
  }
  button.disabled = false;
  renderSync();
}

if (sync) {
  await sync.ready;
  const stop = sync.onChange(renderSync);
  addEventListener("pagehide", stop);

  $("syncCreate").addEventListener("click", (e) => attempt(e.currentTarget, () => sync.connect()));
  $("syncJoin").addEventListener("click", (e) => attempt(e.currentTarget, () => sync.connect($("syncCodeInput").value)));
  $("syncCodeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("syncJoin").click();
  });
  $("syncCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(sync.displayCode);
      syncStatus.textContent = "Code copied.";
    } catch {
      $("syncCode").select();
      syncStatus.textContent = "Select the code and copy it.";
    }
  });
  $("syncDeviceName").addEventListener("change", (e) => sync.setDeviceName(e.target.value));
  $("syncNow").addEventListener("click", (e) => attempt(e.currentTarget, () => sync.sync({ tabs: true })));
  $("syncDisconnect").addEventListener("click", (e) => attempt(e.currentTarget, () => sync.disconnect()));
  let wipeArmed;
  $("syncWipe").addEventListener("click", (e) => {
    const button = e.currentTarget;
    if (!wipeArmed) {
      button.textContent = "Click again to delete for all devices";
      wipeArmed = setTimeout(() => {
        wipeArmed = null;
        button.textContent = "Delete synced data";
      }, 4000);
      return;
    }
    clearTimeout(wipeArmed);
    wipeArmed = null;
    button.textContent = "Delete synced data";
    attempt(button, () => sync.disconnect({ wipe: true }));
  });
}
renderSync();
