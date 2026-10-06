import { db } from '../db.js';
import { removeUpload } from '../uploads.js';
import { pushToUser } from '../services/push.js';

/* Birebir mesajlaşma. İki kullanıcı arasında tek bir sohbet (conversation) vardır. */

const pair = (x, y) => (x < y ? [x, y] : [y, x]);

const userOf = (r) => ({
  id: r.other_id,
  username: r.username,
  displayName: r.display_name,
  avatarColor: r.avatar_color,
  avatarUrl: r.avatar_url,
  isVerified: Boolean(r.is_verified),
});

export function findConversation(userId, otherId) {
  const [a, b] = pair(userId, otherId);
  return db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(a, b);
}

function getOrCreateConversation(userId, otherId) {
  const [a, b] = pair(userId, otherId);
  db.prepare('INSERT OR IGNORE INTO conversations (user_a, user_b) VALUES (?, ?)').run(a, b);
  return findConversation(userId, otherId);
}

export function sendMessage(senderId, recipientId, content, imageUrl = null) {
  const conv = getOrCreateConversation(senderId, recipientId);
  const id = Number(
    db.prepare('INSERT INTO messages (conversation_id, sender_id, content, image_url) VALUES (?, ?, ?, ?)').run(conv.id, senderId, content, imageUrl).lastInsertRowid
  );
  db.prepare("UPDATE conversations SET last_message_id = ?, updated_at = datetime('now') WHERE id = ?").run(id, conv.id);
  const sender = db.prepare('SELECT username FROM users WHERE id = ?').get(senderId)?.username;
  pushToUser(recipientId, { title: 'LS', body: `${sender} sana mesaj gönderdi: ${content || 'Fotoğraf'}`, url: `/akis#/mesajlar/${sender}`, tag: `msg-${senderId}` });
  return getMessage(id);
}

function toMessage(m) {
  return {
    id: m.id,
    senderId: m.sender_id,
    content: m.deleted ? '' : m.content,
    imageUrl: m.deleted ? null : m.image_url ?? null,
    deleted: Boolean(m.deleted),
    read: Boolean(m.read_at),
    createdAt: m.created_at,
  };
}

export function getMessage(id) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  return m ? toMessage(m) : null;
}

/** Sohbetteki mesajlar (en eskiden yeniye). `before` ile daha eskiler, `after` ile yeni gelenler alınır. */
export function listMessages(conversationId, { before = null, after = null, limit = 40 } = {}) {
  if (after !== null) {
    return {
      messages: db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id').all(conversationId, after).map(toMessage),
      hasMore: false,
    };
  }
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?')
    .all(conversationId, before, before, limit + 1);
  return { messages: rows.slice(0, limit).reverse().map(toMessage), hasMore: rows.length > limit };
}

/** Karşı tarafın bu kullanıcıya gönderdiği okunmamış mesajları okundu yapar. */
export function markRead(conversationId, readerId) {
  db.prepare("UPDATE messages SET read_at = datetime('now') WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL").run(
    conversationId,
    readerId
  );
}

/** Kendi mesajını siler ("Bu mesaj silindi" olarak görünür). */
export function deleteMessage(messageId, userId) {
  const image = db.prepare('SELECT image_url FROM messages WHERE id = ? AND sender_id = ?').get(messageId, userId)?.image_url;
  const ok = db.prepare("UPDATE messages SET deleted = 1, content = '', image_url = NULL WHERE id = ? AND sender_id = ?").run(messageId, userId).changes > 0;
  if (ok) removeUpload(image);
  return ok;
}

export function listConversations(userId) {
  return db
    .prepare(
      `SELECT c.id, c.updated_at,
              u.id AS other_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified,
              m.content AS last_content, m.image_url AS last_image, m.sender_id AS last_sender, m.deleted AS last_deleted, m.created_at AS last_at,
              (SELECT COUNT(*) FROM messages x WHERE x.conversation_id = c.id AND x.sender_id <> ? AND x.read_at IS NULL) AS unread
       FROM conversations c
       JOIN users u ON u.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
       LEFT JOIN messages m ON m.id = c.last_message_id
       WHERE (c.user_a = ? OR c.user_b = ?) AND c.last_message_id IS NOT NULL
       ORDER BY c.updated_at DESC, c.id DESC`
    )
    .all(userId, userId, userId, userId)
    .map((r) => ({
      id: r.id,
      user: userOf(r),
      unread: r.unread,
      lastMessage: {
        content: r.last_deleted ? '' : r.last_content || (r.last_image ? 'Fotoğraf' : ''),
        deleted: Boolean(r.last_deleted),
        mine: r.last_sender === userId,
        createdAt: r.last_at,
      },
    }));
}

export function unreadMessageCount(userId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE (c.user_a = ? OR c.user_b = ?) AND m.sender_id <> ? AND m.read_at IS NULL`
    )
    .get(userId, userId, userId).n;
}
