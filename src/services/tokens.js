import crypto from 'node:crypto';
import { db } from '../db.js';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * Tek kullanımlık doğrulama belirteci.
 * - kind 'link': e-posta bağlantısı için uzun rastgele değer
 * - kind 'code': SMS için 6 haneli kod
 * Veritabanında yalnızca hash'i saklanır. Aynı amaçla açık kalan eski belirteçler geçersiz kılınır.
 */
export function issueToken({ userId, purpose, target, kind, ttlMinutes }) {
  const value = kind === 'code' ? String(crypto.randomInt(0, 1_000_000)).padStart(6, '0') : crypto.randomBytes(32).toString('base64url');
  db.prepare('UPDATE verification_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(
    Date.now(),
    userId,
    purpose
  );
  db.prepare(
    'INSERT INTO verification_tokens (user_id, purpose, target, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, purpose, target, sha256(value), Date.now() + ttlMinutes * 60 * 1000);
  return value;
}

/** Bağlantı belirtecini tüketir; geçerliyse { user_id, target } döner. */
export function consumeLinkToken(purpose, value) {
  const row = db
    .prepare('SELECT * FROM verification_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?')
    .get(sha256(value), purpose, Date.now());
  if (!row) return null;
  db.prepare('UPDATE verification_tokens SET used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return row;
}

const MAX_CODE_ATTEMPTS = 5;

/** SMS kodunu kontrol eder; en fazla 5 hatalı denemeye izin verir. Sonuç: { ok, row } veya { ok:false, reason }. */
export function consumeCode(userId, purpose, code) {
  const row = db
    .prepare(
      'SELECT * FROM verification_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1'
    )
    .get(userId, purpose, Date.now());
  if (!row) return { ok: false, reason: 'Kodun süresi dolmuş. Yeni kod isteyin.' };
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'Çok fazla hatalı deneme. Yeni kod isteyin.' };

  const given = Buffer.from(sha256(String(code).trim()));
  const ok = crypto.timingSafeEqual(given, Buffer.from(row.token_hash));
  if (!ok) {
    db.prepare('UPDATE verification_tokens SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { ok: false, reason: 'Kod hatalı.' };
  }
  db.prepare('UPDATE verification_tokens SET used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return { ok: true, row };
}
