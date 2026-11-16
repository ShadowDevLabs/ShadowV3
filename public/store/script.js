// shadow://store — a storefront over the extension runtime (extension_ui.js in
// the top window). Catalog entries install from the Chrome Web Store through
// /v1/api/crx/:id (or a self-hosted package); the "Add by URL / ID" box takes
// anything the catalog doesn't list, so the whole Web Store is reachable.

const $ = (id) => document.getElementById(id);

const CATEGORY_ICON = {
  "Ad Blockers": "🛡️", Privacy: "🔒", Productivity: "⚡", Developer: "🧰",
  Appearance: "🎨", Userscripts: "📜", Passwords: "🔑", Other: "🧩",
};

let catalog = [];
let activeCategory = "All";
let query = "";

function api() {
  try {
    if (parent !== window && parent.tabs?.extensions?.available) return parent.tabs.extensions;
  } catch {}
  return null;
}

function installedIndex() {
  const ext = api();
  const map = new Map();
  if (ext) for (const e of ext.list()) { map.set(e.id, e); map.set(e.name.toLowerCase(), e); }
  return map;
}

function isInstalled(entry, idx) {
  return idx.has(entry.id) || idx.has(entry.name.toLowerCase());
}

function iconFor(entry) {
  if (entry.icon) return `<img src="${entry.icon}" alt="" onerror="this.remove()">`;
  return `<span>${CATEGORY_ICON[entry.category] || CATEGORY_ICON.Other}</span>`;
}

async function load() {
  try {
    const data = await fetch("catalog.json").then((r) => r.json());
    catalog = (data.extensions || []).filter((e) => e && e.name && (e.id || e.path));
  } catch {
    catalog = [];
  }
  renderCategories();
  render();
}

function renderCategories() {
  const cats = ["All", ...new Set(catalog.map((e) => e.category || "Other"))];
  const nav = $("categories");
  nav.innerHTML = "";
  for (const c of cats) {
    const b = document.createElement("button");
    b.className = "cat" + (c === activeCategory ? " active" : "");
    b.textContent = c;
    b.onclick = () => { activeCategory = c; renderCategories(); render(); };
    nav.appendChild(b);
  }
}

function matches(entry) {
  if (activeCategory !== "All" && (entry.category || "Other") !== activeCategory) return false;
  if (!query) return true;
  const hay = `${entry.name} ${entry.author || ""} ${entry.description || ""} ${entry.category || ""}`.toLowerCase();
  return hay.includes(query);
}

function render() {
  const ext = api();
  $("unavailable").hidden = !!ext;

  const idx = installedIndex();
  const featured = catalog.filter((e) => e.featured && matches(e));
  $("featured-section").hidden = !(featured.length && !query && activeCategory === "All");
  $("featured").innerHTML = "";
  featured.forEach((e) => $("featured").appendChild(card(e, idx)));

  const list = catalog.filter(matches);
  $("grid-title").textContent =
    activeCategory === "All" ? (query ? "Results" : "All extensions") : activeCategory;
  const grid = $("grid");
  grid.innerHTML = "";
  list.forEach((e) => grid.appendChild(card(e, idx)));
  $("empty").hidden = list.length > 0;
}

function card(entry, idx) {
  const node = $("card-tpl").content.firstElementChild.cloneNode(true);
  node.querySelector(".card-ico").innerHTML = iconFor(entry);
  node.querySelector(".card-name").textContent = entry.name;
  node.querySelector(".card-author").textContent = entry.author || "";
  node.querySelector(".card-desc").textContent = entry.description || "";
  node.querySelector(".card-cat").textContent = entry.category || "Other";

  const btn = node.querySelector(".card-btn");
  wireInstallButton(btn, entry, idx);

  const open = (e) => { if (!e.target.closest(".card-btn")) openModal(entry); };
  node.addEventListener("click", open);
  node.addEventListener("keydown", (e) => { if (e.key === "Enter") openModal(entry); });
  return node;
}

function wireInstallButton(btn, entry, idx) {
  const installed = isInstalled(entry, idx);
  btn.textContent = installed ? "Remove" : "Add";
  btn.classList.toggle("primary", !installed);
  btn.classList.toggle("danger", installed);
  btn.onclick = async (e) => {
    e.stopPropagation();
    const ext = api();
    if (!ext) return;
    btn.disabled = true;
    try {
      if (installed) {
        const found = idx.get(entry.id) || idx.get(entry.name.toLowerCase());
        if (found) await ext.remove(found.id);
      } else {
        btn.textContent = "Adding…";
        await installEntry(ext, entry);
      }
    } catch (err) {
      console.error("[store]", err);
      alert(err?.message || "Install failed.");
    } finally {
      btn.disabled = false;
      render();
    }
  };
}

async function installEntry(ext, entry) {
  if (entry.path) {
    const res = await fetch(entry.path);
    if (!res.ok) throw new Error(`Couldn't fetch package (${res.status}).`);
    return ext.install(await res.arrayBuffer(), entry.path.split("/").pop());
  }
  return ext.installFromStore(entry.id);
}

// ---- modal ----------------------------------------------------------------

function openModal(entry) {
  const idx = installedIndex();
  $("modal-ico").innerHTML = iconFor(entry);
  $("modal-name").textContent = entry.name;
  $("modal-meta").textContent = [entry.author, entry.category].filter(Boolean).join(" · ");
  $("modal-desc").textContent = entry.longDescription || entry.description || "";
  $("modal-perms").textContent = entry.id
    ? `Chrome Web Store ID: ${entry.id}`
    : "Self-hosted package";
  $("modal-status").textContent = "";

  const btn = $("modal-install");
  const refresh = () => {
    const i2 = installedIndex();
    const installed = isInstalled(entry, i2);
    btn.textContent = installed ? "Remove" : "Add to Shadow";
    btn.classList.toggle("primary", !installed);
    btn.classList.toggle("danger", installed);
    btn.onclick = async () => {
      const ext = api();
      if (!ext) return;
      btn.disabled = true;
      $("modal-status").textContent = installed ? "Removing…" : "Installing…";
      try {
        if (installed) {
          const found = i2.get(entry.id) || i2.get(entry.name.toLowerCase());
          if (found) await ext.remove(found.id);
          $("modal-status").textContent = "Removed.";
        } else {
          await installEntry(ext, entry);
          $("modal-status").textContent = "Installed — reload open tabs for it to take effect.";
        }
      } catch (err) {
        $("modal-status").textContent = err?.message || "Failed.";
      } finally {
        btn.disabled = false;
        refresh();
        render();
      }
    };
  };
  refresh();
  $("modal").hidden = false;
}

$("modal-close").onclick = () => ($("modal").hidden = true);
$("modal").onclick = (e) => { if (e.target === $("modal")) $("modal").hidden = true; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("modal").hidden = true; });

// ---- add by URL / ID ------------------------------------------------------

$("add-url").onclick = () => {
  const box = $("url-box");
  box.hidden = !box.hidden;
  if (!box.hidden) $("url-input").focus();
};
$("url-cancel").onclick = () => ($("url-box").hidden = true);
$("url-install").onclick = installFromUrl;
$("url-input").addEventListener("keydown", (e) => { if (e.key === "Enter") installFromUrl(); });

async function installFromUrl() {
  const ext = api();
  const input = $("url-input");
  if (!ext || !input.value.trim()) return;
  $("url-status").textContent = "Downloading from the Chrome Web Store…";
  try {
    await ext.installFromStore(input.value);
    $("url-status").textContent = "Installed — reload open tabs for it to take effect.";
    input.value = "";
    render();
  } catch (err) {
    $("url-status").textContent = err?.message || "Install failed.";
  }
}

// ---- search + live updates ------------------------------------------------

$("search").addEventListener("input", (e) => {
  query = e.target.value.trim().toLowerCase();
  render();
});

const ext = api();
const unsub = ext?.onChange(() => render());
window.addEventListener("pagehide", () => unsub?.());

load();
try { parent.updateOmni(); parent.setTab(); } catch {}
