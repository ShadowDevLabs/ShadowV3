// Command palette (Alt+K) and find-in-page (Alt+F) for the browser shell.
// tabs.js owns the Tab instance and wires the shortcuts; this module owns the UI.

// ----------------------------------------------------------------- fuzzy match
// Subsequence scorer: every char of `q` must appear in order in `text`.
// Rewards contiguous runs and word-boundary hits so "set" ranks Settings high.
function fuzzy(q, text) {
  if (!q) return 0;
  q = q.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0, score = 0, run = 0, prev = -1;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      run = prev === i - 1 ? run + 1 : 1;
      score += run * 3;
      if (i === 0 || /[\s/._-]/.test(t[i - 1])) score += 6; // word boundary
      prev = i;
      qi++;
    }
  }
  return qi === q.length ? score - text.length * 0.02 : -1;
}

// ----------------------------------------------------------------- palette
let paletteEl, paletteInput, paletteList, paletteItems = [], paletteActive = 0, paletteOpen = false;

function buildPalette() {
  paletteEl = document.createElement("div");
  paletteEl.id = "cmd-palette";
  paletteEl.innerHTML =
    '<div class="cmd-box"><input id="cmd-input" placeholder="Type a command, tab, or URL…" autocomplete="off" spellcheck="false"><div id="cmd-list"></div></div>';
  document.body.appendChild(paletteEl);
  paletteInput = paletteEl.querySelector("#cmd-input");
  paletteList = paletteEl.querySelector("#cmd-list");
  paletteEl.addEventListener("mousedown", (e) => { if (e.target === paletteEl) closePalette(); });
  paletteInput.addEventListener("input", renderPalette);
  paletteInput.addEventListener("keydown", paletteKey);
}

function actionsFor(tabs) {
  const t = tabs.tabsArr[tabs.activeTabIndex];
  const a = [
    { label: "New tab", hint: "Alt+T", run: () => tabs.createTab() },
    { label: "Reopen closed tab", hint: "Alt+Shift+T", run: () => tabs.reopenClosedTab() },
    { label: "Close tab", hint: "Alt+W", run: () => tabs.closeTab() },
    { label: "Duplicate tab", hint: "Alt+D", run: () => tabs.duplicateTab() },
    { label: (t && t.pinned ? "Unpin tab" : "Pin tab"), hint: "Alt+P", run: () => tabs.setPinned(tabs.activeTabIndex, !t?.pinned) },
    { label: "Reload", hint: "Alt+R", run: () => tabs.refresh() },
    { label: "Find in page", hint: "Alt+F", run: () => openFind(tabs) },
    { label: "Immersive mode", hint: "Alt+Enter", run: () => tabs.toggleImmersive() },
    { label: "Zoom in", hint: "Alt +", run: () => tabs.setZoom(tabs.activeTabIndex, "in") },
    { label: "Zoom out", hint: "Alt −", run: () => tabs.setZoom(tabs.activeTabIndex, "out") },
    { label: "Reset zoom", hint: "Alt 0", run: () => tabs.setZoom(tabs.activeTabIndex, "reset") },
    { label: "Open devtools", run: () => tabs.toggleDevTools() },
    { label: "Settings", run: () => tabs.createTab("shadow://settings") },
    { label: "Extensions", run: () => tabs.createTab("shadow://extensions") },
    { label: "Games", run: () => tabs.createTab("shadow://books") },
    { label: "History", run: () => tabs.createTab("shadow://history") },
    { label: "Home", run: () => tabs.createTab("shadow://home") },
  ];
  // Open tabs, so the palette doubles as a tab switcher.
  tabs.tabsArr.forEach((tab, i) => {
    if (i === tabs.activeTabIndex) return;
    a.push({ label: tabs.titleFor(tab), kind: "Tab", icon: tab.img.src, run: () => tabs.switchTab(i) });
  });
  return a;
}

function renderPalette() {
  const tabs = window.tabs;
  const q = paletteInput.value.trim();
  let items = actionsFor(tabs).map((it) => ({ it, score: q ? fuzzy(q, it.label) : 0 }));
  if (q) items = items.filter((x) => x.score >= 0).sort((a, b) => b.score - a.score);
  paletteItems = items.map((x) => x.it);

  // A query that isn't a clear command becomes a quick open/search at the top.
  if (q && (/\s|\.|:/.test(q) || paletteItems.length === 0)) {
    paletteItems.unshift({ label: `Open “${q}”`, kind: "Go", run: () => tabs.createTab(q) });
  }
  paletteItems = paletteItems.slice(0, 50);
  paletteActive = 0;

  paletteList.innerHTML = "";
  paletteItems.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "cmd-item" + (i === paletteActive ? " active" : "");
    row.innerHTML =
      (it.icon ? `<img src="${it.icon}" onerror="this.remove()">` : `<span class="cmd-dot"></span>`) +
      `<span class="cmd-label"></span>` +
      (it.kind ? `<span class="cmd-kind">${it.kind}</span>` : "") +
      (it.hint ? `<span class="cmd-hint">${it.hint}</span>` : "");
    row.querySelector(".cmd-label").textContent = it.label;
    row.addEventListener("mousedown", (e) => { e.preventDefault(); runPalette(i); });
    row.addEventListener("mousemove", () => setActive(i));
    paletteList.appendChild(row);
  });
}

function setActive(i) {
  paletteActive = i;
  [...paletteList.children].forEach((el, n) => el.classList.toggle("active", n === i));
  paletteList.children[i]?.scrollIntoView({ block: "nearest" });
}

function paletteKey(e) {
  if (e.key === "Escape") { e.preventDefault(); return closePalette(); }
  if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(paletteActive + 1, paletteItems.length - 1)); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(paletteActive - 1, 0)); }
  else if (e.key === "Enter") { e.preventDefault(); runPalette(paletteActive); }
}

function runPalette(i) {
  const it = paletteItems[i];
  closePalette();
  try { it?.run(); } catch (err) { console.error("[palette]", err); }
}

export function openCommandPalette(tabs) {
  window.tabs = tabs;
  if (!paletteEl) buildPalette();
  if (paletteOpen) return closePalette();
  paletteOpen = true;
  paletteEl.classList.add("open");
  paletteInput.value = "";
  renderPalette();
  paletteInput.focus();
}

function closePalette() {
  paletteOpen = false;
  paletteEl?.classList.remove("open");
}

// ----------------------------------------------------------------- find in page
let findEl, findInput, findCount, findState = null;

function activeDoc(tabs) {
  const tab = tabs.tabsArr[tabs.activeTabIndex];
  try { return { doc: tab.iframe.contentDocument, win: tab.iframe.contentWindow }; } catch { return null; }
}

function buildFind() {
  findEl = document.createElement("div");
  findEl.id = "find-bar";
  findEl.innerHTML =
    '<input id="find-input" placeholder="Find in page" autocomplete="off" spellcheck="false">' +
    '<span id="find-count">0/0</span>' +
    '<button id="find-prev" title="Previous (Shift+Enter)">▲</button>' +
    '<button id="find-next" title="Next (Enter)">▼</button>' +
    '<button id="find-close" title="Close (Esc)">✕</button>';
  document.body.appendChild(findEl);
  findInput = findEl.querySelector("#find-input");
  findCount = findEl.querySelector("#find-count");
  findInput.addEventListener("input", () => search(findInput.value));
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  findEl.querySelector("#find-next").addEventListener("click", () => step(1));
  findEl.querySelector("#find-prev").addEventListener("click", () => step(-1));
  findEl.querySelector("#find-close").addEventListener("click", closeFind);
}

function clearMarks() {
  if (!findState) return;
  for (const m of findState.marks) {
    const parent = m.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  }
  findState.marks = [];
}

function search(query) {
  const ctx = activeDoc(window.tabs);
  if (!ctx || !ctx.doc) return;
  clearMarks();
  findState = { doc: ctx.doc, marks: [], current: -1 };
  query = query.trim();
  if (!query) { findCount.textContent = "0/0"; return; }

  const needle = query.toLowerCase();
  const walker = ctx.doc.createTreeWalker(ctx.doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = node.parentNode?.nodeName;
      if (p === "SCRIPT" || p === "STYLE" || p === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
      return node.nodeValue.toLowerCase().includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const targets = [];
  let n;
  while ((n = walker.nextNode()) && targets.length < 2000) targets.push(n);

  for (const node of targets) {
    const text = node.nodeValue;
    const frag = ctx.doc.createDocumentFragment();
    let i = 0, idx;
    const lower = text.toLowerCase();
    while ((idx = lower.indexOf(needle, i)) !== -1) {
      if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
      const mark = ctx.doc.createElement("mark");
      mark.className = "__shadow-find";
      mark.textContent = text.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      findState.marks.push(mark);
      i = idx + needle.length;
      if (findState.marks.length >= 2000) break;
    }
    if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
    node.parentNode.replaceChild(frag, node);
  }
  if (findState.marks.length) step(1);
  else findCount.textContent = "0/0";
}

function step(dir) {
  if (!findState || !findState.marks.length) return;
  if (findState.current >= 0) findState.marks[findState.current]?.classList.remove("current");
  findState.current = (findState.current + dir + findState.marks.length) % findState.marks.length;
  const mark = findState.marks[findState.current];
  mark.classList.add("current");
  mark.scrollIntoView({ block: "center", behavior: "smooth" });
  findCount.textContent = `${findState.current + 1}/${findState.marks.length}`;
}

export function openFind(tabs) {
  window.tabs = tabs;
  if (!findEl) buildFind();
  findEl.classList.add("open");
  findInput.focus();
  findInput.select();
  if (findInput.value) search(findInput.value);
}

export function closeFind() {
  clearMarks();
  findState = null;
  findEl?.classList.remove("open");
}

// Called by tabs.js when the active page navigates, so stale marks don't linger.
export function resetFind() {
  if (findState) { findState.marks = []; findState = null; }
  if (findEl?.classList.contains("open")) findEl.classList.remove("open");
}
