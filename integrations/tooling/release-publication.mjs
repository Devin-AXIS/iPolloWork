/** Gate GitHub publication on complete update payloads and website downloads. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createManifest } from './release-mirror.mjs'
import { numericReleaseVersion, hashReleaseAsset, updateFeeds, windowsUpdateFilename, windowsUpdateUrl } from './release-update-feed.mjs'
import { stageWebsiteDownloads, websiteDownloadSources } from './release-website-downloads.mjs'
import { pluginUpdateMetadata } from './plugin-update-metadata.mjs'
import { requireUpgradeQualification, upgradeQualificationFilename } from './desktop-upgrade-qualification.mjs'

export function checkRelease(release, previous, { promotePreview = false } = {}) {
  const version = numericReleaseVersion(release.tag_name)
  const preview = promotePreview && release.draft === false && release.prerelease === true
  assert.ok(release.draft === true || preview, 'Publication must start from a draft or explicitly selected preview')
  assert.ok(release.prerelease === false || preview, 'Formal releases cannot start from draft prereleases')
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
    windows, `${windows}.blockmap`, `ipollowork-linux-x86_64-${version}.AppImage`, upgradeQualificationFilename,
  ]) assert.ok(byName.get(name)?.size > 0, `Missing release asset: ${name}`)
  return version
}

export async function requireGitHubUpgradeQualification(release, directory, manifest, previousVersion) {
  const version = numericReleaseVersion(release.tag_name)
  assert.ok(manifest.assets.some(asset => asset.name === upgradeQualificationFilename),
    `Draft release is missing ${upgradeQualificationFilename}`)
  const asset = name => {
    const found = manifest.assets.find(item => item.name === name)
    assert.ok(found, `Upgrade qualification requires ${name}`)
    return found
  }
  const targets = Object.fromEntries(['arm64', 'x64'].map(arch => [`mac-${arch}`, [
    asset(`iPollo-${version}-mac-${arch}.zip`), asset(`ipollowork-mac-${arch}-${version}.dmg`),
  ]]))
  targets['win-x64'] = [asset(windowsUpdateFilename(version))]
  return requireUpgradeQualification(join(directory, upgradeQualificationFilename), {
    version, commit: release.target_commitish, previousVersion, targets,
  })
}

export async function prepareRelease(release, directory, { existingFeeds = false, previousVersion } = {}) {
  const version = numericReleaseVersion(release.tag_name)
  const manifest = await createManifest(release, directory)
  if (!existingFeeds) await requireGitHubUpgradeQualification(release, directory, manifest, previousVersion)
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
  const feeds = ['stable-mac.yml', 'stable.yml']
  if (!existingFeeds) {
    assert.match(release.target_commitish ?? '', /^[a-f0-9]{40}$/, 'Release must identify the packaged commit')
    const compatibility = pluginUpdateMetadata(path => JSON.parse(execFileSync('git',
      ['show', `${release.target_commitish}:${path}`], { encoding: 'utf8' })))
    for (const [name, content] of Object.entries(updateFeeds(version, payloads, compatibility))) {
      await writeFile(join(directory, name), content)
    }
  }
  await stageWebsiteDownloads(version, directory)
  // Feed files are regenerated above, so their checksums must describe these final bytes.
  const sums = []
  const generated = new Set([...feeds, ...Object.keys(websiteDownloadSources(version)), 'IPOLLO-SHA256SUMS.txt'])
  for (const asset of manifest.assets.filter(asset => !generated.has(asset.name))) {
    sums.push(`${asset.sha256}  ${asset.name}`)
  }
  for (const name of [...feeds, ...Object.keys(websiteDownloadSources(version))]) sums.push(`${(await hashReleaseAsset(join(directory, name))).sha256}  ${name}`)
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
    // Repair of an existing release can retain its original relative Windows URL.
    const assetName = url => name === 'stable.yml' && url === windowsUpdateUrl(version) ? windowsUpdateFilename(version) : url
    assert.deepEqual(feed.files.map(file => assetName(file.url)).sort(), expected.sort())
    for (const file of feed.files) {
      assert.ok(/^[A-Za-z0-9+/]{86}==$/.test(file.sha512), 'Invalid update digest')
      assert.equal(file.size, source.get(assetName(file.url))?.size, 'Update payload size mismatch')
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
  if (mode === 'check') console.log(checkRelease(release, JSON.parse(await readFile(location, 'utf8')), { promotePreview: directory === '--promote-preview' }))
  else if (mode === 'prepare') {
    const existingFeeds = directory === '--existing-feeds'
    assert.ok(existingFeeds || directory, 'Preparation requires the previous Latest release record')
    const previousVersion = existingFeeds ? undefined : numericReleaseVersion(JSON.parse(await readFile(directory, 'utf8')).tag_name)
    console.log(await prepareRelease(release, location, { existingFeeds, previousVersion }))
  }
  else if (mode === 'qualify') {
    const manifest = JSON.parse(await readFile(join(location, 'mirror-manifest.json'), 'utf8'))
    const previousVersion = directory === undefined ? undefined : numericReleaseVersion(JSON.parse(await readFile(directory, 'utf8')).tag_name)
    console.log(await requireGitHubUpgradeQualification(release, location, manifest, previousVersion))
  }
  else if (mode === 'verify') {
    assert.ok(directory, 'Verification requires the directory containing the verified feeds')
    const feeds = Object.fromEntries(await Promise.all(['stable-mac.yml', 'stable.yml'].map(async name => [name, await readFile(join(directory, name), 'utf8')])))
    console.log(await verifyPublishedRelease(release, location, fetch, feeds))
  }
  else throw new Error('Use check, prepare, qualify or verify')
}
