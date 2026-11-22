// Fixed-window per-IP request limit, as Express middleware. req.ip is the real client
// address once index.js trusts its reverse proxy ("trust proxy"), never a header a client wrote.
// shortcut: counts per process, so with SHADOW_WORKERS=n a client gets up to n × perMinute;
// move the counters to Redis if that ever matters.
export function rateLimit(perMinute, message = "Too many requests; try again in a minute.") {
  const hits = new Map(); // ip -> [windowStart, count]
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || now - entry[0] > 60_000) hits.set(req.ip, [now, 1]);
    else if (++entry[1] > perMinute) return res.status(429).json({ error: message });
    if (hits.size > 50_000) hits.clear(); // bounded memory; at worst everyone gets a fresh window
    next();
  };
}
