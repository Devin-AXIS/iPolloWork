import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verifySource, upstreamRoot } from '../upstream.mjs'

test('source validation rejects edited official bytes and accepts their restoration', async () => {
  const path = join(upstreamRoot, 'README.md')
  const original = await readFile(path)
  try {
    await writeFile(path, Buffer.concat([original, Buffer.from('\nchanged\n')]))
    await assert.rejects(verifySource(), /Official DSH source was modified: README.md/)
  } finally { await writeFile(path, original) }
  await verifySource()
})
