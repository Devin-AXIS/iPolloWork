import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relativeTimeLabel } from '../src/ui/components/relative-time'

test('refresh times show recent age, then month/day; only older calendar years include the year', () => {
  const now = new Date(2026, 8, 11, 12).getTime()
  const ago = (seconds: number) => relativeTimeLabel(new Date(now - seconds * 1000), now, 'zh-CN')
  assert.equal(ago(0), '刚刚')
  assert.equal(ago(59), '刚刚')
  assert.equal(ago(60), '1分钟前')
  assert.equal(ago(600), '10分钟前')
  assert.equal(ago(1800), '半小时前')
  assert.equal(ago(3599), '59分钟前')
  assert.equal(ago(3600), '1小时前')
  assert.equal(ago(86399), '23小时前')
  assert.equal(ago(86400), '9月10日')
  assert.equal(relativeTimeLabel(new Date(2025, 8, 11), now, 'zh-CN'), '2025年9月11日')
  const newYear = new Date(2027, 0, 1, 12).getTime()
  assert.equal(relativeTimeLabel(new Date(2026, 11, 30, 12), newYear, 'zh-CN'), '2026年12月30日')
  assert.equal(relativeTimeLabel(new Date(NaN), now, 'zh-CN'), '')
  assert.equal(ago(-30), '刚刚')
  assert.equal(relativeTimeLabel(new Date(2026, 8, 12), now, 'zh-CN'), '9月12日')
})

test('refresh times use the chosen language', () => {
  const now = new Date(2026, 8, 11, 12).getTime()
  assert.equal(relativeTimeLabel(new Date(now), now, 'en'), 'Just now')
  assert.equal(relativeTimeLabel(new Date(now - 600_000), now, 'en'), '10 minutes ago')
  assert.equal(relativeTimeLabel(new Date(now - 1_800_000), now, 'en'), 'Half an hour ago')
  assert.equal(relativeTimeLabel(new Date(now - 3_600_000), now, 'en'), '1 hour ago')
  assert.equal(relativeTimeLabel(new Date(2026, 8, 10), now, 'en'), 'Sep 10')
  assert.equal(relativeTimeLabel(new Date(2025, 8, 10), now, 'en'), 'Sep 10, 2025')
})

test('successful recent refreshes stay quiet; failures can reveal the last successful time', () => {
  const now = new Date(2026, 8, 11, 12).getTime()
  const recent = new Date(now - 600_000)
  assert.equal(relativeTimeLabel(recent, now, 'zh-CN', 1800), '')
  assert.equal(relativeTimeLabel(new Date(now - 1_799_000), now, 'zh-CN', 1800), '')
  assert.equal(relativeTimeLabel(new Date(now - 1_800_000), now, 'zh-CN', 1800), '半小时前')
  assert.equal(relativeTimeLabel(new Date(now - 3_600_000), now, 'zh-CN', 1800), '1小时前')
  assert.equal(relativeTimeLabel(recent, now, 'zh-CN', 0), '10分钟前')
  assert.equal(relativeTimeLabel(new Date(NaN), now, 'zh-CN', 1800), '')
})
