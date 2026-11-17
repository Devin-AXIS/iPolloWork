import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyArchivedFiles } from '../upstream.mjs'

test('source validation rejects edited official bytes and accepts their restoration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipw-source-integrity-'))
  const path = join(directory, 'README.md')
  const original = Buffer.from('Pinned source fixture\n')
  const files = { 'README.md': createHash('sha256').update(original).digest('hex') }
  try {
    await writeFile(path, Buffer.concat([original, Buffer.from('\nchanged\n')]))
    await assert.rejects(verifyArchivedFiles(directory, files), /Official DSH source was modified: README.md/)
    await writeFile(path, original)
    await verifyArchivedFiles(directory, files)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
