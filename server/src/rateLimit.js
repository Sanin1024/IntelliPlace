function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map();
  let lastSweep = now();
  function sweep(t) {
    if (t - lastSweep < windowMs) return;
    lastSweep = t;
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  }
  return function limiter(req, res, next) {
    const t = now();
    sweep(t);
    const key = req.ip || 'unknown';
    let e = hits.get(key);
    if (!e || e.reset <= t) { e = { count: 0, reset: t + windowMs }; hits.set(key, e); }
    e.count++;
    if (e.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((e.reset - t) / 1000))));
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    next();
  };
}
module.exports = { createRateLimiter };
