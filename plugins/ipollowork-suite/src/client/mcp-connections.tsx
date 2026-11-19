import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { request } from './api.ts'
import { language, labelSource, type Labels } from './locale.ts'
import type { ClientContext } from './native.ts'
import css from './suite.module.css'

interface Connection { id: string; title: string; serverName: string; state: string }
function McpConnections({ locale, useLabels, accountChanges }: { locale(): string; useLabels<T>(select: (labels: Labels) => T): T; accountChanges(listener: () => void): () => void }) {
  useLabels(value => value)
  const zh = locale() === 'zh'
  const [items, setItems] = useState<Connection[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [revision, refresh] = useState(0)
  useEffect(() => accountChanges(() => { setItems([]); setLoaded(false); refresh(value => value + 1) }), [accountChanges])
  useEffect(() => {
    const lifetime = new AbortController()
    const load = async () => {
      try {
        const result = await request<{ items: Connection[] }>('/enterprise/mcp-connections', { signal: lifetime.signal })
        if (!lifetime.signal.aborted) { setItems(result.items); setError('') }
      } catch (cause) {
        if (!lifetime.signal.aborted) {
          setItems([])
          setError(cause instanceof Error && cause.message === 'IPW_SIGN_IN_REQUIRED'
            ? zh ? '登录组织账号后查看已下发的 MCP。' : 'Sign in to see organization MCP connections.'
            : zh ? '组织 MCP 同步失败，请刷新重试，并检查组织授权或 MCP 管理器是否已启用。' : 'Could not sync organization MCP. Refresh and check organization access and the MCP manager.')
        }
      } finally { if (!lifetime.signal.aborted) setLoaded(true) }
    }
    void load()
    const timer = setInterval(() => { void load() }, 10000)
    return () => { clearInterval(timer); lifetime.abort() }
  }, [revision, zh])
  return <section className={css.connectView}>
    <header className={css.connectHead}><div><h2>{zh ? '组织 MCP' : 'Organization MCP'}</h2><p>{zh ? '已授权的组织服务由原生 MCP 管理器连接，连接后可在对话中使用。' : 'Granted organization services connect through the native MCP manager and become available in conversations.'}</p></div>
      <Button variant="outline" onClick={() => refresh(value => value + 1)}>{zh ? '刷新' : 'Refresh'}</Button></header>
    {error && <p role="alert" className={css.formError}>{error}</p>}
    {!loaded && <p role="status">{zh ? '正在同步组织 MCP…' : 'Syncing organization MCP…'}</p>}
    {loaded && !error && !items.length && <p>{zh ? '暂无已授权的组织 MCP；需要 OAuth 的服务请先在组织空间完成授权。' : 'No granted organization MCP. Complete OAuth in the organization space when required.'}</p>}
    {items.map(item => <div key={item.id} className={css.person}><span className={css.personText}><strong>{item.title}</strong>
      <small>{item.state === 'connected' ? (zh ? '已连接' : 'Connected') : item.state === 'connecting' ? (zh ? '连接中…' : 'Connecting…') : item.state === 'failed' ? (zh ? '连接失败' : 'Connection failed') : item.state}<br/>{item.serverName}</small></span>
      <Button variant="outline" disabled={busy} onClick={() => {
        setBusy(true)
        void request(`/enterprise/mcp-connections/${item.id}/restart`, { method: 'POST', body: '{}' })
          .then(() => refresh(value => value + 1), () => setError(zh ? '重连失败，请检查 MCP 服务或组织授权。' : 'Could not reconnect. Check the service and organization access.')).finally(() => setBusy(false))
      }}>{zh ? '重新连接' : 'Reconnect'}</Button></div>)}
  </section>
}
export function mountMcpConnections(ctx: ClientContext) {
  const labels = labelSource(ctx)
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ipollo-organization-mcp', order: -18,
    label: () => 'MCP', inject: () => ({ locale: () => language(ctx), hooks: { labels }, accountChanges: (listener: () => void) => ctx.remote.$on('credentials/record-updated', listener) }) }, McpConnections))
}
