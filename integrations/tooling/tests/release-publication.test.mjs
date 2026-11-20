import test from 'node:test'
import assert from 'node:assert/strict'
import { checkRelease, verifyPublishedRelease } from '../release-publication.mjs'
import { updateFeeds } from '../release-update-feed.mjs'

const version = '1.0.3'
const assets = [
  ...['arm64', 'x64'].flatMap(arch => [`ipollowork-mac-${arch}-${version}.dmg`, `iPollo-${version}-mac-${arch}.zip`, `iPollo-${version}-mac-${arch}.zip.blockmap`, `mac-${arch}-release.json`]),
  `ipollowork-win-x64-${version}-unsigned.exe`, `ipollowork-win-x64-${version}-unsigned.exe.blockmap`,
  `ipollowork-linux-x86_64-${version}.AppImage`,
].map(name => ({ name, size: 123, digest: 'sha256:' + 'a'.repeat(64), sha512: Buffer.alloc(64, 1).toString('base64') }))
const release = { tag_name: `v${version}`, target_commitish: 'a'.repeat(40), draft: true, prerelease: false, assets }

test('publication rejects old versions, test releases and incomplete drafts', () => {
  assert.equal(checkRelease(release, { tag_name: 'v1.0.2' }), version)
  for (const previous of ['v1.0.3', 'v1.0.4', 'v1.1.0', 'v2.0.0']) assert.throws(() => checkRelease(release, { tag_name: previous }), /newer/)
  assert.throws(() => checkRelease({ ...release, tag_name: 'v1.0.3-test.1' }, {}), /numeric/)
  assert.throws(() => checkRelease({ ...release, draft: false }, {}), /draft/)
  assert.throws(() => checkRelease({ ...release, prerelease: true }, {}), /prereleases/)
  assert.throws(() => checkRelease({ ...release, target_commitish: 'main' }, {}), /packaged commit/)
  for (const asset of assets) assert.throws(() => checkRelease({ ...release, assets: assets.filter(item => item !== asset) }, {}), /Missing/)
})

test('public verification rejects stale, altered or unavailable update payloads', async () => {
  const feeds = updateFeeds(version, assets)
  const respond = async url => {
    const name = new URL(url).pathname.split('/').at(-1)
    return feeds[name] ? new Response(feeds[name]) : new Response(null, { headers: { 'content-length': '123' } })
  }
  assert.deepEqual(await verifyPublishedRelease(release, 'https://example.com/', respond, feeds), { version, feeds: 2, payloads: 3, websiteDownloads: 5 })
  await assert.rejects(verifyPublishedRelease(release, 'https://example.com/', async () => new Response('{}'), feeds), /differs/)
  await assert.rejects(verifyPublishedRelease(release, 'https://example.com/', async url => String(url).endsWith('.zip') ? new Response(null, { status: 404 }) : respond(url), feeds), /unavailable/)
})
