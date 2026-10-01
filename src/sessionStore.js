import session from 'express-session';
import { db } from './db.js';

const DAY = 24 * 60 * 60 * 1000;

/** Oturumları SQLite'ta saklar; sunucu yeniden başlasa da kullanıcılar çıkış yapmaz. */
export class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    this.getStmt = db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires > ?');
    this.setStmt = db.prepare(
      'INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires'
    );
    this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.cleanupStmt = db.prepare('DELETE FROM sessions WHERE expires <= ?');
    setInterval(() => this.cleanupStmt.run(Date.now()), 60 * 60 * 1000).unref();
  }

  expiresOf(sess) {
    return sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DAY;
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.setStmt.run(sid, JSON.stringify(sess), this.expiresOf(sess));
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.destroyStmt.run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.touchStmt.run(this.expiresOf(sess), sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }
}
