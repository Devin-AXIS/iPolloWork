/** Persistent main-assistant navigation hosted beside the native conversation list. */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconPlusOutlineRegular, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from './native.ts'
import { agentLabelSource, type AgentLabels } from './agent-locale.ts'
import { request } from './api.ts'
import { COORDINATOR_PRESET } from '../shared/coordinator.ts'
import css from './suite.module.css'

interface Props {
  useAgentLabels<T>(selector: (labels: AgentLabels) => T): T;
  open(fresh: boolean): Promise<void>;
}

/** Keep the list owner intact; the suite owns only its inserted navigation node. */
export function CoordinatorEntry({ useAgentLabels, open }: Props) {
  const t = useAgentLabels(value => value)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let owned: HTMLDivElement | undefined
    let header: Element | null = null
    const attach = () => {
      if (header?.isConnected && owned?.isConnected) return
      const next = document.querySelector('[data-sidebar-workspace-header]')
      if (next === header && owned?.isConnected) return
      owned?.remove()
      header = next
      if (!next) { setHost(null); return }
      owned = document.createElement('div')
      owned.className = css.coordinatorHost!
      owned.dataset.ipolloCoordinator = ''
      next.after(owned)
      setHost(owned)
    }
    const observer = new MutationObserver(attach)
    observer.observe(document.body, { childList: true, subtree: true })
    attach()
    return () => { observer.disconnect(); owned?.remove() }
  }, [])
  const activate = async (fresh: boolean) => {
    setBusy(true); setFailed(false)
    try { await open(fresh) } catch { setFailed(true) }
    finally { setBusy(false) }
  }
  return host && createPortal(<nav aria-label={t.coordinator} className={css.coordinatorEntry}>
    <div className={css.coordinatorRow}>
      <button className={css.coordinatorOpen} disabled={busy} title={t.coordinator} onClick={() => void activate(false)}>
        <IconUsersOutlineRegular size={16} /><span>{t.coordinator}</span>
      </button>
      <button className={css.coordinatorNew} disabled={busy} title={t.coordinatorNew} aria-label={t.coordinatorNew} onClick={() => void activate(true)}><IconPlusOutlineRegular size={16} /></button>
    </div>
    {failed && <p role="alert" className={css.coordinatorError}>{t.coordinatorFailed}</p>}
  </nav>, host)
}

function FixedCoordinatorMode({ useAgentLabels }: Pick<Props, 'useAgentLabels'>) {
  const t = useAgentLabels(value => value)
  return <span className={css.coordinatorMode}>{t.coordinator}</span>
}

/** Register the persistent entry and a fixed mode label for coordinator conversations. */
export function mountCoordinator(ctx: ClientContext): void {
  const lifetime = new AbortController()
  const labels = agentLabelSource(ctx)
  let pending: Promise<void> | undefined
  const open = (fresh: boolean) => {
    if (pending) return pending
    pending = request<{ sessionId: string }>('/agents/coordinator', { method: 'POST', body: JSON.stringify({ fresh }), signal: lifetime.signal })
      .then(value => { if (!lifetime.signal.aborted) ctx.uiWorkspace.openSession(value.sessionId) })
      .finally(() => { pending = undefined })
    return pending
  }
  ctx.effect(() => () => lifetime.abort(), 'ipollo: main assistant navigation')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register<Props>({ name: 'shell.overlay', id: 'ipollo-coordinator-entry', inject: () => ({ hooks: { agentLabels: labels }, open }) }, CoordinatorEntry))
  let releaseMode: (() => void) | undefined
  const syncMode = () => {
    const active = Object.values(ctx.sessions.list.getSnapshot().byId).find(item => (item.retainedBy.mainView ?? 0) > 0)
    const fixed = active?.projectionValues.agentPreset === COORDINATOR_PRESET
    if (fixed && !releaseMode) releaseMode = ctx.slots.register({ name: 'conversation.hero.agentPreset', priority: -100, inject: () => ({ hooks: { agentLabels: labels } }) }, FixedCoordinatorMode)
    else if (!fixed && releaseMode) { releaseMode(); releaseMode = undefined }
  }
  ctx.slots.inject('conversation.hero.agentPreset', () => {
    const unsubscribe = ctx.sessions.list.subscribe(syncMode)
    syncMode()
    return () => { unsubscribe(); releaseMode?.(); releaseMode = undefined }
  })
}
