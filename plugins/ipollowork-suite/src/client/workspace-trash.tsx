import { useState, useSyncExternalStore } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { language } from './locale.ts'
import { request } from './api.ts'
import type { ClientContext } from './native.ts'
import css from './suite.module.css'

const messages = {
  zh: { title: '回收站', open: '查看回收站', close: '关闭', empty: '回收站没有会话。', restore: '恢复', restoreFailed: '无法恢复会话。请确认原工作区目录仍可访问。' },
  en: { title: 'Recycle Bin', open: 'Open Recycle Bin', close: 'Close', empty: 'There are no conversations in the Recycle Bin.', restore: 'Restore', restoreFailed: 'Could not restore the conversation. Check that its original directory is accessible.' },
}

/** Recover conversations without changing their original working directories. */
export function mountWorkspaceTrash(ctx: ClientContext): void {
  const copy = () => messages[language(ctx)]
  const workspaces = ctx.workspaces.list
  const sessions = ctx.sessions.list
  const subscribeLocale = (listener: () => void) => ctx.locale.subscribe(listener)
  const subscribeWorkspaces = (listener: () => void) => workspaces.subscribe(listener)
  const subscribeSessions = (listener: () => void) => sessions.subscribe(listener)
  const workspaceSnapshot = () => workspaces.getSnapshot()
  const sessionSnapshot = () => sessions.getSnapshot()
  let workspaceId: string | null = null
  let open = false
  const listeners = new Set<() => void>()
  const openSnapshot = () => open
  const subscribeOpen = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
  const show = (value: boolean) => { open = value; for (const listener of listeners) listener() }
  function WorkspaceTrash() {
    const visible = useSyncExternalStore(subscribeOpen, openSnapshot)
    const t = useSyncExternalStore(subscribeLocale, copy)
    const workspaceState = useSyncExternalStore(subscribeWorkspaces, workspaceSnapshot)
    const sessionState = useSyncExternalStore(subscribeSessions, sessionSnapshot)
    const archived = new Set(workspaceState.archivedSessionIds)
    const rows = sessionState.ids.filter(id => archived.has(id)).map(id => sessionState.byId[id]).filter(row => row !== undefined)
    const [restoring, setRestoring] = useState<string>()
    const [error, setError] = useState(false)
    async function restore(row: SessionSummary) {
      setRestoring(row.id)
      setError(false)
      try {
        await request('/workspace-trash/restore', { method: 'POST', body: JSON.stringify({ sessionId: row.id }) })
      } catch {
        setError(true)
      } finally {
        setRestoring(undefined)
      }
    }
    if (!visible) return null
    return <Modal open title={t.title} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => show(false)}>
      {error && <p role="alert">{t.restoreFailed}</p>}
      {workspaceState.phase === 'ready' && sessionState.phase === 'ready' && rows.length === 0 && <p>{t.empty}</p>}
      <ul className={css.workspaceTrashList}>
        {rows.map(row => <li key={row.id}>
          <div><strong>{row.displayTitle}</strong>{row.cwd && <span title={row.cwd}>{row.cwd}</span>}</div>
          <Button variant="outline" disabled={restoring !== undefined} onClick={() => void restore(row)}>{t.restore}</Button>
        </li>)}
      </ul>
    </Modal>
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'ipollowork-workspace-trash' }, WorkspaceTrash))
  ctx.effect(() => ctx.contextMenus.register({
    id: 'ipollowork.workspace-trash', target: 'workspace', order: 10,
    resolve: target => workspaceId && target.workspaceId === workspaceId ? [{ id: 'open-recycle-bin', label: copy().open, run: () => show(true) }] : [],
  }), 'ipollowork: native recycle bin workspace menu')
  ctx.effect(() => {
    const lifetime = new AbortController()
    let loading = false
    const refresh = () => {
      const snapshot = workspaceSnapshot()
      if (loading || snapshot.phase !== 'ready' || workspaceId && snapshot.items.some(row => row.workspaceId === workspaceId)) return
      loading = true
      void request<{ workspaceId: string | null }>('/workspace-trash', { signal: lifetime.signal })
        .then(result => { workspaceId = result.workspaceId }, () => {})
        .finally(() => { loading = false })
    }
    // The native row click expands a folder. For this one workspace its contents are the Host's archived sessions.
    const click = (event: MouseEvent) => {
      if (!workspaceId || !(event.target instanceof Element) || event.target.closest('button,a,[role="button"]')) return
      if (event.target.closest('[data-row-key]')?.getAttribute('data-row-key') !== `workspace:${workspaceId}`) return
      event.preventDefault(); event.stopPropagation(); show(true)
    }
    refresh()
    const release = subscribeWorkspaces(refresh)
    document.addEventListener('click', click, true)
    return () => { lifetime.abort(); release(); document.removeEventListener('click', click, true) }
  }, 'ipollowork: open the native Recycle Bin workspace')
}
