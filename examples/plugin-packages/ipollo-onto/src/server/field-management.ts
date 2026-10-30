import { isDeepStrictEqual } from 'node:util'
import type { QueryResult } from 'pg'
import { fieldTypes } from '../core/fields'
import {
  fieldDeleteInput,
  fieldUpdateInput,
  type FieldDeletePreview,
} from '../core/field-management'
import type { FieldDef } from '../core/contracts'
import { transaction, identifier, lockFieldReferences, isSqlite, type Connection } from './db'
import {
  fieldsFor,
  tableById,
  columnExpression,
  updateApiField,
  apiFieldUpdateInput,
} from './store'
import { lockExtensions, requireFieldExtension } from './extensions'
import { DataError } from './errors'
import { publishProjectChange } from './live-data'

async function context(db: Connection, tableId: string, fieldId: string, allowed?: Set<string>) {
  const field = (await fieldsFor(db, tableId)).find((f) => f.id === fieldId)
  if (!field) throw new DataError('字段不存在', 404)
  if (
    allowed &&
    (!allowed.has(tableId) || (field.targetTableId && !allowed.has(field.targetTableId)))
  )
    throw new DataError('关联的两端必须都在当前接入范围内', 404)
  const tables = [
    ...new Set([tableId, ...(field.targetTableId ? [field.targetTableId] : [])]),
  ].sort()
  await db.query('SELECT id FROM iw_data.tables WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
    tables,
  ])
  const fields = field.relationId
    ? (
        await db.query('SELECT id,table_id FROM iw_data.fields WHERE relation_id=$1 ORDER BY id', [
          field.relationId,
        ])
      ).rows
    : [{ id: field.id, table_id: tableId }]
  const affected: FieldDeletePreview['fields'] = []
  for (const f of fields) {
    const table = await tableById(db, f.table_id)
    const definition = (await fieldsFor(db, table.id)).find((item) => item.id === f.id)!
    affected.push({ id: f.id, tableId: table.id, name: definition.name, tableName: table.name })
  }
  return { field, tables, affected, table: await tableById(db, tableId) }
}

async function dependencies(
  db: Connection,
  ids: string[],
  allowed?: Set<string>,
): Promise<FieldDeletePreview['blockers']> {
  const found: FieldDeletePreview['blockers'] = []
  const api = await db.query(
    `SELECT name,table_id FROM iw_data.fields
    WHERE source->>'inputFieldId'=ANY($1::text[]) AND NOT(id=ANY($1::uuid[]))
    AND (source->>'provider'<>'json-api' OR source->>'url' LIKE '%{{value}}%') LIMIT 20`,
    [ids],
  )
  for (const row of api.rows)
    found.push({ kind: 'api', name: allowed && !allowed.has(row.table_id) ? 'API' : row.name })
  // Inspect references in the database without loading document bodies.
  const path = '$.** ? (@.fieldId == $id || @.relatedFieldId == $id || @.relationFieldId == $id)'
  const views = await db.query(
    isSqlite(db) ? `SELECT t.id,v.value->>'name' AS name FROM iw_data.tables t,json_each(t.query_views) v WHERE EXISTS (SELECT 1 FROM json_tree(v.value) j WHERE j.key IN ('fieldId','relatedFieldId','relationFieldId') AND j.value IN (SELECT value FROM json_each($1))) LIMIT 20` : `SELECT t.id,v->>'name' AS name FROM iw_data.tables t,
    LATERAL jsonb_array_elements(t.query_views) v WHERE EXISTS (
      SELECT 1 FROM unnest($1::text[]) id WHERE jsonb_path_exists(v,$2::jsonpath,jsonb_build_object('id',id))) LIMIT 20`,
    [ids, path],
  )
  for (const row of views.rows)
    found.push({ kind: 'view', name: allowed && !allowed.has(row.id) ? 'View' : row.name })
  const docs = await db.query(
    isSqlite(db) ? `SELECT title FROM iw_data.documents d WHERE EXISTS (SELECT 1 FROM json_tree(d.content) j WHERE j.key IN ('fieldId','relatedFieldId','relationFieldId') AND j.value IN (SELECT value FROM json_each($1))) LIMIT 20` : `SELECT title FROM iw_data.documents d WHERE EXISTS (
    SELECT 1 FROM unnest($1::text[]) id WHERE jsonb_path_exists(d.content,$2::jsonpath,jsonb_build_object('id',id))) LIMIT 20`,
    [ids, path],
  )
  for (const row of docs.rows)
    found.push({ kind: 'document', name: allowed ? 'Document' : row.title })
  const rules = await db.query(
    'SELECT name,table_id FROM iw_data.automation_rules WHERE field_id=ANY($1::uuid[]) AND enabled LIMIT 20',
    [ids],
  )
  for (const row of rules.rows)
    found.push({
      kind: 'automation',
      name: allowed && !allowed.has(row.table_id) ? 'Automation' : row.name,
    })
  return found
}
function rejectDependencies(blockers: FieldDeletePreview['blockers']) {
  if (blockers.length)
    throw new DataError('此字段仍被 API、视图、文档或自动化引用，请先调整引用后重试', 409)
}
function checkVersion(actual: number, expected: number | undefined) {
  if (actual !== expected) throw new DataError('数据表结构已改变，请重新打开字段设置', 409)
}

export async function previewFieldDelete(
  tableId: string,
  fieldId: string,
  allowed?: Set<string>,
): Promise<FieldDeletePreview> {
  return transaction(async (db) => {
    await lockFieldReferences(db)
    const { field, table, affected } = await context(db, tableId, fieldId, allowed)
    const blockers = field.isPrimary
      ? [{ kind: 'primary' as const, name: field.name }]
      : await dependencies(
          db,
          affected.map((f) => f.id),
          allowed,
        )
    const count = field.relationId
      ? await db.query('SELECT count(*)::int AS n FROM iw_data.links WHERE relation_id=$1', [
          field.relationId,
        ])
      : await db.query(
          `SELECT count(*)::int AS n FROM iw_data.${identifier(tableId)} WHERE ${identifier(fieldId, 'f')} IS NOT NULL`,
        )
    return {
      tableVersion: table.version,
      ...(field.targetTableId
        ? { relatedTableVersion: (await tableById(db, field.targetTableId)).version }
        : {}),
      fields: affected,
      blockers,
      valueCount: count.rows[0].n,
      relation: !!field.relationId,
    }
  })
}

export async function updateField(
  tableId: string,
  fieldId: string,
  raw: unknown,
  allowed?: Set<string>,
) {
  const input = fieldUpdateInput.parse(raw)
  const result = await transaction(async (db) => {
    await lockExtensions(db)
    await lockFieldReferences(db, true)
    const { field, table } = await context(db, tableId, fieldId, allowed)
    checkVersion(table.version, input.tableVersion)
    const next: FieldDef = {
      ...field,
      ...input,
      options: input.options ? [...new Set(input.options)] : field.options,
    }
    const typeChanged = next.type !== field.type
    if (field.isPrimary && typeChanged)
      throw new DataError('记录名称字段需要保留文本类型，可修改名称')
    if (field.source || field.relationId) {
      if (typeChanged || next.required || !isDeepStrictEqual(next.options, field.options))
        throw new DataError('关联和 API 字段保留原类型，可修改名称或取值设置')
      if (field.source)
        return {
          projectId: table.projectId,
          field: await updateApiField(
            tableId,
            fieldId,
            apiFieldUpdateInput.parse({
              tableVersion: input.tableVersion,
              name: next.name,
              source: input.source ?? field.source,
            }),
            db,
          ),
        }
      if (input.source) throw new DataError('关联字段不能设置 API 来源')
    } else {
      if (input.source || next.type === 'relation')
        throw new DataError('请通过添加字段创建 API 或关联字段')
      if (typeChanged) await requireFieldExtension(db, next.type)
      if (!fieldTypes.has(next.type)) throw new DataError('字段类型尚未加载')
      const oldType = fieldTypes.get(field.type),
        definition = fieldTypes.get(next.type)
      try {
        definition.validateOptions?.(next.options)
      } catch (error) {
        throw new DataError(error instanceof Error ? error.message : '字段选项不符合类型要求')
      }
      const optionsChanged = !isDeepStrictEqual(field.options, next.options)
      if (typeChanged || optionsChanged) {
        // Disabled rules may be enabled later, so their configured values must remain valid.
        const rules = await db.query(
          'SELECT value FROM iw_data.automation_rules WHERE field_id=$1',
          [fieldId],
        )
        for (const rule of rules.rows) {
          try {
            definition.validate(rule.value, next)
          } catch {
            throw new DataError('自动化中的值不符合新设置，请先调整自动化', 409)
          }
        }
      }
      if (typeChanged || field.options.some((option) => !next.options.includes(option)))
        rejectDependencies(await dependencies(db, [fieldId], allowed))
      const column = identifier(fieldId, 'f'),
        tableSql = `iw_data.${identifier(tableId)}`
      if (typeChanged && oldType.storage !== definition.storage) {
        const populated = await db.query(
          `SELECT 1 FROM ${tableSql} WHERE ${column} IS NOT NULL LIMIT 1`,
        )
        if (populated.rowCount)
          throw new DataError('已有数据不能直接转换为此类型，请先调整数据或新建字段')
        await db.query(
          `ALTER TABLE ${tableSql} ALTER COLUMN ${column} TYPE ${definition.storage} USING NULL::${definition.storage}`,
        )
      } else if (typeChanged || optionsChanged || (!field.required && next.required)) {
        // Bounded keyset scan; validate existing values without rewriting or rounding them.
        let cursor: string | null = null
        for (;;) {
          const batch: QueryResult<{ id: string; value: unknown }> = await db.query(
            `SELECT d._record_id AS id,${columnExpression(field)} AS value FROM ${tableSql} d
            WHERE ($1::uuid IS NULL OR d._record_id>$1) ORDER BY d._record_id LIMIT 500`,
            [cursor],
          )
          for (const row of batch.rows) {
            if (isSqlite(db) && ['jsonb', 'boolean'].includes(oldType.storage) && typeof row.value === 'string') row.value = JSON.parse(row.value)
            try {
              if (
                row.value == null ||
                row.value === '' ||
                (Array.isArray(row.value) && !row.value.length)
              ) {
                if (next.required) throw new Error('存在空值，不能设置为必填')
              } else if (!isDeepStrictEqual(definition.validate(row.value, next), row.value))
                throw new Error('转换会改变已有值，请先调整数据')
            } catch (error) {
              throw new DataError(
                `已有记录不符合新设置：${error instanceof Error ? error.message : '值不兼容'}`,
                409,
              )
            }
          }
          if (batch.rows.length < 500) break
          cursor = batch.rows.at(-1)!.id
        }
      }
      if (next.required && field.required !== next.required) {
        const empty = await db.query(`SELECT 1 FROM ${tableSql} WHERE ${column} IS NULL LIMIT 1`)
        if (empty.rowCount) throw new DataError('存在空值，不能设置为必填', 409)
      }
      if (field.required !== next.required)
        await db.query(
          `ALTER TABLE ${tableSql} ALTER COLUMN ${column} ${next.required ? 'SET' : 'DROP'} NOT NULL`,
        )
    }
    await db.query('UPDATE iw_data.fields SET name=$2,type=$3,required=$4,options=$5 WHERE id=$1', [
      fieldId,
      next.name,
      next.type,
      next.required,
      JSON.stringify(next.options),
    ])
    await db.query('UPDATE iw_data.tables SET version=version+1 WHERE id=$1', [tableId])
    if (
      typeChanged ||
      next.required !== field.required ||
      !isDeepStrictEqual(next.options, field.options)
    )
      await db.query('UPDATE iw_data.record_index SET version=version+1 WHERE table_id=$1', [
        tableId,
      ])
    await db.query(
      "INSERT INTO iw_data.changes(project_id,operation,details) VALUES($1,'field.update',$2)",
      [table.projectId, JSON.stringify({ tableId, fieldId, before: field, after: next })],
    )
    return {
      projectId: table.projectId,
      field: (await fieldsFor(db, tableId)).find((f) => f.id === fieldId)!,
    }
  })
  publishProjectChange(result.projectId)
  return result.field
}

export async function deleteField(
  tableId: string,
  fieldId: string,
  raw: unknown,
  allowed?: Set<string>,
) {
  const input = fieldDeleteInput.parse(raw)
  const result = await transaction(async (db) => {
    await lockExtensions(db)
    await lockFieldReferences(db, true)
    const { field, table, tables, affected } = await context(db, tableId, fieldId, allowed)
    checkVersion(table.version, input.tableVersion)
    if (field.isPrimary)
      throw new DataError('记录名称字段用于识别与关联，不能删除，可修改名称', 409)
    if (field.targetTableId)
      checkVersion((await tableById(db, field.targetTableId)).version, input.relatedTableVersion)
    const ids = affected.map((f) => f.id)
    rejectDependencies(await dependencies(db, ids, allowed))
    await db.query(
      'SELECT id FROM iw_data.record_index WHERE table_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [tables],
    )
    if (field.relationId) {
      await db.query('DELETE FROM iw_data.relation_defs WHERE id=$1', [field.relationId])
      // Partial uniqueness indexes live on the shared links table, not on the metadata row.
      for (const indexId of [field.relationId, ...ids])
        await db.query(`DROP INDEX IF EXISTS iw_data.${identifier(indexId, 'idx')}`)
    } else {
      await db.query(
        `ALTER TABLE iw_data.${identifier(tableId)} DROP COLUMN ${identifier(fieldId, 'f')}`,
      )
      await db.query('DELETE FROM iw_data.fields WHERE id=$1', [fieldId])
    }
    await db.query(
      isSqlite(db) ? "UPDATE iw_data.record_index SET api_state=coalesce((SELECT json_group_object(key,json(value)) FROM json_each(api_state) WHERE key NOT IN (SELECT value FROM json_each($2))),'{}'),version=version+1,updated_at=now() WHERE table_id=ANY($1::uuid[])" : 'UPDATE iw_data.record_index SET api_state=api_state-$2::text[],version=version+1,updated_at=now() WHERE table_id=ANY($1::uuid[])',
      [tables, ids],
    )
    const projects = new Set<string>()
    for (const id of tables) {
      const target = await tableById(db, id)
      const order = target.detailLayout?.fieldOrder?.filter((f) => !ids.includes(f)) ?? []
      await db.query('UPDATE iw_data.tables SET version=version+1,detail_layout=$2 WHERE id=$1', [
        id,
        JSON.stringify({ ...target.detailLayout, fieldOrder: order }),
      ])
      await db.query(
        "INSERT INTO iw_data.changes(project_id,operation,details) VALUES($1,'field.delete',$2)",
        [
          target.projectId,
          JSON.stringify({ tableId: id, fieldId, fields: affected, relationId: field.relationId }),
        ],
      )
      projects.add(target.projectId)
    }
    return { deletedFieldIds: ids, affectedTableIds: tables, projectIds: [...projects] }
  })
  for (const projectId of result.projectIds) publishProjectChange(projectId)
  return { deletedFieldIds: result.deletedFieldIds, affectedTableIds: result.affectedTableIds }
}
