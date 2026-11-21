// shadow://store — a storefront over the extension runtime (extension_ui.js in
// the top window). Catalog entries install from the Chrome Web Store through
// /v1/api/crx/:id (or a self-hosted package); the "Add by URL / ID" box takes
// anything the catalog doesn't list, so the whole Web Store is reachable.

const $ = (id) => document.getElementById(id);

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

/** The extension's logo, or its initial on an accent tile (like the page's own "S"). */
function setIcon(box, entry) {
  const letter = () => {
    const tile = document.createElement("span");
    tile.className = "letter";
    tile.textContent = ((entry.name || "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
    return tile;
  };
  // Built as nodes: the icon URL comes from the scraped store page.
  if (!entry.icon) return box.replaceChildren(letter());
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.onerror = () => img.replaceWith(letter());
  img.src = entry.icon;
  box.replaceChildren(img);
}

// --- live sync with the Chrome Web Store -----------------------------------
// Each catalog entry is enriched with the real name/icon/description from the
// store (server-cached at /v1/api/ext-meta/:id). Cards show catalog data
// instantly and upgrade in place as metadata arrives, lazily per visible card.
const metaCache = new Map();
async function fetchMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const ssKey = `extmeta:${id}`;
  try {
    const cached = sessionStorage.getItem(ssKey);
    if (cached) { const d = JSON.parse(cached); metaCache.set(id, d); return d; }
  } catch {}
  const promise = fetch(`/v1/api/ext-meta/${id}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d) { try { sessionStorage.setItem(ssKey, JSON.stringify(d)); } catch {} }
      return d;
    })
    .catch(() => null);
  metaCache.set(id, promise);
  const data = await promise;
  metaCache.set(id, data);
  return data;
}

function applyMeta(entry, meta) {
  if (!meta) return;
  if (meta.name) entry.name = meta.name;
  if (meta.icon) entry.icon = meta.icon;
  if (meta.description) entry.description = meta.description;
}

// Fetch (cached by id) and apply live data. The same catalog object can back
// several cards (featured + grid), so each card updates itself — the flag only
// gates the network call, not the per-card DOM update.
async function enrich(entry) {
  if (!entry.id) return null;
  const meta = await fetchMeta(entry.id);
  applyMeta(entry, meta);
  entry._enriched = true;
  return meta;
}

const enrichObserver = new IntersectionObserver((entries, obs) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    obs.unobserve(e.target);
    const entry = e.target.__entry;
    if (entry) enrich(entry).then((m) => { if (m) updateCard(e.target, entry); });
  }
}, { rootMargin: "200px" });

function updateCard(node, entry) {
  const idx = installedIndex();
  setIcon(node.querySelector(".card-ico"), entry);
  node.querySelector(".card-name").textContent = entry.name;
  node.querySelector(".card-desc").textContent = entry.description || "";
  wireInstallButton(node.querySelector(".card-btn"), entry, idx);
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

  // Featured extensions aren't listed a second time while the Featured row shows.
  const showingFeatured = !$("featured-section").hidden;
  const list = catalog.filter((e) => matches(e) && !(showingFeatured && e.featured));
  $("grid-title").textContent =
    activeCategory === "All" ? (query ? "Results" : showingFeatured ? "More extensions" : "All extensions") : activeCategory;
  $("count").textContent = `${list.length} extension${list.length === 1 ? "" : "s"}`;
  const grid = $("grid");
  grid.innerHTML = "";
  list.forEach((e) => grid.appendChild(card(e, idx)));
  $("empty").hidden = list.length > 0;
}

function card(entry, idx) {
  const node = $("card-tpl").content.firstElementChild.cloneNode(true);
  setIcon(node.querySelector(".card-ico"), entry);
  node.querySelector(".card-name").textContent = entry.name;
  node.querySelector(".card-author").textContent = entry.author || "";
  node.querySelector(".card-desc").textContent = entry.description || "";
  node.querySelector(".card-cat").textContent = entry.category || "Other";

  const btn = node.querySelector(".card-btn");
  wireInstallButton(btn, entry, idx);

  const open = (e) => { if (!e.target.closest(".card-btn")) openModal(entry); };
  node.addEventListener("click", open);
  node.addEventListener("keydown", (e) => { if (e.key === "Enter") openModal(entry); });

  node.__entry = entry;
  if (entry.id) {
    if (entry._enriched) updateCard(node, entry); // data already fetched for a sibling card
    else enrichObserver.observe(node);
  }
  return node;
}

function wireInstallButton(btn, entry, idx) {
  const installed = isInstalled(entry, idx);
  // Installed: a quiet "Installed" that turns into "Remove" on hover.
  btn.textContent = installed ? "Installed" : "Add";
  btn.classList.toggle("primary", !installed);
  btn.classList.toggle("installed", installed);
  btn.onmouseenter = () => { if (installed && !btn.disabled) btn.textContent = "Remove"; };
  btn.onmouseleave = () => { if (installed && !btn.disabled) btn.textContent = "Installed"; };
  btn.onclick = async (e) => {
    e.stopPropagation();
    const ext = api();
    if (!ext) return;
    btn.disabled = true;
    try {
      if (installed) {
        btn.textContent = "Removing…";
        const found = idx.get(entry.id) || idx.get(entry.name.toLowerCase());
        if (found) await ext.remove(found.id);
      } else {
        btn.textContent = "Adding…";
        await installEntry(ext, entry);
      }
    } catch (err) {
      // Shown in the details window: alert() would freeze every tab.
      console.error("[store]", err);
      openModal(entry);
      $("modal-status").textContent = err?.message || "Install failed.";
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

function fillModal(entry) {
  setIcon($("modal-ico"), entry);
  $("modal-name").textContent = entry.name;
  $("modal-meta").textContent = [entry.author, entry.category].filter(Boolean).join(" · ");
  $("modal-desc").textContent = entry.longDescription || entry.description || "";
}

function openModal(entry) {
  const idx = installedIndex();
  fillModal(entry);
  // Pull live store data (cached) and refresh the modal in place.
  if (entry.id) enrich(entry).then((m) => { if (m && !$("modal").hidden) fillModal(entry); });
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
  $("add-url").classList.toggle("active", !box.hidden);
  if (!box.hidden) $("url-input").focus();
};
$("url-cancel").onclick = () => {
  $("url-box").hidden = true;
  $("add-url").classList.remove("active");
};
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

let searchTimer;
$("search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = e.target.value.trim().toLowerCase();
    render();
  }, 120);
});

const ext = api();
const unsub = ext?.onChange(() => render());
window.addEventListener("pagehide", () => unsub?.());

load();
try { parent.updateOmni(); parent.setTab(); } catch {}
