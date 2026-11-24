import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { getDshRuntimeVersion, PROFILE_COMPATIBILITY_FILENAME } from '@deepseek-ai/dsh-app-boot'
import { applyDesktopPluginUpdate } from '../../desktop-host/src/plugin-update.ts'
import { inspectPluginUpdate, localPluginUpdateDirectory, pluginUpdatePlanFile, pluginUpdatePrompt, prepareLegacyPluginUpdate } from '../src/plugin-update.ts'

const { runPluginCommand } = vi.hoisted(() => ({ runPluginCommand: vi.fn() }))
vi.mock('@deepseek-ai/dsh-plugin-manager/operations', () => ({ runPluginCommand }))

it('plans a bundled update, blocks an enabled incompatible link, and leaves the profile untouched', () => {
  const home = mkdtempSync(join(tmpdir(), 'ipw-plugin-preflight-'))
  const profile = join(home, 'profiles', 'desktop')
  const runtime = join(home, 'runtime')
  const name = '@ipollo/dsh-example'
  const version = '2.0.0'
  const sha256 = 'b'.repeat(64)
  const source = 'file:../../cache/ipollowork-market/' + 'a'.repeat(64) + '.tgz'
  const metadata = { runtime: '0.2.3-alpha.2', plugins: [{ name, version, sha256 }] }
  const manifest = { dependencies: { [name]: source, local: 'link:../../custom', optional: '1.0.0' },
    dsh: { profile: { bundles: [name, 'local'] } } }
  try {
    mkdirSync(runtime, { recursive: true })
    writeFileSync(join(runtime, 'package.json'), '{}')
    for (const installed of Object.keys(manifest.dependencies)) {
      const dir = join(profile, 'node_modules', installed)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: installed, version: '1.0.0', engines: { dsh: '<0.2.3-0' },
      }))
    }
    const packageFile = join(profile, 'package.json')
    const configFile = join(profile, 'cordis.patch.yml')
    writeFileSync(packageFile, JSON.stringify(manifest))
    writeFileSync(configFile, '[{"id":"saved","config":{"label":"kept"}}]')
    const initial = inspectPluginUpdate(profile, runtime, metadata)
    expect(initial.plugins).toEqual([{ name, version, sha256, fromVersion: '1.0.0', fromSource: source }])
    expect(initial.issues).toEqual([
      { name: 'local', version: '1.0.0', linked: true, enabled: true },
      { name: 'optional', version: '1.0.0', linked: false, enabled: false },
    ])
    expect(initial.blocked).toBe(true)
    expect(pluginUpdatePrompt(initial, true).detail).toContain('local · 1.0.0 · 本地链接 · 已启用')
    expect(inspectPluginUpdate(profile, runtime, undefined)).toMatchObject({ blocked: true, unknown: true })
    expect(JSON.parse(readFileSync(packageFile, 'utf8'))).toEqual(manifest)
    expect(readFileSync(configFile, 'utf8')).toBe('[{"id":"saved","config":{"label":"kept"}}]')

    manifest.dsh.profile.bundles = [name]
    writeFileSync(packageFile, JSON.stringify(manifest))
    expect(inspectPluginUpdate(profile, runtime, metadata)).toMatchObject({ blocked: false })
    expect(inspectPluginUpdate(profile, runtime, { ...metadata, plugins: [] })).toMatchObject({ blocked: true })
  } finally { rmSync(home, { recursive: true, force: true }) }
})

it('keeps a linked workbench and its data when the author repairs it or the exact target was approved in DSH', () => {
  const home = mkdtempSync(join(tmpdir(), 'ipw-linked-workbench-'))
  const profile = join(home, 'profile')
  const runtime = join(home, 'runtime')
  const workbench = join(home, 'workbench')
  const name = 'local-workbench'
  const packageFile = join(workbench, 'package.json')
  const settings = join(workbench, 'settings.json')
  const source = 'link:../workbench'
  const profileManifest = { dependencies: { [name]: source }, dsh: { profile: { bundles: [name] } } }
  const target = { runtime: '0.2.4', plugins: [{ name, version: '9.0.0', sha256: 'a'.repeat(64) }] }
  const plugin = { name, version: '1.0.0', engines: { dsh: '0.2.3-alpha.2' } }
  try {
    for (const dir of [runtime, workbench, join(profile, 'node_modules')]) mkdirSync(dir, { recursive: true })
    writeFileSync(join(runtime, 'package.json'), '{}')
    writeFileSync(join(profile, 'package.json'), JSON.stringify(profileManifest))
    writeFileSync(packageFile, JSON.stringify(plugin))
    writeFileSync(settings, '{"project":"existing"}')
    symlinkSync(workbench, join(profile, 'node_modules', name), 'junction')
    const blocked = inspectPluginUpdate(profile, runtime, target)
    expect(blocked).toMatchObject({ blocked: true, plugins: [] })
    expect(localPluginUpdateDirectory(profile, blocked.issues[0]!)).toBe(workbench)
    writeFileSync(join(profile, PROFILE_COMPATIBILITY_FILENAME), JSON.stringify({ [name + '@1.0.0']: ['0.2.3-alpha.2'] }))
    expect(inspectPluginUpdate(profile, runtime, target).blocked).toBe(true)
    writeFileSync(join(profile, PROFILE_COMPATIBILITY_FILENAME), JSON.stringify({ [name + '@1.0.0']: ['0.2.4'] }))
    expect(inspectPluginUpdate(profile, runtime, target)).toMatchObject({ blocked: false, issues: [], plugins: [] })
    writeFileSync(join(profile, PROFILE_COMPATIBILITY_FILENAME), '{}')
    writeFileSync(packageFile, JSON.stringify({ ...plugin, engines: { dsh: '>=0.2.3-alpha.2 <0.3.0' } }))
    expect(inspectPluginUpdate(profile, runtime, target)).toMatchObject({ blocked: false, issues: [], plugins: [] })
    expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))).toEqual(profileManifest)
    expect(readFileSync(settings, 'utf8')).toBe('{"project":"existing"}')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

function legacyProfile() {
  const home = mkdtempSync(join(tmpdir(), 'ipw-legacy-plugin-upgrade-'))
  const profile = join(home, 'profiles', 'desktop')
  const runtime = join(home, 'runtime')
  const catalog = join(runtime, 'node_modules', '@ipollo', 'dsh-suite', 'catalog')
  const pin = getDshRuntimeVersion()
  const version = '1.0.99'
  const fixture = (name: string, content: string, engine: string, managed = true) => {
    const oldVersion = '1.0.0'
    const oldHash = createHash('sha256').update(name).digest('hex')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const fromSource = managed ? 'file:../../cache/ipollowork-market/' + oldHash + '.tgz' : 'link:../../source'
    const installed = join(profile, 'node_modules', name)
    mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, 'package.json'), JSON.stringify({ name, version: oldVersion, engines: { dsh: engine } }))
    return { name, version: '2.0.0', file: name + '.tgz', sha256, fromVersion: oldVersion, fromSource, content, installed }
  }
  const broken = fixture('broken', 'expected', '0.0.1')
  const healthy = fixture('healthy', 'verified', '0.0.1')
  const compatible = fixture('compatible', 'would be a normal update', pin)
  const linked = fixture('linked', 'do not replace a local source', '0.0.1', false)
  const bundles = [broken, healthy, compatible, linked]
  const packagePath = join(profile, 'package.json')
  const planPath = join(profile, pluginUpdatePlanFile)
  const settings = join(profile, 'cordis.patch.yml')
  const savedSettings = '[{"id":"saved","config":{"label":"keep"}}]'
  const manifest = {
    dependencies: Object.fromEntries(bundles.map(bundle => [bundle.name, bundle.fromSource])),
    dsh: { profile: { bundles: bundles.map(bundle => bundle.name) } },
  }
  mkdirSync(join(catalog, 'packages'), { recursive: true })
  writeFileSync(join(runtime, 'package.json'), '{}')
  writeFileSync(join(catalog, '..', 'package.json'), JSON.stringify({ name: '@ipollo/dsh-suite' }))
  writeFileSync(packagePath, JSON.stringify(manifest))
  writeFileSync(settings, savedSettings)
  writeFileSync(join(catalog, 'bundled-releases.json'), JSON.stringify({
    plugins: bundles.map(({name, version, file, sha256}) => ({name, version, file, sha256})),
  }))
  for (const bundle of bundles) writeFileSync(join(catalog, 'packages', bundle.file), bundle.content)
  return { home, profile, runtime, catalog, packagePath, planPath, settings, savedSettings, manifest, version, pin, broken, healthy }
}

it('reconstructs a missing handoff only for enabled, incompatible managed bundles', async () => {
  const f = legacyProfile()
  try {
    await prepareLegacyPluginUpdate(f.profile, f.runtime, f.version, f.pin)
    const plan = JSON.parse(readFileSync(f.planPath, 'utf8'))
    expect(plan).toMatchObject({ version: f.version, runtime: f.pin, plugins: [
      { name: 'broken', fromVersion: '1.0.0', version: '2.0.0' },
      { name: 'healthy', fromVersion: '1.0.0', version: '2.0.0' },
    ] })
    expect(JSON.parse(readFileSync(f.packagePath, 'utf8'))).toEqual(f.manifest)
    expect(readFileSync(f.settings, 'utf8')).toEqual(f.savedSettings)
  } finally { rmSync(f.home, { recursive: true, force: true }) }
})

it('isolates a damaged archive, finishes the other update, and retains the handoff for retry', async () => {
  const f = legacyProfile()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  runPluginCommand.mockResolvedValue({ exitCode: 0 })
  try {
    await prepareLegacyPluginUpdate(f.profile, f.runtime, f.version, f.pin)
    writeFileSync(join(f.catalog, 'packages', f.broken.file), 'damaged')
    await applyDesktopPluginUpdate(f.profile, join(f.runtime, 'package.json'), f.version, {}, new AbortController().signal)
    expect(runPluginCommand).toHaveBeenCalledTimes(1)
    expect(runPluginCommand.mock.calls[0]?.[2]).toMatchObject({ expected: { name: 'healthy', version: '2.0.0' }, activateNewBundles: false })
    expect(warn).toHaveBeenCalledWith('desktop plugin update: will retry', 'broken', 'Error')
    expect(JSON.parse(readFileSync(f.planPath, 'utf8')).plugins).toHaveLength(2)
    expect(readFileSync(f.settings, 'utf8')).toEqual(f.savedSettings)
    expect(JSON.parse(readFileSync(f.packagePath, 'utf8')).dsh).toEqual(f.manifest.dsh)
  } finally {
    runPluginCommand.mockReset()
    warn.mockRestore()
    rmSync(f.home, { recursive: true, force: true })
  }
})
