import { z } from 'zod'
import { fieldSourceInput } from './sources'

export const fieldUpdateInput = z
  .object({
    tableVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(80).optional(),
    type: z.string().min(1).max(80).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    source: fieldSourceInput.optional(),
  })
  .strict()
export const fieldDeleteInput = z
  .object({
    tableVersion: z.number().int().positive(),
    relatedTableVersion: z.number().int().positive().optional(),
  })
  .strict()
export interface FieldDeletePreview {
  tableVersion: number
  relatedTableVersion?: number
  fields: Array<{ id: string; tableId: string; name: string; tableName: string }>
  blockers: Array<{ kind: 'primary' | 'api' | 'view' | 'document' | 'automation'; name: string }>
  valueCount: number
  relation: boolean
}

// Stable IDs are global; only explicit reference keys count, never prose or cell values.
export function referencesField(value: unknown, ids: Set<string>): boolean {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) =>
    ['fieldId', 'relatedFieldId', 'relationFieldId'].includes(key) && typeof child === 'string'
      ? ids.has(child)
      : referencesField(child, ids),
  )
}
