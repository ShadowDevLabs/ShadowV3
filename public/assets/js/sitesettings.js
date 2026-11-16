// Per-site settings: zoom, user agent, JavaScript on/off and forced dark mode,
// remembered per hostname. tabs.js applies them; this module owns the storage
// and the little panel behind the "tune" button in the address bar.
import { showPopover, hidePopover, h, toast } from "/assets/js/ui.js";

const KEY = "site-settings";

export const UA_PRESETS = [
  { id: "", label: "Default" },
  {
    id: "desktop",
    label: "Desktop (Chrome, Windows)",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  },
  {
    id: "android",
    label: "Mobile (Chrome, Android)",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  },
  {
    id: "iphone",
    label: "Mobile (Safari, iPhone)",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
];

export class SiteSettings {
  constructor(settings) {
    this.settings = settings;
    this.sites = {};
    this.ready = this.load();
  }

  async load() {
    const stored = await this.settings.get(KEY);
    this.sites = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  }

  /** @returns {{zoom?: number, ua?: string, js?: boolean, dark?: boolean}} */
  get(host) {
    return (host && this.sites[host]) || {};
  }

  set(host, patch) {
    if (!host) return;
    const next = { ...this.get(host), ...patch };
    for (const key of Object.keys(next)) {
      if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
    }
    if (next.zoom === 1) delete next.zoom;
    if (next.js === true) delete next.js;
    if (Object.keys(next).length) this.sites[host] = next;
    else delete this.sites[host];
    this.settings.set(KEY, this.sites);
  }

  reset(host) {
    delete this.sites[host];
    this.settings.set(KEY, this.sites);
  }

  userAgentFor(host) {
    const id = this.get(host).ua;
    if (!id) return null;
    return UA_PRESETS.find((preset) => preset.id === id)?.ua ?? id; // anything else is a custom string
  }
}

/** The panel for the active tab's site. */
export function showSitePanel(tabs, anchor) {
  const tab = tabs.tabsArr[tabs.activeTabIndex];
  const host = tab ? tabs.hostFor(tab) : "";
  if (!host) {
    hidePopover();
    toast("Site settings apply to websites, not Shadow's own pages.", { timeout: 2500 });
    return;
  }
  const store = tabs.siteSettings;

  showPopover(
    anchor,
    (panel) => {
      const render = () => {
        const site = store.get(host);
        const zoom = Math.round((tab.zoom ?? 1) * 100);
        const uaValue = UA_PRESETS.some((p) => p.id === (site.ua ?? "")) ? (site.ua ?? "") : "custom";
        panel.textContent = "";
        panel.append(
          h("div", { class: "popover-title" }, h("strong", {}, host), h("span", { class: "muted" }, "Site settings")),
          h(
            "div",
            { class: "site-row" },
            h("span", {}, "Zoom"),
            h(
              "div",
              { class: "stepper" },
              h("button", { type: "button", title: "Zoom out", onclick: () => (tabs.setZoom(tabs.tabsArr.indexOf(tab), "out"), render()) }, "−"),
              h("button", { type: "button", class: "wide", title: "Reset zoom", onclick: () => (tabs.setZoom(tabs.tabsArr.indexOf(tab), "reset"), render()) }, `${zoom}%`),
              h("button", { type: "button", title: "Zoom in", onclick: () => (tabs.setZoom(tabs.tabsArr.indexOf(tab), "in"), render()) }, "+"),
            ),
          ),
          h(
            "label",
            { class: "site-row" },
            h("span", {}, "JavaScript"),
            h("input", {
              type: "checkbox",
              class: "toggle",
              checked: site.js !== false,
              onchange: (e) => {
                store.set(host, { js: e.target.checked ? undefined : false });
                tabs.refresh(tabs.tabsArr.indexOf(tab));
                render();
              },
            }),
          ),
          h(
            "label",
            { class: "site-row" },
            h("span", {}, "Dark mode"),
            h(
              "select",
              {
                onchange: (e) => {
                  const v = e.target.value;
                  store.set(host, { dark: v === "" ? undefined : v === "on" });
                  tabs.refreshDarkMode();
                },
              },
              h("option", { value: "", selected: site.dark === undefined }, `Default (${tabs.forceDark ? "on" : "off"})`),
              h("option", { value: "on", selected: site.dark === true }, "On"),
              h("option", { value: "off", selected: site.dark === false }, "Off"),
            ),
          ),
          h(
            "label",
            { class: "site-row" },
            h("span", {}, "User agent"),
            h(
              "select",
              {
                onchange: (e) => {
                  if (e.target.value === "custom") {
                    custom.hidden = false;
                    custom.focus();
                    return;
                  }
                  store.set(host, { ua: e.target.value || undefined });
                  tabs.refresh(tabs.tabsArr.indexOf(tab));
                  render();
                },
              },
              ...UA_PRESETS.map((p) => h("option", { value: p.id, selected: uaValue === p.id }, p.label)),
              h("option", { value: "custom", selected: uaValue === "custom" }, "Custom…"),
            ),
          ),
        );
        const custom = h("input", {
          type: "text",
          class: "site-custom-ua",
          placeholder: "Custom user agent, then Enter",
          value: uaValue === "custom" ? site.ua : "",
          hidden: uaValue !== "custom",
          onkeydown: (e) => {
            if (e.key !== "Enter") return;
            store.set(host, { ua: e.target.value.trim() || undefined });
            tabs.refresh(tabs.tabsArr.indexOf(tab));
            render();
          },
        });
        panel.append(
          custom,
          h(
            "div",
            { class: "popover-footer" },
            h(
              "button",
              {
                type: "button",
                disabled: !Object.keys(site).length,
                onclick: () => {
                  store.reset(host);
                  tabs.setZoom(tabs.tabsArr.indexOf(tab), "reset");
                  tabs.refreshDarkMode();
                  tabs.refresh(tabs.tabsArr.indexOf(tab));
                  render();
                },
              },
              "Reset this site",
            ),
          ),
        );
      };
      render();
    },
    { owner: anchor, width: 300 },
  );
}
