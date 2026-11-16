// Workspaces: named sets of tabs that can be saved and brought back later.
//
// A workspace is just [{url, pinned}] under a name, stored with the other
// settings (so it syncs). Opening one either adds its tabs to the window or
// swaps the current tabs out for it.
import { showPopover, hidePopover, promptDialog, confirmDialog, toast, h } from "/assets/js/ui.js";

const KEY = "workspaces";

export class Workspaces {
  constructor(tabs) {
    this.tabs = tabs;
    this.list = [];
    this.ready = this.load();
  }

  async load() {
    const stored = await this.tabs.settings.get(KEY);
    this.list = Array.isArray(stored) ? stored.filter((w) => w && w.id && Array.isArray(w.tabs)) : [];
  }

  persist() {
    return this.tabs.settings.set(KEY, this.list);
  }

  /** The window's tabs in saveable form (private tabs and blank pages are left out). */
  snapshot() {
    return this.tabs.tabsArr
      .filter((tab) => !tab.private)
      .map((tab) => ({ url: tab.pendingUrl ?? tab.url, pinned: tab.pinned }))
      .filter((entry) => entry.url && entry.url !== "about:blank" && !entry.url.startsWith("blob:"));
  }

  async saveCurrent(name) {
    const entries = this.snapshot();
    if (entries.length === 0) {
      toast("There are no tabs to save.", { timeout: 2000 });
      return null;
    }
    name = (name ?? (await promptDialog("Save tabs as a workspace", { label: "Name", value: this.suggestName(), confirm: "Save" })))?.trim();
    if (!name) return null;
    const existing = this.list.find((w) => w.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.tabs = entries;
      existing.savedAt = Date.now();
    } else {
      this.list.unshift({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, tabs: entries, savedAt: Date.now() });
    }
    await this.persist();
    toast(`Saved ${entries.length} tab${entries.length === 1 ? "" : "s"} to “${name}”.`, { timeout: 2500 });
    return existing ?? this.list[0];
  }

  suggestName() {
    let n = this.list.length + 1;
    while (this.list.some((w) => w.name === `Workspace ${n}`)) n++;
    return `Workspace ${n}`;
  }

  /** @param {{replace?: boolean}} [options] replace closes the current (unpinned) tabs first */
  async open(id, { replace = false } = {}) {
    const workspace = this.list.find((w) => w.id === id);
    if (!workspace || workspace.tabs.length === 0) return false;
    const tabs = this.tabs;
    const before = replace ? [...tabs.tabsArr] : [];
    let first = true;
    for (const entry of workspace.tabs) {
      // Only the first tab loads now; the rest load when they're first shown.
      await tabs.createTab(entry.url, undefined, { active: first, lazy: !first, pinned: !!entry.pinned });
      first = false;
    }
    for (const tab of before) {
      if (tab.pinned) continue;
      const at = tabs.tabsArr.indexOf(tab);
      if (at !== -1) tabs.closeTab(at, true, { remember: false });
    }
    toast(`Opened “${workspace.name}”.`, { timeout: 1800 });
    return true;
  }

  async update(id) {
    const workspace = this.list.find((w) => w.id === id);
    if (!workspace) return;
    const entries = this.snapshot();
    if (!entries.length) return;
    workspace.tabs = entries;
    workspace.savedAt = Date.now();
    await this.persist();
    toast(`“${workspace.name}” now holds the current tabs.`, { timeout: 2200 });
  }

  async rename(id) {
    const workspace = this.list.find((w) => w.id === id);
    if (!workspace) return;
    const name = (await promptDialog("Rename workspace", { label: "Name", value: workspace.name }))?.trim();
    if (!name) return;
    workspace.name = name;
    await this.persist();
  }

  async remove(id) {
    const workspace = this.list.find((w) => w.id === id);
    if (!workspace) return;
    if (!(await confirmDialog("Delete workspace?", `“${workspace.name}” and its ${workspace.tabs.length} saved tabs will be removed.`, { confirm: "Delete", danger: true }))) return;
    this.list = this.list.filter((w) => w.id !== id);
    await this.persist();
  }

  // ---------------------------------------------------------------- panel

  showPanel(anchor) {
    const render = (panel) => {
      panel.textContent = "";
      panel.classList.add("workspaces-panel");
      panel.append(
        h(
          "div",
          { class: "popover-title" },
          h("strong", {}, "Workspaces"),
          h(
            "button",
            {
              type: "button",
              class: "link",
              onclick: async () => {
                hidePopover();
                await this.saveCurrent();
              },
            },
            "Save current tabs",
          ),
        ),
      );
      if (this.list.length === 0) {
        panel.append(h("p", { class: "muted" }, "Save the tabs you have open as a named set, then bring them back any time."));
        return;
      }
      const again = () => render(panel);
      for (const workspace of this.list) {
        panel.append(
          h(
            "div",
            { class: "workspace-item" },
            h(
              "div",
              { class: "workspace-main", title: workspace.tabs.map((t) => t.url).join("\n") },
              h("div", { class: "workspace-name" }, workspace.name),
              h("div", { class: "muted" }, `${workspace.tabs.length} tab${workspace.tabs.length === 1 ? "" : "s"}`),
            ),
            h(
              "div",
              { class: "workspace-actions" },
              h("button", { type: "button", title: "Open these tabs alongside the current ones", onclick: () => (hidePopover(), this.open(workspace.id)) }, "Open"),
              h("button", { type: "button", title: "Close the current tabs and open these", onclick: () => (hidePopover(), this.open(workspace.id, { replace: true })) }, "Switch"),
              h("button", { type: "button", title: "Overwrite with the current tabs", onclick: () => this.update(workspace.id).then(again) }, "↻"),
              h("button", { type: "button", title: "Rename", onclick: () => this.rename(workspace.id).then(() => (hidePopover(), this.showPanel(anchor))) }, "✎"),
              h("button", { type: "button", title: "Delete", onclick: () => this.remove(workspace.id).then(() => (hidePopover(), this.showPanel(anchor))) }, "✕"),
            ),
          ),
        );
      }
    };
    showPopover(anchor, render, { owner: "workspaces", width: 380 });
  }
}
