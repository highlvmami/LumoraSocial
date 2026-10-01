import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as v from '../validation.js';
import { listNotifications, markAllRead, unreadCount } from '../models/notifications.js';
import { unreadMessageCount } from '../models/messages.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const before = req.query.before ? v.id(req.query.before) : null;
  res.json(listNotifications(req.user.id, { before }));
});

/** Kenar çubuğundaki sayaçlar: okunmamış bildirim ve mesaj. */
router.get('/unread-count', (req, res) => res.json({ count: unreadCount(req.user.id), messages: unreadMessageCount(req.user.id) }));

router.post('/read-all', (req, res) => {
  markAllRead(req.user.id);
  res.json({ ok: true });
});

export default router;
