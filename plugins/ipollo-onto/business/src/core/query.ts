import { z } from 'zod'
import type { FieldDef } from './contracts'
import { fieldTypes } from './fields'

export const operators = [
  'eq',
  'neq',
  'contains',
  'startsWith',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'isEmpty',
  'isNotEmpty',
  'hasAny',
  'hasAll',
  'notHasAny',
] as const
export type FilterOperator = (typeof operators)[number]
export interface FilterCondition {
  fieldId: string
  relatedFieldId?: string
  operator: FilterOperator
  value?: string | number | boolean | string[]
}
export interface FilterGroup {
  conjunction: 'and' | 'or'
  conditions: Array<FilterCondition | FilterGroup>
}
const conditionInput = z
  .object({
    fieldId: z.uuid(),
    relatedFieldId: z.uuid().optional(),
    operator: z.enum(operators),
    value: z
      .union([
        z.string().max(1000),
        z.number().finite(),
        z.boolean(),
        z.array(z.string().max(1000)).min(1).max(100),
      ])
      .optional(),
  })
  .strict()
// Finite nesting keeps validation and the generated MCP / OpenAPI schema bounded.
const leafGroup = z
  .object({
    conjunction: z.enum(['and', 'or']),
    conditions: z.array(conditionInput).min(1).max(40),
  })
  .strict()
const middleGroup = z
  .object({
    conjunction: z.enum(['and', 'or']),
    conditions: z
      .array(z.union([conditionInput, leafGroup]))
      .min(1)
      .max(40),
  })
  .strict()
export const filterInput = z
  .object({
    conjunction: z.enum(['and', 'or']),
    conditions: z
      .array(z.union([conditionInput, middleGroup]))
      .min(1)
      .max(40),
  })
  .strict()
  .refine((group) => filterCount(group) <= 40, '最多 40 个筛选条件')
export const recordQueryInput = z
  .object({
    search: z.string().max(80).default(''),
    filter: filterInput.optional(),
    sort: z
      .array(z.object({ fieldId: z.uuid(), direction: z.enum(['asc', 'desc']) }).strict())
      .max(3)
      .default([]),
  })
  .strict()
export type RecordQuery = z.infer<typeof recordQueryInput>
export const emptyQuery = (): RecordQuery => ({ search: '', sort: [] })
export const recordListShape = {
  page: z.number().int().min(1).max(100000).default(1),
  query: z
    .string()
    .max(80)
    .default('')
    .describe('Legacy title-prefix search. Use selection for structured queries.'),
  selection: recordQueryInput
    .optional()
    .describe('Shared visual / AI query. Stable field IDs; conditions execute before pagination.'),
  viewId: z
    .uuid()
    .optional()
    .describe('Saved view ID from query_context; mutually exclusive with selection and query.'),
}
export function filterCount(group?: FilterGroup): number {
  return (
    group?.conditions.reduce(
      (n, child) => n + ('conditions' in child ? filterCount(child) : 1),
      0,
    ) ?? 0
  )
}
export function queryActive(query?: RecordQuery): boolean {
  return Boolean(query && (query.search || query.filter || query.sort.length))
}
export type QueryKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'choice'
  | 'list'
  | 'json'
  | 'relation'
export interface QueryField {
  field: FieldDef
  kind: QueryKind
  operators: FilterOperator[]
  sortable: boolean
  reason?: 'live' | 'unavailable'
  related?: QueryField[]
}
export function queryField(field: FieldDef): QueryField {
  const type = fieldTypes.has(field.type) ? fieldTypes.get(field.type) : undefined
  const kind: QueryKind =
    field.type === 'relation'
      ? 'relation'
      : type?.input === 'datetime'
        ? 'datetime'
        : type?.input === 'time'
          ? 'time'
          : type?.input === 'select'
            ? 'choice'
            : type?.input === 'multiselect' || type?.input === 'tags'
              ? 'list'
              : type?.storage === 'numeric'
                ? 'number'
                : type?.storage === 'date'
                  ? 'date'
                  : type?.storage === 'boolean'
                    ? 'boolean'
                    : type?.storage === 'jsonb'
                      ? 'json'
                      : 'text'
  const reason =
    field.source?.storage === 'live'
      ? 'live'
      : !type && kind !== 'relation'
        ? 'unavailable'
        : undefined
  const available: FilterOperator[] = ['isEmpty', 'isNotEmpty']
  if (['text', 'choice', 'number', 'date', 'datetime', 'time', 'boolean'].includes(kind))
    available.unshift('eq', 'neq')
  if (['text', 'choice'].includes(kind)) available.push('in', 'notIn')
  if (kind === 'text') available.push('contains', 'startsWith')
  if (['number', 'date', 'datetime', 'time'].includes(kind))
    available.push('gt', 'gte', 'lt', 'lte')
  if (kind === 'list' || kind === 'relation') available.push('hasAny', 'hasAll', 'notHasAny')
  return {
    field,
    kind,
    operators: reason ? [] : available,
    sortable: !reason && !['json', 'list', 'relation'].includes(kind),
    ...(reason ? { reason } : {}),
  }
}
export interface SavedQueryView {
  id: string
  name: string
  layout: string
  query: RecordQuery
}
export interface QueryContext {
  tableId: string
  version: number
  fields: QueryField[]
  views: SavedQueryView[]
}
export const saveQueryViewInput = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    layout: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,79}$/)
      .default('grid'),
    query: recordQueryInput,
    version: z.number().int().positive(),
  })
  .strict()
