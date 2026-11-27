/** Account-specific browser views for the social workbenches. */
import { createHash } from 'node:crypto'
import { WebContentsView, session, type BrowserWindow, type WebContents, type WebPreferences } from 'electron'
import { z } from 'zod'
import { isSocialLoginReload, mountSocialLoginChrome } from './social-login-feedback.ts'

// A full-window feedback view can cover the renderer, so Chromium may delay paint timing until it is removed.
const WAIT_FOR_PLATFORM_CONTENT = `new Promise(resolve => {
  const hasContent = () => document.body.innerText.trim().length > 0
    || Array.from(document.body.querySelectorAll('img, svg, canvas, iframe, video')).some(element => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility === 'visible'
        && (!(element instanceof HTMLImageElement) || element.naturalWidth > 0)
    })
  if (hasContent()) { resolve(true); return }
  const check = () => {
    if (!hasContent()) return
    observer.disconnect()
    document.removeEventListener('load', check, true)
    resolve(true)
  }
  const observer = new MutationObserver(check)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  document.addEventListener('load', check, true)
})`

const wechatAssets = 'https://res.wx.qq.com'
const localHttpProxy = /^PROXY ((?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5})$/i

const platforms = {
  'douyin-ops': {
    label: '抖音账号登录',
    url: 'https://www.douyin.com/user/self',
    origins: ['https://www.douyin.com', 'https://sso.douyin.com', 'https://login.douyin.com'],
    page: /^\/user\/[\w-]+\/?$/,
  },
  'wechat-channels-ops': {
    label: '视频号账号登录',
    url: 'https://channels.weixin.qq.com/platform/',
    loginEntry: 'https://channels.weixin.qq.com/login.html',
    origins: ['https://channels.weixin.qq.com', 'https://open.weixin.qq.com'],
    page: /^\/platform(?:\/home)?\/?$/,
  },
  'xiaohongshu-ops': {
    label: '小红书账号登录',
    url: 'https://creator.xiaohongshu.com/new/home',
    loginEntry: 'https://creator.xiaohongshu.com/login',
    origins: ['https://creator.xiaohongshu.com'],
    page: /^\/new\/home\/?$/,
  },
}

export const socialLoginRequest = z.object({
  plugin: z.enum(['douyin-ops', 'wechat-channels-ops', 'xiaohongshu-ops']),
  browserProfileId: z.uuid(),
  workspace: z.string().min(1).max(4096),
  sessionId: z.string().min(1).max(200),
  startAtQr: z.literal(true).optional(),
}).strict()
export type SocialLoginRequest = z.infer<typeof socialLoginRequest>
export type SocialLoginObservation = Omit<SocialLoginRequest, 'startAtQr'> & { readonly url: string; readonly tree: string }
export type SocialLoginObservationResult = 'waiting' | 'connected' | 'mismatch' | 'duplicate'
export type SocialLoginResult = Exclude<SocialLoginObservationResult, 'waiting'> | 'closed' | 'expired' | 'unavailable'

interface AXNode {
  nodeId?: string
  childIds?: string[]
  ignored?: boolean
  role?: { value?: unknown }
  name?: { value?: unknown }
  properties?: { name: string; value?: { value?: unknown } }[]
}

/** Keep the rendered identity and account-owner controls in the format the business observers expect. */
export function socialLoginTree(nodes: readonly AXNode[], plugin?: SocialLoginRequest['plugin']): string {
  const byId = new Map(nodes.map(node => [node.nodeId, node]))
  const children = new Set(nodes.flatMap(node => node.childIds ?? []))
  const pending = nodes.filter(node => node.nodeId === undefined || !children.has(node.nodeId)).reverse()
  const seen = new Set<AXNode>()
  const entries: { role: string; text: string; level: unknown }[] = []
  while (pending.length > 0) {
    const node = pending.pop()!
    if (seen.has(node)) continue
    seen.add(node)
    const { ignored, role, name, properties, childIds } = node
    for (const id of [...(childIds ?? [])].reverse()) {
      const child = byId.get(id)
      if (child) pending.push(child)
    }
    if (ignored || typeof name?.value !== 'string' || !name.value.trim()
      || !['heading', 'StaticText', 'tab', 'button'].includes(String(role?.value))) continue
    entries.push({
      role: String(role?.value), text: name.value.trim().slice(0, 300),
      level: properties?.find(property => property.name === 'level')?.value?.value,
    })
  }
  // Forward the public account labels and their neighbors, not the full page.
  const wechat = plugin === 'wechat-channels-ops'
  const wechatId = /^视频号\s*ID/i
  const wechatName = /^(?:视频号(?:名称|昵称)|账号名称|帐号名称|账户名称)(?:\s*[:：]|$)/
  const isText = (role: string): boolean => role === 'StaticText' || role === 'heading'
  const marker = entries.findIndex(entry => wechat
    ? isText(entry.role) && wechatId.test(entry.text)
    : /^(?:抖音号\s*[:：]|视频号\s*ID|小红书(?:账号|号)\s*[:：])/i.test(entry.text))
  if (marker < 0) return ''
  const relevant = new Set([marker])
  if (wechat) {
    const addField = (index: number, pattern: RegExp): void => {
      const field = entries[index]
      if (!field) return
      relevant.add(index)
      if (field.text.replace(pattern, '').replace(/^[\s:：]+/, '')) return
      const next = entries[index + 1]
      if (next && isText(next.role)) {
        relevant.add(index + 1)
        if (/^[:：]$/.test(next.text) && entries[index + 2] && isText(entries[index + 2]!.role)) relevant.add(index + 2)
      }
    }
    addField(marker, wechatId)
    const label = entries.findIndex((entry, index) => Math.abs(index - marker) <= 8
      && isText(entry.role) && wechatName.test(entry.text))
    addField(label, wechatName)
  } else relevant.add(marker + 1)
  const brand = entries.findIndex(entry => entry.text === '创作服务平台')
  if (brand >= 0) { relevant.add(brand); relevant.add(brand + 1) }
  const heading = entries.findLastIndex((entry, index) => entry.role === 'heading' && index < marker)
  if (heading >= 0) relevant.add(heading)
  const topHeading = entries.findLastIndex((entry, index) => entry.role === 'heading' && entry.level === 1 && index < marker)
  if (topHeading >= 0) relevant.add(topHeading)
  return entries.flatMap(({ role, text, level }, index) =>
    relevant.has(index) || (['button', 'tab'].includes(role) && ['编辑资料', '批量管理', '私密作品', '观看历史'].includes(text))
      ? [`${role} ${JSON.stringify(text)}${typeof level === 'number' ? ' level=' + String(level) : ''}`]
      : []).join('\n')
}

export class DesktopSocialLogin {
  private active: { focus(): void; key: string; result: Promise<SocialLoginResult> } | undefined
  private readonly configured = new WeakSet<Electron.Session>()

  open(
    owner: BrowserWindow, { startAtQr, ...input }: SocialLoginRequest,
    observe: (sample: SocialLoginObservation, signal: AbortSignal) => Promise<SocialLoginObservationResult>,
  ): Promise<SocialLoginResult> {
    const key = `${input.plugin}:${input.browserProfileId}`
    if (this.active?.key === key) {
      this.active.focus()
      return this.active.result
    }
    if (this.active || owner.isDestroyed()) return Promise.resolve('unavailable')
    const ownerContents = owner.webContents
    const platform = platforms[input.plugin]
    const approved = (address: string): boolean => {
      const url = URL.parse(address)
      return url !== null && platform.origins.includes(url.origin) && !url.username && !url.password
    }
    const partition = 'persist:ipollo-social-' + createHash('sha256').update(key).digest('hex')
    const browserSession = session.fromPartition(partition)
    if (!this.configured.has(browserSession)) {
      this.configured.add(browserSession)
      browserSession.setPermissionCheckHandler(() => false)
      browserSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
      browserSession.setDevicePermissionHandler(() => false)
      browserSession.setDisplayMediaRequestHandler((_request, done) => done({}))
      browserSession.on('will-download', event => event.preventDefault())
      browserSession.webRequest.onBeforeRequest(({ url, resourceType }, done) => {
        const address = new URL(url)
        const network = ['https:', 'wss:'].includes(address.protocol)
        const remoteName = /[a-z]/i.test(address.hostname) && !address.hostname.includes(':')
          && address.hostname.includes('.') && !/\.(localhost|local|internal)\.?$/i.test(address.hostname)
        done({ cancel: resourceType === 'mainFrame' ? !approved(url)
          : network ? !remoteName || Boolean(address.username || address.password)
            : !['about:', 'data:', 'blob:'].includes(address.protocol) })
      })
    }
    const webPreferences = {
      session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, webviewTag: false, devTools: false, navigateOnDragDrop: false, disableDialogs: true,
    } satisfies WebPreferences
    const browser = new WebContentsView({ webPreferences })
    owner.contentView.addChildView(browser)
    const contents = browser.webContents
    const identityOrigin = new URL(platform.url).origin
    const identityHostname = new URL(platform.url).hostname
    const wechat = input.plugin === 'wechat-channels-ops'
    let popup: WebContentsView | undefined
    const result = Promise.withResolvers<SocialLoginResult>()
    const lifetime = new AbortController()
    const remove = (view: WebContentsView): void => {
      if (!owner.isDestroyed()) owner.contentView.removeChildView(view)
      const page = view.webContents
      if (page && !page.isDestroyed()) page.close({ waitForBeforeUnload: false })
    }
    const finish = (phase: SocialLoginResult): void => {
      if (lifetime.signal.aborted) return
      lifetime.abort()
      clearTimeout(expiration)
      clearInterval(poll)
      clearTimeout(feedbackTimer)
      owner.off('closed', ownerClosed)
      ownerContents.off('did-start-navigation', ownerNavigating)
      ownerContents.off('render-process-gone', ownerClosed)
      chrome.dispose()
      if (popup) remove(popup)
      remove(browser)
      if (!owner.isDestroyed() && owner.isFocused() && !ownerContents.isDestroyed()) ownerContents.focus()
      const settle = (): void => { this.active = undefined; result.resolve(phase) }
      if (routing) {
        void routing.then(async () => {
          if (!routingChanged) return
          await browserSession.setProxy({ mode: 'system' })
          await browserSession.closeAllConnections()
        }).then(settle, settle)
      } else settle()
    }
    let recognition: Promise<void> | undefined
    const lastObserved = new WeakMap<WebContents, string>()
    const recognitionFailures = new WeakMap<WebContents, number>()
    let issue: 'mismatch' | 'duplicate' | undefined
    let navigation = 0
    const blockedNotice = '此授权页无法在软件内打开，请使用平台扫码登录'
    const fallbackEntry = 'loginEntry' in platform ? platform.loginEntry : undefined
    let entry = platform.url
    let loadFailed = false
    let awaitingContent = false
    let attempt = 0
    let feedbackTimer: NodeJS.Timeout | undefined
    let proxyAddress: string | undefined
    let routing: Promise<void> | undefined
    let routingChanged = false
    let routingPending = false
    const ownerClosed = (): void => { finish(issue ?? 'closed') }
    const ownerNavigating = (event: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (event.isMainFrame && !event.isSameDocument) ownerClosed()
    }
    const retry = (): void => {
      if (!routingPending) loadEntry(fallbackEntry && (awaitingContent || loadFailed) ? fallbackEntry : entry)
    }
    const directRetry = (): void => {
      if (!proxyAddress || !fallbackEntry || routing) return
      const proxyRules = `http://${proxyAddress}`
      attempt++
      awaitingContent = false
      routingPending = true
      clearTimeout(feedbackTimer)
      chrome.directRetry(false)
      chrome.show('正在直连视频号登录页…', false)
      routing = (async () => {
        await browserSession.setProxy({
          mode: 'fixed_servers', proxyRules,
          proxyBypassRules: [...platform.origins, wechatAssets].map(origin => origin + ':443').join(','),
        })
        routingChanged = true
        await browserSession.closeAllConnections()
      })().catch(() => {
        // The same session can still retry through its current route.
      }).then(() => {
        routingPending = false
        if (!lifetime.signal.aborted) loadEntry(fallbackEntry)
      })
    }
    const returnToLogin = (notice?: string): void => {
      const child = popup
      if (!child || lifetime.signal.aborted) return
      popup = undefined
      navigation++
      clearTimeout(feedbackTimer)
      chrome.select(browser, URL.parse(contents.getURL())?.hostname || identityHostname, false)
      chrome.clear()
      chrome.notice(notice)
      remove(child)
    }
    const chrome = mountSocialLoginChrome(owner, { label: platform.label, hostname: identityHostname }, browser, {
      leave: () => { void inspect().then(ownerClosed, ownerClosed) }, retry, directRetry,
      back: () => returnToLogin(), failed: () => finish('unavailable'),
    })
    if (wechat) {
      void Promise.all([browserSession.resolveProxy(platform.url), browserSession.resolveProxy(wechatAssets)])
        .then(([pageProxy, assetsProxy]) => {
          if (pageProxy !== assetsProxy || lifetime.signal.aborted) return
          proxyAddress = localHttpProxy.exec(pageProxy)?.[1]
          if (proxyAddress) chrome.directRetry(true)
        }).catch(() => {})
    }
    const offerRetry = (message: string): void => {
      const canDirectRetry = Boolean(proxyAddress && !routing)
      chrome.show(canDirectRetry ? message + '本机正在使用代理，也可以选择直连微信重试。' : message, true)
    }
    const reportLoadFailure = (): void => {
      if (routingPending) return
      if (wechat && fallbackEntry && entry === platform.url) { loadEntry(fallbackEntry); return }
      loadFailed = true
      awaitingContent = false
      clearTimeout(feedbackTimer)
      offerRetry('暂时无法加载平台登录页，请检查网络后重试。')
    }
    const preparePage = (page: WebContents, rejected: () => void): void => {
      page.on('did-start-navigation', event => { if (event.isMainFrame) navigation++ })
      page.on('will-frame-navigate', event => {
        if (event.isMainFrame && !approved(event.url)) { event.preventDefault(); rejected() }
      })
      page.on('will-redirect', event => {
        if (event.isMainFrame && !approved(event.url)) { event.preventDefault(); rejected() }
      })
      page.on('did-navigate', (_event, address) => {
        if (page === (popup ?? browser).webContents && approved(address)) chrome.hostname(new URL(address).hostname)
      })
      page.on('will-attach-webview', event => event.preventDefault())
      page.on('login', (event, _details, _auth, done) => { event.preventDefault(); done() })
    }
    preparePage(contents, () => chrome.notice(blockedNotice))
    const loadEntry = (url: string): void => {
      const current = ++attempt
      entry = url
      loadFailed = false
      awaitingContent = true
      clearTimeout(feedbackTimer)
      chrome.notice()
      chrome.show('正在加载' + platform.label + '页面…', false)
      feedbackTimer = setTimeout(() => {
        const address = URL.parse(contents.getURL())
        // WeChat can keep loading subresources while its management page stays blank.
        const stillOnHome = wechat
          ? !address || address.protocol === 'about:' || (address.origin === identityOrigin && platform.page.test(address.pathname))
          : contents.getURL() === url && !contents.isLoadingMainFrame()
        if (fallbackEntry && url === platform.url && stillOnHome) {
          loadEntry(fallbackEntry)
          return
        }
        offerRetry('平台登录页加载较慢。可以继续等待，或点击重试。')
      }, 12_000)
      void contents.loadURL(url).catch((error: unknown) => {
        if (current === attempt && !lifetime.signal.aborted && !popup
          && !(error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED'))
          reportLoadFailure()
      })
    }
    contents.on('did-navigate', (_event, url) => { if (approved(url)) loadFailed = false })
    contents.on('dom-ready', () => {
      if (popup || !awaitingContent || loadFailed || !approved(contents.getURL())) return
      const revision = navigation
      const current = attempt
      void contents.mainFrame.executeJavaScript(WAIT_FOR_PLATFORM_CONTENT).then((ready: unknown) => {
        if (ready !== true || lifetime.signal.aborted || popup || loadFailed || navigation !== revision || attempt !== current) return
        awaitingContent = false
        clearTimeout(feedbackTimer)
        chrome.clear()
      }).catch(() => {})
    })
    contents.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
      if (wechat && url === platform.url && entry !== platform.url) return
      if (!popup && mainFrame && code !== -3) reportLoadFailure()
    })
    contents.on('before-input-event', (event, input) => {
      if (!isSocialLoginReload(input)) return
      event.preventDefault()
      retry()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (lifetime.signal.aborted || !approved(contents.getURL())) return { action: 'deny' }
      if (url !== 'about:blank' && !approved(url)) {
        chrome.notice(blockedNotice)
        return { action: 'deny' }
      }
      if (popup) { chrome.focus(); return { action: 'deny' } }
      // Adopt Chromium's child contents to keep the opener, referrer and form POST.
      return {
        action: 'allow', overrideBrowserWindowOptions: { webPreferences },
        createWindow: (options) => {
          const child = new WebContentsView({ ...options, webPreferences })
          const page = child.webContents
          popup = child
          awaitingContent = false
          clearTimeout(feedbackTimer)
          owner.contentView.addChildView(child)
          chrome.notice()
          chrome.show('正在加载授权页…', false)
          chrome.select(child, URL.parse(url)?.hostname || identityHostname, true)
          feedbackTimer = setTimeout(() => {
            chrome.show('授权页加载较慢。可以继续等待，或返回登录页重试。', false)
          }, 12_000)
          const failed = (): void => {
            if (popup === child) returnToLogin('无法打开授权页，请重新点击登录或使用扫码登录')
          }
          preparePage(page, failed)
          page.setWindowOpenHandler(() => ({ action: 'deny' }))
          page.on('dom-ready', () => {
            if (popup !== child || !approved(page.getURL())) return
            clearTimeout(feedbackTimer)
            chrome.clear()
          })
          page.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
            if (mainFrame && code !== -3) failed()
          })
          page.on('before-input-event', (event, input) => {
            if (!isSocialLoginReload(input)) return
            event.preventDefault()
            if (popup === child) returnToLogin()
          })
          page.once('render-process-gone', failed)
          page.once('destroyed', () => { if (popup === child) returnToLogin() })
          return page
        },
      }
    })
    const addressFor = (page: WebContents | undefined): URL | undefined => {
      if (page === undefined || page.isDestroyed() || page.isLoadingMainFrame()) return
      const address = URL.parse(page.getURL())
      if (address?.origin === identityOrigin && platform.page.test(address.pathname)) return address
    }
    const inspectPages = async (): Promise<void> => {
      if (lifetime.signal.aborted) return
      for (const page of [contents, popup?.webContents]) {
        if (lifetime.signal.aborted || page === undefined) return
        const address = addressFor(page)
        if (!address) continue
        const revision = navigation
        try {
          if (!page.debugger.isAttached()) page.debugger.attach()
          const { nodes } = await page.debugger.sendCommand('Accessibility.getFullAXTree') as { nodes: AXNode[] }
          if (lifetime.signal.aborted || navigation !== revision) return
          const tree = socialLoginTree(nodes, input.plugin)
          const url = address.origin + address.pathname
          if (!tree || lastObserved.get(page) === url + tree) continue
          const observed = await observe({ ...input, url, tree }, lifetime.signal)
          if (lifetime.signal.aborted) return
          if (recognitionFailures.delete(page) && issue === undefined) chrome.notice()
          lastObserved.set(page, url + tree)
          if (observed === 'connected') { finish(observed); return }
          if (observed === 'mismatch' || observed === 'duplicate') {
            issue = observed
            chrome.notice(observed === 'duplicate' ? '账号已添加，请切换账号' : '账号不匹配，请切换账号')
          }
        } catch {
          if (lifetime.signal.aborted || navigation !== revision || page.isDestroyed() || page.isLoadingMainFrame()) continue
          const failures = (recognitionFailures.get(page) ?? 0) + 1
          if (failures === 3) { finish('unavailable'); return }
          recognitionFailures.set(page, failures)
          if (issue === undefined) chrome.notice('正在重试账号核验')
        }
      }
    }
    const inspect = (): Promise<void> => recognition ??= inspectPages().finally(() => { recognition = undefined })
    const expiration = setTimeout(() => finish(issue ?? 'expired'), 5 * 60_000)
    const poll = setInterval(() => { void inspect() }, 1500)
    owner.once('closed', ownerClosed)
    ownerContents.on('did-start-navigation', ownerNavigating)
    ownerContents.once('render-process-gone', ownerClosed)
    contents.once('render-process-gone', () => finish('unavailable'))
    contents.once('destroyed', () => finish('unavailable'))
    this.active = { focus: chrome.focus, key, result: result.promise }
    loadEntry(wechat && startAtQr && fallbackEntry ? fallbackEntry : platform.url)
    return result.promise
  }
}
