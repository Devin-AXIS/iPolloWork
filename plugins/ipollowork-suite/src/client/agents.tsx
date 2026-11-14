/** Bot library: create once, then open a project conversation directly. */
import { useEffect, useState } from 'react'
import { IconUsersOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentCatalog, AgentItem, AgentMemory, AgentModelCatalog, AgentModelOption } from '../shared/agents.ts'
import type { ClientContext } from './native.ts'
import { request } from './api.ts'
import { agentCopy, agentLabelSource, type AgentLabels } from './agent-locale.ts'
import { AgentEditor, draftFrom, newDraft, type AgentDraft } from './agent-editor.tsx'
import { BotAvatar } from './agent-avatar.tsx'
import css from './suite.module.css'

interface AgentState extends AgentCatalog { loading: boolean; error: string }
/** One source of catalog state for this suite activation. */
export class AgentsController {
  private snapshot: AgentState = { agents: [], accounts: [], projects: [], services: [], loading: false, error: '' }
  private listeners = new Set<() => void>()
  private lifetime = new AbortController()
  private revision = 0
  getSnapshot = (): AgentState => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(value: AgentState): void {
    if (this.lifetime.signal.aborted) return
    this.snapshot = value
    for (const listener of this.listeners) listener()
  }
  request = <T,>(path: string, body?: unknown): Promise<T> => request<T>(`/agents${path}`, {
    signal: this.lifetime.signal,
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  })
  load = async (): Promise<void> => {
    const revision = ++this.revision
    this.publish({ ...this.snapshot, loading: true, error: '' })
    try {
      const result = await this.request<AgentCatalog>('/catalog')
      if (revision === this.revision) this.publish({ ...result, loading: false, error: '' })
    } catch (error) {
      if (revision === this.revision) this.publish({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : 'IPOLLO_OPERATION_FAILED' })
    }
  }
  dispose(): void { this.lifetime.abort(); this.listeners.clear() }
}

interface Props {
  useAgentLabels<T>(selector: (labels: AgentLabels) => T): T;
  useAgentState<T>(selector: (state: AgentState) => T): T;
  load(): Promise<void>;
  call<T>(path: string, input?: unknown): Promise<T>;
  openSession(id: string): void;
}

/** Keep configuration out of the everyday start-chat path. */
export function AgentsPanel({ useAgentLabels, useAgentState, load, call, openSession }: Props) {
  const t = useAgentLabels(value => value)
  const state = useAgentState(value => value)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<AgentDraft>(newDraft)
  const [editing, setEditing] = useState(false)
  const [target, setTarget] = useState<{ kind: 'start' | 'memory'; agent: AgentItem } | null>(null)
  const [projectId, setProjectId] = useState('')
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])
  const [models, setModels] = useState<AgentModelOption[]>([])
  const [modelsUnavailable, setModelsUnavailable] = useState(false)
  const [memory, setMemory] = useState<AgentMemory | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!editing) return
    let current = true
    call<{ skills: typeof skills }>('/skills').then(value => { if (current) setSkills(value.skills) })
      .catch(problem => { if (current) setError(problem instanceof Error ? problem.message : 'IPOLLO_OPERATION_FAILED') })
    call<AgentModelCatalog>('/models').then(value => { if (current) { setModels(value.models); setModelsUnavailable(value.unavailable) } })
      .catch(() => { if (current) setModelsUnavailable(true) })
    return () => { current = false }
  }, [editing, call])
  useEffect(() => {
    setMemory(null)
    if (target?.kind !== 'memory' || !projectId) return
    let current = true
    setMemoryLoading(true)
    call<AgentMemory>(`/memory?projectId=${encodeURIComponent(projectId)}&agentId=${target.agent.id}`)
      .then(value => { if (current) setMemory(value) })
      .catch(problem => { if (current) setError(problem instanceof Error ? problem.message : 'IPOLLO_OPERATION_FAILED') })
      .finally(() => { if (current) setMemoryLoading(false) })
    return () => { current = false }
  }, [target, projectId, call])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (problem) { setError(problem instanceof Error ? problem.message : 'IPOLLO_OPERATION_FAILED') }
    finally { setBusy(false) }
  }
  const edit = (item: AgentItem) => { setDraft(draftFrom(item, state.services)); setError(''); setEditing(true) }
  const open = (kind: 'start' | 'memory', agent: AgentItem) => {
    setTarget({ kind, agent }); setError(''); setNotice('')
    if (!projectId) setProjectId(state.projects[0]?.id ?? '')
  }
  const errorText = error ? (t as Record<string, string>)[error] ?? t.IPOLLO_OPERATION_FAILED : ''
  const candidates = state.agents.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
  const skillOptions = [...new Map([...skills, ...(state.agents.find(item => item.id === draft.id)?.skills ?? [])].map(skill => [skill.name, skill])).values()]
  return <section className={`${css.page} ${css.agentPage}`}>
    <div className={css.heading}><div><h1>{t.title}</h1><p>{t.intro}</p></div><button className={css.primary} onClick={() => { setDraft(newDraft()); setEditing(true); setError('') }}>{t.create}</button></div>
    <div className={css.agentSearch}><input type="search" placeholder={t.search} aria-label={t.search} value={query} onChange={event => setQuery(event.target.value)} /></div>
    {state.error && <p className={css.error} role="alert">{t.IPOLLO_OPERATION_FAILED} <button className={css.textAction} onClick={() => void load()}>{t.refresh}</button></p>}
    {notice && !target && <p role="status" className={css.muted}>{notice}</p>}
    {state.loading && !state.agents.length ? <div className={css.agentGrid} aria-label={t.loading}>{[0,1,2].map(index => <div key={index} className={css.agentSkeleton} />)}</div>
      : candidates.length ? <div className={css.agentGrid}>{candidates.map(item => <article className={css.botCard} key={item.id}>
        <div className={css.botIdentity}><BotAvatar name={item.name} avatar={item.avatar} /><div><h2>{item.name}</h2>{!item.enabled && <span className={css.muted}>{t.disabled}</span>}</div></div>
        <p className={css.botDescription}>{item.description || item.prompt || t.basicsHint}</p>
        <div className={css.botCapabilities}><span>{t.skills} {item.skills.length}</span><span>{t.services} {item.serviceNames?.length ?? state.services.length}</span></div>
        {item.broken && <p className={css.error}>{t.broken}</p>}
        <button className={css.primary} disabled={!item.enabled || Boolean(item.broken)} onClick={() => open('start', item)}>{t.start}</button>
        <div className={css.botActions}><button onClick={() => edit(item)}>{t.edit}</button><button onClick={() => open('memory', item)}>{t.memory}</button><button onClick={() => {
          const { id, revision, ...copy } = draftFrom(item, state.services)
          setDraft({ ...copy, name: `${item.name} 2` }); setEditing(true); setError('')
        }}>{t.copy}</button></div>
      </article>)}</div> : <div className={css.botEmpty}><span className={css.botAvatar} aria-hidden="true"><IconUsersOutlineRegular size={24} /></span><h2>{state.agents.length ? t.noResults : t.empty}</h2>{!state.agents.length && <><p>{t.emptyHint}</p><button className={css.primary} onClick={() => { setDraft(newDraft()); setEditing(true) }}>{t.create}</button></>}</div>}
    {editing && <AgentEditor t={t} draft={draft} onChange={setDraft} services={state.services} skills={skillOptions} models={models} modelsUnavailable={modelsUnavailable} busy={busy} error={errorText} onClose={() => setEditing(false)} onRefresh={() => void load()} onSave={() => void run(async () => {
      const saved = await call<{ broken?: string }>('/agents', draft)
      await load()
      if (saved.broken) setError('IPOLLO_OPERATION_FAILED')
      else { setEditing(false); setNotice(t.saved) }
    })} />}
    {target && <Modal open title={target.kind === 'start' ? t.startTitle : t.memory} closeLabel={t.close} description={target.kind === 'start' ? t.startHint : t.memoryHint} className={`${css.page} ${css.agentDialog}`} contentClassName={css.agentDialogContent!} onClose={() => { if (!busy) setTarget(null) }} footer={<>
      <button className={css.secondary} disabled={busy} onClick={() => setTarget(null)}>{t.cancel}</button>
      <button className={css.primary} disabled={busy || !projectId || (target.kind === 'memory' && (!memory || memoryLoading))} onClick={() => void run(async () => {
        if (target.kind === 'memory' && memory) { setMemory(await call<AgentMemory>('/memory', memory)); setNotice(t.saved) }
        else { const result = await call<{ sessionId: string }>('/start', { projectId, agentId: target.agent.id }); setTarget(null); openSession(result.sessionId) }
      })}>{target.kind === 'start' ? t.start : t.saveMemory}</button></>}>
      <div className={css.agentFields}><div className={css.botIdentity}><BotAvatar name={target.agent.name} avatar={target.agent.avatar} /><h2>{target.agent.name}</h2></div>
        <label>{t.project}<select value={projectId} disabled={busy} onChange={event => { setProjectId(event.target.value); setNotice(''); setError('') }}><option value="">{t.chooseProject}</option>{state.projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        {target.kind === 'memory' && projectId && (memoryLoading ? <p role="status">{t.loading}</p> : memory && <label>{t.memory}<textarea rows={8} value={memory.text} disabled={busy} onChange={event => setMemory({ ...memory, text: event.target.value })} /></label>)}
        {errorText && <p className={css.error} role="alert">{errorText}</p>}{notice && <p role="status">{notice}</p>}
      </div>
    </Modal>}
  </section>
}

/** Contribute one entry to the existing suite and native sidebar. */
export function mountAgents(ctx: ClientContext): void {
  const controller = new AgentsController()
  ctx.effect(() => () => controller.dispose(), 'ipollowork-suite: agent library')
  const labels = agentLabelSource(ctx)
  ctx.slots.inject('main', () => ctx.slots.register<Props>({ name: 'main', key: 'ipollowork-agents', inject: () => ({
    hooks: { agentLabels: labels, agentState: controller }, load: controller.load, call: controller.request,
    openSession: (id: string) => ctx.uiWorkspace.openSession(id),
  }) }, AgentsPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'ipollowork-agents', order: 8, label: () => agentCopy(ctx).title }, IconUsersOutlineRegular))
}
