import { useEffect, useRef, useState } from 'react'

import {
  EditorContent,
  useEditor,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { Node, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import UniqueID from '@tiptap/extension-unique-id'
import { TableKit } from '@tiptap/extension-table'
import { VideoNode } from './media-blocks'
import { documentValueEqual, type DocumentContent, type TableEmbed } from '../../core/documents'
import type { TableData } from '../../core/contracts'
import { translate as tr, useLocale } from '../i18n'
import { api, message } from '../api'
import { ErrorNotice } from '../components/primitives'
import { DocumentTable } from './document-table'
import DocumentOverlays from './document-overlays'
import { TableControls } from './table-controls'

function EmbeddedTable(props: NodeViewProps) {
  const { id: _id, ...values } = props.node.attrs
  const config = Object.fromEntries(
    Object.entries(values).filter(([, v]) => v != null),
  ) as TableEmbed
  return (
    <NodeViewWrapper
      className={`document-embed-node ${props.selected ? 'is-selected' : ''}`}
      contentEditable={false}
    >
      <DocumentTable
        base={props.extension.options.base}
        config={config}
        onOpen={props.extension.options.onOpen}
      />
    </NodeViewWrapper>
  )
}
const DataTableNode = Node.create({
  name: 'dataTable',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() {
    return {
      base: '',
      onOpen: undefined as undefined | ((tableId: string, recordId: string) => void),
    }
  },
  addAttributes() {
    return {
      tableId: { default: null },
      viewId: { default: null },
      selection: { default: null },
      recordId: { default: null },
      relationFieldId: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-table-reference]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-table-reference': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbeddedTable, {
      // A click may target a button's text/icon. Keep those events in the control,
      // instead of letting ProseMirror refocus the document and dismiss its popover.
      stopEvent: ({ event }) =>
        event.target instanceof Element &&
        Boolean(event.target.closest('button, input, select, textarea, [role="separator"]')) &&
        !event.type.startsWith('drag') &&
        event.type !== 'drop',
    })
  },
})
export function cleanEditorContent(raw: unknown): DocumentContent {
  // Tiptap uses null defaults; the public content contract uses absent optional attributes.
  return JSON.parse(
    JSON.stringify(raw, (_key, v) => (v === null ? undefined : v)),
  ) as DocumentContent
}
export default function DocumentEditor({
  content,
  focusBlockId,
  onChange,
  base,
  documentId,
  projectId,
  tableId,
  recordId,
  relations,
  onOpen,
  onBlur,
}: {
  content: DocumentContent
  focusBlockId?: string
  onChange: (content: DocumentContent) => void
  base: string
  documentId: string
  projectId: string
  tableId: string
  recordId: string
  relations: TableData['fields']
  onOpen: (tableId: string, recordId: string) => void
  onBlur: () => void
}) {
  useLocale()
  const [error, setError] = useState(''),
    [uploading, setUploading] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const keyboard = useRef<((event: KeyboardEvent) => boolean) | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const mediaKind = useRef<'image' | 'video'>('image')
  const callback = useRef(onChange)
  callback.current = onChange
  const blur = useRef(onBlur)
  blur.current = onBlur
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      Placeholder.configure({ placeholder: () => tr('输入 / 插入内容'), showOnlyCurrent: true }),
      Image.configure({ allowBase64: false }),
      VideoNode,
      TableKit.configure({
        table: {
          resizable: true,
          cellMinWidth: 90,
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      UniqueID.configure({
        types: [
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
          'image',
          'dataTable',
          'video',
          'table',
          'tableRow',
          'tableCell',
          'tableHeader',
        ],
      }),
      DataTableNode.configure({ base, onOpen }),
    ],
    content,
    immediatelyRender: false,
    autofocus: content.content.length ? false : 'start',
    editorProps: {
      attributes: {
        class: 'document-prose',
        role: 'textbox',
        'aria-label': tr('文档正文'),
        'aria-multiline': 'true',
      },
      handleKeyDown: (_view, event) => keyboard.current?.(event) ?? false,
    },
    onUpdate: ({ editor: e }) => callback.current(cleanEditorContent(e.getJSON())),
    onBlur: () => blur.current(),
  })
  const lastContent = useRef(content)
  useEffect(() => {
    if (!editor || lastContent.current === content) return
    lastContent.current = content
    const current = cleanEditorContent(editor.getJSON())
    if (!documentValueEqual(current, content))
      editor.commands.setContent(content, { emitUpdate: false })
  }, [content, editor])
  async function upload(selected: File) {
    if (!editor) return
    setError('')
    setUploading(true)
    try {
      const video = mediaKind.current === 'video'
      if (selected.size > (video ? 25_000_000 : 5_000_000))
        throw new Error(video ? tr('视频最大为 25 MB') : tr('图片最大为 5 MB'))
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = () => reject(new Error(tr('图片读取失败')))
        reader.readAsDataURL(selected)
      })
      const result = await api<{ src: string }>(
        `${base}/${documentId}/${video ? 'media' : 'images'}`,
        'POST',
        { data },
      )
      if (video)
        editor
          .chain()
          .focus()
          .insertContent([{ type: 'video', attrs: { src: result.src } }, { type: 'paragraph' }])
          .run()
      else editor.chain().focus().setImage({ src: result.src, alt: selected.name }).run()
    } catch (e) {
      setError(message(e))
    } finally {
      setUploading(false)
      if (file.current) file.current.value = ''
    }
  }
  useEffect(() => {
    if (!editor || !focusBlockId) return
    const frame = requestAnimationFrame(() => {
      const element = editor.view.dom.querySelector(`[data-id="${CSS.escape(focusBlockId)}"]`)
      element?.scrollIntoView({ block: 'center', behavior: 'instant' })
      element?.classList.add('onto-focus-block')
    })
    return () => cancelAnimationFrame(frame)
  }, [editor, focusBlockId])
  if (!editor) return null
  return (
    <div className="document-editor" ref={container}>
      <ErrorNotice error={error} />
      {uploading && <p className="form-hint">{tr('正在上传…')}</p>}
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void upload(e.target.files[0])
        }}
      />
      <EditorContent editor={editor} />
      <TableControls editor={editor} container={container} />
      <DocumentOverlays
        editor={editor}
        container={container}
        keyboard={keyboard}
        onUpload={(kind) => {
          mediaKind.current = kind
          if (file.current) {
            file.current.accept =
              kind === 'video'
                ? 'video/mp4,video/webm'
                : 'image/png,image/jpeg,image/gif,image/webp'
            file.current.click()
          }
        }}
        projectId={projectId}
        tableId={tableId}
        recordId={recordId}
        relations={relations}
      />
    </div>
  )
}
