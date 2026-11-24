// Install-as-app support and the offline indicator.
//
// We keep the `beforeinstallprompt` event and offer it from the toolbar menu and the palette.

let installEvent = null;
const row = document.getElementById("install-row");

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // no surprise banner; the user asks for it from the menu
  installEvent = e;
  if (row) row.hidden = false;
});

window.addEventListener("appinstalled", () => {
  installEvent = null;
  if (row) row.hidden = true;
  toast("Shadow is installed — it now opens in its own window.", { timeout: 4000 });
});

export const shadowPwa = {
  get canInstall() {
    return !!installEvent && !standalone();
  },
  async install() {
    if (!installEvent) {
      toast(
        standalone()
          ? "Shadow is already running as an installed app."
          : "Use your browser's menu → “Install” or “Add to Home Screen” to install Shadow.",
        { timeout: 4500 },
      );
      return false;
    }
    const event = installEvent;
    installEvent = null;
    if (row) row.hidden = true;
    event.prompt();
    const choice = await event.userChoice.catch(() => null);
    return choice?.outcome === "accepted";
  },
};
window.shadowPwa = shadowPwa;

// ---------------------------------------------------------------- offline

function reflectConnection(announce) {
  const offline = !navigator.onLine;
  document.body.classList.toggle("offline", offline);
  if (!announce) return;
  if (offline) {
    toast("You're offline. Pages will load again once the connection is back.", { title: "No connection", timeout: 6000 });
  } else {
    toast("Back online.", { timeout: 2000 });
  }
}

window.addEventListener("online", () => reflectConnection(true));
window.addEventListener("offline", () => reflectConnection(true));
reflectConnection(!navigator.onLine);
