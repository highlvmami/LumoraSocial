import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requestLimiter } from '../middleware/rateLimit.js';
import * as v from '../validation.js';
import { findComment, findPost } from '../models/posts.js';
import { findUserById } from '../models/users.js';
import { REPORT_REASONS, createReport, hasOpenReport } from '../models/safety.js';
import { log } from '../models/audit.js';

/* Üyelerin şikâyet göndermesi. İnceleme yönetim panelinde (routes/admin.js) yapılır. */

const router = Router();
router.use(requireAuth);

const reportLimiter = requestLimiter({ max: 20, windowMs: 60 * 60 * 1000, message: 'Çok fazla şikâyet gönderdin.' });

router.get('/reasons', (_req, res) => res.json({ reasons: REPORT_REASONS }));

/** body: { type: 'post'|'comment'|'user', id, reason, details } */
router.post('/', reportLimiter, (req, res) => {
  const type = v.oneOf(req.body.type, ['post', 'comment', 'user'], 'Şikâyet türü');
  const id = v.id(req.body.id);
  const reason = v.oneOf(req.body.reason, Object.keys(REPORT_REASONS), 'Şikâyet sebebi');
  const details = v.str(req.body.details ?? '', { field: 'Açıklama', max: 500 });

  // Hedefi bul ve yönetici incelerken içerik silinmiş olsa bile görebilsin diye kopyasını sakla
  let targetUserId;
  let snapshot;
  if (type === 'post') {
    const post = findPost(id);
    if (!post) throw new v.HttpError(404, 'Paylaşım bulunamadı.');
    targetUserId = post.user_id;
    snapshot = post.content;
  } else if (type === 'comment') {
    const comment = findComment(id);
    if (!comment) throw new v.HttpError(404, 'Yorum bulunamadı.');
    targetUserId = comment.user_id;
    snapshot = comment.content;
  } else {
    const user = findUserById(id);
    if (!user) throw new v.HttpError(404, 'Kullanıcı bulunamadı.');
    targetUserId = user.id;
    snapshot = `${user.display_name} (@${user.username})${user.bio ? ` — ${user.bio}` : ''}`;
  }
  if (targetUserId === req.user.id) throw v.bad('Kendi içeriğini şikâyet edemezsin.');
  if (hasOpenReport(req.user.id, type, id)) throw v.bad('Bunu zaten şikâyet ettin; yöneticiler inceliyor.');

  const reportId = createReport({ reporterId: req.user.id, type, targetId: id, targetUserId, snapshot: snapshot.slice(0, 1000), reason, details });
  log(req, 'report.create', { targetId: targetUserId, data: { reportId, type, reason } });
  res.status(201).json({ ok: true });
});

export default router;
