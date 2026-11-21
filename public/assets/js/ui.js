// Small shared UI pieces for the browser shell: one floating menu and toasts.

let toastsEl;

// ----------------------------------------------------------------- menus
// One menu system for the whole shell: the toolbar (three dots) menu, its
// submenus, and every right-click menu. A menu is a column of rows; a row with
// `submenu` opens another menu beside it, flush against the parent and lined up
// with the row, flipping to the other side when the window edge is in the way.

/** Open menus, root first: [{el, row}] where `row` is the parent row that opened it. */
let menuStack = [];
let menuAnchor = null;
let menuTimer;
let menuWired = false;

const SVG_NS = "http://www.w3.org/2000/svg";
const CHEVRON = "M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z";
const CHECK = "M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z";

/** A Material Symbols glyph from its path data. */
export function svgIcon(path, size = 18) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

function closeMenusFrom(depth) {
  clearTimeout(menuTimer);
  while (menuStack.length > depth) {
    const { el, row } = menuStack.pop();
    el.remove();
    row?.classList.remove("open");
  }
  if (menuStack.length === 0) menuAnchor = null;
}

export function hideMenu() {
  closeMenusFrom(0);
}

/** Whether the menu hanging from `anchor` is the one that's open (for toggle buttons). */
export const menuOpenFor = (anchor) => menuStack.length > 0 && menuAnchor === anchor;

function wireMenus() {
  if (menuWired) return;
  menuWired = true;
  document.addEventListener(
    "mousedown",
    (e) => {
      if (menuStack.length === 0) return;
      if (e.target.closest?.(".shadow-menu")) return;
      // The anchor button toggles the menu itself on click.
      if (menuAnchor instanceof Element && menuAnchor.contains(e.target)) return;
      hideMenu();
    },
    true,
  );
  window.addEventListener("blur", hideMenu);
  window.addEventListener("resize", hideMenu);
  document.addEventListener("keydown", menuKey, true);
}

const rowsOf = (el) => [...el.querySelectorAll(":scope > .shadow-menu-item:not(.disabled)")];

function setActiveRow(el, row) {
  el.querySelector(":scope > .shadow-menu-item.active")?.classList.remove("active");
  row?.classList.add("active");
  row?.scrollIntoView?.({ block: "nearest" });
}

function menuKey(e) {
  if (menuStack.length === 0 || e.altKey || e.ctrlKey || e.metaKey) return;
  const depth = menuStack.length - 1;
  const { el } = menuStack[depth];
  const rows = rowsOf(el);
  const active = el.querySelector(":scope > .shadow-menu-item.active");
  const at = rows.indexOf(active);
  switch (e.key) {
    case "ArrowDown":
      setActiveRow(el, rows[(at + 1) % rows.length]);
      break;
    case "ArrowUp":
      setActiveRow(el, rows[at <= 0 ? rows.length - 1 : at - 1]);
      break;
    case "ArrowRight":
      if (!active?.openSubmenu) return;
      active.openSubmenu(true);
      break;
    case "ArrowLeft":
      if (depth === 0) return;
      closeMenusFrom(depth);
      break;
    case "Enter":
    case " ":
      if (!active) return;
      if (active.openSubmenu) active.openSubmenu(true);
      else active.click();
      break;
    case "Home":
      setActiveRow(el, rows[0]);
      break;
    case "End":
      setActiveRow(el, rows[rows.length - 1]);
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
}

/**
 * @typedef {object} MenuItem
 * @property {string} [label]
 * @property {string} [icon] Material Symbols path data, shown before the label
 * @property {string} [image] URL of a small image shown before the label (favicons)
 * @property {string} [dot] a CSS colour, shown as a small disc before the label (tab groups)
 * @property {string} [shortcut] keyboard hint shown at the right edge
 * @property {boolean} [checked] shows a check mark (or an empty slot) before the label
 * @property {boolean} [disabled]
 * @property {boolean} [separator]
 * @property {boolean} [header] a small caption, not clickable
 * @property {number} [indent]
 * @property {() => void} [onclick]
 * @property {MenuItem[] | (() => MenuItem[])} [submenu] opens beside the row
 * @property {Array<{label?: string, icon?: string, title?: string, onclick?: () => void,
 *   close?: boolean, text?: () => string}>} [controls] inline buttons / read-outs on the
 *   right of a row that isn't itself clickable (the zoom row). Buttons keep the menu open
 *   unless `close` is set; `text` entries are re-read after every click.
 */

function buildMenu(items, depth) {
  items = items.filter(Boolean);
  const el = document.createElement("div");
  el.className = "shadow-menu";
  el.setAttribute("role", "menu");
  if (items.some((item) => item.icon || item.image || item.dot || item.checked !== undefined)) el.classList.add("has-lead");

  for (const item of items) {
    if (item.separator) {
      // No doubled or dangling rules when optional groups turn out empty.
      const last = el.lastElementChild;
      if (last && !last.classList.contains("shadow-menu-separator")) el.append(h("div", { class: "shadow-menu-separator" }));
      continue;
    }
    if (item.header) {
      el.append(h("div", { class: "shadow-menu-header" }, item.label));
      continue;
    }

    const lead = h("span", { class: "shadow-menu-lead" });
    if (item.checked) lead.append(svgIcon(CHECK, 16));
    else if (item.icon) lead.append(svgIcon(item.icon));
    else if (item.image) lead.append(h("img", { src: item.image, alt: "", onerror: (e) => e.target.remove() }));
    else if (item.dot) lead.append(h("span", { class: "shadow-menu-dot", style: { background: item.dot } }));
    const row = h("div", { class: "shadow-menu-item", role: "menuitem", title: item.title }, lead, h("span", { class: "shadow-menu-label" }, item.label ?? ""));
    if (item.indent) row.style.paddingLeft = `${10 + item.indent * 14}px`;

    if (item.controls) {
      // A row of inline controls: the row itself does nothing.
      row.className = "shadow-menu-row";
      row.removeAttribute("role");
      const readouts = [];
      const box = h("span", { class: "shadow-menu-controls" });
      for (const control of item.controls) {
        if (control.text) {
          const out = h("span", { class: "shadow-menu-readout" }, control.text());
          readouts.push(() => (out.textContent = control.text()));
          box.append(out);
          continue;
        }
        box.append(
          h(
            "button",
            {
              type: "button",
              title: control.title,
              "aria-label": control.title,
              onclick: (e) => {
                e.stopPropagation();
                if (control.close) hideMenu();
                control.onclick?.();
                for (const update of readouts) update();
              },
            },
            control.icon ? svgIcon(control.icon, 16) : control.label,
          ),
        );
      }
      row.append(box);
      row.addEventListener("mouseenter", () => {
        clearTimeout(menuTimer);
        setActiveRow(el, null);
        menuTimer = setTimeout(() => closeMenusFrom(depth + 1), 200);
      });
      el.append(row);
      continue;
    }

    if (item.shortcut) row.append(h("span", { class: "shadow-menu-hint" }, item.shortcut));
    if (item.disabled) {
      row.classList.add("disabled");
      row.setAttribute("aria-disabled", "true");
    }
    if (item.submenu && !item.disabled) {
      row.classList.add("has-sub");
      row.setAttribute("aria-haspopup", "menu");
      row.append(h("span", { class: "shadow-menu-arrow" }, svgIcon(CHEVRON, 16)));
      row.openSubmenu = (focusFirst = false) => {
        clearTimeout(menuTimer);
        if (!row.classList.contains("open")) {
          closeMenusFrom(depth + 1);
          const children = typeof item.submenu === "function" ? item.submenu() : item.submenu;
          const sub = buildMenu(children, depth + 1);
          document.body.append(sub);
          placeSubmenu(sub, el, row);
          row.classList.add("open");
          menuStack.push({ el: sub, row });
        }
        if (focusFirst) setActiveRow(menuStack[depth + 1].el, rowsOf(menuStack[depth + 1].el)[0]);
      };
      row.addEventListener("click", () => row.openSubmenu());
    } else if (!item.disabled) {
      row.addEventListener("click", () => {
        hideMenu();
        item.onclick?.();
      });
    }
    row.addEventListener("mouseenter", () => {
      clearTimeout(menuTimer);
      if (!item.disabled) setActiveRow(el, row);
      // A short pause either way, so sweeping the pointer diagonally towards an
      // open submenu doesn't close it or open the neighbours on the way.
      if (row.openSubmenu) menuTimer = setTimeout(() => row.openSubmenu(), 130);
      else menuTimer = setTimeout(() => closeMenusFrom(depth + 1), 200);
    });
    el.append(row);
  }
  if (el.lastElementChild?.classList.contains("shadow-menu-separator")) el.lastElementChild.remove();
  // Moving back into a menu keeps its own submenu chain alive.
  el.addEventListener("mouseleave", () => clearTimeout(menuTimer));
  return el;
}

const EDGE = 6;

function placeSubmenu(sub, parent, row) {
  const p = parent.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const box = sub.getBoundingClientRect();
  // Beside the parent, overlapping it by a hair like a native menu; whichever
  // side has room, preferring the right.
  let left = p.right - 3;
  if (left + box.width > window.innerWidth - EDGE) left = p.left - box.width + 3;
  if (left < EDGE) left = Math.max(EDGE, window.innerWidth - box.width - EDGE);
  // First row level with the row that opened it.
  const pad = parseFloat(getComputedStyle(sub).paddingTop) || 0;
  let top = r.top - pad - 1;
  top = Math.max(EDGE, Math.min(top, window.innerHeight - box.height - EDGE));
  sub.style.left = `${Math.round(left)}px`;
  sub.style.top = `${Math.round(top)}px`;
}

/**
 * Opens a menu at viewport coordinates, or hanging under `options.anchor`.
 *
 * @param {number} x
 * @param {number} y
 * @param {MenuItem[]} items
 * @param {{anchor?: Element, align?: "start" | "end", width?: number}} [options]
 *   With an anchor, x/y are ignored: the menu drops below it, lined up with its
 *   left ("start") or right ("end", the default) edge.
 */
export function showMenu(x, y, items, { anchor = null, align = "end", width } = {}) {
  wireMenus();
  hideMenu();
  const el = buildMenu(items, 0);
  if (!el.firstElementChild) return;
  if (width) el.style.width = `${width}px`;
  document.body.append(el);
  const box = el.getBoundingClientRect();
  let left;
  let top;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    left = align === "start" ? a.left : a.right - box.width;
    top = a.bottom + 6;
    // Never taller than the space under the button: it scrolls instead.
    el.style.maxHeight = `${Math.max(120, window.innerHeight - top - EDGE)}px`;
  } else {
    left = x;
    // Opens downwards from the pointer, or upwards when there's no room below.
    top = y + box.height > window.innerHeight - EDGE && y - box.height >= EDGE ? y - box.height : y;
    top = Math.min(top, window.innerHeight - box.height - EDGE);
  }
  el.style.left = `${Math.round(Math.max(EDGE, Math.min(left, window.innerWidth - box.width - EDGE)))}px`;
  el.style.top = `${Math.round(Math.max(EDGE, top))}px`;
  menuStack.push({ el, row: null });
  menuAnchor = anchor;
}

/**
 * @param {string} text
 * @param {{title?: string, icon?: string, timeout?: number, onclick?: () => void,
 *   onclose?: (byUser: boolean) => void, buttons?: Array<{label: string, onclick: () => void}>}} [options]
 * @returns {() => void} dismiss
 */
export function toast(text, options = {}) {
  if (!toastsEl) {
    toastsEl = document.createElement("div");
    toastsEl.id = "shadow-toasts";
    document.body.appendChild(toastsEl);
  }
  const el = document.createElement("div");
  el.className = "shadow-toast";

  if (options.icon) {
    const img = document.createElement("img");
    img.src = options.icon;
    img.alt = "";
    img.onerror = () => img.remove();
    el.appendChild(img);
  }
  const body = document.createElement("div");
  body.className = "shadow-toast-body";
  if (options.title) {
    const title = document.createElement("strong");
    title.textContent = options.title;
    body.appendChild(title);
  }
  const message = document.createElement("span");
  message.textContent = text;
  body.appendChild(message);
  for (const button of options.buttons ?? []) {
    const b = document.createElement("button");
    b.textContent = button.label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      button.onclick();
      dismiss(true);
    });
    body.appendChild(b);
  }
  el.appendChild(body);

  let gone = false;
  const dismiss = (byUser = false) => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.remove();
    options.onclose?.(byUser);
  };
  el.addEventListener("click", () => {
    options.onclick?.();
    dismiss(true);
  });
  const timer = setTimeout(dismiss, options.timeout ?? 5000);
  toastsEl.appendChild(el);
  return dismiss;
}

// ----------------------------------------------------------------- dialogs
// In-page replacements for alert()/prompt()/confirm(): those block the whole
// window (and every proxied tab in it) while they're open.

let dialogEl;

function closeDialog(result) {
  if (!dialogEl) return;
  const { resolve } = dialogEl;
  dialogEl.remove();
  dialogEl = null;
  resolve?.(result);
}

/**
 * A small modal. `fields` become inputs; resolves with {name: value, …} when the
 * primary button is used, or null when dismissed.
 *
 * @param {{title: string, message?: string, body?: Node,
 *   fields?: Array<{name: string, label?: string, value?: string, placeholder?: string,
 *     type?: string, options?: Array<{value: string, label: string}>}>,
 *   confirm?: string, cancel?: string|false, danger?: boolean}} options
 * @returns {Promise<Record<string, string>|null>}
 */
export function dialog(options) {
  closeDialog(null);
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "shadow-dialog-wrap";
    wrap.resolve = resolve;
    const box = document.createElement("form");
    box.className = "shadow-dialog";
    box.noValidate = true;

    const title = document.createElement("h3");
    title.textContent = options.title;
    box.append(title);
    if (options.message) {
      const message = document.createElement("p");
      message.textContent = options.message;
      box.append(message);
    }
    if (options.body) box.append(options.body);

    const inputs = [];
    for (const field of options.fields ?? []) {
      const label = document.createElement("label");
      if (field.label) {
        const span = document.createElement("span");
        span.textContent = field.label;
        label.append(span);
      }
      let input;
      if (field.options) {
        input = document.createElement("select");
        for (const opt of field.options) {
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label;
          input.append(o);
        }
      } else if (field.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 6;
      } else {
        input = document.createElement("input");
        input.type = field.type ?? "text";
      }
      input.name = field.name;
      input.value = field.value ?? "";
      if (field.placeholder) input.placeholder = field.placeholder;
      input.autocomplete = "off";
      input.spellcheck = false;
      label.append(input);
      box.append(label);
      inputs.push(input);
    }

    const buttons = document.createElement("div");
    buttons.className = "shadow-dialog-buttons";
    if (options.cancel !== false) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = options.cancel ?? "Cancel";
      cancel.addEventListener("click", () => closeDialog(null));
      buttons.append(cancel);
    }
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = "primary" + (options.danger ? " danger" : "");
    ok.textContent = options.confirm ?? "OK";
    buttons.append(ok);
    box.append(buttons);

    box.addEventListener("submit", (e) => {
      e.preventDefault();
      closeDialog(Object.fromEntries(inputs.map((input) => [input.name, input.value])));
    });
    wrap.addEventListener("mousedown", (e) => {
      if (e.target === wrap) closeDialog(null);
    });
    wrap.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing here must not trigger shell shortcuts
      if (e.key === "Escape") closeDialog(null);
    });
    wrap.append(box);
    document.body.append(wrap);
    dialogEl = wrap;
    (inputs[0] ?? ok).focus();
    inputs[0]?.select?.();
  });
}

/** Yes/no question; resolves true or false. */
export async function confirmDialog(title, message, { confirm = "OK", danger = false } = {}) {
  return (await dialog({ title, message, confirm, danger })) !== null;
}

/** Single text field; resolves with the string, or null when cancelled. */
export async function promptDialog(title, { label, value = "", placeholder, confirm = "Save" } = {}) {
  const result = await dialog({ title, confirm, fields: [{ name: "value", label, value, placeholder }] });
  return result ? result.value : null;
}

// ----------------------------------------------------------------- popovers
// One anchored panel at a time (downloads, site settings, workspaces).

let popoverEl;
let popoverOwner = null;

export function hidePopover() {
  if (!popoverEl) return;
  popoverEl.remove();
  popoverEl = null;
  popoverOwner = null;
}

export const popoverOpenFor = (owner) => popoverOwner === owner && !!popoverEl;

/**
 * @param {Element} anchor the button the panel hangs under
 * @param {(panel: HTMLElement) => void} build fills the panel
 * @param {{owner?: unknown, width?: number}} [options] `owner` makes a second call a toggle
 */
export function showPopover(anchor, build, { owner = anchor, width = 340 } = {}) {
  if (popoverOwner === owner && popoverEl) {
    hidePopover();
    return null;
  }
  hidePopover();
  hideMenu();
  popoverEl = document.createElement("div");
  popoverEl.className = "shadow-popover";
  popoverEl.style.width = `${width}px`;
  popoverOwner = owner;
  build(popoverEl);
  document.body.append(popoverEl);
  const rect = anchor.getBoundingClientRect();
  const box = popoverEl.getBoundingClientRect();
  popoverEl.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - box.height - 8)}px`;
  popoverEl.style.left = `${Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8))}px`;
  popoverEl.addEventListener("keydown", (e) => e.stopPropagation());
  return popoverEl;
}

document.addEventListener("mousedown", (e) => {
  if (!popoverEl || popoverEl.contains(e.target)) return;
  if (popoverOwner instanceof Element && popoverOwner.contains(e.target)) return; // the anchor toggles it itself
  if (e.target.closest?.(".shadow-dialog-wrap, .shadow-menu")) return;
  hidePopover();
});
window.addEventListener("resize", hidePopover);

// ----------------------------------------------------------------- helpers

/** document.createElement with properties and children in one call. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child);
  }
  return el;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export const faviconFor = (url, size = 32) => {
  const host = hostnameOf(url);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}` : "/assets/imgs/icons/logo.png";
};
