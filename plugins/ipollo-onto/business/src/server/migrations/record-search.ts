import { identifier, type Connection } from '../db'

// The title remains in its original table. This index serves bounded prefix lookups.
export async function indexRecordTitle(db: Connection, tableId: string, fieldId: string) {
  const column = identifier(fieldId, 'f')
  await db.query(
    `CREATE INDEX IF NOT EXISTS "title_${fieldId.replaceAll('-', '')}" ON iw_data.${identifier(tableId)} ((lower(${column}) COLLATE "C"), _record_id)`,
  )
}

export async function migrateRecordSearch(db: Connection) {
  const fields = (await db.query('SELECT id,table_id FROM iw_data.fields WHERE is_primary')).rows
  for (const field of fields) await indexRecordTitle(db, field.table_id, field.id)
}
