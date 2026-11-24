/** Apply the Desktop handoff through DSH's native, locked package operation before loading bundles. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { evaluatePluginCompatibility, getDshRuntimeVersion, readProfileManifest, resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import { runPluginCommand, type PackageOperationOptions } from '@deepseek-ai/dsh-plugin-manager/operations'

interface Archive {
  name: string
  version: string
  sha256: string
}

const validName = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

export async function applyDesktopPluginUpdate(
  profile: string, anchor: string, appVersion: string | undefined,
  packageManager: Pick<PackageOperationOptions, 'command' | 'args' | 'env'> | undefined,
  signal: AbortSignal,
): Promise<void> {
  if (appVersion === undefined || packageManager === undefined) return
  const planPath = join(profile, 'ipollowork-plugin-update.json')
  const contents = await readFile(planPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (contents === undefined) return
  const plan = JSON.parse(contents) as {
    version: string; runtime: string; plugins: (Archive & { fromVersion: string; fromSource: string })[]
  }
  if (plan.version !== appVersion || plan.runtime !== getDshRuntimeVersion()) return
  if (!Array.isArray(plan.plugins) || plan.plugins.length > 100) throw new Error('Invalid desktop plugin update plan')
  if (plan.plugins.length === 0) {
    await rm(planPath, { force: true })
    return
  }

  const suite = resolveBundleDir('dsh', '@ipollo/dsh-suite', anchor, profile)
  const catalog = join(suite, 'catalog')
  const { plugins } = JSON.parse(await readFile(join(catalog, 'bundled-releases.json'), 'utf8')) as {
    plugins: (Archive & { file: string })[]
  }
  const home = resolve(profile, '..', '..')
  const cacheRoot = join(home, 'cache')
  const cache = join(cacheRoot, 'ipollowork-market')
  const physicalHome = await realpath(home)
  for (const directory of [cacheRoot, cache]) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const location = relative(physicalHome, await realpath(directory))
    if (isAbsolute(location) || location === '..' || location.startsWith('..' + sep)) {
      throw new Error('Desktop plugin update cache must remain in the DSH home')
    }
  }
  async function apply(requested: (typeof plan.plugins)[number]): Promise<void> {
    const archive = plugins.find(item => item.name === requested.name && item.version === requested.version && item.sha256 === requested.sha256)
    if (!archive || !validName.test(archive.name)
      || !/^[a-f0-9]{64}$/u.test(archive.sha256) || !/^[a-zA-Z0-9.+-]+\.tgz$/u.test(archive.file)) {
      throw new Error('The update installer does not contain the reviewed plugin archive')
    }
    const destination = join(cache, archive.sha256 + '.tgz')
    const source = readProfileManifest('dsh', profile).dependencies?.[archive.name]
    if (source?.startsWith('file:') !== true) return
    const resuming = resolve(profile, source.slice(5)) === destination
    if (!resuming && source !== requested.fromSource) return
    const installed = await readFile(join(profile, 'node_modules', archive.name, 'package.json'), 'utf8')
      .then(value => JSON.parse(value) as { version?: string }, (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      })
    if (resuming && installed?.version === archive.version && evaluatePluginCompatibility(installed) === undefined) return
    if (!resuming && installed?.version !== undefined && installed.version !== requested.fromVersion) return
    const bytes = await readFile(join(catalog, 'packages', archive.file))
    if (createHash('sha256').update(bytes).digest('hex') !== archive.sha256) {
      throw new Error('The update installer plugin checksum does not match its catalog')
    }
    const temporary = destination + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
    const result = await runPluginCommand({ profile: 'desktop', dir: profile, installAnchor: anchor, cwd: profile },
      ['add', 'file:' + destination, '--save-exact'], {
        ...packageManager, signal, execution: 'service', outputBytes: 4096,
        activateNewBundles: false, idleTimeoutMs: 120_000,
        expected: { name: archive.name, version: archive.version },
      })
    if (result.exitCode !== 0 || result.timedOut === true) throw new Error('Desktop plugin update failed for ' + archive.name)
  }
  let incomplete = false
  for (const requested of plan.plugins) {
    signal.throwIfAborted()
    try { await apply(requested) }
    catch (error) {
      signal.throwIfAborted()
      incomplete = true
      const name = typeof requested?.name === 'string' && validName.test(requested.name) ? requested.name : 'unknown bundle'
      console.warn('desktop plugin update: will retry', name, error instanceof Error ? error.name : 'UnknownError')
    }
  }
  if (!incomplete) await rm(planPath, { force: true })
}
