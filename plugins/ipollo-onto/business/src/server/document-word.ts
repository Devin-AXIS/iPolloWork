import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  LevelFormat,
  AlignmentType,
  BorderStyle,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx'
import type { DocumentNode } from '../core/documents'
import type { DocumentScope } from './documents'
import { documentExportSource } from './document-export-source'

type Block = Paragraph | Table
const textOf = (n: DocumentNode): string => n.text ?? (n.content ?? []).map(textOf).join('')
const webUrl = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : undefined)

// The supported Word raster formats have small, deterministic size headers.
function imageSize(data: Buffer, type: string): [number, number] | undefined {
  if (type === 'png' && data.length >= 24) return [data.readUInt32BE(16), data.readUInt32BE(20)]
  if (type === 'gif' && data.length >= 10) return [data.readUInt16LE(6), data.readUInt16LE(8)]
  if (type === 'jpg') {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) break
      const marker = data[offset + 1],
        length = data.readUInt16BE(offset + 2)
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      )
        return [data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5)]
      if (length < 2) break
      offset += length + 2
    }
  }
}

export async function exportWordDocument(scope: DocumentScope, documentId: string) {
  const doc = await documentExportSource(scope, documentId, 'docx')
  const numbering: { reference: string; start: number }[] = []
  const inline = (nodes: DocumentNode[]): ParagraphChild[] =>
    nodes.flatMap((n): ParagraphChild[] => {
      if (n.type === 'hardBreak') return [new TextRun({ break: 1 })]
      if (n.type !== 'text') return inline(n.content ?? [])
      const marks = new Set(n.marks?.map((m) => m.type))
      const run = new TextRun({
        text: n.text ?? '',
        bold: marks.has('bold'),
        italics: marks.has('italic'),
        strike: marks.has('strike'),
        underline: marks.has('underline') ? {} : undefined,
        ...(marks.has('code') ? { font: 'Consolas', shading: { fill: 'F3F3F3' } } : {}),
      })
      const href = n.marks?.find((m) => m.type === 'link')?.attrs?.href
      return typeof href === 'string' && /^(https?:|mailto:)/i.test(href)
        ? [new ExternalHyperlink({ children: [run], link: href })]
        : [run]
    })
  const blocks = (nodes: DocumentNode[], depth = 0, width = 650): Block[] =>
    nodes.flatMap((n): Block[] => {
      const a = n.attrs ?? {},
        children = n.content ?? []
      if (['paragraph', 'heading', 'codeBlock'].includes(n.type)) {
        const level = Math.min(6, Math.max(1, Number(a.level) || 1))
        return [
          new Paragraph({
            children: inline(children),
            ...(n.type === 'heading'
              ? { heading: HeadingLevel[`HEADING_${level}` as keyof typeof HeadingLevel] }
              : {}),
            ...(n.type === 'codeBlock'
              ? {
                  run: { font: 'Consolas', size: 20 },
                  shading: { fill: 'F5F5F5' },
                  spacing: { before: 140, after: 180 },
                }
              : {}),
          }),
        ]
      }
      if (n.type === 'horizontalRule')
        return [
          new Paragraph({
            border: { bottom: { color: 'DDDDDD', size: 4, style: BorderStyle.SINGLE } },
          }),
        ]
      if (['bulletList', 'orderedList', 'taskList'].includes(n.type)) {
        const reference = `list-${numbering.length}`
        if (n.type === 'orderedList')
          numbering.push({ reference, start: Math.max(1, Number(a.start) || 1) })
        return children.flatMap((item) => {
          const content = item.content ?? [],
            first = content[0]
          const options: IParagraphOptions =
            n.type === 'orderedList'
              ? { numbering: { reference, level: Math.min(depth, 8) } }
              : n.type === 'bulletList'
                ? { bullet: { level: Math.min(depth, 8) } }
                : { indent: { left: 360 * (depth + 1), hanging: 280 } }
          return [
            new Paragraph({
              ...options,
              children: [
                ...(n.type === 'taskList'
                  ? [new TextRun(item.attrs?.checked ? '☑  ' : '☐  ')]
                  : []),
                ...inline(first?.type === 'paragraph' ? (first.content ?? []) : []),
              ],
            }),
            ...blocks(first?.type === 'paragraph' ? content.slice(1) : content, depth + 1, width),
          ]
        })
      }
      if (n.type === 'blockquote')
        return children.flatMap((child) =>
          child.type === 'paragraph'
            ? [
                new Paragraph({
                  children: inline(child.content ?? []),
                  indent: { left: 300 },
                  border: {
                    left: { color: 'D0D0D0', size: 12, style: BorderStyle.SINGLE, space: 12 },
                  },
                  run: { color: '666666' },
                }),
              ]
            : blocks([child], depth, width),
        )
      if (n.type === 'table') {
        const columns = Math.max(
          1,
          ...children.map((r) =>
            (r.content ?? []).reduce((sum, c) => sum + (Number(c.attrs?.colspan) || 1), 0),
          ),
        )
        if (!children.length) return []
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: children.map(
              (row) =>
                new TableRow({
                  tableHeader: row.content?.every((c) => c.type === 'tableHeader'),
                  children: (row.content ?? []).map((cell) => {
                    const columnSpan = Number(cell.attrs?.colspan) || 1
                    const cellBlocks = blocks(
                      cell.content ?? [],
                      depth,
                      Math.max(40, (width / columns) * columnSpan - 20),
                    )
                    return new TableCell({
                      columnSpan,
                      rowSpan: Number(cell.attrs?.rowspan) || 1,
                      width: { size: (100 / columns) * columnSpan, type: WidthType.PERCENTAGE },
                      margins: { top: 100, bottom: 100, left: 120, right: 120 },
                      shading: cell.type === 'tableHeader' ? { fill: 'F5F5F5' } : undefined,
                      children: !cellBlocks.length
                        ? [new Paragraph('')]
                        : cellBlocks.at(-1) instanceof Table
                          ? [...cellBlocks, new Paragraph('')]
                          : cellBlocks,
                    })
                  }),
                }),
            ),
          }),
          new Paragraph({ spacing: { after: 100 } }),
        ]
      }
      if (n.type === 'image') {
        const match = String(a.src).match(/^data:image\/(png|jpeg|gif);base64,(.+)$/s)
        if (match) {
          const data = Buffer.from(match[2], 'base64'),
            type = match[1] === 'jpeg' ? 'jpg' : (match[1] as 'png' | 'gif')
          const size = imageSize(data, type)
          if (size && size[0] > 0 && size[1] > 0) {
            const scale = Math.min(1, width / size[0], 900 / size[1])
            return [
              new Paragraph({
                children: [
                  new ImageRun({
                    type,
                    data,
                    transformation: {
                      width: Math.round(size[0] * scale),
                      height: Math.round(size[1] * scale),
                    },
                    altText: {
                      title: String(a.alt ?? '图片'),
                      description: String(a.alt ?? ''),
                      name: 'Image',
                    },
                  }),
                ],
              }),
            ]
          }
        }
        const url = webUrl(a.src)
        return [
          new Paragraph({
            children: url
              ? [
                  new ExternalHyperlink({
                    link: url,
                    children: [
                      new TextRun({ text: String(a.alt || '查看原始图片'), style: 'Hyperlink' }),
                    ],
                  }),
                ]
              : [new TextRun(String(a.alt || '[此图片格式请在原文中查看]'))],
          }),
        ]
      }
      if (n.type === 'video') {
        const url = webUrl(a.src)
        return [
          new Paragraph({
            children: url
              ? [
                  new ExternalHyperlink({
                    link: url,
                    children: [new TextRun({ text: '查看视频', style: 'Hyperlink' })],
                  }),
                ]
              : [new TextRun('[视频请在原文中播放]')],
          }),
        ]
      }
      return children.length
        ? blocks(children, depth, width)
        : n.text
          ? [new Paragraph(textOf(n))]
          : []
    })
  const body = blocks(doc.content.content)
  const word = new Document({
    creator: 'iPollo Onto',
    title: doc.title,
    styles: {
      default: {
        document: {
          run: {
            font: { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' },
            size: 22,
            color: '242424',
          },
          paragraph: { spacing: { after: 150, line: 320 } },
        },
        title: {
          run: { size: 48, bold: true },
          paragraph: { spacing: { after: 320 }, keepNext: true },
        },
        ...Object.fromEntries(
          [1, 2, 3, 4, 5, 6].map((level) => [
            `heading${level}`,
            {
              run: { size: [34, 29, 25, 24, 23, 22][level - 1], bold: true, color: '242424' },
              paragraph: { spacing: { before: 260, after: 130 }, keepNext: true },
            },
          ]),
        ),
      },
    },
    numbering: {
      config: numbering.map(({ reference, start }) => ({
        reference,
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          start,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 280 } } },
        })),
      })),
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1020, right: 1020, bottom: 1020, left: 1020 },
          },
        },
        children: [new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }), ...body],
      },
    ],
  })
  return { title: doc.title, bytes: await Packer.toBuffer(word) }
}
