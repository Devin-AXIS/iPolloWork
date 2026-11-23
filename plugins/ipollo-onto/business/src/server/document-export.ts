import { documentExportSource } from './document-export-source'
import type { DocumentScope } from './documents'
import type { DocumentNode } from '../core/documents'
const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
export async function exportDocument(scope: DocumentScope, documentId: string) {
  const doc = await documentExportSource(scope, documentId, 'html')
  const node = async (n: DocumentNode): Promise<string> => {
    const a = n.attrs ?? {}
    if (n.type === 'text') {
      let text = escape(n.text)
      for (const m of n.marks ?? []) {
        if (m.type === 'link')
          text = `<a href="${escape(m.attrs?.href)}" rel="noreferrer">${text}</a>`
        else {
          const tag = (
            { bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code' } as Record<
              string,
              string
            >
          )[m.type]
          if (tag) text = `<${tag}>${text}</${tag}>`
        }
      }
      return text
    }
    if (['image', 'video'].includes(n.type)) {
      const src = String(a.src)
      if (n.type === 'video')
        return `<figure><video controls playsinline preload="metadata" src="${escape(src)}"></video></figure>`
      return `<figure><img src="${escape(src)}" alt="${escape(a.alt)}"></figure>`
    }
    if (n.type === 'horizontalRule') return '<hr>'
    if (n.type === 'hardBreak') return '<br>'
    const body = (await Promise.all((n.content ?? []).map(node))).join('')
    if (n.type === 'table') return `<section class="table"><table>${body}</table></section>`
    if (['tableCell', 'tableHeader'].includes(n.type)) {
      const tag = n.type === 'tableHeader' ? 'th' : 'td'
      return `<${tag} colspan="${Number(a.colspan) || 1}" rowspan="${Number(a.rowspan) || 1}">${body}</${tag}>`
    }
    if (n.type === 'heading') return `<h${a.level}>${body}</h${a.level}>`
    if (n.type === 'codeBlock') return `<pre><code>${body}</code></pre>`
    if (n.type === 'taskItem') return `<li>${a.checked ? '☑' : '☐'} ${body}</li>`
    const tag =
      (
        {
          paragraph: 'p',
          tableRow: 'tr',
          bulletList: 'ul',
          orderedList: 'ol',
          listItem: 'li',
          taskList: 'ul',
          blockquote: 'blockquote',
        } as Record<string, string>
      )[n.type] ?? 'div'
    return `<${tag}${n.type === 'orderedList' ? ` start="${Number(a.start) || 1}"` : n.type === 'taskList' ? ' class="task-list"' : ''}>${body}</${tag}>`
  }
  const body = (await Promise.all(doc.content.content.map(node))).join('\n')
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; media-src data: https: http:; style-src 'unsafe-inline'"><title>${escape(doc.title)}</title><style>body{font:16px/1.8 system-ui,sans-serif;color:#242424;background:#fff;max-width:800px;padding:48px 24px;margin:auto}h1{font-size:32px;line-height:1.3}small{color:#888}img,video{max-width:100%;border-radius:8px}blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:18px;color:#666}pre{overflow:auto;padding:16px;background:#f6f6f6;border-radius:8px}.table{overflow:auto}p{orphans:3;widows:3}h1,h2,h3,h4,h5,h6{break-after:avoid}img,video,tr{break-inside:avoid}td p,th p{margin:0}pre{white-space:pre-wrap;overflow-wrap:anywhere}td,th{overflow-wrap:anywhere}.task-list{list-style:none;padding-left:0}.task-list li>p:first-child{display:inline}thead{display:table-header-group}table{table-layout:fixed}@page{size:A4;margin:18mm}@media print{body{max-width:none;padding:0;margin:0;font-size:11pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}.table{overflow:visible}img,video{max-height:240mm;object-fit:contain}a{color:inherit}pre{overflow:visible}h1{font-size:25pt}}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;border-bottom:1px solid #eee;padding:9px;vertical-align:top}a{color:#5358ad}hr{border:0;border-top:1px solid #eee;margin:24px 0}</style><article><h1>${escape(doc.title)}</h1>${body}</article></html>`
  return { html, title: doc.title }
}
