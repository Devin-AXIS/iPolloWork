import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import { translate as tr, useLocale } from '../i18n'

// Pointer events support mouse, pen and touch without a drag-and-drop runtime.
// Only handles capture input: navigation, scrolling and field editing remain independent.
export function useReorder(
  ids: string[],
  axis: 'x' | 'y',
  onReorder?: (ids: string[]) => Promise<void>,
) {
  useLocale()
  const containerRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ ids, onReorder })
  latest.current = { ids, onReorder }
  const session = useRef<{
    id: string
    x: number
    y: number
    pointer: number
    handle: HTMLElement
    moved: boolean
    next: string[]
  } | null>(null)
  const frame = useRef(0)
  const [active, setActive] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  const [busy, setBusy] = useState(false)
  function clear() {
    cancelAnimationFrame(frame.current)
    const s = session.current
    session.current = null
    if (s?.handle.hasPointerCapture(s.pointer)) s.handle.releasePointerCapture(s.pointer)
    setActive(null)
    setDrop(null)
  }
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      session.current = null
    },
    [],
  )
  function update(x: number, y: number) {
    const s = session.current,
      root = containerRef.current
    if (!s || !root || !s.moved) return
    const bounds = root.getBoundingClientRect()
    const point = axis === 'x' ? x : y
    const start = axis === 'x' ? bounds.left : bounds.top,
      end = axis === 'x' ? bounds.right : bounds.bottom
    const speed = point < start + 36 ? -10 : point > end - 36 ? 10 : 0
    if (axis === 'x') root.scrollLeft += speed
    else root.scrollTop += speed
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-reorder-id]')).filter(
      (el) => el.dataset.reorderId !== s.id,
    )
    const target = elements.find((el) => {
      const r = el.getBoundingClientRect()
      return point < (axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2)
    })
    const anchor = target ?? elements.at(-1)
    if (!anchor) return
    const id = anchor.dataset.reorderId!,
      side = target ? 'before' : 'after'
    setDrop({ id, side })
    const next = latest.current.ids.filter((id) => id !== s.id)
    const index = next.indexOf(id) + (side === 'after' ? 1 : 0)
    next.splice(index, 0, s.id)
    s.next = next
    cancelAnimationFrame(frame.current)
    if (speed) frame.current = requestAnimationFrame(() => update(x, y))
  }
  async function commit(next: string[]) {
    if (next.join() === latest.current.ids.join() || !latest.current.onReorder) return
    setBusy(true)
    try {
      await latest.current.onReorder(next)
    } finally {
      setBusy(false)
    }
  }
  return {
    containerRef,
    itemProps: (id: string) => ({
      'data-reorder-id': id,
      'data-dragging': active === id || undefined,
      'data-drop': drop?.id === id ? drop.side : undefined,
    }),
    handleProps: (id: string, label: string) => ({
      type: 'button' as const,
      className: 'reorder-handle',
      disabled: busy || !onReorder,
      'aria-label': tr('调整 {0} 的顺序', { 0: label }),
      title: tr('拖拽排序，或按 Alt + 方向键'),
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0 || !e.isPrimary || busy || !onReorder) return
        e.preventDefault()
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        session.current = {
          id,
          x: e.clientX,
          y: e.clientY,
          pointer: e.pointerId,
          handle: e.currentTarget,
          moved: false,
          next: ids,
        }
      },
      onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
        const s = session.current
        if (!s || s.pointer !== e.pointerId) return
        if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5) {
          s.moved = true
          setActive(s.id)
        }
        update(e.clientX, e.clientY)
      },
      onPointerUp: () => {
        const s = session.current
        clear()
        if (s?.moved) void commit(s.next)
      },
      onPointerCancel: clear,
      onLostPointerCapture: clear,
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'Escape') {
          clear()
          return
        }
        if (!e.altKey || busy) return
        const offset =
          e.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp')
            ? -1
            : e.key === (axis === 'x' ? 'ArrowRight' : 'ArrowDown')
              ? 1
              : 0
        if (!offset) return
        e.preventDefault()
        const next = [...ids],
          index = next.indexOf(id),
          target = index + offset
        if (target < 0 || target >= next.length) return
        next.splice(index, 1)
        next.splice(target, 0, id)
        void commit(next)
      },
    }),
  }
}
