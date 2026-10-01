import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import * as v from '../validation.js';
import { getFeed, likeEscape } from '../models/posts.js';
import { followStatus } from '../models/follows.js';

/* Arama: kişiler (kullanıcı adı, isim, biyografi) ve paylaşımlar (metin, #etiketler). */

const router = Router();
router.use(requireAuth);

const query = (req) => v.str(req.query.q ?? '', { field: 'Arama', max: 80 });

router.get('/users', (req, res) => {
  const q = query(req).replace(/^@/, '');
  if (!q) return res.json({ users: [] });
  const like = `%${likeEscape(q)}%`;
  const users = db
    .prepare(
      `SELECT id, username, display_name, bio, avatar_color, avatar_url, is_verified, privacy,
         (SELECT COUNT(*) FROM follows f WHERE f.following_id = users.id AND f.status = 'accepted') AS followers
       FROM users
       WHERE status = 'active'
         AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
         AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
         AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR bio LIKE ? ESCAPE '\\')
       ORDER BY
         (username = ? COLLATE NOCASE) DESC,          -- tam eşleşme önce
         (username LIKE ? ESCAPE '\\') DESC,          -- sonra ile başlayanlar
         followers DESC, id DESC
       LIMIT 30`
    )
    .all(req.user.id, req.user.id, like, like, like, q, `${likeEscape(q)}%`)
    .map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      bio: u.bio,
      avatarColor: u.avatar_color,
      avatarUrl: u.avatar_url,
      isVerified: Boolean(u.is_verified),
      privateAccount: JSON.parse(u.privacy || '{}').privateAccount === true,
      followers: u.followers,
      followStatus: u.id === req.user.id ? 'self' : followStatus(req.user.id, u.id),
    }));
  res.json({ users });
});

/** Paylaşım arama; gizli hesap kuralları akıştakiyle aynıdır. */
router.get('/posts', (req, res) => {
  const q = query(req);
  if (!q) return res.json({ posts: [], hasMore: false });
  const before = req.query.before ? v.id(req.query.before) : null;
  res.json(getFeed({ viewerId: req.user.id, viewerIsAdmin: req.user.role === 'admin', before, search: q }));
});

export default router;
