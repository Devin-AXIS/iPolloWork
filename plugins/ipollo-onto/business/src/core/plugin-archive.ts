import { z } from 'zod'
import type { ExtensionManifest } from './extensions'

export const pluginMaxBytes = 5_000_000
export const pluginFileName = z
  .string()
  .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,119}$/, '插件文件名无效')
export const pluginUploadInput = z
  .object({
    files: z
      .array(
        z
          .object({
            name: pluginFileName,
            contentBase64: z
              .string()
              .max(6_666_668)
              .regex(/^[A-Za-z0-9+/]*={0,2}$/, '插件文件编码无效')
              .refine((value) => value.length % 4 === 0, '插件文件编码无效'),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict()
export type PluginUpload = z.infer<typeof pluginUploadInput>
export interface PluginImportPreview {
  manifest: ExtensionManifest
  fileCount: number
  bytes: number
  existing: boolean
}

// Decode in a worker when possible. No uploaded code executes during selection or preview.
export async function decodePluginArchive(data: Uint8Array): Promise<PluginUpload> {
  if (data.byteLength > pluginMaxBytes) throw new Error('ZIP 包不能超过 5 MB')
  const { unzip } = await import('fflate')
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    let declared = 0,
      count = 0,
      problem = ''
    const paths = new Set<string>()
    let cancel: (() => void) | undefined
    const timer = setTimeout(() => {
      cancel?.()
      reject(new Error('解包超时，请检查插件包'))
    }, 15000)
    try {
      cancel = unzip(
        data,
        {
          filter(file) {
            if (++count > 128) problem = '插件包文件过多'
            if (
              file.name.startsWith('/') ||
              file.name.includes('\\') ||
              file.name.split('/').some((p) => p === '..' || p === '.')
            )
              problem = 'ZIP 包含不安全的文件路径'
            if (paths.has(file.name)) problem = 'ZIP 包含重复文件'
            paths.add(file.name)
            if (
              file.name.endsWith('/') ||
              file.name.startsWith('__MACOSX/') ||
              file.name.endsWith('/.DS_Store') ||
              file.name === '.DS_Store'
            )
              return false
            declared += file.originalSize
            if (declared > pluginMaxBytes) problem = '解压后的插件不能超过 5 MB'
            return !problem
          },
        },
        (error, result) => {
          clearTimeout(timer)
          if (problem || error) reject(new Error(problem || '无法解压，请选择完整的 ZIP 插件包'))
          else resolve(result)
        },
      )
    } catch (error) {
      clearTimeout(timer)
      reject(error)
    }
  })
  const names = Object.keys(files)
  const manifests = names.filter(
    (name) => name === 'package.json' || /^[^/]+\/package\.json$/.test(name),
  )
  if (manifests.length !== 1)
    throw new Error('ZIP 需要包含一个 package.json；可放在根目录或一层插件文件夹内')
  const prefix = manifests[0].slice(0, -'package.json'.length)
  let bytes = 0
  const result = names.map((path) => {
    if (!path.startsWith(prefix)) throw new Error('ZIP 中包含插件目录以外的文件')
    const name = pluginFileName.parse(path.slice(prefix.length))
    bytes += files[path].byteLength
    if (bytes > pluginMaxBytes) throw new Error('解压后的插件不能超过 5 MB')
    let binary = ''
    for (let i = 0; i < files[path].length; i += 8192)
      binary += String.fromCharCode(...files[path].subarray(i, i + 8192))
    return { name, contentBase64: btoa(binary) }
  })
  return pluginUploadInput.parse({ files: result })
}
