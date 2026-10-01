import { db } from '../db.js';
import { notify } from '../models/notifications.js';
import { sendMail } from './mailer.js';

/** User-Agent'tan kaba tarayıcı / işletim sistemi bilgisi çıkarır. */
export function parseUserAgent(ua = '') {
  const browser =
    (/Edg\//.test(ua) && 'Edge') ||
    (/OPR\/|Opera/.test(ua) && 'Opera') ||
    (/SamsungBrowser/.test(ua) && 'Samsung Internet') ||
    (/Firefox\//.test(ua) && 'Firefox') ||
    (/Chrome\//.test(ua) && 'Chrome') ||
    (/Safari\//.test(ua) && 'Safari') ||
    (/node|undici|curl/i.test(ua) && 'Uygulama') ||
    'Bilinmeyen tarayıcı';
  const os =
    (/iPhone|iPad|iPod/.test(ua) && 'iOS') ||
    (/Android/.test(ua) && 'Android') ||
    (/Windows/.test(ua) && 'Windows') ||
    (/Mac OS X|Macintosh/.test(ua) && 'macOS') ||
    (/CrOS/.test(ua) && 'ChromeOS') ||
    (/Linux/.test(ua) && 'Linux') ||
    'Bilinmeyen sistem';
  const mobile = /Mobi|iPhone|Android/.test(ua);
  return { browser, os, mobile, label: `${browser} · ${os}` };
}

// Render, Cloudflare arkasında çalışır; gerçek ziyaretçi adresi cf-connecting-ip başlığındadır
const behindCloudflare = Boolean(process.env.RENDER);
export const clientIp = (req) =>
  ((behindCloudflare && req.get?.('cf-connecting-ip')) || req.ip || '').replace(/^::ffff:/, '');

/** Başarısız giriş denemesini kaydeder (şüpheli giriş tespiti için). */
export function recordFailedLogin(userId, ip) {
  db.prepare('INSERT INTO login_attempts (user_id, ip, success, created_at) VALUES (?, ?, 0, ?)').run(userId, ip, Date.now());
}

/**
 * Başarılı girişten sonra çağrılır:
 *  - Bu cihaz daha önce görülmediyse (ve kullanıcının başka cihazı varsa) "yeni cihaz" bildirimi
 *  - Son 30 dakikada 3+ hatalı deneme olduysa "şüpheli giriş" bildirimi
 * Doğrulanmış e-postası olanlara ayrıca e-posta gönderilir.
 */
export function onSuccessfulLogin(user, req) {
  const ip = clientIp(req);
  const device = parseUserAgent(req.get('user-agent'));
  const deviceKey = `${device.browser}|${device.os}`;
  const now = Date.now();

  const recentFailures = db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE user_id = ? AND success = 0 AND created_at > ?')
    .get(user.id, now - 30 * 60 * 1000).n;
  db.prepare('INSERT INTO login_attempts (user_id, ip, success, created_at) VALUES (?, ?, 1, ?)').run(user.id, ip, now);
  // Eski kayıtları temizle (30 gün)
  db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(now - 30 * 24 * 60 * 60 * 1000);

  const hasAnyDevice = db.prepare('SELECT 1 FROM known_devices WHERE user_id = ? LIMIT 1').get(user.id);
  const known = db.prepare('SELECT 1 FROM known_devices WHERE user_id = ? AND device_key = ?').get(user.id, deviceKey);
  if (known) {
    db.prepare("UPDATE known_devices SET last_seen = datetime('now') WHERE user_id = ? AND device_key = ?").run(user.id, deviceKey);
  } else {
    db.prepare('INSERT INTO known_devices (user_id, device_key, label) VALUES (?, ?, ?)').run(user.id, deviceKey, device.label);
  }

  const when = new Date().toLocaleString('tr-TR');
  const email = user.email_verified_at ? user.email : null;

  if (recentFailures >= 3) {
    notify(user.id, 'suspicious_login', { data: { device: device.label, ip, failures: recentFailures } });
    if (email) {
      sendMail({
        to: email,
        subject: 'LumoraSocial: şüpheli giriş',
        text: `Merhaba ${user.display_name},\n\nHesabına ${recentFailures} hatalı denemenin ardından giriş yapıldı.\nCihaz: ${device.label}\nIP: ${ip}\nZaman: ${when}\n\nBu sen değilsen hemen şifreni değiştir ve Ayarlar > Güvenlik bölümünden "Tüm cihazlardan çıkış yap"ı kullan.`,
      });
    }
  } else if (!known && hasAnyDevice) {
    notify(user.id, 'new_device', { data: { device: device.label, ip } });
    if (email) {
      sendMail({
        to: email,
        subject: 'LumoraSocial: yeni cihazdan giriş',
        text: `Merhaba ${user.display_name},\n\nHesabına yeni bir cihazdan giriş yapıldı.\nCihaz: ${device.label}\nIP: ${ip}\nZaman: ${when}\n\nBu sen değilsen hemen şifreni değiştir.`,
      });
    }
  }
}
