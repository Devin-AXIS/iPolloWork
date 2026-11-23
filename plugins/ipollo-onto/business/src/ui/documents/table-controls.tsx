import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { DropdownMenu } from '@radix-ui/themes'
import { DotsHorizontalIcon, PlusIcon, TableIcon } from '@radix-ui/react-icons'
import type { Editor } from '@tiptap/core'
import { translate as tr, useLocale } from '../i18n'
import { tableActions } from './table-actions'

// Keep table controls outside the editable document and tied to the selected cell.
export function TableControls({
  editor,
  container,
}: {
  editor: Editor
  container: RefObject<HTMLDivElement | null>
}) {
  useLocale()
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const shell = container.current?.closest<HTMLElement>('[role="dialog"]')
  useEffect(() => {
    const scroll = container.current?.closest<HTMLElement>('.detail-scroll')
    let frame = 0
    function update() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const active = document.activeElement
        if (!menuOpen && active !== editor.view.dom && !active?.closest('.document-table-tools'))
          return setPosition(null)
        const { $from } = editor.state.selection
        let depth = $from.depth
        while (depth > 0 && $from.node(depth).type.name !== 'table') depth--
        if (!depth || container.current?.closest('[hidden]')) return setPosition(null)
        const node = editor.view.nodeDOM($from.before(depth))
        if (!(node instanceof HTMLElement)) return setPosition(null)
        const table = node.getBoundingClientRect()
        const bounds = scroll?.getBoundingClientRect()
        if (!bounds || table.bottom < bounds.top + 40 || table.top > bounds.bottom)
          return setPosition(null)
        const origin = shell?.getBoundingClientRect() ?? { left: 0, top: 0 }
        setPosition({
          top: Math.max(bounds.top + 4, table.top - 38) - origin.top,
          left: Math.max(bounds.left + 8, Math.min(table.left, bounds.right - 270)) - origin.left,
        })
      })
    }
    editor.on('transaction', update)
    document.addEventListener('focusin', update)
    scroll?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const observer = new ResizeObserver(update)
    if (container.current) observer.observe(container.current)
    update()
    return () => {
      cancelAnimationFrame(frame)
      editor.off('transaction', update)
      document.removeEventListener('focusin', update)
      scroll?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [editor, container, shell, menuOpen])
  if (!position || !shell) return null
  const actions = tableActions(editor)
  return createPortal(
    <div
      className="document-table-tools"
      role="toolbar"
      aria-label={tr('表格操作')}
      style={position}
      onMouseDown={(event) => event.preventDefault()}
    >
      <TableIcon />
      <button type="button" onClick={actions[1].run} title={actions[1].label}>
        <PlusIcon />
        {tr('添加行')}
      </button>
      <button type="button" onClick={actions[3].run} title={actions[3].label}>
        <PlusIcon />
        {tr('添加列')}
      </button>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger>
          <button type="button" aria-label={tr('更多表格操作')}>
            <DotsHorizontalIcon />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content size="1">
          {actions.map((action, i) => (
            <DropdownMenu.Item
              key={i}
              color={action.danger ? 'red' : undefined}
              onSelect={action.run}
            >
              {action.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>,
    shell,
  )
}
