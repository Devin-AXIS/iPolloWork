/** Gate GitHub publication on complete update payloads and website downloads. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createManifest } from './release-mirror.mjs'
import { numericReleaseVersion, hashReleaseAsset, updateFeeds, windowsUpdateFilename } from './release-update-feed.mjs'
import { stageWebsiteDownloads, websiteDownloadSources } from './release-website-downloads.mjs'

export function checkRelease(release, previous) {
  const version = numericReleaseVersion(release.tag_name)
  assert.equal(release.draft, true, 'Publication must start from a draft')
  assert.equal(release.prerelease, false, 'Formal releases cannot be prereleases')
  assert.match(release.target_commitish ?? '', /^[a-f0-9]{40}$/, 'Draft must point at the packaged commit')
  const prior = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(previous.tag_name)
    ? numericReleaseVersion(previous.tag_name).split('.').map(Number) : null
  if (prior) {
    const next = version.split('.').map(Number)
    const index = next.findIndex((part, index) => part !== prior[index])
    assert.ok(index >= 0 && next[index] > prior[index], 'Release must be newer than Latest')
  }
  const byName = new Map(release.assets.map(asset => [asset.name, asset]))
  const windows = windowsUpdateFilename(version)
  for (const name of [
    ...['arm64', 'x64'].flatMap(arch => [
      `ipollowork-mac-${arch}-${version}.dmg`, `iPollo-${version}-mac-${arch}.zip`,
      `iPollo-${version}-mac-${arch}.zip.blockmap`, `mac-${arch}-release.json`,
    ]),
    windows, `${windows}.blockmap`, `ipollowork-linux-x86_64-${version}.AppImage`,
  ]) assert.ok(byName.get(name)?.size > 0, `Missing release asset: ${name}`)
  return version
}

export async function prepareRelease(release, directory) {
  const version = numericReleaseVersion(release.tag_name)
  const manifest = await createManifest(release, directory)
  for (const arch of ['arm64', 'x64']) {
    const record = JSON.parse(await readFile(join(directory, `mac-${arch}-release.json`), 'utf8'))
    assert.equal(record.commit, release.target_commitish, 'Mac build commit mismatch')
    assert.equal(record.version, version, 'Mac build version mismatch')
    assert.equal(record.target, `mac-${arch}`)
    assert.equal(record.dirty, false, 'Mac build must come from a clean checkout')
    assert.equal(record.channel, 'stable')
    assert.equal(record.environment, 'production')
    assert.equal(record.publicUrl, 'https://github.com/Devin-AXIS/iPolloWork/releases/latest/download/')
  }
  const payloads = []
  for (const asset of manifest.assets.filter(asset => /\.(zip|exe)$/.test(asset.name))) {
    payloads.push({ name: asset.name, ...await hashReleaseAsset(join(directory, asset.name)) })
  }
  const feeds = updateFeeds(version, payloads)
  for (const [name, content] of Object.entries(feeds)) await writeFile(join(directory, name), content)
  await stageWebsiteDownloads(version, directory)
  // Feed files are regenerated above, so their checksums must describe these final bytes.
  const sums = []
  const generated = new Set([...Object.keys(feeds), ...Object.keys(websiteDownloadSources(version)), 'IPOLLO-SHA256SUMS.txt'])
  for (const asset of manifest.assets.filter(asset => !generated.has(asset.name))) {
    sums.push(`${asset.sha256}  ${asset.name}`)
  }
  for (const name of [...Object.keys(feeds), ...Object.keys(websiteDownloadSources(version))]) sums.push(`${(await hashReleaseAsset(join(directory, name))).sha256}  ${name}`)
  await writeFile(join(directory, 'IPOLLO-SHA256SUMS.txt'), sums.sort().join('\n') + '\n')
  return { version, assets: manifest.assets.length }
}

export async function verifyPublishedRelease(release, origin, fetcher = fetch, expectedFeeds) {
  const version = numericReleaseVersion(release.tag_name)
  assert.ok(origin.startsWith('https://'), 'Public update origin must use HTTPS')
  const source = new Map(release.assets.map(asset => [asset.name, asset]))
  for (const name of ['stable-mac.yml', 'stable.yml']) {
    const response = await fetcher(new URL(name, origin), { signal: AbortSignal.timeout(60000), cache: 'no-store' })
    assert.equal(response.status, 200, `Update feed unavailable: ${name}`)
    const feed = await response.json()
    if (expectedFeeds) assert.deepEqual(feed, JSON.parse(expectedFeeds[name]), `Public feed differs from verified bytes: ${name}`)
    assert.equal(feed.version, version, `Stale update feed: ${name}`)
    const expected = name === 'stable-mac.yml'
      ? [`iPollo-${version}-mac-arm64.zip`, `iPollo-${version}-mac-x64.zip`]
      : [windowsUpdateFilename(version)]
    assert.deepEqual(feed.files.map(file => file.url).sort(), expected.sort())
    for (const file of feed.files) {
      assert.ok(/^[A-Za-z0-9+/]{86}==$/.test(file.sha512), 'Invalid update digest')
      assert.equal(file.size, source.get(file.url)?.size, 'Update payload size mismatch')
      const payload = await fetcher(new URL(file.url, origin), { method: 'HEAD', signal: AbortSignal.timeout(60000) })
      assert.equal(payload.status, 200, `Update payload unavailable: ${file.url}`)
      assert.equal(Number(payload.headers.get('content-length')), file.size)
    }
  }
  for (const [name, original] of Object.entries(websiteDownloadSources(version))) {
    const response = await fetcher(new URL(name, origin), { method: 'HEAD', signal: AbortSignal.timeout(60000) })
    assert.equal(response.status, 200, `Website installer unavailable: ${name}`)
    assert.equal(Number(response.headers.get('content-length')), source.get(original)?.size, `Website installer size mismatch: ${name}`)
  }
  return { version, feeds: 2, payloads: 3, websiteDownloads: 5 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, file, location, directory] = process.argv.slice(2)
  const release = JSON.parse(await readFile(file, 'utf8'))
  if (mode === 'check') console.log(checkRelease(release, JSON.parse(await readFile(location, 'utf8'))))
  else if (mode === 'prepare') console.log(await prepareRelease(release, location))
  else if (mode === 'verify') {
    assert.ok(directory, 'Verification requires the directory containing the verified feeds')
    const feeds = Object.fromEntries(await Promise.all(['stable-mac.yml', 'stable.yml'].map(async name => [name, await readFile(join(directory, name), 'utf8')])))
    console.log(await verifyPublishedRelease(release, location, fetch, feeds))
  }
  else throw new Error('Use check, prepare or verify')
}
