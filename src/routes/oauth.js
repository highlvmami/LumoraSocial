import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import {
  createPasswordlessUser,
  emailExists,
  findByEmail,
  findUserById,
  uniqueUsername,
} from '../models/users.js';
import { providers, redirectUriFor } from '../services/oauthProviders.js';
import { startSession } from '../services/session.js';
import { log } from '../models/audit.js';

/*
 * Sosyal giriş akışı:
 *   /auth/:provider/start      → sağlayıcıya yönlendirir (?link=1 ise giriş yapmış kullanıcının hesabına bağlar)
 *   /auth/:provider/callback   → sağlayıcı geri döner; hesap bulunur/oluşturulur/bağlanır
 * CSRF'ye karşı `state` hem veritabanında hem de kısa ömürlü bir çerezde tutulur ve eşleşmesi gerekir.
 */

const router = Router();
const STATE_COOKIE = 'lumora.oauth';
const STATE_TTL = 10 * 60 * 1000;

function getProvider(req) {
  const p = providers[req.params.provider];
  return p && p.enabled() ? p : null;
}

function readCookie(req, name) {
  const pair = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

/**
 * Sağlayıcıdan dönüş siteler arası bir gezinme olduğu için SameSite=Strict oturum çerezi
 * yönlendirmede gönderilmez. Bu küçük sayfa, aynı siteden yeni bir gezinme başlatarak sorunu çözer.
 */
function bridge(res, target) {
  const safe = target.replace(/[^\w/#?=&.%-]/g, '');
  res.set('Content-Type', 'text/html; charset=utf-8').send(
    `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"><title>Yönlendiriliyor…</title></head><body><a href="${safe}">Devam et</a></body></html>`
  );
}

const fail = (res, message) => bridge(res, `/?hata=${encodeURIComponent(message)}`);

router.get('/:provider/start', (req, res) => {
  const provider = getProvider(req);
  if (!provider) return fail(res, 'Bu giriş yöntemi etkin değil.');

  const state = crypto.randomBytes(24).toString('base64url');
  const linkUserId = req.query.link === '1' && req.user ? req.user.id : null;
  db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO oauth_states (state, provider, link_user_id, expires_at) VALUES (?, ?, ?, ?)').run(
    state,
    req.params.provider,
    linkUserId,
    Date.now() + STATE_TTL
  );
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: STATE_TTL,
    path: '/auth',
    sameSite: 'lax',
    secure: config.isProduction,
  });
  res.redirect(provider.authUrl(state, redirectUriFor(req.params.provider)));
});

async function callback(req, res) {
  const key = req.params.provider;
  const provider = getProvider(req);
  if (!provider) return fail(res, 'Bu giriş yöntemi etkin değil.');

  const params = req.query;
  if (params.error) return fail(res, 'Giriş iptal edildi.');

  // state doğrulaması
  const cookieState = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, { path: '/auth' });
  const row = db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(String(params.state || ''));
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(String(params.state || ''));
  if (!row || row.provider !== key || row.expires_at < Date.now() || !cookieState || cookieState !== row.state) {
    return fail(res, 'Oturum doğrulanamadı, lütfen tekrar deneyin.');
  }

  let profile;
  try {
    profile = await provider.fetchProfile(String(params.code || ''), redirectUriFor(key));
  } catch (err) {
    console.error(`[oauth:${key}]`, err.message);
    return fail(res, `${provider.label} ile bağlantı kurulamadı.`);
  }

  const linked = db.prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?').get(key, profile.id);

  // 1) Ayarlar'dan hesap bağlama
  if (row.link_user_id) {
    if (linked && linked.user_id !== row.link_user_id) {
      return bridge(res, `/akis#/ayarlar/hesap?hata=${encodeURIComponent(`Bu ${provider.label} hesabı başka bir kullanıcıya bağlı.`)}`);
    }
    db.prepare('INSERT OR REPLACE INTO oauth_accounts (provider, provider_user_id, user_id, email) VALUES (?, ?, ?, ?)').run(
      key,
      profile.id,
      row.link_user_id,
      profile.email
    );
    log(req, 'account.oauth_link', { actorId: row.link_user_id, data: { provider: key } });
    return bridge(res, `/akis#/ayarlar/hesap?bilgi=${encodeURIComponent(`${provider.label} hesabın bağlandı.`)}`);
  }

  // 2) Daha önce bağlanmış hesap → giriş
  let user = linked ? findUserById(linked.user_id) : null;

  // 3) Aynı doğrulanmış e-postaya sahip hesap → bağla ve giriş yap
  //    (yerel e-posta doğrulanmamışsa bağlanmaz: başkasının adresini önceden kaydedip hesabı ele geçirmeyi önler)
  if (!user && profile.email && profile.emailVerified) {
    const byEmail = findByEmail(profile.email);
    if (byEmail?.email_verified_at) user = byEmail;
  }

  // 4) Yeni hesap
  if (!user) {
    const base = profile.email ? profile.email.split('@')[0] : profile.name || key;
    const email = profile.email && profile.emailVerified && !emailExists(profile.email) ? profile.email : null;
    user = await createPasswordlessUser({
      username: uniqueUsername(base),
      displayName: (profile.name || base).slice(0, 50),
      email,
      emailVerified: Boolean(email),
    });
    log(req, 'user.register_oauth', { actorId: user.id, data: { provider: key } });
  }

  if (!linked) {
    db.prepare('INSERT OR IGNORE INTO oauth_accounts (provider, provider_user_id, user_id, email) VALUES (?, ?, ?, ?)').run(
      key,
      profile.id,
      user.id,
      profile.email
    );
  }
  if (user.status !== 'active') return fail(res, 'Hesabınız askıya alınmış. Bir yöneticiyle iletişime geçin.');

  await startSession(req, user, { method: key });
  log(req, 'auth.login_oauth', { actorId: user.id, data: { provider: key } });
  bridge(res, '/akis');
}

router.get('/:provider/callback', callback);

export default router;
