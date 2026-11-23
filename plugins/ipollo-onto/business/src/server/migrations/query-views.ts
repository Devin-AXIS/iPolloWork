import type { Connection } from '../db'

// Small view definitions share their table's ownership, version and deletion lifecycle.
export async function migrateQueryViews(db: Connection) {
  await db.query(`ALTER TABLE iw_data.tables ADD COLUMN IF NOT EXISTS query_views jsonb NOT NULL DEFAULT '[]'
    CHECK(jsonb_typeof(query_views)='array' AND jsonb_array_length(query_views)<=20)`)
}
