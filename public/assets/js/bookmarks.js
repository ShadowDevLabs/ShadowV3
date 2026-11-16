// Bookmarks: the bar under the address bar, the star in the address bar, and
// the stored list ([{title, url}] under the "bookmarks" setting).
import { SettingsManager } from "./settings_manager.js";
import { showMenu, dialog, toast, h, faviconFor } from "/assets/js/ui.js";

class BookmarksManager {
  constructor() {
    this.settings = new SettingsManager();
    this.container = document.getElementById("bookmarks-container");
    this.star = document.getElementById("bookmark-star");
    /** @type {{title: string, url: string}[]} */
    this.list = [];
    this.visible = true;
    this.star?.addEventListener("click", () => this.toggleCurrent());
    this.container.addEventListener("contextmenu", (e) => {
      if (e.target !== this.container) return;
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: "Bookmark this page", onclick: () => this.toggleCurrent(true) },
        { label: "Hide bookmarks bar", onclick: () => this.setVisible(false) },
      ]);
    });
    new ResizeObserver(() => this.layout()).observe(this.container);
    this.ready = this.load();
  }

  async load() {
    const [stored, visible] = await Promise.all([this.settings.get("bookmarks"), this.settings.get("bookmarks-bar")]);
    this.visible = visible !== false;
    let list = stored;
    // Stored as an array; very old versions stored a JSON string.
    if (typeof list === "string") {
      try {
        list = JSON.parse(list);
      } catch {
        list = [];
      }
    }
    this.list = Array.isArray(list) ? list.filter((b) => b && typeof b.url === "string" && b.url).map((b) => ({ title: String(b.title ?? b.url), url: b.url })) : [];
    this.render();
  }

  save() {
    return this.settings.set("bookmarks", this.list);
  }

  setVisible(visible) {
    this.visible = visible;
    this.settings.set("bookmarks-bar", visible);
    this.render();
    if (!visible) toast("Bookmarks bar hidden — Alt+B brings it back.", { timeout: 2500 });
  }

  // ---------------------------------------------------------------- data

  indexOf(url) {
    return this.list.findIndex((b) => b.url === url);
  }

  addBookmark(title, url) {
    if (!url) return;
    this.list.push({ title: title || url, url });
    this.render();
    this.save();
  }

  /** Star button / "Bookmark this page": adds the active tab, or removes it if it's already there. */
  toggleCurrent(addOnly = false) {
    const { title, src } = window.tabs.getTabInfo();
    if (!src || src === "shadow://new" || src === "about:blank" || src.startsWith("blob:")) {
      return toast("This page can't be bookmarked.", { timeout: 2000 });
    }
    const at = this.indexOf(src);
    if (at !== -1) {
      if (addOnly) return;
      this.list.splice(at, 1);
      toast("Bookmark removed.", { timeout: 1500 });
    } else {
      this.list.push({ title: title || src, url: src });
      if (!this.visible) toast("Bookmarked.", { timeout: 1500 });
    }
    this.render();
    this.save();
  }

  // Old name, still used by the menu and the command palette.
  newBookmark() {
    this.toggleCurrent(true);
  }

  async editBookmark(index) {
    const bookmark = this.list[index];
    if (!bookmark) return;
    const result = await dialog({
      title: "Edit bookmark",
      confirm: "Save",
      fields: [
        { name: "title", label: "Name", value: bookmark.title },
        { name: "url", label: "Address", value: bookmark.url },
      ],
    });
    if (!result || !result.url.trim()) return;
    bookmark.title = result.title.trim() || result.url.trim();
    bookmark.url = result.url.trim();
    this.render();
    this.save();
  }

  deleteBookmark(index) {
    if (!this.list[index]) return;
    this.list.splice(index, 1);
    this.render();
    this.save();
  }

  move(from, to) {
    if (from === to || !this.list[from]) return;
    const [item] = this.list.splice(from, 1);
    this.list.splice(Math.max(0, Math.min(to, this.list.length)), 0, item);
    this.render();
    this.save();
  }

  open(bookmark, e) {
    const tabs = window.tabs;
    if (e?.shiftKey || e?.ctrlKey || e?.metaKey || e?.button === 1) {
      tabs.createTab(bookmark.url, undefined, { active: !(e.ctrlKey || e.metaKey || e.button === 1) });
    } else {
      tabs.load(bookmark.url);
    }
  }

  // ---------------------------------------------------------------- bar

  render() {
    const bar = this.container;
    bar.textContent = "";
    bar.classList.toggle("hidden", !this.visible || this.list.length === 0);
    this.list.forEach((bookmark, index) => {
      const el = h(
        "div",
        { class: "bookmark", title: `${bookmark.title}\n${bookmark.url}`, draggable: true, dataset: { title: bookmark.title, url: bookmark.url, index: String(index) } },
        h("img", { src: bookmark.url.startsWith("shadow://") ? `/assets/imgs/icons/pages/${bookmark.url.slice(9).split("/")[0]}.png` : faviconFor(bookmark.url), alt: "", draggable: false, onerror: (e) => !e.target.src.endsWith("/logo.png") && (e.target.src = "/assets/imgs/icons/logo.png") }),
        h("span", {}, bookmark.title),
      );
      el.addEventListener("click", (e) => this.open(bookmark, e));
      el.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.open(bookmark, e);
        }
      });
      el.addEventListener("mouseenter", () => window.tabs?.prewarm?.(bookmark.url));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenu(e.clientX, e.clientY, [
          { label: "Open in new tab", onclick: () => window.tabs.createTab(bookmark.url) },
          { label: "Open in private tab", onclick: () => window.tabs.createTab(bookmark.url, undefined, { private: true }) },
          { separator: true },
          { label: "Edit…", onclick: () => this.editBookmark(index) },
          { label: "Delete", onclick: () => this.deleteBookmark(index) },
          { separator: true },
          { label: "Hide bookmarks bar", onclick: () => this.setVisible(false) },
        ]);
      });
      el.addEventListener("dragstart", (e) => {
        this.dragIndex = index;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/uri-list", bookmark.url);
        e.dataTransfer.setData("text/plain", bookmark.url);
      });
      el.addEventListener("dragover", (e) => {
        if (this.dragIndex === undefined) return;
        e.preventDefault();
      });
      el.addEventListener("drop", (e) => {
        if (this.dragIndex === undefined) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const after = e.clientX > rect.left + rect.width / 2;
        let to = index + (after ? 1 : 0);
        if (this.dragIndex < to) to -= 1;
        const from = this.dragIndex;
        this.dragIndex = undefined;
        this.move(from, to);
      });
      el.addEventListener("dragend", () => (this.dragIndex = undefined));
      bar.append(el);
    });
    this.overflow = h("button", { type: "button", class: "bookmark-overflow", title: "More bookmarks", hidden: true, onclick: (e) => this.showOverflow(e) }, "»");
    bar.append(this.overflow);
    this.layout();
    this.updateStar();
  }

  /** Bookmarks that don't fit are hidden and listed behind the » button. */
  layout() {
    const bar = this.container;
    if (!this.overflow || bar.classList.contains("hidden")) return;
    const items = [...bar.querySelectorAll(".bookmark")];
    for (const el of items) el.hidden = false;
    this.overflow.hidden = true;
    const available = bar.clientWidth - 16;
    let used = 0;
    let hiddenFrom = -1;
    items.forEach((el, i) => {
      if (hiddenFrom !== -1) return;
      used += el.offsetWidth + 6;
      if (used > available) hiddenFrom = i;
    });
    if (hiddenFrom === -1) return;
    // Leave room for the » button itself.
    this.overflow.hidden = false;
    const room = available - this.overflow.offsetWidth - 6;
    used = 0;
    hiddenFrom = items.length;
    items.forEach((el, i) => {
      if (hiddenFrom !== items.length) return;
      used += el.offsetWidth + 6;
      if (used > room) hiddenFrom = i;
    });
    items.forEach((el, i) => (el.hidden = i >= hiddenFrom));
    this.hiddenFrom = hiddenFrom;
  }

  showOverflow(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    showMenu(
      rect.left,
      rect.bottom + 4,
      this.list.slice(this.hiddenFrom ?? 0).map((bookmark) => ({ label: bookmark.title, onclick: () => window.tabs.load(bookmark.url) })),
    );
  }

  /** tabs.js calls this whenever the active tab's address changes. */
  updateStar(url = window.tabs?.getTabInfo?.().src) {
    if (!this.star) return;
    const on = !!url && this.indexOf(url) !== -1;
    this.star.classList.toggle("on", on);
    this.star.title = on ? "Remove bookmark" : "Bookmark this page";
  }
}

const bookmarksManager = new BookmarksManager();
window.bookmarksManager = bookmarksManager; // used by inline onclick handlers, the palette and sync
