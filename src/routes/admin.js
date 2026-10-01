import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import * as v from '../validation.js';
import { removeUpload } from '../uploads.js';
import { CATEGORIES, listLogs, log, logSummary } from '../models/audit.js';
import { closeReports, findReport, listReports, openReportCount } from '../models/safety.js';
import { deleteComment, deletePost, findComment, findPost } from '../models/posts.js';
import {
  countActiveAdmins,
  createUser,
  deleteUser,
  findUserById,
  getStats,
  listUsers,
  setPassword,
  setRole,
  setAvatarUrl,
  setStatus,
  setVerifiedBadge,
  destroySessions,
  toPublic,
  usernameExists,
} from '../models/users.js';

const router = Router();
router.use(requireAdmin);

function targetUser(req) {
  const user = findUserById(v.id(req.params.id));
  if (!user) throw new v.HttpError(404, 'Kullanıcı bulunamadı.');
  return user;
}

/** Son aktif yöneticinin yetkisinin kaybolmasını engeller. */
function guardLastAdmin(user) {
  if (user.role === 'admin' && user.status === 'active' && countActiveAdmins() <= 1) {
    throw v.bad('Sistemdeki son yöneticiyi kaldıramazsınız.');
  }
}

router.get('/stats', (_req, res) => res.json({ ...getStats(), last24h: logSummary(), openReports: openReportCount() }));

/* ---- Şikâyetler ---- */

router.get('/reports', (req, res) => {
  const status = ['open', 'resolved', 'dismissed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  const before = req.query.before ? v.id(req.query.before) : null;
  res.json({ ...listReports({ status, before }), openCount: openReportCount() });
});

/**
 * Şikâyeti sonuçlandırır. action:
 *  'dismiss'         → yok say
 *  'resolve'         → çözüldü olarak işaretle (işlem yapmadan)
 *  'delete_content'  → paylaşımı/yorumu sil ve çözüldü yap
 *  'ban_user'        → içeriğin sahibini askıya al ve çözüldü yap
 * Aynı içerik hakkındaki tüm açık şikâyetler birlikte kapanır.
 */
router.post('/reports/:id', (req, res) => {
  const report = findReport(v.id(req.params.id));
  if (!report) throw new v.HttpError(404, 'Şikâyet bulunamadı.');
  if (report.status !== 'open') throw v.bad('Bu şikâyet zaten sonuçlandırılmış.');
  const action = v.oneOf(req.body.action, ['dismiss', 'resolve', 'delete_content', 'ban_user'], 'İşlem');
  const labels = { dismiss: 'Yok sayıldı', resolve: 'Çözüldü', delete_content: 'İçerik silindi', ban_user: 'Kullanıcı askıya alındı' };

  if (action === 'delete_content') {
    if (report.target_type === 'post' && findPost(report.target_id)) deletePost(report.target_id);
    else if (report.target_type === 'comment' && findComment(report.target_id)) deleteComment(report.target_id);
    else if (report.target_type === 'user') throw v.bad('Kullanıcı şikâyetinde "askıya al" işlemini kullan.');
  }
  if (action === 'ban_user') {
    const target = report.target_user_id ? findUserById(report.target_user_id) : null;
    if (!target) throw v.bad('Kullanıcı artık yok.');
    if (target.id === req.user.id) throw v.bad('Kendinizi askıya alamazsınız.');
    guardLastAdmin(target);
    setStatus(target.id, 'banned');
  }
  closeReports(report, { status: action === 'dismiss' ? 'dismissed' : 'resolved', resolution: labels[action], adminId: req.user.id });
  log(req, action === 'dismiss' ? 'admin.report_dismiss' : 'admin.report_resolve', {
    targetId: report.target_user_id,
    data: { reportId: report.id, type: report.target_type, action },
  });
  res.json({ ok: true, openCount: openReportCount() });
});

/** Olay kayıtları (log). category: register | login | login_failed | account | admin | content */
router.get('/logs', (req, res) => {
  const category = Object.hasOwn(CATEGORIES, req.query.category) ? req.query.category : '';
  const search = v.str(req.query.search ?? '', { field: 'Arama', max: 50 });
  const before = req.query.before ? v.id(req.query.before) : null;
  res.json(listLogs({ category, search, before }));
});

router.get('/users', (req, res) => {
  const search = v.str(req.query.search ?? '', { field: 'Arama', max: 50 });
  res.json({ users: listUsers({ search }) });
});

/** Yönetici panelinden yeni kullanıcı (üye veya yönetici) oluşturma. */
router.post('/users', async (req, res) => {
  const username = v.username(req.body.username);
  const password = v.password(req.body.password);
  const displayName = v.displayName(req.body.displayName || username);
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  if (usernameExists(username)) throw v.bad('Bu kullanıcı adı zaten alınmış.');
  const user = await createUser({ username, password, displayName, role });
  log(req, 'admin.user_create', { targetId: user.id, data: { role } });
  res.status(201).json({ user: toPublic(user) });
});

router.patch('/users/:id/role', (req, res) => {
  const user = targetUser(req);
  const role = req.body.role;
  if (!['admin', 'member'].includes(role)) throw v.bad('Geçersiz rol.');
  if (role === 'member') {
    if (user.id === req.user.id) throw v.bad('Kendi yönetici yetkinizi kaldıramazsınız.');
    guardLastAdmin(user);
  }
  setRole(user.id, role);
  log(req, 'admin.role', { targetId: user.id, data: { role } });
  res.json({ user: toPublic(findUserById(user.id)) });
});

router.patch('/users/:id/status', (req, res) => {
  const user = targetUser(req);
  const status = req.body.status;
  if (!['active', 'banned'].includes(status)) throw v.bad('Geçersiz durum.');
  if (status === 'banned') {
    if (user.id === req.user.id) throw v.bad('Kendinizi askıya alamazsınız.');
    guardLastAdmin(user);
  }
  setStatus(user.id, status);
  log(req, 'admin.status', { targetId: user.id, data: { status } });
  res.json({ user: toPublic(findUserById(user.id)) });
});

router.post('/users/:id/password', async (req, res) => {
  const user = targetUser(req);
  await setPassword(user.id, v.password(req.body.password));
  destroySessions(user.id); // şifre sıfırlanınca kullanıcının açık oturumları kapanır
  log(req, 'admin.password', { targetId: user.id });
  res.json({ ok: true });
});

/** Hesap doğrulama rozeti (mavi tik) verme / kaldırma. */
router.patch('/users/:id/verified', (req, res) => {
  const user = targetUser(req);
  setVerifiedBadge(user.id, Boolean(req.body.verified));
  log(req, 'admin.badge', { targetId: user.id, data: { verified: Boolean(req.body.verified) } });
  res.json({ user: toPublic(findUserById(user.id)) });
});

/** Uygunsuz profil fotoğrafını kaldırma. */
router.delete('/users/:id/avatar', (req, res) => {
  const user = targetUser(req);
  removeUpload(setAvatarUrl(user.id, null));
  log(req, 'admin.remove_avatar', { targetId: user.id });
  res.json({ user: toPublic(findUserById(user.id)) });
});

router.delete('/users/:id', (req, res) => {
  const user = targetUser(req);
  if (user.id === req.user.id) throw v.bad('Kendi hesabınızı buradan silemezsiniz.');
  guardLastAdmin(user);
  log(req, 'admin.delete_user', { targetId: user.id, data: { username: user.username, displayName: user.display_name } });
  deleteUser(user.id);
  res.json({ ok: true });
});

export default router;
