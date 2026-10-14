import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { QueryResult, QueryResultRow } from 'pg'

// This adapter accepts only Onto's server-owned SQL. Values remain bound, never
// interpolated. Complex dialect differences live beside their owning queries.
const jsonColumns = new Set(['options', 'source', 'api_state', 'dynamic', 'details',
  'content', 'query_views', 'detail_layout', 'detailLayout', 'values', 'preview',
  'summary', 'project_snapshot', 'sourceField', 'targetField'])
const booleanColumns = new Set(['required', 'is_primary', 'isPrimary', 'multiple',
  'source_many', 'target_many', 'enabled', 'ready', 'api', 'singleton'])
const atom = '(?:[\\w.]+|"[^"]+")(?:\\."[^"]+")?'

export function decimalInteger(value: string): bigint {
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
  return (value.startsWith('-') ? -1n : 1n) * BigInt(whole + fraction.padEnd(4, '0'))
}
export function decimalExpression(column: string) {
  return `(CAST(${column} AS INTEGER)*10000 + CASE WHEN ${column} LIKE '-%' THEN -1 ELSE 1 END * CAST(substr(CASE WHEN instr(${column},'.')>0 THEN substr(${column},instr(${column},'.')+1) ELSE '' END || '0000',1,4) AS INTEGER))`
}

export function sqliteSql(text: string) {
  return text
    .replace(/\biw_data\./g, '')
    .replace(/\bFOR (?:UPDATE|SHARE)(?: SKIP LOCKED)?\b/g, '')
    .replace(/::(?:uuid|text|int|integer|numeric|jsonb|timestamptz|time|date|boolean)(?:\[\])?/g, '')
    .replace(/=\s*ANY\((\$\d+)\)/g, ' IN (SELECT value FROM json_each($1))')
    .replace(/<>\s*ALL\((\$\d+)\)/g, ' NOT IN (SELECT value FROM json_each($1))')
    .replace(/\bILIKE\b/g, 'LIKE')
    .replace(/\bCOLLATE "C"/g, 'COLLATE BINARY')
    .replace(/\bnow\(\)-interval '30 seconds'/g, "strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 seconds')")
    .replace(/\bnow\(\)/g, "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
    .replace(/ceil\(count\(\*\) \/ 50\)/g, '((count(*)+49)/50)')
    .replace(/\bversion\(\)/g, "('SQLite ' || sqlite_version())")
    .replace(/\bcurrent_database\(\)/g, "'onto.sqlite'")
    .replace(/\bto_char\(([^,]+),'YYYY-MM-DD'\)/g, '$1')
    .replace(/\bleft\(([^,]+),\s*(\d+)\)/g, 'substr($1,1,$2)')
    .replace(/\bjsonb_build_object\(/g, 'json_object(')
    .replace(/\bto_jsonb\(([^()]+)\)/g, '$1')
    .replace(/\bnumeric\b/g, 'DECIMAL_TEXT')
    .replace(new RegExp(`(${atom})\\s*\\?([&|])\\s*(\\$\\d+)`, 'g'), (_all, col, op, param) =>
      op === '&'
        ? `NOT EXISTS(SELECT 1 FROM json_each(${param}) wanted WHERE wanted.value NOT IN (SELECT value FROM json_each(${col})))`
        : `EXISTS(SELECT 1 FROM json_each(${col}) item WHERE item.value IN (SELECT value FROM json_each(${param})))`)
    .replace(/\bapi_state\s*-\s*(\$\d+)/g, 'json_remove(api_state,\'$.\' || $1)')
    .replace(/UPDATE\s+(\w+)\s+([a-z])\s+SET/g, 'UPDATE $1 AS $2 SET')
    .replace(/\bAS values\b/g, 'AS "values"')
    .replace(/REFERENCES (\w+)(?![\w(])/g, 'REFERENCES $1(id)')
    .replace(/\b((?:\w+\.)?api_state)\s*\?\s*(\$\d+)/g, "json_type($1,'$.' || $2) IS NOT NULL")
}

type Column = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }

export class SqlitePool {
  readonly dialect: 'sqlite' = 'sqlite'
  private readonly db: DatabaseSync
  private queue: Promise<void> = Promise.resolve()
  private closed = false

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
  }
  private async acquire() {
    const previous = this.queue
    let release = () => {}
    this.queue = new Promise<void>((resolve) => { release = resolve })
    await previous
    if (this.closed) { release(); throw new Error('Onto database is closed') }
    return release
  }
  private rebuildColumn(table: string, column: string, change: string) {
    if (!/^t_[a-f0-9]{32}$/.test(table) || !/^f_[a-f0-9]{32}$/.test(column))
      throw new Error('Unsupported SQLite schema change')
    const columns = this.db.prepare(`PRAGMA table_info("${table}")`).all() as Column[]
    const target = columns.find(c => c.name === column)
    if (!target) throw new Error('Column not found')
    if (change === 'SET NOT NULL') target.notnull = 1
    else if (change === 'DROP NOT NULL') target.notnull = 0
    else target.type = change.replace(/^TYPE /, '').replace(/ USING NULL$/, '')
    const indexes = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table)
    const definitions = columns.map(c => `"${c.name}" ${c.type}${c.pk ? ' PRIMARY KEY REFERENCES record_index(id) ON DELETE CASCADE' : ''}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value == null ? '' : ` DEFAULT ${c.dflt_value}`}`)
    this.db.exec(`CREATE TABLE "${table}_rebuild" (${definitions.join(',')}); INSERT INTO "${table}_rebuild" SELECT * FROM "${table}"; DROP TABLE "${table}"; ALTER TABLE "${table}_rebuild" RENAME TO "${table}";`)
    for (const index of indexes) this.db.exec(String(index.sql))
  }
  private execute<R extends QueryResultRow = QueryResult['rows'][number]>(text: string, values: unknown[] = []): QueryResult<R> {
    if (/^\s*(SET (?:TRANSACTION|LOCAL)|SELECT pg_advisory_xact_lock)/.test(text))
      return { rows: [], rowCount: 0, command: 'SET', oid: 0, fields: [] }
    const sql = sqliteSql(text)
    const alter = sql.match(/^ALTER TABLE "(t_[a-f0-9]+)" ALTER COLUMN "(f_[a-f0-9]+)" (.+)$/)
    if (alter) {
      this.rebuildColumn(alter[1], alter[2], alter[3])
      return { rows: [], rowCount: 0, command: 'ALTER', oid: 0, fields: [] }
    }
    // Positional expansion preserves repeated/out-of-order PostgreSQL placeholders.
    const bound: SQLInputValue[] = []
    const statement = this.db.prepare(sql.replace(/'(?:''|[^'])*'|\$(\d+)/g, (match, n) => {
      if (!n) return match
      const value = values[Number(n) - 1]
      bound.push(value == null ? null : typeof value === 'boolean' ? Number(value)
        : typeof value === 'object' ? JSON.stringify(value) : value as SQLInputValue)
      return '?'
    }))
    try {
      statement.setReadBigInts(true)
      const columns = statement.columns()
      const rows = columns.length ? statement.all(...bound).map(raw => {
        const row: Record<string, unknown> = { ...raw }
        for (const col of columns) {
          const value = row[col.name]
          if (value == null) continue
          if (typeof value === 'bigint') row[col.name] = Number(value)
          if (booleanColumns.has(col.name) || col.type?.toUpperCase() === 'BOOLEAN') row[col.name] = Boolean(value)
          if ((jsonColumns.has(col.name) || (col.name === 'value' && /\bFROM automation_rules\b/.test(sql)) || col.type?.toUpperCase() === 'JSONB') && typeof value === 'string') {
            try {
              const parsed = JSON.parse(value)
              if (['sourceField', 'targetField'].includes(col.name) && parsed) parsed.multiple = Boolean(parsed.multiple)
              row[col.name] = parsed
            } catch { /* Scalar text stays text. */ }
          }
        }
        // The pg driver has a generic result contract; SQLite columns are checked
        // here and the owning domain parses its public contract before use.
        return row as R
      }) : []
      const rowCount = columns.length ? rows.length : Number(statement.run(...bound).changes)
      return { rows, rowCount, command: sql.trim().split(/\s/)[0], oid: 0, fields: [] }
    } catch (error) {
      if (error instanceof Error && /constraint failed/i.test(error.message))
        Object.assign(error, { code: /UNIQUE/.test(error.message) ? '23505' : /NOT NULL/.test(error.message) ? '23502' : /FOREIGN KEY/.test(error.message) ? '23503' : '23514' })
      throw error
    }
  }
  async query<R extends QueryResultRow = QueryResult['rows'][number]>(text: string, values?: unknown[]) {
    const release = await this.acquire()
    try { return this.execute<R>(text, values) } finally { release() }
  }
  async connect() {
    let unlock: (() => void) | undefined
    const release = () => { unlock?.(); unlock = undefined }
    return {
      dialect: this.dialect,
      query: async <R extends QueryResultRow = QueryResult['rows'][number]>(text: string, values?: unknown[]) => {
        if (text.trim() === 'BEGIN') {
          unlock = await this.acquire()
          try { return this.execute<R>('BEGIN IMMEDIATE') } catch (error) { release(); throw error }
        }
        if (!unlock) return this.query<R>(text, values)
        try { return this.execute<R>(text, values) }
        finally { if (/^(COMMIT|ROLLBACK)$/.test(text.trim())) release() }
      },
      exec: (sql: string) => { if (!unlock) throw new Error('Migration requires a transaction'); this.db.exec(sql) },
      release,
    }
  }
  async end() {
    const release = await this.acquire()
    try { this.closed = true; this.db.close() } finally { release() }
  }
}
