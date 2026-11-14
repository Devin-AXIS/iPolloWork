import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validAvatar } from '../src/host/agent-avatar.ts'
import { AVATAR_MAX_DATA_URL_LENGTH } from '../src/shared/avatar.ts'

test('avatars accept small raster images and reject active, mismatched or oversized content', async () => {
  const image = await readFile(new URL('./fixtures/avatar.png', import.meta.url))
  const encoded = image.toString('base64')
  assert.equal(validAvatar(`data:image/png;base64,${encoded}`), true)
  assert.equal(validAvatar(''), true)
  for (const invalid of [
    `data:image/jpeg;base64,${encoded}`,
    `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`,
    'https://example.test/avatar.png', 'data:image/png;base64,broken',
    `data:image/png;base64,${'A'.repeat(AVATAR_MAX_DATA_URL_LENGTH)}`,
  ]) assert.equal(validAvatar(invalid), false)
  const huge = Buffer.from(image)
  huge.writeUInt32BE(100000, 16)
  assert.equal(validAvatar(`data:image/png;base64,${huge.toString('base64')}`), false)
})
