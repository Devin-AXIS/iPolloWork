import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import sharp from 'sharp'
import { config } from './config.js'
import type { OpsDatabase } from './db.js'

// Uploaded files and workbench imports share the same validation and storage.
export async function storeMedia(db: OpsDatabase, file: File) {
  const video = file.type === 'video/mp4'
  if (!video && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('支持 PNG、JPEG、WebP 图片和 MP4 视频')
  if (!file.size || file.size > (video ? 200 : 15) * 1024 * 1024) throw new Error(video ? '视频须小于 200 MB' : '图片须小于 15 MB')
  let bytes: Buffer = Buffer.from(await file.arrayBuffer())
  let width: number | null = null
  let height: number | null = null
  if (video) {
    if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('无法识别 MP4 文件')
  } else {
    const converted = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer({ resolveWithObject: true })
    bytes = converted.data; width = converted.info.width; height = converted.info.height
  }
  const hash = createHash('sha256').update(bytes).digest('hex')
  const existing = db.database.prepare('SELECT id FROM assets WHERE sha256 = ? LIMIT 1').get(hash)
  if (existing) return db.getAssets([String(existing.id)])[0]!
  const relativePath = `uploads/${hash}.${video ? 'mp4' : 'png'}`
  await mkdir(resolve(config.assetDir, 'uploads'), { recursive: true, mode: 0o700 })
  await writeFile(resolve(config.assetDir, relativePath), bytes, { mode: 0o600 })
  const concurrent = db.database.prepare('SELECT id FROM assets WHERE relative_path = ?').get(relativePath)
  if (concurrent) return db.getAssets([String(concurrent.id)])[0]!
  return db.createAsset({ kind: 'upload', filename: basename(file.name).slice(0, 200), mimeType: video ? 'video/mp4' : 'image/png', relativePath, sha256: hash, width, height })
}
