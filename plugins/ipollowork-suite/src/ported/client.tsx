import React, { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { pluginGlyph } from './icons.ts'
import { socialLoginPlugins, type BundleState } from './contracts.ts'

interface NativeClient {
  effect(effect: () => void | (() => void), label?: string): unknown;
  slots: { inject(name: string, install: () => () => void): unknown; register<P>(options: { name: string; id?: string; key?: string; order?: number; label?: () => string; inject?: () => Record<string, unknown> }, component: ComponentType<P>): () => void };
  layout: { selectPanel(id: string): void };
  locale: { getSnapshot(): { active: string }; subscribe(callback: () => void): () => void };
  theme: { getTheme(): { active: { colorScheme: string } } };
  on(name: string, callback: () => void): () => void;
  uiWorkspace: { startSession(workspace: string, input: { prompt: string; whenDraftExists: 'append' }): void; connectWorkspace(workspace: string): Promise<string> };
}
interface DisplayManifest { id: string; name: string; description: string; localization?: { translations?: Record<string, { name?: string; description?: string }> } }
const workbenchLinkOrigins: Readonly<Record<string, readonly string[]>> = {
  'douyin-ops': ['https://www.douyin.com', 'https://creator.douyin.com', 'https://open.douyin.com'],
  'wechat-channels-ops': ['https://channels.weixin.qq.com'],
  'xiaohongshu-ops': ['https://www.xiaohongshu.com', 'https://creator.xiaohongshu.com'],
}
type DesktopSocialLoginArgs = { plugin: string; workspace: string; sessionId: string; browserProfileId: string }
type DesktopSocialLogin = (args: DesktopSocialLoginArgs & { startAtQr?: true }) => Promise<string>
function desktopSocialLogin(plugin: string) {
  const desktop = (window as Window & { dshDesktop?: { socialLogin?: DesktopSocialLogin; socialLoginQrEntry?: true } }).dshDesktop
  const open = desktop?.socialLogin
  if (!socialLoginPlugins.has(plugin) || typeof open !== 'function') return undefined
  return (args: DesktopSocialLoginArgs, startAtQr = false) => open(
    desktop?.socialLoginQrEntry && startAtQr ? { ...args, startAtQr: true } : args,
  )
}
const styles = `
.ipw-ported{height:100%;min-width:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:var(--dsw-font-body,13px/1.5 system-ui)}
.ipw-ported header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:16px;padding-top:max(16px,var(--dsh-frame-top-clearance,0px));border-bottom:1px solid var(--dsw-alias-border-l1)}
.ipw-ported h1{font-size:16px;font-weight:500;margin:0;margin-inline-end:auto}.ipw-ported label{display:flex;align-items:center;gap:8px;min-width:0}
.ipw-ported-workspace-empty{margin-inline-start:auto;color:var(--dsw-alias-label-secondary)}
.ipw-ported select{max-width:220px;min-width:0;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px;font:inherit}
.ipw-ported iframe{border:0;width:100%;flex:1;min-height:0;background:var(--dsw-alias-bg-base)}.ipw-ported-content{overflow:auto;padding:24px;max-width:720px;width:100%;box-sizing:border-box;align-self:center}
.ipw-ported-content h2{font-size:14px;font-weight:500;margin:24px 0 12px}.ipw-ported-content p{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.ipw-ported form{display:grid;gap:12px;margin-block:16px}
.ipw-ported form>button{justify-self:start}
.ipw-ported form label{display:grid;gap:6px}.ipw-ported [role=alert]{color:var(--dsw-alias-label-danger,var(--dsw-alias-label-primary));margin:12px 16px;overflow-wrap:anywhere}.ipw-ported ul{padding-left:20px;line-height:1.9}
@media(max-width:520px){.ipw-ported header{gap:8px;padding:12px;padding-top:max(12px,var(--dsh-frame-top-clearance,0px))}.ipw-ported header:has(select) h1{width:100%}.ipw-ported select{max-width:170px}.ipw-ported-content{padding:16px}}
`
async function request<T>(base: string, path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(base + path, { signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  if (response.status === 422) {
    const data: unknown = await response.json().catch(() => undefined)
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
      && 'error' in data && (data.error === 'IPW_PORTED_MEDIA_FAILED' || data.error === 'IPW_PORTED_RUNTIME_MISSING')) {
      throw new Error(data.message)
    }
  }
  if (!response.ok) throw new Error(response.status === 401 ? '请重新连接 iPolloWork / Reconnect to iPolloWork' : response.status === 403 ? '当前连接没有操作权限 / Permission denied' : '操作未完成，请检查插件配置后重试 / Check plugin settings and retry')
  return response.json()
}
function Panel({ ctx, manifest }: { ctx: NativeClient; manifest: DisplayManifest }) {
  const language = useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot().active)
  const zh = language.startsWith('zh'), t = (cn: string, en: string) => zh ? cn : en
  const title = zh ? manifest.name : manifest.localization?.translations?.en?.name ?? manifest.name
  const base = '/ipollo-ported/' + manifest.id
  const [state, setState] = useState<BundleState>(), [workspace, setWorkspace] = useState(''), [view, setView] = useState('')
  const [src, setSrc] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [method, setMethod] = useState(''), [account, setAccount] = useState('default'), [values, setValues] = useState<Record<string, string>>({})
  const frame = useRef<HTMLIFrameElement>(null), generation = useRef(0), lifetime = useRef<AbortController | null>(null)
  const [theme, setTheme] = useState(() => ctx.theme.getTheme().active.colorScheme)
  const context = useRef('')
  const activeDocument = useRef<Document | null>(null)
  useEffect(() => () => { const runtime: unknown = Reflect.get(window, '__ipolloPortedUi'); if (activeDocument.current && runtime && typeof runtime === 'object' && 'disposeDocument' in runtime && typeof runtime.disposeDocument === 'function') runtime.disposeDocument(activeDocument.current); activeDocument.current = null }, [src])
  const session = useRef<{ workspace: string; id: string } | null>(null)
  const sessionFor = async () => {
    if (session.current?.workspace !== workspace) session.current = { workspace, id: await ctx.uiWorkspace.connectWorkspace(workspace) }
    return session.current.id
  }
  const signal = () => { if (!lifetime.current) throw new Error('Panel closed'); return lifetime.current.signal }
  const load = async () => {
    const next = await request<BundleState>(base, '/state', signal())
    setState(next); setWorkspace(current => current || next.workspaces[0]?.id || ''); setView(current => current || next.views[0]?.id || ''); setMethod(current => current || next.methods[0]?.id || '')
  }
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    void load().catch(cause => { if (!abort.signal.aborted) setError(String(cause.message)) })
    return () => { abort.abort(); generation.current++; lifetime.current = null }
  }, [manifest.id])
  useEffect(() => ctx.on('theme/change', () => setTheme(ctx.theme.getTheme().active.colorScheme)), [ctx])
  const syncTheme = () => {
    activeDocument.current = frame.current?.contentDocument ?? null
    try {
      const doc = frame.current?.contentDocument
      if (doc) {
        doc.documentElement.dataset.theme = theme
        doc.documentElement.style.colorScheme = theme
        const tokens = getComputedStyle(document.body)
        for (let index = 0; index < tokens.length; index++) {
          const key = tokens[index]!
          if (key.startsWith('--dsw-') || key.startsWith('--dsh-')) {
            const value = tokens.getPropertyValue(key)
            doc.documentElement.style.setProperty(key, value)
            doc.body?.style.setProperty(key, value)
          }
        }
        if (!doc.head.querySelector('[data-ipw-native-ui]')) {
          for (const node of document.head.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-client-ui-primitives"]')) {
            const copy = node.cloneNode(true)
            if (copy instanceof Element) { copy.setAttribute('data-ipw-native-ui', ''); doc.head.append(copy) }
          }
        }
      }
    } catch { /* Only same-origin shipped workbenches are modified. */ }
    frame.current?.contentWindow?.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme, locale: language } }, window.location.origin)
  }
  useEffect(syncTheme, [theme, language, src])
  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
      const message: unknown = event.data
      if (!message || typeof message !== 'object' || !('jsonrpc' in message) || message.jsonrpc !== '2.0' || !('method' in message) || typeof message.method !== 'string') return
      const value = message as { method: string; id?: string | number; params?: Record<string, unknown> }
      if (value.id === undefined) return
      const target = frame.current?.contentWindow, version = generation.current
      const respond = (result: unknown, error = false) => { if (version === generation.current) target?.postMessage({ jsonrpc: '2.0', id: value.id, ...(error ? { error: { code: -32602, message: String(result) } } : { result }) }, window.location.origin) }
      try {
        if (value.method === 'ui/initialize') { const sessionId = await sessionFor(); respond({ protocolVersion: '2025-11-21', hostInfo: { name: 'iPolloWork', version: '1' }, hostCapabilities: { message: true, tools: {}, experimental: { 'ai.ipollo/desktop-account-login': Boolean(desktopSocialLogin(manifest.id)) } }, hostContext: { theme, locale: language, workspaceId: workspace, 'ai.ipollo/workspace': { workspaceId: workspace, sessionId } } }); return }
        if (value.method === 'ui/update-model-context') { context.current = JSON.stringify(value.params ?? {}).slice(0, 32_000); respond({}); return }
        if (value.method === 'ui/message') {
          const parts = value.params?.content
          const text = Array.isArray(parts) ? parts.flatMap(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n') : ''
          if (!workspace || !text || text.length > 65_536) throw new Error(t('消息内容无效', 'Invalid message'))
          ctx.uiWorkspace.startSession(workspace, { prompt: text + (context.current ? '\n\n' + context.current : ''), whenDraftExists: 'append' }); respond({ isError: false }); return
        }
        if (value.method === 'ui/open-link') {
          const href = value.params?.url
          const url = typeof href === 'string' ? URL.parse(href) : null
          if (!url || url.username || url.password || !workbenchLinkOrigins[manifest.id]?.includes(url.origin))
            throw new Error(t('该地址不属于此插件支持的平台', 'This link is outside the supported platform'))
          // The Desktop shell sends external windows to the system browser.
          window.open(url.href, '_blank', 'noopener,noreferrer')
          respond({ isError: false, browser: 'external', automaticRecognition: false })
          return
        }
        if (value.method === 'ui/account-login') {
          const openLogin = desktopSocialLogin(manifest.id)
          const browserProfileId = value.params?.browserProfileId
          if (!openLogin || !workspace || typeof browserProfileId !== 'string' || !/^[a-f\d-]{36}$/i.test(browserProfileId)) {
            respond({ status: 'unavailable' }); return
          }
          const sessionId = await sessionFor()
          if (version !== generation.current) return
          const startAtQr = manifest.id === 'wechat-channels-ops' && value.params?.startAtQr === true
          respond({ status: await openLogin({ plugin: manifest.id, workspace, sessionId, browserProfileId }, startAtQr) })
          return
        }
        if (value.method === 'tools/call') {
          const name = value.params?.name
          const action = state?.actions.find(item => item.id === name)
          if (!action) throw new Error(t('插件未提供此操作', 'Unknown plugin action'))
          const result = await request(base, '/call', signal(), { workspace, sessionId: await sessionFor(), resource: action.resource, action: action.id, input: value.params?.arguments ?? {} })
          respond({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }); return
        }
        if (['ui/resource-teardown', 'ui/request-display-mode', 'ui/notifications/size-changed'].includes(value.method)) { respond({ mode: 'inline' }); return }
        throw new Error(t('暂不支持此操作', 'Unsupported action'))
      } catch (cause) { respond(cause instanceof Error ? cause.message : t('操作失败', 'Action failed'), true) }
    }
    const listener = (event: MessageEvent) => { void receive(event) }
    window.addEventListener('message', listener); return () => window.removeEventListener('message', listener)
  }, [state, workspace, theme, language])
  const open = async () => {
    const version = ++generation.current; setBusy(true); setError('')
    try {
      const action = state?.actions.find(item => /^(open-workbench|open-studio)$/.test(item.id))
      if (action) {
        const value = await request<{ url: string }>(base, '/call', signal(), { workspace, resource: action.resource, action: action.id, input: {} })
        if (generation.current === version) setSrc(value.url)
      } else if (view) setSrc(`${base}/view?workspace=${encodeURIComponent(workspace)}&id=${encodeURIComponent(view)}`)
      else ctx.uiWorkspace.startSession(workspace, { prompt: `${t('使用', 'Use')} ${title} ${t('帮助我完成当前任务', 'to help with my current task')}`, whenDraftExists: 'append' })
    } catch (cause) { if (generation.current === version) setError(cause instanceof Error ? cause.message : t('无法打开工作台', 'Could not open workbench')) }
    finally { if (generation.current === version) setBusy(false) }
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    try { await request(base, '/credential', signal(), { method, account, values }); setValues({}); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('保存失败', 'Save failed')) }
    finally { if (!lifetime.current?.signal.aborted) setBusy(false) }
  }
  return <section className="ipw-ported">
    <header>
      <h1>{title}</h1>
      {state?.workspaces.length === 0 && <span className="ipw-ported-workspace-empty" role="status">{t('暂无工作区', 'No workspaces')}</span>}
      {state && state.workspaces.length > 0 && <>
        <label>{t('工作区', 'Workspace')}<select aria-label={t('工作区', 'Workspace')} value={workspace} disabled={busy} onChange={event => { generation.current++; setWorkspace(event.target.value); setSrc(''); setBusy(false) }}>
          {state.workspaces.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        {state.views.length > 1 && <select aria-label={t('工作台', 'Workbench')} value={view} disabled={busy} onChange={event => { setView(event.target.value); setSrc('') }}>{state.views.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
        <Button variant="primary" size="sm" disabled={busy || !workspace} onClick={() => void open()}>{busy ? t('正在打开…', 'Opening…') : t('打开', 'Open')}</Button>
      </>}
    </header>
    {error && <p role="alert">{error} <Button variant="ghost" onClick={() => { setError(''); void load().catch(cause => setError(String(cause.message))) }}>{t('重试', 'Retry')}</Button></p>}
    {src ? <iframe ref={frame} key={src} src={src} title={title} onLoad={syncTheme} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"/> : <div className="ipw-ported-content">
      <p>{zh ? manifest.description : manifest.localization?.translations?.en?.description ?? manifest.description}</p>
      {!state ? <p aria-busy="true">{t('正在读取插件…', 'Loading plugin…')}</p> : <>
        {!state.workspaces.length && <p>{t('请先创建或打开一个工作区', 'Create or open a workspace first')}</p>}
        {Boolean(state.methods.length) && <><h2>{t('连接账号', 'Connect account')}</h2><form onSubmit={event => void save(event)}>
          {state.methods.length > 1 && <label>{t('连接方式', 'Connection')}<select value={method} disabled={busy} onChange={event => { setMethod(event.target.value); setValues({}) }}>{state.methods.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
          <label>{t('账号名称', 'Account name')}<Input value={account} onChange={event => setAccount(event.target.value)} required disabled={busy}/></label>
          {state.methods.find(item => item.id === method)?.fields.map(field => <label key={field.id}>{field.label}<Input type={field.secret ? 'password' : 'text'} value={values[field.id] ?? ''} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} required={field.required} autoComplete="off" disabled={busy}/></label>)}
          <Button variant="primary" type="submit" disabled={busy}>{t('保存连接', 'Save connection')}</Button>
        </form>{Boolean(state.connections.length) && <p>{t('已连接', 'Connected')}: {state.connections.map(item => item.accountId).join(', ')}</p>}</>}
        {Boolean(state.skills.length) && <><h2>{t('可用技能', 'Available Skills')}</h2><ul>{state.skills.map(item => <li key={item.id}>{item.title}</li>)}</ul></>}
        {state.workspaces.length > 0 && !state.views.length && !state.actions.some(item => /^(open-workbench|open-studio)$/.test(item.id)) && <p>{t('点击“打开”在原生会话中使用此插件', 'Select Open to use this plugin in a native conversation')}</p>}
      </>}
    </div>}
  </section>
}
export function mountBundle(ctx: NativeClient, manifest: DisplayManifest, packageName: string): void {
  const panel = 'ipollo-ported-' + manifest.id
  const Icon = pluginGlyph(manifest.id)
  ctx.effect(() => { const element = document.createElement('style'); element.textContent = styles; document.head.append(element); return () => element.remove() }, 'ported plugin: reversible styles')
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, inject: () => ({ ctx, manifest }) }, Panel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 20, label: () => ctx.locale.getSnapshot().active.startsWith('zh') ? manifest.name : manifest.localization?.translations?.en?.name ?? manifest.name }, () => <Icon size={16} strokeWidth={1.6} aria-hidden="true"/>))
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: packageName }, () => <Button onClick={() => ctx.layout.selectPanel(panel)}>{manifest.name}</Button>))
}
