import express, { Router } from 'express';
import { MAX_IMAGE_BYTES, saveImage } from '../uploads.js';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import * as v from '../validation.js';
import {
  REACTIONS,
  MAX_POST_IMAGES,
  addComment,
  addPendingImage,
  countPendingImages,
  removePendingImage,
  createPost,
  deleteComment,
  deletePost,
  findComment,
  findPost,
  getFeed,
  getPost,
  getReactionSummary,
  getComments,
  toggleReaction,
  votePoll,
  getPoll,
  POLL_MIN_OPTIONS,
  POLL_MAX_OPTIONS,
} from '../models/posts.js';

import { canViewPostsOf } from '../models/follows.js';
import { log } from '../models/audit.js';
import { isBlockedEitherWay, toggleBookmark } from '../models/safety.js';
import { notify, preview, removeReactionNotification } from '../models/notifications.js';
import { findUserById } from '../models/users.js';
import { notifyMentions } from '../models/mentions.js';

const router = Router();
router.use(requireAuth);

const canModify = (user, ownerId) => user.id === ownerId || user.role === 'admin';

/** Paylaşımı bulur; gizli hesaba aitse ve izleyen onaylı takipçi değilse bulunamadı sayılır. */
function requirePost(id, viewer) {
  const post = findPost(id);
  if (!post || !canViewPostsOf(viewer, findUserById(post.user_id))) throw new v.HttpError(404, 'Paylaşım bulunamadı.');
  // Engelleme ilişkisi varsa paylaşım yokmuş gibi davran (yöneticiler hariç)
  if (viewer.role !== 'admin' && isBlockedEitherWay(viewer.id, post.user_id)) throw new v.HttpError(404, 'Paylaşım bulunamadı.');
  return post;
}

router.get('/reactions', (_req, res) => res.json({ reactions: REACTIONS }));

router.get('/', (req, res) => {
  const before = req.query.before ? v.id(req.query.before) : null;
  const following = req.query.scope === 'following';
  res.json(getFeed({ viewerId: req.user.id, viewerIsAdmin: req.user.role === 'admin', before, following }));
});

/**
 * Paylaşım fotoğrafı yükleme: fotoğraflar önce tek tek yüklenir, dönen kimlikler paylaşım
 * oluşturulurken (imageIds) gönderilir. Paylaşılmayan fotoğraflar 1 gün sonra silinir.
 */
router.post(
  '/images',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_IMAGE_BYTES }),
  (req, res) => {
    const pending = db.prepare('SELECT COUNT(*) AS n FROM post_images WHERE user_id = ? AND post_id IS NULL').get(req.user.id).n;
    if (pending >= 20) throw v.bad('Çok fazla bekleyen fotoğraf var. Önce paylaşımını tamamla.');
    const dim = (x) => Math.max(0, Math.min(10000, Number.parseInt(x, 10) || 0));
    const url = saveImage('posts', req.body);
    const id = addPendingImage(req.user.id, url, dim(req.query.w), dim(req.query.h));
    res.status(201).json({ image: { id, url } });
  }
);

router.delete('/images/:imageId', (req, res) => {
  if (!removePendingImage(req.user.id, v.id(req.params.imageId))) throw new v.HttpError(404, 'Fotoğraf bulunamadı.');
  res.json({ ok: true });
});

router.post('/', (req, res) => {
  const imageIds = Array.isArray(req.body.imageIds) ? [...new Set(req.body.imageIds.map(v.id))] : [];
  if (imageIds.length > MAX_POST_IMAGES) throw v.bad(`Bir paylaşıma en fazla ${MAX_POST_IMAGES} fotoğraf eklenebilir.`);
  if (countPendingImages(req.user.id, imageIds) !== imageIds.length) throw v.bad('Fotoğraflardan biri bulunamadı, tekrar yükle.');
  // Yeniden paylaşma: alıntılanan gönderi görülebilir olmalı; yorum yazmak isteğe bağlı
  const quoted = req.body.quoteOf ? requirePost(v.id(req.body.quoteOf), req.user) : null;
  const poll = parsePoll(req.body.poll);
  if (poll && (quoted || imageIds.length)) throw v.bad('Anket, fotoğraflı veya yeniden paylaşılan gönderiye eklenemez.');
  const content = v.str(req.body.content, { field: 'Paylaşım', min: imageIds.length || quoted ? 0 : 1, max: 1000 });
  const id = createPost(req.user.id, content, imageIds, { quoteOf: quoted?.id ?? null, poll });
  if (quoted && quoted.user_id !== req.user.id) {
    notify(quoted.user_id, 'post_repost', { actorId: req.user.id, data: { postId: id, preview: preview(quoted.content), text: preview(content, 120) } });
  }
  log(req, 'post.create', { data: { postId: id, images: imageIds.length, preview: content.slice(0, 60) } });
  notifyMentions({ text: content, actor: req.user, postOwner: req.user, postId: id, postContent: content });
  res.status(201).json({ post: getPost(id, req.user.id) });
});

function parsePoll(raw) {
  if (!raw) return null;
  const options = (Array.isArray(raw.options) ? raw.options : []).map((o) => v.str(o, { field: 'Anket seçeneği', max: 80 })).filter(Boolean);
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) throw v.bad(`Ankette ${POLL_MIN_OPTIONS}-${POLL_MAX_OPTIONS} seçenek olmalı.`);
  if (new Set(options.map((o) => o.toLocaleLowerCase('tr'))).size !== options.length) throw v.bad('Anket seçenekleri birbirinden farklı olmalı.');
  const hours = v.oneOf(Number(raw.hours) || 24, [1, 6, 24, 72, 168], 'Anket süresi');
  return { options, hours };
}

/** Ankette oy ver / değiştir / geri al. */
router.post('/:id/vote', (req, res) => {
  const post = requirePost(v.id(req.params.id), req.user);
  const result = votePoll(post.id, req.user.id, v.id(req.body.optionId));
  if (result === 'ended') throw v.bad('Anket sona erdi.');
  if (result !== 'ok') throw new v.HttpError(404, 'Anket bulunamadı.');
  res.json({ poll: getPoll(post.id, req.user.id, post.user_id) });
});

/** Kaydedilen paylaşımlar. */
router.get('/bookmarks', (req, res) => {
  const before = req.query.before ? v.id(req.query.before) : null;
  res.json(getFeed({ viewerId: req.user.id, viewerIsAdmin: req.user.role === 'admin', before, bookmarkedBy: req.user.id }));
});

router.post('/:id/bookmark', (req, res) => {
  const post = requirePost(v.id(req.params.id), req.user);
  res.json({ bookmarked: toggleBookmark(req.user.id, post.id) });
});

/** Tek paylaşım (bildirimden açılır). */
router.get('/:id', (req, res) => {
  const post = requirePost(v.id(req.params.id), req.user);
  res.json({ post: getPost(post.id, req.user.id) });
});

router.delete('/:id', (req, res) => {
  const post = requirePost(v.id(req.params.id), req.user);
  if (!canModify(req.user, post.user_id)) throw new v.HttpError(403, 'Bu paylaşımı silemezsiniz.');
  const byAdmin = post.user_id !== req.user.id;
  log(req, byAdmin ? 'admin.delete_post' : 'post.delete', { targetId: post.user_id, data: { postId: post.id, preview: post.content.slice(0, 60) } });
  deletePost(post.id);
  res.json({ ok: true });
});

router.post('/:id/reactions', (req, res) => {
  const post = requirePost(v.id(req.params.id), req.user);
  const emoji = String(req.body.emoji || '');
  if (!REACTIONS.includes(emoji)) throw v.bad('Geçersiz tepki.');
  const added = toggleReaction(post.id, req.user.id, emoji);
  // Paylaşım sahibine bildirim (kendi paylaşımına verdiği tepki hariç)
  if (post.user_id !== req.user.id) {
    if (added) notify(post.user_id, 'post_reaction', { actorId: req.user.id, data: { postId: post.id, emoji, preview: preview(post.content) } });
    else removeReactionNotification(post.user_id, req.user.id, post.id, emoji);
  }
  res.json({ reactions: getReactionSummary(post.id, req.user.id) });
});

router.post('/:id/comments', (req, res) => {
  const post = requirePost(v.id(req.params.id), req.user);
  const content = v.str(req.body.content, { field: 'Yorum', min: 1, max: 500 });
  const commentId = addComment(post.id, req.user.id, content);
  if (post.user_id !== req.user.id) {
    notify(post.user_id, 'post_comment', {
      actorId: req.user.id,
      data: { postId: post.id, commentId, preview: preview(post.content), text: preview(content, 120) },
    });
  }
  notifyMentions({
    text: content,
    actor: req.user,
    postOwner: findUserById(post.user_id),
    postId: post.id,
    postContent: post.content,
    commentId,
    skipIds: [post.user_id],
  });
  res.status(201).json({ comments: getComments(post.id, req.user.id) });
});

router.delete('/:id/comments/:commentId', (req, res) => {
  const comment = findComment(v.id(req.params.commentId));
  if (!comment || comment.post_id !== v.id(req.params.id)) throw new v.HttpError(404, 'Yorum bulunamadı.');
  if (!canModify(req.user, comment.user_id)) throw new v.HttpError(403, 'Bu yorumu silemezsiniz.');
  if (comment.user_id !== req.user.id) log(req, 'admin.delete_comment', { targetId: comment.user_id, data: { postId: comment.post_id, preview: comment.content.slice(0, 60) } });
  deleteComment(comment.id);
  res.json({ comments: getComments(comment.post_id, req.user.id) });
});

export default router;
