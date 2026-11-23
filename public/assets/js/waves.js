// New tab background: big soft glowing waves that slowly morph, in the theme's accent color.
// Drawn on a canvas a tenth of the screen size and stretched by CSS: the stretch is the blur,
// so each frame is only a few thousand pixels. Capped at 30 fps; still with reduced motion.
const canvas = document.querySelector(".bg-dots canvas");
const ctx = canvas.getContext("2d");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SCALE = 10, FRAME = 1000 / 30;
let w, h, accent, light, last = 0, frames = 0;

const resize = () => {
  w = canvas.width = Math.ceil(innerWidth / SCALE);
  h = canvas.height = Math.ceil(innerHeight / SCALE);
  ctx.filter = "blur(2px)"; // softens the stretched edges; resizing the canvas resets it
};
const readColors = () => {
  const css = getComputedStyle(document.documentElement);
  accent = css.getPropertyValue("--accent").trim() || "#3b82f6";
  light = css.getPropertyValue("--accent-light").trim() || accent;
};

// A band between two wavy edges whose thickness swells and pinches as it drifts.
function band(t, baseY, amp, thick, speed, phase, color, alpha) {
  const edge = (x, side) => {
    const u = x / w;
    const mid = baseY + amp * Math.sin(u * 3.2 + t * speed + phase) + amp * 0.45 * Math.sin(u * 6.5 - t * speed * 0.7 + phase * 2);
    return mid + side * thick * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(u * 2.4 - t * speed * 0.9 + phase)));
  };
  ctx.beginPath();
  for (let x = -2; x <= w + 2; x += 2) ctx.lineTo(x, edge(x, -1));
  for (let x = w + 2; x >= -2; x -= 2) ctx.lineTo(x, edge(x, 1));
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fill();
}

function draw(now) {
  if (!still) requestAnimationFrame(draw);
  if (now - last < FRAME) return;
  last = now;
  if (frames++ % 60 === 0) readColors(); // follows theme changes without reading styles every frame
  const t = now / 1000;
  ctx.clearRect(0, 0, w, h);
  band(t, h * 0.22, h * 0.14, h * 0.2, 0.16, 0, accent, 0.32);
  band(t, h * 0.3, h * 0.1, h * 0.08, 0.22, 2.4, light, 0.15);
  band(t, h * 0.82, h * 0.1, h * 0.12, 0.12, 4.1, accent, 0.14);
}

resize();
addEventListener("resize", resize);
requestAnimationFrame(draw);
