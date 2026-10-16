import { z } from 'zod'
import { blueprintInput, type Blueprint } from './blueprint'
import { entityIconIds, type EntityIconId } from './icons'

export const tablePresetIds = ['general', 'users', 'products', 'orders'] as const
export type TablePresetId = (typeof tablePresetIds)[number]
export const presetLocale = z.enum(['zh-CN', 'en']).default('zh-CN')
const binding = z.object({ tableId: z.uuid(), version: z.number().int().positive() }).strict()
export const tablePresetInput = z
  .object({
    requestId: z.uuid(),
    preset: z.enum(tablePresetIds),
    locale: presetLocale,
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().max(500).default(''),
    icon: z.enum(entityIconIds).optional(),
    bindings: z
      .object({ users: binding.optional(), products: binding.optional() })
      .strict()
      .default({}),
  })
  .strict()
export type TablePresetInput = z.infer<typeof tablePresetInput>
type Field = Blueprint['tables'][number]['fields'][number]
export interface TablePreset {
  id: TablePresetId
  name: string
  description: string
  icon: EntityIconId
  fields: Field[]
}
type Label = [string, string]

// These are data recipes, not a second table engine. Stable keys are shared by UI and tools.
export function tablePresets(locale: 'zh-CN' | 'en' = 'zh-CN'): TablePreset[] {
  const text = (label: Label) => label[locale === 'en' ? 1 : 0]
  const field = (key: string, label: Label, type = 'text', options: Label[] = []): Field => ({
    key,
    name: text(label),
    type,
    required: false,
    options: options.map(text),
  })
  return [
    {
      id: 'general',
      name: text(['通用表', 'General']),
      icon: 'table',
      description: text([
        '从一个名称字段开始，自由添加内容。',
        'Start with a name field and build your own structure.',
      ]),
      fields: [field('name', ['名称', 'Name'])],
    },
    {
      id: 'users',
      name: text(['用户', 'Users']),
      icon: 'people',
      description: text([
        '头像、名称和联系方式，可继续关联账号与业务。',
        'Profiles and contact details, ready to link to accounts and business data.',
      ]),
      fields: [
        field('name', ['名称', 'Name']),
        field('avatar', ['头像', 'Avatar'], 'image'),
        field('phone', ['手机号', 'Phone'], 'phone'),
        field('email', ['邮箱', 'Email'], 'email'),
        field('status', ['状态', 'Status'], 'select', [
          ['正常', 'Active'],
          ['停用', 'Inactive'],
        ]),
      ],
    },
    {
      id: 'products',
      name: text(['商品', 'Products']),
      icon: 'cube',
      description: text([
        '统一管理课程、实物、游戏道具和服务。',
        'A shared catalog for courses, physical goods, game items and services.',
      ]),
      fields: [
        field('name', ['名称', 'Name']),
        field('cover', ['封面', 'Cover'], 'image'),
        field('kind', ['类型', 'Type'], 'select', [
          ['课程', 'Course'],
          ['实物', 'Physical goods'],
          ['游戏道具', 'Game item'],
          ['服务', 'Service'],
        ]),
        field('price', ['售价', 'Price'], 'currency'),
        field('currency', ['币种', 'Currency'], 'select', [
          ['CNY', 'CNY'],
          ['USD', 'USD'],
          ['HKD', 'HKD'],
        ]),
        field('status', ['状态', 'Status'], 'select', [
          ['草稿', 'Draft'],
          ['上架', 'Available'],
          ['下架', 'Unavailable'],
        ]),
      ],
    },
    {
      id: 'orders',
      name: text(['订单', 'Orders']),
      icon: 'reader',
      description: text([
        '一笔订单关联一个商品，直接记录数量与成交价。',
        'One product per order, with quantity and sale price in the order itself.',
      ]),
      fields: [
        field('number', ['订单号', 'Order number']),
        field('status', ['订单状态', 'Order status'], 'select', [
          ['草稿', 'Draft'],
          ['已确认', 'Confirmed'],
          ['已取消', 'Cancelled'],
          ['已完成', 'Completed'],
        ]),
        field('paymentStatus', ['支付状态', 'Payment status'], 'select', [
          ['未支付', 'Unpaid'],
          ['已支付', 'Paid'],
          ['部分退款', 'Partially refunded'],
          ['已退款', 'Refunded'],
        ]),
        field('currency', ['币种', 'Currency'], 'select', [
          ['CNY', 'CNY'],
          ['USD', 'USD'],
          ['HKD', 'HKD'],
        ]),
        field('quantity', ['数量', 'Quantity'], 'number'),
        field('unitPrice', ['成交单价', 'Unit price'], 'currency'),
        field('total', ['应付金额', 'Total'], 'currency'),
      ],
    },
  ]
}

export function presetBlueprint(input: TablePresetInput, projectId: string): Blueprint {
  const presets = tablePresets(input.locale)
  const selected = presets.find((preset) => preset.id === input.preset)!
  const en = input.locale === 'en'
  const tables: Array<Blueprint['tables'][number]> = [
    {
      key: selected.id,
      name: input.name ?? selected.name,
      description: input.description,
      icon: input.icon ?? selected.icon,
      fields: selected.fields,
    },
  ]
  const relations: Blueprint['relations'] = []
  if (input.preset === 'orders') {
    const orderName = tables[0].name
    for (const role of ['users', 'products'] as const) {
      const target = input.bindings[role]
      if (!target) {
        const preset = presets.find((p) => p.id === role)!
        tables.push({
          key: role,
          name: preset.name,
          icon: preset.icon,
          description: '',
          fields: preset.fields,
        })
      }
      relations.push({
        from: 'orders',
        key: role === 'users' ? 'customer' : 'product',
        name: role === 'users' ? (en ? 'Customer' : '购买用户') : en ? 'Product' : '商品',
        to: target?.tableId ?? role,
        targetVersion: target?.version,
        reverseName: orderName,
        multiple: false,
        inverseMultiple: true,
      })
    }
  }
  return blueprintInput.parse({
    schemaVersion: 1,
    requestId: input.requestId,
    project: { id: projectId },
    tables,
    relations,
  })
}
