import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { numericReleaseVersion, updateFeeds } from '../release-update-feed.mjs'
import { pluginUpdateMetadata } from '../plugin-update-metadata.mjs'

const readRepositoryJson = path => JSON.parse(readFileSync(new URL('../../../' + path, import.meta.url), 'utf8'))

test('release feed requires numeric versions and complete Mac/Windows assets', () => {
  assert.equal(numericReleaseVersion('v1.0.2'), '1.0.2')
  for (const value of ['1.0.2-test.1', '1.0.2-beta', '1.0', '../1.0.2', '01.0.2']) assert.throws(() => numericReleaseVersion(value))
  const names = ['iPollo-1.0.2-mac-arm64.zip', 'iPollo-1.0.2-mac-x64.zip', 'ipollowork-win-x64-1.0.2-unsigned.exe']
  const assets = names.map(name => ({ name, size: 1234, sha512: Buffer.alloc(64, 1).toString('base64') }))
  assert.throws(() => updateFeeds('1.0.2', assets.slice(0, 1)), /Missing/)
  const compatibility = pluginUpdateMetadata(readRepositoryJson)
  const feeds = updateFeeds('1.0.2', assets, compatibility)
  const mac = JSON.parse(feeds['stable-mac.yml']), windows = JSON.parse(feeds['stable.yml'])
  assert.equal(mac.version, '1.0.2')
  assert.deepEqual(mac.files.map(file => file.url), names.slice(0, 2))
  const windowsUrl = 'https://github.com/Devin-AXIS/iPolloWork/releases/download/v1.0.2/' + names[2]
  assert.equal(windows.files[0].url, windowsUrl)
  assert.equal(windows.path, windowsUrl)
  const priorBlockmap = windowsUrl.replaceAll('1.0.2', '1.0.1') + '.blockmap'
  assert.equal(priorBlockmap, 'https://github.com/Devin-AXIS/iPolloWork/releases/download/v1.0.1/ipollowork-win-x64-1.0.1-unsigned.exe.blockmap')
  assert.deepEqual(mac.ipolloPluginCompatibility, compatibility)
  assert.deepEqual(windows.ipolloPluginCompatibility, compatibility)
  assert.throws(() => updateFeeds('1.0.2', assets.map(asset => ({ ...asset, sha512: 'bad' }))), /invalid/)
})

test('retired market entries keep verified archives available to existing installations', () => {
  const catalog = 'plugins/ipollowork-suite/catalog/'
  const retired = readRepositoryJson(catalog + 'retired-plugins.json')
  const { plugins: market } = readRepositoryJson(catalog + 'index.json')
  const { plugins: archives } = readRepositoryJson(catalog + 'bundled-releases.json')
  const metadata = pluginUpdateMetadata(readRepositoryJson)
  assert.ok(retired.length > 0)
  for (const name of retired) {
    assert.ok(!market.some(entry => entry.name === name))
    const archive = archives.find(entry => entry.name === name)
    assert.equal(archive?.upgradeOnly, true)
    assert.deepEqual(metadata.plugins.find(entry => entry.name === name),
      { name, version: archive.version, sha256: archive.sha256 })
  }
  assert.throws(() => pluginUpdateMetadata(path => path.endsWith('retired-plugins.json') ? [] : readRepositoryJson(path)),
    /Unreviewed desktop plugin archive/)
})
