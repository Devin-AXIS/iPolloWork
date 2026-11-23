import { z } from 'zod'
import { fieldsFor, saveRecord } from './store'
import { fieldTypes } from '../core/fields'
import { DataError } from './errors'
import { transaction, identifier } from './db'
import { requestHash, requestReceipt } from './blueprint'

export const importInput = z
  .object({
    requestId: z.uuid(),
    keyFieldId: z.uuid(),
    rows: z.array(z.record(z.uuid(), z.unknown())).min(1).max(200),
  })
  .strict()
export async function importRecords(tableId: string, raw: unknown) {
  const input = importInput.parse(raw),
    hash = requestHash({ tableId, ...input })
  return transaction(async (db) => {
    const previous = await requestReceipt(db, input.requestId, hash, 'import.apply')
    if (previous) return { ...previous, replayed: true }
    const table = (
      await db.query('SELECT project_id FROM iw_data.tables WHERE id=$1 FOR UPDATE', [tableId])
    ).rows[0]
    if (!table) throw new DataError('数据表不存在', 404)
    const fields = await fieldsFor(db, tableId),
      key = fields.find((f) => f.id === input.keyFieldId)
    if (
      !key ||
      key.source ||
      key.type === 'relation' ||
      fieldTypes.get(key.type).storage !== 'text'
    )
      throw new DataError('匹配键需要使用文本类字段，例如外部编号')
    const seen = new Set<string>(),
      ids: string[] = []
    await db.query(
      `CREATE INDEX IF NOT EXISTS ${identifier(key.id, 'idx')} ON iw_data.${identifier(tableId)} (${identifier(key.id, 'f')})`,
    )
    let created = 0,
      updated = 0
    for (const row of input.rows) {
      let value: unknown
      try {
        value = fieldTypes.get(key.type).validate(row[key.id], key)
      } catch {
        throw new DataError('每一行都需要有效的匹配键')
      }
      if (typeof value !== 'string' || !value.trim() || seen.has(value))
        throw new DataError('同批数据的匹配键不能为空或重复')
      seen.add(value)
      const matches = (
        await db.query(
          `SELECT r.id,r.version FROM iw_data.${identifier(tableId)} d JOIN iw_data.record_index r ON r.id=d._record_id WHERE d.${identifier(key.id, 'f')}=$1 LIMIT 2`,
          [value],
        )
      ).rows
      if (matches.length > 1)
        throw new DataError(`匹配键「${value}」对应多条记录，请先处理重复数据`, 409)
      const current = matches[0]
      ids.push(
        await saveRecord(
          tableId,
          { values: row, version: current?.version },
          current?.id,
          db,
          'import',
        ),
      )
      if (current) updated++
      else created++
    }
    const result = { created, updated, ids, replayed: false }
    await db.query(
      "INSERT INTO iw_data.changes(project_id,operation,details) VALUES($1,'import.apply',$2)",
      [table.project_id, JSON.stringify({ requestId: input.requestId, hash, result })],
    )
    return result
  })
}
