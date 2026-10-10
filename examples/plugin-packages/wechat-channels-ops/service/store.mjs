import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

// Adapted from douyin-ops records store; browser credentials stay with the host.
export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = resolve(directory, 'wechat-channels-ops.db');
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL, id TEXT NOT NULL, account_id TEXT, operation_key TEXT,
        data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(kind,id),
        UNIQUE(kind,account_id,operation_key));
      CREATE INDEX IF NOT EXISTS records_account ON records(kind,account_id,updated_at DESC);`);
  }
  get(kind, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(row.data) : null;
  }
  byOperation(kind, accountId, key) {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND account_id=? AND operation_key=?').get(kind, accountId, key);
    return row ? JSON.parse(row.data) : null;
  }
  list(kind, accountId = null, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid limit');
    const rows = accountId === null
      ? this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY updated_at DESC,rowid DESC LIMIT ?').all(kind, limit)
      : this.db.prepare('SELECT data FROM records WHERE kind=? AND account_id=? ORDER BY updated_at DESC,rowid DESC LIMIT ?').all(kind, accountId, limit);
    return rows.map(row => JSON.parse(row.data));
  }
  count(kind) { return this.db.prepare('SELECT count(*) AS n FROM records WHERE kind=?').get(kind).n; }
  put(kind, record) {
    this.db.prepare(`INSERT INTO records(kind,id,account_id,operation_key,data,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(kind,id) DO UPDATE SET account_id=excluded.account_id, operation_key=excluded.operation_key,
      data=excluded.data,updated_at=excluded.updated_at`).run(kind, record.id, record.accountId ?? null,
      record.operationKey ?? null, JSON.stringify(record), Date.now());
    return record;
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
