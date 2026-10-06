import { db } from '../db.js';
import { authorOf } from './posts.js';
import { notBlockedSql } from './safety.js';
import { removeUpload } from '../uploads.js';

export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_STORIES = 20;
/** Yazılı hikayelerin arka plan renkleri (mürekkep mavisi temasıyla uyumlu, düz renkler). */
export const STORY_BACKGROUNDS = ['#1f4e8c', '#0f766e', '#7c2d12', '#6d28d9', '#be123c', '#1f2937'];

export function countActiveStories(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM stories WHERE user_id = ? AND expires_at > ?').get(userId, Date.now()).n;
}

export function createStory(userId, { imageUrl = null, text = '', bg = '' }) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO stories (user_id, image_url, text, bg, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, imageUrl, text, bg, Date.now() + STORY_TTL_MS);
  return Number(lastInsertRowid);
}

export function findStory(id) {
  return db.prepare('SELECT * FROM stories WHERE id = ? AND expires_at > ?').get(id, Date.now()) ?? null;
}

export function deleteStory(id) {
  const row = db.prepare('SELECT image_url FROM stories WHERE id = ?').get(id);
  db.prepare('DELETE FROM stories WHERE id = ?').run(id);
  removeUpload(row?.image_url);
}

/** Süresi dolan hikayeleri ve fotoğraflarını siler. */
export function cleanupExpiredStories() {
  const now = Date.now();
  for (const r of db.prepare('SELECT image_url FROM stories WHERE expires_at <= ? AND image_url IS NOT NULL').all(now)) removeUpload(r.image_url);
  db.prepare('DELETE FROM stories WHERE expires_at <= ?').run(now);
}

/**
 * Hikaye çubuğu: izleyenin kendisi + onaylı takip ettikleri, kişi başına gruplanmış.
 * Önce kendi hikayen, sonra izlenmemiş hikayesi olanlar (en yeniden eskiye), en sonda hepsi izlenmiş olanlar.
 */
export function getStoryTray(viewerId) {
  const rows = db
    .prepare(
      `SELECT s.id, s.image_url, s.text, s.bg, s.created_at,
              u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified,
              EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = ?) AS viewed
       FROM stories s JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > ?
         AND u.status = 'active'
         AND (s.user_id = ? OR s.user_id IN (SELECT following_id FROM follows WHERE follower_id = ? AND status = 'accepted'))
         AND ${notBlockedSql('s.user_id')}
       ORDER BY s.id`
    )
    .all(viewerId, Date.now(), viewerId, viewerId, viewerId, viewerId);

  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.user_id)) groups.set(r.user_id, { user: authorOf(r), stories: [] });
    groups.get(r.user_id).stories.push({ id: r.id, imageUrl: r.image_url, text: r.text, bg: r.bg, createdAt: r.created_at, viewed: Boolean(r.viewed) });
  }
  const tray = [...groups.values()].map((g) => ({ ...g, allViewed: g.stories.every((s) => s.viewed), latest: g.stories.at(-1).id }));
  const mine = tray.filter((g) => g.user.id === viewerId);
  const others = tray.filter((g) => g.user.id !== viewerId).sort((a, b) => a.allViewed - b.allViewed || b.latest - a.latest);
  return [...mine, ...others];
}

export function markViewed(storyId, viewerId) {
  db.prepare('INSERT INTO story_views (story_id, viewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(storyId, viewerId);
}

export function listViewers(storyId) {
  return db
    .prepare(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified, v.viewed_at
       FROM story_views v JOIN users u ON u.id = v.viewer_id
       WHERE v.story_id = ?
       ORDER BY v.viewed_at DESC`
    )
    .all(storyId)
    .map((r) => ({ ...authorOf(r), viewedAt: r.viewed_at }));
}
