import { db } from '../db.js';

/* Kaydedilenler, engellemeler ve şikâyetler. */

/* ---------------- Kaydedilen paylaşımlar ---------------- */

/** Kaydet/kaldır. Kaydedildiyse true döner. */
export function toggleBookmark(userId, postId) {
  const { changes } = db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?').run(userId, postId);
  if (changes) return false;
  db.prepare('INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)').run(userId, postId);
  return true;
}

export const isBookmarked = (userId, postId) => !!db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?').get(userId, postId);

/* ---------------- Engelleme ---------------- */

/**
 * Engeller: iki yöndeki takip ilişkileri silinir.
 * Etkisi: birbirlerinin paylaşımlarını, yorumlarını ve profillerini görmezler; takip edemez, mesajlaşamazlar.
 */
export function block(blockerId, blockedId) {
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(blockerId, blockedId);
  db.prepare('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)').run(
    blockerId,
    blockedId,
    blockedId,
    blockerId
  );
}

export function unblock(blockerId, blockedId) {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId);
}

export const hasBlocked = (blockerId, blockedId) => !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId);

/** İki kullanıcıdan biri diğerini engellemiş mi? */
export const isBlockedEitherWay = (a, b) =>
  !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a);

/**
 * SQL parçası: `col` sütunundaki kullanıcı, izleyenle engelleme ilişkisinde DEĞİL.
 * Parametreler: viewerId, viewerId
 */
export const notBlockedSql = (col) => `(
  ${col} NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
  AND ${col} NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
)`;

export function listBlocked(userId) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url, b.created_at
       FROM blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ? ORDER BY b.created_at DESC`
    )
    .all(userId)
    .map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarColor: u.avatar_color, avatarUrl: u.avatar_url, blockedAt: u.created_at }));
}

/* ---------------- Şikâyetler ---------------- */

export const REPORT_REASONS = {
  spam: 'Spam / reklam',
  harassment: 'Taciz veya zorbalık',
  hate: 'Nefret söylemi',
  inappropriate: 'Uygunsuz / müstehcen içerik',
  violence: 'Şiddet veya tehdit',
  fake: 'Sahte hesap / taklit',
  other: 'Diğer',
};

/** Aynı kişi aynı içeriği açık bir şikâyet varken tekrar şikâyet edemez. */
export function hasOpenReport(reporterId, type, targetId) {
  return !!db
    .prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'")
    .get(reporterId, type, targetId);
}

export function createReport({ reporterId, type, targetId, targetUserId, snapshot, reason, details }) {
  return Number(
    db
      .prepare(
        'INSERT INTO reports (reporter_id, target_type, target_id, target_user_id, snapshot, reason, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(reporterId, type, targetId, targetUserId, snapshot, reason, details).lastInsertRowid
  );
}

export function listReports({ status = 'open', before = null, limit = 30 } = {}) {
  const rows = db
    .prepare(
      `SELECT r.*,
              rep.username AS reporter_username,
              tu.username AS target_username, tu.display_name AS target_display, tu.avatar_color AS target_color,
              tu.avatar_url AS target_avatar, tu.status AS target_status,
              res.username AS resolver_username,
              (SELECT COUNT(*) FROM reports x WHERE x.target_type = r.target_type AND x.target_id = r.target_id AND x.status = 'open') AS open_count,
              CASE r.target_type
                WHEN 'post' THEN EXISTS(SELECT 1 FROM posts WHERE id = r.target_id)
                WHEN 'comment' THEN EXISTS(SELECT 1 FROM comments WHERE id = r.target_id)
                ELSE EXISTS(SELECT 1 FROM users WHERE id = r.target_id)
              END AS target_exists,
              (SELECT post_id FROM comments WHERE id = r.target_id AND r.target_type = 'comment') AS comment_post_id
       FROM reports r
       LEFT JOIN users rep ON rep.id = r.reporter_id
       LEFT JOIN users tu ON tu.id = r.target_user_id
       LEFT JOIN users res ON res.id = r.resolved_by
       WHERE (? = 'all' OR r.status = ?) AND (? IS NULL OR r.id < ?)
       ORDER BY r.id DESC LIMIT ?`
    )
    .all(status, status, before, before, limit + 1);
  return {
    hasMore: rows.length > limit,
    reports: rows.slice(0, limit).map((r) => ({
      id: r.id,
      type: r.target_type,
      targetId: r.target_id,
      postId: r.target_type === 'post' ? r.target_id : r.comment_post_id,
      targetExists: Boolean(r.target_exists),
      targetUser: r.target_user_id
        ? { id: r.target_user_id, username: r.target_username, displayName: r.target_display, avatarColor: r.target_color, avatarUrl: r.target_avatar, status: r.target_status }
        : null,
      reporter: r.reporter_id ? { id: r.reporter_id, username: r.reporter_username } : null,
      snapshot: r.snapshot,
      reason: r.reason,
      reasonLabel: REPORT_REASONS[r.reason] || r.reason,
      details: r.details,
      status: r.status,
      resolution: r.resolution,
      resolvedBy: r.resolver_username,
      resolvedAt: r.resolved_at,
      openCount: r.open_count,
      createdAt: r.created_at,
    })),
  };
}

export function findReport(id) {
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
}

/** Şikâyeti kapatır; aynı içerik hakkındaki diğer açık şikâyetler de aynı sonuçla kapanır. */
export function closeReports(report, { status, resolution, adminId }) {
  db.prepare(
    `UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = datetime('now')
     WHERE target_type = ? AND target_id = ? AND status = 'open'`
  ).run(status, resolution, adminId, report.target_type, report.target_id);
}

export const openReportCount = () => db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n;
