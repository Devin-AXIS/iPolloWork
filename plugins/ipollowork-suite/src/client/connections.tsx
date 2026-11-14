/** One suite-owned editor for every registered plugin's connection fields and its billing source. */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { IconChevronLeftOutlineRegular, IconLinkOutlineRegular, IconSparkleRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionProvider, ConnectionStatus, ConnectionText } from '../shared/connections.ts'
import type { ClientContext } from './native.ts'
import { labelSource, language } from './locale.ts'
import css from './suite.module.css'
import { resolveSource, useServiceState, type ServiceState } from './service-source.tsx'
import { Connections, type ConnectionSnapshot } from './connections-model.ts'
import { KeyGlyph, Monogram } from './glyphs.tsx'

const text = (value: ConnectionText, locale: string) => locale.startsWith('zh') ? value.zh : value.en
const copy = {
  zh: { title: '服务连接', intro: '默认使用官方服务，按账户积分结算；也可以换成自己的 Key', official: '官方', own: '自己的 Key', ready: '官方服务 · 已就绪', ownReady: '自己的 Key · 已填写', needsKey: '未配置', officialGone: '所选官方服务暂不可用', unavailable: '读取失败', fill: '填写 Key', edit: '修改', close: '关闭', back: '全部服务', save: '保存', saving: '保存中…', failed: '操作未完成，请重试', empty: '安装插件后，需要的服务会出现在这里', saved: '已保存，留空保持不变', required: '请填写必填项', retry: '重试', points: '积分', emptyServices: '暂无可用官方服务', offline: '官方服务暂时不可用', models: '官方模型', modelsDown: '官方模型暂时不可用，请稍后重试', switchFailed: '未能切换服务来源' },
  en: { title: 'Service connections', intro: 'Official services are the default and use your account points. You can switch to your own key.', official: 'Official', own: 'Own key', ready: 'Official · Ready', ownReady: 'Own key · Saved', needsKey: 'Not set up', officialGone: 'The selected official service is unavailable', unavailable: 'Could not load', fill: 'Add key', edit: 'Edit', close: 'Close', back: 'All services', save: 'Save', saving: 'Saving…', failed: 'Could not complete this action. Try again.', empty: 'Services needed by installed plugins appear here.', saved: 'Saved; leave blank to keep', required: 'Fill in the required fields.', retry: 'Retry', points: 'points', emptyServices: 'No official services available', offline: 'Official services are unavailable', models: 'Official models', modelsDown: 'Official models are temporarily unavailable.', switchFailed: 'Could not change the source' },
}
type Labels = typeof copy.en
const providerKey = (provider: ConnectionProvider) => provider.id.replace(/^studio:/, '')

function KeyForm({ provider, status, locale, t, saved }: { provider: ConnectionProvider; status: ConnectionStatus; locale: string; t: Labels; saved(): void }) {
  const [values, setValues] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lifetime = useRef(new AbortController())
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const controller = lifetime.current
    if (busy || !status.writable) return
    if (provider.fields.some(field => field.required && !values[field.id]?.trim() && !status.fields?.[field.id])) { setError(t.required); return }
    setBusy(true); setError('')
    try {
      await provider.save(values, controller.signal)
      if (!controller.signal.aborted) { setValues({}); saved() }
    } catch { if (!controller.signal.aborted) setError(t.failed) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const single = provider.fields.length === 1
  return <form className={css.keyForm} data-single={single || undefined} onSubmit={event => void submit(event)}>
    {provider.fields.map(field => <label key={field.id} className={css.fieldPill}>
      {field.secret ? <KeyGlyph size={15}/> : <IconLinkOutlineRegular size={15}/>}<span className={css.srOnly}>{text(field.label, locale)}</span>
      <input type={field.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} maxLength={8192} autoFocus={field === provider.fields[0]}
        value={values[field.id] ?? ''} disabled={busy || !status.writable}
        placeholder={status.fields?.[field.id] ? `${text(field.label, locale)} · ${t.saved}` : text(field.label, locale)}
        onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))}/>
    </label>)}
    <button type="submit" className={css.keySave} disabled={busy || !status.writable || !Object.values(values).some(value => value.trim())}>{busy ? t.saving : t.save}</button>
    {error && <p role="alert" className={css.rowError}>{error}</p>}
  </form>
}

function ProviderItem({ provider, revision, locale, t, services, choose, changed, expanded: initiallyExpanded = false }: {
  provider: ConnectionProvider; revision: number; locale: string; t: Labels; services: ServiceState | undefined
  choose(provider: string, choice: { source: 'own' } | { source: 'official'; serviceId: string }): Promise<void>; changed(): void; expanded?: boolean
}) {
  const [status, setStatus] = useState<ConnectionStatus>(), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(initiallyExpanded), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setFailed(false)
    void provider.load(controller.signal).then(value => { if (!controller.signal.aborted) setStatus(value) }, () => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [provider, revision, retry])
  const key = providerKey(provider), configured = status?.configured ?? false
  const { source, official } = resolveSource(services, key, configured)
  const switchTo = async (kind: 'official' | 'own') => {
    if (busy || kind === source.kind) return
    const target = official
    if (kind === 'official' && !target) return
    setBusy(true); setError('')
    try {
      await choose(key, kind === 'own' ? { source: 'own' } : { source: 'official', serviceId: target!.id })
      setExpanded(kind === 'own' && !configured)
    } catch { setError(t.switchFailed) } finally { setBusy(false) }
  }
  const state = failed ? 'error' : source.kind === 'official' ? source.service ? 'ready' : 'error' : configured ? 'ready' : 'missing'
  const line = failed ? t.unavailable : source.kind === 'official' ? source.service ? t.ready : t.officialGone : !status ? '…' : configured ? t.ownReady : t.needsKey
  const showForm = source.kind === 'own' && status && (expanded || (initiallyExpanded && !configured))
  return <div className={css.provider} data-open={showForm || undefined}>
    <div className={css.providerHead}>
      <Monogram id={key} label={text(provider.title, locale)} size={30}/>
      <span className={css.providerText}>
        <strong>{text(provider.title, locale)}</strong>
        <small><i data-state={state}/>{line}{source.kind === 'own' && configured && official && !showForm && <button type="button" className={css.inlineLink} onClick={() => setExpanded(true)}>{t.edit}</button>}{provider.plugins.length > 0 && <span className={css.providerPlugins}> · {provider.plugins.join(' · ')}</span>}</small>
      </span>
      {failed ? <button type="button" className={css.quietButton} onClick={() => setRetry(value => value + 1)}>{t.retry}</button>
        : (official || source.kind === 'official') ? <div className={css.sourceSwitch} role="group" aria-label={text(provider.title, locale)}>
          <button type="button" aria-pressed={source.kind === 'official'} disabled={busy || !official} onClick={() => void switchTo('official')}><IconSparkleRegular size={12}/>{t.official}</button>
          <button type="button" aria-pressed={source.kind === 'own'} disabled={busy} onClick={() => void switchTo('own')}><KeyGlyph size={12}/>{t.own}</button>
        </div>
        : source.kind === 'own' && status && !showForm ? <button type="button" className={css.quietButton} onClick={() => setExpanded(true)}>{configured ? t.edit : t.fill}</button> : null}
    </div>
    {showForm && status && <KeyForm provider={provider} status={status} locale={locale} t={t} saved={() => { setExpanded(false); changed() }}/>}
    {error && <p role="alert" className={css.rowError}>{error}</p>}
  </div>
}

function Summary({ state, failed, t }: { state: ServiceState | undefined; failed: boolean; t: Labels }) {
  if (failed) return <span className={css.summaryPill} data-tone="muted">{t.offline}</span>
  if (!state) return null
  if (!state.catalog.items.length) return <span className={css.summaryPill} data-tone="muted">{t.emptyServices}</span>
  return <span className={css.summaryPill}><IconSparkleRegular size={13}/>{t.official} · {state.catalog.points.toLocaleString()} {t.points}</span>
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
/** A settings page and an app-wide dialog share the registered provider list. */
export function ConnectionsPanel({ useConnectionState, open, close, changed, locale: readLocale, useLabels, overlay = false }: Props) {
  useLabels(value => value.connections)
  const locale = readLocale(), t = locale.startsWith('zh') ? copy.zh : copy.en
  const state = useConnectionState(value => value)
  const services = useServiceState()
  const selected = state.providers.find(provider => provider.id === state.selected)
  const item = (provider: ConnectionProvider, expanded = false) => <ProviderItem key={provider.id} provider={provider} revision={state.revision} locale={locale} t={t}
    services={services.state} choose={services.choose} changed={changed} expanded={expanded}/>
  const registered = new Set(state.providers.map(providerKey))
  const models = services.state?.catalog.items.filter(service => service.models.length > 0 && !registered.has(service.provider)) ?? []
  const list = <div className={css.providerList}>{state.providers.length ? state.providers.map(provider => item(provider)) : <p className={css.quietLine}>{t.empty}</p>}</div>
  if (!overlay) return <section className={css.connectView}>
    <header className={css.connectHead}><div><h2>{t.title}</h2><p>{t.intro}</p></div><Summary state={services.state} failed={services.failed} t={t}/></header>
    {models.length > 0 && <div className={css.modelChips} aria-label={t.models}><span>{t.models}</span>{models.map(model => <span key={model.id} className={css.modelChip} data-off={!model.available || undefined}>
      <Monogram id={model.provider} label={model.enterprise?.name ?? model.title} size={18} round/>{model.enterprise ? `${model.enterprise.name} · ${model.title}` : model.title}</span>)}</div>}
    {services.state?.models?.status === 'error' && <p role="alert" className={css.rowError}>{t.modelsDown}</p>}
    {list}
  </section>
  return <Modal open={state.open} title={selected ? text(selected.title, locale) : t.title} closeLabel={t.close} onClose={close} className={css.connectionsModal!}>
    {selected ? <div className={css.connectView}>
      {state.providers.length > 1 && <button type="button" className={css.quietBack} onClick={() => open()}><IconChevronLeftOutlineRegular size={14}/>{t.back}</button>}
      <div className={css.providerList}>{item(selected, true)}</div>
    </div> : <div className={css.connectView}><p className={css.quietLine}>{t.intro}</p>{list}</div>}
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
