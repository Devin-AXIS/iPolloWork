/** Read a curated DSH format-1 index and join it with the native installation inventory. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index'
import semver from 'semver'
import { z } from 'zod'
import type { MarketState } from '../shared/types.ts'
import { SuiteError } from './errors.ts'

export interface InstalledBundle {
  name: string; installed: boolean; enabled: boolean; version?: string;
  meta?: { icon?: string };
  availability?: 'installation' | 'profile' | 'missing';
  rows: readonly { moduleName: string }[];
}
export interface NativePluginManager { listBundles(): Promise<InstalledBundle[]> }
type Text = string | { readonly en: string; readonly [key: string]: string }
function localized(value: Text | undefined, language: string, fallback = ''): string {
  return typeof value === 'string' ? value : value?.[language] ?? value?.en ?? fallback
}

const bundledReleaseSchema = z.object({
  format: z.literal(1),
  plugins: z.array(z.object({
    name: z.string().min(1),
    version: z.string().refine(version => semver.valid(version) !== null),
    file: z.string().regex(/^[a-z0-9][a-z0-9.-]*\.tgz$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).max(100),
}).strict()

/** Resolve verified, suite-carried releases only for the suite's default catalog. */
async function bundledInstallTargets(catalogPath: string, cacheDirectory?: string): Promise<ReadonlyMap<string, string>> {
  const defaultCatalog = fileURLToPath(new URL('../../catalog/index.json', import.meta.url))
  if (resolve(catalogPath) !== defaultCatalog) return new Map()
  try {
    const releases = bundledReleaseSchema.parse(JSON.parse(await readFile(new URL('../../catalog/bundled-releases.json', import.meta.url), 'utf8')))
    const targets = new Map<string, string>()
    for (const release of releases.plugins) {
      const key = `${release.name}@${release.version}`
      if (targets.has(key)) throw new Error('Duplicate bundled release')
      const file = fileURLToPath(new URL(`../../catalog/packages/${release.file}`, import.meta.url))
      const bytes = await readFile(file)
      if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw new Error('Bundled release checksum mismatch')
      let target = file
      if (cacheDirectory) {
        await mkdir(cacheDirectory, { recursive: true })
        target = join(cacheDirectory, `${release.sha256}.tgz`)
        const cached = await readFile(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
        if (cached && createHash('sha256').update(cached).digest('hex') !== release.sha256) throw new Error('Cached release checksum mismatch')
        if (!cached) {
          const temporary = `${target}.${randomUUID()}.tmp`
          try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, target) }
          finally { await rm(temporary, { force: true }) }
        }
      }
      targets.set(key, `file:${target}`)
    }
    return targets
  } catch (cause) { throw new SuiteError('IPW_INVALID_CATALOG', 500, { cause }) }
}

/** Each request re-reads the operator's catalog. No copied installation state is persisted. */
export async function readMarket(path: string, manager: NativePluginManager, runtimeVersion: string, language: string, maxBytes: number, cacheDirectory?: string): Promise<MarketState> {
  const content = await readFile(path)
  if (content.byteLength > maxBytes) throw new SuiteError('IPW_CATALOG_TOO_LARGE', 500)
  let index
  try { index = parseMarketIndex(JSON.parse(content.toString('utf8')), 'https://catalog.ipollowork.invalid/index.json') }
  catch (cause) { throw new SuiteError('IPW_INVALID_CATALOG', 500, { cause }) }
  const bundled = await bundledInstallTargets(path, cacheDirectory)
  const installed = new Map((await manager.listBundles()).map(bundle => [bundle.name, bundle]))
  return {
    title: localized(index.title, language), runtimeVersion,
    categories: Object.entries(index.metadata.categories).map(([id, value]) => ({ id, title: localized(value.title, language, id) })),
    items: index.plugins.map(plugin => {
      const compatible = plugin.versions.find(version => !version.engines.dsh || semver.satisfies(runtimeVersion, version.engines.dsh, { includePrerelease: true }))
      const version = compatible ?? plugin.versions[0]!
      const local = bundled.get(`${plugin.name}@${version.version}`)
      const target = local ? { spec: local } : marketInstallTarget(plugin.name, version)
      const current = installed.get(plugin.name)
      return {
        name: plugin.name, title: localized(plugin.title, language, plugin.name), description: localized(plugin.description, language),
        author: plugin.author ?? '', icon: current?.meta?.icon ?? plugin.icon ?? null, homepage: plugin.homepage ?? null,
        category: plugin.metadata.category ?? '', categoryTitle: localized(index.metadata.categories[plugin.metadata.category ?? '']?.title, language), version: version.version, ...target,
        compatible: compatible !== undefined, requirement: version.engines.dsh ?? null,
        installed: current?.installed === true, enabled: current?.enabled === true, installedVersion: current?.version ?? null,
        providedByDsh: current?.availability === 'installation',
        resources: current?.rows.map(row => row.moduleName) ?? [],
      }
    }),
  }
}
