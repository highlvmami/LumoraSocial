import { db } from '../db.js';

/** İlişki durumu: 'none' | 'pending' (istek gönderildi) | 'accepted' */
export function followStatus(followerId, followingId) {
  return (
    db.prepare('SELECT status FROM follows WHERE follower_id = ? AND following_id = ?').get(followerId, followingId)?.status ??
    'none'
  );
}

/** status: 'accepted' veya gizli hesaplar için 'pending'. Zaten kabul edilmişse değiştirmez. */
export function follow(followerId, followingId, status = 'accepted') {
  db.prepare(
    `INSERT INTO follows (follower_id, following_id, status) VALUES (?, ?, ?)
     ON CONFLICT(follower_id, following_id) DO UPDATE SET status = CASE WHEN status = 'accepted' THEN 'accepted' ELSE excluded.status END`
  ).run(followerId, followingId, status);
}

export function unfollow(followerId, followingId) {
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(followerId, followingId);
}

export function acceptRequest(followerId, followingId) {
  return (
    db
      .prepare("UPDATE follows SET status = 'accepted' WHERE follower_id = ? AND following_id = ? AND status = 'pending'")
      .run(followerId, followingId).changes > 0
  );
}

/** Hesap herkese açık yapılınca bekleyen tüm istekler kabul edilir. */
export function acceptAllRequests(userId) {
  db.prepare("UPDATE follows SET status = 'accepted' WHERE following_id = ? AND status = 'pending'").run(userId);
}

export function listRequests(userId) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url, f.created_at
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`
    )
    .all(userId)
    .map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarColor: u.avatar_color, avatarUrl: u.avatar_url, createdAt: u.created_at }));
}

/** Takipçi/takip sayıları (yalnızca onaylı) ve izleyenin bu kişiyle ilişkisi. */
export function getFollowStats(userId, viewerId = null) {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM follows WHERE following_id = ? AND status = 'accepted') AS followers,
         (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND status = 'accepted') AS "following",
         (SELECT COUNT(*) FROM follows WHERE following_id = ? AND status = 'pending') AS requests`
    )
    .get(userId, userId, userId);
  const status = viewerId ? followStatus(viewerId, userId) : 'none';
  return {
    followers: row.followers,
    following: row.following,
    pendingRequests: viewerId === userId ? row.requests : undefined,
    followStatus: status,
    isFollowing: status === 'accepted',
  };
}

/** Henüz takip edilmeyen, en çok paylaşım yapan aktif üyeler. */
export function getSuggestions(viewerId, limit = 5) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified, u.privacy,
         (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count
       FROM users u
       WHERE u.id <> ? AND u.status = 'active'
         AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
         AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
         AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
       ORDER BY post_count DESC, u.id DESC
       LIMIT ?`
    )
    .all(viewerId, viewerId, viewerId, viewerId, limit)
    .map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarColor: u.avatar_color,
      avatarUrl: u.avatar_url,
      isVerified: Boolean(u.is_verified),
      privateAccount: Boolean(JSON.parse(u.privacy || '{}').privateAccount),
    }));
}

/**
 * SQL parçası: izleyenin paylaşımlarını görebileceği kullanıcılar.
 * Gizli olmayan hesaplar + kendisi + onaylı takip ettikleri. `?` yerine sırayla viewerId, viewerId verilmeli.
 */
export const VISIBLE_AUTHOR_SQL = `(
  json_extract(u.privacy, '$.privateAccount') IS NOT 1
  OR u.id = ?
  OR u.id IN (SELECT following_id FROM follows WHERE follower_id = ? AND status = 'accepted')
)`;

export function canViewPostsOf(viewer, owner) {
  if (viewer.id === owner.id || viewer.role === 'admin') return true;
  const privateAccount = JSON.parse(owner.privacy || '{}').privateAccount === true;
  return !privateAccount || followStatus(viewer.id, owner.id) === 'accepted';
}
