// New tab page: the search box and the speed dial (customizable shortcuts).
// Shortcuts are [{name, url, icon?}] under the "shortcuts" setting; they can be
// added, edited, deleted and dragged into a different order.
const maxShortcuts = 24;
const shortcutsContainer = document.querySelector(".shortcuts");
const addShortcutButton = document.querySelector(".shortcut.add");
const modal = document.getElementById("modal");
const editModal = document.getElementById("edit-shortcut-modal");
const contextMenu = document.getElementById("shortcut-context-menu");
const shortcutForm = document.getElementById("shortcut-form");
const $ = (id) => document.getElementById(id);

const defaultShortcuts = [
  { name: "Google", url: "https://www.google.com" },
  { name: "TikTok", url: "https://www.tiktok.com" },
  { name: "Discord", url: "https://discord.com/app" },
  { name: "Spotify", url: "https://open.spotify.com" },
  { name: "Animetsu", url: "https://animetsu.site" },
  { name: "Instagram", url: "https://www.instagram.com" },
  { name: "Invidious", url: "https://invidious.tiekoetter.com" },
];
// The previous defaults stopped working; anyone who still has exactly those gets the new set.
const retiredDefaults = new Set([
  "https://astra.pxi-fusion.com/embed/shadow/roblox",
  "https://astra.pxi-fusion.com/embed/shadow/clash-royale",
  "https://astra.pxi-fusion.com/embed/shadow/fortnite",
  "https://astra.pxi-fusion.com/embed/shadow/brawl-stars",
  "shadow://books",
]);

let shortcuts = [];
let selectedIndex = -1;
let dragIndex = -1;

function iconFor(shortcut) {
  if (shortcut.icon) return shortcut.icon;
  let host = shortcut.url;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(shortcut.url) ? shortcut.url : `https://${shortcut.url}`).hostname;
  } catch {}
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

const save = () => settings.set("shortcuts", shortcuts);

function open(url, event) {
  try {
    if (event?.shiftKey || event?.ctrlKey || event?.metaKey) parent.createTab(url);
    else parent.load(url);
  } catch {
    location.href = `/?url=${encodeURIComponent(url)}`;
  }
}

function render() {
  shortcutsContainer.querySelectorAll(".shortcut:not(.add)").forEach((el) => el.remove());
  shortcuts.slice(0, maxShortcuts).forEach((shortcut, index) => {
    const el = document.createElement("a");
    el.className = "shortcut";
    el.draggable = true;
    el.title = shortcut.url;
    el.dataset.url = shortcut.url;
    el.dataset.index = String(index);
    const img = document.createElement("img");
    img.src = iconFor(shortcut);
    img.alt = "";
    img.draggable = false;
    img.addEventListener("error", () => (img.src = "assets/imgs/icons/logo.png"), { once: true });
    const label = document.createElement("p");
    label.textContent = shortcut.name;
    el.append(img, label);

    el.addEventListener("click", (e) => {
      e.preventDefault();
      open(shortcut.url, e);
    });
    // Hovering is a good hint the site is about to be opened: warm the connection.
    el.addEventListener("mouseenter", () => {
      try {
        parent.tabs?.prewarm?.(shortcut.url);
      } catch {}
    });
    el.addEventListener("dragstart", (e) => {
      dragIndex = index;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", shortcut.url);
      el.style.opacity = "0.5";
    });
    el.addEventListener("dragend", () => {
      dragIndex = -1;
      el.style.opacity = "";
    });
    el.addEventListener("dragover", (e) => {
      if (dragIndex !== -1) e.preventDefault();
    });
    el.addEventListener("drop", (e) => {
      if (dragIndex === -1 || dragIndex === index) return;
      e.preventDefault();
      const [moved] = shortcuts.splice(dragIndex, 1);
      shortcuts.splice(index, 0, moved);
      dragIndex = -1;
      save();
      render();
    });
    shortcutsContainer.insertBefore(el, addShortcutButton);
  });
  addShortcutButton.style.display = shortcuts.length >= maxShortcuts ? "none" : "";
}

async function loadShortcuts() {
  const stored = await settings.get("shortcuts");
  const valid = Array.isArray(stored) ? stored.filter((s) => s && s.url) : [];
  if (valid.length && !valid.every((s) => retiredDefaults.has(s.url))) {
    shortcuts = valid;
  } else {
    shortcuts = defaultShortcuts.map((s) => ({ ...s }));
    await save();
  }
  render();
}

// ---- add

addShortcutButton.addEventListener("click", (e) => {
  e.preventDefault();
  modal.style.display = "block";
  $("shortcut-name").focus();
});
document.querySelector(".close").addEventListener("click", () => (modal.style.display = "none"));

function addShortcutClicked() {
  const name = $("shortcut-name").value.trim();
  const url = $("shortcut-url").value.trim();
  const icon = $("shortcut-icon")?.value.trim();
  if (!url || shortcuts.length >= maxShortcuts) return;
  shortcuts.push({ name: name || url, url, ...(icon ? { icon } : {}) });
  save();
  render();
  modal.style.display = "none";
  shortcutForm.reset();
}
$("add-shortcut").addEventListener("click", addShortcutClicked);
shortcutForm.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addShortcutClicked();
  }
});

// ---- context menu: open / edit / delete

shortcutsContainer.addEventListener("contextmenu", (event) => {
  const shortcut = event.target.closest(".shortcut");
  if (!shortcut || shortcut === addShortcutButton) return;
  event.preventDefault();
  selectedIndex = Number(shortcut.dataset.index);
  contextMenu.style.left = `${event.pageX}px`;
  contextMenu.style.top = `${event.pageY}px`;
  contextMenu.style.display = "block";
});
document.addEventListener("click", () => (contextMenu.style.display = "none"));

$("newtab-context-menu-option")?.addEventListener("click", () => {
  const shortcut = shortcuts[selectedIndex];
  if (!shortcut) return;
  try {
    parent.createTab(shortcut.url);
  } catch {}
});

$("edit-context-menu-option").addEventListener("click", () => {
  const shortcut = shortcuts[selectedIndex];
  if (!shortcut) return;
  $("edit-shortcut-name").value = shortcut.name;
  $("edit-shortcut-url").value = shortcut.url;
  if ($("edit-shortcut-icon")) $("edit-shortcut-icon").value = shortcut.icon ?? "";
  editModal.style.display = "block";
  $("edit-shortcut-name").focus();
});

function edited() {
  const shortcut = shortcuts[selectedIndex];
  const url = $("edit-shortcut-url").value.trim();
  if (!shortcut || !url) return;
  const icon = $("edit-shortcut-icon")?.value.trim();
  shortcuts[selectedIndex] = { name: $("edit-shortcut-name").value.trim() || url, url, ...(icon ? { icon } : {}) };
  save();
  render();
  editModal.style.display = "none";
}
$("edit-shortcut").addEventListener("click", edited);
$("edit-shortcut-form").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    edited();
  }
});
$("closeedit").addEventListener("click", () => (editModal.style.display = "none"));

$("delete-context-menu-option").addEventListener("click", () => {
  if (!shortcuts[selectedIndex]) return;
  shortcuts.splice(selectedIndex, 1);
  save();
  render();
});

window.addEventListener("click", (event) => {
  if (event.target === modal) modal.style.display = "none";
  if (event.target === editModal) editModal.style.display = "none";
});

// ---- search box

const address = $("uv-address");
$("uv-form").addEventListener("submit", (e) => {
  e.preventDefault();
  open(address.value);
});
// Typing here means a site is about to load: let the shell start the proxy now.
address.addEventListener(
  "focus",
  () => {
    try {
      parent.tabs?.ensureProxy?.().catch(() => {});
    } catch {}
  },
  { once: true },
);

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadShortcuts);
else loadShortcuts();
