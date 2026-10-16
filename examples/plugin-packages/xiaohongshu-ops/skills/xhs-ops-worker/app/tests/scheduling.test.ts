import assert from 'node:assert/strict'
import test from 'node:test'
import { expandSchedule, localDateTimeToUtc, localDayUtcRange, missedDisposition, nextCommentScanTimes, spreadCommentTimes, utcToLocalInput } from '../src/scheduling.js'

test('converts Shanghai local time to UTC and back', () => {
  assert.equal(localDateTimeToUtc('2026-08-01T10:30'), '2026-08-01T02:30:00.000Z')
  assert.equal(utcToLocalInput('2026-08-01T02:30:00.000Z'), '2026-08-01T10:30')
})

test('computes the Shanghai publishing day in UTC', () => {
  assert.deepEqual(localDayUtcRange('2026-07-31T16:30:00.000Z'), {
    start: '2026-07-31T16:00:00.000Z', end: '2026-08-01T16:00:00.000Z',
  })
})

test('expands weekly schedule only on configured weekdays', () => {
  const result = expandSchedule(
    { kind: 'weekly', timezone: 'Asia/Shanghai', scheduledLocal: null, weekdays: [1, 3], publishTime: '10:00' },
    new Date('2026-08-02T00:00:00.000Z'), new Date('2026-08-09T23:59:00.000Z'),
  )
  assert.deepEqual(result, ['2026-08-03T02:00:00.000Z', '2026-08-05T02:00:00.000Z'])
})

test('applies the 15 minute catch-up boundary', () => {
  const now = new Date('2026-08-01T03:00:00.000Z')
  assert.equal(missedDisposition('2026-08-01T03:02:00.000Z', now), 'future')
  assert.equal(missedDisposition('2026-08-01T02:59:30.000Z', now), 'due')
  assert.equal(missedDisposition('2026-08-01T02:50:00.000Z', now), 'catch_up')
  assert.equal(missedDisposition('2026-08-01T02:44:59.000Z', now), 'missed')
})

test('spreads comments across the configured window and caps by account count', () => {
  const times = spreadCommentTimes({ publishedAt: '2026-08-01T00:00:00.000Z', minComments: 3, maxComments: 5, availableAccounts: 3, windowStartMinutes: 30, windowEndMinutes: 240, random: () => 0 })
  assert.equal(times.length, 3)
  assert.equal(times[0], '2026-08-01T00:30:00.000Z')
  assert.ok(new Date(times[2] as string).getTime() < new Date('2026-08-01T04:00:01.000Z').getTime())
})

test('creates 30 minute scan intervals for 72 hours', () => {
  const times = nextCommentScanTimes('2026-08-01T00:00:00.000Z')
  assert.equal(times.length, 144)
  assert.equal(times[0], '2026-08-01T00:30:00.000Z')
  assert.equal(times.at(-1), '2026-08-04T00:00:00.000Z')
})
