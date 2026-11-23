import { z } from 'zod'

// UI routing hints only. These never change the data operation's access scope.
export const workbenchInput = z.object({ id: z.uuid() }).strict()
export const focusInput = z.object({
  href: z.string().max(10000).startsWith('/#project='),
  page: z.number().int().positive().optional(),
  recordId: z.uuid().optional(),
  documentId: z.uuid().optional(),
  blockId: z
    .string()
    .regex(/^[\w-]{1,80}$/)
    .optional(),
  fieldId: z.uuid().optional(),
  recordIds: z.array(z.uuid()).max(200).optional(),
})
export type WorkbenchFocus = z.infer<typeof focusInput>
export const activityInput = z.object({
  id: z.uuid(),
  operation: z.string().max(64),
  phase: z.enum(['running', 'complete', 'failed']),
  created: z.number().int().nonnegative().optional(),
  updated: z.number().int().nonnegative().optional(),
  tables: z.number().int().nonnegative().optional(),
  replayed: z.boolean().optional(),
  workbenchId: z.uuid().optional(),
  focus: focusInput.optional(),
})
export type LiveActivity = z.infer<typeof activityInput>
