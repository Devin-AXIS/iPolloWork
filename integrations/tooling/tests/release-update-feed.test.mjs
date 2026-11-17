import test from 'node:test'
import assert from 'node:assert/strict'
import { numericReleaseVersion, updateFeeds } from '../release-update-feed.mjs'

test('release feed requires numeric versions and complete Mac/Windows assets', () => {
  assert.equal(numericReleaseVersion('v1.0.2'), '1.0.2')
  for (const value of ['1.0.2-test.1', '1.0.2-beta', '1.0', '../1.0.2', '01.0.2']) assert.throws(() => numericReleaseVersion(value))
  const names = ['iPollo-1.0.2-mac-arm64.zip', 'iPollo-1.0.2-mac-x64.zip', 'ipollowork-win-x64-1.0.2-unsigned.exe']
  const assets = names.map(name => ({ name, size: 1234, sha512: Buffer.alloc(64, 1).toString('base64') }))
  assert.throws(() => updateFeeds('1.0.2', assets.slice(0, 1)), /Missing/)
  const feeds = updateFeeds('1.0.2', assets)
  const mac = JSON.parse(feeds['stable-mac.yml']), windows = JSON.parse(feeds['stable.yml'])
  assert.equal(mac.version, '1.0.2')
  assert.deepEqual(mac.files.map(file => file.url), names.slice(0, 2))
  assert.equal(windows.files[0].url, names[2])
  assert.throws(() => updateFeeds('1.0.2', assets.map(asset => ({ ...asset, sha512: 'bad' }))), /invalid/)
})
