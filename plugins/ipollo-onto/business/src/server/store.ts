import { entityIconIds } from '../core/icons'
import { indexRecordTitle } from './migrations/record-search'
import { compileQuery } from './query'
import {
  recordQueryInput,
  queryField,
  saveQueryViewInput,
  type RecordQuery,
  type QueryContext,
  type SavedQueryView,
} from '../core/query'
import { fieldSourceInput } from '../core/sources'
import { sourceUsesInput } from '../core/contracts'
import { isDeepStrictEqual } from 'node:util'
import { validateSource } from './providers'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { fieldTypes } from '../core/fields'
import '../plugins/business-fields'
import { DataError } from './errors'
import { lockExtensions, requireFieldExtension, requireExtension } from './extensions'
export { DataError } from './errors'
import type { DataRecord, FieldDef, LinkValue, Project, TableDef } from '../core/contracts'
import { pool, transaction, identifier, lockFieldReferences, isSqlite, type Connection } from './db'

const name = z.string().trim().min(1, '请输入名称').max(80, '名称最多 80 个字符')
const uuid = z.uuid()
export const projectInput = z.object({
  icon: z.enum(entityIconIds).optional(),
  name,
  description: z.string().max(500).default(''),
  color: z.enum(['neutral', 'green', 'blue', 'orange', 'violet']).default('neutral'),
})
export const tableInput = z.object({
  name,
  description: z.string().max(500).default(''),
  icon: z.enum(entityIconIds).optional(),
})
export const tableUpdateInput = z
  .object({
    name: name.optional(),
    description: z.string().max(500).optional(),
    icon: z.enum(entityIconIds).optional(),
    version: z.number().int().positive().optional(),
  })
  .strict()
export const fieldInput = z.object({
  source: fieldSourceInput.optional(),
  name,
  type: z.string().max(80),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  targetTableId: uuid.optional(),
  reverseName: name.optional(),
  multiple: z.boolean().default(false),
  inverseMultiple: z.boolean().default(true),
})
export const recordInput = z.object({
  version: z.number().int().positive().optional(),
  values: z.record(z.string(), z.unknown()),
})
type RecordInput = z.infer<typeof recordInput>

const tableColumns = `t.id, t.project_id AS "projectId", t.name, t.description, t.icon, t.position, t.detail_layout AS "detailLayout", t.version, t.created_at AS "createdAt",
  (SELECT count(*)::int FROM iw_data.record_index r WHERE r.table_id=t.id) AS "recordCount"`
export async function getProjects(): Promise<Project[]> {
  return (
    await pool.query(`SELECT p.id,p.name,p.description,p.color,p.icon,p.group_label AS "groupLabel",p.created_at AS "createdAt",
    (SELECT count(*)::int FROM iw_data.tables t WHERE t.project_id=p.id) AS "tableCount",
    (SELECT count(*)::int FROM iw_data.record_index r JOIN iw_data.tables t ON t.id=r.table_id WHERE t.project_id=p.id) AS "recordCount"
    FROM iw_data.projects p ORDER BY p.created_at DESC,p.id`)
  ).rows
}
export async function createProject(input: z.infer<typeof projectInput>): Promise<Project> {
  const id = randomUUID()
  await pool.query(
    'INSERT INTO iw_data.projects(id,name,description,color,icon) VALUES($1,$2,$3,$4,$5)',
    [id, input.name, input.description, input.color, input.icon ?? 'folder'],
  )
  const project = (await getProjects()).find((p) => p.id === id)
  if (!project) throw new Error('项目创建失败')
  return project
}
export async function getTables(projectId?: string): Promise<TableDef[]> {
  return (
    await pool.query(
      `SELECT ${tableColumns} FROM iw_data.tables t ${projectId ? 'WHERE t.project_id=$1' : ''} ORDER BY t.project_id,t.position,t.id`,
      projectId ? [projectId] : [],
    )
  ).rows
}
export async function tableById(db: Connection, tableId: string): Promise<TableDef> {
  const result = await db.query(`SELECT ${tableColumns} FROM iw_data.tables t WHERE t.id=$1`, [
    tableId,
  ])
  if (!result.rowCount) throw new DataError('数据表不存在', 404)
  return result.rows[0]
}
export async function fieldsFor(db: Connection, tableId: string): Promise<FieldDef[]> {
  return (
    await db.query(
      `SELECT f.id,f.table_id AS "tableId",f.name,f.type,f.required,f.options,f.position,f.source,f.is_primary AS "isPrimary",
    f.relation_id AS "relationId",f.side,
    CASE WHEN f.side='source' THEN d.target_table ELSE d.source_table END AS "targetTableId",
    CASE WHEN f.side='source' THEN d.source_many ELSE d.target_many END AS multiple
    FROM iw_data.fields f LEFT JOIN iw_data.relation_defs d ON d.id=f.relation_id
    WHERE f.table_id=$1 ORDER BY f.position,f.id`,
      [tableId],
    )
  ).rows
}
export async function createTable(
  projectId: string,
  input: z.infer<typeof tableInput>,
  connection?: Connection,
) {
  return transaction(async (db) => {
    await lockProject(db, projectId)
    const id = randomUUID(),
      fieldId = randomUUID()
    await db.query(
      `INSERT INTO iw_data.tables(id,project_id,name,description,icon,position) VALUES($1,$2,$3,$4,$5,(SELECT coalesce(max(position)+1,0) FROM iw_data.tables WHERE project_id=$2))`,
      [id, projectId, input.name, input.description, input.icon ?? 'table'],
    )
    await db.query(
      `CREATE TABLE iw_data.${identifier(id)} (_record_id uuid PRIMARY KEY REFERENCES iw_data.record_index ON DELETE CASCADE, ${identifier(fieldId, 'f')} text)`,
    )
    await db.query(
      `INSERT INTO iw_data.fields(id,table_id,name,type,position,is_primary) VALUES($1,$2,'名称','text',0,true)`,
      [fieldId, id],
    )
    await indexRecordTitle(db, id, fieldId)
    return tableById(db, id)
  }, connection)
}
export async function renameTable(tableId: string, input: z.infer<typeof tableUpdateInput>) {
  return transaction(async (db) => {
    const result = await db.query(
      'UPDATE iw_data.tables SET name=coalesce($2,name),description=coalesce($3,description),icon=coalesce($4,icon),version=version+1 WHERE id=$1 AND ($5::int IS NULL OR version=$5) RETURNING id',
      [tableId, input.name, input.description, input.icon, input.version],
    )
    if (!result.rowCount) {
      await tableById(db, tableId)
      throw new DataError('数据表已更新，请刷新后重试', 409)
    }
    return tableById(db, tableId)
  })
}
export async function deleteTable(tableId: string) {
  return transaction(async (db) => {
    const table = await tableById(db, tableId)
    await lockProject(db, table.projectId)
    await db.query(`DROP TABLE iw_data.${identifier(tableId)}`)
    await db.query('DELETE FROM iw_data.tables WHERE id=$1', [tableId])
  })
}
export async function deleteProject(id: string) {
  return transaction(async (db) => {
    await lockProject(db, id)
    const tables = await db.query('SELECT id FROM iw_data.tables WHERE project_id=$1 ORDER BY id', [
      id,
    ])
    for (const t of tables.rows) await db.query(`DROP TABLE iw_data.${identifier(t.id)}`)
    await db.query('DELETE FROM iw_data.projects WHERE id=$1', [id])
  })
}
export async function createField(
  tableId: string,
  input: z.infer<typeof fieldInput>,
  connection?: Connection,
) {
  return transaction(async (db) => {
    await lockExtensions(db)
    if (input.type !== 'relation') await requireFieldExtension(db, input.type)
    // Lock the same set in a stable order when two tables are involved.
    const tableIds = [
      ...new Set([
        tableId,
        ...(input.type === 'relation' && input.targetTableId ? [input.targetTableId] : []),
      ]),
    ].sort()
    const locked = await db.query(
      'SELECT id FROM iw_data.tables WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [tableIds],
    )
    if (locked.rowCount !== tableIds.length)
      throw new DataError('关联的数据表不存在或不在同一数据库；跨库同步需通过连接器实现', 404)
    const table = await tableById(db, tableId)
    const fields = await fieldsFor(db, tableId)
    if (input.source) {
      await requireExtension(db, 'api-fields')
      validateSource(input.source, fields, input.required, input.type)
      if (fields.filter((f) => f.source).length >= 10)
        throw new DataError('每张表最多 10 个 API 字段')
    }
    if (fields.length >= 100) throw new DataError('当前版本每张表最多 100 个字段')
    const id = randomUUID(),
      position = fields.reduce((max, f) => Math.max(max, f.position + 1), 0)
    if (input.type === 'relation') {
      if (!input.targetTableId || !input.reverseName)
        throw new DataError('请选择目标表并填写反向字段名称')
      if (input.required) throw new DataError('当前版本的关联字段不设置必填')
      const targetFields = await fieldsFor(db, input.targetTableId)
      if (input.targetTableId === tableId && fields.length > 98)
        throw new DataError('同表关联需要两个字段，剩余字段数量不足')
      if (targetFields.length >= 100) throw new DataError('目标表的字段已达上限')
      const relationId = randomUUID()
      await db.query('INSERT INTO iw_data.relation_defs VALUES($1,$2,$3,$4,$5)', [
        relationId,
        tableId,
        input.targetTableId,
        input.multiple,
        input.inverseMultiple,
      ])
      await db.query(
        `INSERT INTO iw_data.fields(id,table_id,name,type,position,relation_id,side) VALUES($1,$2,$3,'relation',$4,$5,'source')`,
        [id, tableId, input.name, position, relationId],
      )
      await db.query(
        `INSERT INTO iw_data.fields(id,table_id,name,type,position,relation_id,side) VALUES($1,$2,$3,'relation',$4,$5,'target')`,
        [randomUUID(), input.targetTableId, input.reverseName, targetFields.length + 1, relationId],
      )
      if (!input.multiple)
        await db.query(
          `CREATE UNIQUE INDEX ${identifier(relationId, 'idx')} ON iw_data.links(relation_id,source_id) WHERE relation_id='${relationId}'`,
        )
      if (!input.inverseMultiple)
        await db.query(
          `CREATE UNIQUE INDEX ${identifier(id, 'idx')} ON iw_data.links(relation_id,target_id) WHERE relation_id='${relationId}'`,
        )
    } else {
      if (!fieldTypes.has(input.type)) throw new DataError('该字段类型尚未安装')
      if (
        ['select', 'multiselect'].includes(input.type) &&
        (!input.options.length || new Set(input.options).size !== input.options.length)
      )
        throw new DataError('选择字段需要至少一个不重复的选项')
      if (input.required && table.recordCount > 0)
        throw new DataError('已有记录时请先建立可空字段；必填回填将在后续版本提供')
      const definition = fieldTypes.get(input.type)
      try {
        definition.validateOptions?.(input.options)
      } catch (error) {
        throw new DataError(error instanceof Error ? error.message : '字段选项不符合类型要求')
      }
      await db.query(
        `ALTER TABLE iw_data.${identifier(tableId)} ADD COLUMN ${identifier(id, 'f')} ${definition.storage}${input.required ? ' NOT NULL' : ''}`,
      )
      await db.query(
        'INSERT INTO iw_data.fields(id,table_id,name,type,required,options,position) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          tableId,
          input.name,
          input.type,
          input.required,
          JSON.stringify(input.options),
          position,
        ],
      )
    }
    if (input.source)
      await db.query('UPDATE iw_data.fields SET source=$2 WHERE id=$1', [
        id,
        JSON.stringify(input.source),
      ])
    await db.query('UPDATE iw_data.tables SET version=version+1 WHERE id=ANY($1::uuid[])', [
      tableIds,
    ])
    return (await fieldsFor(db, tableId)).find((f) => f.id === id)
  }, connection)
}

export const apiFieldUpdateInput = z
  .object({
    tableVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    source: fieldSourceInput,
  })
  .strict()

export async function updateApiField(
  tableId: string,
  fieldId: string,
  input: z.infer<typeof apiFieldUpdateInput>,
  connection?: Connection,
) {
  return transaction(async (db) => {
    await lockExtensions(db)
    await requireExtension(db, 'api-fields')
    await db.query('SELECT id FROM iw_data.tables WHERE id=$1 FOR UPDATE', [tableId])
    const table = await tableById(db, tableId)
    if (table.version !== input.tableVersion)
      throw new DataError('数据表结构已改变，请重新打开配置', 409)
    const fields = await fieldsFor(db, tableId),
      field = fields.find((f) => f.id === fieldId)
    if (!field?.source) throw new DataError('API 字段不存在', 404)
    validateSource(input.source, fields, false, field.type)
    const binding = ({ ttlSeconds: _ttl, unit: _unit, ...rest }: typeof field.source) => rest
    const changed = !isDeepStrictEqual(binding(field.source), binding(input.source))
    if (changed) {
      await db.query(
        'SELECT id FROM iw_data.record_index WHERE table_id=$1 ORDER BY id FOR UPDATE',
        [tableId],
      )
      await db.query(
        `INSERT INTO iw_data.changes(project_id,record_id,operation,details)
        SELECT $1,r.id,'field.source.changed',jsonb_build_object('tableId',$2::text,'fieldId',$3::text,'previousValue',to_jsonb(${columnExpression(field)}),'previousState',r.api_state->$3)
        FROM iw_data.record_index r JOIN iw_data.${identifier(tableId)} d ON d._record_id=r.id
        WHERE r.table_id=$2::uuid AND (d.${identifier(fieldId, 'f')} IS NOT NULL OR r.api_state ? $3)`,
        [table.projectId, tableId, fieldId],
      )
      await db.query(`UPDATE iw_data.${identifier(tableId)} SET ${identifier(fieldId, 'f')}=NULL`)
      await db.query(
        'UPDATE iw_data.record_index SET api_state=api_state-$2::text,version=version+1,updated_at=now() WHERE table_id=$1',
        [tableId, fieldId],
      )
    }
    await db.query('UPDATE iw_data.fields SET name=$2,source=$3 WHERE id=$1', [
      fieldId,
      input.name,
      JSON.stringify(input.source),
    ])
    await db.query('UPDATE iw_data.tables SET version=version+1 WHERE id=$1', [tableId])
    await db.query(
      "INSERT INTO iw_data.changes(project_id,operation,details) VALUES($1,'field.configure',$2)",
      [table.projectId, JSON.stringify({ tableId, fieldId, sourceChanged: changed })],
    )
    return (await fieldsFor(db, tableId)).find((f) => f.id === fieldId)!
  }, connection)
}

export function columnExpression(field: FieldDef, sqlite = isSqlite()) {
  const col = `d.${identifier(field.id, 'f')}`
  const storage = fieldTypes.get(field.type).storage
  if (sqlite && storage === 'jsonb') return `json(${col})`
  if (sqlite && storage === 'boolean') return `json(CASE WHEN ${col} IS NULL THEN 'null' WHEN ${col} THEN 'true' ELSE 'false' END)`
  return storage === 'date'
    ? `to_char(${col},'YYYY-MM-DD')`
    : storage === 'numeric'
      ? `${col}::text`
      : col
}
async function recordLabels(db: Connection, tableId: string, ids: string[]): Promise<LinkValue[]> {
  if (!ids.length) return []
  const fields = await fieldsFor(db, tableId)
  const title = fields.find((f) => f.isPrimary)
  const expression = title ? `coalesce((${columnExpression(title)})::text,'未命名')` : "'未命名'"
  return (
    await db.query(
      `SELECT r.id,${expression} AS label,r.table_id AS "tableId" FROM iw_data.record_index r
    JOIN iw_data.${identifier(tableId)} d ON d._record_id=r.id WHERE r.table_id=$1 AND r.id=ANY($2::uuid[]) ORDER BY r.created_at,r.id`,
      [tableId, ids],
    )
  ).rows
}
export async function getData(
  tableId: string,
  page = 1,
  query = '',
  recordId?: string,
  selection?: RecordQuery,
  allowedTables?: Set<string>,
  connection?: Connection,
) {
  return transaction(async (db) => {
    if (!connection) await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    const table = await tableById(db, tableId),
      fields = await fieldsFor(db, tableId)
    const stored = fields.filter((f) => f.type !== 'relation')
    // PostgreSQL functions accept at most 100 arguments; keep wide tables in smaller chunks.
    const chunks = Array.from({ length: Math.ceil(stored.length / 40) }, (_, i) =>
      stored.slice(i * 40, i * 40 + 40),
    )
    const object = chunks.length
      ? chunks
          .map(
            (chunk) =>
              `jsonb_build_object(${chunk.map((f) => `'${f.id}',${columnExpression(f, isSqlite(db))}`).join(',')})`,
          )
          .join(' || ')
      : "'{}'::jsonb"
    const jsonObject = isSqlite(db) ? `jsonb_build_object(${stored.map(f => `'${f.id}',${columnExpression(f, true)}`).join(',')})` : object
    const title = stored.find((f) => f.isPrimary)
    const plan = recordQueryInput.parse(selection ?? { search: query })
    let filter =
      plan.search && title ? `AND d.${identifier(title.id, 'f')} ILIKE $2 ESCAPE '\\'` : ''
    const params: unknown[] = [tableId]
    if (filter) params.push(`${plan.search.replace(/[\\%_]/g, '\\$&')}%`)
    if (recordId) {
      params.push(recordId)
      filter += ` AND r.id=$${params.length}::uuid`
    }
    const compiled = await compileQuery(db, fields, plan, params, fieldsFor, allowedTables)
    if (plan.filter || plan.sort.length) await db.query("SET LOCAL statement_timeout='5s'")
    if (compiled.predicate) filter += ` AND ${compiled.predicate}`
    const total = (
      await db.query(
        `SELECT count(*)::int AS n FROM iw_data.record_index r JOIN iw_data.${identifier(tableId)} d ON d._record_id=r.id WHERE r.table_id=$1 ${filter}`,
        params,
      )
    ).rows[0].n
    const records: DataRecord[] = (
      await db.query(
        `SELECT r.id,r.version,r.created_at AS "createdAt",r.updated_at AS "updatedAt",r.api_state AS dynamic,${jsonObject} AS values
      FROM iw_data.record_index r JOIN iw_data.${identifier(tableId)} d ON d._record_id=r.id WHERE r.table_id=$1 ${filter}
      ORDER BY ${compiled.order} LIMIT 50 OFFSET $${params.length + 1}`,
        [...params, (page - 1) * 50],
      )
    ).rows
    const ids = records.map((r) => r.id)
    for (const field of fields.filter((f) => f.type === 'relation' && f.targetTableId)) {
      const own = field.side === 'source' ? 'source_id' : 'target_id',
        other = field.side === 'source' ? 'target_id' : 'source_id'
      const edges: Array<{ own: string; other: string }> = (
        await db.query(
          `SELECT ${own} AS own,${other} AS other FROM iw_data.links WHERE relation_id=$1 AND ${own}=ANY($2::uuid[])`,
          [field.relationId, ids],
        )
      ).rows
      const labels = await recordLabels(db, field.targetTableId!, [
        ...new Set(edges.map((e) => e.other)),
      ])
      const labelsMap = new Map(labels.map((l) => [l.id, l]))
      for (const record of records)
        record.values[field.id] = edges
          .filter((e) => e.own === record.id)
          .flatMap((e) => {
            const label = labelsMap.get(e.other)
            return label ? [label] : []
          })
    }
    return {
      table,
      fields,
      records,
      total,
      page,
      pageSize: 50,
      appliedQuery: plan,
      queryInfo: {
        snapshotFields: compiled.snapshotFields,
        labels: compiled.labels,
        scope: 'table' as const,
        evaluatedAt: new Date().toISOString(),
      },
    }
  }, connection)
}

// Resolve a relationship through its canonical inverse, in the same read snapshot.
// Pagination happens in SQL, never by fetching each linked record individually.
export async function getRelatedData(tableId: string, recordId: string, fieldId: string, page = 1) {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    if (
      !(
        await db.query('SELECT id FROM iw_data.record_index WHERE id=$1 AND table_id=$2', [
          recordId,
          tableId,
        ])
      ).rowCount
    )
      throw new DataError('记录不存在', 404)
    const field = (await fieldsFor(db, tableId)).find(
      (f) => f.id === fieldId && f.type === 'relation',
    )
    if (!field?.targetTableId) throw new DataError('关联字段不存在', 404)
    const inverse = (await fieldsFor(db, field.targetTableId)).find(
      (f) => f.relationId === field.relationId && f.side !== field.side,
    )
    if (!inverse) throw new DataError('关联字段不存在', 404)
    return getData(
      field.targetTableId,
      page,
      '',
      undefined,
      recordQueryInput.parse({
        filter: {
          conjunction: 'and',
          conditions: [{ fieldId: inverse.id, operator: 'hasAny', value: [recordId] }],
        },
      }),
      undefined,
      db,
    )
  })
}

export async function getQueryContext(
  tableId: string,
  allowedTables?: Set<string>,
): Promise<QueryContext> {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    const table = await tableById(db, tableId)
    const fields = (await fieldsFor(db, tableId)).filter(
      (f) => f.type !== 'relation' || !allowedTables || allowedTables.has(f.targetTableId!),
    )
    const loaded = new Map<string, ReturnType<typeof fieldsFor>>()
    const metadata = []
    for (const field of fields) {
      const info = queryField(field)
      if (field.type === 'relation' && field.targetTableId) {
        if (!loaded.has(field.targetTableId))
          loaded.set(field.targetTableId, fieldsFor(db, field.targetTableId))
        info.related = (await loaded.get(field.targetTableId)!)
          .filter((f) => f.type !== 'relation')
          .map(queryField)
      }
      metadata.push(info)
    }
    const views: SavedQueryView[] = (
      await db.query('SELECT query_views FROM iw_data.tables WHERE id=$1', [tableId])
    ).rows[0].query_views
    // Saved definitions must not expose relation field IDs outside a scoped integration.
    const exposedViews: SavedQueryView[] = []
    for (const view of views) {
      try {
        await compileQuery(db, fields, view.query, [], fieldsFor, allowedTables)
        exposedViews.push({ ...view, query: recordQueryInput.parse(view.query) })
      } catch {
        if (!allowedTables) exposedViews.push(view)
      }
    }
    return { tableId, version: table.version, fields: metadata, views: exposedViews }
  })
}

export async function saveQueryView(tableId: string, raw: unknown, allowedTables?: Set<string>) {
  const input = saveQueryViewInput.parse(raw)
  return transaction(async (db) => {
    await lockFieldReferences(db)
    const row = (
      await db.query('SELECT version,query_views FROM iw_data.tables WHERE id=$1 FOR UPDATE', [
        tableId,
      ])
    ).rows[0]
    if (!row) throw new DataError('数据表不存在', 404)
    if (row.version !== input.version) throw new DataError('数据表已更新，请刷新后重试', 409)
    const fields = await fieldsFor(db, tableId)
    await compileQuery(db, fields, input.query, [], fieldsFor, allowedTables)
    const views: SavedQueryView[] = row.query_views
    if (input.id && !views.some((v) => v.id === input.id)) throw new DataError('视图不存在', 404)
    if (views.some((v) => v.name === input.name && v.id !== input.id))
      throw new DataError('视图名称已存在', 409)
    if (!input.id && views.length >= 20) throw new DataError('每张表最多保存 20 个视图')
    if (input.id && allowedTables) {
      const old = views.find((v) => v.id === input.id)!
      await compileQuery(db, fields, old.query, [], fieldsFor, allowedTables)
    }
    const view: SavedQueryView = {
      id: input.id ?? randomUUID(),
      name: input.name,
      layout: input.layout,
      query: input.query,
    }
    const next = input.id ? views.map((v) => (v.id === input.id ? view : v)) : [...views, view]
    await db.query(
      'UPDATE iw_data.tables SET query_views=$2::jsonb,version=version+1 WHERE id=$1',
      [tableId, JSON.stringify(next)],
    )
    return { view, version: row.version + 1 }
  })
}

export async function deleteQueryView(
  tableId: string,
  viewId: string,
  version: number,
  allowedTables?: Set<string>,
) {
  return transaction(async (db) => {
    const row = (
      await db.query('SELECT version,query_views FROM iw_data.tables WHERE id=$1 FOR UPDATE', [
        tableId,
      ])
    ).rows[0]
    if (!row) throw new DataError('数据表不存在', 404)
    if (row.version !== version) throw new DataError('数据表已更新，请刷新后重试', 409)
    const views: SavedQueryView[] = row.query_views
    const found = views.find((v) => v.id === viewId)
    if (!found) throw new DataError('视图不存在', 404)
    if (allowedTables)
      await compileQuery(
        db,
        await fieldsFor(db, tableId),
        found.query,
        [],
        fieldsFor,
        allowedTables,
      )
    await db.query(
      'UPDATE iw_data.tables SET query_views=$2::jsonb,version=version+1 WHERE id=$1',
      [tableId, JSON.stringify(views.filter((v) => v.id !== viewId))],
    )
    return { version: row.version + 1 }
  })
}
export async function getOptions(tableId: string, query = '') {
  const data = await getData(tableId, 1, query)
  const title = data.fields.find((f) => f.isPrimary)
  return data.records.map((r) => ({
    id: r.id,
    tableId,
    label: title ? String(r.values[title.id] || '未命名') : '未命名',
  }))
}

export async function saveRecord(
  tableId: string,
  input: RecordInput,
  recordId?: string,
  connection?: Connection,
  origin: 'manual' | 'automation' | 'import' | 'blueprint' = 'manual',
): Promise<string> {
  return transaction(async (db) => {
    await db.query('SELECT id FROM iw_data.tables WHERE id=$1 FOR SHARE', [tableId])
    const table = await tableById(db, tableId),
      fields = await fieldsFor(db, tableId)
    const supplied = Object.keys(input.values)
    if (supplied.some((id) => !fields.some((f) => f.id === id)))
      throw new DataError('字段结构已变化，请刷新后重试', 409)
    if (supplied.some((id) => fields.find((f) => f.id === id)?.source))
      throw new DataError('API 字段为只读，请修改参数字段或刷新来源', 409)
    const relationFields = fields.filter((f) => f.type === 'relation' && supplied.includes(f.id))
    const changedRelations = [...new Set(relationFields.map((f) => f.relationId!))].sort()
    if (changedRelations.length)
      await db.query(
        'SELECT id FROM iw_data.relation_defs WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [changedRelations],
      )
    const id = recordId ?? randomUUID()
    const related = new Set<string>()
    const linkChanges: Array<{ field: FieldDef; next: string[]; previous: string[] }> = []
    for (const field of relationFields) {
      const next = z.array(uuid).max(200, '单次最多关联 200 条记录').parse(input.values[field.id])
      if (new Set(next).size !== next.length) throw new DataError('关联记录不能重复')
      if (!field.multiple && next.length > 1)
        throw new DataError(`「${field.name}」只允许关联一条记录`)
      const own = field.side === 'source' ? 'source_id' : 'target_id',
        other = field.side === 'source' ? 'target_id' : 'source_id'
      const previous: string[] = (
        await db.query(
          `SELECT ${other} AS id FROM iw_data.links WHERE relation_id=$1 AND ${own}=$2`,
          [field.relationId, id],
        )
      ).rows.map((r) => r.id)
      previous.forEach((r) => related.add(r))
      next.forEach((r) => related.add(r))
      linkChanges.push({ field, next, previous })
    }
    const lockIds = [...new Set([...(recordId ? [id] : []), ...related])].sort()
    const locked = await db.query(
      'SELECT id,table_id,version FROM iw_data.record_index WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [lockIds],
    )
    const ownRecord = locked.rows.find((r) => r.id === id)
    if (recordId && (!ownRecord || ownRecord.table_id !== tableId))
      throw new DataError('记录不存在', 404)
    if (recordId && ownRecord.version !== input.version)
      throw new DataError('这条记录刚刚有了新修改。请刷新后再保存。', 409)
    for (const { field, next } of linkChanges) {
      if (
        next.some(
          (target) =>
            !locked.rows.some((r) => r.id === target && r.table_id === field.targetTableId),
        )
      )
        throw new DataError('关联记录不存在或属于其他数据表')
    }
    const values: Array<{ field: FieldDef; value: unknown }> = []
    for (const field of fields.filter((f) => f.type !== 'relation' && !f.source)) {
      if (recordId && !supplied.includes(field.id)) continue
      let value = input.values[field.id]
      if (value === '' || value === undefined || value === null) {
        if (field.required) throw new DataError(`请填写「${field.name}」`)
        value = null
      } else {
        try {
          value = fieldTypes.get(field.type).validate(value, field)
        } catch (error) {
          throw new DataError(error instanceof Error ? error.message : '字段内容无效')
        }
        if (field.required && Array.isArray(value) && !value.length)
          throw new DataError(`请填写「${field.name}」`)
        if (fieldTypes.get(field.type).storage === 'jsonb') value = JSON.stringify(value)
      }
      values.push({ field, value })
    }
    if (!recordId) {
      await db.query('INSERT INTO iw_data.record_index(id,table_id) VALUES($1,$2)', [id, tableId])
      const columns = values.map((v) => identifier(v.field.id, 'f'))
      await db.query(
        `INSERT INTO iw_data.${identifier(tableId)} (_record_id${columns.length ? ',' + columns.join(',') : ''}) VALUES(${[id, ...values].map((_, i) => '$' + (i + 1)).join(',')})`,
        [id, ...values.map((v) => v.value)],
      )
    } else if (values.length) {
      await db.query(
        `UPDATE iw_data.${identifier(tableId)} SET ${values.map((v, i) => `${identifier(v.field.id, 'f')}=$${i + 2}`).join(',')} WHERE _record_id=$1`,
        [id, ...values.map((v) => v.value)],
      )
    }
    const invalidated = fields.filter(
      (f) => f.source && sourceUsesInput(f.source) && supplied.includes(f.source.inputFieldId),
    )
    if (recordId && invalidated.length) {
      await db.query(
        `UPDATE iw_data.${identifier(tableId)} SET ${invalidated.map((f) => `${identifier(f.id, 'f')}=NULL`).join(',')} WHERE _record_id=$1`,
        [id],
      )
      await db.query(isSqlite(db) ? "UPDATE iw_data.record_index SET api_state=coalesce((SELECT json_group_object(key,value) FROM json_each(api_state) WHERE key NOT IN (SELECT value FROM json_each($2))),'{}') WHERE id=$1" : 'UPDATE iw_data.record_index SET api_state=api_state-$2::text[] WHERE id=$1', [
        id,
        invalidated.map((f) => f.id),
      ])
    }
    const touched = new Set<string>(recordId ? [id] : [])
    for (const { field, next, previous } of linkChanges) {
      const own = field.side === 'source' ? 'source_id' : 'target_id',
        other = field.side === 'source' ? 'target_id' : 'source_id'
      const removed = previous.filter((v) => !next.includes(v)),
        added = next.filter((v) => !previous.includes(v))
      await db.query(
        `DELETE FROM iw_data.links WHERE relation_id=$1 AND ${own}=$2 AND ${other}=ANY($3::uuid[])`,
        [field.relationId, id, removed],
      )
      for (const target of added) {
        await db.query(
          'INSERT INTO iw_data.links(relation_id,source_id,target_id) VALUES($1,$2,$3)',
          [
            field.relationId,
            field.side === 'source' ? id : target,
            field.side === 'source' ? target : id,
          ],
        )
      }
      removed.forEach((v) => touched.add(v))
      added.forEach((v) => touched.add(v))
    }
    if (touched.size)
      await db.query(
        'UPDATE iw_data.record_index SET version=version+1,updated_at=now() WHERE id=ANY($1::uuid[])',
        [[...touched]],
      )
    await db.query(
      'INSERT INTO iw_data.changes(project_id,record_id,operation,details) VALUES($1,$2,$3,$4)',
      [
        table.projectId,
        id,
        recordId ? 'record.update' : 'record.create',
        JSON.stringify({ tableId, fieldIds: supplied, relationIds: changedRelations, origin }),
      ],
    )
    return id
  }, connection)
}

export async function deleteRecord(tableId: string, id: string, version: number) {
  return transaction(async (db) => {
    await db.query('SELECT id FROM iw_data.tables WHERE id=$1 FOR SHARE', [tableId])
    const table = await tableById(db, tableId)
    const relations = await db.query(
      'SELECT id FROM iw_data.relation_defs WHERE source_table=$1 OR target_table=$1 ORDER BY id FOR UPDATE',
      [tableId],
    )
    const edges = await db.query(
      'SELECT source_id,target_id FROM iw_data.links WHERE relation_id=ANY($1::uuid[]) AND (source_id=$2 OR target_id=$2)',
      [relations.rows.map((r) => r.id), id],
    )
    const affected = [
      ...new Set<string>([id, ...edges.rows.flatMap((e) => [e.source_id, e.target_id])]),
    ].sort()
    const locked = await db.query(
      'SELECT id,table_id,version FROM iw_data.record_index WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [affected],
    )
    const record = locked.rows.find((r) => r.id === id && r.table_id === tableId)
    if (!record) throw new DataError('记录不存在', 404)
    if (record.version !== version) throw new DataError('记录已更新，请刷新后再删除', 409)
    await db.query('DELETE FROM iw_data.record_index WHERE id=$1', [id])
    await db.query(
      'UPDATE iw_data.record_index SET version=version+1,updated_at=now() WHERE id=ANY($1::uuid[])',
      [affected.filter((v) => v !== id)],
    )
    await db.query(
      "INSERT INTO iw_data.changes(project_id,record_id,operation) VALUES($1,$2,'record.delete')",
      [table.projectId, id],
    )
  })
}

export async function getTableSchema(tableId: string) {
  return transaction(async (db) => ({
    ...(await tableById(db, tableId)),
    fields: await fieldsFor(db, tableId),
  }))
}

export async function getSchema(projectId: string) {
  if (!(await pool.query('SELECT id FROM iw_data.projects WHERE id=$1', [projectId])).rowCount)
    throw new DataError('项目不存在', 404)
  const tables = await getTables(projectId)
  return transaction(async (db) => ({
    schemaVersion: 1,
    projectId,
    tables: await Promise.all(
      tables.map(async (table) => ({ ...table, fields: await fieldsFor(db, table.id) })),
    ),
    commands: [
      'schema.preview',
      'schema.apply',
      'schema.get',
      'field.create',
      'field.configure',
      'field.update',
      'field.delete.preview',
      'field.delete',
      'records.list',
      'record.create',
      'record.update',
      'records.import',
      'automation.create',
    ],
    capabilitiesUrl: '/api/capabilities',
  }))
}

async function lockProject(db: Connection, projectId: string) {
  if (
    !(await db.query('SELECT id FROM iw_data.projects WHERE id=$1 FOR UPDATE', [projectId]))
      .rowCount
  )
    throw new DataError('项目不存在', 404)
}
const orderedIds = z
  .array(z.uuid())
  .max(2000)
  .refine((ids) => new Set(ids).size === ids.length, '排序不能包含重复项')
export const tableOrderInput = z.object({ ids: orderedIds, previousIds: orderedIds }).strict()
export const fieldOrderInput = z
  .object({ ids: orderedIds.max(100), version: z.number().int().positive() })
  .strict()
export const detailLayoutInput = z
  .object({
    fieldOrder: orderedIds.max(100),
    version: z.number().int().positive(),
  })
  .strict()
export async function saveDetailLayout(tableId: string, input: z.infer<typeof detailLayoutInput>) {
  return transaction(async (db) => {
    await db.query('SELECT id FROM iw_data.tables WHERE id=$1 FOR UPDATE', [tableId])
    const table = await tableById(db, tableId)
    if (table.version !== input.version) throw new DataError('数据表已更新，请刷新后重试', 409)
    const fields = await fieldsFor(db, tableId)
    sameMembers(
      fields.filter((f) => f.type !== 'relation').map((f) => f.id),
      input.fieldOrder,
    )
    await db.query(
      'UPDATE iw_data.tables SET detail_layout=$2::jsonb, version=version+1 WHERE id=$1',
      [tableId, JSON.stringify({ fieldOrder: input.fieldOrder })],
    )
    return tableById(db, tableId)
  })
}
function sameMembers(current: string[], next: string[]) {
  const set = new Set(current)
  if (current.length !== next.length || next.some((id) => !set.has(id)))
    throw new DataError('列表已变化，请刷新后重新排序', 409)
}
export async function reorderTables(projectId: string, input: z.infer<typeof tableOrderInput>) {
  return transaction(async (db) => {
    await lockProject(db, projectId)
    const current = (
      await db.query('SELECT id FROM iw_data.tables WHERE project_id=$1 ORDER BY position,id', [
        projectId,
      ])
    ).rows.map((r) => r.id as string)
    sameMembers(current, input.ids)
    if (!isDeepStrictEqual(current, input.previousIds))
      throw new DataError('列表已变化，请刷新后重新排序', 409)
    await db.query(
      isSqlite(db) ? 'UPDATE iw_data.tables SET position=(SELECT key FROM json_each($1) WHERE value=tables.id) WHERE project_id=$2' : 'UPDATE iw_data.tables t SET position=(o.ordinality-1)::int FROM unnest($1::uuid[]) WITH ORDINALITY o(id,ordinality) WHERE t.id=o.id AND t.project_id=$2',
      [input.ids, projectId],
    )
    return { ok: true }
  })
}
export async function reorderFields(tableId: string, input: z.infer<typeof fieldOrderInput>) {
  return transaction(async (db) => {
    await db.query('SELECT id FROM iw_data.tables WHERE id=$1 FOR UPDATE', [tableId])
    const table = await tableById(db, tableId)
    if (table.version !== input.version) throw new DataError('数据表已更新，请刷新后重试', 409)
    const fields = await fieldsFor(db, tableId)
    sameMembers(
      fields.map((f) => f.id),
      input.ids,
    )
    await db.query(
      isSqlite(db) ? 'UPDATE iw_data.fields SET position=(SELECT key FROM json_each($1) WHERE value=fields.id) WHERE table_id=$2' : 'UPDATE iw_data.fields f SET position=(o.ordinality-1)::int FROM unnest($1::uuid[]) WITH ORDINALITY o(id,ordinality) WHERE f.id=o.id AND f.table_id=$2',
      [input.ids, tableId],
    )
    await db.query('UPDATE iw_data.tables SET version=version+1 WHERE id=$1', [tableId])
    return { table: await tableById(db, tableId), fields: await fieldsFor(db, tableId) }
  })
}
