// Draws the new tab/home background off the main thread (see waves.js): soft glowing waves in the
// theme's accent colours. Rendered at a tenth of the screen size and stretched by CSS, which doubles as
// the blur. 30 fps cap; one still frame with reduced motion.
const SCALE = 10, FRAME = 1000 / 30;
let ctx, w, h, accent, light, still = false, paused = false, running = false, last = 0;

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

function paint(now) {
  const t = now / 1000;
  ctx.clearRect(0, 0, w, h);
  band(t, h * 0.22, h * 0.14, h * 0.2, 0.16, 0, accent, 0.32);
  band(t, h * 0.3, h * 0.1, h * 0.08, 0.22, 2.4, light, 0.15);
  band(t, h * 0.82, h * 0.1, h * 0.12, 0.12, 4.1, accent, 0.14);
}

// A worker's requestAnimationFrame follows its page's frames and stops while the page is hidden.
const nextFrame = self.requestAnimationFrame?.bind(self) ?? ((fn) => setTimeout(() => fn(performance.now()), FRAME));

function loop(now) {
  if (paused) return void (running = false);
  nextFrame(loop);
  if (now - last < FRAME) return;
  last = now;
  paint(now);
}

onmessage = ({ data }) => {
  if (data.canvas) {
    ctx = data.canvas.getContext("2d");
    still = data.still;
  }
  if (data.width) {
    w = ctx.canvas.width = Math.ceil(data.width / SCALE);
    h = ctx.canvas.height = Math.ceil(data.height / SCALE);
    ctx.filter = "blur(2px)"; // softens the stretched edges; resizing the canvas resets it
  }
  if (data.accent) ({ accent, light } = data);
  if ("paused" in data) paused = data.paused;
  if (still) paint(performance.now());
  else if (!running && !paused) {
    running = true;
    nextFrame(loop);
  }
};
