/** Collect distribution-configured bundles before building the native Desktop package set. */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempDisposableSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix } from 'node:path'
import type { ReleasePlugin } from '../../tooling/desktop-release-config.mjs'
import { resolveNpmRegistry } from './desktop-release-environment.mjs'
import { packedManifest, tarballFiles } from '../../../scripts/release/tarball.ts'

const requireOfficial = createRequire(new URL('../../../.upstream/dsh/package.json', import.meta.url))
const yaml = requireOfficial('js-yaml') as { load(text: string): unknown }
const semver = requireOfficial('semver') as { satisfies(version: string, range: string, options: { includePrerelease: boolean }): boolean }
const manifestName = 'enterprise-bundles.json'
const packageName = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

interface EnterpriseManifest {
  name: string
  version: string
  engines?: { dsh?: string }
  dsh?: { bundle?: { patch?: string } }
}

function localPath(value: string): string {
  const normalized = posix.normalize(value)
  if (!normalized || normalized === '.' || value.includes('\\') || posix.isAbsolute(normalized)
    || normalized === '..' || normalized.startsWith('../') || /^[a-z]:/iu.test(normalized)) {
    throw new Error('desktop enterprise plugin: patch path must stay inside its package')
  }
  return normalized
}

export function normalizeEnterprisePatch(value: unknown, packageId: string): Record<string, unknown>[] {
  const valid = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!Array.isArray(value) || value.length === 0) throw new Error(`desktop enterprise plugin: ${packageId} requires an additive Cordis patch`)
  return value.flatMap(block => {
    if (!valid(block) || Object.keys(block).length !== 1 || !Array.isArray(block.insert) || block.insert.length === 0) {
      throw new Error(`desktop enterprise plugin: ${packageId} patch must use nonempty insert blocks`)
    }
    return block.insert.map((entry: unknown) => {
      if (!valid(entry) || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9._~-]*$/iu.test(entry.id)
        || typeof entry.name !== 'string' || !entry.name) {
        throw new Error(`desktop enterprise plugin: ${packageId} has an invalid Cordis component entry`)
      }
      const name = entry.name.startsWith('./')
        ? `../../${packageId}/${localPath(entry.name)}`
        : entry.name
      if (!entry.name.startsWith('./') && !packageName.test(entry.name)) {
        throw new Error(`desktop enterprise plugin: ${packageId} contains an unsupported component name`)
      }
      return { ...entry, name }
    })
  })
}

function registryArchive(plugin: ReleasePlugin, directory: string): string {
  const spec = `${plugin.package}@${plugin.version}`
  try {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--ignore-scripts', '--silent', spec], {
        cwd: directory, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, npm_config_registry: resolveNpmRegistry(process.env) },
      })
  } catch { throw new Error(`desktop enterprise plugin: could not download ${spec}`) }
  const archives = readdirSync(directory).filter(file => file.endsWith('.tgz'))
  if (archives.length !== 1) throw new Error(`desktop enterprise plugin: expected one archive for ${spec}`)
  return join(directory, archives[0]!)
}

/** Stage known package bytes for the existing lockfile/signing pipeline and return their entries. */
export function stageEnterprisePlugins(plugins: readonly ReleasePlugin[], destination: string, dshVersion: string) {
  const names = new Set<string>()
  const entries: Record<string, unknown>[] = []
  for (const [index, plugin] of plugins.entries()) {
    const directory = mkdtempDisposableSync(join(tmpdir(), 'ipollowork-plugin-'))
    try {
      const archive = plugin.archive ?? registryArchive(plugin, directory.path)
      const manifest = packedManifest(archive) as EnterpriseManifest
      if (typeof manifest.name !== 'string' || !packageName.test(manifest.name) || typeof manifest.version !== 'string'
        || (plugin.package && plugin.package !== manifest.name) || (plugin.version && plugin.version !== manifest.version)
        || names.has(manifest.name)) {
        throw new Error('desktop enterprise plugin: duplicate or unexpected package identity')
      }
      const requirement = manifest.engines?.dsh
      if (requirement !== undefined && (typeof requirement !== 'string'
        || !semver.satisfies(dshVersion, requirement, { includePrerelease: true }))) {
        throw new Error(`desktop enterprise plugin: ${manifest.name} is incompatible with DSH ${dshVersion}`)
      }
      const source = plugin.patch === undefined
        ? readPackedPatch(archive, manifest)
        : readFileSync(plugin.patch, 'utf8')
      entries.push(...normalizeEnterprisePatch(yaml.load(source), manifest.name))
      names.add(manifest.name)
      copyFileSync(archive, join(destination, `enterprise-bundle-${index}.tgz`))
    } finally { directory.remove() }
  }
  if (names.size) writeFileSync(join(destination, manifestName), JSON.stringify([...names]))
  return entries
}

function readPackedPatch(archive: string, manifest: EnterpriseManifest): string {
  const declared = manifest.dsh?.bundle?.patch
  if (typeof declared !== 'string') throw new Error(`desktop enterprise plugin: ${manifest.name} must declare dsh.bundle.patch or select a patch file`)
  const entry = `package/${localPath(declared)}`
  if (!tarballFiles(archive).includes(entry)) throw new Error(`desktop enterprise plugin: ${manifest.name} archive omits its Cordis patch`)
  return execFileSync('tar', ['-xOzf', basename(archive), entry], { cwd: dirname(archive), encoding: 'utf8' })
}

export function readEnterprisePackageNames(directory: string): string[] {
  try { return JSON.parse(readFileSync(join(directory, manifestName), 'utf8')) as string[] }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
