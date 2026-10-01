import { db } from '../db.js';
import { clientIp, parseUserAgent } from '../services/devices.js';

/*
 * Yönetici paneli için olay kayıtları.
 * Kullanıcı adları kayıt anında da saklanır; kullanıcı silinse ya da adını değiştirse bile kayıt okunur kalır.
 * Yeni bir olay türü eklemek için: log(...) çağırıp CATEGORIES'e ekleyin (panelde etiketi admin.js'teki LABELS'ta).
 */

/** Panel filtresindeki gruplar → olay türleri */
export const CATEGORIES = {
  register: ['user.register', 'user.register_oauth', 'admin.setup', 'admin.user_create'],
  login: ['auth.login', 'auth.login_oauth', 'auth.logout'],
  login_failed: ['auth.login_failed'],
  account: [
    'account.username', 'account.email', 'account.email_verified', 'account.phone', 'account.phone_verified',
    'account.password', 'account.password_reset_request', 'account.password_reset', 'account.logout_all',
    'account.privacy', 'account.oauth_link', 'account.oauth_unlink', 'account.block', 'account.unblock',
  ],
  admin: ['admin.role', 'admin.status', 'admin.delete_user', 'admin.password', 'admin.badge', 'admin.remove_avatar', 'admin.delete_post', 'admin.delete_comment'],
  content: ['post.create', 'post.delete'],
  reports: ['report.create', 'admin.report_resolve', 'admin.report_dismiss'],
};

const nameOf = (id) => (id ? db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username ?? null : null);

/**
 * Olay kaydeder. actor: işlemi yapan (varsayılan: oturumdaki kullanıcı), target: etkilenen kullanıcı.
 * Kayıt hatası asla asıl işlemi bozmaz.
 */
export function log(req, action, { actorId, targetId = null, data = {} } = {}) {
  try {
    const actor = actorId !== undefined ? actorId : req?.user?.id ?? null;
    const values = [
      action,
      actor,
      nameOf(actor),
      targetId,
      nameOf(targetId),
      req ? clientIp(req) : '',
      req ? parseUserAgent(req.get('user-agent')).label : '',
      JSON.stringify(data),
    ];
    // Yazma, yanıt gönderildikten sonra yapılır (bulut veritabanında her yazma zaman alır)
    setImmediate(() => {
      try {
        db.prepare(
          `INSERT INTO audit_logs (action, actor_id, actor_name, target_id, target_name, ip, device, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(...values);
      } catch (err) {
        console.error('[log] kaydedilemedi:', err.message);
      }
    });
  } catch (err) {
    console.error('[log] kaydedilemedi:', err.message);
  }
}

export function listLogs({ category = '', search = '', before = null, limit = 50 } = {}) {
  const actions = CATEGORIES[category] || null;
  const q = search ? `%${search}%` : null;
  const rows = db
    .prepare(
      `SELECT * FROM audit_logs
       WHERE (? IS NULL OR id < ?)
         ${actions ? `AND action IN (${actions.map(() => '?').join(',')})` : ''}
         AND (? IS NULL OR actor_name LIKE ? OR target_name LIKE ? OR ip LIKE ? OR data LIKE ?)
       ORDER BY id DESC LIMIT ?`
    )
    .all(before, before, ...(actions || []), q, q, q, q, q, limit + 1);
  return {
    hasMore: rows.length > limit,
    logs: rows.slice(0, limit).map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor_id ? { id: r.actor_id, username: r.actor_name } : null,
      target: r.target_id ? { id: r.target_id, username: r.target_name } : null,
      ip: r.ip,
      device: r.device,
      data: JSON.parse(r.data),
      createdAt: r.created_at,
    })),
  };
}

/** Özet sayılar (son 24 saat). */
export function logSummary() {
  const since = "datetime('now', '-1 day')";
  const count = (actions) =>
    db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE created_at > ${since} AND action IN (${actions.map(() => '?').join(',')})`).get(...actions).n;
  return {
    registrations: count(CATEGORIES.register),
    logins: count(['auth.login', 'auth.login_oauth']),
    failedLogins: count(CATEGORIES.login_failed),
  };
}

/** 180 günden eski kayıtları siler. */
export function cleanupLogs() {
  db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-180 days')").run();
}
