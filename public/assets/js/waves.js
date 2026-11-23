// New tab / home background. The drawing runs in waves-worker.js on an OffscreenCanvas, so its
// frames never take time from the page itself (typing, scrolling, clicks): that matters on
// Chromebooks. This side only hands over the canvas and tells the worker about size and colours.
const canvas = document.querySelector(".bg-dots canvas");

if (canvas?.transferControlToOffscreen) {
  const worker = new Worker("/assets/js/waves-worker.js");
  const offscreen = canvas.transferControlToOffscreen();
  const colors = () => {
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#3b82f6";
    return { accent, light: css.getPropertyValue("--accent-light").trim() || accent };
  };
  // A custom wallpaper hides the background (themes.js): no point drawing it then.
  const hidden = () => !!document.documentElement.dataset.customWallpaper;
  let sent = colors(), paused = hidden();
  worker.postMessage(
    { canvas: offscreen, still: matchMedia("(prefers-reduced-motion: reduce)").matches, paused, width: innerWidth, height: innerHeight, ...sent },
    [offscreen],
  );
  addEventListener("resize", () => worker.postMessage({ width: innerWidth, height: innerHeight }));
  // A theme change swaps the root's class (or its inline variables, for a custom theme).
  new MutationObserver(() => {
    const now = colors();
    if (now.accent !== sent.accent || now.light !== sent.light) worker.postMessage((sent = now));
    if (hidden() !== paused) worker.postMessage({ paused: (paused = hidden()) });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-custom-wallpaper"] });
}
