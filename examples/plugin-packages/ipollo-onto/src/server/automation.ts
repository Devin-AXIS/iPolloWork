import { forEachDatabase } from './databases'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { fieldTypes } from '../core/fields'
import { pool, transaction, identifier, type Connection } from './db'
import { fieldsFor, saveRecord } from './store'
import { lockExtensions, requireExtension } from './extensions'
import { DataError } from './errors'

export const automationInput = z
  .object({ name: z.string().trim().min(1).max(80), fieldId: z.uuid(), value: z.unknown() })
  .strict()
export async function rulesFor(tableId: string) {
  return (
    await pool.query(
      `SELECT id,name,field_id AS "fieldId",value,enabled,last_status AS "lastStatus",last_error AS "lastError",last_run_at AS "lastRunAt" FROM iw_data.automation_rules WHERE table_id=$1 ORDER BY created_at,id LIMIT 50`,
      [tableId],
    )
  ).rows
}
export async function createRule(tableId: string, raw: unknown) {
  const input = automationInput.parse(raw)
  return transaction(async (db) => {
    await lockExtensions(db)
    await requireExtension(db, 'automation')
    await db.query('SELECT id FROM iw_data.tables WHERE id=$1 FOR UPDATE', [tableId])
    if (
      (
        await db.query(
          'SELECT count(*)::int AS n FROM iw_data.automation_rules WHERE table_id=$1',
          [tableId],
        )
      ).rows[0].n >= 50
    )
      throw new DataError('每张表最多 50 条规则')
    const field = (await fieldsFor(db, tableId)).find((f) => f.id === input.fieldId)
    if (!field || field.source || field.type === 'relation')
      throw new DataError('请选择当前表中的普通字段')
    if (input.value == null || input.value === '') throw new DataError('请填写自动化设置的值')
    let value: unknown
    try {
      value = fieldTypes.get(field.type).validate(input.value, field)
    } catch (e) {
      throw new DataError(e instanceof Error ? e.message : '字段值无效')
    }
    const id = randomUUID()
    await db.query(
      `INSERT INTO iw_data.automation_rules(id,table_id,field_id,name,value,cursor) VALUES($1,$2,$3,$4,$5,(SELECT coalesce(max(id),0) FROM iw_data.changes))`,
      [id, tableId, field.id, input.name, JSON.stringify(value)],
    )
    return { id }
  })
}
export async function changeRule(tableId: string, id: string, enabled: boolean) {
  return transaction(async (db) => {
    await lockExtensions(db)
    if (enabled) await requireExtension(db, 'automation')
    const result = await db.query(
      'UPDATE iw_data.automation_rules SET enabled=$3,last_error=NULL WHERE id=$1 AND table_id=$2 RETURNING id',
      [id, tableId, enabled],
    )
    if (!result.rowCount) throw new DataError('规则不存在', 404)
    return { ok: true }
  })
}
export async function deleteRule(tableId: string, id: string) {
  const result = await pool.query(
    'DELETE FROM iw_data.automation_rules WHERE id=$1 AND table_id=$2',
    [id, tableId],
  )
  if (!result.rowCount) throw new DataError('规则不存在', 404)
  return { ok: true }
}
async function runOne(db: Connection, id: string) {
  // Lock order matches rule creation and extension management. Held only for local DB work.
  await lockExtensions(db)
  const active = (
    await db.query(
      "SELECT enabled FROM iw_data.extension_state WHERE id='automation' AND installed_version='1.0.0'",
    )
  ).rows[0]?.enabled
  if (!active) return false
  const rule = (
    await db.query(
      "SELECT * FROM iw_data.automation_rules WHERE id=$1 AND enabled AND (last_error IS NULL OR last_run_at < now()-interval '30 seconds') FOR UPDATE SKIP LOCKED",
      [id],
    )
  ).rows[0]
  if (!rule) return false
  // Record writes hold SHARE until commit. Wait for them before advancing a sequence cursor,
  // otherwise a later event could commit first and make us skip the earlier uncommitted event.
  await db.query('SELECT id FROM iw_data.tables WHERE id=$1 FOR UPDATE', [rule.table_id])
  const event = (
    await db.query(
      `SELECT id,record_id,project_id FROM iw_data.changes WHERE operation='record.create' AND details->>'tableId'=$1 AND id>$2 ORDER BY id LIMIT 1`,
      [rule.table_id, rule.cursor],
    )
  ).rows[0]
  if (!event) return false
  let status = 'skipped',
    error: string | null = null
  await db.query('SAVEPOINT action')
  try {
    await db.query('SELECT id FROM iw_data.tables WHERE id=$1 FOR SHARE', [rule.table_id])
    const record = (
      await db.query(
        `SELECT r.version,d.${identifier(rule.field_id, 'f')} AS value FROM iw_data.record_index r JOIN iw_data.${identifier(rule.table_id)} d ON d._record_id=r.id WHERE r.id=$1 AND r.table_id=$2`,
        [event.record_id, rule.table_id],
      )
    ).rows[0]
    if (
      record &&
      (record.value == null ||
        record.value === '' ||
        (Array.isArray(record.value) && !record.value.length))
    ) {
      await saveRecord(
        rule.table_id,
        { version: record.version, values: { [rule.field_id]: rule.value } },
        event.record_id,
        db,
        'automation',
      )
      status = 'completed'
    }
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT action')
    status = 'failed'
    error = e instanceof Error ? e.message.slice(0, 500) : '执行失败'
  }
  await db.query(
    'UPDATE iw_data.automation_rules SET cursor=$2,last_status=$3,last_error=$4,last_run_at=now() WHERE id=$1',
    [id, status === 'failed' ? rule.cursor : event.id, status, error],
  )
  await db.query(
    "INSERT INTO iw_data.changes(project_id,record_id,operation,details) VALUES($1,$2,'automation.run',$3)",
    [
      event.project_id,
      event.record_id,
      JSON.stringify({ ruleId: id, eventId: String(event.id), status, error }),
    ],
  )
  return true
}
export async function runAutomations() {
  const rules = (
    await pool.query(
      `SELECT a.id FROM iw_data.automation_rules a WHERE a.enabled
       AND (a.last_error IS NULL OR a.last_run_at < now()-interval '30 seconds')
       AND EXISTS(SELECT 1 FROM iw_data.changes c WHERE c.operation='record.create' AND c.details->>'tableId'=a.table_id::text AND c.id>a.cursor)
       ORDER BY coalesce(a.last_run_at,a.created_at),a.id LIMIT 100`,
    )
  ).rows
  for (const rule of rules) await transaction((db) => runOne(db, rule.id))
}
export function startAutomations() {
  let pending: Promise<void> | null = null
  const tick = () => {
    if (!pending)
      pending = forEachDatabase(runAutomations)
        .catch((e) => console.error('自动化执行异常', e))
        .finally(() => {
          pending = null
        })
  }
  const timer = setInterval(tick, 1500)
  tick()
  return async () => {
    clearInterval(timer)
    await pending
  }
}
