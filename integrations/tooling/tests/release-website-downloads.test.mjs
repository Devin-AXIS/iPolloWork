import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageWebsiteDownloads, websiteDownloadSources } from '../release-website-downloads.mjs'

test('website aliases preserve verified bytes and the unsigned updater name', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipollo-download-aliases-'))
  try {
    const sources = websiteDownloadSources('1.0.8')
    for (const source of new Set(Object.values(sources))) await writeFile(join(directory, source), `verified ${source}`)
    await stageWebsiteDownloads('1.0.8', directory)
    for (const [name, source] of Object.entries(sources)) assert.deepEqual(await readFile(join(directory, name)), await readFile(join(directory, source)))
    assert.equal(sources['ipollowork-win-x64-1.0.8.exe'], 'ipollowork-win-x64-1.0.8-unsigned.exe')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('missing payloads and unsafe versions cannot produce website aliases', async () => {
  assert.throws(() => websiteDownloadSources('../latest'), /numeric/)
  const directory = await mkdtemp(join(tmpdir(), 'ipollo-download-aliases-'))
  try { await assert.rejects(stageWebsiteDownloads('1.0.8', directory), { code: 'ENOENT' }) }
  finally { await rm(directory, { recursive: true, force: true }) }
})
