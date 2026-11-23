import { z } from 'zod'
import { recordQueryInput } from './query'

export interface DocumentNode {
  type: string
  attrs?: Record<string, unknown>
  content?: DocumentNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}
export interface DocumentContent {
  type: 'doc'
  content: DocumentNode[]
}
export interface DocumentSummary {
  id: string
  projectId: string
  title: string
  version: number
  createdAt: string
  updatedAt: string
  linkedRecords: number
}
export interface RecordDocument extends DocumentSummary {
  content: DocumentContent
  schemaVersion: 1
}
// JSONB may reorder object keys. Equality must not reset the editor/caret after every save.
export function documentValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false
  const left = Object.keys(a),
    right = Object.keys(b)
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.hasOwn(b, key) &&
        documentValueEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    )
  )
}
export const emptyDocument = (): DocumentContent => ({ type: 'doc', content: [] })
export const embedInput = z
  .object({
    tableId: z.uuid(),
    viewId: z.uuid().optional(),
    selection: recordQueryInput.optional(),
    recordId: z.uuid().optional(),
    relationFieldId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (v) =>
      !(v.viewId && v.selection) &&
      !(v.recordId && (v.viewId || v.selection)) &&
      !(v.relationFieldId && (!v.recordId || v.viewId || v.selection)),
    '表格引用条件不兼容',
  )
export type TableEmbed = z.infer<typeof embedInput>
const types = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'text',
  'image',
  'dataTable',
  'video',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
])
const marks = new Set(['bold', 'italic', 'strike', 'code', 'link', 'underline'])
export function safeDocumentUrl(value: unknown, image = false): boolean {
  if (typeof value !== 'string' || value.length > 4096) return false
  if (
    /^\/api\/projects\/[a-f0-9-]+\/document-(?:images|media)\/[a-f0-9]{64}\.(png|jpg|webp|gif|mp4|webm)$/.test(
      value,
    )
  )
    return image
  try {
    return (image ? ['https:', 'http:'] : ['https:', 'http:', 'mailto:']).includes(
      new URL(value).protocol,
    )
  } catch {
    return false
  }
}
// Keep an explicit, bounded content contract at both human and AI write boundaries.
export function validateContent(raw: unknown): raw is DocumentContent {
  if (!raw || typeof raw !== 'object') return false
  const root = raw as DocumentContent
  if (
    root.type !== 'doc' ||
    !Array.isArray(root.content) ||
    new TextEncoder().encode(JSON.stringify(root)).byteLength > 500_000
  )
    return false
  let count = 0
  const ids = new Set<string>()
  const blocks = new Set([
    'paragraph',
    'heading',
    'bulletList',
    'orderedList',
    'taskList',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'image',
    'dataTable',
    'video',
    'table',
  ])
  if (root.content.some((n) => !n || !blocks.has(n.type))) return false
  const visit = (n: DocumentNode, depth: number): boolean => {
    if (!n || typeof n !== 'object' || ++count > 5000 || depth > 12 || !types.has(n.type))
      return false
    if (n.text !== undefined && (n.type !== 'text' || typeof n.text !== 'string')) return false
    if (n.type === 'text' && (!n.text || n.content)) return false
    if (
      n.attrs !== undefined &&
      (!n.attrs || typeof n.attrs !== 'object' || Array.isArray(n.attrs))
    )
      return false
    if (n.content) {
      const inline = ['paragraph', 'heading'].includes(n.type)
      const allowed =
        n.type === 'table'
          ? new Set(['tableRow'])
          : n.type === 'tableRow'
            ? new Set(['tableCell', 'tableHeader'])
            : ['tableCell', 'tableHeader'].includes(n.type)
              ? new Set([
                  'paragraph',
                  'heading',
                  'bulletList',
                  'orderedList',
                  'taskList',
                  'blockquote',
                  'codeBlock',
                ])
              : inline
                ? new Set(['text', 'hardBreak'])
                : n.type === 'codeBlock'
                  ? new Set(['text'])
                  : ['bulletList', 'orderedList'].includes(n.type)
                    ? new Set(['listItem'])
                    : n.type === 'taskList'
                      ? new Set(['taskItem'])
                      : ['listItem', 'taskItem', 'blockquote'].includes(n.type)
                        ? blocks
                        : new Set<string>()
      if (n.content.some((child) => !child || !allowed.has(child.type))) return false
    }
    if (
      ['bulletList', 'orderedList', 'taskList', 'blockquote'].includes(n.type) &&
      !n.content?.length
    )
      return false
    if (['listItem', 'taskItem'].includes(n.type) && n.content?.[0]?.type !== 'paragraph')
      return false
    if (n.marks?.length && !['text', 'hardBreak'].includes(n.type)) return false
    const a = n.attrs ?? {}
    if (a.id != null) {
      if (typeof a.id !== 'string' || !/^[\w-]{1,80}$/.test(a.id) || ids.has(a.id)) return false
      ids.add(a.id)
    }
    if (n.type === 'heading' && ![1, 2, 3].includes(Number(a.level))) return false
    if (['image', 'video'].includes(n.type) && !safeDocumentUrl(a.src, true)) return false
    if (['table', 'tableRow', 'tableCell', 'tableHeader'].includes(n.type) && !n.content?.length)
      return false
    if (n.type === 'table' && n.content!.length > 100) return false
    if (n.type === 'tableRow' && n.content!.length > 30) return false
    if (['tableCell', 'tableHeader'].includes(n.type)) {
      if (
        ['colspan', 'rowspan'].some(
          (key) =>
            a[key] != null &&
            (!Number.isInteger(a[key]) || Number(a[key]) < 1 || Number(a[key]) > 100),
        )
      )
        return false
      if (
        a.colwidth != null &&
        (!Array.isArray(a.colwidth) ||
          a.colwidth.length > 30 ||
          a.colwidth.some((w) => !Number.isFinite(w) || w < 0 || w > 2000))
      )
        return false
    }
    if (n.type === 'dataTable') {
      const { id: _id, ...config } = a
      if (!embedInput.safeParse(config).success) return false
    }
    if (
      n.marks &&
      (!Array.isArray(n.marks) ||
        n.marks.some(
          (m) => !m || !marks.has(m.type) || (m.type === 'link' && !safeDocumentUrl(m.attrs?.href)),
        ))
    )
      return false
    return !n.content || (Array.isArray(n.content) && n.content.every((c) => visit(c, depth + 1)))
  }
  return root.content.every((n) => visit(n, 0))
}
const rawNodeInput = z
  .object({
    type: z.enum([
      'paragraph',
      'heading',
      'bulletList',
      'orderedList',
      'listItem',
      'taskList',
      'taskItem',
      'blockquote',
      'codeBlock',
      'horizontalRule',
      'hardBreak',
      'text',
      'image',
      'dataTable',
      'video',
      'table',
      'tableRow',
      'tableCell',
      'tableHeader',
    ]),
    attrs: z.record(z.string(), z.json()).optional(),
    text: z.string().optional(),
    content: z.array(z.json()).optional(),
    marks: z
      .array(
        z.object({ type: z.string(), attrs: z.record(z.string(), z.json()).optional() }).strict(),
      )
      .optional(),
  })
  .strict()
const nodeInput = rawNodeInput.refine(
  (v) => validateContent({ type: 'doc', content: [v] }),
  '内容块不符合结构',
) as z.ZodType<DocumentNode>
export const documentContentInput = z
  .object({ type: z.literal('doc'), content: z.array(rawNodeInput).max(5000) })
  .strict()
  .refine(validateContent, '文档内容不符合结构或超过限制') as z.ZodType<DocumentContent>
export const documentCreateInput = z
  .object({
    id: z.uuid().optional().describe('Client-generated ID. Repeated identical creation is safe.'),
    title: z.string().trim().min(1).max(160).default('文档'),
    content: documentContentInput.default(emptyDocument),
  })
  .strict()
export const documentUpdateInput = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(160).optional(),
    content: documentContentInput.optional(),
    operations: z
      .array(
        z.discriminatedUnion('op', [
          z
            .object({ op: z.literal('append'), blocks: z.array(nodeInput).min(1).max(100) })
            .strict(),
          z
            .object({
              op: z.literal('replace'),
              blockId: z.string().min(1).max(80),
              block: nodeInput,
            })
            .strict(),
          z.object({ op: z.literal('remove'), blockId: z.string().min(1).max(80) }).strict(),
        ]),
      )
      .min(1)
      .max(100)
      .optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.title || v.content || v.operations) && !(v.content && v.operations),
    '请选择正文或内容块操作',
  )
export function applyDocumentOperations(
  content: DocumentContent,
  operations: NonNullable<z.infer<typeof documentUpdateInput>['operations']>,
): DocumentContent {
  const result = structuredClone(content)
  for (const op of operations) {
    if (op.op === 'append') {
      result.content.push(...op.blocks)
      continue
    }
    const find = (nodes: DocumentNode[]): boolean => {
      const index = nodes.findIndex((n) => n.attrs?.id === op.blockId)
      if (index >= 0) {
        if (op.op === 'remove') nodes.splice(index, 1)
        else nodes.splice(index, 1, { ...op.block, attrs: { ...op.block.attrs, id: op.blockId } })
        return true
      }
      return nodes.some((n) => n.content && find(n.content))
    }
    if (!find(result.content)) throw new Error('内容块不存在，请重新读取文档')
  }
  return documentContentInput.parse(result)
}
export function visitDocument(content: DocumentContent, visit: (n: DocumentNode) => void) {
  const walk = (nodes: DocumentNode[]) =>
    nodes.forEach((n) => {
      visit(n)
      if (n.content) walk(n.content)
    })
  walk(content.content)
}
export function documentText(content: DocumentContent): string {
  const text = (n: DocumentNode): string =>
    n.text ??
    (n.type === 'dataTable'
      ? '[表格引用]'
      : (n.content?.map(text).join(n.type === 'paragraph' || n.type === 'heading' ? '' : '\n') ??
        ''))
  return content.content.map(text).join('\n\n')
}
