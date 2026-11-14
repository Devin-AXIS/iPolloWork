/** One suite-owned editor for every registered plugin's connection fields. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionProvider, ConnectionStatus, ConnectionText } from '../shared/connections.ts'
import type { ClientContext } from './native.ts'
import { labelSource, language } from './locale.ts'
import css from './suite.module.css'
import { ServiceSource,OfficialServices,useServiceState } from './service-source.tsx'
import { Connections, type ConnectionSnapshot } from './connections-model.ts'

const text = (value: ConnectionText, locale: string) => locale.startsWith('zh') ? value.zh : value.en
const copy = {
  zh: { title: '服务连接', intro: '所有插件的 Key 在这里统一管理', configured: '已配置', missing: '未配置', unavailable: '读取失败', configure: '配置', edit: '修改', close: '关闭', back: '返回', save: '保存', saving: '保存中…', failed: '操作未完成，请重试', empty: '暂无需要配置的服务', replace: '已保存，留空保持不变', hint: 'Key 由 DSH 保存，不会回显', required: '请填写必填项', retry: '重试' },
  en: { title: 'Service connections', intro: 'Manage keys for all plugins in one place.', configured: 'Configured', missing: 'Not configured', unavailable: 'Could not load', configure: 'Configure', edit: 'Edit', close: 'Close', back: 'Back', save: 'Save', saving: 'Saving…', failed: 'Could not complete this action. Try again.', empty: 'No service connections to configure', replace: 'Saved; leave blank to keep', hint: 'Keys stay in DSH and are never returned.', required: 'Fill in the required fields.', retry: 'Retry' },
}
type Labels = typeof copy.en
function ConnectionRow({ provider, revision, locale, open, official }: { official?:boolean; provider: ConnectionProvider; revision: number; locale: string; open(id: string): void }) {
  const [status, setStatus] = useState<ConnectionStatus>(), [failed, setFailed] = useState(false)
  const t = locale.startsWith('zh') ? copy.zh : copy.en
  useEffect(() => {
    const controller = new AbortController(); setFailed(false)
    void provider.load(controller.signal).then(value => { if (!controller.signal.aborted) setStatus(value) }, () => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [provider, revision])
  return <button type="button" className={css.connectionRow} onClick={() => open(provider.id)}>
    <span><strong>{text(provider.title, locale)}</strong><small>{provider.plugins.join(' · ')}</small></span>
    <span className={css.connectionStatus}>{official ? (locale.startsWith('zh')?'官方服务':'Official service') : failed ? t.unavailable : status ? status.configured ? t.configured : t.missing : '…'}<span aria-hidden> ›</span></span>
  </button>
}
function ConnectionEditor({ provider, locale, t, saved }: { provider: ConnectionProvider; locale: string; t: Labels; saved(): void }) {
  const [status, setStatus] = useState<ConnectionStatus>(), [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, retry] = useState(0)
  const lifetime = useRef<AbortController>()
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    void provider.load(controller.signal).then(value => { if (!controller.signal.aborted) { setStatus(value); setError('') } }, () => { if (!controller.signal.aborted) setError(t.failed) })
    return () => { controller.abort(); lifetime.current = undefined }
  }, [provider, revision, t.failed])
  const submit = async () => {
    const controller = lifetime.current
    if (!controller || busy || !status?.writable) return
    if (provider.fields.some(field => field.required && !values[field.id]?.trim() && !status.fields?.[field.id])) { setError(t.required); return }
    setBusy(true); setError('')
    try {
      await provider.save(values, controller.signal)
      if (!controller.signal.aborted) { setValues({}); saved() }
    } catch { if (!controller.signal.aborted) setError(t.failed) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <ServiceSource provider={provider.id.replace(/^studio:/,'')} zh={locale.startsWith('zh')} ownConfigured={status?.configured??false}><form className={css.connectionForm} onSubmit={event => { event.preventDefault(); void submit() }}>
    <p className={css.muted}>{t.hint}</p>
    {provider.fields.map(field => <label key={field.id}><span>{text(field.label, locale)}</span><input
      type={field.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} maxLength={8192}
      value={values[field.id] ?? ''} disabled={busy || !status?.writable}
      placeholder={status?.fields?.[field.id] ? t.replace : undefined}
      onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))}/></label>)}
    {error && <p role="alert" className={css.error}>{error} {!status && <button type="button" onClick={() => retry(value => value + 1)}>{t.retry}</button>}</p>}
    <Button type="submit" variant="primary" disabled={busy || !status?.writable || !Object.values(values).some(value => value.trim())}>{busy ? t.saving : t.save}</Button>
  </form></ServiceSource>
}
interface Props {
  useConnectionState<T>(selector: (value: ConnectionSnapshot) => T): T
  open(id?: string): void
  close(): void
  changed(): void
  useLabels<T>(selector: (value: { connections: string }) => T): T
  locale(): string
  overlay?: boolean
}
/** A settings summary and an app-wide dialog share the registered provider list. */
export function ConnectionsPanel({ useConnectionState, open, close, changed, locale: readLocale, useLabels, overlay = false }: Props) {
  useLabels(value => value.connections)
  const locale = readLocale(), t = locale.startsWith('zh') ? copy.zh : copy.en
  const state = useConnectionState(value => value)
  const services=useServiceState(locale.startsWith('zh'))
  const selected = state.providers.find(provider => provider.id === state.selected)
  const rows = <div className={css.connectionList}>{state.providers.length ? state.providers.map(provider => <ConnectionRow key={provider.id} provider={provider} revision={state.revision} locale={locale} open={open} official={services.state?.choices[provider.id.replace(/^studio:/,'')]?.source!=='own'&&services.state?.catalog.items.some(item=>item.provider===provider.id.replace(/^studio:/,'')&&item.available)===true}/>) : <p className={css.muted}>{t.empty}</p>}</div>
  if (!overlay) return <section className={css.connections}><h2>{t.title}</h2><p className={css.muted}>{t.intro}</p><OfficialServices zh={locale.startsWith('zh')} state={services.state} error={services.error}/>{rows}</section>
  return <Modal open={state.open} title={selected ? text(selected.title, locale) : t.title} closeLabel={t.close} onClose={close} className={css.connectionsModal!}>
    {selected ? <><Button variant="ghost" onClick={() => open()}>{t.back}</Button><ConnectionEditor key={selected.id} provider={selected} locale={locale} t={t} saved={() => { changed(); open() }}/></> : rows}
  </Modal>
}
/** Provide the optional plugin protocol and mount its only credential editor. */
export function mountConnections(ctx: ClientContext): void {
  const connections = new Connections(), labels = labelSource(ctx)
  ctx.provide('ipolloConnections', connections)
  const inject = () => ({ open: connections.open, close: connections.close, changed: connections.changed, locale: () => language(ctx), hooks: { labels, connectionState: connections } })
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ipollo-connections', order: -19, label: () => language(ctx) === 'zh' ? copy.zh.title : copy.en.title, inject }, ConnectionsPanel))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'ipollo-connections', inject: () => ({ ...inject(), overlay: true }) }, ConnectionsPanel))
}
