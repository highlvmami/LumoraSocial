import express, { Router } from 'express';
import { MAX_IMAGE_BYTES, removeUpload, saveCheckedImage } from '../uploads.js';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db.js';
import * as v from '../validation.js';
import { ACHIEVEMENTS, checkAchievements, listAchievements } from '../models/achievements.js';
import {
  AVATAR_COLORS,
  SOCIAL_KEYS,
  findByUsername,
  findUserById,
  privacyOf,
  setAvatarUrl,
  setCoverUrl,
  toProfile,
  toSelf,
  updateProfile,
} from '../models/users.js';
import { getFeed } from '../models/posts.js';
import { canViewPostsOf, follow, followStatus, getFollowStats, getSuggestions, unfollow } from '../models/follows.js';
import { notify, removeFollowRequestNotification } from '../models/notifications.js';
import { block, hasBlocked, isBlockedEitherWay, unblock } from '../models/safety.js';
import { log } from '../models/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/avatar-colors', (_req, res) => res.json({ colors: AVATAR_COLORS, socialKeys: SOCIAL_KEYS }));

/* ---- Profil ve kapak fotoğrafı: gövde doğrudan resim baytlarıdır (Content-Type: image/jpeg|png|webp) ---- */
const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_IMAGE_BYTES });

router.put('/me/avatar', rawImage, async (req, res) => {
  removeUpload(setAvatarUrl(req.user.id, await saveCheckedImage('avatars', req.body)));
  res.json({ user: toSelf(findUserById(req.user.id)) });
});

router.delete('/me/avatar', (req, res) => {
  removeUpload(setAvatarUrl(req.user.id, null));
  res.json({ user: toSelf(findUserById(req.user.id)) });
});

router.put('/me/cover', rawImage, async (req, res) => {
  removeUpload(setCoverUrl(req.user.id, await saveCheckedImage('covers', req.body)));
  res.json({ user: toSelf(findUserById(req.user.id)) });
});

router.delete('/me/cover', (req, res) => {
  removeUpload(setCoverUrl(req.user.id, null));
  res.json({ user: toSelf(findUserById(req.user.id)) });
});

router.get('/me/stats', (req, res) => res.json(getFollowStats(req.user.id, req.user.id)));

router.get('/suggestions', (req, res) => res.json({ users: getSuggestions(req.user.id) }));

/** Profil güncelleme. Yalnızca gönderilen alanlar değişir. */
router.patch('/me', (req, res) => {
  const b = req.body;
  const changes = {};
  if (b.displayName !== undefined) changes.displayName = v.displayName(b.displayName);
  if (b.bio !== undefined) changes.bio = v.clean(v.str(b.bio, { field: 'Biyografi', max: 300 }), 'Biyografi');
  if (b.avatarColor !== undefined) {
    if (!AVATAR_COLORS.includes(b.avatarColor)) throw v.bad('Geçersiz renk.');
    changes.avatarColor = b.avatarColor;
  }
  if (b.birthDate !== undefined) changes.birthDate = v.date(b.birthDate ?? '', 'Doğum tarihi');
  if (b.location !== undefined) changes.location = v.clean(v.str(b.location, { field: 'Konum', max: 60 }), 'Konum');
  if (b.website !== undefined) changes.website = v.clean(v.url(b.website), 'Web sitesi');
  if (b.occupation !== undefined) changes.occupation = v.clean(v.str(b.occupation, { field: 'Meslek', max: 60 }), 'Meslek');
  if (b.education !== undefined) changes.education = v.clean(v.str(b.education, { field: 'Eğitim', max: 100 }), 'Eğitim');
  if (b.interests !== undefined) {
    if (!Array.isArray(b.interests)) throw v.bad('İlgi alanları geçersiz.');
    const list = [...new Set(b.interests.map((i) => v.clean(v.str(i, { field: 'İlgi alanı', max: 30 }), 'İlgi alanı')).filter(Boolean))];
    if (list.length > 15) throw v.bad('En fazla 15 ilgi alanı ekleyebilirsin.');
    changes.interests = list;
  }
  if (b.socialLinks !== undefined) {
    if (typeof b.socialLinks !== 'object' || b.socialLinks === null) throw v.bad('Sosyal bağlantılar geçersiz.');
    const links = {};
    for (const key of SOCIAL_KEYS) {
      const val = v.clean(v.str(b.socialLinks[key] ?? '', { field: 'Sosyal bağlantı', max: 100 }), 'Sosyal bağlantı');
      if (!val) continue;
      // Tam adres girildiyse doğrula; kullanıcı adı girildiyse @ işaretini at
      links[key] = /^https?:\/\//i.test(val) ? v.url(val, 'Sosyal bağlantı') : val.replace(/^@/, '').replace(/[^\w.\-]/g, '');
    }
    changes.socialLinks = links;
  }
  res.json({ user: toSelf(updateProfile(req.user.id, changes)) });
});

function requireUser(username) {
  const u = findByUsername(username);
  if (!u) throw new v.HttpError(404, 'Kullanıcı bulunamadı.');
  return u;
}

/** Bir üyenin profili ve paylaşımları (gizlilik ayarlarına göre). */
router.get('/:username', (req, res) => {
  const u = requireUser(req.params.username);
  const isSelf = u.id === req.user.id;
  if (!isSelf && req.user.role !== 'admin' && isBlockedEitherWay(req.user.id, u.id)) {
    // Beni engelleyen kişi yokmuş gibi görünür; benim engellediğim kişinin yalnızca adı görünür
    if (!hasBlocked(req.user.id, u.id)) throw new v.HttpError(404, 'Kullanıcı bulunamadı.');
    return res.json({
      user: { id: u.id, username: u.username, displayName: u.display_name, avatarColor: u.avatar_color, blockedByMe: true },
      locked: true,
      blocked: true,
      posts: [],
      hasMore: false,
    });
  }
  const status = isSelf ? 'none' : followStatus(req.user.id, u.id);
  const rel = { isSelf, isFollower: status === 'accepted', isAdmin: req.user.role === 'admin' };
  const postCount = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?').get(u.id).n;
  const profile = { ...toProfile(u, rel), postCount, ...getFollowStats(u.id, req.user.id) };
  // Yönetici, gizli hesabı/gizli bilgileri denetim için görür; arayüzde bunun belirtilmesi için işaret
  if (rel.isAdmin && !isSelf) {
    const memberView = toProfile(u, { ...rel, isAdmin: false });
    const hiddenForMembers =
      (profile.privateAccount && !rel.isFollower) || ['birthDate', 'location', 'email', 'phone'].some((k) => memberView[k] !== profile[k]);
    if (hiddenForMembers) profile.adminView = true;
  }

  if (!canViewPostsOf(req.user, u)) {
    return res.json({ user: profile, locked: true, posts: [], hasMore: false });
  }
  const before = req.query.before ? v.id(req.query.before) : null;
  const feed = getFeed({ viewerId: req.user.id, viewerIsAdmin: rel.isAdmin, before, userId: u.id });
  res.json({ user: profile, locked: false, ...feed });
});

/** Başarımlar: kendi profilinde hepsi ilerlemesiyle, başkasının profilinde yalnızca kazanılanlar. */
router.get('/:username/achievements', (req, res) => {
  const u = requireUser(req.params.username);
  const isSelf = u.id === req.user.id;
  if (!isSelf && isBlockedEitherWay(req.user.id, u.id)) throw new v.HttpError(404, 'Kullanıcı bulunamadı.');
  res.json({ achievements: listAchievements(u.id, { withProgress: isSelf }), total: ACHIEVEMENTS.length });
});

/** Takip et. Gizli hesaplarda istek gönderilir ve hesap sahibi onaylar. */
router.post('/:username/follow', (req, res) => {
  const u = requireUser(req.params.username);
  if (u.id === req.user.id) throw v.bad('Kendini takip edemezsin.');
  if (u.status !== 'active') throw v.bad('Bu hesap takip edilemez.');
  if (isBlockedEitherWay(req.user.id, u.id)) throw v.bad('Bu hesabı takip edemezsin.');

  const before = followStatus(req.user.id, u.id);
  const needsApproval = privacyOf(u).privateAccount;
  follow(req.user.id, u.id, needsApproval ? 'pending' : 'accepted');
  if (!needsApproval) checkAchievements(req.user.id, u.id);
  if (before === 'none') notify(u.id, needsApproval ? 'follow_request' : 'new_follower', { actorId: req.user.id });
  res.json(getFollowStats(u.id, req.user.id));
});

/** Engelle / engeli kaldır. */
router.post('/:username/block', (req, res) => {
  const u = requireUser(req.params.username);
  if (u.id === req.user.id) throw v.bad('Kendini engelleyemezsin.');
  block(req.user.id, u.id);
  removeFollowRequestNotification(req.user.id, u.id);
  removeFollowRequestNotification(u.id, req.user.id);
  log(req, 'account.block', { targetId: u.id });
  res.json({ blocked: true });
});

router.delete('/:username/block', (req, res) => {
  const u = requireUser(req.params.username);
  unblock(req.user.id, u.id);
  log(req, 'account.unblock', { targetId: u.id });
  res.json({ blocked: false });
});

/** Takibi bırak veya bekleyen isteği geri çek. */
router.delete('/:username/follow', (req, res) => {
  const u = requireUser(req.params.username);
  unfollow(req.user.id, u.id);
  removeFollowRequestNotification(u.id, req.user.id);
  res.json(getFollowStats(u.id, req.user.id));
});

export default router;
