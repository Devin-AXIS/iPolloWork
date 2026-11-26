import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readMarket } from '../src/host/market.ts'
import { bundledArchiveOffer, cacheBundledArchive } from '../src/host/market-releases.ts'
import semver from 'semver'

const runtimeVersion=JSON.parse(await readFile(new URL('../../../integrations/runtime/upstream.json',import.meta.url),'utf8')).npmVersion
const shipped=JSON.parse(await readFile('catalog/bundled-releases.json','utf8')) as {plugins:{name:string;version:string}[]}
const studioVersion=(name:string)=>shipped.plugins.find(item=>item.name===name)!.version

test('catalog resolves pinned native installs and uses the live DSH inventory', async () => {
  const pkg = '@deepseek-ai/dsh-experimental-session-titles-bundle'
  const state = await readMarket('catalog/index.json', { listBundles: async () => [{ name: pkg, installed: true, enabled: false, version: '0.2.2-rc.2', rows: [{ moduleName: pkg }] }] }, runtimeVersion, 'zh', 1048576)
  const titles = state.items.find(item => item.name === pkg)!
  assert.equal(titles.spec, pkg + '@' + runtimeVersion)
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
test('an older installed version does not hide the current catalog artwork', async () => {
  const name = '@ipollo/dsh-media-studio'
  const oldIcon = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64')
  const state = await readMarket('catalog/index.json', { listBundles: async () => [{ name, installed: true, enabled: true, version: '0.1.0', meta: { icon: oldIcon }, rows: [] }] }, runtimeVersion, 'zh', 1048576)
  const current = state.items.find(item => item.name === name)!
  assert(current.icon && current.icon !== oldIcon)
  assert.equal(current.installedVersion, '0.1.0')
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
  const state = await readMarket('catalog/index.json', { listBundles: async () => [{
    name: '@deepseek-ai/dsh-experimental-session-titles-bundle', availability: 'installation', installed: false,
    enabled: false, version: '0.2.2-rc.2', rows: [],
    meta: { title: { en: 'Conversation-following titles', zh: '随对话更新的标题' } },
  }] }, '0.2.2-rc.2', 'zh', 1048576)
  const titles = state.items.find(item => item.name === '@deepseek-ai/dsh-experimental-session-titles-bundle')!
  assert.equal(titles.installed, false)
  assert.equal(titles.providedByDsh, true)
  assert.equal(titles.enableOnInstall, undefined)
  assert.equal(titles.title, '随对话更新的标题')
  assert.match(titles.description, /会话标题/)
  assert.equal(state.categories[0]?.title, '效率')
})

test('market installs activate Session Titles when the runtime does not already provide it', async () => {
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, runtimeVersion, 'zh', 1048576)
  const titles = state.items.find(item => item.name === '@deepseek-ai/dsh-experimental-session-titles-bundle')!
  assert.equal(titles.providedByDsh, false)
  assert.equal(titles.enableOnInstall, true)
})


test('Chinese market copy covers all bundled entries and earlier English-only service records', async () => {
  const manager = { listBundles: async () => [] }
  const current = await readMarket('catalog/index.json', manager, runtimeVersion, 'zh', 1048576)
  assert(current.items.length > 0)
  for (const item of current.items) assert.match(item.description, /\p{Script=Han}/u, item.name)
  const index = JSON.parse(await readFile('catalog/index.json', 'utf8'))
  const acme = index.plugins.find((entry: { name: string }) => entry.name === '@ipollo/dsh-acme-research')
  const serviceRecords = [{ ...acme, description: 'Minimal independent plugin package for local development.' }]
  const zh = await readMarket('catalog/index.json', manager, runtimeVersion, 'zh', 1048576, { curated: serviceRecords })
  const en = await readMarket('catalog/index.json', manager, runtimeVersion, 'en', 1048576, { curated: serviceRecords })
  assert.match(zh.items.find(item => item.name === acme.name)!.description, /本地开发和测试/)
  assert.equal(en.items.find(item => item.name === acme.name)!.description, serviceRecords[0]!.description)
})

test('the default market shows Design and Video first without installing or enabling them', async () => {
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, runtimeVersion, 'zh', 1048576)
  assert.deepEqual(state.items.slice(0, 2).map(item => item.title), ['设计工作台', '视频工作台'])
  for (const item of state.items.slice(0, 2)) {
    assert.equal(item.version,studioVersion(item.name))
    assert.equal(item.categoryTitle, '创作')
    assert.equal(item.compatible, true)
    assert.equal(item.installed, false)
    assert.equal(item.enabled, false)
    assert(item.spec.startsWith(`file:${resolve('catalog/packages')}`))
    assert((await readFile(item.spec.slice(5))).byteLength > 0)
  }
})

test('workspace features each resolve to a distinct, verified market archive', async () => {
  const installAndEnable = new Set(['@ipollo/dsh-markdown-editor', '@ipollo/dsh-excel-editor', '@ipollo/dsh-conversation-export'])
  const names = ['markdown-editor', 'excel-editor', 'conversation-export', 'task-templates',
    'reference-preparation', 'legacy-workspace-import'].map(id => `@ipollo/dsh-${id}`)
  const releases = JSON.parse(await readFile('catalog/bundled-releases.json', 'utf8')) as {
    plugins: { name: string; version: string; sha256: string }[]
  }
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, runtimeVersion, 'zh', 1048576)
  const items = state.items.filter(item => names.includes(item.name))
  assert.equal(items.length, names.length)
  assert.equal(state.items.some(item => item.name === '@ipollo/dsh-workspace-tools'), false)
  assert.equal(new Set(items.map(item => item.spec)).size, names.length)
  for (const item of items) {
    assert(item.compatible && !item.installed && !item.enabled)
    assert.equal(item.enableOnInstall === true, installAndEnable.has(item.name))
    assert.equal(item.category, 'productivity')
    assert(item.title !== item.name && item.icon)
    assert(item.spec.startsWith(`file:${resolve('catalog/packages')}`))
    const archive = item.spec.slice(5)
    const release = releases.plugins.find(record => record.name === item.name)
    assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), release?.sha256)
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
    assert.equal(manifest.name, item.name)
    assert.equal(manifest.version, item.version)
    assert.equal(manifest.engines.dsh, runtimeVersion)
    assert(!Object.keys(manifest.dependencies ?? {}).some(name => names.includes(name)))
  }
})

test('a custom operator catalog keeps its declared source for the same package versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-operator-'))
  try {
    const path = join(dir, 'index.json')
    await writeFile(path, await readFile('catalog/index.json'))
    const state = await readMarket(path, { listBundles: async () => [] }, runtimeVersion, 'en', 1048576)
    assert.deepEqual(state.items.slice(0, 2).map(item => item.spec), ['deepseek-idesign','deepseek-ivideo'].map(name=>`${name}@${studioVersion(name)}`))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('preview skips the native inventory and verifies only the archive requested for installation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipw-release-cache-'))
  try {
    const manager = { listBundles: async () => assert.fail('preview must not read the installed inventory') }
    const state = await readMarket('catalog/index.json', manager, runtimeVersion, 'en', 1048576, { inventory: [] })
    assert.deepEqual(await readdir(directory), [])
    const item = state.items[0]!
    assert(item.archiveSha256)
    const signal = new AbortController().signal
    const target = { spec: item.spec, archiveSha256: item.archiveSha256 }
    const restored = await cacheBundledArchive(target, directory, signal)
    assert.equal(restored, `file:${join(directory, item.archiveSha256 + '.tgz')}`)
    assert.deepEqual(await readdir(directory), [item.archiveSha256 + '.tgz'])
    assert.deepEqual(await readFile(restored.slice(5)), await readFile(item.spec.slice(5)))
    await writeFile(restored.slice(5), 'damaged cache')
    const badSource = join(directory, 'bad.tgz')
    await writeFile(badSource, 'wrong bytes')
    await assert.rejects(cacheBundledArchive({ ...target, spec: 'file:' + badSource }, directory, signal),
      { code: 'IPW_MARKET_ARCHIVE_UNAVAILABLE' })
    assert.equal(await cacheBundledArchive(target, directory, signal), restored)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('shipped Studio bundles select their host authentication API for editor assets', async () => {
  const releases = JSON.parse(await readFile('catalog/bundled-releases.json', 'utf8')) as { plugins: { name: string; file: string }[] }
  const skill = 'skills/ipollowork-reference-analyzer/SKILL.md'
  const expected = (await readFile('../reference-context/business/' + skill, 'utf8')).replaceAll('\r\n', '\n')
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
    assert(host.includes('registerProvider'))
    assert(host.includes('ipollowork-reference-analyzer'))
    assert.equal(execFileSync('tar', ['-xOzf', join('catalog/packages', release.file), 'package/' + skill], { encoding: 'utf8' }), expected)
  }
})

// Slim distributions resolve the same checked archives on their actual publication tag.
test('npm delivery downloads optional Studio archives only when installed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipw-npm-market-'))
  const releases = JSON.parse(await readFile('catalog/bundled-releases.json', 'utf8')) as { plugins: {name:string;version:string;file:string;sha256:string;tag?:string}[] }
  try {
    for(const release of releases.plugins.filter(item=>['deepseek-idesign','deepseek-ivideo'].includes(item.name))){
      const tag = release.tag ?? 'fixture-published'
      const missing = join(directory, release.file)
      if (!release.tag) assert.equal((await bundledArchiveOffer(release, missing)).spec, 'file:' + missing)
      const target = await bundledArchiveOffer({ ...release, tag }, missing)
      assert.equal(target.spec, `https://github.com/Devin-AXIS/iPolloWork/releases/download/${tag}/${release.file}`)
      assert.equal(target.archiveSha256, release.sha256)
    }
    const local=releases.plugins.find(item=>item.name.startsWith('@ipollo/dsh-'))!
    const missing = join(directory, local.file)
    assert.equal((await bundledArchiveOffer({ ...local, tag: 'fixture-published' }, missing)).spec, 'file:' + missing)
  }finally{await rm(directory,{recursive:true,force:true})}
})


test('dedicated desktop prefers the checked bundled Studio archives', async () => {
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, runtimeVersion, 'en', 1048576)
  for (const item of state.items.slice(0, 2)) {
    assert.equal(item.installed, false)
    assert(item.spec.startsWith('file:'))
    assert(item.spec.endsWith('.tgz'))
  }
})

test('the default market keeps retired entries hidden even if the service still advertises them', async () => {
  const names = JSON.parse(await readFile('catalog/retired-plugins.json', 'utf8')) as string[]
  const curated = names.map(name => ({
    name, title: name, metadata: { category: 'productivity' },
    versions: [{ version: '1.0.0', publishTimestamp: 1, source: { type: 'npm' }, engines: { dsh: runtimeVersion } }],
  }))
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] },
    runtimeVersion, 'en', 1048576, { curated })
  assert(state.items.some(item => item.name === 'deepseek-idesign'))
  assert(state.items.some(item => item.name === 'deepseek-ivideo'))
  assert(state.items.every(item => !names.includes(item.name)))
})

test('service-curated entries merge with bundled plugins and use the official pinned source resolver', async () => {
  const entry = { name: '@publisher/plugin', title: 'External', metadata: { category: 'productivity' }, versions: [{ version: '1.0.0', publishTimestamp: 1, source: { type: 'git', url: 'https://github.com/publisher/plugin', commit: 'a'.repeat(40), path: 'packages/plugin' } }] }
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, runtimeVersion, 'en', 1048576, { curated: [entry] })
  assert.deepEqual(state.items.slice(0, 2).map(item => item.title), ['Design Studio', 'Video Studio'])
  assert.equal(state.items.at(-1)?.spec, 'git+https://github.com/publisher/plugin.git#' + 'a'.repeat(40) + '&path:/packages/plugin')
  assert.equal(state.items.at(-1)?.categoryTitle, 'Productivity')
  await assert.rejects(readMarket('catalog/index.json', { listBundles: async () => [] }, runtimeVersion, 'en', 1048576, { curated: [{ ...entry, versions: [] }] }), { code: 'IPW_INVALID_CATALOG' })
})

test('the default market offers a compatible newer archive for an existing archive install', async () => {
  const name = 'deepseek-ivideo'
  const installed = {
    name, installed: true, enabled: false, version: '1.0.0-beta.22', source: 'file:/fixtures/previous.tgz',
    availability: 'profile' as const, rows: [],
  }
  const range = runtimeVersion,nextVersion=semver.inc(studioVersion(name),'minor')!,laterVersion=semver.inc(nextVersion,'major')!
  const publication = (version: string, dsh: string) => ({
    name, version, dsh, tag: 'video-test', sha256: 'a'.repeat(64), file: `${name}-${version}-aaaaaaaaaaaa.tgz`,
  })
  const published = [publication(laterVersion, '0.0.0'), publication(nextVersion, range)]
  const item = async (current = installed, releases = published) => (await readMarket(
    'catalog/index.json', { listBundles: async () => [current] }, runtimeVersion, 'en', 1048576,
    { published: releases },
  )).items.find(item => item.name === name)!
  const remote = await item()
  assert.equal(remote.update, 'archive')
  assert.equal(remote.version, nextVersion)
  assert.equal(remote.installedVersion, installed.version)
  assert.equal(remote.enabled, false)
  assert.equal(remote.spec, `https://github.com/Devin-AXIS/iPolloWork/releases/download/video-test/deepseek-ivideo-${nextVersion}-aaaaaaaaaaaa.tgz`)
  assert.equal((await item(installed, [])).version, studioVersion(name))
  assert.equal((await item({ ...installed, version: nextVersion })).update, undefined)
  assert.equal((await item({ ...installed, version: laterVersion })).update, undefined)
  assert.equal((await item({ ...installed, source: '1.0.0-beta.22' })).update, undefined)
})

test('an older or incompatible service catalog cannot replace a newer reviewed bundled native plugin', async () => {
  const name = '@ipollo/dsh-decision-intelligence', current = studioVersion(name)
  const entry = (version: string, dsh: string) => ({ name, title: 'Service catalog', metadata: { category: 'productivity' },
    versions: [{ version, publishTimestamp: 1, source: { type: 'npm' }, engines: { dsh } }] })
  for (const dsh of [runtimeVersion, '0.2.2-rc.3']) {
    const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, runtimeVersion, 'en', 1048576,
      { curated: [entry('1.0.2', dsh)] })
    const item = state.items.find(item => item.name === name)!
    assert.equal(item.version, current)
    assert.equal(item.compatible, true)
    assert(item.spec.startsWith('file:'))
  }
  const newer = semver.inc(current, 'patch')!
  const state = await readMarket('catalog/index.json', { listBundles: async () => [] }, runtimeVersion, 'en', 1048576,
    { curated: [entry(newer, runtimeVersion)] })
  assert.equal(state.items.find(item => item.name === name)?.version, newer)
})

test('market Git updates use the native same-repository pin contract', async () => {
  const name = 'git-plugin'
  const url = 'https://github.com/publisher/plugin'
  const entry = { name, title: 'Git', versions: [{ version: '2.0.0', publishTimestamp: 1, source: { type: 'git', url, commit: 'b'.repeat(40), path: 'plugin' } }] }
  const from = `git+${url}.git#${'a'.repeat(40)}&path:/`
  const item = async (path: string) => (await readMarket('catalog/index.json', {
    listBundles: async () => [{
      name, installed: true, enabled: true, availability: 'profile', version: '1.0.0', update: 'git', source: from + path, rows: [],
    }],
  }, runtimeVersion, 'en', 1048576, { curated: [entry] })).items.find(item => item.name === name)
  assert.equal((await item('plugin'))?.update, 'git')
  assert.equal((await item('other'))?.update, undefined)
})

test('live catalog can replace a bundled listing in place and use its pinned installation source', async () => {
  const manager = { listBundles: async () => [] };
  const read = (entries: unknown[] = []) => readMarket('catalog/index.json', manager, runtimeVersion, 'en', 1048576, { curated: entries });
  const baseline = await read();
  const target = baseline.items.findIndex(item => item.name === '@ipollo/dsh-acme-research');
  const first = baseline.items[target]!;
  const entry = { name: first.name, title: 'Online introduction', metadata: { category: 'creative' }, versions: [{ version: first.version, publishTimestamp: 2, source: { type: 'git', url: 'https://github.com/example/bundle', commit: 'b'.repeat(40) } }] };
  const state = await read([entry]);
  assert.equal(state.items.length, baseline.items.length);
  assert.equal(state.items[target]?.title, entry.title);
  assert.match(state.items[target]!.spec, /github\.com\/example\/bundle/);
});
