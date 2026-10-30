import type { Connection } from '../db'

// SQLite owns its schema version in the plugin's database, never in the host DB.
// PostgreSQL migrations remain unchanged for explicitly connected remote projects.
export async function migrateSqlite(db: Connection) {
  if (!db.exec) throw new Error('SQLite migration requires a SQLite connection')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY)')
  const current = (await db.query('SELECT max(version) AS version FROM schema_version')).rows[0]?.version
  if (current > 1) throw new Error('数据库由更新版本创建，请更新 Onto 插件后重试')
  db.exec(`
    CREATE TABLE IF NOT EXISTS database_identity (
      singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton), id TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'green',
      group_label TEXT, icon TEXT NOT NULL DEFAULT 'folder',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
      icon TEXT NOT NULL DEFAULT 'table', position INTEGER NOT NULL DEFAULT 0,
      detail_layout JSONB NOT NULL DEFAULT '{"fieldOrder":[]}',
      query_views JSONB NOT NULL DEFAULT '[]' CHECK(json_type(query_views)='array' AND json_array_length(query_views)<=20),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(project_id,name)
    );
    CREATE TABLE IF NOT EXISTS relation_defs (
      id TEXT PRIMARY KEY, source_table TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
      target_table TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
      source_many BOOLEAN NOT NULL, target_many BOOLEAN NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fields (
      id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL, type TEXT NOT NULL, required BOOLEAN NOT NULL DEFAULT false,
      options JSONB NOT NULL DEFAULT '[]', position INTEGER NOT NULL,
      source JSONB, is_primary BOOLEAN NOT NULL DEFAULT false,
      relation_id TEXT REFERENCES relation_defs(id) ON DELETE CASCADE,
      side TEXT CHECK(side IN ('source','target')), UNIQUE(table_id,name),
      CHECK(NOT is_primary OR (type='text' AND source IS NULL)),
      CHECK(source IS NULL OR (json_type(source)='object' AND json_type(source,'$.provider') IS NOT NULL AND json_type(source,'$.inputFieldId') IS NOT NULL AND type<>'relation' AND NOT required))
    );
    CREATE TABLE IF NOT EXISTS record_index (
      id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1, api_state JSONB NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS links (
      relation_id TEXT NOT NULL REFERENCES relation_defs(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES record_index(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES record_index(id) ON DELETE CASCADE,
      PRIMARY KEY(relation_id,source_id,target_id)
    );
    CREATE TABLE IF NOT EXISTS changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      record_id TEXT, operation TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS extension_state (
      id TEXT PRIMARY KEY, installed_version TEXT, enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      CHECK(NOT enabled OR installed_version IS NOT NULL)
    );
    CREATE TABLE IF NOT EXISTS automation_rules (
      id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE, name TEXT NOT NULL,
      value JSONB NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true, cursor INTEGER NOT NULL DEFAULT 0,
      last_status TEXT, last_error TEXT, last_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS project_databases (
      project_id TEXT PRIMARY KEY, database_id TEXT NOT NULL UNIQUE,
      connection_secret TEXT NOT NULL, summary JSONB NOT NULL, project_snapshot JSONB NOT NULL,
      ready BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
      content JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}',
      schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), creation_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      CHECK(json_type(content)='object' AND content->>'type'='doc' AND json_type(content,'$.content')='array')
    );
    CREATE TABLE IF NOT EXISTS document_records (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL REFERENCES record_index(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY(document_id,record_id)
    );
    CREATE INDEX IF NOT EXISTS record_table_idx ON record_index(table_id,created_at,id);
    CREATE INDEX IF NOT EXISTS link_reverse_idx ON links(relation_id,target_id,source_id);
    CREATE INDEX IF NOT EXISTS changes_record_idx ON changes(record_id,id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS changes_request_idx ON changes((details->>'requestId')) WHERE operation IN ('blueprint.apply','import.apply');
    CREATE INDEX IF NOT EXISTS changes_table_event_idx ON changes((details->>'tableId'),id) WHERE operation='record.create';
    CREATE INDEX IF NOT EXISTS automation_table_idx ON automation_rules(table_id);
    CREATE UNIQUE INDEX IF NOT EXISTS primary_field_per_table ON fields(table_id) WHERE is_primary;
    CREATE INDEX IF NOT EXISTS table_presentation_order ON tables(project_id,position,id);
    CREATE INDEX IF NOT EXISTS documents_project_idx ON documents(project_id,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS document_records_record_idx ON document_records(record_id,created_at,document_id);
    INSERT INTO schema_version(version) VALUES(1) ON CONFLICT DO NOTHING;
  `)
}
