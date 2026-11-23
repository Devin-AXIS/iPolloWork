import type { Editor } from '@tiptap/core'
import { translate as tr } from '../i18n'

export function tableActions(editor: Editor) {
  return [
    { label: tr('在上方添加行'), run: () => editor.chain().focus().addRowBefore().run() },
    { label: tr('在下方添加行'), run: () => editor.chain().focus().addRowAfter().run() },
    { label: tr('在左侧添加列'), run: () => editor.chain().focus().addColumnBefore().run() },
    { label: tr('在右侧添加列'), run: () => editor.chain().focus().addColumnAfter().run() },
    { label: tr('切换表头'), run: () => editor.chain().focus().toggleHeaderRow().run() },
    { label: tr('删除当前行'), danger: true, run: () => editor.chain().focus().deleteRow().run() },
    {
      label: tr('删除当前列'),
      danger: true,
      run: () => editor.chain().focus().deleteColumn().run(),
    },
    { label: tr('删除表格'), danger: true, run: () => editor.chain().focus().deleteTable().run() },
  ]
}
