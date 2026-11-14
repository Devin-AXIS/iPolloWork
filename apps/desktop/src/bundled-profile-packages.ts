/** Retire profile copies of the application plugins shipped by iPolloWork Desktop. */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const APPLICATION_PACKAGES = ['@ipollo/dsh-suite', 'deepseek-idesign', 'deepseek-ivideo'] as const

/**
 * Back up old application plugin copies before loading their bundled replacements.
 * The caller holds the profile lock and has stopped its Host. A failure stops startup; a later call
 * completes any remaining moves. Backups retain the original manifest and package entries.
 * @param profileDir - Existing desktop profile directory.
 * @param runtimeDir - Installation containing the replacement packages.
 * @returns Backup directory when old entries or dependencies were retired, otherwise undefined.
 */
export async function retireBundledProfilePackages(profileDir: string, runtimeDir: string): Promise<string | undefined> {
  const manifest = readProfileManifest('dsh', profileDir)
  const names = APPLICATION_PACKAGES.filter(name => existsSync(join(runtimeDir, 'node_modules', name, 'package.json')))
  const entries = names.filter((name) => {
    try { lstatSync(join(profileDir, 'node_modules', name)); return true }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  })
  const sections = [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]
  if (entries.length === 0 && !sections.some(section => names.some(name => section?.[name] !== undefined))) return undefined
  const backups = join(profileDir, '.dsh-bundled-package-backups')
  mkdirSync(backups, { recursive: true, mode: 0o700 })
  const backup = mkdtempSync(join(backups, 'upgrade-'))
  writeFileSync(join(backup, 'package.json'), readFileSync(join(profileDir, 'package.json')), { mode: 0o600 })
  for (const name of entries) {
    const target = join(backup, 'node_modules', name)
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    renameSync(join(profileDir, 'node_modules', name), target)
  }
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const section = manifest[key]
    if (section !== undefined) {
      manifest[key] = Object.fromEntries(Object.entries(section).filter(([name]) => !names.some(bundled => bundled === name)))
    }
  }
  await writeFileAtomic(join(profileDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600 })
  return backup
}
