import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, safeStorage, session, type Cookie, type Session } from 'electron'
import { z } from 'zod'
import type { EnterpriseDesktopMessage } from './enterprise-desktop-protocol.ts'

const grant = z.object({ origin: z.string().max(2048), payload: z.string().min(1).max(65_536) })
const site = z.object({
  accountOrigin: z.string().max(2048),
  userId: z.string().min(1).max(200),
  enterpriseId: z.string().min(1).max(200),
  siteId: z.uuid(),
  label: z.string().min(1).max(80),
  url: z.string().max(2048),
  cookieNames: z.array(z.string().min(1).max(128)).max(12),
})
const cookie = z.object({
  name: z.string().max(128),
  value: z.string().max(4096),
  path: z.string().startsWith('/').max(2048),
  expirationDate: z.number().finite(),
  sameSite: z.enum(['unspecified', 'no_restriction', 'lax', 'strict']),
})
type SavedCookie = z.infer<typeof cookie>
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')

function networkUrl(value: string): URL | undefined {
  const url = URL.parse(value)
  if (url && !url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'http:')) return url
}

export class EnterpriseDesktop {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly active = new Map<string, BrowserWindow>()
  private readonly tracked = new Map<string, { session: Session; stop: () => void }>()

  constructor(private readonly directory: string, private readonly localHost: () => string | undefined,
    private readonly applicationIconPath: string) {}

  handle(message: EnterpriseDesktopMessage): Promise<unknown> {
    return this.serialize(async () => {
      switch (message.operation) {
        case 'seal': {
          const input = grant.parse(message.value)
          return (await this.encrypt('account:' + input.origin, input.payload)).toString('base64')
        }
        case 'unseal': {
          const input = grant.parse(message.value)
          return this.decrypt('account:' + input.origin, Buffer.from(input.payload, 'base64'))
        }
        case 'open':
          await this.open(site.parse(message.value))
          return true
        case 'close':
          await this.closeSessions()
          return true
        case 'clear':
          await this.closeSessions()
          await rm(this.directory, { recursive: true, force: true })
          return true
      }
    })
  }

  flush(): Promise<unknown> { return this.queue }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async encrypt(scope: string, data: unknown): Promise<Buffer> {
    if (!await this.available()) throw new Error('OS credential storage is unavailable')
    return safeStorage.encryptStringAsync(JSON.stringify({ scope, data }))
  }

  private async decrypt(scope: string, encrypted: Buffer): Promise<unknown> {
    if (!await this.available()) throw new Error('OS credential storage is unavailable')
    const { result } = await safeStorage.decryptStringAsync(encrypted)
    return z.object({ scope: z.literal(scope), data: z.unknown() }).parse(JSON.parse(result)).data
  }

  private async available(): Promise<boolean> {
    if (!await safeStorage.isAsyncEncryptionAvailable()) return false
    if (process.platform !== 'linux') return true
    return ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())
  }

  private async closeSessions(): Promise<void> {
    for (const { stop } of this.tracked.values()) stop()
    for (const window of this.active.values()) window.destroy()
    const clear = Array.from(this.tracked.values(), ({ session: profile }) => profile.clearStorageData())
    this.active.clear()
    this.tracked.clear()
    await Promise.all(clear)
  }

  private async open(input: z.infer<typeof site>): Promise<void> {
    const target = networkUrl(input.url)
    const account = networkUrl(input.accountOrigin)
    const host = this.localHost()
    const local = host === undefined ? undefined : networkUrl(host)
    if (!target || !account || account.origin !== input.accountOrigin || target.origin === local?.origin)
      throw new Error('Invalid organization browser target')
    const names = [...new Set(input.cookieNames)].sort()
    if (names.length && target.protocol !== 'https:') throw new Error('Remembered sign-in requires HTTPS')
    const scope = digest([account.origin, input.userId, input.enterpriseId, input.siteId, target.origin, names])
    const opened = this.active.get(scope)
    if (opened && !opened.isDestroyed()) { opened.focus(); return }
    // Only explicitly permitted authentication cookies survive the process. Chromium storage is in memory.
    const profile = session.fromPartition('ipollo-enterprise-' + randomUUID(), { cache: false })
    const file = join(this.directory, scope + '.bin')
    const permitted = (item: Cookie) => item.hostOnly === true && item.domain === target.hostname &&
      item.secure === true && item.httpOnly === true && names.includes(item.name)
    const current = (items: SavedCookie[]) => items.filter(item =>
      names.includes(item.name) && item.expirationDate > Date.now() / 1000)
    if (names.length) {
      if (!await this.available()) throw new Error('OS credential storage is unavailable')
      const encrypted = await readFile(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      })
      if (encrypted) {
        const real = await this.decrypt(scope, encrypted)
        for (const item of current(z.array(cookie).max(64).parse(real))) {
          await profile.cookies.set({
            ...item, url: target.origin + '/', secure: true, httpOnly: true,
          })
        }
      }
    }
    profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    profile.setPermissionCheckHandler(() => false)
    profile.setDevicePermissionHandler(() => false)
    profile.setDisplayMediaRequestHandler((_request, callback) => callback({}))
    const allowed = (url: string) => networkUrl(url)?.origin === target.origin
    profile.webRequest.onBeforeRequest((details, callback) => {
      const url = URL.parse(details.url)
      const blocked = local !== undefined && url !== null && url.port === local.port
        && (url.hostname === local.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      callback({ cancel: blocked || (details.resourceType === 'mainFrame' && !allowed(details.url)) })
    })
    profile.on('will-download', event => event.preventDefault())
    const window = new BrowserWindow({
      title: input.label, width: 1060, height: 760, autoHideMenuBar: true, icon: this.applicationIconPath,
      webPreferences: {
        session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false,
        webviewTag: false, devTools: false, navigateOnDragDrop: false,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
    window.webContents.on('will-redirect', (event, url, _inPlace, mainFrame) => {
      if (mainFrame && !allowed(url)) event.preventDefault()
    })
    this.active.set(scope, window)
    let watching = true
    const changed = (_event: Electron.Event, item: Cookie) => {
      if (!permitted(item)) return
      void this.serialize(async () => {
        if (!watching) return
        const stored = await profile.cookies.get({ domain: target.hostname })
        const persistent = stored.filter(value => permitted(value) && value.session === false)
          .flatMap(value => {
            const checked = cookie.safeParse(value)
            return checked.success ? [checked.data] : []
          })
        const items = current(persistent).slice(0, 64)
        if (!items.length) { await rm(file, { force: true }); return }
        const encrypted = await this.encrypt(scope, items)
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        const temporary = file + '.' + randomUUID() + '.tmp'
        try {
          await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' })
          await rename(temporary, file)
        } finally { await rm(temporary, { force: true }) }
      }).catch(() => { console.warn('Could not save the organization browser session') })
    }
    const stop = () => {
      watching = false
      profile.cookies.off('changed', changed)
    }
    if (names.length) profile.cookies.on('changed', changed)
    this.tracked.set(scope, { session: profile, stop })
    window.once('closed', () => {
      this.active.delete(scope)
      // Allow queued cookie changes to finish before dropping this in-memory session.
      void this.serialize(async () => {
        stop()
        if (this.tracked.get(scope)?.session === profile) this.tracked.delete(scope)
        await profile.clearStorageData()
      })
    })
    void window.loadURL(target.href).catch(() => {
      if (!window.isDestroyed()) window.destroy()
    })
  }
}
