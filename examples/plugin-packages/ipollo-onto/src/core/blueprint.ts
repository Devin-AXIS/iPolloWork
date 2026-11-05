import { fieldSourceInput } from './sources'
import { z } from 'zod'
import { entityIconIds } from './icons'

const key = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/, '结构标识使用字母开头的英文、数字、下划线或短横线')
const name = z.string().trim().min(1).max(80)
export const blueprintInput = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    project: z.union([
      z.object({ id: z.uuid() }).strict(),
      z.object({ name, description: z.string().max(500).default('') }).strict(),
    ]),
    tables: z
      .array(
        z
          .object({
            key,
            name,
            icon: z.enum(entityIconIds).optional(),
            description: z.string().max(500).default(''),
            fields: z
              .array(
                z
                  .object({
                    source: fieldSourceInput.optional(),
                    key,
                    name,
                    type: z.string().min(1).max(80),
                    required: z.boolean().default(false),
                    options: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    relations: z
      .array(
        z
          .object({
            from: key,
            to: z.union([key, z.uuid()]),
            key,
            name,
            reverseName: name,
            multiple: z.boolean().default(false),
            inverseMultiple: z.boolean().default(true),
            targetVersion: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict()
export type Blueprint = z.infer<typeof blueprintInput>
export interface BlueprintResult {
  projectId: string
  tables: Array<{ key: string; id: string; name: string; fieldIds: Record<string, string> }>
  replayed: boolean
  preview: boolean
}
