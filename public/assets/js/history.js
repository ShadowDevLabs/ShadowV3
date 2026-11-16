// shadow://history — search, day grouping (optionally folded by site) and
// per-entry delete. Entries are {url, time, title, icon}, newest first.
import { HistoryHelper } from "/assets/js/history_helper.js";
import { SettingsManager } from "/assets/js/settings_manager.js";

const helper = new HistoryHelper();
const settings = new SettingsManager();
window.history_helper = helper;
window.settings = settings;

const PAGE = 300;
const list = document.getElementById("historyEntries");
const status = document.getElementById("status");
const search = document.getElementById("searchBar");
const groupToggle = document.getElementById("groupBySite");
const showMore = document.getElementById("showMore");
const clearButton = document.getElementById("deleteBtn");

let entries = [];
let limit = PAGE;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function dayLabel(time) {
  const date = new Date(time);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const prefix = date.toDateString() === today.toDateString() ? "Today - " : date.toDateString() === yesterday.toDateString() ? "Yesterday - " : "";
  return prefix + date.toLocaleDateString("default", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

const open = (url, e) => {
  try {
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) parent.tabs.createTab(url);
    else parent.tabs.load(url);
  } catch {
    location.href = url;
  }
};

function itemRow(entry) {
  const row = el("div", "history-item");
  row.title = entry.url;
  const info = el("div", "history-info");
  const icon = el("img", "favicon");
  icon.alt = "";
  icon.loading = "lazy";
  icon.src = entry.icon || "/assets/imgs/icons/logo.png";
  icon.addEventListener("error", () => (icon.style.visibility = "hidden"), { once: true });
  const text = el("div");
  text.append(el("div", "history-title", entry.title || entry.url), el("div", "history-time", `${new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${hostOf(entry.url)}`));
  info.append(icon, text);
  const remove = el("button", "history-remove", "✕");
  remove.title = "Remove from history";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    removeEntries((other) => other === entry);
  });
  row.append(info, remove);
  row.addEventListener("click", (e) => open(entry.url, e));
  return row;
}

function render() {
  const query = search.value.trim().toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  const matches = words.length
    ? entries.filter((entry) => {
        const hay = `${entry.title ?? ""} ${entry.url}`.toLowerCase();
        return words.every((word) => hay.includes(word));
      })
    : entries;
  const shown = matches.slice(0, limit);
  list.textContent = "";

  // Entries are newest first, so days come out in order.
  const days = new Map();
  for (const entry of shown) {
    const key = new Date(entry.time).toDateString();
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(entry);
  }

  for (const [key, items] of days) {
    const section = el("div", "day-section");
    const heading = el("h2", "", dayLabel(items[0].time));
    const removeDay = el("button", "history-remove day", "Delete day");
    removeDay.addEventListener("click", () => removeEntries((entry) => new Date(entry.time).toDateString() === key));
    heading.append(removeDay);
    const box = el("div", "history-list");

    if (groupToggle.checked) {
      const sites = new Map();
      for (const entry of items) {
        const host = hostOf(entry.url);
        if (!sites.has(host)) sites.set(host, []);
        sites.get(host).push(entry);
      }
      for (const [host, visits] of sites) {
        if (visits.length === 1) {
          box.append(itemRow(visits[0]));
          continue;
        }
        const group = el("details", "history-group");
        group.open = !!query; // a search shows what matched
        const summary = el("summary", "history-item");
        const info = el("div", "history-info");
        const icon = el("img", "favicon");
        icon.alt = "";
        icon.src = visits[0].icon || "/assets/imgs/icons/logo.png";
        icon.addEventListener("error", () => (icon.style.visibility = "hidden"), { once: true });
        const text = el("div");
        text.append(el("div", "history-title", host), el("div", "history-time", `${visits.length} pages`));
        info.append(icon, text);
        summary.append(info);
        group.append(summary, ...visits.map(itemRow));
        box.append(group);
      }
    } else {
      box.append(...items.map(itemRow));
    }
    section.append(heading, box);
    list.append(section);
  }

  showMore.hidden = matches.length <= limit;
  if (entries.length === 0) status.textContent = emptyText;
  else if (query) status.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"} for “${search.value.trim()}”`;
  else status.textContent = `${entries.length} page${entries.length === 1 ? "" : "s"}`;
}

async function removeEntries(predicate) {
  entries = entries.filter((entry) => !predicate(entry));
  await helper.set(entries);
  render();
}

let emptyText = "";
let confirming;
clearButton.addEventListener("click", async () => {
  // Two clicks instead of a blocking confirm() dialog.
  if (!confirming) {
    clearButton.textContent = "Click again to clear everything";
    confirming = setTimeout(() => {
      confirming = null;
      clearButton.textContent = "Clear History";
    }, 3000);
    return;
  }
  clearTimeout(confirming);
  confirming = null;
  clearButton.textContent = "Clear History";
  entries = [];
  await helper.set([]);
  render();
});

let timer;
search.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    limit = PAGE;
    render();
  }, 120);
});
groupToggle.addEventListener("change", () => {
  settings.set("history-group-by-site", groupToggle.checked);
  render();
});
showMore.addEventListener("click", () => {
  limit += PAGE;
  render();
});

(async () => {
  const [stored, enabled, grouped] = await Promise.all([helper.get(), settings.get("history"), settings.get("history-group-by-site")]);
  entries = Array.isArray(stored) ? stored.filter((entry) => entry && typeof entry.url === "string") : [];
  emptyText = enabled ? "Nothing here yet — pages you visit will show up here." : "History is turned off. Turn it on in Settings to start keeping it.";
  groupToggle.checked = !!grouped;
  render();
})();
