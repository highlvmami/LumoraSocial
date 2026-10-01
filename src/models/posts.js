import { db } from '../db.js';
import { VISIBLE_AUTHOR_SQL } from './follows.js';
import { removeUpload } from '../uploads.js';
import { isBookmarked, notBlockedSql } from './safety.js';

export const MAX_POST_IMAGES = 4;

/** LIKE aramasında % ve _ karakterlerini düz metin say. */
export const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/** Paylaşımlara verilebilecek emoji tepkileri. Yeni emoji eklemek için listeyi genişletin. */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

const authorOf = (row, prefix = '') => ({
  id: row[`${prefix}user_id`],
  username: row[`${prefix}username`],
  displayName: row[`${prefix}display_name`],
  avatarColor: row[`${prefix}avatar_color`],
  avatarUrl: row[`${prefix}avatar_url`] ?? null,
  isVerified: Boolean(row[`${prefix}is_verified`]),
});

/** Paylaşımı oluşturur ve kullanıcının önceden yüklediği (henüz bağlanmamış) fotoğrafları sırasıyla bağlar. */
export function createPost(userId, content, imageIds = []) {
  const { lastInsertRowid } = db.prepare('INSERT INTO posts (user_id, content) VALUES (?, ?)').run(userId, content);
  const postId = Number(lastInsertRowid);
  const attach = db.prepare('UPDATE post_images SET post_id = ?, position = ? WHERE id = ? AND user_id = ? AND post_id IS NULL');
  imageIds.forEach((id, i) => attach.run(postId, i, id, userId));
  return postId;
}

/* ---- Paylaşım fotoğrafları ---- */

export function addPendingImage(userId, url, width, height) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO post_images (user_id, url, width, height, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, url, width, height, Date.now());
  return Number(lastInsertRowid);
}

/** Kullanıcının kendi yüklediği, henüz paylaşıma bağlanmamış fotoğraflardan kaç tanesi geçerli. */
export function countPendingImages(userId, ids) {
  if (!ids.length) return 0;
  return db
    .prepare(`SELECT COUNT(*) AS n FROM post_images WHERE user_id = ? AND post_id IS NULL AND id IN (${ids.map(() => '?').join(',')})`)
    .get(userId, ...ids).n;
}

export function removePendingImage(userId, id) {
  const row = db.prepare('SELECT url FROM post_images WHERE id = ? AND user_id = ? AND post_id IS NULL').get(id, userId);
  if (!row) return false;
  db.prepare('DELETE FROM post_images WHERE id = ?').run(id);
  removeUpload(row.url);
  return true;
}

/** Paylaşılmadan bırakılmış eski fotoğrafları (1 günden eski) temizler. */
export function cleanupPendingImages() {
  const old = db.prepare('SELECT id, url FROM post_images WHERE post_id IS NULL AND created_at < ?').all(Date.now() - 24 * 60 * 60 * 1000);
  for (const r of old) {
    removeUpload(r.url);
    db.prepare('DELETE FROM post_images WHERE id = ?').run(r.id);
  }
}

/** Bir kullanıcının tüm paylaşım fotoğraf dosyalarını siler (hesap silinirken). */
export function removeUserImageFiles(userId) {
  for (const r of db.prepare('SELECT url FROM post_images WHERE user_id = ?').all(userId)) removeUpload(r.url);
}

function getImages(postId) {
  return db
    .prepare('SELECT url, width, height FROM post_images WHERE post_id = ? ORDER BY position')
    .all(postId)
    .map((r) => ({ url: r.url, width: r.width, height: r.height }));
}

export function findPost(id) {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

export function deletePost(id) {
  db.prepare("DELETE FROM notifications WHERE json_extract(data, '$.postId') = ?").run(id);
  for (const r of db.prepare('SELECT url FROM post_images WHERE post_id = ?').all(id)) removeUpload(r.url);
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
}

/**
 * Akış: en yeni paylaşımlar önce. `before` ile sayfalama yapılır.
 * `userId` verilirse yalnızca o kullanıcının paylaşımları döner.
 * `following: true` ise yalnızca izleyenin (onaylı) takip ettikleri ve kendi paylaşımları döner.
 * Gizli hesapların paylaşımları yalnızca onaylı takipçilere görünür (`viewerIsAdmin` hepsini görür).
 */
export function getFeed({ viewerId, viewerIsAdmin = false, before = null, limit = 20, userId = null, following = false, search = null, bookmarkedBy = null }) {
  const pattern = search ? `%${likeEscape(search)}%` : null;
  const followingOf = following ? viewerId : null;
  const visibility = viewerIsAdmin ? '1' : VISIBLE_AUTHOR_SQL;
  const visibilityArgs = viewerIsAdmin ? [] : [viewerId, viewerId];
  const rows = db
    .prepare(
      `SELECT p.id, p.content, p.created_at, u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE (? IS NULL OR p.id < ?)
         AND (? IS NULL OR p.user_id = ?)
         AND (? IS NULL OR p.user_id = ? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ? AND status = 'accepted'))
         AND u.status = 'active'
         AND (? IS NULL OR p.content LIKE ? ESCAPE '\\')
         AND (? IS NULL OR p.id IN (SELECT post_id FROM bookmarks WHERE user_id = ?))
         AND ${notBlockedSql('p.user_id')}
         AND ${visibility}
       ORDER BY p.id DESC
       LIMIT ?`
    )
    .all(before, before, userId, userId, followingOf, followingOf, followingOf, pattern, pattern, bookmarkedBy, bookmarkedBy, viewerId, viewerId, ...visibilityArgs, limit + 1);

  const hasMore = rows.length > limit;
  const posts = rows.slice(0, limit).map((r) => hydratePost(r, viewerId));
  return { posts, hasMore };
}

export function getPost(id, viewerId) {
  const row = db
    .prepare(
      `SELECT p.id, p.content, p.created_at, u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified
       FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
    )
    .get(id);
  return row ? hydratePost(row, viewerId) : null;
}

function hydratePost(row, viewerId) {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.created_at,
    author: authorOf(row),
    images: getImages(row.id),
    reactions: getReactionSummary(row.id, viewerId),
    comments: getComments(row.id, viewerId),
    bookmarked: isBookmarked(viewerId, row.id),
  };
}

export function getReactionSummary(postId, viewerId) {
  const counts = db.prepare('SELECT emoji, COUNT(*) AS n FROM reactions WHERE post_id = ? GROUP BY emoji').all(postId);
  const mine = new Set(
    db.prepare('SELECT emoji FROM reactions WHERE post_id = ? AND user_id = ?').all(postId, viewerId).map((r) => r.emoji)
  );
  const byEmoji = Object.fromEntries(counts.map((c) => [c.emoji, c.n]));
  return REACTIONS.map((emoji) => ({ emoji, count: byEmoji[emoji] || 0, mine: mine.has(emoji) }));
}

/** Tepkiyi açar/kapatır. Tepki eklendiyse true, kaldırıldıysa false döner. */
export function toggleReaction(postId, userId, emoji) {
  const { changes } = db
    .prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?')
    .run(postId, userId, emoji);
  if (changes) return false;
  db.prepare('INSERT INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)').run(postId, userId, emoji);
  return true;
}

/** Yorumlar; viewerId verilirse izleyenle engelleme ilişkisindeki kişilerin yorumları gizlenir. */
export function getComments(postId, viewerId = 0) {
  return db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? AND ${notBlockedSql('c.user_id')} ORDER BY c.id ASC`
    )
    .all(postId, viewerId, viewerId)
    .map((r) => ({ id: r.id, content: r.content, createdAt: r.created_at, author: authorOf(r) }));
}

export function addComment(postId, userId, content) {
  return Number(db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').run(postId, userId, content).lastInsertRowid);
}

export function findComment(id) {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
}

export function deleteComment(id) {
  db.prepare("DELETE FROM notifications WHERE type = 'post_comment' AND json_extract(data, '$.commentId') = ?").run(id);
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
}
