import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { DropdownMenu, Button } from '@radix-ui/themes'
import {
  FontBoldIcon,
  FontItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  CodeIcon,
  Link2Icon,
  PlusIcon,
  DragHandleDots2Icon,
  TextIcon,
  HeadingIcon,
  ListBulletIcon,
  CheckboxIcon,
  QuoteIcon,
  MinusIcon,
  ImageIcon,
  TableIcon,
  CopyIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  VideoIcon,
} from '@radix-ui/react-icons'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { TableData } from '../../core/contracts'
import type { DocumentNode } from '../../core/documents'
import { translate as tr, useLocale } from '../i18n'
import { MediaInsertPicker } from './media-blocks'
import { TableReferencePicker } from './document-table'
import { tableActions } from './table-actions'
import {
  editorBlocks,
  moveEditorBlock,
  overlayPosition,
  slashMatch,
  type EditorBlock,
  type OverlayAnchor,
} from './editor-interactions'

type Slash = NonNullable<ReturnType<typeof slashMatch>> & { anchor: OverlayAnchor }
type Command = {
  id: string
  label: string
  description: string
  aliases: string
  icon: typeof TextIcon
  badge?: string
  run: () => void
}
export default function DocumentOverlays({
  editor,
  container,
  keyboard,
  onUpload,
  projectId,
  tableId,
  recordId,
  relations,
}: {
  editor: Editor
  container: RefObject<HTMLDivElement | null>
  keyboard: RefObject<((event: KeyboardEvent) => boolean) | null>
  onUpload: (kind: 'image' | 'video') => void
  projectId: string
  tableId: string
  recordId: string
  relations: TableData['fields']
}) {
  useLocale()
  const [slash, setSlash] = useState<Slash | null>(null),
    [active, setActive] = useState(0),
    [bubble, setBubble] = useState<OverlayAnchor | null>(null),
    [hover, setHover] = useState<{ id: string; top: number } | null>(null),
    [blockMenu, setBlockMenu] = useState(false),
    [reference, setReference] = useState<OverlayAnchor | null>(null),
    [media, setMedia] = useState<{ kind: 'image' | 'video'; anchor: OverlayAnchor } | null>(null),
    [link, setLink] = useState<OverlayAnchor | null>(null),
    [href, setHref] = useState(''),
    [linkError, setLinkError] = useState(''),
    [drop, setDrop] = useState<{ at: number; top: number } | null>(null)
  const [revision, setRevision] = useState(0)
  const dismissed = useRef<number | null>(null),
    slashRef = useRef(slash),
    activeRef = useRef(active),
    commandsRef = useRef<Command[]>([]),
    menuRef = useRef<HTMLDivElement>(null),
    moving = useRef<string | null>(null),
    hoverRef = useRef(hover),
    blockMenuRef = useRef(blockMenu)
  slashRef.current = slash
  activeRef.current = active
  hoverRef.current = hover
  blockMenuRef.current = blockMenu
  const shell = container.current?.closest<HTMLElement>('[role="dialog"]')
  const scroll = container.current?.closest<HTMLElement>('.detail-scroll')
  const bounds = scroll?.getBoundingClientRect() ?? {
    left: 0,
    right: window.innerWidth,
    top: 0,
    bottom: window.innerHeight,
  }
  const origin = shell?.getBoundingClientRect() ?? { left: 0, top: 0 }
  const place = (anchor: OverlayAnchor, width: number, height: number, center = false) => {
    const p = overlayPosition(anchor, bounds, width, height, center)
    return { ...p, left: p.left - origin.left, top: p.top - origin.top }
  }
  const command = (action: () => void) => {
    const current = slashRef.current
    if (current) editor.chain().focus().deleteRange({ from: current.from, to: current.to }).run()
    setSlash(null)
    dismissed.current = null
    action()
  }
  const showMedia = (kind: 'image' | 'video') => {
    const anchor = slashRef.current?.anchor ?? editor.view.coordsAtPos(editor.state.selection.from)
    command(() => setMedia({ kind, anchor }))
  }
  const commands: Command[] = [
    {
      id: 'text',
      label: tr('正文'),
      description: tr('从一段普通文字开始。'),
      aliases: 'text plain paragraph zhengwen 正文 文本',
      icon: TextIcon,
      run: () => command(() => editor.chain().focus().setParagraph().run()),
    },
    {
      id: 'h1',
      label: tr('标题 1'),
      description: tr('醒目的大标题。'),
      aliases: 'heading h1 title 标题 大标题',
      icon: HeadingIcon,
      badge: '1',
      run: () => command(() => editor.chain().focus().setHeading({ level: 1 }).run()),
    },
    {
      id: 'h2',
      label: tr('标题 2'),
      description: tr('用于划分内容的小标题。'),
      aliases: 'heading h2 subtitle 标题 小标题',
      icon: HeadingIcon,
      badge: '2',
      run: () => command(() => editor.chain().focus().setHeading({ level: 2 }).run()),
    },
    {
      id: 'h3',
      label: tr('标题 3'),
      description: tr('更紧凑的段落标题。'),
      aliases: 'heading h3 标题',
      icon: HeadingIcon,
      badge: '3',
      run: () => command(() => editor.chain().focus().setHeading({ level: 3 }).run()),
    },
    {
      id: 'bullet',
      label: tr('项目列表'),
      description: tr('用简单的列表组织内容。'),
      aliases: 'list bullet ul 列表 无序',
      icon: ListBulletIcon,
      run: () => command(() => editor.chain().focus().toggleBulletList().run()),
    },
    {
      id: 'number',
      label: tr('编号列表'),
      description: tr('按顺序列出步骤。'),
      aliases: 'list numbered ol 编号 有序 步骤',
      icon: ListBulletIcon,
      badge: '1',
      run: () => command(() => editor.chain().focus().toggleOrderedList().run()),
    },
    {
      id: 'todo',
      label: tr('待办列表'),
      description: tr('记录需要完成的事情。'),
      aliases: 'todo task check 待办 清单 任务',
      icon: CheckboxIcon,
      run: () => command(() => editor.chain().focus().toggleTaskList().run()),
    },
    {
      id: 'quote',
      label: tr('引用'),
      description: tr('突出一段引用文字。'),
      aliases: 'quote blockquote 引用',
      icon: QuoteIcon,
      run: () => command(() => editor.chain().focus().toggleBlockquote().run()),
    },
    {
      id: 'code',
      label: tr('代码块'),
      description: tr('展示代码或纯文本。'),
      aliases: 'code pre 代码',
      icon: CodeIcon,
      run: () => command(() => editor.chain().focus().toggleCodeBlock().run()),
    },
    {
      id: 'divider',
      label: tr('分隔线'),
      description: tr('用一条细线分隔内容。'),
      aliases: 'divider line hr 分隔 线',
      icon: MinusIcon,
      run: () => command(() => editor.chain().focus().setHorizontalRule().run()),
    },
    {
      id: 'image',
      label: tr('图片'),
      description: tr('上传一张图片。'),
      aliases: 'image photo picture 图片 照片',
      icon: ImageIcon,
      run: () => showMedia('image'),
    },
    {
      id: 'video',
      label: tr('视频'),
      description: tr('上传视频或粘贴视频链接。'),
      aliases: 'video movie 视频',
      icon: VideoIcon,
      run: () => showMedia('video'),
    },
    {
      id: 'simple-table',
      label: tr('普通表格'),
      description: tr('直接在文档中编辑行和列。'),
      aliases: 'table grid simple 表格 普通表格',
      icon: TableIcon,
      run: () =>
        command(() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        ),
    },
    {
      id: 'table',
      label: tr('引用表格'),
      description: tr('嵌入已有表格，直接查看和编辑。'),
      aliases: 'table database view 表格 数据库 关联',
      icon: TableIcon,
      run: () => {
        const anchor =
          slashRef.current?.anchor ?? editor.view.coordsAtPos(editor.state.selection.from)
        command(() => setReference(anchor))
      },
    },
  ]
  const filtered = commands.filter(
    (c) => !slash || `${c.label} ${c.aliases}`.toLowerCase().includes(slash.query),
  )
  commandsRef.current = filtered
  useEffect(() => {
    setActive(0)
  }, [slash?.query])
  useEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  useEffect(() => {
    if (!container.current) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return
        const { selection } = editor.state
        let next: Slash | null = null
        if (
          selection.empty &&
          selection.$from.parent.isTextblock &&
          !editor.view.composing &&
          editor.isFocused
        ) {
          const match = slashMatch(
            selection.$from.parent.textBetween(0, selection.$from.parentOffset, '', '\ufffc'),
            selection.from,
          )
          if (match && match.to !== dismissed.current)
            next = { ...match, anchor: editor.view.coordsAtPos(selection.from) }
        }
        setSlash(next)
        if (!next && selection instanceof TextSelection && !selection.empty && editor.isFocused) {
          const domSelection = window.getSelection()
          const rect = domSelection?.rangeCount
            ? domSelection.getRangeAt(0).getBoundingClientRect()
            : null
          setBubble(rect && rect.width ? rect : null)
        } else setBubble(null)
        if (selection.empty && editor.isFocused) {
          const block = editorBlocks(editor).find(
            (b) => selection.from >= b.pos && selection.from < b.pos + b.node.nodeSize,
          )
          if (block) {
            const dom = editor.view.nodeDOM(block.pos)
            if (dom instanceof HTMLElement)
              setHover({
                id: block.id,
                top:
                  dom.getBoundingClientRect().top - container.current!.getBoundingClientRect().top,
              })
          }
        }
        setRevision((v) => v + 1)
      })
    }
    const pointer = (event: MouseEvent) => {
      if (blockMenuRef.current || moving.current) return
      const root = container.current!
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('.document-block-handle')) return
      let el = target.closest<HTMLElement>('.document-prose > *')
      if (
        !el &&
        event.clientX >= root.getBoundingClientRect().left &&
        event.clientX <= editor.view.dom.getBoundingClientRect().left
      ) {
        el =
          (Array.from(editor.view.dom.children).find((n) => {
            const rect = n.getBoundingClientRect()
            return event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3
          }) as HTMLElement | undefined) ?? null
      }
      if (!el || !editor.view.dom.contains(el)) return
      const block = editorBlocks(editor).find(
        (b) =>
          editor.view.nodeDOM(b.pos) === el ||
          (editor.view.nodeDOM(b.pos) instanceof HTMLElement &&
            (editor.view.nodeDOM(b.pos) as HTMLElement).contains(el)),
      )
      if (block)
        setHover({
          id: block.id,
          top: el.getBoundingClientRect().top - root.getBoundingClientRect().top,
        })
    }
    const leave = () => {
      if (!blockMenuRef.current && !moving.current) setHover(null)
    }
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('.document-floating, [data-document-menu-portal]') &&
        !editor.view.dom.contains(event.target)
      ) {
        setReference(null)
        setMedia(null)
        setLink(null)
      }
    }
    const onDrop = (event: DragEvent) => {
      if (!moving.current) return
      event.preventDefault()
      event.stopPropagation()
      const target = dropTarget(event.clientY)
      if (target) moveEditorBlock(editor, moving.current, target.at)
      moving.current = null
      setDrop(null)
      update()
    }
    const onDragOver = (event: DragEvent) => {
      if (!moving.current) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      setDrop(dropTarget(event.clientY))
    }
    const dropTarget = (y: number) => {
      const items = editorBlocks(editor)
      for (const b of items) {
        const dom = editor.view.nodeDOM(b.pos)
        if (!(dom instanceof HTMLElement)) continue
        const rect = dom.getBoundingClientRect()
        if (y < rect.top + rect.height / 2)
          return { at: b.pos, top: rect.top - container.current!.getBoundingClientRect().top }
      }
      const last = items.at(-1)
      const dom = last && editor.view.nodeDOM(last.pos)
      return last && dom instanceof HTMLElement
        ? {
            at: last.pos + last.node.nodeSize,
            top:
              dom.getBoundingClientRect().bottom - container.current!.getBoundingClientRect().top,
          }
        : null
    }
    editor.on('transaction', update)
    editor.on('selectionUpdate', update)
    editor.on('focus', update)
    editor.on('blur', update)
    container.current.addEventListener('mousemove', pointer)
    container.current.addEventListener('mouseleave', leave)
    container.current.addEventListener('dragover', onDragOver, true)
    container.current.addEventListener('drop', onDrop, true)
    document.addEventListener('scroll', update, true)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', update)
    update()
    return () => {
      cancelAnimationFrame(frame)
      editor.off('transaction', update)
      editor.off('selectionUpdate', update)
      editor.off('focus', update)
      editor.off('blur', update)
      container.current?.removeEventListener('mousemove', pointer)
      container.current?.removeEventListener('mouseleave', leave)
      container.current?.removeEventListener('dragover', onDragOver, true)
      container.current?.removeEventListener('drop', onDrop, true)
      document.removeEventListener('scroll', update, true)
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', update)
    }
  }, [editor, container])
  keyboard.current = (event: KeyboardEvent) => {
    if (event.isComposing) return false
    if (slashRef.current) {
      if (event.key === 'Escape') {
        dismissed.current = slashRef.current.to
        setSlash(null)
        event.preventDefault()
        return true
      }
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        const n = commandsRef.current.length
        if (n) setActive((v) => (v + (event.key === 'ArrowDown' ? 1 : -1) + n) % n)
        event.preventDefault()
        return true
      }
      if (event.key === 'Enter' && commandsRef.current.length) {
        commandsRef.current[activeRef.current]?.run()
        event.preventDefault()
        return true
      }
    }
    if (event.key === 'Escape') {
      setReference(null)
      setMedia(null)
      setLink(null)
      setBubble(null)
    }
    return false
  }
  const current = hover && editorBlocks(editor).find((b) => b.id === hover.id)
  const duplicate = (block: EditorBlock) => {
    const copy = block.node.toJSON() as DocumentNode
    const clear = (n: DocumentNode) => {
      if (n.attrs) delete n.attrs.id
      n.content?.forEach(clear)
    }
    clear(copy)
    editor
      .chain()
      .focus()
      .insertContentAt(block.pos + block.node.nodeSize, copy)
      .run()
  }
  const add = (block: EditorBlock) => {
    if (block.node.type.name === 'paragraph' && !block.node.textContent)
      editor
        .chain()
        .focus()
        .setTextSelection(block.pos + 1)
        .insertContent('/')
        .run()
    else
      editor
        .chain()
        .focus()
        .insertContentAt(block.pos + block.node.nodeSize, {
          type: 'paragraph',
          content: [{ type: 'text', text: '/' }],
        })
        .run()
  }
  const tableCommand = (run: () => void) => {
    if (
      current &&
      !(
        editor.state.selection.from > current.pos &&
        editor.state.selection.to < current.pos + current.node.nodeSize
      )
    )
      editor.commands.setTextSelection(current.pos + 4)
    run()
  }
  const nudge = (block: EditorBlock, direction: -1 | 1) => {
    const items = editorBlocks(editor),
      i = items.findIndex((b) => b.id === block.id),
      other = items[i + direction]
    if (other)
      moveEditorBlock(editor, block.id, direction < 0 ? other.pos : other.pos + other.node.nodeSize)
  }
  const floating =
    shell &&
    createPortal(
      <>
        {slash && (
          <div
            key="slash"
            ref={menuRef}
            className="document-floating document-slash-menu"
            style={place(slash.anchor, 300, Math.min(412, 36 + filtered.length * 54))}
            onMouseDown={(e) => e.preventDefault()}
            role="listbox"
            aria-label={tr('插入内容')}
          >
            <div className="document-menu-label">{tr('基础内容')}</div>
            {filtered.map((c, index) => (
              <button
                type="button"
                key={c.id}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={c.run}
              >
                <span className="document-command-icon">
                  <c.icon />
                  {c.badge && <small>{c.badge}</small>}
                </span>
                <span>
                  <strong>{c.label}</strong>
                  <small>{c.description}</small>
                </span>
              </button>
            ))}
            {!filtered.length && <p>{tr('没有匹配的内容')}</p>}
          </div>
        )}
        {bubble && !slash && !link && (
          <div
            className="document-floating document-selection-menu"
            style={place(bubble, 298, 38, true)}
            role="toolbar"
            aria-label={tr('文字格式')}
            onMouseDown={(e) => e.preventDefault()}
            data-revision={revision}
          >
            <button
              aria-label={tr('加粗')}
              aria-pressed={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <FontBoldIcon />
            </button>
            <button
              aria-label={tr('斜体')}
              aria-pressed={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <FontItalicIcon />
            </button>
            <button
              aria-label={tr('下划线')}
              aria-pressed={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <UnderlineIcon />
            </button>
            <button
              aria-label={tr('删除线')}
              aria-pressed={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <StrikethroughIcon />
            </button>
            <button
              aria-label={tr('行内代码')}
              aria-pressed={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <CodeIcon />
            </button>
            <span />
            <button
              aria-label={tr('添加链接')}
              onClick={() => {
                setHref(editor.getAttributes('link').href ?? '')
                setLink(bubble)
                setLinkError('')
              }}
            >
              <Link2Icon />
            </button>
          </div>
        )}
        {media && (
          <div
            className="document-floating document-reference-menu"
            style={place(media.anchor, 320, 320)}
          >
            <MediaInsertPicker
              key={media.kind}
              kind={media.kind}
              onUpload={() => {
                onUpload(media.kind)
                setMedia(null)
              }}
              onInsert={(src) => {
                if (media.kind === 'image') editor.chain().focus().setImage({ src }).run()
                else
                  editor
                    .chain()
                    .focus()
                    .insertContent([{ type: 'video', attrs: { src } }, { type: 'paragraph' }])
                    .run()
                setMedia(null)
              }}
            />
            <button
              className="document-menu-cancel"
              onClick={() => {
                setMedia(null)
                editor.commands.focus()
              }}
            >
              {tr('取消')}
            </button>
          </div>
        )}
        {reference && (
          <div
            className="document-floating document-reference-menu"
            style={place(reference, 320, 300)}
          >
            <TableReferencePicker
              projectId={projectId}
              tableId={tableId}
              recordId={recordId}
              relations={relations}
              onPick={(config) => {
                editor
                  .chain()
                  .focus()
                  .insertContent([{ type: 'dataTable', attrs: config }, { type: 'paragraph' }])
                  .run()
                setReference(null)
              }}
            />
            <button
              className="document-menu-cancel"
              onClick={() => {
                setReference(null)
                editor.commands.focus()
              }}
            >
              {tr('取消')}
            </button>
          </div>
        )}
        {link && (
          <form
            className="document-floating document-link-menu"
            style={place(link, 330, 108, true)}
            onSubmit={(event) => {
              event.preventDefault()
              if (href && !/^(https?:\/\/|mailto:)/i.test(href)) {
                setLinkError(tr('请输入 http、https 或 mailto 链接'))
                return
              }
              if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
              else editor.chain().focus().unsetLink().run()
              setLink(null)
            }}
          >
            <input
              autoFocus
              aria-label={tr('链接地址')}
              placeholder="https://"
              value={href}
              onChange={(e) => setHref(e.target.value)}
            />
            <Button type="submit" size="1">
              {tr('确定')}
            </Button>
            {linkError && <small>{linkError}</small>}
          </form>
        )}
      </>,
      shell,
    )
  return (
    <>
      {hover && current && (
        <div className="document-block-handle" style={{ top: hover.top }}>
          <button
            type="button"
            aria-label={tr('在下方添加内容')}
            title={tr('在下方添加内容')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => add(current)}
          >
            <PlusIcon />
          </button>
          <DropdownMenu.Root open={blockMenu} onOpenChange={setBlockMenu}>
            <DropdownMenu.Trigger>
              <button
                type="button"
                draggable
                aria-label={tr('拖动或操作内容块')}
                title={tr('拖动调整顺序，点击打开菜单')}
                onPointerDownCapture={(event) => event.stopPropagation()}
                onClick={() => setBlockMenu(true)}
                onDragStart={(event) => {
                  moving.current = current.id
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', current.node.textContent)
                  const dom = editor.view.nodeDOM(current.pos)
                  if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0)
                }}
                onDragEnd={() => {
                  moving.current = null
                  setDrop(null)
                }}
                onKeyDown={(event) => {
                  if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault()
                    nudge(current, event.key === 'ArrowUp' ? -1 : 1)
                  }
                }}
              >
                <DragHandleDots2Icon />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" side="left">
              <DropdownMenu.Item onSelect={() => add(current)}>
                <PlusIcon />
                {tr('在下方添加内容')}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => duplicate(current)}>
                <CopyIcon />
                {tr('复制内容块')}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => nudge(current, -1)}>
                <ArrowUpIcon />
                {tr('上移')}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => nudge(current, 1)}>
                <ArrowDownIcon />
                {tr('下移')}
              </DropdownMenu.Item>
              {current.node.type.name === 'table' && (
                <>
                  <DropdownMenu.Separator />
                  {tableActions(editor).map((action) => (
                    <DropdownMenu.Item
                      key={action.label}
                      color={action.danger ? 'red' : undefined}
                      onSelect={() => tableCommand(action.run)}
                    >
                      {action.label}
                    </DropdownMenu.Item>
                  ))}
                </>
              )}
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                color="red"
                onSelect={() =>
                  editor
                    .chain()
                    .focus()
                    .deleteRange({ from: current.pos, to: current.pos + current.node.nodeSize })
                    .run()
                }
              >
                <TrashIcon />
                {tr('删除内容块')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      )}
      {drop && <div className="document-drop-line" style={{ top: drop.top }} />}
      {floating}
    </>
  )
}
