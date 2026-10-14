import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Registry } from '../src/core/registry'
import { PluginScope } from '../src/core/plugin-scope'
import { readPackage } from '../src/server/plugin-packages'
import { zipSync, strToU8 } from 'fflate'
import { decodePluginArchive } from '../src/core/plugin-archive'

test('ZIP import accepts a wrapped plugin, ignores OS metadata and rejects unsafe or oversized content', async () => {
  const files = {
    'sample/package.json': strToU8('{}'),
    'sample/client.js': strToU8('export function activate() {}'),
    '__MACOSX/._sample': strToU8('metadata'),
  }
  const good = await decodePluginArchive(zipSync(files))
  assert.deepEqual(good.files.map((f) => f.name).sort(), ['client.js', 'package.json'])
  await assert.rejects(decodePluginArchive(zipSync({ '../package.json': strToU8('{}') })), /不安全/)
  await assert.rejects(
    decodePluginArchive(zipSync({ 'client.js': strToU8('code') })),
    /package.json/,
  )
  await assert.rejects(
    decodePluginArchive(
      zipSync({ 'a/package.json': strToU8('{}'), 'b/package.json': strToU8('{}') }),
    ),
    /一个 package.json/,
  )
  await assert.rejects(
    decodePluginArchive(
      zipSync({ 'package.json': strToU8('{}'), 'huge.js': new Uint8Array(5_000_001) }),
    ),
    /5 MB/,
  )
  await assert.rejects(decodePluginArchive(strToU8('not a zip')), /无法解压/)
})

test('plugin scope rolls back only owned entries and cleans all effects even when one fails', () => {
  const registry = new Registry<{ id: string }>()
  registry.register({ id: 'core' })
  const scope = new PluginScope(),
    calls: string[] = []
  const fields = scope.registry(registry, ['custom'])
  assert.throws(() => fields.register({ id: 'undeclared' }), /未声明/)
  fields.register({ id: 'custom' })
  assert.throws(() => fields.register({ id: 'custom' }), /重复/)
  scope.effect(() => {
    calls.push('first')
  })
  scope.effect(() => {
    calls.push('last')
    throw new Error('cleanup failed')
  })
  assert.throws(() => scope.dispose(), AggregateError)
  assert.deepEqual(calls, ['last', 'first'])
  assert.deepEqual(registry.list(), [{ id: 'core' }])
  scope.dispose()
  assert.throws(() => fields.register({ id: 'custom' }), /停用/)
  assert.throws(
    () =>
      scope.effect(() => {
        calls.push('late')
      }),
    /停用/,
  )
  assert.equal(calls.at(-1), 'late')
})

test('package reader verifies entries, changes digest with code, rejects traversal and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ipollo-package-'))
  const pkg = {
    name: '@example/test',
    version: '1.0.0',
    type: 'module',
    ipolloData: {
      id: 'test-view',
      name: '测试视图',
      description: 'test',
      protocol: 1,
      categories: ['views'],
      contributes: { views: ['test-view'] },
      entrypoints: { client: 'client.js' },
    },
  }
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg))
    await assert.rejects(readPackage(root), /入口不存在/)
    await writeFile(join(root, 'client.js'), 'export function activate() {}')
    const first = await readPackage(root)
    await writeFile(join(root, 'client.js'), 'export function activate(ctx) {}')
    assert.notEqual((await readPackage(root)).manifest.digest, first.manifest.digest)
    try {
      await symlink(join(root, 'client.js'), join(root, 'link.js'))
      await assert.rejects(readPackage(root), /软链接/)
      await rm(join(root, 'link.js'))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EPERM' && process.platform === 'win32')) throw error
      console.info('Symlink creation requires Windows developer mode; traversal and digest checks still run.')
    }
    pkg.ipolloData.entrypoints.client = '../client.js'
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg))
    await assert.rejects(readPackage(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
