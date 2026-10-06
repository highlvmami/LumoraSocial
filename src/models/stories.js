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

/** Hikayeyi tamamen siler (arşivden ve öne çıkanlardan da). */
export function deleteStory(id) {
  const row = db.prepare('SELECT image_url FROM stories WHERE id = ?').get(id);
  db.prepare('DELETE FROM stories WHERE id = ?').run(id);
  removeUpload(row?.image_url);
}

/*
 * Süresi dolan hikayeler arşivde (yalnızca sahibine görünür) kalır.
 * 1 yıldan eski ve öne çıkanlarda olmayan arşiv hikayeleri fotoğraflarıyla silinir.
 */
const ARCHIVE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export function cleanupExpiredStories() {
  const cutoff = Date.now() - ARCHIVE_TTL_MS;
  const where = 'expires_at <= ? AND id NOT IN (SELECT story_id FROM highlight_items)';
  for (const r of db.prepare(`SELECT image_url FROM stories WHERE ${where} AND image_url IS NOT NULL`).all(cutoff)) removeUpload(r.image_url);
  db.prepare(`DELETE FROM stories WHERE ${where}`).run(cutoff);
}

const toStory = (r) => ({ id: r.id, imageUrl: r.image_url, text: r.text, bg: r.bg, createdAt: r.created_at, expired: r.expires_at <= Date.now() });

/** Kendi hikaye arşivin (süresi dolmuşlar dahil), yeniden eskiye. */
export function getArchive(userId, { before = null, limit = 60 } = {}) {
  const rows = db
    .prepare('SELECT * FROM stories WHERE user_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?')
    .all(userId, before, before, limit + 1);
  return { stories: rows.slice(0, limit).map(toStory), hasMore: rows.length > limit };
}

export function findOwnStory(id, userId) {
  return db.prepare('SELECT * FROM stories WHERE id = ? AND user_id = ?').get(id, userId) ?? null;
}

/* ---- Öne çıkanlar ---- */

export const MAX_HIGHLIGHTS = 20;
export const MAX_HIGHLIGHT_ITEMS = 50;

export function listHighlights(userId) {
  const highlights = db.prepare('SELECT id, title FROM highlights WHERE user_id = ? ORDER BY id').all(userId);
  const items = db.prepare(
    `SELECT s.* FROM highlight_items i JOIN stories s ON s.id = i.story_id WHERE i.highlight_id = ? ORDER BY s.id`
  );
  return highlights
    .map((hl) => ({ id: hl.id, title: hl.title, stories: items.all(hl.id).map(toStory) }))
    .filter((hl) => hl.stories.length);
}

export function findHighlight(id) {
  return db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) ?? null;
}

export function createHighlight(userId, title) {
  return Number(db.prepare('INSERT INTO highlights (user_id, title) VALUES (?, ?)').run(userId, title).lastInsertRowid);
}

export function countHighlights(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM highlights WHERE user_id = ?').get(userId).n;
}

export function addToHighlight(highlightId, storyId) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM highlight_items WHERE highlight_id = ?').get(highlightId).n;
  if (n >= MAX_HIGHLIGHT_ITEMS) return false;
  db.prepare('INSERT INTO highlight_items (highlight_id, story_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(highlightId, storyId);
  return true;
}

export function removeFromHighlight(highlightId, storyId) {
  db.prepare('DELETE FROM highlight_items WHERE highlight_id = ? AND story_id = ?').run(highlightId, storyId);
  // Boş kalan öne çıkan silinir
  if (!db.prepare('SELECT 1 FROM highlight_items WHERE highlight_id = ?').get(highlightId)) db.prepare('DELETE FROM highlights WHERE id = ?').run(highlightId);
}

export function deleteHighlight(id) {
  db.prepare('DELETE FROM highlights WHERE id = ?').run(id);
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
              EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = ?) AS viewed,
              (SELECT reaction FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = ?) AS my_reaction
       FROM stories s JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > ?
         AND u.status = 'active'
         AND (s.user_id = ? OR s.user_id IN (SELECT following_id FROM follows WHERE follower_id = ? AND status = 'accepted'))
         AND ${notBlockedSql('s.user_id')}
       ORDER BY s.id`
    )
    .all(viewerId, viewerId, Date.now(), viewerId, viewerId, viewerId, viewerId);

  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.user_id)) groups.set(r.user_id, { user: authorOf(r), stories: [] });
    groups.get(r.user_id).stories.push({ id: r.id, imageUrl: r.image_url, text: r.text, bg: r.bg, createdAt: r.created_at, viewed: Boolean(r.viewed), myReaction: r.my_reaction ?? null });
  }
  const tray = [...groups.values()].map((g) => ({ ...g, allViewed: g.stories.every((s) => s.viewed), latest: g.stories.at(-1).id }));
  const mine = tray.filter((g) => g.user.id === viewerId);
  const others = tray.filter((g) => g.user.id !== viewerId).sort((a, b) => a.allViewed - b.allViewed || b.latest - a.latest);
  return [...mine, ...others];
}

export function markViewed(storyId, viewerId) {
  db.prepare('INSERT INTO story_views (story_id, viewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(storyId, viewerId);
}

/** Hikayeye emoji tepkisi; aynı emoji tekrar seçilirse geri alınır. Yeni tepkiyi (veya null) döner. */
export function setReaction(storyId, viewerId, emoji) {
  const current = db.prepare('SELECT reaction FROM story_views WHERE story_id = ? AND viewer_id = ?').get(storyId, viewerId)?.reaction ?? null;
  const next = current === emoji ? null : emoji;
  db.prepare(
    'INSERT INTO story_views (story_id, viewer_id, reaction) VALUES (?, ?, ?) ON CONFLICT(story_id, viewer_id) DO UPDATE SET reaction = excluded.reaction'
  ).run(storyId, viewerId, next);
  return next;
}

export function listViewers(storyId) {
  return db
    .prepare(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_verified, v.viewed_at, v.reaction
       FROM story_views v JOIN users u ON u.id = v.viewer_id
       WHERE v.story_id = ?
       ORDER BY v.viewed_at DESC`
    )
    .all(storyId)
    .map((r) => ({ ...authorOf(r), viewedAt: r.viewed_at, reaction: r.reaction }));
}
