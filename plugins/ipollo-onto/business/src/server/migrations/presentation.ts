import type { Connection } from '../db'

// Metadata owned by the existing project/table/field and deleted with it.
// Backfill once, preserving the old order and the identity of each record's title.
export async function migratePresentation(db: Connection) {
  await db.query(`
    ALTER TABLE iw_data.projects ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT 'folder';
    ALTER TABLE iw_data.tables ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT 'table';
    ALTER TABLE iw_data.tables ADD COLUMN IF NOT EXISTS detail_layout jsonb NOT NULL DEFAULT '{"fieldOrder":[]}';
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='iw_data' AND table_name='tables' AND column_name='position') THEN
        ALTER TABLE iw_data.tables ADD COLUMN position integer NOT NULL DEFAULT 0;
        UPDATE iw_data.tables t SET position=o.position FROM (
          SELECT id, (row_number() OVER (PARTITION BY project_id ORDER BY created_at,id)-1)::int AS position FROM iw_data.tables
        ) o WHERE t.id=o.id;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='iw_data' AND table_name='fields' AND column_name='is_primary') THEN
        ALTER TABLE iw_data.fields ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
        UPDATE iw_data.fields SET is_primary=true WHERE id IN (
          SELECT DISTINCT ON (table_id) id FROM iw_data.fields WHERE type='text' AND source IS NULL ORDER BY table_id,position,id
        );
        ALTER TABLE iw_data.fields ADD CONSTRAINT primary_field_type CHECK (NOT is_primary OR (type='text' AND source IS NULL));
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS primary_field_per_table ON iw_data.fields(table_id) WHERE is_primary;
    CREATE INDEX IF NOT EXISTS table_presentation_order ON iw_data.tables(project_id,position,id);
  `)
}
