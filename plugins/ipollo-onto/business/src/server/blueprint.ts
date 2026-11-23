import { createHash, randomUUID } from 'node:crypto'
import { blueprintInput, type Blueprint, type BlueprintResult } from '../core/blueprint'
import { fieldTypes } from '../core/fields'
import { transaction, identifier, defaultPool, inDatabase, type Connection } from './db'
import { createTable, createField, tableInput, fieldInput, fieldsFor } from './store'
import { withProject } from './databases'
import { DataError } from './errors'
import { lockExtensions, requireFieldExtension } from './extensions'

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    )
  return value
}
export function requestHash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex')
}
export async function requestReceipt(
  db: Connection,
  requestId: string,
  hash: string,
  operation: string,
) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5710))', [requestId])
  const found = (
    await db.query(
      "SELECT operation,details FROM iw_data.changes WHERE operation IN ('blueprint.apply','import.apply') AND details->>'requestId'=$1",
      [requestId],
    )
  ).rows[0]
  if (found && (found.operation !== operation || found.details.hash !== hash))
    throw new DataError('这个 requestId 已用于其他内容，请使用新的请求标识', 409)
  return found?.details.result
}
async function build(db: Connection, input: Blueprint): Promise<BlueprintResult> {
  await lockExtensions(db)
  // Resolve all external targets before creating anything; names are never relationship identities.
  if (new Set(input.tables.map((t) => t.key)).size !== input.tables.length)
    throw new DataError('表的结构标识不能重复')
  for (const table of input.tables) {
    if (table.fields[0].type !== 'text' || table.fields[0].source)
      throw new DataError(`「${table.name}」的第一个字段需要是文本标题`)
    if (new Set(table.fields.map((f) => f.key)).size !== table.fields.length)
      throw new DataError('字段的结构标识不能重复')
    if (new Set(table.fields.map((f) => f.name)).size !== table.fields.length)
      throw new DataError('字段名称不能重复')
    for (const field of table.fields) {
      if (!fieldTypes.has(field.type))
        throw new DataError(`未知字段类型：${field.type}；关联请放入 relations`)
      await requireFieldExtension(db, field.type)
    }
  }
  const external = new Map<string, number>()
  for (const relation of input.relations) {
    const from = input.tables.find((t) => t.key === relation.from)
    if (!from) throw new DataError(`找不到关联来源：${relation.from}`)
    if (
      from.fields.some((f) => f.key === relation.key) ||
      input.relations.filter((r) => r.from === relation.from && r.key === relation.key).length > 1
    )
      throw new DataError('关联与字段的结构标识不能重复')
    if (!input.tables.some((t) => t.key === relation.to)) {
      if (!/^[a-f0-9-]{36}$/.test(relation.to) || !relation.targetVersion)
        throw new DataError('关联已有表需要目标表 UUID 和 targetVersion')
      if (external.has(relation.to) && external.get(relation.to) !== relation.targetVersion)
        throw new DataError('同一目标表版本不一致')
      external.set(relation.to, relation.targetVersion)
    }
  }
  let projectId: string
  if ('id' in input.project) {
    projectId = input.project.id
    if (
      !(await db.query('SELECT id FROM iw_data.projects WHERE id=$1 FOR UPDATE', [projectId]))
        .rowCount
    )
      throw new DataError('项目不存在', 404)
  } else {
    projectId = randomUUID()
    await db.query(
      "INSERT INTO iw_data.projects(id,name,description,color) VALUES($1,$2,$3,'neutral')",
      [projectId, input.project.name, input.project.description],
    )
  }
  for (const [id, version] of [...external].sort(([a], [b]) => a.localeCompare(b))) {
    const target = (
      await db.query('SELECT version FROM iw_data.tables WHERE id=$1 FOR UPDATE', [id])
    ).rows[0]
    if (!target || target.version !== version)
      throw new DataError('关联目标的结构已变化或不在同一数据库，请重新读取结构', 409)
  }
  const result: BlueprintResult = { projectId, tables: [], replayed: false, preview: false }
  for (const spec of input.tables) {
    const table = await createTable(projectId, tableInput.parse(spec), db)
    const first = (await fieldsFor(db, table.id))[0]
    const title = spec.fields[0]
    await db.query('UPDATE iw_data.fields SET name=$2,required=$3 WHERE id=$1', [
      first.id,
      title.name,
      title.required,
    ])
    if (title.required)
      await db.query(
        `ALTER TABLE iw_data.${identifier(table.id)} ALTER COLUMN ${identifier(first.id, 'f')} SET NOT NULL`,
      )
    const fieldIds: Record<string, string> = Object.create(null)
    fieldIds[title.key] = first.id
    for (const f of spec.fields
      .slice(1)
      .sort((a, b) => Number(Boolean(a.source)) - Number(Boolean(b.source)))) {
      const source = f.source
        ? { ...f.source, inputFieldId: fieldIds[f.source.inputFieldId] ?? f.source.inputFieldId }
        : undefined
      const created = await createField(table.id, fieldInput.parse({ ...f, source }), db)
      fieldIds[f.key] = created!.id
    }
    result.tables.push({ key: spec.key, id: table.id, name: table.name, fieldIds })
  }
  for (const r of input.relations) {
    const from = result.tables.find((t) => t.key === r.from)!
    const to = result.tables.find((t) => t.key === r.to)?.id ?? r.to
    const field = await createField(
      from.id,
      fieldInput.parse({
        name: r.name,
        type: 'relation',
        targetTableId: to,
        reverseName: r.reverseName,
        multiple: r.multiple,
        inverseMultiple: r.inverseMultiple,
      }),
      db,
    )
    from.fieldIds[r.key] = field!.id
  }
  return result
}
export async function applyBlueprint(raw: unknown, preview = false): Promise<BlueprintResult> {
  const input = blueprintInput.parse(raw),
    hash = requestHash(input)
  const run = () =>
    transaction(async (db) => {
      const previous = await requestReceipt(db, input.requestId, hash, 'blueprint.apply')
      if (previous) return { ...previous, replayed: true, preview }
      await db.query('SAVEPOINT blueprint')
      const result = await build(db, input)
      if (preview) await db.query('ROLLBACK TO SAVEPOINT blueprint')
      else
        await db.query(
          "INSERT INTO iw_data.changes(project_id,operation,details) VALUES($1,'blueprint.apply',$2)",
          [result.projectId, JSON.stringify({ requestId: input.requestId, hash, result })],
        )
      return { ...result, preview }
    })
  return 'id' in input.project ? withProject(input.project.id, run) : inDatabase(defaultPool, run)
}
