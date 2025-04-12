import { SettingsManager } from "../assets/js/settings_manager.js";

const settings = new SettingsManager();

async function clear() {
  await settings.get.removeItem("extensions");
}

function makeExtensionObj(
  extName = document.getElementsByName("extName")[0].value,
  extIcon = document.getElementsByName("extIcon")[0].value,
  extDesc = document.getElementsByName("extDesc")[0].value,
  extCode = document.getElementsByName("extCode")[0].value,
) {
  let extension = {
    enabled: true,
    name: extName,
    icon: extIcon,
    description: extDesc,
    code: extCode,
  };
  return extension;
}

function generateId(length) {
  let result = "_";
  const characters = "abcdefghijklmnopqrstuvwxyz";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

async function addExtension(id = generateId(32), extObj = makeExtensionObj()) {
  let extensions =  await settings.get("extensions") || "{}";
  console.log(`[EXT] Adding extension with ID ${id}`);
  extensions[id] = extObj;
  console.log("[EXT] New extensions Obj is:");
  console.log("[EXT]"+extensions);
  await settings.set("extensions", extensions);
}

let save = addExtension();

function exportExtension() {
  let extString = btoa(JSON.stringify(makeExtensionObj()));
  console.log("[EXT]"+extString);
  navigator.clipboard.writeText(extString);
}

function importExtension(i) {
  addExtension(generateId(32), JSON.parse(atob(i)));
}
