import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { bad } from './validation.js';

export const UPLOADS_URL = '/uploads';
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Dosya içeriğine (sihirli baytlara) bakarak resim türünü bulur; uzantıya/başlığa güvenmez. */
function detectImageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Resmi veritabanındaki `uploads` tablosuna rastgele bir adla kaydeder ve herkese açık URL'sini döner.
 * Sunucu diski kalıcı olmayabileceği (ör. Render) için dosya sistemine yazılmaz.
 */
export function saveImage(folder, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw bad('Resim dosyası gönderilmedi.');
  if (buffer.length > MAX_IMAGE_BYTES) throw bad('Resim en fazla 2 MB olabilir.');
  const ext = detectImageType(buffer);
  if (!ext) throw bad('Yalnızca JPG, PNG veya WEBP resim yüklenebilir.');

  const key = `${folder}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
  db.prepare('INSERT INTO uploads (path, mime, data) VALUES (?, ?, ?)').run(key, MIME[ext], buffer);
  return `${UPLOADS_URL}/${key}`;
}

/** Kayıtlı resmi döner; yoksa null. */
export function getUpload(key) {
  return db.prepare('SELECT mime, data FROM uploads WHERE path = ?').get(key) ?? null;
}

/** saveImage ile kaydedilmiş bir resmi siler (bulunamazsa sessizce geçer). */
export function removeUpload(url) {
  if (!url || !url.startsWith(`${UPLOADS_URL}/`)) return;
  const key = url.slice(UPLOADS_URL.length + 1);
  db.prepare('DELETE FROM uploads WHERE path = ?').run(key);

  // Eski sürümlerde diske yazılmış dosyalar
  const file = path.resolve(config.uploadsDir, key);
  if (!file.startsWith(config.uploadsDir + path.sep)) return; // klasör dışına çıkmayı engelle
  fs.rm(file, { force: true }, () => {});
}
