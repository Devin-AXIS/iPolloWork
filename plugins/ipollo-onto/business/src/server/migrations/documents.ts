import type { Connection } from '../db'

// Documents belong to a project. Bindings share one body across records; unlinking is not deletion.
// Bodies are never joined into table queries. An independent version protects frequent writes.
export async function migrateDocuments(db: Connection) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS iw_data.documents (
      id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES iw_data.projects ON DELETE CASCADE,
      title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
      content jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}',
      schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK(jsonb_typeof(content)='object' AND content->>'type'='doc' AND jsonb_typeof(content->'content')='array')
    );
    ALTER TABLE iw_data.documents ADD COLUMN IF NOT EXISTS creation_hash text;
    CREATE INDEX IF NOT EXISTS documents_project_idx ON iw_data.documents(project_id,created_at DESC,id);
    CREATE TABLE IF NOT EXISTS iw_data.document_records (
      document_id uuid NOT NULL REFERENCES iw_data.documents ON DELETE CASCADE,
      record_id uuid NOT NULL REFERENCES iw_data.record_index ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(document_id,record_id)
    );
    CREATE INDEX IF NOT EXISTS document_records_record_idx ON iw_data.document_records(record_id,created_at,document_id);
  `)
}
