import test from 'node:test'
import assert from 'node:assert/strict'
import { marketSource, discoveryEntries } from '../src/host/market-discovery.ts'

test('discovery accepts GitHub and npm references, and rejects credentials and arbitrary endpoints', () => {
  assert.equal(marketSource(' @scope/plugin '), '@scope/plugin')
  assert.equal(marketSource('https://www.npmjs.com/package/@scope/plugin'), '@scope/plugin')
  assert.equal(marketSource('https://github.com/owner/repo.git/'), 'https://github.com/owner/repo')
  for (const source of ['https://localhost/repo/plugin', 'https://user:secret@github.com/a/b', 'https://github.com/a/b?x=1', 'http://github.com/a/b', '@scope/plugin\nother', 'https://github.com/a/b/tree/main']) {
    assert.throws(() => marketSource(source), { code: 'MARKET_INVALID_SOURCE' })
  }
})

test('official discovery metadata selects a compatible pinned version and preserves author, locale and icon', () => {
  const icon = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64')
  const version = (version: string, dsh: string) => ({ version, publishTimestamp: 123, source: { type: 'git', url: 'https://github.com/a/b', commit: 'a'.repeat(40), path: 'plugins/example' }, engines: { dsh } })
  const entries = discoveryEntries([{ name: '@a/plugin', metadata: { sortKeys: { npm_weekly_downloads: 123 } }, title: { en: 'Plugin', zh: '插件' }, icon, author: 'Author', versions: [version('3.0.0', '>=0.3'), version('2.0.0-beta.1', '>=0.2.2-rc.3'), version('1.0.0', '>=0.2.2-rc.3')] }], 'zh', '0.2.2-rc.3')
  assert.equal(entries[0]?.title, '插件')
  assert.equal(entries[0]?.versions[0].version, '1.0.0')
  assert.equal(entries[0]?.icon, icon)
  assert.equal(entries[0]?.description, undefined)
  assert.equal(entries[0]?.versions[0].source.type, 'git')
  assert.equal(discoveryEntries([{ name: 'incompatible', versions: [version('1.0.0', '>=0.3')] }], 'en', '0.2.2-rc.3').length, 0)
})
