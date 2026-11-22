// Tab groups: named, coloured, collapsible runs of neighbouring tabs.
//
// A group is {id, name, color, collapsed}; a tab belongs to one through
// tab.groupId. Members always sit next to each other in the strip, with the
// group's chip in front of the first one. tabs.js owns the tabs and calls in
// here whenever the strip changes (render) or a tab lands somewhere new (settle).
import { showMenu, promptDialog, h, svgIcon } from "/assets/js/ui.js";

export const GROUP_COLORS = [
  ["Grey", "#9aa0a6"],
  ["Blue", "#8ab4f8"],
  ["Red", "#f28b82"],
  ["Yellow", "#fdd663"],
  ["Green", "#81c995"],
  ["Pink", "#ff8bcb"],
  ["Purple", "#c58af9"],
  ["Cyan", "#78d9ec"],
];
const isColor = (value) => GROUP_COLORS.some(([, hex]) => hex === value);

export class TabGroups {
  /**
   * @param {object} tabs the Tab instance
   * @param {HTMLElement} strip the tab strip element
   */
  constructor(tabs, strip) {
    this.tabs = tabs;
    this.strip = strip;
    /** @type {Map<string, {id: string, name: string, color: string, collapsed: boolean, el: HTMLElement|null}>} */
    this.groups = new Map();
    this.nextId = 1;
  }

  get(id) {
    return (id && this.groups.get(id)) || null;
  }

  of(tab) {
    return this.get(tab?.groupId);
  }

  members(id) {
    return this.tabs.tabsArr.filter((tab) => tab.groupId === id);
  }

  list() {
    return [...this.groups.values()];
  }

  // ---------------------------------------------------------------- changes

  /** Starts a group holding `tab` and asks what to call it. */
  async createWith(tab) {
    if (!tab || tab.pinned) return null;
    const group = this.make();
    this.add(tab, group.id);
    const name = await promptDialog("Name this group", { label: "Name (optional)", placeholder: "Research, school, music…", confirm: "Done" });
    if (name?.trim() && this.groups.has(group.id)) {
      group.name = name.trim().slice(0, 40);
      this.changed();
    }
    return group;
  }

  make({ name = "", color, collapsed = false } = {}) {
    const id = `g${this.nextId++}`;
    if (!isColor(color)) {
      // The first colour no other group is using, so neighbours look different.
      const used = new Set(this.list().map((group) => group.color));
      color = (GROUP_COLORS.find(([, hex]) => !used.has(hex)) ?? GROUP_COLORS[this.groups.size % GROUP_COLORS.length])[1];
    }
    const group = { id, name: String(name ?? "").slice(0, 40), color, collapsed: !!collapsed, el: null };
    this.groups.set(id, group);
    return group;
  }

  /** Puts a tab at the end of a group. */
  add(tab, id) {
    const group = this.get(id);
    const tabs = this.tabs;
    if (!group || !tab || tab.pinned || tab.groupId === id) return;
    const others = this.members(id);
    tab.groupId = id;
    if (others.length) {
      const from = tabs.tabsArr.indexOf(tab);
      let to = tabs.tabsArr.indexOf(others[others.length - 1]);
      if (from > to) to += 1;
      tabs.moveTab(from, to, false, { regroup: false });
    }
    this.changed();
  }

  /** Takes a tab out of its group; it ends up just after the group. */
  remove(tab) {
    const id = tab?.groupId;
    if (!id) return;
    const members = this.members(id);
    const last = members[members.length - 1];
    tab.groupId = null;
    if (last && last !== tab) {
      const tabs = this.tabs;
      tabs.moveTab(tabs.tabsArr.indexOf(tab), tabs.tabsArr.indexOf(last), false, { regroup: false });
    }
    this.changed();
  }

  /**
   * Moves a whole group, as one block, next to `anchor` (a tab outside it).
   * An anchor inside another group snaps to that group's edge, so groups never interleave.
   */
  moveGroup(id, anchor, before) {
    const tabs = this.tabs;
    const arr = tabs.tabsArr;
    const members = this.members(id);
    if (!members.length || !anchor || members.includes(anchor)) return;
    if (anchor.groupId) {
      const other = this.members(anchor.groupId);
      anchor = before ? other[0] : other[other.length - 1];
    }
    const rest = arr.filter((tab) => tab.groupId !== id);
    const pinned = rest.filter((tab) => tab.pinned).length;
    const at = Math.max(rest.indexOf(anchor) + (before ? 0 : 1), pinned);
    rest.splice(at, 0, ...members);
    if (rest.every((tab, i) => tab === arr[i])) return;
    const active = arr[tabs.activeTabIndex];
    arr.splice(0, arr.length, ...rest);
    // Only the strip is reordered; iframes stay put, so nothing reloads.
    let ref = rest[at + members.length]?.tab ?? this.strip.querySelector(".addtab-btn");
    for (const tab of [...members].reverse()) {
      this.strip.insertBefore(tab.tab, ref);
      ref = tab.tab;
    }
    tabs.activeTabIndex = arr.indexOf(active);
    this.render();
  }

  ungroup(id) {
    for (const tab of this.members(id)) tab.groupId = null;
    this.changed();
  }

  closeGroup(id) {
    const tabs = this.tabs;
    for (const tab of this.members(id)) tabs.closeTab(tabs.tabsArr.indexOf(tab));
  }

  setCollapsed(id, collapsed) {
    const group = this.get(id);
    if (!group || group.collapsed === !!collapsed) return;
    group.collapsed = !!collapsed;
    const tabs = this.tabs;
    const active = tabs.tabsArr[tabs.activeTabIndex];
    if (group.collapsed && active?.groupId === id) {
      // The tab on screen is being folded away: show the nearest one that isn't.
      const visible = (tab) => tab && !this.of(tab)?.collapsed;
      const at = tabs.activeTabIndex;
      let next = -1;
      for (let step = 1; step < tabs.tabsArr.length && next === -1; step++) {
        if (visible(tabs.tabsArr[at + step])) next = at + step;
        else if (visible(tabs.tabsArr[at - step])) next = at - step;
      }
      if (next !== -1) tabs.switchTab(next);
      else tabs.createTab("shadow://new", undefined, { groupId: null });
    }
    this.changed();
  }

  /**
   * A tab was dropped or inserted somewhere: between two tabs of one group it
   * joins that group; away from the rest of its own group it leaves it.
   */
  settle(tab) {
    const arr = this.tabs.tabsArr;
    const i = arr.indexOf(tab);
    if (i === -1) return;
    const left = arr[i - 1]?.groupId ?? null;
    const right = arr[i + 1]?.groupId ?? null;
    if (tab.pinned) tab.groupId = null;
    else if (left && left === right) tab.groupId = left;
    else if (tab.groupId && left !== tab.groupId && right !== tab.groupId && this.members(tab.groupId).length > 1) tab.groupId = null;
  }

  changed() {
    this.render();
    this.tabs.saveTabs();
  }

  // ---------------------------------------------------------------- session

  /** What's saved with a tab so its group comes back after a reload. */
  serialize(tab) {
    const group = this.of(tab);
    return group ? { id: group.id, name: group.name, color: group.color, collapsed: group.collapsed } : undefined;
  }

  /**
   * Rebuilds groups for restored tabs. `saved[i]` is serialize()'s output for
   * `tabList[i]` (or nothing).
   */
  restore(tabList, saved) {
    const byOldId = new Map();
    tabList.forEach((tab, i) => {
      const info = saved[i];
      if (!tab || !info || typeof info !== "object" || typeof info.id !== "string" || tab.pinned) return;
      let group = byOldId.get(info.id);
      if (!group) {
        group = this.make({ name: info.name, color: info.color, collapsed: info.collapsed });
        byOldId.set(info.id, group);
      }
      tab.groupId = group.id;
    });
    this.render();
  }

  // ---------------------------------------------------------------- strip

  render() {
    const arr = this.tabs.tabsArr;
    // Safety net: a group is one unbroken run. Anything that breaks that (or
    // points at a group that's gone) drops out of its group.
    const finished = new Set();
    let previous = null;
    for (const tab of arr) {
      if (tab.groupId && (!this.groups.has(tab.groupId) || tab.pinned || finished.has(tab.groupId))) tab.groupId = null;
      const id = tab.groupId ?? null;
      if (previous && previous !== id) finished.add(previous);
      previous = id;
    }
    const counts = new Map();
    for (const tab of arr) if (tab.groupId) counts.set(tab.groupId, (counts.get(tab.groupId) ?? 0) + 1);
    for (const [id, group] of [...this.groups]) {
      if (counts.has(id)) continue;
      group.el?.remove();
      this.groups.delete(id);
    }

    for (const tab of arr) {
      const group = this.of(tab);
      tab.tab.classList.toggle("grouped", !!group);
      tab.tab.classList.toggle("group-collapsed", !!group?.collapsed);
      if (group) tab.tab.style.setProperty("--group-color", group.color);
      else tab.tab.style.removeProperty("--group-color");
    }

    for (const group of this.groups.values()) {
      const first = arr.find((tab) => tab.groupId === group.id);
      group.el ??= this.buildChip(group);
      const count = counts.get(group.id);
      const chip = group.el;
      chip.style.setProperty("--group-color", group.color);
      chip.classList.toggle("collapsed", group.collapsed);
      chip.classList.toggle("unnamed", !group.name);
      chip.querySelector(".tab-group-name").textContent = group.name;
      // Folded, or with no name to show, the chip says how many tabs it holds.
      chip.querySelector(".tab-group-count").textContent = group.collapsed || !group.name ? String(count) : "";
      chip.title = `${group.name || "Unnamed group"} · ${count} tab${count === 1 ? "" : "s"}\nClick to ${group.collapsed ? "expand" : "collapse"}, right-click for more`;
      chip.setAttribute("aria-expanded", String(!group.collapsed));
      if (chip.nextElementSibling !== first.tab) this.strip.insertBefore(chip, first.tab);
    }
  }

  buildChip(group) {
    const chip = h(
      "div",
      { class: "tab-group-chip", role: "button", tabIndex: 0, draggable: true },
      h("span", { class: "tab-group-name" }),
      h("span", { class: "tab-group-count" }),
      // Chevron: points down while open, right while folded.
      svgIcon("M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z", 14),
    );
    const toggle = () => this.setCollapsed(group.id, !group.collapsed);
    chip.addEventListener("click", toggle);
    chip.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle();
    });
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showGroupMenu(group.id, e.clientX, e.clientY);
    });
    // Dragging the chip carries the whole group (see Tabs.makeDraggable's dragover).
    chip.addEventListener("dragstart", (e) => {
      this.tabs.draggingGroup = group.id;
      chip.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", group.name || "group");
    });
    chip.addEventListener("dragend", () => {
      this.tabs.draggingGroup = null;
      chip.classList.remove("dragging");
      this.tabs.saveTabs();
    });
    // Dropping a tab on the chip adds it to the group; a dragged group goes before or after this one.
    chip.addEventListener("dragover", (e) => {
      const dragging = this.tabs.draggingGroup;
      if (dragging) {
        if (dragging === group.id) return;
        e.preventDefault();
        const rect = chip.getBoundingClientRect();
        const before = this.tabs.verticalTabs ? e.clientY < rect.top + rect.height / 2 : e.clientX < rect.left + rect.width / 2;
        const members = this.members(group.id);
        this.moveGroup(dragging, before ? members[0] : members[members.length - 1], before);
        return;
      }
      const dragged = this.tabs.dragging;
      if (!dragged || dragged.pinned || dragged.groupId === group.id) return;
      e.preventDefault();
    });
    chip.addEventListener("drop", (e) => {
      const dragged = this.tabs.dragging;
      if (!dragged || dragged.pinned) return;
      e.preventDefault();
      this.add(dragged, group.id);
    });
    return chip;
  }

  showGroupMenu(id, x, y) {
    const group = this.get(id);
    if (!group) return;
    showMenu(x, y, [
      { label: "New tab in group", onclick: () => this.tabs.createTab("shadow://new", undefined, { groupId: id }) },
      { separator: true },
      { label: group.name ? "Rename…" : "Name this group…", onclick: () => this.rename(id) },
      {
        label: "Colour",
        submenu: GROUP_COLORS.map(([name, hex]) => ({
          label: name,
          checked: group.color === hex,
          onclick: () => {
            group.color = hex;
            this.changed();
          },
        })),
      },
      { label: group.collapsed ? "Expand" : "Collapse", onclick: () => this.setCollapsed(id, !group.collapsed) },
      { separator: true },
      { label: "Ungroup", onclick: () => this.ungroup(id) },
      { label: "Close group", onclick: () => this.closeGroup(id) },
    ]);
  }

  async rename(id) {
    const group = this.get(id);
    if (!group) return;
    const name = await promptDialog("Group name", { label: "Name", value: group.name, confirm: "Save" });
    if (name === null || !this.groups.has(id)) return;
    group.name = name.trim().slice(0, 40);
    this.changed();
  }

  /** Entries for a tab's right-click menu. */
  menuItemsFor(tab) {
    if (!tab || tab.pinned) return [];
    const current = this.of(tab);
    const others = this.list().filter((group) => group !== current);
    const items = [];
    if (others.length) {
      items.push({
        label: current ? "Move to group" : "Add to group",
        submenu: [
          { label: "New group", onclick: () => this.createWith(tab) },
          { separator: true },
          ...others.map((group) => ({ label: group.name || "Unnamed group", dot: group.color, onclick: () => this.add(tab, group.id) })),
        ],
      });
    } else if (!current) {
      items.push({ label: "Add to new group", onclick: () => this.createWith(tab) });
    }
    if (current) items.push({ label: "Remove from group", onclick: () => this.remove(tab) });
    return items;
  }
}
