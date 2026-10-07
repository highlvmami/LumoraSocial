import { db } from '../db.js';

/* Üyelerin geri bildirim ve önerileri. Yönetim panelinde okunur ve sonuçlandırılır. */

export const FEEDBACK_KINDS = { oneri: 'Öneri', hata: 'Hata bildirimi', diger: 'Diğer' };
export const FEEDBACK_STATUSES = { new: 'Yeni', read: 'Okundu', done: 'Tamamlandı' };

export function createFeedback(userId, kind, message) {
  return Number(db.prepare('INSERT INTO feedback (user_id, kind, message) VALUES (?, ?, ?)').run(userId, kind, message).lastInsertRowid);
}

const toFeedback = (r) => ({
  id: r.id,
  kind: r.kind,
  kindLabel: FEEDBACK_KINDS[r.kind] || r.kind,
  message: r.message,
  status: r.status,
  statusLabel: FEEDBACK_STATUSES[r.status] || r.status,
  createdAt: r.created_at,
  handledAt: r.handled_at,
  user: r.username ? { id: r.user_id, username: r.username, displayName: r.display_name, avatarColor: r.avatar_color, avatarUrl: r.avatar_url } : null,
});

/** Üyenin kendi gönderdikleri (son 20). */
export function listMyFeedback(userId) {
  return db.prepare('SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(userId).map(toFeedback);
}

/** Yönetim paneli listesi. status: new | read | done | all */
export function listFeedback({ status = 'new', before = null, limit = 30 } = {}) {
  const rows = db
    .prepare(
      `SELECT f.*, u.username, u.display_name, u.avatar_color, u.avatar_url
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE (? = 'all' OR f.status = ?) AND (? IS NULL OR f.id < ?)
       ORDER BY f.id DESC LIMIT ?`
    )
    .all(status, status, before, before, limit + 1);
  return { feedback: rows.slice(0, limit).map(toFeedback), hasMore: rows.length > limit };
}

export const findFeedback = (id) => db.prepare('SELECT * FROM feedback WHERE id = ?').get(id);

export function setFeedbackStatus(id, status) {
  db.prepare("UPDATE feedback SET status = ?, handled_at = CASE WHEN ? = 'new' THEN NULL ELSE datetime('now') END WHERE id = ?").run(status, status, id);
}

export const newFeedbackCount = () => db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'").get().n;
