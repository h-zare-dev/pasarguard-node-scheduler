import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        source TEXT NOT NULL,
        operation TEXT NOT NULL,
        outcome TEXT NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS confirmations (
        nonce TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        command TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        message TEXT NOT NULL,
        delivered_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  getSetting(key, fallback = '') {
    return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? fallback;
  }

  setSetting(key, value) {
    this.db.prepare(`INSERT INTO settings(key,value) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
  }

  addAudit(source, operation, outcome, detail = '') {
    this.db.prepare('INSERT INTO audit(created_at,source,operation,outcome,detail) VALUES(?,?,?,?,?)')
      .run(new Date().toISOString(), source, operation, outcome, String(detail).slice(0, 300));
  }

  recentAudit(limit = 8) {
    return this.db.prepare('SELECT created_at,source,operation,outcome,detail FROM audit ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(30, limit)));
  }

  enqueueAlert(message) {
    this.db.prepare('INSERT INTO alerts(created_at,message) VALUES(?,?)')
      .run(new Date().toISOString(), String(message).slice(0, 3500));
  }

  pendingAlerts(limit = 10) {
    return this.db.prepare('SELECT id,message FROM alerts WHERE delivered_at IS NULL ORDER BY id ASC LIMIT ?')
      .all(Math.max(1, Math.min(30, limit)));
  }

  markAlertDelivered(id) {
    this.db.prepare('UPDATE alerts SET delivered_at=?, attempts=attempts+1 WHERE id=?')
      .run(new Date().toISOString(), id);
  }

  markAlertFailed(id) {
    this.db.prepare('UPDATE alerts SET attempts=attempts+1 WHERE id=?').run(id);
  }

  createConfirmation(userId, command, now = Date.now()) {
    this.db.prepare('DELETE FROM confirmations WHERE expires_at < ?').run(now);
    const nonce = randomBytes(12).toString('hex');
    this.db.prepare('INSERT INTO confirmations(nonce,user_id,command,expires_at) VALUES(?,?,?,?)')
      .run(nonce, userId, command, now + 60_000);
    return nonce;
  }

  consumeConfirmation(nonce, userId, now = Date.now()) {
    const row = this.db.prepare('SELECT user_id,command,expires_at FROM confirmations WHERE nonce=?').get(nonce);
    if (!row || row.user_id !== userId || row.expires_at < now) return null;
    // Consume before performing a network operation: replay can never issue two writes.
    this.db.prepare('DELETE FROM confirmations WHERE nonce=?').run(nonce);
    return row.command;
  }

  close() { this.db.close(); }
}
