import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Public records and encrypted credentials have separate access paths. Never
// serialize the vault into workbench state or model tool results.
export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = resolve(directory, 'credentials.key');
    try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    this.key = readFileSync(keyPath);
    const dbPath = resolve(directory, 'douyin-ops.db');
    this.db = new DatabaseSync(dbPath);
    chmodSync(dbPath, 0o600);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL, id TEXT NOT NULL, account_id TEXT, operation_key TEXT,
        data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(kind, id),
        UNIQUE(kind, account_id, operation_key));
      CREATE INDEX IF NOT EXISTS records_account ON records(kind, account_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  }
  get(kind, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(row.data) : null;
  }
  byOperation(kind, accountId, operationKey) {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND account_id=? AND operation_key=?').get(kind, accountId, operationKey);
    return row ? JSON.parse(row.data) : null;
  }
  list(kind, accountId = null, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('记录数量无效');
    const rows = accountId === null
      ? this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY updated_at DESC LIMIT ?').all(kind, limit)
      : this.db.prepare('SELECT data FROM records WHERE kind=? AND account_id=? ORDER BY updated_at DESC LIMIT ?').all(kind, accountId, limit);
    return rows.map(row => JSON.parse(row.data));
  }
  put(kind, record) {
    this.db.prepare(`INSERT INTO records(kind,id,account_id,operation_key,data,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`).run(
      kind, record.id, record.accountId ?? null, record.operationKey ?? null, JSON.stringify(record), Date.now());
    return record;
  }
  remove(kind, id) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); }
  secret(id) {
    const row = this.db.prepare('SELECT data FROM vault WHERE id=?').get(id);
    if (!row) return null;
    const bytes = Buffer.from(row.data, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
  }
  setSecret(id, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    this.db.prepare('INSERT INTO vault(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(id, Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'));
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
