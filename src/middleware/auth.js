import { findUserById } from '../models/users.js';

/** Oturumdaki kullanıcıyı her istekte veritabanından yükler (rol/ban değişiklikleri anında etkili olur). */
export function loadUser(req, _res, next) {
  req.user = null;
  const id = req.session?.userId;
  if (id) {
    const user = findUserById(id);
    if (user && user.status === 'active') {
      req.user = user;
    } else {
      delete req.session.userId;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Lütfen giriş yapın.' });
  next();
}

/** Yönetici veya denetimci (şikâyetler ve içerik kaldırma) */
export const isStaff = (u) => Boolean(u && (u.role === 'admin' || u.is_moderator));

export function requireStaff(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Lütfen giriş yapın.' });
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Bu işlem için denetimci yetkisi gerekir.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Lütfen giriş yapın.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekir.' });
  next();
}
