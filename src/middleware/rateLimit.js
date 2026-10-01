/**
 * Basit bellek içi hız sınırlayıcı (kaba kuvvet denemelerine karşı).
 * Yalnızca başarısız denemeler sayılır: route, başarısızlıkta `req.rateLimit.fail()` çağırır.
 */
/** Her isteği sayan sınırlayıcı (ör. kod/e-posta gönderme). */
export function requestLimiter(opts) {
  const limiter = failureLimiter(opts);
  return (req, res, next) =>
    limiter(req, res, () => {
      req.rateLimit.fail();
      next();
    });
}

export function failureLimiter({ max, windowMs, message }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    if (entry.count >= max) {
      const minutes = Math.ceil((entry.reset - now) / 60000);
      return res.status(429).json({ error: `${message} ${minutes} dakika sonra tekrar deneyin.` });
    }
    req.rateLimit = { fail: () => entry.count++ };
    next();
  };
}
