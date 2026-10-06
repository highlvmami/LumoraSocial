import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as v from '../validation.js';
import { hasSubscription, pushPublicKey, removeSubscription, saveSubscription } from '../services/push.js';

const router = Router();
router.use(requireAuth);

router.get('/key', (req, res) => res.json({ publicKey: pushPublicKey(), subscribed: hasSubscription(req.user.id) }));

router.post('/subscribe', (req, res) => {
  const sub = req.body.subscription;
  const endpoint = v.str(sub?.endpoint, { field: 'Abonelik', min: 1, max: 1000 });
  if (!/^https:\/\//.test(endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw v.bad('Geçersiz abonelik.');
  saveSubscription(req.user.id, { endpoint, keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) } });
  res.json({ ok: true });
});

/** Telefonda bildirim açılamazsa sebebi sunucu kaydına düşsün (hata ayıklama için) */
router.post('/error', (req, res) => {
  console.log(`[push] istemci hatası (@${req.user.username}): ${String(req.body.message || '').slice(0, 300)} | ${String(req.get('user-agent') || '').slice(0, 120)}`);
  res.json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  removeSubscription(req.user.id, v.str(req.body.endpoint, { field: 'Abonelik', min: 1, max: 1000 }));
  res.json({ ok: true });
});

export default router;
