import { useEffect, useRef, useState } from 'react'
import { readPreference, savePreference, translate as tr, useLocale } from '../i18n'

// Layout belongs to this browser, keyed by stable field IDs rather than column positions.
export function useSavedWidths(key: string) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved: unknown = JSON.parse(readPreference(key) ?? '{}')
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
      return Object.fromEntries(
        Object.entries(saved).filter(
          ([, value]) =>
            typeof value === 'number' && Number.isFinite(value) && value >= 100 && value <= 800,
        ),
      )
    } catch {
      return {}
    }
  })
  const latest = useRef(widths)
  function change(id: string, value: number) {
    latest.current = { ...latest.current, [id]: value }
    setWidths(latest.current)
  }
  function commit(id: string, value: number) {
    change(id, value)
    savePreference(key, JSON.stringify(latest.current))
  }
  return { widths, change, commit }
}

export function ResizeHandle({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
  onCommit,
  className = '',
}: {
  label: string
  value: number
  min: number
  max: number
  defaultValue: number
  onChange: (width: number) => void
  onCommit: (width: number) => void
  className?: string
}) {
  useLocale()
  const session = useRef<{
    pointer: number
    startX: number
    startWidth: number
    width: number
    handle: HTMLDivElement
  } | null>(null)
  const [active, setActive] = useState(false)
  const clamp = (width: number) => Math.round(Math.min(max, Math.max(min, width)))
  useEffect(
    () => () => {
      document.documentElement.classList.remove('is-resizing')
      session.current = null
    },
    [],
  )
  function end(commit: boolean) {
    const s = session.current
    if (!s) return
    session.current = null
    if (s.handle.hasPointerCapture(s.pointer)) s.handle.releasePointerCapture(s.pointer)
    document.documentElement.classList.remove('is-resizing')
    setActive(false)
    if (commit) onCommit(s.width)
    else onChange(s.startWidth)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title={tr('拖动调整宽度，双击恢复默认；也可使用左右方向键')}
      className={`resize-handle ${className}`}
      data-resizing={active || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0 || !e.isPrimary) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        session.current = {
          pointer: e.pointerId,
          startX: e.clientX,
          startWidth: value,
          width: value,
          handle: e.currentTarget,
        }
        document.documentElement.classList.add('is-resizing')
        setActive(true)
      }}
      onPointerMove={(e) => {
        const s = session.current
        if (!s || s.pointer !== e.pointerId) return
        s.width = clamp(s.startWidth + e.clientX - s.startX)
        onChange(s.width)
      }}
      onPointerUp={(e) => {
        if (session.current?.pointer === e.pointerId) end(true)
      }}
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(false)}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onCommit(clamp(defaultValue))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && session.current) {
          e.preventDefault()
          e.stopPropagation()
          end(false)
          return
        }
        const step = e.shiftKey ? 40 : 10
        const next =
          e.key === 'ArrowLeft'
            ? value - step
            : e.key === 'ArrowRight'
              ? value + step
              : e.key === 'Home'
                ? min
                : e.key === 'End'
                  ? max
                  : undefined
        if (next === undefined) return
        e.preventDefault()
        e.stopPropagation()
        onCommit(clamp(next))
      }}
    />
  )
}
