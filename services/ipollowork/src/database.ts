import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "./config.js";

export type Row = Record<string, string | number | null>;
/** One SQLite file; transaction callbacks remain synchronous. */
export class Store {
  readonly db: DatabaseSync;
  constructor(config: Config) {
    const file = resolve(config.dataDir, "work.sqlite");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  }
  one<T extends Row = Row>(sql: string, ...params: SQLInputValue[]): T | undefined { return this.db.prepare(sql).get(...params) as T | undefined; }
  all<T extends Row = Row>(sql: string, ...params: SQLInputValue[]): T[] { return this.db.prepare(sql).all(...params) as T[]; }
  run(sql: string, ...params: SQLInputValue[]) { return this.db.prepare(sql).run(...params); }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}
/** Business migrations are independent from Better Auth schema migrations. */
export function migrate(store: Store) {
  const version = Number(store.one("PRAGMA user_version")?.user_version ?? 0);
  if (version > 6) throw new Error("This database requires a newer iPolloWork service");
  if (version < 1) store.transaction(() => {
    store.db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
    store.db.exec("PRAGMA user_version=1");
  });
  if (version < 2) store.transaction(() => {
    store.db.exec(readFileSync(new URL("./migration-002.sql", import.meta.url), "utf8"));
    store.db.exec("PRAGMA user_version=2");
  });
  if (version < 3) store.transaction(() => {
    store.db.exec(readFileSync(new URL("./migration-003.sql", import.meta.url), "utf8"));
    store.db.exec("PRAGMA user_version=3");
  });
  if (version < 4) store.transaction(() => {
    store.db.exec(readFileSync(new URL("./migration-004.sql", import.meta.url), "utf8"));
    store.db.exec("PRAGMA user_version=4");
  });
  if (version < 5) store.transaction(() => {
    store.db.exec(readFileSync(new URL("./migration-005.sql", import.meta.url), "utf8"));
    store.db.exec("PRAGMA user_version=5");
  });
  if (version < 6) store.transaction(() => {
    store.db.exec(readFileSync(new URL("./migration-006.sql", import.meta.url), "utf8"));
    store.db.exec("PRAGMA user_version=6");
  });
}
