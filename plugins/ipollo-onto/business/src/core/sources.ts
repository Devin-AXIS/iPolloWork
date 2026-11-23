import { z } from 'zod'

const common = {
  storage: z.enum(['live', 'snapshot']).default('live'),
  inputFieldId: z.string().min(1).max(80),
  ttlSeconds: z.number().int().min(5).max(3600).default(30),
  unit: z.string().max(12).default(''),
}
const jsonSource = z
  .object({
    ...common,
    provider: z.literal('json-api'),
    inputFieldId: z.string().max(80).default(''),
    url: z.string().trim().min(1).max(2000),
    valuePath: z.string().max(500).default('/price'),
    observedAtPath: z.string().max(500).default(''),
    decimalPlaces: z.number().int().min(0).max(4).optional(),
    credential: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
      .optional(),
  })
  .strict()
export const fieldSourceInput = z.discriminatedUnion('provider', [
  jsonSource,
  z
    .object({
      ...common,
      provider: z.literal('tencent-stock'),
      metric: z.enum(['price', 'previousClose', 'volume', 'date']).default('price'),
    })
    .strict(),
])
// Retained only to read previously saved local previews; new simulated fields are rejected.
export type FieldSource =
  | z.infer<typeof fieldSourceInput>
  | {
      provider: 'demo-stock'
      inputFieldId: string
      metric: 'price' | 'changePercent' | 'volume'
      storage: 'live' | 'snapshot'
      ttlSeconds: number
      unit: string
    }
export interface DynamicValueState {
  status: 'loading' | 'fresh' | 'stale' | 'unavailable'
  source: string
  simulated: boolean
  fetchedAt?: string
  observedAt?: string
  expiresAt?: string
  error?: string
  errorCode?: string
}
export const sourceDefinitions = [
  {
    id: 'tencent-stock',
    name: '腾讯公开美股行情',
    description: '按本行证券代码获取价格、成交量和报价日期',
    simulated: false,
  },
  {
    id: 'json-api',
    name: 'API 实时字段',
    description: '从获准的 HTTP 接口读取数值、文本或 JSON',
    simulated: false,
  },
] as const
