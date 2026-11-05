import pg from 'pg'
import { SqlitePool } from './sqlite'
import { migrateSqlite } from './migrations/sqlite'
import { resolve } from 'node:path'
import { migrateDocuments } from './migrations/documents'
import { migratePresentation } from './migrations/presentation'
import { migrateQueryViews } from './migrations/query-views'
import { migrateRecordSearch } from './migrations/record-search'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { extensionCatalog } from '../core/extensions'

export interface Connection {
  query<R extends pg.QueryResultRow = pg.QueryResult['rows'][number]>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>
  release(): void
  dialect?: 'sqlite'
  exec?(sql: string): void
}
export interface Pool {
  query: Connection['query']
  connect(): Promise<Connection>
  end(): Promise<void>
  dialect?: 'sqlite'
}
export const defaultPool: Pool = process.env.DATABASE_URL && !process.env.ONTO_SQLITE_PATH
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 })
  : new SqlitePool(process.env.ONTO_SQLITE_PATH ?? resolve('.data/onto.sqlite'))
const scope = new AsyncLocalStorage<Pool>()
export function isSqlite(db: Connection | Pool = pool) { return db.dialect === 'sqlite' }
export function inDatabase<T>(database: Pool, work: () => T): T {
  return scope.run(database, work)
}
// Every request keeps its own pool, including nested transactions and asynchronous actions.
export const pool = new Proxy(defaultPool, {
  get(_target, key) {
    const current = scope.getStore() ?? defaultPool
    const value = Reflect.get(current, key)
    return typeof value === 'function' ? value.bind(current) : value
  },
})

// Concurrent document/view saves share this lock. Destructive field changes take it
// exclusively before table/record locks, so new references cannot slip past checks.
export async function lockFieldReferences(db: Connection, exclusive = false) {
  await db.query(
    exclusive
      ? 'SELECT pg_advisory_xact_lock(5710,7)'
      : 'SELECT pg_advisory_xact_lock_shared(5710,7)',
  )
}

export async function transaction<T>(
  work: (connection: Connection) => Promise<T>,
  existing?: Connection,
): Promise<T> {
  if (existing) return work(existing)
  const connection = await pool.connect()
  try {
    await connection.query('BEGIN')
    const result = await work(connection)
    await connection.query('COMMIT')
    return result
  } catch (error) {
    await connection.query('ROLLBACK')
    throw error
  } finally {
    connection.release()
  }
}

export function identifier(id: string, prefix: 't' | 'f' | 'idx' = 't') {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的数据标识')
  return `"${prefix}_${id.replaceAll('-', '')}"`
}

export async function migrate() {
  await (await import('./plugin-packages')).loadPluginPackages()
  await transaction(async (db) => {
    if (isSqlite(db)) {
      await migrateSqlite(db)
      await db.query('INSERT INTO iw_data.database_identity(singleton,id) VALUES(true,$1) ON CONFLICT DO NOTHING', [randomUUID()])
      for (const e of extensionCatalog) await db.query(
        'INSERT INTO iw_data.extension_state(id,installed_version,enabled) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [e.id, e.defaultInstalled ? e.version : null, e.defaultInstalled])
      return
    }
    // Multiple app/test processes may start together; serialize schema DDL per database.
    await db.query('SELECT pg_advisory_xact_lock(5710,3)')
    await db.query(`
      CREATE SCHEMA IF NOT EXISTS iw_data;
      CREATE TABLE IF NOT EXISTS iw_data.database_identity (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), id uuid NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS iw_data.projects (
        id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
        description text NOT NULL DEFAULT '', color text NOT NULL DEFAULT 'green',
        group_label text, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS iw_data.tables (
        id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES iw_data.projects ON DELETE CASCADE,
        name text NOT NULL, description text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id, name)
      );
      CREATE TABLE IF NOT EXISTS iw_data.relation_defs (
        id uuid PRIMARY KEY,
        source_table uuid NOT NULL REFERENCES iw_data.tables ON DELETE CASCADE,
        target_table uuid NOT NULL REFERENCES iw_data.tables ON DELETE CASCADE,
        source_many boolean NOT NULL, target_many boolean NOT NULL
      );
      CREATE TABLE IF NOT EXISTS iw_data.fields (
        id uuid PRIMARY KEY, table_id uuid NOT NULL REFERENCES iw_data.tables ON DELETE CASCADE,
        name text NOT NULL, type text NOT NULL, required boolean NOT NULL DEFAULT false,
        options jsonb NOT NULL DEFAULT '[]', position integer NOT NULL,
        relation_id uuid REFERENCES iw_data.relation_defs ON DELETE CASCADE,
        side text CHECK(side IN ('source', 'target')), UNIQUE(table_id, name)
      );
      CREATE TABLE IF NOT EXISTS iw_data.record_index (
        id uuid PRIMARY KEY, table_id uuid NOT NULL REFERENCES iw_data.tables ON DELETE CASCADE,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS record_table_idx ON iw_data.record_index(table_id, created_at, id);
      CREATE TABLE IF NOT EXISTS iw_data.links (
        relation_id uuid NOT NULL REFERENCES iw_data.relation_defs ON DELETE CASCADE,
        source_id uuid NOT NULL REFERENCES iw_data.record_index ON DELETE CASCADE,
        target_id uuid NOT NULL REFERENCES iw_data.record_index ON DELETE CASCADE,
        PRIMARY KEY(relation_id, source_id, target_id)
      );
      CREATE INDEX IF NOT EXISTS link_reverse_idx ON iw_data.links(relation_id, target_id, source_id);
      CREATE TABLE IF NOT EXISTS iw_data.changes (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        project_id uuid NOT NULL REFERENCES iw_data.projects ON DELETE CASCADE,
        record_id uuid, operation text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS changes_record_idx ON iw_data.changes(record_id, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS changes_request_idx ON iw_data.changes ((details->>'requestId'))
        WHERE operation IN ('blueprint.apply','import.apply');
      CREATE INDEX IF NOT EXISTS changes_table_event_idx ON iw_data.changes ((details->>'tableId'), id)
        WHERE operation='record.create';
      CREATE TABLE IF NOT EXISTS iw_data.extension_state (
        id text PRIMARY KEY, installed_version text, enabled boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now(), CHECK (NOT enabled OR installed_version IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS iw_data.automation_rules (
        id uuid PRIMARY KEY, table_id uuid NOT NULL REFERENCES iw_data.tables ON DELETE CASCADE,
        field_id uuid NOT NULL REFERENCES iw_data.fields ON DELETE CASCADE,
        name text NOT NULL, value jsonb NOT NULL, enabled boolean NOT NULL DEFAULT true,
        cursor bigint NOT NULL DEFAULT 0, last_status text, last_error text,
        last_run_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE iw_data.fields ADD COLUMN IF NOT EXISTS source jsonb;
      ALTER TABLE iw_data.record_index ADD COLUMN IF NOT EXISTS api_state jsonb NOT NULL DEFAULT '{}';
      DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='iw_data.fields'::regclass AND conname='field_source_shape') THEN
          ALTER TABLE iw_data.fields ADD CONSTRAINT field_source_shape CHECK(source IS NULL OR (jsonb_typeof(source)='object' AND source ? 'provider' AND source ? 'inputFieldId' AND type<>'relation' AND NOT required));
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS automation_table_idx ON iw_data.automation_rules(table_id);
    `)
    await migratePresentation(db)
    await migrateRecordSearch(db)
    await migrateQueryViews(db)
    await migrateDocuments(db)
    await db.query(
      'INSERT INTO iw_data.database_identity(singleton,id) VALUES(true,$1) ON CONFLICT DO NOTHING',
      [randomUUID()],
    )
    for (const e of extensionCatalog)
      await db.query(
        'INSERT INTO iw_data.extension_state(id,installed_version,enabled) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [e.id, e.defaultInstalled ? e.version : null, e.defaultInstalled],
      )
  })
  if ((scope.getStore() ?? defaultPool) === defaultPool) await migrateDirectory()
}

// This routing directory belongs to the default database. Project data stays in its own database.
export async function migrateDirectory() {
  if (isSqlite(defaultPool)) return
  await defaultPool.query(`CREATE TABLE IF NOT EXISTS iw_data.project_databases (
    project_id uuid PRIMARY KEY, database_id uuid NOT NULL UNIQUE,
    connection_secret text NOT NULL, summary jsonb NOT NULL, project_snapshot jsonb NOT NULL,
    ready boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
  )`)
}
