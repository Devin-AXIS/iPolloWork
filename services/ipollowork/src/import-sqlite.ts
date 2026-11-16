/** Explicit, atomic import from a private SQLite snapshot into an empty PostgreSQL service. */
import { DatabaseSync, backup, type SQLOutputValue } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store } from "./database.js";
import type { Config } from "./config.js";
import { adoptStoredResources } from "./storage-import.js";

const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';

/** The source file stays untouched, including WAL-backed writes. Stop its writer before final cutover. */
export async function importSqlite(
  store: Store,
  sourceFile: string,
  config: Config,
): Promise<Record<string, number>> {
  const directory = await mkdtemp(join(tmpdir(), "ipw-import-"));
  const snapshotFile = join(directory, "snapshot.sqlite");
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    await backup(source, snapshotFile);
  } finally {
    source.close();
  }
  const sqlite = new DatabaseSync(snapshotFile);
  try {
    const version = Number(
      sqlite.prepare("PRAGMA user_version").get()?.user_version,
    );
    if (version < 1 || version > 8)
      throw new Error("Unsupported SQLite service version");
    for (let next = version + 1; next <= 8; next++) {
      sqlite.exec(
        readFileSync(
          new URL(
            `./migration-${String(next).padStart(3, "0")}.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      sqlite.exec(`PRAGMA user_version=${next}`);
    }
    if (
      sqlite.prepare("PRAGMA integrity_check").get()?.integrity_check !==
        "ok" ||
      sqlite.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("SQLite integrity verification failed");
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
      )
      .all()
      .map((row) => String(row.name));
    return await store.transaction(async () => {
      const counts: Record<string, number> = {};
      await store.run(
        `LOCK TABLE ${tables.map(quote).join(",")} IN ACCESS EXCLUSIVE MODE`,
      );
      for (const table of tables) {
        const count = await store.one(
          `SELECT COUNT(*) AS n FROM ${quote(table)}`,
        );
        if (count?.n !== 0)
          throw new Error("Import target must be empty: " + table);
      }
      for (const table of tables) {
        const columns = sqlite
          .prepare(`PRAGMA table_info(${quote(table)})`)
          .all()
          .map((row) => String(row.name));
        const target = await store.all<{
          column_name: string;
          data_type: string;
        }>(
          "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=?",
          table,
        );
        const types = new Map(
          target.map((column) => [column.column_name, column.data_type]),
        );
        if (columns.some((column) => !types.has(column)))
          throw new Error("Unrecognized source column: " + table);
        let batch: SQLOutputValue[][] = [];
        const flush = async () => {
          if (!batch.length) return;
          const placeholders = batch
            .map(() => "(" + columns.map(() => "?").join(",") + ")")
            .join(",");
          const values = batch.flatMap((row) =>
            row.map((value, index) => {
              const type = types.get(columns[index]!);
              if (value === null) return null;
              if (type === "boolean") return Boolean(value);
              if (type?.startsWith("timestamp")) {
                const date = new Date(
                  typeof value === "number" ? value : String(value),
                );
                if (!Number.isFinite(date.getTime()))
                  throw new Error("Invalid source date: " + table);
                return date;
              }
              if (typeof value === "bigint") return Number(value);
              if (value instanceof Uint8Array) return Buffer.from(value);
              return value;
            }),
          );
          await store.run(
            `INSERT INTO ${quote(table)}(${columns.map(quote).join(",")}) VALUES ${placeholders}`,
            ...values,
          );
          batch = [];
        };
        let imported = 0;
        for (const row of sqlite
          .prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid`)
          .iterate()) {
          batch.push(columns.map((column) => row[column]!));
          imported++;
          if (batch.length === 250) await flush();
        }
        await flush();
        if (
          (await store.one(`SELECT COUNT(*) AS n FROM ${quote(table)}`))?.n !==
          imported
        )
          throw new Error("Import row-count mismatch: " + table);
        counts[table] = imported;
      }
      await store.run(
        "SELECT setval(pg_get_serial_sequence('audit','id'),COALESCE(MAX(id),1),COUNT(*)>0) FROM audit",
      );
      await store.run(
        "INSERT INTO wallets(user_id,balance,total_earned,total_spent) SELECT user_id,SUM(amount),SUM(GREATEST(amount,0)),SUM(GREATEST(-amount,0)) FROM ledger GROUP BY user_id",
      );
      const expected = Number(
        sqlite
          .prepare("SELECT COALESCE(SUM(amount),0) AS balance FROM ledger")
          .get()?.balance,
      );
      const actual = (
        await store.one(
          "SELECT COALESCE(SUM(balance),0) AS balance FROM wallets",
        )
      )?.balance;
      if (actual !== expected)
        throw new Error("Imported ledger balance mismatch");
      await adoptStoredResources(store, config);
      return counts;
    });
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
}
