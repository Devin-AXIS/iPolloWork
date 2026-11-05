import { documentImage } from './document-files'
import { getDocument, documentTable, type DocumentScope } from './documents'
import { embedInput, type DocumentNode } from '../core/documents'
import { display } from '../core/contracts'

const paragraph = (text: string): DocumentNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

/** Resolve only blocks explicitly present in the document, within its existing scope. */
export async function documentExportSource(
  scope: DocumentScope,
  documentId: string,
  format: 'html' | 'docx',
) {
  const doc = await getDocument(scope, documentId)
  const resolve = async (n: DocumentNode): Promise<DocumentNode[]> => {
    const a = n.attrs ?? {}
    if (n.type === 'dataTable') {
      const { id: _id, ...config } = a
      try {
        const data = await documentTable(scope, embedInput.parse(config))
        return [
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: data.table.name }],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: data.fields.map((f) => ({
                  type: 'tableHeader',
                  content: [paragraph(f.name)],
                })),
              },
              ...data.records.map((r) => ({
                type: 'tableRow',
                content: data.fields.map((f) => ({
                  type: 'tableCell',
                  content: [paragraph(display(r.values[f.id]))],
                })),
              })),
            ],
          },
          paragraph(`导出时的数据快照 · ${data.records.length} / ${data.total}`),
        ]
      } catch {
        return [paragraph('[引用表格不可用]')]
      }
    }
    if (n.type === 'image' || (n.type === 'video' && format === 'html')) {
      const local = String(a.src).match(
        /^\/api\/projects\/([a-f0-9-]+)\/document-(?:images|media)\/(.+)$/,
      )
      if (local) {
        if (local[1] !== doc.projectId) return [paragraph('[媒体不可用]')]
        try {
          const media = await documentImage(doc.projectId, local[2])
          return [
            {
              ...n,
              attrs: { ...a, src: `data:${media.mime};base64,${media.bytes.toString('base64')}` },
            },
          ]
        } catch {
          return [paragraph('[媒体不可用]')]
        }
      }
    }
    return [
      {
        ...n,
        ...(n.content ? { content: (await Promise.all(n.content.map(resolve))).flat() } : {}),
      },
    ]
  }
  return {
    ...doc,
    content: {
      ...doc.content,
      content: (await Promise.all(doc.content.content.map(resolve))).flat(),
    },
  }
}
