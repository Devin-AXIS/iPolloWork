import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { z } from 'zod'
import { pool } from './db'
import { DataError } from './errors'
import { getDocument, type DocumentScope } from './documents'
const fileName = z.string().regex(/^[a-f0-9]{64}\.(png|jpg|gif|webp|mp4|webm)$/)
const mime = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
}
async function directory(projectId: string) {
  z.uuid().parse(projectId)
  const id = (await pool.query('SELECT id FROM iw_data.database_identity WHERE singleton')).rows[0]
    .id
  return join(resolve(process.env.DOCUMENT_FILES_DIR ?? '.data/document-files'), id, projectId)
}
export async function uploadDocumentImage(scope: DocumentScope, documentId: string, raw: unknown) {
  const doc = await getDocument(scope, documentId)
  const input = z
    .object({ data: z.string().max(7_000_000) })
    .strict()
    .parse(raw)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw new DataError('图片格式不正确')
  const bytes = Buffer.from(input.data, 'base64')
  if (!bytes.length || bytes.length > 5_000_000) throw new DataError('图片最大为 5 MB')
  const ext = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? 'jpg'
      : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())
        ? 'gif'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
          ? 'webp'
          : undefined
  if (!ext) throw new DataError('请选择 PNG、JPEG、GIF 或 WebP 图片')
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`
  const dir = await directory(doc.projectId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), bytes, { flag: 'wx' }).catch((e) => {
    if (e.code !== 'EEXIST') throw e
  })
  return { src: `/api/projects/${doc.projectId}/document-images/${name}` }
}
export async function documentImage(projectId: string, file: string) {
  fileName.parse(file)
  try {
    return {
      bytes: await readFile(join(await directory(projectId), file)),
      mime: mime[file.split('.').at(-1) as keyof typeof mime],
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')
      throw new DataError('图片不存在', 404)
    throw e
  }
}

export async function uploadDocumentVideo(scope: DocumentScope, documentId: string, raw: unknown) {
  const doc = await getDocument(scope, documentId)
  const { data } = z
    .object({ data: z.string().max(33_400_000) })
    .strict()
    .parse(raw)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new DataError('视频格式不正确')
  const bytes = Buffer.from(data, 'base64')
  if (!bytes.length || bytes.length > 25_000_000) throw new DataError('视频最大为 25 MB')
  const ext =
    bytes.subarray(4, 8).toString() === 'ftyp'
      ? 'mp4'
      : bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
          bytes.subarray(0, 4096).includes(Buffer.from('webm'))
        ? 'webm'
        : undefined
  if (!ext) throw new DataError('请选择 MP4 或 WebM 视频')
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`
  const dir = await directory(doc.projectId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), bytes, { flag: 'wx' }).catch((e) => {
    if (e.code !== 'EEXIST') throw e
  })
  return { src: `/api/projects/${doc.projectId}/document-media/${name}` }
}
