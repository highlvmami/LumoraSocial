import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requestLimiter } from '../middleware/rateLimit.js';
import * as v from '../validation.js';
import {
  DEFAULT_PRIVACY,
  destroySessions,
  emailExists,
  findUserById,
  markPhoneVerified,
  phoneExists,
  privacyOf,
  setEmail,
  setPassword,
  setPhone,
  setPrivacy,
  toSelf,
  updateProfile,
  usernameExists,
  verifyPassword,
} from '../models/users.js';
import { acceptAllRequests, acceptRequest, listRequests, unfollow } from '../models/follows.js';
import { notify, removeFollowRequestNotification } from '../models/notifications.js';
import { consumeCode } from '../services/tokens.js';
import { sendEmailVerification, sendPhoneCode } from '../services/verification.js';
import { enabledProviders } from '../services/oauthProviders.js';
import { log } from '../models/audit.js';
import { listBlocked } from '../models/safety.js';

/* Ayarlar sayfasının API'si: hesap bilgileri, güvenlik (şifre, oturumlar, cihazlar), bağlı hesaplar, gizlilik, takip istekleri. */

const router = Router();
router.use(requireAuth);

const sendLimiter = requestLimiter({ max: 6, windowMs: 30 * 60 * 1000, message: 'Çok fazla kod/e-posta isteği.' });
const codeLimiter = requestLimiter({ max: 15, windowMs: 30 * 60 * 1000, message: 'Çok fazla deneme.' });

const fresh = (req) => findUserById(req.user.id);
const selfResponse = (req) => ({ user: toSelf(fresh(req)) });

/** Hassas değişikliklerde (e-posta/telefon) mevcut şifre istenir; şifresi olmayan sosyal giriş hesapları hariç. */
async function confirmPassword(req) {
  const u = fresh(req);
  if (!u.has_password) return;
  if (!(await verifyPassword(u, String(req.body.currentPassword || '')))) throw v.bad('Mevcut şifre hatalı.');
}

/** Hesaba giriş yapmanın en az bir yolu kalmalı (şifre veya bağlı sosyal hesap). */
function loginMethodCount(userId) {
  const u = findUserById(userId);
  const links = db.prepare('SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ?').get(userId).n;
  return (u.has_password ? 1 : 0) + links;
}

/* ---------- Kullanıcı adı ---------- */

router.patch('/username', (req, res) => {
  const username = v.username(req.body.username);
  if (usernameExists(username, req.user.id)) throw v.bad('Bu kullanıcı adı zaten alınmış.');
  log(req, 'account.username', { data: { from: req.user.username, to: username } });
  updateProfile(req.user.id, { username });
  res.json(selfResponse(req));
});

/* ---------- E-posta ---------- */

router.put('/email', sendLimiter, async (req, res) => {
  await confirmPassword(req);
  const email = v.email(req.body.email);
  if (emailExists(email, req.user.id)) throw v.bad('Bu e-posta adresiyle zaten bir hesap var.');
  setEmail(req.user.id, email);
  log(req, 'account.email', { data: { email } });
  await sendEmailVerification(fresh(req));
  res.json(selfResponse(req));
});

router.post('/email/resend', sendLimiter, async (req, res) => {
  const u = fresh(req);
  if (!u.email) throw v.bad('Kayıtlı e-posta adresin yok.');
  if (u.email_verified_at) throw v.bad('E-posta adresin zaten doğrulanmış.');
  await sendEmailVerification(u);
  res.json({ ok: true });
});

router.delete('/email', (req, res) => {
  setEmail(req.user.id, null);
  res.json(selfResponse(req));
});

/* ---------- Telefon ---------- */

router.put('/phone', sendLimiter, async (req, res) => {
  await confirmPassword(req);
  const phone = v.phone(req.body.phone);
  if (phoneExists(phone, req.user.id)) throw v.bad('Bu telefon numarasıyla zaten bir hesap var.');
  setPhone(req.user.id, phone);
  log(req, 'account.phone', { data: { phone } });
  await sendPhoneCode(fresh(req));
  res.json(selfResponse(req));
});

router.post('/phone/send-code', sendLimiter, async (req, res) => {
  const u = fresh(req);
  if (!u.phone) throw v.bad('Kayıtlı telefon numaran yok.');
  if (u.phone_verified_at) throw v.bad('Telefon numaran zaten doğrulanmış.');
  await sendPhoneCode(u);
  res.json({ ok: true });
});

router.post('/phone/verify', codeLimiter, (req, res) => {
  const u = fresh(req);
  const result = consumeCode(u.id, 'phone_verify', req.body.code);
  if (!result.ok) throw v.bad(result.reason);
  if (!markPhoneVerified(u.id, result.row.target)) throw v.bad('Numara değişmiş; yeni kod iste.');
  log(req, 'account.phone_verified', { data: { phone: result.row.target } });
  res.json(selfResponse(req));
});

router.delete('/phone', (req, res) => {
  setPhone(req.user.id, null);
  res.json(selfResponse(req));
});

/* ---------- Şifre ---------- */

router.post('/password', async (req, res) => {
  const u = fresh(req);
  if (u.has_password && !(await verifyPassword(u, String(req.body.currentPassword || '')))) {
    throw v.bad('Mevcut şifre hatalı.');
  }
  await setPassword(u.id, v.newPassword(req.body.newPassword, req.body.newPasswordConfirm));
  // Diğer cihazlardaki oturumları kapat, bu oturum açık kalsın
  destroySessions(u.id, req.sessionID);
  log(req, 'account.password', { data: { firstTime: !u.has_password } });
  res.json(selfResponse(req));
});

/* ---------- Oturumlar ve cihazlar ---------- */

// Oturum kimliği (sid) istemciye verilmez; yerine hash'inin kısaltması kullanılır.
const publicSessionId = (sid) => crypto.createHash('sha256').update(sid).digest('hex').slice(0, 16);

function userSessions(userId) {
  return db
    .prepare("SELECT sid, data, expires FROM sessions WHERE json_extract(data, '$.userId') = ? AND expires > ?")
    .all(userId, Date.now())
    .map((row) => ({ sid: row.sid, data: JSON.parse(row.data) }));
}

router.get('/sessions', (req, res) => {
  const sessions = userSessions(req.user.id)
    .map(({ sid, data }) => ({
      id: publicSessionId(sid),
      device: data.device || 'Bilinmeyen cihaz',
      ip: data.ip || '',
      method: data.method || 'password',
      createdAt: data.createdAt || null,
      lastSeen: data.lastSeen || null,
      current: sid === req.sessionID,
    }))
    .sort((a, b) => b.current - a.current || (b.lastSeen || 0) - (a.lastSeen || 0));
  const devices = db
    .prepare('SELECT label, first_seen, last_seen FROM known_devices WHERE user_id = ? ORDER BY last_seen DESC')
    .all(req.user.id)
    .map((d) => ({ label: d.label, firstSeen: d.first_seen, lastSeen: d.last_seen }));
  res.json({ sessions, devices });
});

router.delete('/sessions/:id', (req, res) => {
  const target = userSessions(req.user.id).find((s) => publicSessionId(s.sid) === req.params.id);
  if (!target) throw new v.HttpError(404, 'Oturum bulunamadı.');
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(target.sid);
  res.json({ ok: true, current: target.sid === req.sessionID });
});

/** Tüm cihazlardan çıkış. includeCurrent: true ise bu cihazdan da çıkılır. */
router.post('/sessions/logout-all', (req, res) => {
  destroySessions(req.user.id, req.body.includeCurrent ? null : req.sessionID);
  log(req, 'account.logout_all', { data: { includeCurrent: Boolean(req.body.includeCurrent) } });
  res.json({ ok: true });
});

/* ---------- Bağlı hesaplar (Google/GitHub) ---------- */

router.get('/linked', (req, res) => {
  const rows = db.prepare('SELECT provider, email, created_at FROM oauth_accounts WHERE user_id = ?').all(req.user.id);
  const available = enabledProviders();
  const keys = new Set([...available.map((p) => p.key), ...rows.map((r) => r.provider)]);
  const labels = { google: 'Google', github: 'GitHub' };
  res.json({
    accounts: [...keys].map((key) => {
      const row = rows.find((r) => r.provider === key);
      return {
        key,
        label: labels[key] || key,
        enabled: available.some((p) => p.key === key),
        linked: Boolean(row),
        email: row?.email || null,
      };
    }),
  });
});

router.delete('/linked/:provider', (req, res) => {
  const exists = db.prepare('SELECT 1 FROM oauth_accounts WHERE user_id = ? AND provider = ?').get(req.user.id, req.params.provider);
  if (!exists) throw new v.HttpError(404, 'Bağlı hesap bulunamadı.');
  if (loginMethodCount(req.user.id) <= 1) {
    throw v.bad('Bu, hesabına giriş yapmanın tek yolu. Önce Güvenlik bölümünden bir şifre belirle.');
  }
  db.prepare('DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?').run(req.user.id, req.params.provider);
  log(req, 'account.oauth_unlink', { data: { provider: req.params.provider } });
  res.json({ ok: true });
});

/* ---------- Gizlilik ---------- */

router.put('/privacy', (req, res) => {
  const current = privacyOf(fresh(req));
  const levels = ['public', 'followers', 'private'];
  const next = { ...DEFAULT_PRIVACY, ...current };
  if (req.body.privateAccount !== undefined) next.privateAccount = Boolean(req.body.privateAccount);
  for (const key of ['birthDate', 'location', 'contact']) {
    if (req.body[key] !== undefined) next[key] = v.oneOf(req.body[key], levels, 'Gizlilik seçeneği');
  }
  setPrivacy(req.user.id, next);
  if (current.privateAccount !== next.privateAccount) log(req, 'account.privacy', { data: { privateAccount: next.privateAccount } });
  // Hesap herkese açık yapıldıysa bekleyen istekler kabul edilir
  if (current.privateAccount && !next.privateAccount) acceptAllRequests(req.user.id);
  res.json(selfResponse(req));
});

/* ---------- Engellenen kişiler ---------- */

router.get('/blocked', (req, res) => res.json({ users: listBlocked(req.user.id) }));

/* ---------- Takip istekleri (gizli hesaplar) ---------- */

router.get('/follow-requests', (req, res) => res.json({ requests: listRequests(req.user.id) }));

router.post('/follow-requests/:userId/accept', (req, res) => {
  const followerId = v.id(req.params.userId);
  if (!acceptRequest(followerId, req.user.id)) throw new v.HttpError(404, 'İstek bulunamadı.');
  removeFollowRequestNotification(req.user.id, followerId);
  notify(followerId, 'follow_accepted', { actorId: req.user.id });
  res.json({ requests: listRequests(req.user.id) });
});

router.post('/follow-requests/:userId/reject', (req, res) => {
  const followerId = v.id(req.params.userId);
  unfollow(followerId, req.user.id);
  removeFollowRequestNotification(req.user.id, followerId);
  res.json({ requests: listRequests(req.user.id) });
});

export default router;
