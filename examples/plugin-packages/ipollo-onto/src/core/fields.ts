import { Registry } from './registry'
import { display, type FieldType } from './contracts'

export const fieldTypes = new Registry<FieldType>()
const text = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 100_000)
    throw new Error('请输入文本，最多 100,000 个字符')
  return value
}
const numeric = (value: unknown) => {
  const str = String(value)
  if (!/^-?\d{1,14}(\.\d{1,4})?$/.test(str))
    throw new Error('请输入有效数值，最多 14 位整数和 4 位小数')
  return str
}
const definitions: FieldType[] = [
  {
    id: 'text',
    label: '文本',
    category: 'basic',
    storage: 'text',
    input: 'text',
    validate: text,
    format: display,
  },
  {
    id: 'longtext',
    label: '长文本',
    category: 'basic',
    storage: 'text',
    input: 'textarea',
    validate: text,
    format: display,
  },
  {
    id: 'number',
    label: '数字',
    category: 'basic',
    storage: 'numeric',
    input: 'number',
    validate: numeric,
    format: display,
  },
  {
    id: 'currency',
    label: '金额',
    category: 'basic',
    storage: 'numeric',
    input: 'number',
    validate: numeric,
    format: (v) => {
      if (v == null) return ''
      const [integer, fraction] = String(v).split('.')
      return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '')
    },
  },
  {
    id: 'date',
    label: '日期',
    category: 'basic',
    storage: 'date',
    input: 'date',
    validate: (v) => {
      if (
        typeof v !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v
      )
        throw new Error('请输入有效日期')
      return v
    },
    format: display,
  },
  {
    id: 'boolean',
    label: '勾选',
    category: 'basic',
    storage: 'boolean',
    input: 'checkbox',
    validate: (v) => {
      if (typeof v !== 'boolean') throw new Error('勾选字段需要是或否')
      return v
    },
    format: (v) => (v === true ? '是' : v === false ? '否' : ''),
  },
  {
    id: 'select',
    label: '单选',
    category: 'basic',
    storage: 'text',
    input: 'select',
    validate: (v, f) => {
      if (typeof v !== 'string' || !f.options.includes(v))
        throw new Error(`请选择「${f.name}」中的有效选项`)
      return v
    },
    format: display,
  },
  {
    id: 'url',
    label: '链接',
    category: 'basic',
    storage: 'text',
    input: 'text',
    validate: (v) => {
      const str = text(v)
      const url = new URL(str)
      if (!['https:', 'http:'].includes(url.protocol))
        throw new Error('链接需要以 https:// 或 http:// 开头')
      return str
    },
    format: display,
  },
  {
    id: 'json',
    label: 'JSON',
    category: 'basic',
    storage: 'jsonb',
    input: 'json',
    validate: (v) => {
      const parsed: unknown = typeof v === 'string' ? JSON.parse(v) : v
      if (JSON.stringify(parsed).length > 100_000) throw new Error('JSON 内容过大')
      return parsed
    },
    format: display,
  },
]
definitions.forEach((d) => fieldTypes.register(d))
