import { mkdir, mkdtemp, writeFile, rename, rm, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { extensionCatalog } from '../core/extensions'
import { pluginUploadInput, pluginMaxBytes, type PluginImportPreview } from '../core/plugin-archive'
import {
  inspectPackage,
  loadPluginPackages,
  pluginInstallPath,
  readPackage,
  registerPackage,
} from './plugin-packages'
import { changeExtension, requireExtension, setExtension, getExtensions } from './extensions'
import { transaction } from './db'
import { DataError } from './errors'

async function inspect(raw: unknown) {
  await loadPluginPackages()
  const input = pluginUploadInput.parse(raw),
    files = new Map<string, Uint8Array>()
  let bytes = 0
  for (const file of input.files) {
    if (files.has(file.name)) throw new DataError('插件包存在重复文件')
    const value = Buffer.from(file.contentBase64, 'base64')
    bytes += value.length
    if (bytes > pluginMaxBytes) throw new DataError('解压后的插件不能超过 5 MB')
    files.set(file.name, value)
  }
  const pkg = inspectPackage(files)
  pkg.manifest.defaultInstalled = false
  const existing = extensionCatalog.find((e) => e.id === pkg.manifest.id)
  if (existing && existing.digest !== pkg.manifest.digest)
    throw new DataError(
      '同名插件已存在。当前导入不覆盖已有版本，请使用新的插件 ID 或按升级说明操作。',
      409,
    )
  if (existing?.loadError) throw new DataError(`现有插件加载失败：${existing.loadError}`, 409)
  for (const kind of ['fields', 'views'] as const)
    for (const id of pkg.manifest.contributes[kind] ?? [])
      if (
        extensionCatalog.some((e) => e.id !== pkg.manifest.id && e.contributes[kind]?.includes(id))
      )
        throw new DataError(`能力 ID 已被其他插件使用：${id}`, 409)
  if (pkg.manifest.dependencies.includes(pkg.manifest.id)) throw new DataError('插件不能依赖自己')
  await transaction(async (db) => {
    for (const id of pkg.manifest.dependencies) await requireExtension(db, id)
  })
  return { ...pkg, bytes, existing: Boolean(existing) }
}
export async function previewPluginImport(raw: unknown): Promise<PluginImportPreview> {
  const { manifest, files, bytes, existing } = await inspect(raw)
  return { manifest, fileCount: files.size, bytes, existing }
}

// The process-wide catalog and filesystem publish in order; database installation stays scoped.
let queue: Promise<unknown> = Promise.resolve()
export function importPlugin(raw: unknown) {
  const next = queue.catch(() => undefined).then(() => install(raw))
  queue = next
  return next
}
async function install(raw: unknown) {
  const pkg = await inspect(raw)
  if (pkg.existing) return changeExtension(pkg.manifest.id, 'install')
  const destination = pluginInstallPath(pkg.manifest.id),
    parent = dirname(destination)
  await mkdir(parent, { recursive: true })
  if (
    await lstat(destination).then(
      () => true,
      (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return false
        throw e
      },
    )
  )
    throw new DataError('本地存在同名插件目录，请先检查该目录', 409)
  const staging = await mkdtemp(join(parent, '.import-'))
  let published = false,
    undo: (() => void) | undefined
  try {
    for (const [name, bytes] of pkg.files)
      await writeFile(join(staging, name), bytes, { flag: 'wx' })
    await rename(staging, destination)
    published = true
    const installed = await readPackage(destination)
    installed.manifest.defaultInstalled = false
    undo = await registerPackage(installed, () =>
      setExtension(installed.manifest.id, 'install', installed.manifest),
    )
  } catch (error) {
    try {
      undo?.()
    } finally {
      if (published) await rm(destination, { recursive: true, force: true })
    }
    if (error instanceof DataError) throw error
    throw new DataError(`插件未导入：${error instanceof Error ? error.message : '加载失败'}`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return getExtensions()
}
