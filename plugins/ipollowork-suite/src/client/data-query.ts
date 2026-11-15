/** Filter rules of the Data page and their translation into an app data `where` object. */
import type { DataCondition, DataFieldType } from '../shared/app-data.ts'

export type Op = 'contains' | '=' | '!=' | '>' | '>=' | '<' | '<=' | 'empty'
/** Conditions offered per field type; JSON fields can only be tested for absence. */
export const OPS: Record<DataFieldType, Op[]> = {
  text: ['contains', '=', '!=', 'empty'],
  number: ['=', '!=', '>', '>=', '<', '<=', 'empty'],
  boolean: ['=', 'empty'],
  json: ['empty'],
}
/** One condition as typed: the value stays text until it is applied. */
export interface Rule { field: string; op: Op; value: string }

/**
 * @param rule - the condition.
 * @param type - the type of its field, undefined when the field is unknown.
 * @returns whether the rule can be sent: a known field and, unless it tests absence, a usable value.
 */
export function complete(rule: Rule, type: DataFieldType | undefined): boolean {
  if (type === undefined) return false
  if (rule.op === 'empty') return true
  return type === 'number' ? rule.value.trim() !== '' && Number.isFinite(Number(rule.value)) : rule.value !== ''
}

/**
 * @param rules - the conditions; incomplete ones are skipped.
 * @param fields - the collection's fields and types.
 * @returns the `where` object, or undefined without conditions. Conditions on one field combine, and a test for
 * absence replaces the field's other conditions.
 */
export function whereOf(rules: Rule[], fields: [string, DataFieldType][]): Record<string, DataCondition> | undefined {
  const types = new Map(fields)
  const out: Record<string, DataCondition> = {}
  for (const rule of rules) {
    const type = types.get(rule.field)
    if (!complete(rule, type)) continue
    if (rule.op === 'empty') {
      out[rule.field] = null
      continue
    }
    const value = type === 'number' ? Number(rule.value) : type === 'boolean' ? rule.value === 'true' : rule.value
    const current = out[rule.field]
    out[rule.field] = { ...(current !== null && typeof current === 'object' ? current : {}), [rule.op]: value }
  }
  return Object.keys(out).length ? out : undefined
}
