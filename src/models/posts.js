import { db } from '../db.js';
import { VISIBLE_AUTHOR_SQL } from './follows.js';
import { removeUpload } from '../uploads.js';
import { isBookmarked, notBlockedSql } from './safety.js';

export const MAX_POST_IMAGES = 4;

/** LIKE aramasında % ve _ karakterlerini düz metin say. */
export const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/** Paylaşımlara verilebilecek emoji tepkileri. Yeni emoji eklemek için listeyi genişletin. */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export const authorOf = (row, prefix = '') => ({
  id: row[`${prefix}user_id`],
  username: row[`${prefix}username`],
  displayName: row[`${prefix}display_name`],
  avatarColor: row[`${prefix}avatar_color`],
  avatarUrl: row[`${prefix}avatar_url`] ?? null,
  isVerified: Boolean(row[`${prefix}is_verified`]),
  // Rol rozeti için: yönetici > denetimci > üye
  role: row.author_role === 'admin' ? 'admin' : row.author_mod ? 'moderator' : 'member',
});

/** Metindeki #etiketler (küçük harfe çevrilmiş, # olmadan, tekrarsız). */
export const extractTags = (text) =>
  [...new Set([...String(text || '').matchAll(/#([\p{L}\p{N}_]{2,40})/gu)].map((m) => m[1].toLocaleLowerCase('tr')))];

function saveTags(postId, content) {
  const add = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)');
  for (const tag of extractTags(content)) add.run(postId, tag);
}

/** Etiket tablosu sonradan eklendi: eski paylaşımların etiketlerini bir kez doldurur. */
export function backfillTags() {
  if (db.prepare('SELECT 1 FROM post_tags LIMIT 1').get()) return;
  const rows = db.prepare("SELECT id, content FROM posts WHERE content LIKE '%#%'").all();
  for (const r of rows) saveTags(r.id, r.content);
}

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;

/**
 * Paylaşımı oluşturur ve kullanıcının önceden yüklediği (henüz bağlanmamış) fotoğrafları sırasıyla bağlar.
 * quoteOf: yeniden paylaşılan gönderi; poll: { options: [metin], hours }
 */
export function createPost(userId, content, imageIds = [], { quoteOf = null, poll = null } = {}) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO posts (user_id, content, quote_of, has_poll) VALUES (?, ?, ?, ?)')
    .run(userId, content, quoteOf, poll ? 1 : 0);
  const postId = Number(lastInsertRowid);
  if (poll) {
    db.prepare('INSERT INTO polls (post_id, ends_at) VALUES (?, ?)').run(postId, Date.now() + poll.hours * 3600 * 1000);
    const add = db.prepare('INSERT INTO poll_options (post_id, position, text) VALUES (?, ?, ?)');
    poll.options.forEach((text, i) => add.run(postId, i, text));
  }
  const attach = db.prepare('UPDATE post_images SET post_id = ?, position = ? WHERE id = ? AND user_id = ? AND post_id IS NULL');
  imageIds.forEach((id, i) => attach.run(postId, i, id, userId));
  saveTags(postId, content);
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
  db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
}

/**
 * Akış: en yeni paylaşımlar önce. `before` ile sayfalama yapılır.
 * `userId` verilirse yalnızca o kullanıcının paylaşımları döner.
 * `following: true` ise izleyenin (onaylı) takip ettikleri, kendi paylaşımları ve yöneticilerin paylaşımları döner
 * (yeni üyelerin akışı boş kalmasın diye).
 * Gizli hesapların paylaşımları yalnızca onaylı takipçilere görünür (`viewerIsAdmin` hepsini görür).
 */
export function getFeed({ viewerId, viewerIsAdmin = false, before = null, limit = 20, userId = null, following = false, search = null, bookmarkedBy = null, tag = null }) {
  const pattern = search ? `%${likeEscape(search)}%` : null;
  const followingOf = following ? viewerId : null;
  const visibility = viewerIsAdmin ? '1' : VISIBLE_AUTHOR_SQL;
  const visibilityArgs = viewerIsAdmin ? [] : [viewerId, viewerId];
  const rows = db
    .prepare(
      `SELECT p.id, p.content, p.created_at, p.quote_of, p.has_poll,
              (SELECT COUNT(*) FROM posts q WHERE q.quote_of = p.id) AS repost_count,
              u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified, u.role AS author_role, u.is_moderator AS author_mod
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE (? IS NULL OR p.id < ?)
         AND (? IS NULL OR p.user_id = ?)
         AND (? IS NULL OR p.user_id = ? OR u.role = 'admin' OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ? AND status = 'accepted'))
         AND u.status = 'active'
         AND (? IS NULL OR p.content LIKE ? ESCAPE '\\')
         AND (? IS NULL OR p.id IN (SELECT post_id FROM bookmarks WHERE user_id = ?))
         AND (? IS NULL OR p.id IN (SELECT post_id FROM post_tags WHERE tag = ?))
         AND ${notBlockedSql('p.user_id')}
         AND ${visibility}
       ORDER BY p.id DESC
       LIMIT ?`
    )
    .all(before, before, userId, userId, followingOf, followingOf, followingOf, pattern, pattern, bookmarkedBy, bookmarkedBy, tag, tag, viewerId, viewerId, ...visibilityArgs, limit + 1);

  const hasMore = rows.length > limit;
  const posts = rows.slice(0, limit).map((r) => hydratePost(r, viewerId));
  return { posts, hasMore };
}

export function getPost(id, viewerId) {
  const row = db
    .prepare(
      `SELECT p.id, p.content, p.created_at, p.quote_of, p.has_poll,
              (SELECT COUNT(*) FROM posts q WHERE q.quote_of = p.id) AS repost_count,
              u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified, u.role AS author_role, u.is_moderator AS author_mod
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
    repostCount: row.repost_count ?? 0,
    quote: row.quote_of ? getQuoted(row.quote_of, viewerId) : null,
    poll: row.has_poll ? getPoll(row.id, viewerId, row.user_id) : null,
  };
}

/** Yeniden paylaşılan (alıntılanan) gönderi; izleyen göremiyorsa yalnızca { hidden: true }. */
function getQuoted(id, viewerId) {
  const row = db
    .prepare(
      `SELECT p.id, p.content, p.created_at, u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified, u.role AS author_role, u.is_moderator AS author_mod
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.id = ? AND u.status = 'active' AND ${notBlockedSql('p.user_id')} AND ${VISIBLE_AUTHOR_SQL}`
    )
    .get(id, viewerId, viewerId, viewerId, viewerId);
  if (!row) return { hidden: true };
  return { id: row.id, content: row.content, createdAt: row.created_at, author: authorOf(row), images: getImages(row.id) };
}

/** Anket: seçenekler, oy sayıları ve izleyenin oyu. Sonuçlar oy verince, anket bitince veya sahibine görünür. */
export function getPoll(postId, viewerId, ownerId) {
  const poll = db.prepare('SELECT ends_at FROM polls WHERE post_id = ?').get(postId);
  if (!poll) return null;
  const options = db
    .prepare(
      `SELECT o.id, o.text, (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes
       FROM poll_options o WHERE o.post_id = ? ORDER BY o.position`
    )
    .all(postId);
  const myVote = db.prepare('SELECT option_id FROM poll_votes WHERE post_id = ? AND user_id = ?').get(postId, viewerId)?.option_id ?? null;
  const ended = Date.now() >= poll.ends_at;
  const showResults = ended || myVote !== null || viewerId === ownerId;
  return {
    endsAt: poll.ends_at,
    ended,
    myVote,
    total: options.reduce((n, o) => n + o.votes, 0),
    options: options.map((o) => ({ id: o.id, text: o.text, votes: showResults ? o.votes : null })),
  };
}

/** Oy verir veya oyunu değiştirir; aynı seçeneğe tekrar basınca oy geri alınır. */
export function votePoll(postId, userId, optionId) {
  const poll = db.prepare('SELECT ends_at FROM polls WHERE post_id = ?').get(postId);
  if (!poll) return 'not_found';
  if (Date.now() >= poll.ends_at) return 'ended';
  if (!db.prepare('SELECT 1 FROM poll_options WHERE id = ? AND post_id = ?').get(optionId, postId)) return 'bad_option';
  const current = db.prepare('SELECT option_id FROM poll_votes WHERE post_id = ? AND user_id = ?').get(postId, userId)?.option_id;
  if (current === optionId) db.prepare('DELETE FROM poll_votes WHERE post_id = ? AND user_id = ?').run(postId, userId);
  else
    db.prepare(
      'INSERT INTO poll_votes (post_id, user_id, option_id) VALUES (?, ?, ?) ON CONFLICT(post_id, user_id) DO UPDATE SET option_id = excluded.option_id'
    ).run(postId, userId, optionId);
  return 'ok';
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
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified, u.role AS author_role, u.is_moderator AS author_mod
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

/** Keşfet: son 7 günün en çok etkileşim alan paylaşımları (tepki + 2×yorum + 3×yeniden paylaşım). */
export function getExplore({ viewerId, viewerIsAdmin = false, page = 0, limit = 15 }) {
  const visibility = viewerIsAdmin ? '1' : VISIBLE_AUTHOR_SQL;
  const visibilityArgs = viewerIsAdmin ? [] : [viewerId, viewerId];
  const rows = db
    .prepare(
      `SELECT p.id, p.content, p.created_at, p.quote_of, p.has_poll,
              (SELECT COUNT(*) FROM posts q WHERE q.quote_of = p.id) AS repost_count,
              u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified, u.role AS author_role, u.is_moderator AS author_mod,
              (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id)
                + 2 * (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id)
                + 3 * (SELECT COUNT(*) FROM posts q WHERE q.quote_of = p.id) AS score
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.created_at > datetime('now', '-7 days')
         AND u.status = 'active'
         AND ${notBlockedSql('p.user_id')}
         AND ${visibility}
       ORDER BY score DESC, p.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(viewerId, viewerId, ...visibilityArgs, limit + 1, page * limit);
  return { posts: rows.slice(0, limit).map((r) => hydratePost(r, viewerId)), hasMore: rows.length > limit };
}

/** Popüler konular: son 30 günde en çok paylaşımda geçen #etiketler ve paylaşım sayıları. */
export function getTrendingTags({ viewerId, limit = 10 }) {
  return db
    .prepare(
      `SELECT t.tag, COUNT(*) AS n FROM post_tags t
       JOIN posts p ON p.id = t.post_id JOIN users u ON u.id = p.user_id
       WHERE p.created_at > datetime('now', '-30 days') AND u.status = 'active'
         AND ${notBlockedSql('p.user_id')} AND ${VISIBLE_AUTHOR_SQL}
       GROUP BY t.tag ORDER BY n DESC, MAX(p.id) DESC LIMIT ?`
    )
    .all(viewerId, viewerId, viewerId, viewerId, limit)
    .map((r) => ({ tag: `#${r.tag}`, count: r.n }));
}

/** Bir etiketin izleyenin görebildiği toplam paylaşım sayısı. */
export function countTag(tag, viewerId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM post_tags t
       JOIN posts p ON p.id = t.post_id JOIN users u ON u.id = p.user_id
       WHERE t.tag = ? AND u.status = 'active' AND ${notBlockedSql('p.user_id')} AND ${VISIBLE_AUTHOR_SQL}`
    )
    .get(tag, viewerId, viewerId, viewerId, viewerId).n;
}
