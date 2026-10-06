import { db } from '../db.js';
import { canViewPostsOf } from './follows.js';
import { isBlockedEitherWay } from './safety.js';
import { notify, preview } from './notifications.js';

const MENTION_RE = /(?:^|[^\w.@])@([a-zA-Z0-9_.]{3,24})/g;
const MAX_MENTIONS = 10;

/** Metindeki @kullanıcı adlarını (tekrarsız, en fazla 10) döner. */
export function extractMentions(text) {
  const names = new Set();
  for (const m of String(text).matchAll(MENTION_RE)) names.add(m[1].replace(/\.+$/, '').toLowerCase());
  return [...names].slice(0, MAX_MENTIONS);
}

/**
 * Paylaşım/yorumda bahsedilen kişilere bildirim gönderir.
 * Kendine, engelli ilişkilere ve paylaşımı göremeyecek kişilere (gizli hesap) bildirim gitmez.
 * skipIds: zaten başka bildirim alacak kişiler (ör. yorum yapılan paylaşımın sahibi).
 */
export function notifyMentions({ text, actor, postOwner, postId, postContent, commentId = null, skipIds = [] }) {
  for (const name of extractMentions(text)) {
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND status = 'active'").get(name);
    if (!user || user.id === actor.id || skipIds.includes(user.id)) continue;
    if (isBlockedEitherWay(actor.id, user.id) || isBlockedEitherWay(postOwner.id, user.id)) continue;
    if (!canViewPostsOf(user, postOwner)) continue;
    notify(user.id, 'mention', {
      actorId: actor.id,
      data: { postId, commentId, preview: preview(postContent), text: preview(text, 120), inComment: Boolean(commentId) },
    });
  }
}
