import type { CampaignSchedule } from './types.js'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function localDateTimeToUtc(local: string, timezone = 'Asia/Shanghai'): string {
  if (timezone !== 'Asia/Shanghai' && timezone !== 'Asia/Singapore') {
    throw new Error('一期仅支持 Asia/Shanghai 或 Asia/Singapore 时区')
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('时间格式必须是 YYYY-MM-DDTHH:mm')
  const date = new Date(`${local}:00+08:00`)
  if (Number.isNaN(date.getTime())) throw new Error('发布时间无效')
  return date.toISOString()
}

export function utcToLocalInput(iso: string): string {
  const local = new Date(new Date(iso).getTime() + SHANGHAI_OFFSET_MS)
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
}

export function localDayUtcRange(iso: string, timezone = 'Asia/Shanghai'): { start: string; end: string } {
  const day = utcToLocalInput(iso).slice(0, 10)
  const start = localDateTimeToUtc(`${day}T00:00`, timezone)
  return { start, end: new Date(new Date(start).getTime() + 24 * 60 * 60_000).toISOString() }
}

export function expandSchedule(schedule: CampaignSchedule, from: Date, until: Date): string[] {
  if (until.getTime() < from.getTime()) return []
  if (schedule.kind === 'single') {
    if (!schedule.scheduledLocal) return []
    const iso = localDateTimeToUtc(schedule.scheduledLocal, schedule.timezone)
    const time = new Date(iso).getTime()
    return time >= from.getTime() && time <= until.getTime() ? [iso] : []
  }
  if (!schedule.publishTime || !/^\d{2}:\d{2}$/.test(schedule.publishTime)) return []
  const weekdays = new Set(schedule.weekdays)
  const localStart = new Date(from.getTime() + SHANGHAI_OFFSET_MS)
  const localEnd = new Date(until.getTime() + SHANGHAI_OFFSET_MS)
  const cursor = new Date(Date.UTC(localStart.getUTCFullYear(), localStart.getUTCMonth(), localStart.getUTCDate()))
  const endDay = Date.UTC(localEnd.getUTCFullYear(), localEnd.getUTCMonth(), localEnd.getUTCDate())
  const results: string[] = []
  while (cursor.getTime() <= endDay) {
    if (weekdays.has(cursor.getUTCDay())) {
      const date = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}T${schedule.publishTime}`
      const iso = localDateTimeToUtc(date, schedule.timezone)
      const time = new Date(iso).getTime()
      if (time >= from.getTime() && time <= until.getTime()) results.push(iso)
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return results
}

export type MissedDisposition = 'due' | 'catch_up' | 'missed' | 'future'

export function missedDisposition(scheduledAt: string, now = new Date()): MissedDisposition {
  const delta = now.getTime() - new Date(scheduledAt).getTime()
  if (delta < 0) return 'future'
  if (delta <= 60_000) return 'due'
  if (delta <= 15 * 60_000) return 'catch_up'
  return 'missed'
}

export function spreadCommentTimes(input: {
  publishedAt: string
  minComments: number
  maxComments: number
  availableAccounts: number
  windowStartMinutes: number
  windowEndMinutes: number
  random?: () => number
}): string[] {
  const random = input.random ?? Math.random
  const max = Math.max(0, Math.min(input.maxComments, input.availableAccounts))
  const min = Math.max(0, Math.min(input.minComments, max))
  if (max === 0) return []
  const count = min + Math.floor(random() * (max - min + 1))
  const start = Math.max(0, input.windowStartMinutes)
  const end = Math.max(start, input.windowEndMinutes)
  const base = new Date(input.publishedAt).getTime()
  const slots = Array.from({ length: count }, (_, index) => {
    const segmentStart = start + ((end - start) * index) / count
    const segmentEnd = start + ((end - start) * (index + 1)) / count
    const minute = segmentStart + random() * Math.max(1, segmentEnd - segmentStart)
    return new Date(base + Math.round(minute) * 60_000).toISOString()
  })
  return slots.sort()
}

export function nextCommentScanTimes(publishedAt: string): string[] {
  const start = new Date(publishedAt).getTime()
  const end = start + 72 * 60 * 60_000
  const results: string[] = []
  for (let time = start + 30 * 60_000; time <= end; time += 30 * 60_000) {
    results.push(new Date(time).toISOString())
  }
  return results
}
