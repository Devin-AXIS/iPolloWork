import { EventEmitter } from 'node:events'
import type { BrowserWindow, HandlerDetails, WebContentsViewConstructorOptions, WindowOpenHandlerResponse } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DesktopSocialLogin, type SocialLoginRequest } from '../src/social-login.ts'

const native = vi.hoisted(() => ({
  window: vi.fn(),
  partition: vi.fn(),
  view: vi.fn<(options: WebContentsViewConstructorOptions) => object>(),
}))
vi.mock('electron', () => ({
  BrowserWindow: function () { return native.window() },
  WebContentsView: function (options: WebContentsViewConstructorOptions) { return native.view(options) },
  session: { fromPartition: native.partition },
}))

function makeContents() {
  let url = 'about:blank'
  let destroyed = false
  const contents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn<(handler: (details: HandlerDetails) => WindowOpenHandlerResponse) => void>(),
    isDestroyed: () => destroyed,
    isLoadingMainFrame: () => false,
    getURL: () => url,
    loadURL: vi.fn(async (next: string) => { url = next }),
    loadFile: vi.fn(async (_path: string) => {}),
    executeJavaScript: vi.fn(async (_code: string) => {}),
    mainFrame: { executeJavaScript: vi.fn().mockResolvedValue(true) },
    debugger: { isAttached: () => true, sendCommand: vi.fn().mockResolvedValue({ nodes: [] }) },
    focus: vi.fn(),
    close: vi.fn(() => {
      if (destroyed) return
      destroyed = true
      contents.emit('destroyed')
    }),
  })
  return contents
}

function makeView() {
  return { webContents: makeContents(), setBounds: vi.fn(), setVisible: vi.fn() }
}

function makeOwner() {
  return Object.assign(new EventEmitter(), {
    webContents: makeContents(), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentBounds: () => ({ width: 980, height: 740 }), isFullScreen: () => false,
    isDestroyed: () => false, isFocused: () => true,
  })
}

function openDetails(url: string, withForm = false): HandlerDetails {
  return {
    url, frameName: '_blank', features: '', disposition: 'foreground-tab',
    referrer: { url: 'https://www.douyin.com/user/self', policy: 'strict-origin-when-cross-origin' },
    ...(withForm ? { postBody: { data: [], contentType: 'application/x-www-form-urlencoded' } } : {}),
  }
}

const source = { browserProfileId: '11111111-1111-4111-8111-111111111111', workspace: 'workspace', sessionId: 'session' }
let owner: ReturnType<typeof makeOwner>
let browser: ReturnType<typeof makeView>
let toolbar: ReturnType<typeof makeView>
let social: DesktopSocialLogin

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  native.partition.mockReturnValue(Object.assign(new EventEmitter(), {
    setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() },
    resolveProxy: vi.fn().mockResolvedValue('DIRECT'), setProxy: vi.fn().mockResolvedValue(undefined),
    closeAllConnections: vi.fn().mockResolvedValue(undefined),
  }))
  owner = makeOwner()
  browser = makeView()
  toolbar = makeView()
  native.view.mockReset()
  native.view.mockReturnValueOnce(browser).mockReturnValueOnce(toolbar)
  social = new DesktopSocialLogin()
})
afterEach(() => { owner.emit('closed'); vi.useRealTimers() })

const start = (plugin: SocialLoginRequest['plugin']) =>
  social.open(owner as unknown as BrowserWindow, { ...source, plugin }, async () => 'waiting')

function action(name: 'retry' | 'direct' | 'back' | 'leave') {
  toolbar.webContents.emit('did-navigate-in-page', {}, 'file:///test/renderer/social-login-loading.html#' + name, true)
}

function openAuthorization(url: string, withForm = false) {
  const handler = browser.webContents.setWindowOpenHandler.mock.calls[0]![0]
  return handler(openDetails(url, withForm))
}

function createAuthorization(url: string) {
  const options = openAuthorization(url, true)
  const child = makeView()
  native.view.mockReturnValueOnce(child)
  expect(options.createWindow?.({})).toBe(child.webContents)
  return child
}

function chromeUpdate() { return toolbar.webContents.executeJavaScript.mock.lastCall?.[0] }

const platforms: ReadonlyArray<[SocialLoginRequest['plugin'], string, string]> = [
  ['douyin-ops', 'https://www.douyin.com/user/self', 'https://login.douyin.com/authorize'],
  ['wechat-channels-ops', 'https://channels.weixin.qq.com/platform/', 'https://open.weixin.qq.com/authorize'],
  ['xiaohongshu-ops', 'https://creator.xiaohongshu.com/new/home', 'https://creator.xiaohongshu.com/login'],
]

it.each(platforms)('opens %s and its authorization inside the owner with one account partition', async (plugin, entry, authorization) => {
  const pending = start(plugin)
  const options = native.view.mock.calls[0]![0]
  expect(options.webPreferences).toMatchObject({
    sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
  })
  expect(openAuthorization('about:blank').action).toBe('allow')
  expect(openAuthorization('https://example.com/authorize').action).toBe('deny')
  const child = createAuthorization(authorization)
  expect(native.view.mock.calls[2]![0].webPreferences?.session).toBe(options.webPreferences?.session)
  expect(owner.contentView.addChildView).toHaveBeenCalledWith(child)
  expect(native.window).not.toHaveBeenCalled()
  expect(browser.webContents.loadURL.mock.calls).toEqual([[entry]])
  action('leave')
  expect(await pending).toBe('closed')
  expect(owner.contentView.removeChildView).toHaveBeenCalledWith(child)
})

it('reuses the active authorization and restores the login page after a blocked redirect', async () => {
  const pending = start('douyin-ops')
  const child = createAuthorization('https://login.douyin.com/authorize')
  await child.webContents.loadURL('https://login.douyin.com/authorize')
  child.webContents.emit('dom-ready')
  await Promise.resolve()
  const nested = child.webContents.setWindowOpenHandler.mock.calls[0]![0]
  expect(nested(openDetails('https://login.douyin.com/authorize')).action).toBe('deny')
  expect(start('douyin-ops')).toBe(pending)
  expect(native.view).toHaveBeenCalledTimes(3)
  const preventDefault = vi.fn()
  child.webContents.emit('will-redirect', { isMainFrame: true, url: 'https://example.com/', preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(child.webContents.isDestroyed()).toBe(true)
  expect(browser.setVisible).toHaveBeenLastCalledWith(true)
  expect(chromeUpdate()).toContain('重新点击登录')
  action('leave')
  expect(await pending).toBe('closed')
})

it('restores the same login page when the user returns from platform authorization', async () => {
  const pending = start('douyin-ops')
  const child = createAuthorization('https://login.douyin.com/authorize')
  action('back')
  expect(child.webContents.isDestroyed()).toBe(true)
  expect(browser.setVisible).toHaveBeenLastCalledWith(true)
  expect(browser.webContents.loadURL).toHaveBeenCalledOnce()
  action('leave')
  expect(await pending).toBe('closed')
})

it('checks completed authorization even while the opener has no identity', async () => {
  const observe = vi.fn().mockResolvedValue('connected')
  const pending = social.open(owner as unknown as BrowserWindow, { ...source, plugin: 'douyin-ops' }, observe)
  const child = createAuthorization('https://login.douyin.com/authorize')
  await child.webContents.loadURL('https://www.douyin.com/user/test?discarded=1')
  child.webContents.debugger.sendCommand.mockResolvedValue({ nodes: [
    { role: { value: 'StaticText' }, name: { value: '抖音号：fixture' } },
  ] })
  await vi.advanceTimersByTimeAsync(1500)
  expect(observe).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://www.douyin.com/user/test' }), expect.any(AbortSignal))
  expect(await pending).toBe('connected')
  expect(child.webContents.isDestroyed()).toBe(true)
  expect(browser.webContents.isDestroyed()).toBe(true)
  expect(owner.webContents.focus).toHaveBeenCalled()
})

it('reports a document failure and retries in the same login view', async () => {
  const pending = start('douyin-ops')
  browser.webContents.emit('did-fail-load', {}, -105, '', 'https://www.douyin.com/user/self', true)
  await Promise.resolve()
  expect(chromeUpdate()).toContain('暂时无法加载')
  expect(chromeUpdate()).toContain('"retry":true')
  const preventDefault = vi.fn()
  browser.webContents.emit('before-input-event', { preventDefault }, { type: 'keyDown', key: 'r', control: true, meta: true })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(browser.webContents.loadURL).toHaveBeenCalledTimes(2)
  expect(native.view).toHaveBeenCalledTimes(2)
  action('leave')
  expect(await pending).toBe('closed')
})

it('preserves the authorized page when the first account confirmation fails', async () => {
  const observe = vi.fn().mockRejectedValueOnce(new Error('Host timed out')).mockResolvedValueOnce('connected')
  const pending = social.open(owner as unknown as BrowserWindow, { ...source, plugin: 'douyin-ops' }, observe)
  await browser.webContents.loadURL('https://www.douyin.com/user/test/')
  browser.webContents.debugger.sendCommand.mockResolvedValue({ nodes: [
    { role: { value: 'StaticText' }, name: { value: '抖音号：fixture' } },
  ] })
  await vi.advanceTimersByTimeAsync(1500)
  expect(browser.webContents.isDestroyed()).toBe(false)
  expect(chromeUpdate()).toContain('重试账号核验')
  await vi.advanceTimersByTimeAsync(1500)
  expect(observe).toHaveBeenCalledTimes(2)
  expect(browser.webContents.loadURL).toHaveBeenCalledTimes(2)
  expect(await pending).toBe('connected')
})

it('shows retry after twelve seconds and keeps the toolbar when platform content arrives', async () => {
  const paint = Promise.withResolvers<boolean>()
  browser.webContents.mainFrame.executeJavaScript.mockReturnValue(paint.promise)
  const pending = start('douyin-ops')
  browser.webContents.emit('dom-ready')
  await Promise.resolve()
  expect(chromeUpdate()).toContain('正在加载抖音账号登录页面')
  await vi.advanceTimersByTimeAsync(12_000)
  expect(chromeUpdate()).toContain('加载较慢')
  action('retry')
  expect(browser.webContents.loadURL).toHaveBeenCalledTimes(2)
  paint.resolve(true)
  await Promise.resolve()
  expect(chromeUpdate()).toContain('正在加载抖音账号登录页面')
  browser.webContents.mainFrame.executeJavaScript.mockResolvedValue(true)
  browser.webContents.emit('dom-ready')
  await Promise.resolve()
  expect(toolbar.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ height: 52 }))
  expect(owner.contentView.removeChildView).not.toHaveBeenCalled()
  action('leave')
  expect(await pending).toBe('closed')
})

it('tries the official Xiaohongshu login route if the creator home stays blank', async () => {
  browser.webContents.mainFrame.executeJavaScript.mockReturnValue(new Promise(() => {}))
  const pending = start('xiaohongshu-ops')
  browser.webContents.emit('dom-ready')
  await vi.advanceTimersByTimeAsync(12_000)
  expect(browser.webContents.loadURL.mock.calls).toEqual([
    ['https://creator.xiaohongshu.com/new/home'], ['https://creator.xiaohongshu.com/login'],
  ])
  expect(native.view).toHaveBeenCalledTimes(2)
  action('leave')
  expect(await pending).toBe('closed')
})

it('recovers a pending WeChat account from its existing session before returning to the workbench', async () => {
  const observe = vi.fn().mockResolvedValue('connected')
  const pending = social.open(owner as unknown as BrowserWindow, { ...source, plugin: 'wechat-channels-ops' }, observe)
  expect(browser.webContents.loadURL).toHaveBeenCalledExactlyOnceWith('https://channels.weixin.qq.com/platform/')
  await browser.webContents.loadURL('https://channels.weixin.qq.com/platform/home/?ignored=1')
  browser.webContents.debugger.sendCommand.mockResolvedValue({ nodes: [
    { role: { value: 'button' }, name: { value: '视频号 ID' } },
    ...['视频号 ID', '：', 'sph_test', '帐号名称：', '样例视频号', '不相关内容'].map(value => ({
      role: { value: 'StaticText' }, name: { value },
    })),
  ] })
  action('leave')
  expect(await pending).toBe('connected')
  expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    url: 'https://channels.weixin.qq.com/platform/home/',
    tree: 'StaticText "视频号 ID"\nStaticText "："\nStaticText "sph_test"\nStaticText "帐号名称："\nStaticText "样例视频号"',
  }), expect.any(AbortSignal))
})

it('starts at the official QR page when the user adds a WeChat account', async () => {
  const pending = social.open(owner as unknown as BrowserWindow, {
    ...source, plugin: 'wechat-channels-ops', startAtQr: true,
  }, async () => 'waiting')
  expect(browser.webContents.loadURL).toHaveBeenCalledExactlyOnceWith('https://channels.weixin.qq.com/login.html')
  action('leave')
  expect(await pending).toBe('closed')
})

it('opens the WeChat QR login even if the blank management page is still loading', async () => {
  browser.webContents.mainFrame.executeJavaScript.mockReturnValue(new Promise(() => {}))
  vi.spyOn(browser.webContents, 'isLoadingMainFrame').mockReturnValue(true)
  const pending = start('wechat-channels-ops')
  browser.webContents.emit('dom-ready')
  await vi.advanceTimersByTimeAsync(12_000)
  expect(browser.webContents.loadURL.mock.calls).toEqual([
    ['https://channels.weixin.qq.com/platform/'], ['https://channels.weixin.qq.com/login.html'],
  ])
  action('leave')
  expect(await pending).toBe('closed')
})

it('falls back once to the WeChat QR page if opening the management page fails', async () => {
  const pending = start('wechat-channels-ops')
  const failed = (address: string) => browser.webContents.emit('did-fail-load', {}, -100, '', address, true)
  failed('https://channels.weixin.qq.com/platform/')
  failed('https://channels.weixin.qq.com/platform/')
  expect(browser.webContents.loadURL.mock.calls).toEqual([
    ['https://channels.weixin.qq.com/platform/'], ['https://channels.weixin.qq.com/login.html'],
  ])
  failed('https://channels.weixin.qq.com/login.html')
  await Promise.resolve()
  expect(chromeUpdate()).toContain('暂时无法加载')
  expect(chromeUpdate()).toContain('"directRetry":false')
  action('leave')
  expect(await pending).toBe('closed')
})

it('offers an explicit WeChat-only direct retry and restores the proxy when the login ends', async () => {
  const profile = native.partition.getMockImplementation()!()
  profile.resolveProxy.mockResolvedValue('PROXY 127.0.0.1:7890')
  const pending = start('wechat-channels-ops')
  action('direct')
  expect(profile.setProxy).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(24_000)
  expect(chromeUpdate()).toContain('"directRetry":true')
  action('direct')
  await vi.advanceTimersByTimeAsync(0)
  expect(profile.setProxy).toHaveBeenCalledExactlyOnceWith({
    mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890',
    proxyBypassRules: 'https://channels.weixin.qq.com:443,https://open.weixin.qq.com:443,https://res.wx.qq.com:443',
  })
  expect(profile.closeAllConnections).toHaveBeenCalledOnce()
  expect(browser.webContents.loadURL).toHaveBeenCalledTimes(3)
  expect(browser.webContents.loadURL).toHaveBeenLastCalledWith('https://channels.weixin.qq.com/login.html')
  expect(native.view).toHaveBeenCalledTimes(2)
  action('leave')
  expect(await pending).toBe('closed')
  expect(profile.setProxy).toHaveBeenLastCalledWith({ mode: 'system' })
  expect(profile.closeAllConnections).toHaveBeenCalledTimes(2)
})

it('releases the embedded views when the application reloads', async () => {
  const pending = start('douyin-ops')
  owner.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  expect(browser.webContents.isDestroyed()).toBe(false)
  owner.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  expect(await pending).toBe('closed')
  expect(toolbar.webContents.isDestroyed()).toBe(true)
  expect(browser.webContents.isDestroyed()).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
