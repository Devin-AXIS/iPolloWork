/** Trusted-window Chromium downloads and clipboard fallback reads. */
import { app, dialog, ipcMain, session } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent, SaveDialogOptions, WebContents } from 'electron'
import { createWriteStream, openSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { resolveDragFileName } from '@deepseek-ai/dsh-util-file-drag'
import { randomUUID } from 'node:crypto'
import type { FileSaveResult } from '@deepseek-ai/dsh-client-ui-file-actions/types'
import { DESKTOP_IPC } from './ipc.ts'
import { resolveDurationMs } from './duration-env.ts'

function saveDialogOptions(name: string): SaveDialogOptions {
  return { defaultPath: join(app.getPath('downloads'), name), properties: ['showOverwriteConfirmation', 'createDirectory'] }
}

/** Accept either mode for compatibility with installed plugins and older clients. */
function saveRequest(value: unknown): { url: URL; name?: string; mediaType?: string } {
  if (typeof value !== 'object' || value === null
    || !('url' in value) || typeof value.url !== 'string'
    || ('name' in value && typeof value.name !== 'string')
    || ('mediaType' in value && typeof value.mediaType !== 'string')
    || !('mode' in value) || (value.mode !== 'download' && value.mode !== 'saveAs')) throw new Error('Invalid file save request')
  const url = new URL(value.url)
  const packageDownload = /^\/ipollowork-suite\/enterprise\/organizations\/[\w-]{1,200}\/packages\/[\w-]{1,200}\/files\/[\w-]{1,200}\/download$/u.test(url.pathname)
  const projectDownload = /^\/ipollowork-suite\/enterprise\/(?:download\/[\w-]{1,200}|projects\/[\w-]{1,200}\/memory-versions\/\d+)$/u.test(url.pathname)
  const appDownload = url.protocol === 'dsh-app:' && url.host === 'app' && !url.search &&
    'name' in value && typeof value.name === 'string' && !!value.name.trim() && (packageDownload || projectDownload)
  if ((!appDownload && !['https:', 'http:', 'blob:', 'data:'].includes(url.protocol)) || url.username || url.password)
    throw new Error('Unsupported file source')
  return { url,
    ...'name' in value ? { name: value.name as string } : {},
    ...'mediaType' in value ? { mediaType: value.mediaType as string } : {},
  }
}

/**
 * Install trusted-window original-file operations.
 * @param assertOwner - rejects shell pages, subframes, and unowned windows.
 * @param hostUrl - current application Host excluded from image reads.
 * @param projectRequest - authenticated fetch for allowlisted project downloads.
 * @param isApplicationContents - identifies browser downloads from the application window, including plugin frames.
 */
export function installFileActions(
  assertOwner: (event: IpcMainInvokeEvent) => BrowserWindow, hostUrl: () => string | undefined = () => undefined,
  projectRequest?: (request: Request) => Promise<Response>,
  isApplicationContents: (contents: WebContents) => boolean = () => false,
): void {
  const timeoutMs = resolveDurationMs(process.env, 'DSH_DESKTOP_IMAGE_READ_TIMEOUT_MS', 30_000)
  const maxBytes = Number(process.env.DSH_DESKTOP_IMAGE_READ_MAX_BYTES ?? 64 * 1024 * 1024)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('DSH_DESKTOP_IMAGE_READ_MAX_BYTES must be a positive integer')
  const pending = new Map<string, {
    event: IpcMainInvokeEvent
    owner: BrowserWindow
    request: ReturnType<typeof saveRequest>
    finish: (result: FileSaveResult | Error) => void
    started: () => void
    item?: Electron.DownloadItem
  }>()
  session.defaultSession.on('will-download', (_event, item, contents) => {
    const url = item.getURLChain()[0]
    if (url === undefined || !new URL(url).hash.startsWith('#dsh-download=')) {
      if (contents && isApplicationContents(contents)) {
        const name = resolveDragFileName({ name: item.getFilename(), mediaType: '' })
        item.setSaveDialogOptions(saveDialogOptions(name))
      }
      return
    }
    const entry = pending.get(url)
    if (entry === undefined || entry.owner.webContents !== contents) { item.cancel(); return }
    entry.started()
    entry.item = item
    try {
      assertOwner(entry.event)
      const name = resolveDragFileName({
        name: entry.request.name ?? item.getFilename(),
        mediaType: item.getMimeType() || entry.request.mediaType || '',
      })
      item.setSaveDialogOptions(saveDialogOptions(name))
      item.once('done', (_event, state) => {
        try {
          if (state !== 'completed') {
            entry.finish(state === 'cancelled' ? { status: 'cancelled' } : new Error('File download interrupted'))
            return
          }
          if (!pending.has(url)) return
          assertOwner(entry.event)
          entry.finish({ status: 'saved', path: item.getSavePath() })
        } catch (error) { entry.finish(error instanceof Error ? error : new Error('File download unavailable')) }
      })
    } catch (error) {
      item.cancel()
      entry.finish(error instanceof Error ? error : new Error('File download unavailable'))
    }
  })
  const downloadTimeoutMs = resolveDurationMs(process.env, 'DSH_DESKTOP_FILE_DOWNLOAD_TIMEOUT_MS', 300_000)

  // Chromium may complete application-scheme downloads without consuming the protocol response body.
  async function saveProject(event: IpcMainInvokeEvent, owner: BrowserWindow, request: ReturnType<typeof saveRequest>): Promise<FileSaveResult> {
    if (!projectRequest || !request.name) throw new Error('Project download unavailable')
    const contents = owner.webContents
    const lifetime = new AbortController()
    const abort = (): void => { lifetime.abort() }
    const navigate = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
      if (mainFrame && !inPlace) abort()
    }
    owner.once('closed', abort)
    contents.on('did-start-navigation', navigate)
    let temporary: string | undefined
    try {
      const name = resolveDragFileName({ name: request.name, mediaType: '' })
      const choice = await dialog.showSaveDialog(owner, saveDialogOptions(name))
      if (choice.canceled || !choice.filePath || lifetime.signal.aborted) return { status: 'cancelled' }
      assertOwner(event)
      const destination = choice.filePath
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(downloadTimeoutMs)])
      request.url.hash = ''
      let response = await projectRequest(new Request(request.url, { signal }))
      if (response.status === 303) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        const target = location ? new URL(location) : undefined
        if (!target || target.protocol !== 'https:' || target.username || target.password) throw new Error('Invalid project download redirect')
        response = await fetch(target, { signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' })
      }
      if (response.status !== 200 || response.body === null) {
        await response.body?.cancel()
        throw new Error('Project download unavailable')
      }
      // Stage beside the destination so an interrupted overwrite leaves the previous file intact.
      const stagingPath = join(dirname(destination), '.ipollowork-download-' + randomUUID() + '.tmp')
      const fd = openSync(stagingPath, 'wx')
      temporary = stagingPath
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(stagingPath, { fd }), { signal })
      assertOwner(event)
      signal.throwIfAborted()
      renameSync(stagingPath, destination)
      return { status: 'saved', path: destination }
    } catch (error) {
      if (temporary !== undefined) rmSync(temporary, { force: true })
      if (lifetime.signal.aborted) return { status: 'cancelled' }
      throw error
    } finally {
      lifetime.abort()
      owner.removeListener('closed', abort)
      contents.removeListener('did-start-navigation', navigate)
    }
  }

  ipcMain.handle(DESKTOP_IPC.fileSave, (event, value: unknown): Promise<FileSaveResult> => {
    const owner = assertOwner(event)
    const request = saveRequest(value)
    if (request.url.protocol === 'dsh-app:') return saveProject(event, owner, request)
    // Fragments do not change the fetched resource; each native request has its own completion identity.
    request.url.hash = `dsh-download=${randomUUID()}`
    const url = request.url.href
    return new Promise((resolve, reject) => {
      const contents = owner.webContents
      const finish = (result: FileSaveResult | Error): void => {
        if (!pending.delete(url)) return
        clearTimeout(timer)
        owner.removeListener('closed', cancel)
        contents.removeListener('did-start-navigation', navigate)
        if (result instanceof Error) reject(result)
        else resolve(result)
      }
      const cancel = (): void => {
        const item = pending.get(url)?.item
        finish({ status: 'cancelled' })
        item?.cancel()
      }
      const navigate = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
        if (mainFrame && !inPlace) cancel()
      }
      const timer = setTimeout(() => {
        const item = pending.get(url)?.item
        finish(new Error('File download timed out'))
        item?.cancel()
      }, downloadTimeoutMs)
      pending.set(url, { event, owner, request, finish, started: () => { clearTimeout(timer) } })
      owner.once('closed', cancel)
      contents.on('did-start-navigation', navigate)
      try { contents.downloadURL(url) }
      catch (error) { finish(error instanceof Error ? error : new Error('File download unavailable')) }
    })
  })
  ipcMain.handle(DESKTOP_IPC.clipboardImageRead, async (event, value: unknown) => {
    const owner = assertOwner(event)
    if (typeof value !== 'string') throw new Error('Invalid image URL')
    const checkedUrl = (value: string): URL => {
      const url = new URL(value)
      const host = hostUrl()
      const application = host === undefined ? undefined : new URL(host)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
        || application !== undefined && url.port === application.port
        && (url.hostname === application.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
        throw new Error('Invalid image URL')
      }
      return url
    }
    let url = checkedUrl(value)
    const contents = owner.webContents
    const lifetime = new AbortController()
    const abort = (): void => { lifetime.abort() }
    owner.once('closed', abort)
    const navigate = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
      if (mainFrame && !inPlace) abort()
    }
    contents.on('did-start-navigation', navigate)
    try {
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeoutMs)])
      let response: Response
      for (let redirects = 0; ; redirects++) {
        response = await fetch(url, { signal, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer' })
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (redirects >= 20 || location === null) throw new Error('Invalid image redirect')
        url = checkedUrl(new URL(location, url).href)
      }
      if (!response.ok) throw new Error('Original image unavailable')
      const reader = response.body?.getReader()
      if (reader === undefined) throw new Error('Original image unavailable')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > maxBytes) throw new Error('Original image exceeds the download limit')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      assertOwner(event)
      lifetime.signal.throwIfAborted()
      return { bytes: new Uint8Array(Buffer.concat(chunks)), mediaType: response.headers.get('content-type') ?? '' }
    } finally {
      owner.removeListener('closed', abort)
      contents.removeListener('did-start-navigation', navigate)
    }
  })
}
