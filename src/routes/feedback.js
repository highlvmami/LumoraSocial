import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requestLimiter } from '../middleware/rateLimit.js';
import * as v from '../validation.js';
import { FEEDBACK_KINDS, createFeedback, listMyFeedback } from '../models/feedback.js';

/* Üyelerin geri bildirim ve öneri göndermesi. Okuma ve sonuçlandırma yönetim panelinde (routes/admin.js). */

const router = Router();
router.use(requireAuth);

const feedbackLimiter = requestLimiter({ max: 10, windowMs: 60 * 60 * 1000, message: 'Çok fazla geri bildirim gönderdin. Biraz sonra tekrar dene.' });

router.get('/', (req, res) => res.json({ kinds: FEEDBACK_KINDS, feedback: listMyFeedback(req.user.id) }));

/** body: { kind: 'oneri'|'hata'|'diger', message } */
router.post('/', feedbackLimiter, (req, res) => {
  const kind = v.oneOf(req.body.kind, Object.keys(FEEDBACK_KINDS), 'Tür');
  const message = v.str(req.body.message, { field: 'Mesaj', min: 5, max: 2000 });
  createFeedback(req.user.id, kind, message);
  res.status(201).json({ feedback: listMyFeedback(req.user.id) });
});

export default router;
