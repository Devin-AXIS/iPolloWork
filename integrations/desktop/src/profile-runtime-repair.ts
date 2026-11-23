/** Preserve obsolete profile copies that would shadow the application's core services. */
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DesktopRuntimeDescriptor } from './runtime-tree.ts'

const APPLICATION_PACKAGES = new Set(['@ipollo/desktop-host', '@ipollo/dsh-suite', '@ipollo/dsh-stage'])

function inside(root: string, path: string): boolean {
  const name = relative(root, path)
  return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)
}

/**
 * Run under the desktop profile lock, before the Host starts. Core packages are supplied by
 * the signed installation; old hoisted dependencies from external plugins must not replace them.
 * Rename only their profile entries, retaining a journal and all original bytes for recovery.
 */
export function repairProfileRuntime(profile: string, runtime: string, descriptor: DesktopRuntimeDescriptor): string | undefined {
  const root = realpathSync(profile)
  const conflicts: { name: string; version: string; expected: string; source: string }[] = []
  for (const entry of descriptor.sharedPackages) {
    const applicationOwned = APPLICATION_PACKAGES.has(entry.name)
    // The verified installation closure also owns shared schema and utility packages.
    // An old Schemastery/Cosmokit can otherwise shadow the new Cordis graph.
    if (!applicationOwned && !entry.name.startsWith('@deepseek-ai/')) continue
    const source = join(root, 'node_modules', entry.name)
    let stat
    try { stat = lstatSync(source) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    // Development profiles may already link the exact installation package.
    if (stat.isSymbolicLink() && realpathSync(source) === realpathSync(join(runtime, entry.path))) continue
    const manifest: unknown = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    if (typeof manifest !== 'object' || manifest === null || !('name' in manifest) || manifest.name !== entry.name
      || !('version' in manifest) || typeof manifest.version !== 'string') {
      throw new Error(`desktop profile: invalid core dependency ${entry.name}`)
    }
    // Private application packages can change between app releases without changing the DSH SDK version.
    if (!applicationOwned && manifest.version === entry.version) continue
    // Do not move entries through a node_modules/scope junction outside this profile.
    if (!inside(root, realpathSync(dirname(source)))) throw new Error(`desktop profile: core dependency outside profile: ${entry.name}`)
    conflicts.push({ name: entry.name, version: manifest.version, expected: entry.version, source })
  }
  if (!conflicts.length) return undefined
  const parent = join(root, 'runtime-dependency-backups')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  if (!inside(root, realpathSync(parent))) throw new Error('desktop profile: dependency backup outside profile')
  const backup = join(parent, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
  mkdirSync(backup, { recursive: true, mode: 0o700 })
  const journal = join(backup, 'repair.json')
  const moved: typeof conflicts = []
  const record = (status: string) => writeFileSync(journal, JSON.stringify({
    schemaVersion: 1, status, runtimeVersion: descriptor.release.version,
    packages: conflicts.map(({ name, version, expected }) => ({ name, version, expected })),
    moved: moved.map(entry => entry.name),
  }, null, 2) + '\n', { mode: 0o600 })
  record('prepared')
  try {
    for (const entry of conflicts) {
      const destination = join(backup, 'node_modules', entry.name)
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
      renameSync(entry.source, destination)
      moved.push(entry)
      record('moving')
    }
    record('complete')
  } catch (error) {
    for (const entry of [...moved].reverse()) renameSync(join(backup, 'node_modules', entry.name), entry.source)
    moved.length = 0
    record('rolled-back')
    throw error
  }
  console.info('Desktop profile core dependencies restored from the application:', { packages: conflicts.map(entry => entry.name), backup })
  return backup
}
