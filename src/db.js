import fs from 'node:fs';
import path from 'node:path';
import Database from 'libsql';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

/*
 * Turso ayarlıysa (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN) veriler bulutta tutulur:
 * her sorgu doğrudan Turso'ya gider (TURSO_MODE=replica ise okumalar sunucudaki yerel kopyadan yapılır).
 * Ayarlı değilse her şey DB_PATH'teki yerel dosyada kalır.
 */
const remote = Boolean(config.turso.url);
const replica = remote && config.turso.mode === 'replica';
const raw = !remote
  ? new Database(config.dbPath)
  : replica
    ? new Database(config.turso.replicaPath, { syncUrl: config.turso.url, authToken: config.turso.authToken })
    : new Database(config.turso.url, { authToken: config.turso.authToken });
if (replica) raw.sync();
if (!remote) raw.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
raw.exec('PRAGMA foreign_keys = ON;');

// libsql her satıra bir `_metadata` alanı ekliyor; yanıtlara sızmasın diye temizlenir.
// Turso, SQL anahtar kelimesi olan sütun adlarını (action, following…) büyük harfle döndürüyor;
// şemadaki tüm adlar küçük harf olduğu için geri çevrilir.
const clean = (row) => {
  if (!row || typeof row !== 'object') return row;
  delete row._metadata;
  for (const key of Object.keys(row)) {
    if (/^[A-Z_]+$/.test(key)) {
      row[key.toLowerCase()] = row[key];
      delete row[key];
    }
  }
  return row;
};

// Uzun süren sorgular sunucu kaydına yazılır (Turso bağlantı hızını izlemek için)
const SLOW_MS = Number(process.env.DB_SLOW_MS) || 300;
function timed(label, sql, fn) {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  if (ms > SLOW_MS) console.log(`[db] yavaş ${label} ${Math.round(ms)} ms: ${sql.replace(/\s+/g, ' ').slice(0, 80)}`);
  return result;
}

class Statement {
  constructor(stmt, sql) { this.stmt = stmt; this.sql = sql; }
  get(...args) { return timed('get', this.sql, () => clean(this.stmt.get(...args))); }
  all(...args) { return timed('all', this.sql, () => this.stmt.all(...args).map(clean)); }
  run(...args) { return timed('run', this.sql, () => this.stmt.run(...args)); }
}

const statements = new Map();

export const db = {
  // Turso'da her prepare bir ağ gidiş-dönüşü olduğu için hazırlanan sorgular saklanır
  prepare: (sql) => {
    let stmt = statements.get(sql);
    if (!stmt) {
      stmt = timed('prepare', sql, () => new Statement(raw.prepare(sql), sql));
      if (statements.size > 500) statements.clear();
      statements.set(sql, stmt);
    }
    return stmt;
  },
  exec: (sql) => raw.exec(sql),
};

/*
 * Şema göçleri. Yeni özellik eklerken diziye YENİ bir eleman ekleyin;
 * mevcut elemanları değiştirmeyin. Sürüm schema_meta tablosunda tutulur.
 */
const migrations = [
  // 1: temel şema
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    avatar_color  TEXT NOT NULL DEFAULT '#6366f1',
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_posts_created ON posts(id DESC);

  CREATE TABLE comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_comments_post ON comments(post_id, id);

  CREATE TABLE reactions (
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id, emoji)
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE sessions (
    sid     TEXT PRIMARY KEY,
    data    TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_expires ON sessions(expires);
  `,

  // 2: takip sistemi
  `
  CREATE TABLE follows (
    follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
  );
  CREATE INDEX idx_follows_following ON follows(following_id);
  `,

  // 3: profil fotoğrafı
  `
  ALTER TABLE users ADD COLUMN avatar_url TEXT;
  `,

  // 4: hesap sistemi (e-posta/telefon, doğrulama, sosyal giriş, cihazlar, bildirimler, profil alanları, gizlilik)
  `
  ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
  ALTER TABLE users ADD COLUMN email_verified_at TEXT;
  ALTER TABLE users ADD COLUMN phone TEXT;
  ALTER TABLE users ADD COLUMN phone_verified_at TEXT;
  ALTER TABLE users ADD COLUMN has_password INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN cover_url TEXT;
  ALTER TABLE users ADD COLUMN birth_date TEXT;
  ALTER TABLE users ADD COLUMN location TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN website TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN social_links TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE users ADD COLUMN occupation TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN education TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN interests TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE users ADD COLUMN privacy TEXT NOT NULL DEFAULT '{}';
  CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;

  -- Tek kullanımlık kodlar/bağlantılar (e-posta doğrulama, telefon doğrulama, şifre sıfırlama)
  CREATE TABLE verification_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    target     TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_vtokens_user ON verification_tokens(user_id, purpose);
  CREATE INDEX idx_vtokens_hash ON verification_tokens(token_hash);

  -- Google / GitHub hesap bağlantıları
  CREATE TABLE oauth_accounts (
    provider         TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email            TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider, provider_user_id),
    UNIQUE (user_id, provider)
  );

  CREATE TABLE oauth_states (
    state        TEXT PRIMARY KEY,
    provider     TEXT NOT NULL,
    link_user_id INTEGER,
    expires_at   INTEGER NOT NULL
  );

  -- Giriş yapılan cihazlar ve giriş denemeleri (yeni cihaz / şüpheli giriş bildirimleri için)
  CREATE TABLE known_devices (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_key TEXT NOT NULL,
    label      TEXT NOT NULL,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, device_key)
  );

  CREATE TABLE login_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip         TEXT NOT NULL,
    success    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_login_attempts_user ON login_attempts(user_id, created_at);

  -- Bildirimler (ileride tepki/yorum bildirimleri de buraya eklenecek)
  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL DEFAULT '{}',
    read_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_notifications_user ON notifications(user_id, id DESC);

  -- Gizli hesaplar için takip istekleri
  ALTER TABLE follows ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted';
  `,

  // 5: paylaşım fotoğrafları (önce yüklenir, paylaşım oluşturulunca bağlanır)
  `
  CREATE TABLE post_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    width      INTEGER NOT NULL DEFAULT 0,
    height     INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_post_images_post ON post_images(post_id, position);
  `,

  // 6: yönetici için olay kayıtları (log)
  `
  CREATE TABLE audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL,
    actor_id   INTEGER,
    actor_name TEXT,
    target_id  INTEGER,
    target_name TEXT,
    ip         TEXT NOT NULL DEFAULT '',
    device     TEXT NOT NULL DEFAULT '',
    data       TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_audit_action ON audit_logs(action, id DESC);
  CREATE INDEX idx_audit_actor ON audit_logs(actor_id, id DESC);
  `,

  // 7: birebir mesajlaşma (user_a < user_b; iki kişi arasında tek sohbet)
  `
  CREATE TABLE conversations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_id INTEGER,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_a, user_b),
    CHECK (user_a < user_b)
  );
  CREATE INDEX idx_conversations_a ON conversations(user_a, updated_at DESC);
  CREATE INDEX idx_conversations_b ON conversations(user_b, updated_at DESC);

  CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    read_at         TEXT,
    deleted         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_messages_conv ON messages(conversation_id, id DESC);
  `,

  // 8: kaydedilen paylaşımlar, engellemeler, şikâyetler
  `
  CREATE TABLE bookmarks (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, post_id)
  );

  CREATE TABLE blocks (
    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
  );
  CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);

  CREATE TABLE reports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_type    TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'user')),
    target_id      INTEGER NOT NULL,
    target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    snapshot       TEXT NOT NULL DEFAULT '',
    reason         TEXT NOT NULL,
    details        TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    resolved_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolution     TEXT NOT NULL DEFAULT '',
    resolved_at    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_reports_status ON reports(status, id DESC);
  `,

  // 9: yüklenen resimler veritabanında (sunucu diski kalıcı olmayabilir)
  `
  CREATE TABLE uploads (
    path       TEXT PRIMARY KEY,
    mime       TEXT NOT NULL,
    data       BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // 10: hikayeler (24 saat sonra kaybolur)
  `
  CREATE TABLE stories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_url  TEXT,
    text       TEXT NOT NULL DEFAULT '',
    bg         TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_stories_user ON stories(user_id, id);
  CREATE INDEX idx_stories_expires ON stories(expires_at);

  CREATE TABLE story_views (
    story_id  INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (story_id, viewer_id)
  );
  `,
];

function schemaVersion() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_meta WHERE id = 1').get();
  if (row) return row.version;
  // Eski yerel kurulumlar sürümü PRAGMA user_version'da tutuyordu
  const legacy = remote ? 0 : db.prepare('PRAGMA user_version').get().user_version;
  db.prepare('INSERT INTO schema_meta (id, version) VALUES (1, ?)').run(legacy);
  return legacy;
}

function migrate() {
  const current = schemaVersion();
  for (let v = current; v < migrations.length; v++) {
    transaction(() => {
      db.exec(migrations[v]);
      db.prepare('UPDATE schema_meta SET version = ? WHERE id = 1').run(v + 1);
    });
    console.log(`[db] göç ${v + 1} uygulandı`);
  }
}

/** fn'i tek bir işlem (transaction) içinde çalıştırır. */
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

migrate();
