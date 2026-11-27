import { WebContentsView, type BrowserWindow, type Input, type Rectangle } from 'electron'
import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'

const toolbarHeight = 52
const asset = 'renderer/social-login-loading.html'

interface ChromeState {
  label: string
  hostname: string
  authorization: boolean
  notice: string | undefined
  message: string | undefined
  retry: boolean
  directRetry: boolean
}

export function isSocialLoginReload(input: Input): boolean {
  const modifier = process.platform === 'darwin' ? input.meta : input.control
  return input.type === 'keyDown' && modifier && !input.alt && !input.shift
    && !input.isAutoRepeat && input.key.toLowerCase() === 'r'
}

/** Keep trusted navigation and feedback above the isolated platform view. */
export function mountSocialLoginChrome(
  owner: BrowserWindow, platform: { label: string; hostname: string }, initialPage: WebContentsView,
  actions: { leave(): void; retry(): void; directRetry(): void; back(): void; failed(): void },
) {
  const chrome = new WebContentsView({ webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, webSecurity: true,
  } })
  const contents = chrome.webContents
  const state: ChromeState = { ...platform, authorization: false, notice: undefined, message: undefined, retry: false, directRetry: false }
  let page = initialPage
  let ready = false
  let disposed = false
  const resize = (): void => {
    if (disposed || owner.isDestroyed()) return
    const { width, height } = owner.getContentBounds()
    const titlebar = process.platform === 'win32' ? WINDOWS_TITLEBAR_HEIGHT : process.platform === 'darwin' ? 42 : 0
    const top = owner.isFullScreen() ? 0 : titlebar
    const body: Rectangle = { x: 0, y: top + toolbarHeight, width, height: Math.max(0, height - top - toolbarHeight) }
    page.setBounds(body)
    chrome.setBounds({ x: 0, y: top, width, height: state.message ? Math.max(toolbarHeight, height - top) : toolbarHeight })
  }
  const focus = (): void => {
    if (disposed || owner.isDestroyed() || !owner.isFocused()) return
    const target = state.message ? contents : page.webContents
    if (target && !target.isDestroyed()) target.focus()
  }
  const render = (): void => {
    resize()
    if (ready && !contents.isDestroyed()) {
      void contents.executeJavaScript(`globalThis.renderSocialLogin(${JSON.stringify(state)})`).catch(() => {})
    }
  }
  const retry = (): void => {
    if (state.authorization) actions.back()
    else actions.retry()
  }
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('did-navigate-in-page', (_event, url, mainFrame) => {
    const target = URL.parse(url)
    if (!mainFrame || target?.protocol !== 'file:' || !target.pathname.endsWith('/' + asset)) return
    if (target.hash === '#leave') actions.leave()
    if (target.hash === '#back' && state.authorization) actions.back()
    if (target.hash === '#retry' && !state.authorization && (!state.message || state.retry)) actions.retry()
    if (target.hash === '#direct' && !state.authorization && state.directRetry && (!state.message || state.retry)) actions.directRetry()
  })
  contents.on('before-input-event', (event, input) => {
    if (!isSocialLoginReload(input)) return
    event.preventDefault()
    retry()
  })
  contents.on('render-process-gone', actions.failed)
  contents.once('destroyed', () => { if (!disposed) actions.failed() })
  owner.contentView.addChildView(chrome)
  owner.on('resize', resize)
  owner.on('enter-full-screen', resize)
  owner.on('leave-full-screen', resize)
  void contents.loadFile(asset).then(() => {
    if (disposed) return
    ready = true
    render()
    focus()
  }, () => { if (!disposed) actions.failed() })

  return {
    focus,
    show(message: string, canRetry: boolean): void {
      state.message = message
      state.retry = canRetry
      render()
      focus()
    },
    clear(): void {
      const hadFeedback = state.message !== undefined
      state.message = undefined
      state.retry = false
      render()
      if (hadFeedback) focus()
    },
    directRetry(enabled: boolean): void { state.directRetry = enabled; render() },
    notice(message?: string): void { state.notice = message; render() },
    hostname(hostname: string): void { state.hostname = hostname; render() },
    select(view: WebContentsView, hostname: string, authorization: boolean): void {
      if (page.webContents && !page.webContents.isDestroyed()) page.setVisible(false)
      page = view
      page.setVisible(true)
      state.hostname = hostname
      state.authorization = authorization
      owner.contentView.addChildView(chrome)
      render()
      focus()
    },
    dispose(): void {
      disposed = true
      owner.off('resize', resize)
      owner.off('enter-full-screen', resize)
      owner.off('leave-full-screen', resize)
      if (!owner.isDestroyed()) owner.contentView.removeChildView(chrome)
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    },
  }
}
