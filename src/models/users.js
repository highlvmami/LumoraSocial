import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { removeUpload } from '../uploads.js';
import { removeUserImageFiles } from './posts.js';

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];
const BCRYPT_ROUNDS = 12;

/** Gizlilik ayarlarının varsayılanları. Görünürlük: 'public' | 'followers' | 'private' */
export const DEFAULT_PRIVACY = {
  privateAccount: false, // true: paylaşımları yalnızca onaylı takipçiler görür, takip istek ile olur
  birthDate: 'followers',
  location: 'public',
  contact: 'private', // e-posta ve telefon profilde
};

export const SOCIAL_KEYS = ['instagram', 'x', 'youtube', 'tiktok', 'linkedin', 'github', 'facebook'];

const parseJson = (s, fallback) => {
  try {
    return JSON.parse(s) ?? fallback;
  } catch {
    return fallback;
  }
};

export const privacyOf = (u) => ({ ...DEFAULT_PRIVACY, ...parseJson(u.privacy, {}) });

/** Listelerde ve kartlarda kullanılan özet kullanıcı nesnesi (gizli bilgi içermez). */
export function toPublic(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    bio: u.bio,
    avatarColor: u.avatar_color,
    avatarUrl: u.avatar_url ?? null,
    isVerified: Boolean(u.is_verified),
    role: u.role,
    status: u.status,
    createdAt: u.created_at,
  };
}

/** Kullanıcının kendisine gösterilen tam nesne. */
export function toSelf(u) {
  if (!u) return null;
  return {
    ...toPublic(u),
    ...profileDetails(u),
    email: u.email ?? null,
    emailVerified: Boolean(u.email_verified_at),
    phone: u.phone ?? null,
    phoneVerified: Boolean(u.phone_verified_at),
    hasPassword: Boolean(u.has_password),
    privacy: privacyOf(u),
  };
}

function profileDetails(u) {
  return {
    coverUrl: u.cover_url ?? null,
    birthDate: u.birth_date ?? null,
    location: u.location,
    website: u.website,
    socialLinks: parseJson(u.social_links, {}),
    occupation: u.occupation,
    education: u.education,
    interests: parseJson(u.interests, []),
  };
}

/**
 * Başka birinin profili: gizlilik ayarlarına göre alanlar süzülür.
 * rel: { isSelf, isFollower (onaylı), isAdmin }
 */
export function toProfile(u, rel) {
  const privacy = privacyOf(u);
  const can = (level) => rel.isSelf || rel.isAdmin || level === 'public' || (level === 'followers' && rel.isFollower);
  const details = profileDetails(u);
  return {
    ...toPublic(u),
    ...details,
    birthDate: can(privacy.birthDate) ? details.birthDate : null,
    location: can(privacy.location) ? details.location : '',
    email: can(privacy.contact) && u.email_verified_at ? u.email : null,
    phone: can(privacy.contact) && u.phone_verified_at ? u.phone : null,
    privateAccount: privacy.privateAccount,
  };
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function findByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username));
}

export function findByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email));
}

export function findByPhone(phone) {
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(String(phone));
}

/** Giriş için: kullanıcı adı, e-posta veya telefon ile arar. */
export function findByLogin(identifier, normalizePhone) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  if (id.includes('@')) return findByEmail(id);
  const phone = normalizePhone(id);
  if (phone) return findByPhone(phone) ?? findByUsername(id);
  return findByUsername(id);
}

export const findUserWithHash = findByUsername;

export function usernameExists(username, exceptId = 0) {
  return !!db.prepare('SELECT 1 FROM users WHERE username = ? AND id <> ?').get(username, exceptId);
}

export function emailExists(email, exceptId = 0) {
  return !!db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, exceptId);
}

export function phoneExists(phone, exceptId = 0) {
  return !!db.prepare('SELECT 1 FROM users WHERE phone = ? AND id <> ?').get(phone, exceptId);
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function createUser({ username, password, displayName, role = 'member', email = null, phone = null }) {
  return insertUser({ username, hash: await hashPassword(password), displayName, role, email, phone });
}

/** Senkron ekleme; önceden hash'lenmiş şifreyle işlem (transaction) içinde kullanılabilir. */
export function insertUser({ username, hash, displayName, role = 'member', email = null, phone = null, hasPassword = true }) {
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO users (username, password_hash, display_name, avatar_color, role, email, phone, has_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(username, hash, displayName, color, role, email, phone, hasPassword ? 1 : 0);
  return findUserById(Number(lastInsertRowid));
}

/** Sosyal girişle açılan hesaplar için kullanılamaz (rastgele) şifre. */
export async function createPasswordlessUser({ username, displayName, email = null, emailVerified = false }) {
  const hash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const user = insertUser({ username, hash, displayName, email, hasPassword: false });
  if (emailVerified) db.prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?").run(user.id);
  return findUserById(user.id);
}

/** Kullanıcı adı müsait değilse sonuna sayı ekler. */
export function uniqueUsername(base) {
  let clean = String(base || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-zA-Z0-9_.]/g, '')
    .slice(0, 18);
  if (clean.length < 3) clean = `uye${clean}`;
  let candidate = clean;
  for (let i = 1; usernameExists(candidate); i++) candidate = `${clean}${i}`;
  return candidate;
}

export async function verifyPassword(user, password) {
  if (!user?.has_password) return false;
  return bcrypt.compare(password, user.password_hash);
}

export async function setPassword(id, password) {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ?, has_password = 1 WHERE id = ?').run(hash, id);
}

const PROFILE_COLUMNS = {
  displayName: 'display_name',
  bio: 'bio',
  avatarColor: 'avatar_color',
  birthDate: 'birth_date',
  location: 'location',
  website: 'website',
  socialLinks: 'social_links',
  occupation: 'occupation',
  education: 'education',
  interests: 'interests',
  username: 'username',
};

/** Yalnızca verilen alanları günceller. Nesne/dizi alanları JSON olarak saklanır. */
export function updateProfile(id, changes) {
  const sets = [];
  const values = [];
  for (const [key, col] of Object.entries(PROFILE_COLUMNS)) {
    if (changes[key] === undefined) continue;
    const val = changes[key];
    sets.push(`${col} = ?`);
    values.push(val !== null && typeof val === 'object' ? JSON.stringify(val) : val);
  }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  return findUserById(id);
}

export function setPrivacy(id, privacy) {
  db.prepare('UPDATE users SET privacy = ? WHERE id = ?').run(JSON.stringify(privacy), id);
}

/** Yeni fotoğraf URL'sini yazar, eskisini döner (silinmesi için). */
export function setAvatarUrl(id, url) {
  const old = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(id)?.avatar_url ?? null;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(url, id);
  return old;
}

export function setCoverUrl(id, url) {
  const old = db.prepare('SELECT cover_url FROM users WHERE id = ?').get(id)?.cover_url ?? null;
  db.prepare('UPDATE users SET cover_url = ? WHERE id = ?').run(url, id);
  return old;
}

export function setEmail(id, email) {
  db.prepare('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?').run(email, id);
}

export function markEmailVerified(id, email) {
  // Doğrulama bağlantısı eski bir adrese aitse işaretleme
  return db.prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND email = ?").run(id, email).changes > 0;
}

export function setPhone(id, phone) {
  db.prepare('UPDATE users SET phone = ?, phone_verified_at = NULL WHERE id = ?').run(phone, id);
}

export function markPhoneVerified(id, phone) {
  return db.prepare("UPDATE users SET phone_verified_at = datetime('now') WHERE id = ? AND phone = ?").run(id, phone).changes > 0;
}

export function setVerifiedBadge(id, value) {
  db.prepare('UPDATE users SET is_verified = ? WHERE id = ?').run(value ? 1 : 0, id);
}

export function listUsers({ search = '' } = {}) {
  const q = `%${search}%`;
  return db
    .prepare(
      `SELECT *, (SELECT COUNT(*) FROM posts p WHERE p.user_id = users.id) AS post_count
       FROM users
       WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ?
       ORDER BY id DESC`
    )
    .all(q, q, q)
    .map((u) => ({
      ...toPublic(u),
      email: u.email,
      emailVerified: Boolean(u.email_verified_at),
      phone: u.phone,
      phoneVerified: Boolean(u.phone_verified_at),
      postCount: u.post_count,
    }));
}

export function countActiveAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get().n;
}

export function setRole(id, role) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

/** Kullanıcının oturumlarını kapatır; exceptSid verilirse o oturum açık kalır. */
export function destroySessions(userId, exceptSid = null) {
  db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.userId') = ? AND sid IS NOT ?").run(userId, exceptSid);
}

export function setStatus(id, status) {
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  if (status === 'banned') destroySessions(id);
}

export function deleteUser(id) {
  const u = db.prepare('SELECT avatar_url, cover_url FROM users WHERE id = ?').get(id);
  removeUpload(u?.avatar_url);
  removeUpload(u?.cover_url);
  removeUserImageFiles(id);
  destroySessions(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function getStats() {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
         (SELECT COUNT(*) FROM posts) AS posts,
         (SELECT COUNT(*) FROM comments) AS comments`
    )
    .get();
}

export { AVATAR_COLORS };
