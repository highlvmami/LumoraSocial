import { clientIp, onSuccessfulLogin, parseUserAgent } from './devices.js';

/**
 * Kullanıcı için yeni oturum açar (session fixation'a karşı kimlik yenilenir)
 * ve cihaz bilgisini oturuma yazar (Ayarlar > Güvenlik'te listelenir).
 */
export function startSession(req, user, { method = 'password' } = {}) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      const now = Date.now();
      Object.assign(req.session, {
        userId: user.id,
        device: parseUserAgent(req.get('user-agent')).label,
        ip: clientIp(req),
        method,
        createdAt: now,
        lastSeen: now,
      });
      req.session.save((err2) => {
        if (err2) return reject(err2);
        onSuccessfulLogin(user, req);
        resolve();
      });
    });
  });
}

/** Oturumdaki "son görülme" bilgisini en fazla 5 dakikada bir günceller. */
export function trackLastSeen(req, _res, next) {
  if (req.session?.userId && Date.now() - (req.session.lastSeen || 0) > 5 * 60 * 1000) {
    req.session.lastSeen = Date.now();
    req.session.ip = clientIp(req);
  }
  next();
}
