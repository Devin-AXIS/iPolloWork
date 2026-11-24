/** Retire a completed NSIS download after the new app starts with its differential baseline in place. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { parse } from 'yaml'

const receiptName = 'ipollo-prepared-update.json'
const installerName = /^[a-z0-9][a-z0-9_.+-]*\.exe$/iu
const digestPattern = /^[a-z0-9+/]{86}==$/iu

interface Download {
  readonly fileName: string
  readonly sha512: string
}

function downloadRecord(value: unknown): Download | undefined {
  if (typeof value !== 'object' || value === null || !('fileName' in value) || !('sha512' in value)
    || typeof value.fileName !== 'string' || !installerName.test(value.fileName)
    || typeof value.sha512 !== 'string' || !digestPattern.test(value.sha512)) return
  return { fileName: value.fileName, sha512: value.sha512 }
}

async function statIfPresent(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
}

async function readRecord(path: string): Promise<unknown> {
  const info = await statIfPresent(path)
  if (!info?.isFile() || info.size > 4096) return undefined
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64')
}

/** Restrict maintenance to the updater directory named by the installed app configuration. */
export async function windowsUpdaterCache(configPath: string, localAppData: string): Promise<string | undefined> {
  if (!isAbsolute(localAppData)) return
  const config: unknown = parse(await readFile(configPath, 'utf8'))
  if (typeof config !== 'object' || config === null || !('updaterCacheDirName' in config)) return
  const name = config.updaterCacheDirName
  if (typeof name !== 'string' || !/^[a-z0-9@_-][a-z0-9@._-]*$/iu.test(name) || name.endsWith('.')) return
  const cache = join(localAppData, name)
  const pending = join(cache, 'pending')
  if (!(await statIfPresent(cache))?.isDirectory() || !(await statIfPresent(pending))?.isDirectory()) return
  return pending
}

/** Bind the updater's verified download to the product version accepted by the coordinator. */
export async function saveWindowsUpdateReceipt(pending: string, version: string, downloadedFiles: readonly string[]): Promise<void> {
  if (downloadedFiles.length !== 1) return // Web installers have a separate package and cache contract.
  const record = downloadRecord(await readRecord(join(pending, 'update-info.json')))
  if (record === undefined || downloadedFiles[0] !== join(pending, record.fileName)) return
  const path = join(pending, receiptName)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ version, ...record }), { flag: 'wx', flush: true })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  }
}

/** Keep the root installer for the next differential download and unlink only the proven duplicate. */
export async function retireWindowsUpdateDuplicate(pending: string, installedVersion: string): Promise<void> {
  const receiptPath = join(pending, receiptName)
  const receipt = await readRecord(receiptPath)
  if (typeof receipt !== 'object' || receipt === null || !('version' in receipt) || receipt.version !== installedVersion) return
  const record = downloadRecord(receipt)
  if (record === undefined) return
  const metadata = downloadRecord(await readRecord(join(pending, 'update-info.json')))
  if (metadata?.fileName !== record.fileName || metadata.sha512 !== record.sha512) return

  const baseline = join(dirname(pending), 'installer.exe')
  const candidate = join(pending, record.fileName)
  const [original, duplicate] = await Promise.all([statIfPresent(baseline), statIfPresent(candidate)])
  if (!original?.isFile() || !duplicate?.isFile() || original.size !== duplicate.size) return
  if (await digest(baseline) !== record.sha512 || await digest(candidate) !== record.sha512) return
  const current = await statIfPresent(candidate)
  if (!current?.isFile() || current.ino !== duplicate.ino || current.size !== duplicate.size
    || current.mtimeMs !== duplicate.mtimeMs) return
  await unlink(candidate)
  await unlink(receiptPath)
}
