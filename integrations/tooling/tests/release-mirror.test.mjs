import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManifest, digest, releasePath, verifyMirror } from '../release-mirror.mjs'

test('mirror publication verifies original and public bytes, rejecting corrupt or missing assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-mirror-'))
  try {
    const content = Buffer.from('the original release bytes')
    const hash = await digest([content])
    const release = { tag_name: 'v1.2.3', target_commitish: 'abc', assets: [{ name: 'plugin.tgz', size: content.length, digest: `sha256:${hash.sha256}`, browser_download_url: 'https://github.com/original' }] }
    await writeFile(join(dir, 'plugin.tgz'), content)
    const manifest = await createManifest(release, dir)
    await verifyMirror(manifest, 'https://mirror.example/downloads', async url => {
      assert.equal(url.href, 'https://mirror.example/downloads/releases/v1.2.3/plugin.tgz')
      return new Response(content)
    })
    await assert.rejects(verifyMirror(manifest, 'https://mirror.example', async () => new Response('corrupt')), /mismatch/)
    await assert.rejects(verifyMirror(manifest, 'https://mirror.example', async () => new Response('', { status: 404 })), /unavailable/)
    await writeFile(join(dir, 'plugin.tgz'), 'local corruption')
    await assert.rejects(createManifest(release, dir), /mismatch/)
    await assert.rejects(verifyMirror(manifest, 'http://mirror.example'), /HTTPS/)
    assert.throws(() => releasePath('../bad', 'a.tgz'), /Unsafe/)
    assert.throws(() => releasePath('v1', '../bad.tgz'), /Unsafe/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
