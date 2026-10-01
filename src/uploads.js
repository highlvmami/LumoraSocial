import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { bad } from './validation.js';

export const UPLOADS_URL = '/uploads';
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Dosya içeriğine (sihirli baytlara) bakarak resim türünü bulur; uzantıya/başlığa güvenmez. */
function detectImageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Resmi `data/uploads/<klasör>/` altına rastgele bir adla kaydeder ve herkese açık URL'sini döner.
 * İleride paylaşım resimleri gibi başka yüklemeler de bu fonksiyonu kullanabilir.
 */
export function saveImage(folder, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw bad('Resim dosyası gönderilmedi.');
  if (buffer.length > MAX_IMAGE_BYTES) throw bad('Resim en fazla 2 MB olabilir.');
  const ext = detectImageType(buffer);
  if (!ext) throw bad('Yalnızca JPG, PNG veya WEBP resim yüklenebilir.');

  const dir = path.join(config.uploadsDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return `${UPLOADS_URL}/${folder}/${name}`;
}

/** saveImage ile kaydedilmiş bir dosyayı siler (bulunamazsa sessizce geçer). */
export function removeUpload(url) {
  if (!url || !url.startsWith(`${UPLOADS_URL}/`)) return;
  const file = path.resolve(config.uploadsDir, url.slice(UPLOADS_URL.length + 1));
  if (!file.startsWith(config.uploadsDir + path.sep)) return; // klasör dışına çıkmayı engelle
  fs.rm(file, { force: true }, () => {});
}
