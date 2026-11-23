// Calendar dates stay local dates; timestamps keep their instant and precision.
const pad = (n: number) => String(n).padStart(2, '0')
export function dateKey(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) && dateKey(date) === value ? date : undefined
}
export function timestampParts(value: unknown) {
  const date = typeof value === 'string' && value ? new Date(value) : undefined
  if (!date || !Number.isFinite(date.getTime())) return { date: '', time: '' }
  const seconds = date.getSeconds() || date.getMilliseconds() ? `:${pad(date.getSeconds())}` : ''
  return {
    date: dateKey(date),
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}${seconds}${date.getMilliseconds() ? `.${String(date.getMilliseconds()).padStart(3, '0')}` : ''}`,
  }
}
export function timestampValue(date: string, time: string, previous?: unknown) {
  if (!date || !time) return ''
  const parts = timestampParts(previous)
  if (parts.date === date && parts.time === time) return previous as string
  const result = new Date(`${date}T${time}`)
  // Reject impossible calendar dates and daylight-saving gaps instead of moving the time.
  if (
    !parseDate(date) ||
    !Number.isFinite(result.getTime()) ||
    dateKey(result) !== date ||
    `${pad(result.getHours())}:${pad(result.getMinutes())}` !== time.slice(0, 5)
  )
    return undefined
  return result.toISOString()
}
export function tagParts(value: unknown) {
  if (Array.isArray(value))
    return { tags: value.filter((v): v is string => typeof v === 'string'), draft: '' }
  const parts = String(value ?? '').split(/[,，\n]/)
  const draft = parts.pop() ?? ''
  return { tags: [...new Set(parts.map((v) => v.trim()).filter(Boolean))], draft }
}
export function tagValue(tags: string[], draft: string) {
  return [...tags, draft].join(',')
}
export function referenceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol)) return url.href
  } catch {
    /* Incomplete input remains editable. */
  }
}
