import { execFileSync } from 'node:child_process'
import yaml from 'js-yaml'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readMarket } from '../src/host/market.ts'

test('catalog resolves pinned native installs and uses the live DSH inventory', async () => {
  const pkg = '@deepseek-ai/dsh-experimental-session-titles-bundle'
  const state = await readMarket('catalog/index.json', { listBundles: async () => [{ name: pkg, installed: true, enabled: false, version: '0.2.2-rc.2', rows: [{ moduleName: pkg }] }] }, '0.2.2-rc.2', 'zh', 1048576)
  const titles = state.items.find(item => item.name === pkg)!
  assert.equal(titles.spec, pkg + '@0.2.2-rc.2')
  assert.equal(titles.installed, true)
  assert.equal(titles.enabled, false)
  assert.deepEqual(titles.resources, [pkg])
  assert.equal(state.items.some(item => item.name === '@xmanrui/dsh-im'), false)
  assert.equal(state.items.find(item => item.name === '@deepseek-ai/dsh-experimental-session-titles-bundle')?.compatible, true)
  const newer = await readMarket('catalog/index.json', { listBundles: async () => [] }, '0.3.0', 'en', 1048576)
  assert.equal(newer.items.find(item => item.name === '@deepseek-ai/dsh-experimental-session-titles-bundle')?.compatible, false)
})
test('market artwork uses the same package metadata as the native installed page', async () => {
  const icon = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')
  const name = 'deepseek-idesign'
  const state = await readMarket('catalog/index.json', { listBundles: async () => [{ name, installed: true, enabled: true, meta: { icon }, rows: [] }] }, '0.2.2-rc.2', 'zh', 1048576)
  assert.equal(state.items.find(item => item.name === name)?.icon, icon)
})
test('invalid operator catalog and duplicate identities fail instead of showing stale entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-catalog-'))
  try {
    const file = join(dir, 'index.json')
    await writeFile(file, '{invalid')
    await assert.rejects(readMarket(file, { listBundles: async () => [] }, '0.2.2-rc.2', 'en', 1000), { code: 'IPW_INVALID_CATALOG' })
    await writeFile(file, JSON.stringify({ format: 1, title: 'test', plugins: [{ name: 'same' }, { name: 'same' }] }))
    await assert.rejects(readMarket(file, { listBundles: async () => [] }, '0.2.2-rc.2', 'en', 1000), { code: 'IPW_INVALID_CATALOG' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('bundles shipped by DSH open native details instead of offering a duplicate installation', async () => {
  const state = await readMarket('catalog/index.json', { listBundles: async () => [{ name: '@deepseek-ai/dsh-experimental-session-titles-bundle', availability: 'installation', installed: false, enabled: false, version: '0.2.2-rc.2', rows: [] }] }, '0.2.2-rc.2', 'zh', 1048576)
  const titles = state.items.find(item => item.name === '@deepseek-ai/dsh-experimental-session-titles-bundle')!
  assert.equal(titles.installed, false)
  assert.equal(titles.providedByDsh, true)
  assert.equal(state.categories[0]?.title, '效率')
})


test('the default market shows Design and Video first without installing or enabling them', async () => {
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, '0.2.2-rc.3', 'zh', 1048576)
  assert.deepEqual(state.items.slice(0, 2).map(item => item.title), ['Design', 'Video'])
  for (const item of state.items.slice(0, 2)) {
    assert.equal(item.version, item.name === 'deepseek-idesign' ? '1.0.0-beta.38' : '1.0.0-beta.24')
    assert.equal(item.categoryTitle, '创作')
    assert.equal(item.compatible, true)
    assert.equal(item.installed, false)
    assert.equal(item.enabled, false)
    assert(item.spec.startsWith(`file:${resolve('catalog/packages')}`))
    assert((await readFile(item.spec.slice(5))).byteLength > 0)
  }
})

test('a custom operator catalog keeps its declared source for the same package versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-operator-'))
  try {
    const path = join(dir, 'index.json')
    await writeFile(path, await readFile('catalog/index.json'))
    const state = await readMarket(path, { listBundles: async () => [] }, '0.2.2-rc.3', 'en', 1048576)
    assert.deepEqual(state.items.slice(0, 2).map(item => item.spec), ['deepseek-idesign@1.0.0-beta.38', 'deepseek-ivideo@1.0.0-beta.24'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('bundled installation specs use a retained content-addressed cache when the host supplies one', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipw-release-cache-'))
  try {
    const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, '0.2.2-rc.3', 'en', 1048576, directory)
    const source = await readMarket('catalog/index.json', { listBundles: async () => [] }, '0.2.2-rc.3', 'en', 1048576)
    for (const item of state.items.slice(0, 2)) {
      assert.match(item.spec, /[a-f0-9]{64}\.tgz$/)
      assert(item.spec.startsWith(`file:${directory}`))
      assert.deepEqual(await readFile(item.spec.slice(5)), await readFile(source.items.find(entry => entry.name === item.name)!.spec.slice(5)))
    }
    const again = await readMarket('catalog/index.json', { listBundles: async () => [] }, '0.2.2-rc.3', 'en', 1048576, directory)
    assert.equal(again.items[0]?.spec, state.items[0]?.spec)
    await writeFile(state.items[0]!.spec.slice(5), 'damaged cache')
    await assert.rejects(readMarket('catalog/index.json', { listBundles: async () => [] }, '0.2.2-rc.3', 'en', 1048576, directory), { code: 'IPW_INVALID_CATALOG' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('shipped Studio bundles select their host authentication API for editor assets', async () => {
  const releases = JSON.parse(await readFile('catalog/bundled-releases.json', 'utf8')) as { plugins: { name: string; file: string }[] }
  for (const release of releases.plugins.filter(item => ['deepseek-idesign', 'deepseek-ivideo'].includes(item.name))) {
    const document = execFileSync('tar', ['-xOzf', join('catalog/packages', release.file), 'package/cordis.patch.yml'], { encoding: 'utf8' })
    const patch = yaml.load(document) as { insert: { name: string; inject?: string[] }[] }[]
    const row = patch.flatMap(item => item.insert).find(item => item.name === release.name)
    assert(row)
    assert(!row.inject?.includes('connection.authentication'))
    const host = execFileSync('tar', ['-xOzf', join('catalog/packages', release.file), 'package/lib/index.js'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    assert(host.includes('ConnectionAuthentication'))
    assert(host.includes('connection.authentication'))
    assert(host.includes('admit(req)'))
  }
})

// npm delivery keeps the verified archives in pinned resource dependencies.
test('npm delivery downloads optional Studio archives only when installed', async () => {
  const { rename } = await import('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), 'ipw-npm-market-'))
  const releases = JSON.parse(await readFile('catalog/bundled-releases.json', 'utf8')) as { plugins: { name: string; file: string }[] }
  const moved = releases.plugins.filter(item => ['deepseek-idesign', 'deepseek-ivideo'].includes(item.name)).map(item => resolve('catalog/packages', item.file))
  for (const file of moved) await rename(file, file + '.resource-test')
  try {
    const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, '0.2.2-rc.3', 'en', 1048576, directory)
    assert.equal(state.items[0]?.version, '1.0.0-beta.38')
    assert.equal(state.items[1]?.version, '1.0.0-beta.24')
    for (const item of state.items.slice(0, 2)) assert(item.spec.startsWith('https://github.com/Devin-AXIS/iPolloWork/releases/download/v1.0/'))
  } finally { for (const file of moved) await rename(file + '.resource-test', file); await rm(directory, { recursive: true, force: true }) }
})


test('dedicated desktop prefers the checked bundled Studio archives', async () => {
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, '0.2.2-rc.3', 'en', 1048576, undefined, true)
  for (const item of state.items.slice(0, 2)) {
    assert.equal(item.installed, false)
    assert(item.spec.startsWith('file:'))
    assert(item.spec.endsWith('.tgz'))
  }
})

test('service-curated entries merge with bundled plugins and use the official pinned source resolver', async () => {
  const entry = { name: '@publisher/plugin', title: 'External', metadata: { category: 'productivity' }, versions: [{ version: '1.0.0', publishTimestamp: 1, source: { type: 'git', url: 'https://github.com/publisher/plugin', commit: 'a'.repeat(40), path: 'packages/plugin' } }] }
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, '0.2.2-rc.3', 'en', 1048576, undefined, false, [entry])
  assert.deepEqual(state.items.slice(0, 2).map(item => item.title), ['Design', 'Video'])
  assert.equal(state.items.at(-1)?.spec, 'git+https://github.com/publisher/plugin.git#' + 'a'.repeat(40) + '&path:/packages/plugin')
  assert.equal(state.items.at(-1)?.categoryTitle, 'Productivity')
  await assert.rejects(readMarket('catalog/index.json', { listBundles: async () => [] }, '0.2.2-rc.3', 'en', 1048576, undefined, false, [{ ...entry, versions: [] }]), { code: 'IPW_INVALID_CATALOG' })
})
