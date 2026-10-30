import { useSyncExternalStore } from 'react'
import { translateFor, useLocale, type Locale } from '../i18n'

export function relativeTimeLabel(
  date: Date,
  now: number,
  locale: Locale,
  quietForSeconds = 0,
): string {
  if (!Number.isFinite(date.getTime())) return ''
  const seconds = (now - date.getTime()) / 1000
  if (quietForSeconds > 0 && seconds >= -60 && seconds < quietForSeconds) return ''
  // Allow a small difference between the browser and server clocks.
  if (seconds >= -60 && seconds < 60) return translateFor(locale, '刚刚')
  if (seconds >= 60 && seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    return minutes === 30
      ? translateFor(locale, '半小时前')
      : new Intl.RelativeTimeFormat(locale).format(-minutes, 'minute')
  }
  if (seconds >= 3600 && seconds < 86400)
    return new Intl.RelativeTimeFormat(locale).format(-Math.floor(seconds / 3600), 'hour')
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' as const } : {}),
  })
}

// One clock for all visible timestamps; stop it when the last consumer leaves.
let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()
function tick() {
  if (document.hidden) return
  now = Date.now()
  listeners.forEach((notify) => notify())
}
function subscribe(notify: () => void) {
  listeners.add(notify)
  if (listeners.size === 1) {
    tick()
    timer = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
  }
  return () => {
    listeners.delete(notify)
    if (!listeners.size) {
      clearInterval(timer)
      timer = undefined
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }
}
const snapshot = () => now
export function RelativeTime({
  date,
  quietForSeconds = 0,
}: {
  date: Date
  quietForSeconds?: number
}) {
  const locale = useLocale()
  const currentTime = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (!Number.isFinite(date.getTime())) return null
  const label = relativeTimeLabel(date, currentTime, locale, quietForSeconds)
  if (!label) return null
  const full = translateFor(locale, '刷新于 {0}', {
    0: date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium', hour12: false }),
  })
  return (
    <small>
      <time dateTime={date.toISOString()} title={full} aria-label={full}>
        {label}
      </time>
    </small>
  )
}
