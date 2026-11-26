import { useEffect, useRef, useState } from 'react'
import { Button, IconEllipsisOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { Modal } from '../../../_shared/ui/modal.tsx'
import { request } from './api.ts'
import { language, labelSource, type Labels } from './locale.ts'
import type { ClientContext } from './native.ts'
import type { McpConnection, McpConnectionAction, McpConnectionList } from '../shared/mcp-connections.ts'
import css from './mcp-connections.module.css'

interface Props {
  locale(): string
  useLabels<T>(select: (labels: Labels) => T): T
  accountChanges(listener: () => void): () => void
  editConfiguration(): Promise<void>
  call?: typeof request
}
const disconnected = (item: McpConnection) => ['disconnected', 'disabled', 'closed'].includes(item.state)
export function McpConnections({ locale, useLabels, accountChanges, editConfiguration, call = request }: Props) {
  useLabels(value => value)
  const zh = locale() === 'zh'
  const [items, setItems] = useState<McpConnection[]>([]), [error, setError] = useState(''), [loadError, setLoadError] = useState('')
  const [organizationError, setOrganizationError] = useState(''), [busy, setBusy] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false), [revision, refresh] = useState(0), [menu, setMenu] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<McpConnection | null>(null), [notice, setNotice] = useState('')
  const identity = useRef(0), acting = useRef(false)
  const source = (item: McpConnection) => item.source === 'organization' ? (zh ? '组织下发' : 'Organization')
    : item.source === 'configuration' ? (zh ? '配置文件' : 'Configuration') : item.source === 'cleanup' ? (zh ? '已移除的连接' : 'Removed connection') : (zh ? '插件提供' : 'Plugin')
  const errorText = (cause: unknown) => {
    const code = cause instanceof Error ? cause.message : ''
    if (code === 'IPW_MCP_SETTINGS_CONFLICT') return zh ? '配置已发生变化，列表已刷新，请重新操作。' : 'Configuration changed. The list was refreshed; try the action again.'
    if (code === 'IPW_MCP_SOURCE_MANAGED') return zh ? '此 MCP 由原来源管理，请在组织空间或对应插件中操作。' : 'Manage this MCP through its organization or owning plugin.'
    if (code === 'IPW_MCP_NOT_FOUND' || code === 'IPW_MCP_FORBIDDEN') return zh ? '此 MCP 已移除或当前账号无权操作，请刷新列表。' : 'This MCP was removed or access changed. Refresh the list.'
    if (code === 'IPW_SIGN_IN_REQUIRED') return zh ? '请登录组织账号后重试。' : 'Sign in to your organization account and retry.'
    if (code === 'IPW_ACCOUNT_CHANGED') return zh ? '账号已切换，请使用当前账号重新操作。' : 'The account changed. Retry with the current account.'
    return zh ? '操作失败，请刷新后重试；若仍失败，请检查 MCP 服务和原生配置。' : 'The action failed. Refresh and retry, then check the MCP service and configuration.'
  }
  useEffect(() => accountChanges(() => {
    identity.current++; setItems([]); setLoaded(false); setError(''); setNotice(''); setDeleting(null); setMenu(null); refresh(value => value + 1)
  }), [accountChanges])
  useEffect(() => {
    const lifetime = new AbortController()
    let loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const result = await call<McpConnectionList>('/mcp-connections', { signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]) })
        if (!lifetime.signal.aborted) { setItems(result.items); setLoadError(''); setOrganizationError(result.organizationError ?? '') }
      } catch {
        if (!lifetime.signal.aborted) { setItems([]); setOrganizationError(''); setLoadError(zh ? 'MCP 列表加载失败，请刷新重试，并检查原生 MCP 管理器是否已启用。' : 'Could not load MCP connections. Refresh and check that the native MCP manager is enabled.') }
      } finally { loading = false; if (!lifetime.signal.aborted) setLoaded(true) }
    }
    void load()
    const timer = setInterval(() => { void load() }, 10000)
    return () => { clearInterval(timer); lifetime.abort() }
  }, [revision, zh, call])
  const run = async (item: McpConnection, action: McpConnectionAction | 'edit') => {
    if (acting.current) return
    acting.current = true
    const generation = identity.current
    setBusy(item.id); setError(''); setNotice(''); setMenu(null)
    try {
      if (action === 'edit') await editConfiguration()
      else await call('/mcp-connections/' + encodeURIComponent(item.id) + '/' + action, {
        method: 'POST', body: JSON.stringify(item.revision === undefined ? {} : { revision: item.revision }), signal: AbortSignal.timeout(30000),
      })
      if (generation !== identity.current) return
      setDeleting(null)
      if (action !== 'edit') {
        setNotice(action === 'delete' ? (zh ? 'MCP 配置已删除。' : 'MCP configuration removed.')
          : action === 'disconnect' ? (zh ? '已保存断开设置，配置已保留。' : 'Disconnection saved; configuration is kept.')
            : (zh ? '已请求连接，稍后可查看连接状态。' : 'Connection requested. The status will update shortly.'))
        refresh(value => value + 1)
      }
    } catch (cause) {
      if (generation !== identity.current) return
      setError(errorText(cause))
      if (cause instanceof Error && cause.message === 'IPW_MCP_SETTINGS_CONFLICT') { setDeleting(null); refresh(value => value + 1) }
    } finally { acting.current = false; setBusy(null) }
  }
  const stateLabel = (item: McpConnection) => ({
    connected: zh ? '已连接' : 'Connected', disconnected: zh ? '已断开' : 'Disconnected',
    disabled: zh ? '已断开' : 'Disconnected', closed: zh ? '已断开' : 'Disconnected',
    connecting: zh ? '连接中…' : 'Connecting…', reconnecting: zh ? '正在重连…' : 'Reconnecting…',
    failed: zh ? '连接失败' : 'Connection failed', 'waiting-credentials': zh ? '等待凭据' : 'Waiting for credentials',
    removing: zh ? '正在移除…' : 'Removing…',
  }[item.state] ?? (zh ? '状态更新中…' : 'Updating…'))
  return <section className={css.view} aria-busy={!loaded || busy !== null}>
    <header className={css.header}><div><h2>MCP</h2><p>{zh ? '管理已接入的 MCP，连接后可在对话中使用。' : 'Manage MCP connections and use their tools in conversations.'}</p></div>
      <Button variant="outline" disabled={busy !== null} onClick={() => { setError(''); refresh(value => value + 1) }}>{zh ? '刷新' : 'Refresh'}</Button></header>
    {(loadError || error && !deleting) && <p role="alert" className={css.error}>{loadError || error}</p>}
    {organizationError && <p role="alert" className={css.error}>{zh ? '组织 MCP 暂时无法同步，请检查登录状态、网络或组织授权后刷新。' : 'Organization MCP could not sync. Check sign-in, network and grants, then refresh.'}</p>}
    {notice && <p role="status" className={css.hint}>{notice}</p>}
    {!loaded && <p role="status">{zh ? '正在加载 MCP…' : 'Loading MCP connections…'}</p>}
    {loaded && !loadError && !items.length && <p className={css.hint}>{zh ? '暂无已接入的 MCP。组织下发的服务会在授权后显示；其他 MCP 可通过原生配置或插件接入。' : 'No MCP connections. Granted organization services appear here; other connections use native configuration or plugins.'}</p>}
    <div className={css.list}>{items.map(item => <div key={item.id} className={css.row}>
      <div className={css.identity}><strong>{item.title}</strong><div className={css.meta}><span className={css.status} data-state={item.state}>{stateLabel(item)}</span><span>{source(item)}</span>
        {item.toolCount !== undefined && <span>{item.toolCount} {zh ? '个工具' : 'tools'}</span>}</div>
        {item.serverName && item.serverName !== item.title && <small>{item.serverName}</small>}
        {item.source === 'organization' && <p className={css.hint}>{zh ? '断开仅在本机生效，保留组织授权；共享和下发由组织管理员管理。' : 'Disconnecting affects this device and keeps the grant. Organization administrators manage sharing and distribution.'}</p>}
        {item.source === 'plugin' && <p className={css.hint}>{zh ? '由插件管理连接；需要断开或删除时，请停用或移除对应插件。' : 'The owning plugin manages this connection. Disable or remove that plugin to disconnect it.'}</p>}
        {item.source === 'cleanup' && <p className={css.hint}>{zh ? '原生管理器尚未确认清理完成。如状态持续不变，请重启客户端。' : 'The native manager has not confirmed cleanup. Restart the client if this state persists.'}</p>}
        {item.source === 'configuration' && !item.canDelete && <p className={css.hint}>{zh ? '此配置由应用提供，可断开连接；不能从用户层删除。' : 'Provided by the application. It can be disconnected; it cannot be deleted from user settings.'}</p>}
        {item.error && <details className={css.details}><summary>{zh ? '连接详情' : 'Connection details'}</summary><p>{item.error}</p></details>}</div>
      <Menu open={menu === item.id} portal align="end" onClose={() => setMenu(null)} items={[
        ...(item.canDisconnect && !disconnected(item) ? [{ id: 'disconnect', label: zh ? '断开连接' : 'Disconnect' }] : []),
        ...(item.canReconnect !== false ? [{ id: 'restart', label: disconnected(item) ? (zh ? '连接' : 'Connect') : (zh ? '重新连接' : 'Reconnect') }] : []),
        ...(item.canEdit ? [{ id: 'edit', label: zh ? '编辑配置（原生配置文件）' : 'Edit configuration file' }] : []),
        ...(item.canDelete ? [{ id: 'delete', label: zh ? '删除 MCP' : 'Delete MCP', danger: true }] : []),
      ]} onSelect={action => {
        setMenu(null)
        if (action === 'delete') { setError(''); setDeleting(item) }
        else if (action === 'disconnect' || action === 'restart' || action === 'edit') void run(item, action)
      }} anchor={<button type="button" className={css.more} disabled={busy !== null || item.source === 'cleanup'} aria-label={(zh ? '管理 ' : 'Manage ') + item.title}
        aria-haspopup="menu" aria-expanded={menu === item.id} onClick={() => setMenu(value => value === item.id ? null : item.id)}><IconEllipsisOutlineRegular size={16}/></button>}/>
    </div>)}</div>
    {deleting && <Modal open tone="warning" title={zh ? '删除 MCP' : 'Delete MCP'} closeLabel={zh ? '关闭' : 'Close'}
      description={zh ? '删除此用户配置并停止连接。不会删除服务端数据或保存在凭据提供方中的密钥。' : 'Remove this user entry and stop its connection. Server data and saved credentials are kept.'}
      onClose={() => { if (!busy) setDeleting(null) }} footer={<><Button variant="outline" disabled={busy !== null} onClick={() => setDeleting(null)}>{zh ? '取消' : 'Cancel'}</Button>
        <Button variant="primary" disabled={busy !== null} onClick={() => void run(deleting, 'delete')}>{busy ? (zh ? '正在删除…' : 'Deleting…') : (zh ? '删除' : 'Delete')}</Button></>}>
      <p>{deleting.title}</p>{error && <p role="alert" className={css.error}>{error}</p>}
    </Modal>}
  </section>
}
export function mountMcpConnections(ctx: ClientContext) {
  const labels = labelSource(ctx)
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ipollo-organization-mcp', order: -18,
    label: () => 'MCP', inject: () => ({ locale: () => language(ctx), hooks: { labels },
      accountChanges: (listener: () => void) => ctx.remote.$on('credentials/record-updated', key => { if (key === 'ipollowork-suite/account') listener() }),
      editConfiguration: async () => { const result = await ctx.remote.settings.openSettingsDocument(); if (!result.ok) throw new Error(result.error.code) },
    }) }, McpConnections))
}
