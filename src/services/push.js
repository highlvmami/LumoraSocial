import webpush from 'web-push';
import { db, getSetting, setSetting } from '../db.js';

/*
 * Telefona / bilgisayara anlık bildirim (Web Push). Site kapalıyken de bildirim gelir.
 * VAPID anahtarları ilk açılışta üretilip veritabanında (settings) saklanır; ayar gerekmez.
 */

let keys = null;
function vapid() {
  if (keys) return keys;
  let pub = getSetting('vapid_public');
  let priv = getSetting('vapid_private');
  if (!pub || !priv) {
    ({ publicKey: pub, privateKey: priv } = webpush.generateVAPIDKeys());
    setSetting('vapid_public', pub);
    setSetting('vapid_private', priv);
  }
  webpush.setVapidDetails('mailto:lumorasocial.destek@gmail.com', pub, priv);
  keys = { publicKey: pub };
  return keys;
}

export const pushPublicKey = () => vapid().publicKey;

export function saveSubscription(userId, sub) {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}

export function removeSubscription(userId, endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
}

export const hasSubscription = (userId) => !!db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ?').get(userId);

/**
 * Kullanıcının tüm cihazlarına bildirim gönderir. Yanıtı bekletmemek için arka planda çalışır;
 * geçersizleşen abonelikler (410/404) silinir.
 */
export function pushToUser(userId, payload) {
  setImmediate(async () => {
    let subs;
    try {
      subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
      if (!subs.length) return;
      vapid();
    } catch (err) {
      console.error('[push] hazırlanamadı:', err.message);
      return;
    }
    // Uygulama simgesindeki sayı: okunmamış bildirim + mesaj
    let badge = 0;
    try {
      badge =
        db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n +
        db.prepare(
          `SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
           WHERE (c.user_a = ? OR c.user_b = ?) AND m.sender_id <> ? AND m.read_at IS NULL`
        ).get(userId, userId, userId).n;
    } catch {
      /* sayı alınamazsa rozetsiz gönder */
    }
    const body = JSON.stringify({ ...payload, badge });
    await Promise.all(
      subs.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 24 * 3600 }).catch((err) => {
          if (err.statusCode === 404 || err.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint);
          else console.error('[push] gönderilemedi:', err.statusCode || err.message);
        })
      )
    );
  });
}
