import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requestLimiter } from '../middleware/rateLimit.js';
import * as v from '../validation.js';
import { findByUsername, privacyOf, toPublic } from '../models/users.js';
import { followStatus } from '../models/follows.js';
import { isBlockedEitherWay } from '../models/safety.js';
import {
  deleteMessage,
  findConversation,
  listConversations,
  listMessages,
  markRead,
  sendMessage,
  unreadMessageCount,
} from '../models/messages.js';

const router = Router();
router.use(requireAuth);

const sendLimiter = requestLimiter({ max: 40, windowMs: 60 * 1000, message: 'Çok hızlı mesaj gönderiyorsun.' });

function requireOther(req) {
  const other = findByUsername(req.params.username);
  if (!other || other.status !== 'active') throw new v.HttpError(404, 'Kullanıcı bulunamadı.');
  if (other.id === req.user.id) throw v.bad('Kendine mesaj gönderemezsin.');
  return other;
}

/** Gizli hesaplara yalnızca onaylı takipçileri (veya daha önce yazıştığı kişiler) yeni mesaj atabilir. */
function canMessage(sender, recipient) {
  if (isBlockedEitherWay(sender.id, recipient.id)) return false;
  if (sender.role === 'admin' || !privacyOf(recipient).privateAccount) return true;
  return followStatus(sender.id, recipient.id) === 'accepted' || Boolean(findConversation(sender.id, recipient.id)?.last_message_id);
}

router.get('/conversations', (req, res) => res.json({ conversations: listConversations(req.user.id) }));

router.get('/unread-count', (req, res) => res.json({ count: unreadMessageCount(req.user.id) }));

/** Bir kişiyle olan sohbet. ?before=id daha eski mesajlar, ?after=id yeni gelenler (canlı yenileme). */
router.get('/with/:username', (req, res) => {
  const other = requireOther(req);
  const conv = findConversation(req.user.id, other.id);
  const before = req.query.before ? v.id(req.query.before) : null;
  // after=0 geçerli (ilk mesajdan itibaren hepsi)
  const after = req.query.after !== undefined ? Math.max(0, Number.parseInt(req.query.after, 10) || 0) : null;
  const data = conv ? listMessages(conv.id, { before, after: after ?? null }) : { messages: [], hasMore: false };
  if (conv) markRead(conv.id, req.user.id);
  res.json({ user: toPublic(other), canMessage: canMessage(req.user, other), ...data });
});

router.post('/with/:username', sendLimiter, (req, res) => {
  const other = requireOther(req);
  if (!canMessage(req.user, other)) {
    throw new v.HttpError(403, isBlockedEitherWay(req.user.id, other.id) ? 'Bu kişiyle mesajlaşamazsın.' : 'Bu gizli hesaba yalnızca takipçileri mesaj gönderebilir.');
  }
  const content = v.str(req.body.content, { field: 'Mesaj', min: 1, max: 2000 });
  res.status(201).json({ message: sendMessage(req.user.id, other.id, content) });
});

router.delete('/:id', (req, res) => {
  if (!deleteMessage(v.id(req.params.id), req.user.id)) throw new v.HttpError(404, 'Mesaj bulunamadı.');
  res.json({ ok: true });
});

export default router;
