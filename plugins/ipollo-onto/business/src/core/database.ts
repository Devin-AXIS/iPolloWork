import { z } from 'zod'

export const databaseConnectionInput = z
  .object({
    engine: z.enum(['postgres', 'highgo']).default('postgres'),
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:-]+$/, '请输入主机名或 IP 地址'),
    port: z.number().int().min(1).max(65535).default(5432),
    database: z.string().trim().min(1).max(63),
    user: z.string().trim().min(1).max(63),
    password: z.string().max(1024).default(''),
    ssl: z.enum(['disable', 'verify-full']).default('disable'),
    ca: z.string().max(20000).default(''),
  })
  .strict()
export type DatabaseConnection = z.infer<typeof databaseConnectionInput>
export type DatabaseChoice =
  { mode: 'default' } | { mode: 'independent'; connection: DatabaseConnection }
export const databaseChoiceInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default') }).strict(),
  z.object({ mode: z.literal('independent'), connection: databaseConnectionInput }).strict(),
])
export interface DatabaseSummary {
  mode: 'default' | 'independent'
  engine: 'postgres' | 'highgo' | 'sqlite'
  database: string
  host: string
  port: number
  user: string
  ssl: 'disable' | 'verify-full'
  status: 'connected' | 'unavailable' | 'pending'
}
export interface DatabaseCheck {
  ok: true
  database: string
  version: string
  latencyMs: number
}
