import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dateKey,
  parseDate,
  timestampParts,
  timestampValue,
  tagParts,
  tagValue,
  referenceUrl,
} from '../src/ui/fields/input-values'
import { fieldTypes } from '../src/core/fields'
import type { FieldDef } from '../src/core/contracts'
import '../src/plugins/business-fields'

test('calendar dates remain local dates across time zones and reject invalid days', () => {
  const original = process.env.TZ
  try {
    for (const zone of ['Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = zone
      assert.equal(dateKey(parseDate('2024-02-29')!), '2024-02-29')
      assert.equal(parseDate('2025-02-29'), undefined)
      assert.equal(parseDate('2026-04-31'), undefined)
      assert.equal(parseDate('2026-9-12'), undefined)
      assert.equal(timestampValue('2026-09-12', ''), '')
      const instant = '2026-09-12T08:03:45.123Z'
      const parts = timestampParts(instant)
      assert.equal(timestampValue(parts.date, parts.time), instant)
    }
    process.env.TZ = 'America/New_York'
    assert.equal(timestampValue('2026-03-08', '02:30'), undefined)
    const laterRepeatedTime = '2026-11-01T06:30:00.000Z'
    const parts = timestampParts(laterRepeatedTime)
    assert.equal(timestampValue(parts.date, parts.time, laterRepeatedTime), laterRepeatedTime)
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
})

test('uncommitted tags can save directly without losing text or previously selected tags', () => {
  assert.deepEqual(tagParts(['客户', '重点']), { tags: ['客户', '重点'], draft: '' })
  assert.deepEqual(tagParts('客户，重点\n跟进'), { tags: ['客户', '重点'], draft: '跟进' })
  const value = tagValue(['客户'], '跟进')
  const type = fieldTypes.get('tags')
  assert.deepEqual(type.validate(value, {} as FieldDef), ['客户', '跟进'])
  assert.deepEqual(tagParts('客户,客户, '), { tags: ['客户'], draft: ' ' })
  assert.equal(tagValue([], ''), '')
})

test('specialized controls preserve decimal precision and only preview web references', () => {
  const currency = fieldTypes.get('currency')
  const exact = '99999999999999.1234'
  assert.equal(currency.validate(exact, {} as FieldDef), exact)
  assert.equal(currency.format(exact), '99,999,999,999,999.1234')
  for (const url of [
    'javascript:alert(1)',
    'data:image/png;base64,a',
    'file:///secret',
    'incomplete',
  ])
    assert.equal(referenceUrl(url), undefined)
  assert.equal(referenceUrl('https://example.com/image.png'), 'https://example.com/image.png')
})
