// Small shared UI pieces for the browser shell: one floating menu and toasts.

let menuEl;
let toastsEl;

function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement("div");
  menuEl.id = "shadow-menu";
  menuEl.className = "shadow-menu";
  menuEl.style.display = "none";
  document.body.appendChild(menuEl);
  document.addEventListener("mousedown", (e) => {
    if (!menuEl.contains(e.target)) hideMenu();
  });
  window.addEventListener("blur", hideMenu);
  window.addEventListener("resize", hideMenu);
  return menuEl;
}

/**
 * @param {number} x viewport coordinates
 * @param {number} y
 * @param {Array<{label?: string, onclick?: () => void, disabled?: boolean,
 *   separator?: boolean, header?: boolean, checked?: boolean, indent?: number}>} items
 */
export function showMenu(x, y, items) {
  const menu = ensureMenu();
  menu.textContent = "";
  for (const item of items) {
    const el = document.createElement("div");
    if (item.separator) {
      el.className = "shadow-menu-separator";
    } else if (item.header) {
      el.className = "shadow-menu-header";
      el.textContent = item.label;
    } else {
      el.className = "shadow-menu-item" + (item.disabled ? " disabled" : "");
      el.textContent = (item.checked === undefined ? "" : item.checked ? "✓ " : "   ") + item.label;
      if (item.indent) el.style.paddingLeft = `${12 + item.indent * 14}px`;
      if (!item.disabled) {
        el.addEventListener("click", () => {
          hideMenu();
          item.onclick?.();
        });
      }
    }
    menu.appendChild(el);
  }
  menu.style.display = "block";
  // Keep it on screen.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
}

export function hideMenu() {
  if (menuEl) menuEl.style.display = "none";
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
