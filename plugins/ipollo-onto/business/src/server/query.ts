import type { FieldDef } from '../core/contracts'
import { fieldTypes } from '../core/fields'
import {
  queryField,
  recordQueryInput,
  type RecordQuery,
  type FilterCondition,
  type FilterGroup,
} from '../core/query'
import { identifier, isSqlite, type Connection } from './db'
import { decimalInteger, decimalExpression } from './sqlite'
import { DataError } from './errors'
import { z } from 'zod'

// All identifiers come from loaded schema; user values are always bound parameters.
export async function compileQuery(
  db: Connection,
  fields: FieldDef[],
  raw: RecordQuery,
  params: unknown[],
  getFields: (db: Connection, tableId: string) => Promise<FieldDef[]>,
  allowedTables?: Set<string>,
) {
  const query = recordQueryInput.parse(raw)
  const snapshotFields = new Set<string>()
  const labels: Record<string, string> = {}
  const loaded = new Map<string, Promise<FieldDef[]>>()
  const bind = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  const find = (list: FieldDef[], id: string) => {
    const field = list.find((f) => f.id === id)
    if (!field) throw new DataError('筛选字段已不存在，请修改条件')
    labels[field.id] = field.name
    if (field.type === 'relation' && allowedTables && !allowedTables.has(field.targetTableId!))
      throw new DataError('关联目标不在当前接入范围')
    return field
  }
  function expression(field: FieldDef, alias: string) {
    const col = `${alias}.${identifier(field.id, 'f')}`
    const kind = queryField(field).kind
    if (kind === 'number' && isSqlite(db)) return decimalExpression(col)
    return kind === 'datetime' ? `(${col})::timestamptz` : kind === 'time' ? `(${col})::time` : col
  }
  function usable(field: FieldDef) {
    const info = queryField(field)
    if (info.reason === 'live')
      throw new DataError('动态 API 字段尚未保存，不能用于全表筛选或排序；请先改为获取并保存')
    if (info.reason) throw new DataError('字段扩展未加载，暂时无法筛选')
    if (field.source) snapshotFields.add(field.id)
    return info
  }
  function scalar(field: FieldDef, condition: FilterCondition, alias: string): string {
    const info = usable(field),
      op = condition.operator,
      col = expression(field, alias)
    if (!info.operators.includes(op)) throw new DataError('该字段不支持这个筛选条件')
    if (op === 'isEmpty' || op === 'isNotEmpty') {
      if (condition.value !== undefined) throw new DataError('为空条件不需要填写值')
      let blank = `${col} IS NULL`
      if (info.kind === 'text' || info.kind === 'choice') blank += ` OR ${col}=''`
      if (info.kind === 'list') blank += ` OR ${col}='[]'::jsonb`
      if (info.kind === 'json') blank += ` OR ${col}='null'::jsonb`
      return op === 'isEmpty' ? `(${blank})` : `(NOT (${blank}))`
    }
    const value = condition.value
    if (value === undefined) throw new DataError('请填写筛选条件的值')
    const stringArray = () => {
      if (!Array.isArray(value) || !value.length || value.some((v) => typeof v !== 'string'))
        throw new DataError('这个条件需要一个非空的值列表')
      return value
    }
    if (['hasAny', 'hasAll', 'notHasAny'].includes(op)) {
      const p = bind(stringArray())
      const test = `${col} ${op === 'hasAll' ? '?&' : '?|'} ${p}::text[]`
      return `(${col} IS NOT NULL AND ${op === 'notHasAny' ? `NOT (${test})` : test})`
    }
    if (op === 'in' || op === 'notIn')
      return `(${col} ${op === 'in' ? '=' : '<>'} ${op === 'in' ? 'ANY' : 'ALL'}(${bind(stringArray())}::text[]))`
    let normalized: unknown = value
    try {
      if (info.kind === 'number') {
        if (typeof value !== 'string' && typeof value !== 'number')
          throw new Error('请输入有效数值')
        normalized = fieldTypes.get('number').validate(value, field)
      } else if (['date', 'datetime', 'time'].includes(info.kind)) {
        normalized = fieldTypes.get(field.type).validate(value, field)
      } else if (info.kind === 'boolean') {
        if (typeof value !== 'boolean') throw new Error('勾选条件需要是或否')
      } else if (typeof value !== 'string') throw new Error('这个条件需要文本值')
    } catch (error) {
      throw new DataError(error instanceof Error ? error.message : '筛选值格式不正确')
    }
    if (op === 'contains' || op === 'startsWith') {
      const escaped = String(normalized).replace(/[\\%_]/g, '\\$&')
      return `${col} ILIKE ${bind(op === 'contains' ? `%${escaped}%` : `${escaped}%`)} ESCAPE '\\'`
    }
    const comparisons = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const
    const symbol = comparisons[op as keyof typeof comparisons]
    if (!symbol) throw new DataError('筛选比较方式无效')
    if (info.kind === 'number' && isSqlite(db)) normalized = decimalInteger(String(normalized))
    return `${col} ${symbol} ${bind(normalized)}`
  }
  let relationIndex = 0
  async function condition(c: FilterCondition) {
    const field = find(fields, c.fieldId)
    if (field.type !== 'relation') {
      if (c.relatedFieldId) throw new DataError('只有关联字段才能选择关联表中的字段')
      return scalar(field, c, 'd')
    }
    if (!field.targetTableId || !field.relationId) throw new DataError('关联结构不完整')
    const n = relationIndex++,
      edge = `e${n}`,
      target = `j${n}`
    const own = field.side === 'source' ? 'source_id' : 'target_id'
    const other = field.side === 'source' ? 'target_id' : 'source_id'
    const base = `${edge}.relation_id=${bind(field.relationId)}::uuid AND ${edge}.${own}=r.id`
    if (c.relatedFieldId) {
      if (!loaded.has(field.targetTableId))
        loaded.set(field.targetTableId, getFields(db, field.targetTableId))
      const related = find(await loaded.get(field.targetTableId)!, c.relatedFieldId)
      if (related.type === 'relation') throw new DataError('目前支持一层关联筛选')
      const predicate = scalar(related, c, target)
      return `EXISTS (SELECT 1 FROM iw_data.links ${edge} JOIN iw_data.${identifier(field.targetTableId)} ${target} ON ${target}._record_id=${edge}.${other} WHERE ${base} AND (${predicate}))`
    }
    if (!queryField(field).operators.includes(c.operator))
      throw new DataError('关联字段不支持这个筛选条件')
    if (c.operator === 'isEmpty' || c.operator === 'isNotEmpty') {
      if (c.value !== undefined) throw new DataError('为空条件不需要填写值')
      return `${c.operator === 'isEmpty' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM iw_data.links ${edge} WHERE ${base})`
    }
    if (
      !Array.isArray(c.value) ||
      !c.value.length ||
      c.value.some((v) => !z.uuid().safeParse(v).success)
    )
      throw new DataError('关联条件需要记录 ID 列表')
    const values = [...new Set(c.value)],
      p = bind(values)
    const matching = `SELECT 1 FROM iw_data.links ${edge} WHERE ${base} AND ${edge}.${other}=ANY(${p}::uuid[])`
    if (c.operator === 'hasAll')
      return `(SELECT count(*) FROM iw_data.links ${edge} WHERE ${base} AND ${edge}.${other}=ANY(${p}::uuid[]))=${values.length}`
    return `${c.operator === 'notHasAny' ? 'NOT ' : ''}EXISTS (${matching})`
  }
  async function group(g: FilterGroup): Promise<string> {
    const parts: string[] = []
    for (const child of g.conditions)
      parts.push('conditions' in child ? await group(child) : await condition(child))
    return `(${parts.join(g.conjunction === 'and' ? ' AND ' : ' OR ')})`
  }
  const predicate = query.filter ? await group(query.filter) : ''
  const sorted = new Set<string>()
  const order = query.sort.map((s) => {
    const field = find(fields, s.fieldId)
    if (!usable(field).sortable) throw new DataError('该字段暂不支持排序')
    if (sorted.has(field.id)) throw new DataError('排序字段不能重复')
    sorted.add(field.id)
    return `${expression(field, 'd')} ${s.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`
  })
  return {
    predicate,
    order: [...order, 'r.created_at', 'r.id'].join(','),
    snapshotFields: [...snapshotFields],
    labels,
    query,
  }
}
