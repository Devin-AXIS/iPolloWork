import { fieldTypes } from '../core/fields'
import { display, type FieldType } from '../core/contracts'

const validateText = (v: unknown) =>
  fieldTypes.get('text').validate(v, { name: '', options: [] }) as string
const date = (v: unknown) => fieldTypes.get('date').validate(v, { name: '', options: [] }) as string
function stringList(v: unknown): string[] {
  const list =
    typeof v === 'string'
      ? v
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : v
  if (
    !Array.isArray(list) ||
    list.length > 100 ||
    list.some((s) => typeof s !== 'string' || !s.trim() || s.length > 80)
  )
    throw new Error('最多 100 个内容，每项 1–80 个字符')
  return [...new Set(list.map((s) => s.trim()))]
}
const definitions: Array<
  Omit<FieldType, 'category' | 'format'> & { format?: FieldType['format'] }
> = [
  {
    id: 'email',
    label: '邮箱',
    group: 'text',
    storage: 'text',
    input: 'text',
    validate(v) {
      const s = validateText(v).trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 254) throw new Error('请输入有效邮箱')
      return s
    },
  },
  {
    id: 'phone',
    label: '电话',
    group: 'text',
    storage: 'text',
    input: 'text',
    validate(v) {
      const s = validateText(v).trim()
      if (!/^\+?[\d ()-]{5,30}$/.test(s) || s.replace(/\D/g, '').length < 5)
        throw new Error('请输入有效电话号码')
      return s
    },
  },
  {
    id: 'multiselect',
    label: '多选',
    group: 'choice',
    storage: 'jsonb',
    input: 'multiselect',
    validate(v, f) {
      const list = stringList(v)
      if (list.some((s) => !f.options.includes(s)))
        throw new Error(`请选择「${f.name}」中的有效选项`)
      return list
    },
    format: (v) => (Array.isArray(v) ? v.join(' · ') : ''),
  },
  {
    id: 'tags',
    label: '标签',
    group: 'choice',
    storage: 'jsonb',
    input: 'tags',
    validate: stringList,
    format: (v) => (Array.isArray(v) ? v.join(' · ') : ''),
  },
  {
    id: 'datetime',
    label: '日期时间',
    group: 'date',
    storage: 'text',
    input: 'datetime',
    description: '保存带时区的时间点',
    validate(v) {
      const s = validateText(v)
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(s) ||
        !Number.isFinite(Date.parse(s))
      )
        throw new Error('日期时间需要包含时区，例如 2026-09-10T09:00:00+08:00')
      date(s.slice(0, 10))
      return new Date(s).toISOString()
    },
    format: (v) => (v ? new Date(String(v)).toLocaleString('zh-CN', { hour12: false }) : ''),
  },
  {
    id: 'time',
    label: '时间',
    group: 'date',
    storage: 'text',
    input: 'time',
    validate(v) {
      const s = validateText(v)
      if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s)) throw new Error('请输入有效时间')
      return s
    },
  },
  {
    id: 'daterange',
    label: '日期区间',
    group: 'date',
    storage: 'jsonb',
    input: 'daterange',
    validate(v) {
      if (typeof v !== 'object' || !v || !('start' in v) || !('end' in v))
        throw new Error('请填写开始和结束日期')
      const start = date(v.start),
        end = date(v.end)
      if (start > end) throw new Error('结束日期不能早于开始日期')
      return { start, end }
    },
    format: (v) =>
      v && typeof v === 'object' && 'start' in v && 'end' in v ? `${v.start} → ${v.end}` : '',
  },
  {
    id: 'rating',
    label: '评分',
    group: 'number',
    storage: 'numeric',
    input: 'number',
    description: '0–5 的整数评分',
    validate(v) {
      if (!/^[0-5]$/.test(String(v))) throw new Error('评分需要是 0 到 5 的整数')
      return String(v)
    },
    format: (v) => (v == null ? '' : `${'★'.repeat(Number(v))}${'☆'.repeat(5 - Number(v))}`),
  },
  {
    id: 'progress',
    label: '进度',
    group: 'number',
    storage: 'numeric',
    input: 'number',
    validate: (v) => fieldTypes.get('percentage').validate(v, { name: '进度', options: [] }),
    format: (v) => (v == null ? '' : `${v}%`),
  },
  ...(['image', 'file'] as const).map((id) => ({
    id,
    label: id === 'image' ? '图片引用' : '文件引用',
    group: 'media' as const,
    description: '保存已有文件的 HTTP(S) 地址；不上传文件',
    storage: 'text' as const,
    input: 'text' as const,
    validate: (v: unknown) => fieldTypes.get('url').validate(v, { name: '', options: [] }),
  })),
]
definitions.forEach((d) => fieldTypes.register({ category: 'extended', format: display, ...d }))
