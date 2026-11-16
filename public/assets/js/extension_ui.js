// Browser-shell side of Chrome extension support.
//
// Sapphire (https://github.com/x8rr/sapphire) emulates the chrome.* APIs inside
// Scramjet frames and runs the extensions' background pages, content scripts and
// popups. This file is the part Sapphire leaves to the host: the toolbar icons,
// the popup window, context menus, notifications, permission prompts and
// installing packages. shadow://extensions talks to it through parent.tabs.extensions.
import { showMenu, toast } from "/assets/js/ui.js";

const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const STORE_ID = /^[a-p]{32}$/;

export class ExtensionUI {
  constructor(tabs) {
    this.tabs = tabs;
    this.sapphire = null;
    this.popupExt = null;
    this.notifications = new Map();
    this.listeners = new Set();

    this.toolbar = document.getElementById("ext-icons");
    this.popupWrap = document.getElementById("ext-popup-wrap");
    this.popupFrame = document.getElementById("ext-popup");

    document.addEventListener("mousedown", (e) => {
      if (!e.target.closest?.("#ext-popup-wrap, .ext-icon")) this.hidePopup();
    });
  }

  attach(sapphire) {
    this.sapphire = sapphire;
    sapphire.onChange(() => {
      this.render();
      for (const cb of this.listeners) {
        try {
          cb();
        } catch (e) {
          console.error(e);
        }
      }
    });
  }

  get activeTabId() {
    return this.tabs.tabsArr[this.tabs.activeTabIndex]?.id ?? null;
  }

  // ---------------------------------------------------------------- toolbar

  render() {
    if (!this.sapphire || !this.toolbar) return;
    const exts = this.sapphire.getInstalledExtensions(this.activeTabId).filter((e) => e.enabled);
    this.toolbar.textContent = "";
    for (const ext of exts) {
      const button = document.createElement("button");
      button.className = "ext-icon" + (ext.actionEnabled ? "" : " disabled");
      button.title = ext.title ?? ext.name;
      if (ext.iconUrl) {
        const img = document.createElement("img");
        img.src = ext.iconUrl;
        img.alt = "";
        img.draggable = false;
        img.onerror = () => {
          img.remove();
          button.prepend(document.createTextNode(ext.name[0] ?? "?"));
        };
        button.append(img);
      } else {
        button.append(ext.name[0] ?? "?");
      }
      if (ext.badgeText) {
        const badge = document.createElement("span");
        badge.className = "ext-badge";
        badge.textContent = ext.badgeText;
        if (ext.badgeColor) badge.style.background = ext.badgeColor;
        if (ext.badgeTextColor) badge.style.color = ext.badgeTextColor;
        button.append(badge);
      }
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasOpen = this.popupExt === ext.id;
        this.hidePopup();
        if (!wasOpen) this.sapphire.clickAction(ext.id, this.activeTabId);
      });
      button.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const items = [{ header: true, label: ext.name }];
        if (ext.optionsUrl) items.push({ label: "Options", onclick: () => this.openOptions(ext.id) });
        items.push(
          { label: "Manage extensions", onclick: () => this.tabs.createTab("shadow://extensions") },
          { separator: true },
          { label: "Disable", onclick: () => this.setEnabled(ext.id, false) },
          { label: "Remove", onclick: () => this.remove(ext.id) },
        );
        showMenu(e.clientX, e.clientY, items);
      });
      this.toolbar.append(button);
    }
    this.toolbar.style.display = exts.length ? "flex" : "none";
  }

  // ---------------------------------------------------------------- popup

  openPopup(extId, tabId) {
    if (!this.sapphire || !this.popupFrame) return false;
    this.hidePopup();
    this.popupExt = extId;
    this.popupFrame.style.width = "";
    this.popupFrame.style.height = "";
    // Hang it under the extension icons.
    const anchor = this.toolbar.getBoundingClientRect();
    this.popupWrap.style.top = `${anchor.bottom + 8}px`;
    this.popupWrap.style.right = `${Math.max(8, window.innerWidth - anchor.right)}px`;
    this.popupWrap.classList.add("open");
    this.sapphire
      .mountExtensionPopup(this.popupFrame, extId, tabId ?? this.activeTabId)
      .then((ok) => {
        if (!ok && this.popupExt === extId) this.hidePopup();
      })
      .catch((e) => {
        console.error("[EXT] popup failed", e);
        this.hidePopup();
      });
    this.fitPopup(extId);
    return true;
  }

  /** Extension popups size themselves to their content, like Chrome's (25–800 x 25–600). */
  fitPopup(extId) {
    clearInterval(this.fitTimer);
    let ticks = 0;
    this.fitTimer = setInterval(() => {
      if (this.popupExt !== extId || ++ticks > 100) return clearInterval(this.fitTimer);
      try {
        const doc = this.popupFrame.contentDocument;
        const root = doc?.documentElement;
        if (!root || !doc.body || doc.readyState === "loading") return;
        // Width only ever grows past the default (block content always fills the
        // frame, so it can't be measured shrinking); height follows the content.
        const width = Math.max(root.scrollWidth, doc.body.scrollWidth);
        if (width > this.popupFrame.clientWidth) this.popupFrame.style.width = `${Math.min(800, width)}px`;
        const overflowing = root.scrollHeight > root.clientHeight;
        const height = overflowing ? root.scrollHeight : Math.max(root.offsetHeight, doc.body.offsetHeight);
        if (height > 24) this.popupFrame.style.height = `${Math.min(600, Math.max(25, height))}px`;
      } catch {}
    }, 100);
  }

  hidePopup() {
    if (!this.popupExt) return;
    clearInterval(this.fitTimer);
    this.popupExt = null;
    this.popupWrap.classList.remove("open");
    try {
      this.sapphire.unmountExtensionPopup(this.popupFrame);
    } catch {}
  }

  // ---------------------------------------------------------------- host prompts

  /** An extension context-menu request as showMenu() items. */
  menuItems(request) {
    const items = [];
    const add = (entry, depth) => {
      if (entry.type === "separator") return items.push({ separator: true });
      if (entry.children?.length) {
        items.push({ header: true, label: entry.title });
        for (const child of entry.children) add(child, depth + 1);
        return;
      }
      items.push({
        label: entry.title,
        indent: depth,
        disabled: entry.enabled === false,
        checked: entry.type === "checkbox" || entry.type === "radio" ? !!entry.checked : undefined,
        onclick: () => request.select(entry),
      });
    };
    for (const entry of request.items) {
      items.push({ header: true, label: entry.extName });
      // Sapphire groups an extension's top-level items under a synthetic root.
      if (String(entry.id).startsWith("__sapphire_root_")) for (const child of entry.children) add(child, 0);
      else add(entry, 0);
    }
    return items;
  }

  showContextMenu(request) {
    showMenu(request.x, request.y, this.menuItems(request));
  }

  notify(extId, id, options = {}, callbacks = {}) {
    this.clearNotification(extId, id);
    const ext = this.summary(extId);
    const dismiss = toast(options.message ?? "", {
      title: options.title || ext?.name || "Extension",
      icon: options.iconUrl || ext?.iconUrl || undefined,
      timeout: options.requireInteraction ? 60000 : 8000,
      onclick: () => callbacks.click?.(),
      onclose: (byUser) => {
        this.notifications.delete(`${extId}\n${id}`);
        callbacks.close?.(byUser);
      },
      buttons: (options.buttons ?? []).map((button, index) => ({
        label: button.title,
        onclick: () => callbacks.buttonClick?.(index),
      })),
    });
    this.notifications.set(`${extId}\n${id}`, dismiss);
  }

  clearNotification(extId, id) {
    this.notifications.get(`${extId}\n${id}`)?.();
  }

  requestPermissions(extId, permissions = [], origins = []) {
    const name = this.summary(extId)?.name ?? extId;
    return confirm(`"${name}" is asking for extra permissions:\n\n${[...permissions, ...origins].join("\n")}\n\nAllow?`);
  }

  // ---------------------------------------------------------------- management API

  summary(extId) {
    try {
      return this.sapphire?.getInstalledExtensions(this.activeTabId).find((e) => e.id === extId) ?? null;
    } catch {
      return null;
    }
  }

  /** Plain-data list for shadow://extensions. */
  list() {
    if (!this.sapphire) return [];
    return this.sapphire.getInstalledExtensions(this.activeTabId).map((ext) => ({
      id: ext.id,
      name: ext.name,
      version: ext.version ?? "",
      description: ext.description ?? "",
      enabled: ext.enabled,
      iconUrl: ext.iconUrl,
      hasOptions: !!ext.optionsUrl,
      manifestVersion: ext.manifest?.manifest_version ?? null,
      permissions: [
        ...(ext.manifest?.permissions ?? []),
        ...(ext.manifest?.host_permissions ?? []),
      ].filter((p) => typeof p === "string"),
    }));
  }

  get available() {
    return !!this.sapphire;
  }

  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** @param {File|Blob|ArrayBuffer} source a .crx or .zip package */
  async install(source, name = source?.name ?? "extension.crx") {
    if (!this.sapphire) throw new Error("Extensions need the proxy, which failed to start.");
    const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
    if (buffer.byteLength === 0) throw new Error("That file is empty.");
    if (buffer.byteLength > MAX_PACKAGE_BYTES) throw new Error("That package is too large (64 MB max).");
    const id = await this.sapphire.installExtension(buffer, name);
    this.render();
    return id;
  }

  /** @param {string} input a Chrome Web Store URL or a 32-letter extension ID */
  async installFromStore(input) {
    input = String(input ?? "").trim();
    const id = STORE_ID.test(input) ? input : input.match(/\/detail\/(?:[^/]+\/)?([a-p]{32})/)?.[1];
    if (!id) throw new Error("Paste a Chrome Web Store link or a 32-letter extension ID.");
    const res = await fetch(`/v1/api/crx/${id}`);
    if (!res.ok) {
      let message = `Download failed (${res.status}).`;
      try {
        message = (await res.json()).error ?? message;
      } catch {}
      throw new Error(message);
    }
    return this.install(await res.arrayBuffer(), `${id}.crx`);
  }

  async setEnabled(id, enabled) {
    if (this.popupExt === id) this.hidePopup();
    await this.sapphire.setExtensionEnabled(id, enabled);
    this.render();
  }

  async reload(id) {
    if (this.popupExt === id) this.hidePopup();
    await this.sapphire.reloadExtension(id);
    this.render();
  }

  async remove(id) {
    if (this.popupExt === id) this.hidePopup();
    await this.sapphire.uninstallExtension(id);
    this.render();
  }

  openOptions(id) {
    const url = this.summary(id)?.optionsUrl;
    if (url) this.tabs.createTab(url);
  }
}
