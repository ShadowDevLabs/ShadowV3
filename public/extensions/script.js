// shadow://extensions — install and manage Chrome extensions.
//
// The runtime lives in the top window (tabs.js + extension_ui.js); this is just a front end.

const $ = (id) => document.getElementById(id);
const list = $("list");
const status = $("status");
const template = $("ext-template");

function api() {
  try {
    if (parent !== window && parent.tabs?.extensions?.available) return parent.tabs.extensions;
  } catch {}
  return null;
}

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

async function run(label, fn) {
  setStatus(label);
  try {
    const result = await fn();
    setStatus("");
    return result;
  } catch (e) {
    console.error("[EXT]", e);
    setStatus(e?.message ?? String(e), true);
    return undefined;
  } finally {
    render();
  }
}

function render() {
  const ext = api();
  $("unavailable").hidden = !!ext;
  $("install").classList.toggle("disabled", !ext);
  const items = ext ? ext.list() : [];
  $("empty").hidden = items.length > 0;
  list.textContent = "";

  for (const item of items) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.classList.toggle("off", !item.enabled);

    const img = node.querySelector(".ext-img");
    img.src = item.iconUrl || "/assets/imgs/icons/default-extension.png";
    img.onerror = () => {
      img.onerror = null;
      img.src = "/assets/imgs/icons/default-extension.png";
    };

    node.querySelector(".ext-name").textContent = item.name;
    node.querySelector(".ext-version").textContent =
      [item.version, item.manifestVersion ? `MV${item.manifestVersion}` : ""].filter(Boolean).join(" · ");
    node.querySelector(".ext-desc").textContent = item.description;
    node.querySelector(".ext-perms").textContent = item.permissions.length
      ? `Permissions: ${item.permissions.join(", ")}`
      : "";

    const toggle = node.querySelector('[data-action="toggle"]');
    toggle.checked = item.enabled;
    toggle.addEventListener("change", () =>
      run(toggle.checked ? "Enabling…" : "Disabling…", () => ext.setEnabled(item.id, toggle.checked)),
    );

    const options = node.querySelector('[data-action="options"]');
    options.hidden = !item.hasOptions || !item.enabled;
    options.addEventListener("click", () => ext.openOptions(item.id));

    const reload = node.querySelector('[data-action="reload"]');
    reload.hidden = !item.enabled;
    reload.addEventListener("click", () => run("Reloading…", () => ext.reload(item.id)));

    node.querySelector('[data-action="remove"]').addEventListener("click", () => {
      if (confirm(`Remove "${item.name}"?`)) run("Removing…", () => ext.remove(item.id));
    });

    list.appendChild(node);
  }
}

async function installFile(file) {
  const ext = api();
  if (!ext || !file) return;
  if (!/\.(crx|zip)$/i.test(file.name)) {
    return setStatus("That isn't a .crx or .zip extension package.", true);
  }
  const id = await run(`Installing ${file.name}…`, () => ext.install(file));
  if (id) setStatus("Installed. Reload open tabs for it to take effect on them.");
}

async function installFromStore() {
  const ext = api();
  const input = $("store-input");
  if (!ext || !input.value.trim()) return;
  const id = await run("Downloading from the Chrome Web Store…", () => ext.installFromStore(input.value));
  if (id) {
    input.value = "";
    setStatus("Installed. Reload open tabs for it to take effect on them.");
  }
}

$("store-button").addEventListener("click", installFromStore);
$("store-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") installFromStore();
});
$("file-input").addEventListener("change", (e) => {
  installFile(e.target.files?.[0]);
  e.target.value = "";
});

const dropzone = $("dropzone");
for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add("over");
  });
}
for (const type of ["dragleave", "drop"]) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.remove("over");
  });
}
dropzone.addEventListener("drop", (e) => installFile(e.dataTransfer?.files?.[0]));

// Keep the list in sync when something changes elsewhere (toolbar menu, another tab).
const unsubscribe = api()?.onChange(render);
window.addEventListener("pagehide", () => unsubscribe?.());

render();
try {
  parent.updateOmni();
  parent.setTab();
} catch {}
