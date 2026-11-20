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

/** One PostgreSQL database; `Config` satisfies it for the account database, whose statements may run 15 seconds. */
export interface StoreOptions {
  databaseUrl: string;
  databasePoolSize: number;
  databaseSchema: string;
  statementTimeoutMs?: number;
  databaseStatementTimeoutMs?: number;
  databaseConnectionTimeoutMs?: number;
  databaseLockTimeoutMs?: number;
  databaseQueueLimit?: number;
}
export class Store {
  readonly db: Pool;
  private readonly connection = new AsyncLocalStorage<PoolClient>();
  private readonly queueLimit: number;
  private closing?: Promise<void>;
  get inTransaction(): boolean {
    return this.connection.getStore() !== undefined;
  }
  constructor(options: StoreOptions) {
    const timeout = options.statementTimeoutMs ?? options.databaseStatementTimeoutMs ?? 15000;
    this.queueLimit = options.databaseQueueLimit ?? 128;
    this.db = new Pool({
      connectionString: options.databaseUrl,
      max: options.databasePoolSize,
      connectionTimeoutMillis: options.databaseConnectionTimeoutMs ?? 3000,
      idleTimeoutMillis: 30000,
      options: `-c search_path=${options.databaseSchema} -c statement_timeout=${timeout} -c lock_timeout=${options.databaseLockTimeoutMs ?? 3000} -c idle_in_transaction_session_timeout=${Math.max(timeout, 15000)}`,
    });
    this.db.on("error", () => console.error("PostgreSQL idle connection lost"));
  }
  async all<T extends Row = Row>(
    sql: string,
    ...values: Parameter[]
  ): Promise<T[]> {
    this.checkQueue();
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
    this.checkQueue();
    const result = await (this.connection.getStore() ?? this.db).query(
      parameters(sql),
      values,
    );
    return { changes: result.rowCount ?? 0 };
  }
  /** Database-only callback. Business owners lock the wallet, order or project being changed before reading mutable state. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.connection.getStore()) return fn();
    this.checkQueue();
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
  close(): Promise<void> { return this.closing ??= this.db.end(); }
  private checkQueue(): void {
    if (!this.inTransaction && this.db.waitingCount >= this.queueLimit)
      throw new ServiceError('DATABASE_BUSY', 503, '数据库请求较多，请稍后重试');
  }
}

/** Authentication tables already exist. Business versions are monotonically increasing and database-local. */
export async function migrate(store: Store, config: Config): Promise<void> {
  await store.transaction(async () => {
    // Startup migrations may wait for another instance; interactive lock limits apply after startup.
    await store.run("SET LOCAL lock_timeout = '15s'");
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
    if (version > 20)
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
    if (version < 8) {
      await store.run(await readFile(new URL("./migration-pg-008.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(8)");
    }
    if (version < 9) {
      await store.run(await readFile(new URL("./migration-pg-009.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(9)");
    }
    if (version < 10) {
      await store.run(await readFile(new URL("./migration-pg-010.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(10)");
    }
    if (version < 11) {
      await store.run(await readFile(new URL("./migration-pg-011.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(11)");
    }
    if (version < 12) {
      await store.run(await readFile(new URL("./migration-pg-012.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(12)");
    }
    if (version < 13) {
      await store.run(await readFile(new URL("./migration-pg-013.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(13)");
    }
    if (version < 14) {
      await store.run(await readFile(new URL("./migration-pg-014.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(14)");
    }
    // The local board preview used version 15 before that number shipped on main.
    const boardPreview = version === 15 && (await store.one(
      "SELECT to_regclass('project_board_tasks') IS NOT NULL AND to_regclass('organization_member_notices') IS NULL AS legacy",
    ))?.legacy === true;
    if (version < 15 || boardPreview) {
      await store.run(await readFile(new URL("./migration-pg-015.sql", import.meta.url), "utf8"));
      if (version < 15) await store.run("INSERT INTO service_schema(version) VALUES(15)");
    }
    if (version < 16) {
      await store.run(await readFile(new URL("./migration-pg-016.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(16)");
    }
    if (version < 17) {
      await store.run(await readFile(new URL("./migration-pg-017.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(17)");
    }
    if (version < 18) {
      await store.run(await readFile(new URL("./migration-pg-018.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(18)");
    }
    if (version < 19) {
      await store.run(await readFile(new URL("./migration-pg-019.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(19)");
    }
    if (version < 20) {
      await store.run(await readFile(new URL("./migration-pg-020.sql", import.meta.url), "utf8"));
      await store.run("INSERT INTO service_schema(version) VALUES(20)");
    }
    await adoptStoredResources(store, config);
  });
}
