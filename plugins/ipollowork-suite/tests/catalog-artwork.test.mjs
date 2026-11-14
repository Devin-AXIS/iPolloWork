import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { catalogArtwork } from '../scripts/catalog-artwork.mjs'
test('catalog validation rejects a market icon that differs from the installable package', async () => {
  await catalogArtwork('catalog/index.json', 'catalog/bundled-releases.json')
  const directory = await mkdtemp(join(tmpdir(), 'suite-artwork-'))
  try {
    const index = JSON.parse(await readFile('catalog/index.json', 'utf8'))
    index.plugins[0].icon = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64')
    const file = join(directory, 'index.json')
    await writeFile(file, JSON.stringify(index))
    await assert.rejects(catalogArtwork(file, resolve('catalog/bundled-releases.json')), /Market icon differs/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
