import { isDeepStrictEqual } from 'node:util'
/** Read a curated DSH format-1 index and join it with the native installation inventory. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index'
import { parseInstallSpec, pinnedGitOrigin, type BundleInfo } from '@deepseek-ai/dsh-plugin-manager'
import semver from 'semver'
import { SESSION_TITLES_BUNDLE, type MarketItem, type MarketState } from '../shared/types.ts'
import { chinesePluginIntroductions } from '../shared/plugin-introductions.ts'
import { studioPluginTitle } from '../shared/studio-plugin-titles.ts'
import { SuiteError } from './errors.ts'
import retiredPlugins from '../../catalog/retired-plugins.json' with { type: 'json' }
import { bundledArchiveOffer, bundledReleases, githubArchive, type PublishedRelease } from './market-releases.ts'

export interface InstalledBundle {
  name: string; installed: boolean; enabled: boolean; version?: string;
  meta?: BundleInfo['meta'];
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
const enableOnInstallPlugins = new Set([
  '@ipollo/dsh-markdown-editor',
  '@ipollo/dsh-excel-editor',
  '@ipollo/dsh-conversation-export',
])

export function isDefaultMarket(path: string): boolean {
  return resolve(path) === defaultCatalog
}

/** List archive identities from the bundled manifest. Only installation reads and verifies the selected bytes. */
async function bundledInstallTargets(catalogPath: string) {
  const targets = new Map<string, ArchiveTarget>()
  const names = new Set<string>()
  if (!isDefaultMarket(catalogPath)) return { targets, names }
  try {
    const releases = bundledReleases.parse(JSON.parse(await readFile(new URL('../../catalog/bundled-releases.json', import.meta.url), 'utf8')))
    const offers = await Promise.all(releases.plugins.filter(release => !release.upgradeOnly).map(async release => {
      const file = fileURLToPath(new URL(`../../catalog/packages/${release.file}`, import.meta.url))
      return { release, target: await bundledArchiveOffer(release, file) }
    }))
    for (const { release, target } of offers) {
      const key = `${release.name}@${release.version}`
      if (targets.has(key)) throw new Error('Duplicate bundled release')
      names.add(release.name)
      targets.set(key, target)
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
export async function readMarket(path: string, manager: NativePluginManager, runtimeVersion: string, language: string, maxBytes: number, {
  curated = [], published = [], inventory,
}: { curated?: unknown[]; published?: readonly PublishedRelease[]; inventory?: readonly InstalledBundle[] } = {}): Promise<MarketState> {
  const content = await readFile(path)
  if (content.byteLength > maxBytes) throw new SuiteError('IPW_CATALOG_TOO_LARGE', 500)
  const defaults = isDefaultMarket(path)
  const retired = (name: string) => defaults && retiredPlugins.includes(name)
  let index
  try { index = parseMarketIndex(JSON.parse(content.toString('utf8')), 'https://catalog.ipollowork.invalid/index.json') }
  catch (cause) { throw new SuiteError('IPW_INVALID_CATALOG', 500, { cause }) }
  const supportsRuntime = (range: string | undefined) => !range || semver.satisfies(runtimeVersion, range, { includePrerelease: true })
  const remoteInstall = new Set<string>()
  if (curated.length) {
    try {
      const merged = new Map(index.plugins.map(plugin => [plugin.name, plugin]))
      const additional = parseMarketIndex({ format: 1, title: 'Curated', metadata: { categories: index.metadata.categories }, plugins: curated }, 'https://catalog.ipollowork.invalid/index.json')
      for (const plugin of additional.plugins) {
        if (retired(plugin.name)) continue
        const previous = merged.get(plugin.name)
        // An older service catalog must not hide a newer reviewed archive carried by this application.
        // Explicit operator catalogs remain authoritative; equal-version source changes retain their usual rules.
        if (defaults && previous) {
          const local = previous.versions.find(version => supportsRuntime(version.engines.dsh))
          const remote = plugin.versions.find(version => supportsRuntime(version.engines.dsh))
          if (local && (!remote || semver.gt(local.version, remote.version))) continue
        }
        // Preserve archive upgrades only when the curated entry points at the same artifact.
        if (!previous?.versions.some(v => v.version === plugin.versions[0]?.version
          && isDeepStrictEqual(v.source, plugin.versions[0]?.source))) remoteInstall.add(plugin.name)
        merged.set(plugin.name, plugin)
      }
      index = { ...index, plugins: [...merged.values()] }
    } catch (cause) { throw new SuiteError('IPW_INVALID_CATALOG', 502, { cause }) }
  }
  const [bundled, bundles] = await Promise.all([bundledInstallTargets(path), inventory ?? manager.listBundles()])
  const installed = new Map(bundles.map(bundle => [bundle.name, bundle]))
  return {
    title: localized(index.title, language), runtimeVersion,
    categories: Object.entries(index.metadata.categories).map(([id, value]) => ({ id, title: localized(value.title, language, id) })),
    items: index.plugins.filter(plugin => !retired(plugin.name)).map(plugin => {
      const compatible = plugin.versions.find(version => supportsRuntime(version.engines.dsh))
      const version = compatible ?? plugin.versions[0]!
      const release = !remoteInstall.has(plugin.name) && bundled.names.has(plugin.name) ? published.find(candidate => candidate.name === plugin.name
        && supportsRuntime(candidate.dsh) && (!compatible || semver.gt(candidate.version, compatible.version))) : undefined
      const archive = release ? githubArchive(release) : remoteInstall.has(plugin.name) ? undefined : bundled.targets.get(`${plugin.name}@${version.version}`)
      const target = archive ?? marketInstallTarget(plugin.name, version)
      const selectedVersion = release?.version ?? version.version
      const acceptable = release !== undefined || compatible !== undefined
      const current = installed.get(plugin.name)
      const isSessionTitles = plugin.name === SESSION_TITLES_BUNDLE
      const title = studioPluginTitle(plugin.name, language)
        ?? localized(isSessionTitles ? current?.meta?.title ?? plugin.title : plugin.title, language, plugin.name)
      const description = (language === 'zh' ? chinesePluginIntroductions.get(plugin.name) : undefined)
        ?? localized(plugin.description, language)
      const update = acceptable ? updateKind(current, target, selectedVersion, archive !== undefined) : undefined
      const enableOnInstall = acceptable
        && (isSessionTitles || (archive !== undefined && enableOnInstallPlugins.has(plugin.name)))
        && current?.installed !== true && current?.availability !== 'installation'
      return {
        name: plugin.name, title, description,
        author: plugin.author ?? '', icon: (current?.version && current.version !== selectedVersion ? plugin.icon : undefined) ?? current?.meta?.icon ?? plugin.icon ?? null, homepage: plugin.homepage ?? null,
        category: plugin.metadata.category ?? '', categoryTitle: localized(index.metadata.categories[plugin.metadata.category ?? '']?.title, language), version: selectedVersion, ...target,
        compatible: acceptable, requirement: release?.dsh ?? version.engines.dsh ?? null,
        ...(update && { update }),
        ...(enableOnInstall && { enableOnInstall }),
        installed: current?.installed === true, enabled: current?.enabled === true, installedVersion: current?.version ?? null,
        providedByDsh: current?.availability === 'installation',
        resources: current?.rows.map(row => row.moduleName) ?? [],
      }
    }),
  }
}
