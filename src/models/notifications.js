import { db } from '../db.js';
import { pushToUser } from '../services/push.js';

/**
 * Bildirim türleri (istemci bunlara göre metin üretir):
 *  new_device        { device, ip }            yeni cihazdan giriş
 *  suspicious_login  { device, ip, failures }  şüpheli giriş
 *  new_follower      actor                     biri seni takip etti
 *  follow_request    actor                     gizli hesabına takip isteği
 *  follow_accepted   actor                     takip isteğin kabul edildi
 *  post_reaction     actor { postId, emoji, preview }             paylaşımına tepki
 *  post_comment      actor { postId, commentId, preview, text }   paylaşımına yorum
 *  post_repost       actor { postId, preview, text }              paylaşımını yeniden paylaştı
 *  mention           actor { postId, commentId, preview, text }   paylaşımda/yorumda senden bahsetti
 *  achievement       { key, icon, title }                         yeni başarım kazanıldı
 *  feedback_done     { preview }                                  geri bildirimi tamamlandı olarak işaretlendi
 */
export function notify(userId, type, { actorId = null, data = {} } = {}) {
  db.prepare('INSERT INTO notifications (user_id, type, actor_id, data) VALUES (?, ?, ?, ?)').run(
    userId,
    type,
    actorId,
    JSON.stringify(data)
  );
  sendPush(userId, type, actorId, data);
}

/** Bildirimin telefona giden kısa metni ve tıklanınca açılacak sayfa. */
function sendPush(userId, type, actorId, d) {
  const actor = actorId ? db.prepare('SELECT username FROM users WHERE id = ?').get(actorId)?.username : null;
  const post = d.postId ? `/akis#/p/${d.postId}` : '/akis#/bildirimler';
  // [başlık, metin, adres]: başlıkta işlemi yapan kişi, metinde ne yaptığı
  const detail = (x) => (x ? `: ${x}` : '');
  const texts = {
    post_reaction: [actor, `paylaşımına ${d.emoji} tepkisi verdi${detail(d.preview)}`, post],
    post_comment: [actor, `paylaşımına yorum yaptı${detail(d.text)}`, post],
    post_repost: [actor, `paylaşımını yeniden paylaştı${detail(d.text || d.preview)}`, post],
    mention: [actor, `senden bahsetti${detail(d.text)}`, post],
    new_follower: [actor, 'seni takip etmeye başladı', `/akis#/u/${actor}`],
    follow_request: [actor, 'seni takip etmek istiyor', '/akis#/bildirimler'],
    follow_accepted: [actor, 'takip isteğini kabul etti', `/akis#/u/${actor}`],
    new_device: ['Yeni cihazdan giriş', `${d.device} (IP ${d.ip})`, '/akis#/ayarlar/guvenlik'],
    suspicious_login: ['Şüpheli giriş', `${d.device} (IP ${d.ip})`, '/akis#/ayarlar/guvenlik'],
    achievement: ['Yeni başarım kazandın!', `${d.icon} ${d.title}`, '/akis#/basarimlar'],
    feedback_done: ['Geri bildirimin değerlendirildi', `Teşekkürler! "${d.preview}" ile ilgili geri bildirimin tamamlandı.`, '/akis#/geri-bildirim'],
  };
  const [title, body, url] = texts[type] || ['LumoraSocial', 'Yeni bir bildirimin var', '/akis#/bildirimler'];
  pushToUser(userId, { title: title || 'LumoraSocial', body, url, tag: `${type}-${d.postId || actorId || ''}` });
}

export function listNotifications(userId, { before = null, limit = 30 } = {}) {
  const rows = db
    .prepare(
      `SELECT n.id, n.type, n.data, n.read_at, n.created_at,
              u.id AS actor_id, u.username, u.display_name, u.avatar_color, u.avatar_url
       FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = ? AND (? IS NULL OR n.id < ?)
       ORDER BY n.id DESC LIMIT ?`
    )
    .all(userId, before, before, limit + 1);
  return {
    hasMore: rows.length > limit,
    notifications: rows.slice(0, limit).map((r) => ({
      id: r.id,
      type: r.type,
      data: JSON.parse(r.data),
      read: Boolean(r.read_at),
      createdAt: r.created_at,
      actor: r.actor_id
        ? { id: r.actor_id, username: r.username, displayName: r.display_name, avatarColor: r.avatar_color, avatarUrl: r.avatar_url }
        : null,
    })),
  };
}

export function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

export function markAllRead(userId) {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(userId);
}

/** Bir takip isteği bildirimi işlendiğinde (kabul/red) kaldırılır. */
export function removeFollowRequestNotification(userId, actorId) {
  db.prepare("DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'follow_request'").run(userId, actorId);
}

/** Kısa önizleme metni (paylaşım/yorum). */
export const preview = (text, max = 80) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Tepki geri alınınca ilgili bildirimi kaldırır. */
export function removeReactionNotification(ownerId, actorId, postId, emoji) {
  db.prepare(
    "DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'post_reaction' AND json_extract(data, '$.postId') = ? AND json_extract(data, '$.emoji') = ?"
  ).run(ownerId, actorId, postId, emoji);
}
