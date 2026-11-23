import { readdir, readFile, realpath, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve, relative, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { extensionCatalog, type ExtensionManifest } from '../core/extensions'
import { entityIconIds } from '../core/icons'
import { fieldTypes } from '../core/fields'
import { PluginScope } from '../core/plugin-scope'
import { DataError } from './errors'
import { pluginFileName, pluginMaxBytes } from '../core/plugin-archive'

const root = fileURLToPath(new URL('../../', import.meta.url))
const key = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const entry = z.string().regex(/^[a-zA-Z0-9_-]+\.m?js$/)
export const packageSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  type: z.literal('module'),
  ipolloData: z
    .object({
      id: key.refine((id) => id !== 'import', '插件 ID import 已保留'),
      name: z.string().min(1).max(80),
      icon: z.enum(entityIconIds).optional(),
      description: z.string().max(500),
      protocol: z.literal(1),
      categories: z.array(z.enum(['fields', 'views'])).min(1),
      defaultInstalled: z.boolean().default(false),
      dependencies: z.array(key).default(['core']),
      contributes: z
        .object({ fields: z.array(key).optional(), views: z.array(key).optional() })
        .strict(),
      entrypoints: z.object({ shared: entry.optional(), client: entry.optional() }).strict(),
    })
    .strict(),
})
interface Package {
  directory: string
  manifest: ExtensionManifest
  files: Map<string, Uint8Array>
}
const packages = new Map<string, Package>()
let loading: Promise<void> | undefined

export async function readPackage(directory: string): Promise<Package> {
  const actual = await realpath(directory)
  const files = new Map<string, Uint8Array>()
  let bytes = 0
  for (const file of await readdir(actual)) {
    pluginFileName.parse(file)
    const path = resolve(actual, file),
      stat = await lstat(path)
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error('插件包仅接受平铺文件，不接受软链接或目录')
    bytes += stat.size
    if (bytes > pluginMaxBytes) throw new Error('插件包超过 5 MB；请提供已构建的精简包')
    files.set(file, await readFile(path))
  }
  return { directory: actual, ...inspectPackage(files) }
}

export function inspectPackage(files: Map<string, Uint8Array>) {
  const raw = files.get('package.json')
  if (!raw) throw new DataError('插件包缺少 package.json')
  const config = packageSchema.parse(JSON.parse(new TextDecoder().decode(raw)))
  const manifest: ExtensionManifest = { ...config.ipolloData, version: config.version }
  if (manifest.contributes.fields?.length && !manifest.entrypoints?.shared)
    throw new DataError('字段插件缺少 shared 入口')
  if (manifest.contributes.views?.length && !manifest.entrypoints?.client)
    throw new DataError('视图插件缺少 client 入口')
  if (!manifest.contributes.fields?.length && !manifest.contributes.views?.length)
    throw new DataError('插件没有声明能力')
  for (const kind of ['fields', 'views'] as const) {
    const ids = manifest.contributes[kind] ?? []
    if (new Set(ids).size !== ids.length) throw new DataError('插件能力 ID 重复')
    if (ids.length && !manifest.categories.includes(kind))
      throw new DataError('插件类型与声明能力不一致')
  }
  for (const file of Object.values(manifest.entrypoints ?? {}))
    if (!files.has(file)) throw new DataError(`插件入口不存在：${file}`)
  const hash = createHash('sha256')
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b)))
    hash.update(name).update(bytes)
  manifest.digest = hash.digest('hex').slice(0, 20)
  return { manifest, files }
}

export function loadPluginPackages() {
  return (loading ??= load())
}
async function load() {
  const directories = [resolve(root, 'extensions'), localPluginDirectory()]
  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return []
        throw e
      },
    )
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      try {
        const pkg = await readPackage(resolve(directory, entry.name))
        if (directory === localPluginDirectory()) pkg.manifest.defaultInstalled = false
        if (extensionCatalog.some((e) => e.id === pkg.manifest.id))
          throw new Error(`插件 ID 重复：${pkg.manifest.id}`)
        packages.set(pkg.manifest.id, pkg)
        extensionCatalog.push(pkg.manifest)
      } catch (error) {
        console.error(`跳过无效插件目录 ${entry.name}:`, error)
      }
    }
  }
  const visited = new Set<string>(),
    visiting = new Set<string>()
  const activate = async (id: string) => {
    const manifest = extensionCatalog.find((e) => e.id === id)
    if (!manifest) throw new Error(`插件依赖缺失：${id}`)
    if (manifest.loadError) throw new Error(`插件依赖不可用：${id}`)
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`插件循环依赖：${id}`)
    visiting.add(id)
    const pkg = packages.get(id),
      scope = new PluginScope()
    try {
      for (const dependency of manifest.dependencies) await activate(dependency)
      if (pkg) await activatePackage(pkg, scope)
      visited.add(id)
    } catch (error) {
      try {
        scope.dispose()
      } finally {
        manifest.loadError = error instanceof Error ? error.message : '插件加载失败'
      }
      throw error
    } finally {
      visiting.delete(id)
    }
  }
  for (const e of extensionCatalog)
    try {
      await activate(e.id)
    } catch (error) {
      console.error(`插件 ${e.id} 加载失败:`, error)
    }
}

async function activatePackage(pkg: Package, scope: PluginScope) {
  const { manifest } = pkg
  if (pkg.manifest.entrypoints?.shared) {
    for (const field of manifest.contributes.fields ?? [])
      if (fieldTypes.has(field)) throw new Error(`字段 ID 已被占用：${field}`)
    const module = await import(
      pathToFileURL(resolve(pkg.directory, pkg.manifest.entrypoints.shared)).href +
        `?v=${manifest.digest}`
    )
    if (typeof module.activate !== 'function') throw new Error('shared 入口缺少 activate')
    await module.activate({
      fields: scope.registry(fieldTypes, manifest.contributes.fields ?? [], (field) => {
        if (
          !['text', 'numeric', 'boolean', 'date', 'jsonb'].includes(field.storage) ||
          typeof field.validate !== 'function' ||
          typeof field.format !== 'function' ||
          (field.validateOptions !== undefined && typeof field.validateOptions !== 'function')
        )
          throw new Error('字段插件契约无效')
      }),
      effect: (cleanup: () => void) => scope.effect(cleanup),
    })
    for (const field of manifest.contributes.fields ?? [])
      if (!fieldTypes.has(field)) throw new Error(`字段未注册：${field}`)
  }
}

export async function registerPackage(pkg: Package, beforePublish?: () => Promise<void>) {
  const scope = new PluginScope()
  try {
    await activatePackage(pkg, scope)
    await beforePublish?.()
  } catch (error) {
    scope.dispose()
    throw error
  }
  packages.set(pkg.manifest.id, pkg)
  extensionCatalog.push(pkg.manifest)
  return () => {
    packages.delete(pkg.manifest.id)
    const index = extensionCatalog.indexOf(pkg.manifest)
    if (index >= 0) extensionCatalog.splice(index, 1)
    scope.dispose()
  }
}

export function pluginAsset(id: string, file: string, digest: string | undefined) {
  const pkg = packages.get(id)
  if (!pkg || digest !== pkg.manifest.digest || !['.js', '.mjs', '.css'].includes(extname(file)))
    throw new DataError('插件资源不存在或版本已改变，请刷新页面', 404)
  const bytes = pkg.files.get(file)
  if (!bytes) throw new DataError('插件资源不存在', 404)
  return { bytes, mime: extname(file) === '.css' ? 'text/css' : 'text/javascript' }
}

export function pluginInstallPath(id: string) {
  const directory = resolve(localPluginDirectory(), key.parse(id))
  if (relative(dirname(directory), directory) !== id) throw new Error('插件路径无效')
  return directory
}
function localPluginDirectory() {
  return process.env.DATA_PLUGIN_DIR
    ? resolve(process.env.DATA_PLUGIN_DIR)
    : resolve(root, '.local/plugins')
}
