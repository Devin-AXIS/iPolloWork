import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { repairProfileRuntime } from '../src/profile-runtime-repair.ts'
import { runtimeFixture, writePackage } from './runtime-fixture.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('backs up obsolete hoisted core packages, preserving plugin files, credentials and conversations', () => {
  const root = mkdtempSync(join(tmpdir(), 'ipollo-core-repair-'))
  roots.push(root)
  const runtime = join(root, 'runtime')
  const profile = join(root, 'profile')
  mkdirSync(profile)
  const descriptor = runtimeFixture(runtime, '0.2.2-rc.3')
  const name = '@deepseek-ai/dsh-llm'
  const entry = { name, version: '0.2.2-rc.3', path: `node_modules/${name}` }
  writePackage(join(runtime, 'node_modules'), name, { version: entry.version })
  writePackage(join(profile, 'node_modules'), name, { version: '0.2.0-rc.1' }, 'old model core')
  writePackage(join(profile, 'node_modules'), 'dsh-codex', { version: '0.3.2' }, 'plugin bytes')
  writeFileSync(join(profile, 'cordis.patch.yml'), '# custom settings\n[]\n')
  writeFileSync(join(profile, '.credentials.yaml'), 'fixture credentials')
  writeFileSync(join(profile, 'conversation.jsonl'), 'fixture conversation')
  const metadata = { ...descriptor, sharedPackages: [...descriptor.sharedPackages, entry] }
  const backup = repairProfileRuntime(profile, runtime, metadata)
  expect(backup).toBeDefined()
  expect(existsSync(join(profile, 'node_modules', name))).toBe(false)
  expect(readFileSync(join(backup!, 'node_modules', name, 'index.js'), 'utf8')).toBe('old model core')
  expect(JSON.parse(readFileSync(join(backup!, 'repair.json'), 'utf8'))).toMatchObject({ status: 'complete', moved: [name] })
  expect(readFileSync(join(profile, 'node_modules/dsh-codex/index.js'), 'utf8')).toBe('plugin bytes')
  expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('# custom settings\n[]\n')
  expect(readFileSync(join(profile, '.credentials.yaml'), 'utf8')).toBe('fixture credentials')
  expect(readFileSync(join(profile, 'conversation.jsonl'), 'utf8')).toBe('fixture conversation')
  expect(repairProfileRuntime(profile, runtime, metadata)).toBeUndefined()
})

it('keeps matching core copies and unrelated plugin dependencies untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'ipollo-core-repair-'))
  roots.push(root)
  const runtime = join(root, 'runtime')
  const profile = join(root, 'profile')
  mkdirSync(profile)
  const descriptor = runtimeFixture(runtime)
  writePackage(join(profile, 'node_modules'), '@deepseek-ai/cordis')
  writePackage(join(profile, 'node_modules'), '@ipollo/dsh-suite', { version: '0.0.1' })
  expect(repairProfileRuntime(profile, runtime, descriptor)).toBeUndefined()
  expect(existsSync(join(profile, 'node_modules/@deepseek-ai/cordis/index.js'))).toBe(true)
  expect(existsSync(join(profile, 'node_modules/@ipollo/dsh-suite/index.js'))).toBe(true)
})

it.each([
  ['@ipollo/dsh-suite', '0.1.35', '0.1.39'],
  ['@ipollo/dsh-suite', '0.1.39', '0.1.39'],
  ['@ipollo/desktop-host', '0.2.2-rc.3', '0.2.2-rc.3'],
] as const)('always restores shipped application package %s from the installation', (name, previous, expected) => {
  const root = mkdtempSync(join(tmpdir(), 'ipollo-application-repair-'))
  roots.push(root)
  const runtime = join(root, 'runtime')
  const profile = join(root, 'profile')
  mkdirSync(profile)
  const descriptor = runtimeFixture(runtime)
  writePackage(join(runtime, 'node_modules'), name, { version: expected }, 'application-owned package')
  writePackage(join(profile, 'node_modules'), name, { version: previous }, 'profile copy of application package')
  writeFileSync(join(profile, '.credentials.yaml'), 'existing account fixture')
  const entry = { name, version: expected, path: `node_modules/${name}` }
  const metadata = { ...descriptor, sharedPackages: [...descriptor.sharedPackages.filter(item => item.name !== name), entry] }
  const backup = repairProfileRuntime(profile, runtime, metadata)
  expect(backup).toBeDefined()
  expect(existsSync(join(profile, 'node_modules', name))).toBe(false)
  expect(readFileSync(join(backup!, 'node_modules', name, 'index.js'), 'utf8')).toBe('profile copy of application package')
  expect(readFileSync(join(profile, '.credentials.yaml'), 'utf8')).toBe('existing account fixture')
  expect(repairProfileRuntime(profile, runtime, metadata)).toBeUndefined()
})
