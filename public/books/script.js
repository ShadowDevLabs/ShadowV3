import { SettingsManager } from "../assets/js/settings_manager.js";

const BASE_PATH = '/books/files/k12learning/';
const FAV_KEY = 'arcade_favorites';

const settings = new SettingsManager();

let allGames     = [];
let visible      = [];
let activeFilter = 'all';
let searchQuery  = '';
let favorites    = new Set();

async function loadFavorites() {
  const stored = await settings.get(FAV_KEY);
  favorites = new Set(Array.isArray(stored) ? stored : []);
}

async function saveFavorites() {
  await settings.set(FAV_KEY, [...favorites]);
}

// Games shipped with Shadow itself (public/arcade/): playable with no connection.
function isBundled(game) {
  return typeof game.url === 'string' && game.url.startsWith('/arcade/');
}

function isHot(game) {
  return (game.categories || []).some(c => c.toLowerCase() === 'hot');
}

// Submodule games are relative to BASE_PATH; bundled originals and external
// games give an absolute path (/arcade/…) or full URL, used as-is.
function resolveAsset(u) {
  return !u ? '' : /^(https?:)?\/\//i.test(u) || u.startsWith('/') ? u : BASE_PATH + u;
}

function openGameTab(game) {
  const gameUrl = resolveAsset(game.url);
  const iconUrl = resolveAsset(game.imageUrl);
  // /pages/embed/ wraps the game in a chromeless iframe and syncs the tab's
  // title/favicon. Site-absolute so it resolves the same from any Shadow page.
  const embedUrl = `/pages/embed/?url=${encodeURIComponent(gameUrl)}&title=${encodeURIComponent(game.label || '')}&icon=${encodeURIComponent(iconUrl)}&src=books`;

  try {
    const tabsApi = window.parent?.tabs;
    if (!tabsApi) { window.open(gameUrl, '_blank'); return; }
    tabsApi.createTab(embedUrl, game.label || undefined);
  } catch {
    window.open(gameUrl, '_blank');
  }
}

const HEART_FILLED = `<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/></svg>`;
const HEART_EMPTY  = `<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"/></svg>`;

function buildCard(game) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = '#';
  a.dataset.gameLabel = game.label;
  a.addEventListener('click', e => {
    e.preventDefault();
    openGameTab(game);
  });

  const ph = document.createElement('div');
  ph.className = 'card-ph';
  ph.textContent = (game.label || '??').slice(0, 2).toUpperCase();
  a.appendChild(ph);

  if (game.imageUrl) {
    const img = document.createElement('img');
    img.src = resolveAsset(game.imageUrl);
    img.alt = game.label;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onload = () => {
      if (!img.isConnected) return;
      img.classList.add('loaded');
      img.previousElementSibling?.classList.add('hidden');
    };
    img.onerror = () => {
      if (!img.isConnected) return;
      img.remove();
    };
    a.appendChild(img);
  }

  if (isHot(game)) {
    const badge = document.createElement('div');
    badge.className = 'badge-hot';
    badge.innerHTML = `<span class="badge-hot-flame">🔥</span><span class="badge-hot-text">HOT</span>`;
    a.appendChild(badge);
  }

  const isFav = favorites.has(game.label);
  const favBtn = document.createElement('button');
  favBtn.className = 'fav-btn' + (isFav ? ' active' : '');
  favBtn.innerHTML = isFav ? HEART_FILLED : HEART_EMPTY;
  favBtn.title = 'Favorite';
  favBtn.addEventListener('click', async e => {
    e.preventDefault();
    e.stopPropagation();
    if (favorites.has(game.label)) {
      favorites.delete(game.label);
      favBtn.classList.remove('active');
      favBtn.innerHTML = HEART_EMPTY;
    } else {
      favorites.add(game.label);
      favBtn.classList.add('active');
      favBtn.innerHTML = HEART_FILLED;
    }
    await saveFavorites();
    if (activeFilter === 'favorites') applyFilters();
  });
  a.appendChild(favBtn);

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  overlay.innerHTML =
    '<div class="card-play"><svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z"/></svg></div>' +
    `<div class="card-name">${game.label}</div>`;

  const cats = (game.categories || []).filter(c => c.toLowerCase() !== 'hot');
  if (cats.length) {
    const ct = document.createElement('div');
    ct.className = 'card-cats';
    ct.textContent = cats.slice(0, 2).join(' · ');
    overlay.appendChild(ct);
  }

  a.appendChild(overlay);
  return a;
}

// Windowed rendering: with ~900 games, building every card up front is the main
// jank source on weak hardware. Render in batches and grow as the user scrolls
// (a sentinel near the bottom pulls the next batch in).
const BATCH = 60;
let rendered = 0;
let sentinel = null;
let io = null;

function renderMore() {
  const grid = document.getElementById('grid');
  if (rendered >= visible.length) return;
  const frag = document.createDocumentFragment();
  const end = Math.min(rendered + BATCH, visible.length);
  for (let i = rendered; i < end; i++) frag.appendChild(buildCard(visible[i]));
  rendered = end;
  grid.insertBefore(frag, sentinel);
  // Re-arm: if the sentinel is still on screen, this fires again and keeps
  // filling until the viewport is covered or every game is rendered.
  if (rendered < visible.length) { io.unobserve(sentinel); io.observe(sentinel); }
}

function renderVisible() {
  const grid = document.getElementById('grid');
  grid.querySelectorAll('.card').forEach(c => c.remove());
  rendered = 0;
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.className = 'grid-sentinel';
    io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) renderMore();
    }, { rootMargin: '800px' });
  }
  grid.appendChild(sentinel); // keep it last
  io.observe(sentinel);
  renderMore();

  let emptyMsg = grid.querySelector('.empty');
  if (visible.length === 0) {
    if (!emptyMsg) {
      emptyMsg = document.createElement('div');
      emptyMsg.className = 'empty';
      emptyMsg.innerHTML = '<strong>NO RESULTS</strong>Try a different search or filter';
      grid.appendChild(emptyMsg);
    }
    emptyMsg.style.display = '';
  } else if (emptyMsg) {
    emptyMsg.style.display = 'none';
  }
}

function applyFilters() {
  const q = searchQuery.toLowerCase();

  // Without a connection only the bundled games can run (the service worker
  // keeps them cached), so the rest are hidden until the network is back.
  const offline = !navigator.onLine;
  const notice = document.getElementById('offlineNotice');
  if (notice) notice.hidden = !offline;

  let filtered = allGames.filter(g => {
    if (offline && !isBundled(g)) return false;
    const searchOk = !q || g.label.toLowerCase().includes(q);
    if (activeFilter === 'favorites') return favorites.has(g.label) && searchOk;
    const catOk = activeFilter === 'all' ||
      (g.categories || []).some(c => c.toLowerCase() === activeFilter);
    return catOk && searchOk;
  });

  if (activeFilter !== 'favorites' && !q) {
    const hot  = filtered.filter(g => isHot(g));
    const rest = filtered.filter(g => !isHot(g));
    visible = [...hot, ...rest];
  } else {
    visible = filtered;
  }

  document.getElementById('countDisplay').textContent =
    `${visible.length} game${visible.length !== 1 ? 's' : ''}`;

  renderVisible();
}

function buildFilters(games) {
  const set = new Set();
  games.forEach(g => (g.categories || []).forEach(c => {
    if (c.toLowerCase() !== 'hot') set.add(c.toLowerCase());
  }));
  const cats = ['all', 'favorites', ...Array.from(set).sort()];
  const container = document.getElementById('filters');
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className   = 'pill' + (cat === 'all' ? ' active' : '');
    if (cat === 'favorites') {
      btn.innerHTML = `<span class="pill-heart">${HEART_FILLED}</span> Favorites`;
    } else {
      btn.textContent = cat === 'all' ? 'All' : cat;
    }
    btn.dataset.cat = cat;
    btn.addEventListener('click', () => {
      activeFilter = cat;
      container.querySelectorAll('.pill').forEach(p =>
        p.classList.toggle('active', p.dataset.cat === cat));
      applyFilters();
    });
    container.appendChild(btn);
  });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function init() {
  await loadFavorites();
  try {
    const data = await fetch('learningcourses.json').then(r => r.json());
    allGames = data.games.filter(g => g.label !== 'Request Games');
    document.getElementById('loading').style.display = 'none';
    document.getElementById('grid').style.display = 'grid';
    buildFilters(allGames);
    visible = allGames;
    applyFilters();
    document.getElementById('searchInput').addEventListener('input',
      debounce(e => { searchQuery = e.target.value; applyFilters(); }, 150));
    window.addEventListener('online', applyFilters);
    window.addEventListener('offline', applyFilters);
  } catch {
    document.getElementById('loading').innerHTML =
      '<div class="empty"><strong>ERROR</strong>Could not load learningcourses.json</div>';
  }
}

init();