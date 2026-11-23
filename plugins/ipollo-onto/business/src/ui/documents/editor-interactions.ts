import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

export function slashMatch(text: string, cursor: number) {
  const match = text.match(/(?:^|\s)\/([\p{L}\p{N}_-]{0,32})$/u)
  return match
    ? { from: cursor - match[1].length - 1, to: cursor, query: match[1].toLowerCase() }
    : null
}
export interface OverlayAnchor {
  left: number
  right: number
  top: number
  bottom: number
}
// Same placement rules as the host Markdown editor: stay inside the sheet, flip above when needed.
export function overlayPosition(
  anchor: OverlayAnchor,
  bounds: OverlayAnchor,
  width: number,
  height: number,
  center = false,
) {
  const w = Math.min(width, Math.max(0, bounds.right - bounds.left - 16))
  const below = bounds.bottom - anchor.bottom - 8,
    above = anchor.top - bounds.top - 8
  const up = (center && above >= height) || (below < height && above > below)
  const h = Math.min(height, Math.max(80, up ? above : below), bounds.bottom - bounds.top - 16)
  const x = center ? (anchor.left + anchor.right - w) / 2 : anchor.left
  return {
    left: Math.max(bounds.left + 8, Math.min(x, bounds.right - w - 8)),
    top: up
      ? Math.max(bounds.top + 8, anchor.top - h - 6)
      : Math.min(anchor.bottom + 6, bounds.bottom - h - 8),
    width: w,
    maxHeight: h,
  }
}
export interface EditorBlock {
  id: string
  pos: number
  node: ProseMirrorNode
}
export function editorBlocks(editor: Editor): EditorBlock[] {
  const blocks: EditorBlock[] = []
  editor.state.doc.forEach((node, pos) => {
    if (node.attrs.id) blocks.push({ id: String(node.attrs.id), pos, node })
  })
  return blocks
}
export function moveEditorBlock(editor: Editor, id: string, target: number) {
  const block = editorBlocks(editor).find((b) => b.id === id)
  if (!block || (target >= block.pos && target <= block.pos + block.node.nodeSize)) return
  const tr = editor.state.tr.delete(block.pos, block.pos + block.node.nodeSize)
  const at = tr.mapping.map(target)
  tr.insert(at, block.node)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size))))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
}
