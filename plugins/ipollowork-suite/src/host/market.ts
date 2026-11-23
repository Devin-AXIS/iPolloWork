/** Read a curated DSH format-1 index and join it with the native installation inventory. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index'
import { parseInstallSpec, pinnedGitOrigin, type BundleInfo } from '@deepseek-ai/dsh-plugin-manager'
import semver from 'semver'
import type { MarketItem, MarketState } from '../shared/types.ts'
import { SuiteError } from './errors.ts'
import { bundledReleases, githubArchive, verifyArchive, type PublishedRelease } from './market-releases.ts'

export interface InstalledBundle {
  name: string; installed: boolean; enabled: boolean; version?: string;
  meta?: { icon?: string };
  availability?: 'installation' | 'profile' | 'missing';
  source?: string;
  official?: boolean;
  readOnlyReason?: BundleInfo['readOnlyReason'];
  update?: BundleInfo['update'];
  rows: readonly { moduleName: string }[];
}
export interface NativePluginManager {
  listBundles(): Promise<InstalledBundle[]>;
  inspect?: import('@deepseek-ai/dsh-plugin-manager').PluginManager['inspect'];
}
type Text = string | { readonly en: string; readonly [key: string]: string }
function localized(value: Text | undefined, language: string, fallback = ''): string {
  return typeof value === 'string' ? value : value?.[language] ?? value?.en ?? fallback
}

type ArchiveTarget = Pick<MarketItem, 'spec' | 'archiveSha256'>
const defaultCatalog = fileURLToPath(new URL('../../catalog/index.json', import.meta.url))
export function isDefaultMarket(path: string): boolean {
  return resolve(path) === defaultCatalog
}

/** Resolve verified, suite-carried releases only for the suite's default catalog. */
async function bundledInstallTargets(catalogPath: string, cacheDirectory?: string) {
  const targets = new Map<string, ArchiveTarget>()
  const names = new Set<string>()
  if (!isDefaultMarket(catalogPath)) return { targets, names }
  try {
    const releases = bundledReleases.parse(JSON.parse(await readFile(new URL('../../catalog/bundled-releases.json', import.meta.url), 'utf8')))
    for (const release of releases.plugins) {
      const key = `${release.name}@${release.version}`
      if (targets.has(key)) throw new Error('Duplicate bundled release')
      names.add(release.name)
      const file = fileURLToPath(new URL(`../../catalog/packages/${release.file}`, import.meta.url))
      let bytes: Buffer
      try { bytes = await readFile(file) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        targets.set(key, githubArchive(release))
        continue
      }
      verifyArchive(bytes, release.sha256)
      let target = file
      if (cacheDirectory) {
        await mkdir(cacheDirectory, { recursive: true })
        target = join(cacheDirectory, `${release.sha256}.tgz`)
        const cached = await readFile(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
        if (cached) verifyArchive(cached, release.sha256)
        if (!cached) {
          const temporary = `${target}.${randomUUID()}.tmp`
          try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, target) }
          finally { await rm(temporary, { force: true }) }
        }
      }
      targets.set(key, { spec: `file:${target}` })
    }
    return { targets, names }
  } catch (cause) { throw new SuiteError('IPW_INVALID_CATALOG', 500, { cause }) }
}

export function updateKind(current: InstalledBundle | undefined, target: ArchiveTarget, version: string, archived: boolean): MarketItem['update'] {
  if (!current?.installed || current.availability !== 'profile' || current.official || current.readOnlyReason
    || !current.source || !current.version || !semver.valid(current.version) || !semver.gt(version, current.version)) return
  if (archived) {
    try { if (parseInstallSpec(current.source).kind === 'tarball') return 'archive' }
    catch { /* The installed spec is not an archive the native manager can replace. */ }
  }
  if (current.update === 'git') {
    const origin = pinnedGitOrigin(current.source)
    if (origin !== undefined && pinnedGitOrigin(target.spec) === origin) return 'git'
  }
}

/** Each request re-reads the operator's catalog. No copied installation state is persisted. */
export async function readMarket(path: string, manager: NativePluginManager, runtimeVersion: string, language: string, maxBytes: number, cacheDirectory?: string, _downloadOnDemand = false, curated: unknown[] = [], published: readonly PublishedRelease[] = []): Promise<MarketState> {
  const content = await readFile(path)
  if (content.byteLength > maxBytes) throw new SuiteError('IPW_CATALOG_TOO_LARGE', 500)
  let index
  try { index = parseMarketIndex(JSON.parse(content.toString('utf8')), 'https://catalog.ipollowork.invalid/index.json') }
  catch (cause) { throw new SuiteError('IPW_INVALID_CATALOG', 500, { cause }) }
  if (curated.length) {
    try {
      const names = new Set(index.plugins.map(plugin => plugin.name))
      const additional = parseMarketIndex({ format: 1, title: 'Curated', metadata: { categories: index.metadata.categories }, plugins: curated }, 'https://catalog.ipollowork.invalid/index.json')
      index = { ...index, plugins: [...index.plugins, ...additional.plugins.filter(plugin => !names.has(plugin.name))] }
    } catch (cause) { throw new SuiteError('IPW_INVALID_CATALOG', 502, { cause }) }
  }
  const bundled = await bundledInstallTargets(path, cacheDirectory)
  const installed = new Map((await manager.listBundles()).map(bundle => [bundle.name, bundle]))
  const supportsRuntime = (range: string | undefined) => !range || semver.satisfies(runtimeVersion, range, { includePrerelease: true })
  return {
    title: localized(index.title, language), runtimeVersion,
    categories: Object.entries(index.metadata.categories).map(([id, value]) => ({ id, title: localized(value.title, language, id) })),
    items: index.plugins.map(plugin => {
      const compatible = plugin.versions.find(version => supportsRuntime(version.engines.dsh))
      const version = compatible ?? plugin.versions[0]!
      const release = bundled.names.has(plugin.name) ? published.find(candidate => candidate.name === plugin.name
        && supportsRuntime(candidate.dsh) && (!compatible || semver.gt(candidate.version, compatible.version))) : undefined
      const archive = release ? githubArchive(release) : bundled.targets.get(`${plugin.name}@${version.version}`)
      const target = archive ?? marketInstallTarget(plugin.name, version)
      const selectedVersion = release?.version ?? version.version
      const acceptable = release !== undefined || compatible !== undefined
      const current = installed.get(plugin.name)
      const update = acceptable ? updateKind(current, target, selectedVersion, archive !== undefined) : undefined
      return {
        name: plugin.name, title: localized(plugin.title, language, plugin.name), description: localized(plugin.description, language),
        author: plugin.author ?? '', icon: current?.meta?.icon ?? plugin.icon ?? null, homepage: plugin.homepage ?? null,
        category: plugin.metadata.category ?? '', categoryTitle: localized(index.metadata.categories[plugin.metadata.category ?? '']?.title, language), version: selectedVersion, ...target,
        compatible: acceptable, requirement: release?.dsh ?? version.engines.dsh ?? null,
        ...(update && { update }),
        installed: current?.installed === true, enabled: current?.enabled === true, installedVersion: current?.version ?? null,
        providedByDsh: current?.availability === 'installation',
        resources: current?.rows.map(row => row.moduleName) ?? [],
      }
    }),
  }
}
