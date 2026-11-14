/** Application plugin upgrades preserve profile data and retire only bundled copies. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { retireBundledProfilePackages } from '../src/bundled-profile-packages.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-bundle-upgrade-'))
  roots.push(root)
  const profile = join(root, 'profile')
  const runtime = join(root, 'runtime')
  mkdirSync(profile)
  for (const name of ['@ipollo/dsh-suite', 'deepseek-idesign']) {
    const path = join(runtime, 'node_modules', name)
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '2.0.0' }))
  }
  return { root, profile, runtime }
}

it('backs up stale bundled copies while preserving selections, other plugins, and documents', async () => {
  const { root, profile, runtime } = fixture()
  const old = join(profile, 'node_modules', '@ipollo/dsh-suite')
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, 'package.json'), '{"version":"1.0.0"}')
  const external = join(root, 'external-design')
  mkdirSync(external)
  writeFileSync(join(external, 'package.json'), '{"version":"1.0.0"}')
  symlinkSync(external, join(profile, 'node_modules', 'deepseek-idesign'), process.platform === 'win32' ? 'junction' : 'dir')
  const manifest = { dependencies: { '@ipollo/dsh-suite': '1.0.0', extra: '1.0.0', 'deepseek-ivideo': '1.0.0' },
    optionalDependencies: { 'deepseek-idesign': '1.0.0' },
    dsh: { profile: { bundles: ['@ipollo/dsh-suite', 'deepseek-idesign', 'extra'] } } }
  writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profile, 'document.html'), '<main>Keep</main>')
  const backup = await retireBundledProfilePackages(profile, runtime)
  expect(backup).toBeDefined()
  expect(JSON.parse(readFileSync(join(backup!, 'package.json'), 'utf8'))).toEqual(manifest)
  expect(readFileSync(join(backup!, 'node_modules/@ipollo/dsh-suite/package.json'), 'utf8')).toContain('1.0.0')
  expect(readFileSync(join(external, 'package.json'), 'utf8')).toContain('1.0.0')
  expect(existsSync(old)).toBe(false)
  expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))).toEqual({ ...manifest,
    dependencies: { extra: '1.0.0', 'deepseek-ivideo': '1.0.0' }, optionalDependencies: {} })
  expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('[]\n')
  expect(readFileSync(join(profile, 'document.html'), 'utf8')).toBe('<main>Keep</main>')
  expect(await retireBundledProfilePackages(profile, runtime)).toBeUndefined()
  expect(readdirSync(join(profile, '.dsh-bundled-package-backups'))).toHaveLength(1)
})

it('rejects unreadable profile data before moving installed packages', async () => {
  const { profile, runtime } = fixture()
  writeFileSync(join(profile, 'package.json'), '{broken')
  await expect(retireBundledProfilePackages(profile, runtime)).rejects.toThrow()
  expect(existsSync(join(profile, '.dsh-bundled-package-backups'))).toBe(false)
})
