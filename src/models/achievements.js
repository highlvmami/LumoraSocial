import { db } from '../db.js';
import { notify } from './notifications.js';

/*
 * Başarımlar: kullanıcının etkinliklerinden (paylaşım, mesaj, takip vb.) hesaplanır.
 * Kazanılanlar user_achievements tablosuna yazılır; ilk kazanılışta bildirim gider.
 * Yeni başarım eklemek için listeye bir satır eklemek yeterli.
 */
export const ACHIEVEMENTS = [
  { key: 'post_1', stat: 'posts', goal: 1, icon: '✍️', title: 'İlk adım', desc: 'İlk paylaşımını yap' },
  { key: 'post_10', stat: 'posts', goal: 10, icon: '📝', title: 'Paylaşımcı', desc: '10 paylaşım yap' },
  { key: 'post_50', stat: 'posts', goal: 50, icon: '📚', title: 'Kalem ustası', desc: '50 paylaşım yap' },
  { key: 'post_100', stat: 'posts', goal: 100, icon: '🏆', title: 'Efsane yazar', desc: '100 paylaşım yap' },
  { key: 'msg_10', stat: 'messages', goal: 10, icon: '💬', title: 'Sohbet başladı', desc: '10 mesaj gönder' },
  { key: 'msg_100', stat: 'messages', goal: 100, icon: '🗨️', title: 'Konuşkan', desc: '100 mesaj gönder' },
  { key: 'msg_500', stat: 'messages', goal: 500, icon: '📣', title: 'Sohbet kralı', desc: '500 mesaj gönder' },
  { key: 'following_1', stat: 'following', goal: 1, icon: '🤝', title: 'İlk arkadaş', desc: 'Birini takip et' },
  { key: 'following_10', stat: 'following', goal: 10, icon: '🦋', title: 'Sosyal kelebek', desc: '10 kişiyi takip et' },
  { key: 'followers_10', stat: 'followers', goal: 10, icon: '⭐', title: 'Tanınıyor', desc: '10 takipçiye ulaş' },
  { key: 'followers_50', stat: 'followers', goal: 50, icon: '🌟', title: 'Popüler', desc: '50 takipçiye ulaş' },
  { key: 'followers_100', stat: 'followers', goal: 100, icon: '👑', title: 'Yıldız', desc: '100 takipçiye ulaş' },
  { key: 'comment_10', stat: 'comments', goal: 10, icon: '💭', title: 'Yorumcu', desc: '10 yorum yaz' },
  { key: 'comment_50', stat: 'comments', goal: 50, icon: '🎙️', title: 'Fikir önderi', desc: '50 yorum yaz' },
  { key: 'likes_10', stat: 'reactions', goal: 10, icon: '❤️', title: 'Beğenildi', desc: 'Paylaşımların 10 tepki alsın' },
  { key: 'likes_100', stat: 'reactions', goal: 100, icon: '🔥', title: 'Gündemde', desc: 'Paylaşımların 100 tepki alsın' },
  { key: 'story_1', stat: 'stories', goal: 1, icon: '📸', title: 'Hikaye anlatıcısı', desc: 'İlk hikayeni paylaş' },
  { key: 'poll_1', stat: 'polls', goal: 1, icon: '📊', title: 'Anketçi', desc: 'İlk anketini aç' },
  { key: 'tags_5', stat: 'tags', goal: 5, icon: '#️⃣', title: 'Konu açan', desc: '5 farklı #etiket kullan' },
  { key: 'days_30', stat: 'days', goal: 30, icon: '📅', title: 'Müdavim', desc: '30 gündür üyesin' },
  { key: 'days_365', stat: 'days', goal: 365, icon: '🎂', title: 'Kıdemli', desc: '1 yıldır üyesin' },
];

/** Bütün sayaçlar tek sorguda (uzak veritabanında tek gidiş-dönüş). */
function getStats(userId) {
  const r = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM posts WHERE user_id = :id) AS posts,
         (SELECT COUNT(*) FROM messages WHERE sender_id = :id) AS messages,
         (SELECT COUNT(*) FROM follows WHERE follower_id = :id AND status = 'accepted') AS following,
         (SELECT COUNT(*) FROM follows WHERE following_id = :id AND status = 'accepted') AS followers,
         (SELECT COUNT(*) FROM comments WHERE user_id = :id) AS comments,
         (SELECT COUNT(*) FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.user_id = :id AND r.user_id <> :id) AS reactions,
         (SELECT COUNT(*) FROM stories WHERE user_id = :id) AS stories,
         (SELECT COUNT(*) FROM posts WHERE user_id = :id AND has_poll = 1) AS polls,
         (SELECT COUNT(DISTINCT t.tag) FROM post_tags t JOIN posts p ON p.id = t.post_id WHERE p.user_id = :id) AS tags,
         (SELECT CAST(julianday('now') - julianday(created_at) AS INTEGER) FROM users WHERE id = :id) AS days`
    )
    .get({ id: userId });
  return r || {};
}

function earnedMap(userId) {
  return new Map(db.prepare('SELECT key, unlocked_at FROM user_achievements WHERE user_id = ?').all(userId).map((r) => [r.key, r.unlocked_at]));
}

/**
 * Yeni kazanılan başarımları kaydeder ve bildirir. İsteği yavaşlatmaması için
 * işlemden sonra arka planda çalışır.
 */
export function checkAchievements(...userIds) {
  setImmediate(() => {
    for (const userId of new Set(userIds.filter(Boolean))) {
      try {
        const stats = getStats(userId);
        const earned = earnedMap(userId);
        for (const a of ACHIEVEMENTS) {
          if (earned.has(a.key) || (stats[a.stat] || 0) < a.goal) continue;
          const { changes } = db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, key) VALUES (?, ?)').run(userId, a.key);
          if (changes) notify(userId, 'achievement', { data: { key: a.key, icon: a.icon, title: a.title } });
        }
      } catch (err) {
        console.warn('Başarım kontrolü yapılamadı:', err.message);
      }
    }
  });
}

/** Profil için başarım listesi. withProgress: kendi profilinde ilerleme ve kazanılmamışlar da gösterilir. */
export function listAchievements(userId, { withProgress = false } = {}) {
  const earned = earnedMap(userId);
  const stats = withProgress ? getStats(userId) : {};
  const list = ACHIEVEMENTS.map((a) => ({
    key: a.key,
    icon: a.icon,
    title: a.title,
    desc: a.desc,
    goal: a.goal,
    unlockedAt: earned.get(a.key) ?? null,
    progress: withProgress ? Math.min(a.goal, stats[a.stat] || 0) : undefined,
  }));
  return withProgress ? list : list.filter((a) => a.unlockedAt);
}

/** Başarım tablosu sonradan eklendi: mevcut üyelerin kazandıkları bildirim göndermeden bir kez yazılır. */
export function backfillAchievements() {
  if (db.prepare('SELECT 1 FROM user_achievements LIMIT 1').get()) return;
  const add = db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, key) VALUES (?, ?)');
  for (const { id } of db.prepare("SELECT id FROM users WHERE status = 'active'").all()) {
    const stats = getStats(id);
    for (const a of ACHIEVEMENTS) if ((stats[a.stat] || 0) >= a.goal) add.run(id, a.key);
  }
}
