import type { FieldSource, DynamicValueState } from './sources'
import type { EntityIconId } from './icons'
import type { DatabaseSummary } from './database'
import type { RecordQuery } from './query'
export function sourceUsesInput(source: FieldSource): boolean {
  return source.provider !== 'json-api' || source.url.includes('{{value}}')
}
export interface Project {
  icon?: EntityIconId
  storage?: DatabaseSummary
  id: string
  name: string
  description: string
  color: string
  groupLabel: string | null
  createdAt: string
  tableCount: number
  recordCount: number
}

export interface TableDef {
  detailLayout?: { fieldOrder: string[] }
  icon?: EntityIconId
  position?: number
  id: string
  projectId: string
  name: string
  description: string
  version: number
  recordCount: number
  createdAt: string
}

export interface FieldDef {
  isPrimary?: boolean
  source?: FieldSource | null
  id: string
  tableId: string
  name: string
  type: string
  required: boolean
  options: string[]
  position: number
  relationId: string | null
  side: 'source' | 'target' | null
  targetTableId: string | null
  multiple: boolean
}

export interface LinkValue {
  id: string
  label: string
  tableId: string
}
export interface DataRecord {
  dynamic?: Record<string, DynamicValueState>
  id: string
  version: number
  createdAt: string
  updatedAt: string
  values: Record<string, unknown>
}
export interface TableData {
  appliedQuery?: RecordQuery
  queryInfo?: {
    snapshotFields: string[]
    labels?: Record<string, string>
    scope: 'table'
    evaluatedAt: string
  }
  table: TableDef
  fields: FieldDef[]
  records: DataRecord[]
  total: number
  page: number
  pageSize: number
}

export interface GraphRecordSearch {
  records: Array<{ id: string; tableId: string; tableName: string; label: string }>
  tables: Array<{ id: string; name: string }>
  hasMore: boolean
  tablesLimited: boolean
}

export interface RelationGraph {
  tableId: string
  nodes: Array<{
    id: string
    tableId: string
    tableName: string
    label: string
    root: boolean
    fields: Array<{ id: string; name: string; type: string; value: string | null; api: boolean }>
  }>
  edges: Array<{
    id: string
    relationId: string
    source: string
    target: string
    label: string
    sourceField: { id: string; name: string; multiple: boolean }
    targetField: { id: string; name: string; multiple: boolean }
  }>
  limited: boolean
}

export interface FieldType {
  icon?: EntityIconId
  validateOptions?: (options: string[]) => void
  id: string
  label: string
  category: 'basic' | 'extended'
  group?: 'text' | 'number' | 'choice' | 'date' | 'media' | 'data'
  description?: string
  storage: 'text' | 'numeric' | 'boolean' | 'date' | 'jsonb'
  input:
    | 'text'
    | 'textarea'
    | 'number'
    | 'checkbox'
    | 'date'
    | 'select'
    | 'json'
    | 'multiselect'
    | 'tags'
    | 'datetime'
    | 'time'
    | 'daterange'
  validate: (value: unknown, field: Pick<FieldDef, 'name' | 'options'>) => unknown
  format: (value: unknown) => string
}

// Data acquisition is separate from the value type. Providers never receive a database handle.
export interface FieldProvider {
  id: string
  version: string
  capabilities: { batch: boolean; filter: boolean; sort: boolean; history: boolean }
  resolve: (input: {
    recordIds: string[]
    parameters: Record<string, unknown>
    signal: AbortSignal
  }) => Promise<
    Array<{
      recordId: string
      value: unknown
      observedAt: string
      expiresAt?: string
      status: 'fresh' | 'stale' | 'unavailable'
      source: string
    }>
  >
}

export interface SyncConnector {
  id: string
  version: string
  read: (input: { cursor?: string; signal: AbortSignal }) => Promise<{
    records: Array<{ sourceId: string; values: Record<string, unknown> }>
    nextCursor?: string
    complete: boolean
  }>
}

export function isLinkValue(value: unknown): value is LinkValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'label' in value &&
    typeof value.label === 'string' &&
    'tableId' in value &&
    typeof value.tableId === 'string'
  )
}
export function links(value: unknown): LinkValue[] {
  return Array.isArray(value) ? value.filter(isLinkValue) : []
}
export function display(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
