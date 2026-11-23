import { links, type DataRecord, type FieldDef, type TableData } from '../../core/contracts'

export function fieldDraft(field: FieldDef, record?: DataRecord): unknown {
  const value = record?.values[field.id]
  if (field.type === 'relation') return links(value).map((link) => link.id)
  if (field.type === 'json' && value != null) return JSON.stringify(value, null, 2)
  return value ?? (field.type === 'boolean' ? false : '')
}
export function recordDraft(data: TableData, record?: DataRecord) {
  return Object.fromEntries(
    data.fields.filter((f) => !f.source).map((f) => [f.id, fieldDraft(f, record)]),
  )
}
export function detailFields(data: TableData) {
  const fields = data.fields.filter((f) => f.type !== 'relation')
  const order = data.table.detailLayout?.fieldOrder ?? []
  return [
    ...order.flatMap((id) => fields.find((f) => f.id === id) ?? []),
    ...fields.filter((f) => !order.includes(f.id)),
  ]
}
