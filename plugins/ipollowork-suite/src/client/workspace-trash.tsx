import { useState, useSyncExternalStore } from 'react'
import {
  Button, IconArchiveOffOutlineRegular, IconFolderOpenOutlineRegular, IconTrashOutlineRegular, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { language } from './locale.ts'
import { request } from './api.ts'
import type { ClientContext } from './native.ts'
import css from './suite.module.css'

const messages = {
  zh: { title: '回收站', close: '关闭', empty: '没有已归档的会话', loading: '正在加载归档会话',
    restore: '恢复会话', reveal: '在文件夹中显示', restoreFailed: '无法恢复会话，请确认原工作区目录仍可访问',
    revealFailed: '无法找到此会话的本地文件' },
  en: { title: 'Recycle Bin', close: 'Close', empty: 'No archived conversations', loading: 'Loading archived conversations',
    restore: 'Restore conversation', reveal: 'Show in folder', restoreFailed: 'Could not restore the chat. Check that its original workspace is accessible.',
    revealFailed: 'The local conversation file could not be found.' },
}

/** Local archive browser, separate from the Workspace tree and its commands. */
export function mountWorkspaceTrash(ctx: ClientContext): void {
  if (location.protocol !== 'dsh-app:') return
  const workspace = ctx.workspaces.list, sessions = ctx.sessions.list
  const copy = () => messages[language(ctx)]
  const desktop = (window as Window & { dshDesktop?: { revealArchivedSession?(id: string): Promise<void> } }).dshDesktop
  function WorkspaceTrash({ wide }: { wide: boolean }) {
    const t = useSyncExternalStore(listener => ctx.locale.subscribe(listener), copy)
    const workspaceState = useSyncExternalStore(listener => workspace.subscribe(listener), () => workspace.getSnapshot())
    const sessionState = useSyncExternalStore(listener => sessions.subscribe(listener), () => sessions.getSnapshot())
    const [open, setOpen] = useState(false), [selected, select] = useState<string>()
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const archived = new Set(workspaceState.archivedSessionIds)
    const rows = sessionState.ids.filter(id => archived.has(id)).map(id => sessionState.byId[id]).filter(row => row !== undefined)
    const action = (id: string, kind: 'restore' | 'reveal') => {
      if (busy) return
      setError(''); setBusy(true)
      void (async () => {
        try {
          if (kind === 'restore') {
            await request('/workspace-trash/restore', { method: 'POST', body: JSON.stringify({ sessionId: id }) })
            select(undefined)
          } else if (desktop?.revealArchivedSession) {
            await desktop.revealArchivedSession(id)
          }
        } catch { setError(kind === 'restore' ? t.restoreFailed : t.revealFailed) }
        finally { setBusy(false) }
      })()
    }
    return <>
      <Button className={css.workspaceTrashEntry} size="sm" variant="ghost" aria-label={t.title}
        aria-expanded={open} title={t.title} icon={<IconTrashOutlineRegular size={16}/>}
        onClick={() => { setOpen(value => !value); select(undefined); setError('') }}>{wide ? t.title : undefined}</Button>
      {open && <Modal open title={t.title} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => setOpen(false)}>
        {error && <p className={css.formError} role="alert">{error}</p>}
        {workspaceState.phase !== 'ready' || sessionState.phase !== 'ready' ? <p role="status">{t.loading}</p> :
          rows.length ? <ul className={css.workspaceTrashList}>{rows.map(row => <li key={row.id}>
            <button type="button" className={css.workspaceTrashDetails} aria-pressed={selected === row.id}
              onClick={() => { select(row.id); setError('') }}>
              <strong title={row.displayTitle}>{row.displayTitle}</strong>
              {row.cwd && <span title={row.cwd}>{row.cwd}</span>}
            </button>
            {selected === row.id && <div className={css.workspaceTrashActions}>
              <Button variant="ghost" size="sm" disabled={busy} aria-label={t.restore} title={t.restore}
                icon={<IconArchiveOffOutlineRegular size={16}/>} onClick={() => action(row.id, 'restore')}/>
              {desktop?.revealArchivedSession && <Button variant="ghost" size="sm" disabled={busy} aria-label={t.reveal} title={t.reveal}
                icon={<IconFolderOpenOutlineRegular size={16}/>} onClick={() => action(row.id, 'reveal')}/>}
            </div>}
          </li>)}</ul> : <p>{t.empty}</p>}
      </Modal>}
    </>
  }
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({ name: 'sidebar.footer.action', id: 'ipollowork-trash', order: 80 }, WorkspaceTrash))
  ctx.effect(() => {
    const lifetime = new AbortController()
    const style = document.createElement('style')
    document.head.append(style)
    void request<{ workspaceId: string | null }>('/workspace-trash', { signal: lifetime.signal }).then(({ workspaceId }) => {
      if (workspaceId && !lifetime.signal.aborted)
        style.textContent = `[data-slot="sidebar.workspaces"] [data-row-key="${CSS.escape('workspace:' + workspaceId)}"]{display:none!important}`
    }, () => {})
    return () => { lifetime.abort(); style.remove() }
  }, 'ipollowork: hide the legacy synthetic archive workspace')
}
