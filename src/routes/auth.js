import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { getSetting, setSetting, transaction } from '../db.js';
import { failureLimiter, requestLimiter } from '../middleware/rateLimit.js';
import * as v from '../validation.js';
import {
  createUser,
  destroySessions,
  emailExists,

  findByLogin,
  findByPhone,
  findUserById,
  hashPassword,
  insertUser,
  markEmailVerified,
  phoneExists,
  setPassword,
  toSelf,
  usernameExists,
  verifyPassword,
} from '../models/users.js';
import { unreadCount } from '../models/notifications.js';
import { unreadMessageCount } from '../models/messages.js';
import { log } from '../models/audit.js';
import { recordFailedLogin, clientIp } from '../services/devices.js';
import { startSession } from '../services/session.js';
import { consumeCode, consumeLinkToken } from '../services/tokens.js';
import { sendEmailVerification, sendPasswordReset, sendPhoneCode } from '../services/verification.js';
import { enabledProviders } from '../services/oauthProviders.js';

const router = Router();

const loginLimiter = failureLimiter({ max: 10, windowMs: 15 * 60 * 1000, message: 'Çok fazla hatalı giriş denemesi.' });
const setupLimiter = failureLimiter({ max: 5, windowMs: 30 * 60 * 1000, message: 'Çok fazla hatalı anahtar denemesi.' });
const registerLimiter = requestLimiter({ max: 10, windowMs: 60 * 60 * 1000, message: 'Çok fazla kayıt denemesi.' });
const forgotLimiter = requestLimiter({ max: 5, windowMs: 30 * 60 * 1000, message: 'Çok fazla şifre sıfırlama isteği.' });
const resetLimiter = failureLimiter({ max: 10, windowMs: 30 * 60 * 1000, message: 'Çok fazla hatalı deneme.' });

function keysMatch(given, expected) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

const adminSetupAvailable = () => Boolean(config.adminSetupKey) && getSetting('admin_setup_done') !== '1';

/** Oturumdaki kullanıcı (tam bilgi) + okunmamış bildirim sayısı. */
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: toSelf(req.user), unreadNotifications: unreadCount(req.user.id), unreadMessages: unreadMessageCount(req.user.id) });
});

/** Giriş ekranında hangi sosyal giriş butonlarının gösterileceği. */
router.get('/providers', (_req, res) => res.json({ providers: enabledProviders() }));

/**
 * Kayıt. method: 'username' | 'email' | 'phone'.
 * Kullanıcı adı her durumda gerekir (profil adresi olarak kullanılır).
 */
router.post('/register', registerLimiter, async (req, res) => {
  const method = v.oneOf(req.body.method || 'username', ['username', 'email', 'phone'], 'Kayıt yöntemi');
  const username = v.username(req.body.username);
  const password = v.newPassword(req.body.password, req.body.passwordConfirm);
  const displayName = v.displayName(req.body.displayName || username);
  const email = method === 'email' ? v.email(req.body.email) : null;
  const phone = method === 'phone' ? v.phone(req.body.phone) : null;

  if (usernameExists(username)) throw v.bad('Bu kullanıcı adı zaten alınmış.');
  if (email && emailExists(email)) throw v.bad('Bu e-posta adresiyle zaten bir hesap var.');
  if (phone && phoneExists(phone)) throw v.bad('Bu telefon numarasıyla zaten bir hesap var.');

  const user = await createUser({ username, password, displayName, role: 'member', email, phone });
  log(req, 'user.register', { actorId: user.id, data: { method } });
  await startSession(req, user);
  if (email) await sendEmailVerification(user);
  if (phone) await sendPhoneCode(user);
  res.status(201).json({ user: toSelf(user) });
});

/** Giriş: kullanıcı adı, e-posta veya telefon + şifre. */
router.post('/login', loginLimiter, async (req, res) => {
  const identifier = String(req.body.identifier ?? req.body.username ?? '').trim();
  const password = String(req.body.password || '');
  const user = findByLogin(identifier, v.normalizePhone);

  if (!user || !(await verifyPassword(user, password))) {
    req.rateLimit.fail();
    if (user) recordFailedLogin(user.id, clientIp(req));
    log(req, 'auth.login_failed', { actorId: null, targetId: user?.id ?? null, data: { identifier: identifier.slice(0, 80), reason: user ? 'wrong_password' : 'unknown_user' } });
    const hint = user && !user.has_password ? ' Bu hesap sosyal girişle açılmış; Google/GitHub ile giriş yapın.' : '';
    return res.status(401).json({ error: `Giriş bilgileri hatalı.${hint}` });
  }
  if (user.status !== 'active') {
    log(req, 'auth.login_failed', { actorId: null, targetId: user.id, data: { identifier: identifier.slice(0, 80), reason: 'banned' } });
    return res.status(403).json({ error: 'Hesabınız askıya alınmış. Bir yöneticiyle iletişime geçin.' });
  }
  if (req.body.adminOnly && user.role !== 'admin') {
    return res.status(403).json({ error: 'Bu hesap yönetici değil. Üye girişini kullanın.' });
  }

  await startSession(req, user);
  log(req, 'auth.login', { actorId: user.id, data: { method: 'password', admin: Boolean(req.body.adminOnly) } });
  res.json({ user: toSelf(user) });
});

router.post('/logout', (req, res) => {
  if (req.user) log(req, 'auth.logout');
  req.session.destroy(() => {
    res.clearCookie('lumora.sid');
    res.json({ ok: true });
  });
});

/* ---- Şifremi unuttum ---- */

const GENERIC_RESET_MSG =
  'Bu bilgilerle doğrulanmış bir hesap varsa sıfırlama bağlantısı veya kodu gönderildi. Doğrulanmış e-posta ya da telefonun yoksa bir yöneticiden şifre sıfırlamasını iste.';

router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  const phone = identifier.includes('@') ? null : v.normalizePhone(identifier);
  const user = findByLogin(identifier, v.normalizePhone);

  if (user) log(req, 'account.password_reset_request', { actorId: null, targetId: user.id });
  if (user && user.status === 'active') {
    // Telefonla istendiyse SMS, değilse doğrulanmış e-posta; o yoksa doğrulanmış telefon
    if (phone && user.phone === phone && user.phone_verified_at) await sendPasswordReset(user, 'phone');
    else if (user.email && user.email_verified_at) await sendPasswordReset(user, 'email');
    else if (user.phone && user.phone_verified_at) await sendPasswordReset(user, 'phone');
  }
  // Hesabın var olup olmadığını belli etmemek için her durumda aynı yanıt
  res.json({ ok: true, message: GENERIC_RESET_MSG, codeStep: Boolean(phone) });
});

/** Şifreyi yeniler: e-posta bağlantısındaki token ile ya da telefon + SMS kodu ile. */
router.post('/reset-password', resetLimiter, async (req, res) => {
  const password = v.newPassword(req.body.password, req.body.passwordConfirm);
  let user;

  if (req.body.token) {
    const row = consumeLinkToken('password_reset', String(req.body.token));
    if (!row) {
      req.rateLimit.fail();
      throw v.bad('Bağlantı geçersiz veya süresi dolmuş. Yeniden şifre sıfırlama iste.');
    }
    user = findUserById(row.user_id);
    markEmailVerified(user.id, row.target); // bağlantıyı açabildiyse e-posta ona aittir
  } else {
    const phone = v.phone(req.body.phone);
    user = findByPhone(phone);
    const result = user?.phone_verified_at ? consumeCode(user.id, 'password_reset', req.body.code) : { ok: false, reason: 'Kod hatalı.' };
    if (!result.ok) {
      req.rateLimit.fail();
      throw v.bad(result.reason);
    }
  }

  await setPassword(user.id, password);
  destroySessions(user.id); // şifre değişince tüm cihazlardan çıkış
  log(req, 'account.password_reset', { actorId: user.id, data: { via: req.body.token ? 'email' : 'phone' } });
  res.json({ ok: true });
});

/* ---- E-posta doğrulama bağlantısı (e-postadaki link bu sayfayı açar) ---- */

export function emailVerifyPage(req, res) {
  const row = consumeLinkToken('email_verify', String(req.query.token || ''));
  const ok = row && markEmailVerified(row.user_id, row.target);
  if (ok) log(req, 'account.email_verified', { actorId: row.user_id, data: { email: row.target } });
  res.redirect(`/dogrulama-sonucu?durum=${ok ? 'ok' : 'hata'}`);
}

/* ---- İlk yönetici kaydı (yalnızca bir kez, .env'deki ADMIN_SETUP_KEY ile) ---- */

router.get('/admin-setup', (_req, res) => {
  res.json({
    available: adminSetupAvailable(),
    keyConfigured: Boolean(config.adminSetupKey),
  });
});

router.post('/admin-setup', setupLimiter, async (req, res) => {
  if (!config.adminSetupKey) {
    return res.status(403).json({ error: 'Yönetici anahtarı sunucuda ayarlanmamış (.env → ADMIN_SETUP_KEY).' });
  }
  if (getSetting('admin_setup_done') === '1') {
    return res.status(403).json({ error: 'İlk yönetici kaydı daha önce yapılmış. Bu sayfa artık kullanılamaz.' });
  }
  if (!keysMatch(req.body.key || '', config.adminSetupKey)) {
    req.rateLimit.fail();
    return res.status(401).json({ error: 'Anahtar (KEY) hatalı.' });
  }

  const username = v.username(req.body.username);
  const password = v.newPassword(req.body.password, req.body.passwordConfirm);
  const displayName = v.displayName(req.body.displayName || username);
  const hash = await hashPassword(password);

  // Kontrol + ekleme tek işlemde: aynı anda iki istek gelse bile yalnızca biri başarılı olur.
  const user = transaction(() => {
    if (getSetting('admin_setup_done') === '1') throw new v.HttpError(403, 'İlk yönetici kaydı daha önce yapılmış.');
    if (usernameExists(username)) throw v.bad('Bu kullanıcı adı zaten alınmış.');
    const created = insertUser({ username, hash, displayName, role: 'admin' });
    setSetting('admin_setup_done', '1');
    return created;
  });

  log(req, 'admin.setup', { actorId: user.id });
  await startSession(req, user);
  res.status(201).json({ user: toSelf(user) });
});

export default router;
