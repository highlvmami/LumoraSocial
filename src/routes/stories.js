import express, { Router } from 'express';
import { MAX_IMAGE_BYTES, saveImage } from '../uploads.js';
import { requireAuth } from '../middleware/auth.js';
import * as v from '../validation.js';
import { followStatus } from '../models/follows.js';
import { isBlockedEitherWay } from '../models/safety.js';
import { REACTIONS } from '../models/posts.js';
import { sendMessage } from '../models/messages.js';
import {
  MAX_ACTIVE_STORIES,
  STORY_BACKGROUNDS,
  countActiveStories,
  createStory,
  deleteStory,
  findStory,
  getStoryTray,
  listViewers,
  markViewed,
  setReaction,
} from '../models/stories.js';

const router = Router();
router.use(requireAuth);

const STORY_TEXT_MAX = 200;

/** Hikayeyi görebilir mi: sahibi ya da onaylı takipçisi (engel yoksa). */
const canSee = (user, story) =>
  story.user_id === user.id || (followStatus(user.id, story.user_id) === 'accepted' && !isBlockedEitherWay(user.id, story.user_id));

const checkLimit = (userId) => {
  if (countActiveStories(userId) >= MAX_ACTIVE_STORIES) throw v.bad(`Aynı anda en fazla ${MAX_ACTIVE_STORIES} hikayen olabilir.`);
};

router.get('/', (req, res) => {
  res.json({ tray: getStoryTray(req.user.id), backgrounds: STORY_BACKGROUNDS, reactions: REACTIONS });
});

/** Yazılı hikaye */
router.post('/', (req, res) => {
  checkLimit(req.user.id);
  const text = v.str(req.body.text, { field: 'Hikaye metni', min: 1, max: STORY_TEXT_MAX });
  const bg = v.oneOf(req.body.bg || STORY_BACKGROUNDS[0], STORY_BACKGROUNDS, 'Arka plan rengi');
  const id = createStory(req.user.id, { text, bg });
  res.status(201).json({ id });
});

/** Fotoğraflı hikaye: gövde resim baytlarıdır, isteğe bağlı yazı ?text= ile gelir. */
router.post('/photo', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_IMAGE_BYTES }), (req, res) => {
  checkLimit(req.user.id);
  const text = v.str(req.query.text ?? '', { field: 'Hikaye metni', max: STORY_TEXT_MAX });
  const imageUrl = saveImage('stories', req.body);
  const id = createStory(req.user.id, { imageUrl, text });
  res.status(201).json({ id });
});

router.post('/:id/view', (req, res) => {
  const story = findStory(v.id(req.params.id));
  if (!story || !canSee(req.user, story)) throw new v.HttpError(404, 'Hikaye bulunamadı.');
  if (story.user_id !== req.user.id) markViewed(story.id, req.user.id);
  res.json({ ok: true });
});

/** Başkasının hikayesine bakan için: hikaye bulunur, görülebilir ve kendi hikayesi değilse döner. */
function othersStory(req) {
  const story = findStory(v.id(req.params.id));
  if (!story || !canSee(req.user, story)) throw new v.HttpError(404, 'Hikaye bulunamadı.');
  if (story.user_id === req.user.id) throw v.bad('Kendi hikayene tepki veremezsin.');
  return story;
}

// Hikayeden kısa alıntı (mesajda hangi hikayeye yanıt verildiği anlaşılsın)
const quote = (story) => (story.text ? `“${story.text.length > 60 ? story.text.slice(0, 60) + '…' : story.text}”` : 'fotoğraf');

/** Emoji tepkisi: hikaye sahibine mesaj olarak da gider (geri alınca gitmez). */
router.post('/:id/react', (req, res) => {
  const story = othersStory(req);
  const emoji = v.oneOf(req.body.emoji, REACTIONS, 'Tepki');
  const reaction = setReaction(story.id, req.user.id, emoji);
  if (reaction) sendMessage(req.user.id, story.user_id, `${reaction} Hikayene tepki verdi (${quote(story)})`);
  res.json({ reaction });
});

/** Yazılı yanıt: hikaye sahibine mesaj olarak gider. */
router.post('/:id/reply', (req, res) => {
  const story = othersStory(req);
  const text = v.str(req.body.text, { field: 'Yanıt', min: 1, max: 1000 });
  markViewed(story.id, req.user.id);
  sendMessage(req.user.id, story.user_id, `Hikayene yanıt (${quote(story)}): ${text}`);
  res.status(201).json({ ok: true });
});

router.get('/:id/viewers', (req, res) => {
  const story = findStory(v.id(req.params.id));
  if (!story || story.user_id !== req.user.id) throw new v.HttpError(404, 'Hikaye bulunamadı.');
  res.json({ viewers: listViewers(story.id) });
});

router.delete('/:id', (req, res) => {
  const story = findStory(v.id(req.params.id));
  if (!story || (story.user_id !== req.user.id && req.user.role !== 'admin')) throw new v.HttpError(404, 'Hikaye bulunamadı.');
  deleteStory(story.id);
  res.json({ ok: true });
});

export default router;
