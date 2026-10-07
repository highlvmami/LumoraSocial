import { isOffensive } from './services/moderation.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);

export function str(value, { field, min = 0, max, trim = true }) {
  if (typeof value !== 'string') value = value == null ? '' : String(value);
  if (trim) value = value.trim();
  if (value.length < min) throw bad(min === 1 ? `${field} boş olamaz.` : `${field} en az ${min} karakter olmalı.`);
  if (max && value.length > max) throw bad(`${field} en fazla ${max} karakter olabilir.`);
  return value;
}

export function username(value) {
  const u = str(value, { field: 'Kullanıcı adı', min: 3, max: 24 });
  if (!/^[a-zA-Z0-9_.]+$/.test(u)) throw bad('Kullanıcı adı yalnızca harf, rakam, nokta ve alt çizgi içerebilir.');
  clean(u, 'Kullanıcı adı');
  return u;
}

export function password(value) {
  return str(value, { field: 'Şifre', min: 8, max: 128, trim: false });
}

export function displayName(value) {
  return clean(str(value, { field: 'İsim', min: 1, max: 50 }), 'İsim');
}

/** Şifre + şifre tekrarı: ikisi eşleşmeli. */
export function newPassword(value, confirm) {
  const p = password(value);
  if (confirm !== undefined && String(confirm) !== p) throw bad('Şifreler birbiriyle eşleşmiyor.');
  return p;
}

export function email(value) {
  const e = str(value, { field: 'E-posta', min: 1, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw bad('Geçerli bir e-posta adresi girin.');
  return e;
}

/**
 * Telefonu uluslararası biçime (+905321234567) çevirir; geçersizse null.
 * Türkiye numaraları için 0 veya 90 ile başlayan yazımlar da kabul edilir.
 */
export function normalizePhone(value) {
  let p = String(value || '').replace(/[\s()\-.]/g, '');
  if (!p) return null;
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  else if (/^0\d{10}$/.test(p)) p = `+9${p}`;
  else if (/^5\d{9}$/.test(p)) p = `+90${p}`;
  else if (/^90\d{10}$/.test(p)) p = `+${p}`;
  return /^\+\d{10,15}$/.test(p) ? p : null;
}

export function phone(value) {
  const p = normalizePhone(value);
  if (!p) throw bad('Geçerli bir telefon numarası girin (ör. 0532 123 45 67).');
  return p;
}

export function url(value, field = 'Web sitesi') {
  let u = str(value, { field, max: 200 });
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error();
    return parsed.toString();
  } catch {
    throw bad(`${field} geçerli bir adres değil.`);
  }
}

export function date(value, field = 'Tarih') {
  const d = str(value, { field, max: 10 });
  if (!d) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw bad(`${field} geçersiz.`);
  if (d > new Date().toISOString().slice(0, 10) || d < '1900-01-01') throw bad(`${field} geçersiz.`);
  return d;
}

export function oneOf(value, options, field) {
  if (!options.includes(value)) throw bad(`${field} geçersiz.`);
  return value;
}

export function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw bad('Geçersiz kimlik.');
  return n;
}

/** Otomatik denetim: küfür/hakaret içeren metin reddedilir. */
export function clean(value, field = 'Metin') {
  if (isOffensive(value)) throw bad(`${field} uygunsuz bir ifade içeriyor. Lütfen düzenleyip tekrar dene.`);
  return value;
}
