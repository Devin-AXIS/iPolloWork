/** PostgreSQL persistence. Each transaction keeps one pooled connection until commit or rollback. */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import type { Config } from "./config.js";
import { ServiceError } from "./errors.js";
import { adoptStoredResources } from "./storage-import.js";

export type Row = Record<string, string | number | boolean | null>;
type Parameter = string | number | boolean | Date | Buffer | null;

/** Number positional parameters without changing quoted SQL literals or identifiers. */
function parameters(sql: string): string {
  let quoted = "",
    index = 0,
    result = "";
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;
    if (quoted) {
      result += char;
      if (char === quoted) {
        if (sql[i + 1] === quoted) result += sql[++i];
        else quoted = "";
      }
    } else if (char === "'" || char === '"') {
      quoted = char;
      result += char;
    } else result += char === "?" ? "$" + ++index : char;
  }
  return result;
}

/** Business APIs use safe integer amounts and epoch milliseconds; auth uses the unmodified pool. */
function rowValue(value: unknown): string | number | boolean | null {
  if (value instanceof Date) return value.getTime();
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string") return value;
  throw new Error("Unexpected PostgreSQL business column type");
}

export class Store {
  readonly db: Pool;
  private readonly connection = new AsyncLocalStorage<PoolClient>();
  get inTransaction(): boolean {
    return this.connection.getStore() !== undefined;
  }
  constructor(config: Config) {
    this.db = new Pool({
      connectionString: config.databaseUrl,
      max: config.databasePoolSize,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      options: `-c search_path=${config.databaseSchema} -c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000`,
    });
    this.db.on("error", () => console.error("PostgreSQL idle connection lost"));
  }
  async all<T extends Row = Row>(
    sql: string,
    ...values: Parameter[]
  ): Promise<T[]> {
    const result = await (this.connection.getStore() ?? this.db).query(
      parameters(sql),
      values,
    );
    return result.rows.map(
      (row: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => {
            const field = result.fields.find((field) => field.name === key);
            if (
              field &&
              (field.dataTypeID === 20 || field.dataTypeID === 1700) &&
              typeof value === "string"
            ) {
              const number = Number(value);
              if (!Number.isSafeInteger(number))
                throw new Error("PostgreSQL integer exceeds safe range");
              return [key, number];
            }
            return [key, rowValue(value)];
          }),
        ) as T,
    );
  }
  async one<T extends Row = Row>(
    sql: string,
    ...values: Parameter[]
  ): Promise<T | undefined> {
    return (await this.all<T>(sql, ...values))[0];
  }
  async run(sql: string, ...values: Parameter[]): Promise<{ changes: number }> {
    const result = await (this.connection.getStore() ?? this.db).query(
      parameters(sql),
      values,
    );
    return { changes: result.rowCount ?? 0 };
  }
  /** Database-only callback. Business owners lock the wallet, order or project being changed before reading mutable state. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.connection.getStore()) return fn();
    const client = await this.db.connect();
    let broken = false;
    let committing = false;
    try {
      await client.query("BEGIN");
      const result = await this.connection.run(client, fn);
      committing = true;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        broken = true;
      }
      if (
        committing &&
        (!error ||
          typeof error !== "object" ||
          !("code" in error) ||
          !/^[0-9A-Z]{5}$/.test(String(error.code)))
      )
        throw new ServiceError(
          "DATABASE_COMMIT_UNKNOWN",
          503,
          "操作结果尚未确认，请先查询当前记录",
        );
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "40001" || error.code === "40P01")
      )
        throw new ServiceError(
          "CONCURRENT_UPDATE",
          409,
          "数据刚被更新，请重试本次操作",
        );
      throw error;
    } finally {
      client.release(broken);
    }
  }
  async close(): Promise<void> {
    await this.db.end();
  }
}

/** Authentication tables already exist. Business versions are monotonically increasing and database-local. */
export async function migrate(store: Store, config: Config): Promise<void> {
  await store.transaction(async () => {
    await store.run("SELECT pg_advisory_xact_lock(474317850)");
    await store.run(
      "CREATE TABLE IF NOT EXISTS service_schema(version BIGINT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const version = Number(
      (
        await store.one(
          "SELECT COALESCE(MAX(version),0) AS version FROM service_schema",
        )
      )?.version,
    );
    if (version > 7)
      throw new Error("This database requires a newer iPolloWork service");
    if (version < 1) {
      await store.run(
        await readFile(
          new URL("./schema-postgres.sql", import.meta.url),
          "utf8",
        ),
      );
      await store.run("INSERT INTO service_schema(version) VALUES(1)");
    }
    if (version < 2) {
      await store.run(
        await readFile(
          new URL("./migration-pg-002.sql", import.meta.url),
          "utf8",
        ),
      );
      await store.run("INSERT INTO service_schema(version) VALUES(2)");
    }
    if (version < 3) {
      await store.run(
        await readFile(
          new URL("./migration-pg-003.sql", import.meta.url),
          "utf8",
        ),
      );
      await store.run("INSERT INTO service_schema(version) VALUES(3)");
    }
    if (version < 4) {
      await store.run(
        await readFile(
          new URL("./migration-pg-004.sql", import.meta.url),
          "utf8",
        ),
      );
      await store.run("INSERT INTO service_schema(version) VALUES(4)");
    }
    if (version < 5) {
      await store.run(await readFile(new URL("./migration-pg-005.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(5)");
    }
    if (version < 6) {
      await store.run(await readFile(new URL("./migration-pg-006.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(6)");
    }
    if (version < 7) {
      await store.run(await readFile(new URL("./migration-pg-007.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(7)");
    }
    await adoptStoredResources(store, config);
  });
}
