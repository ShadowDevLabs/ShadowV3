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
