import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slashMatch, overlayPosition } from '../src/ui/documents/editor-interactions'

test('slash commands support Chinese and English without activating inside URLs or prose', () => {
  assert.deepEqual(slashMatch('/标题', 4), { from: 1, to: 4, query: '标题' })
  assert.deepEqual(slashMatch('text /H2', 9), { from: 6, to: 9, query: 'h2' })
  assert.equal(slashMatch('https://example.com/path', 24), null)
  assert.equal(slashMatch('word/table', 11), null)
  assert.equal(slashMatch('/' + 'a'.repeat(33), 35), null)
})
test('context menus stay within narrow sheets, flip near the bottom, and formatting prefers above', () => {
  const bounds = { left: 100, right: 420, top: 100, bottom: 600 }
  const bottom = overlayPosition({ left: 390, right: 391, top: 550, bottom: 570 }, bounds, 330, 300)
  assert.equal(bottom.left, 108)
  assert.equal(bottom.width, 304)
  assert.ok(bottom.top + bottom.maxHeight < 550)
  const bubble = overlayPosition(
    { left: 200, right: 280, top: 250, bottom: 270 },
    bounds,
    298,
    38,
    true,
  )
  assert.ok(bubble.top + bubble.maxHeight < 250)
  const top = overlayPosition({ left: 100, right: 101, top: 104, bottom: 120 }, bounds, 300, 412)
  assert.ok(top.top > 120)
  assert.ok(top.top + top.maxHeight <= bounds.bottom)
})
