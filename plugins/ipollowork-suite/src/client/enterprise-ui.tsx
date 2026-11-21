import { FormButton, TextInput } from '../../../_shared/ui/controls.tsx'
/** Shared enterprise-page building blocks over native DSH primitives. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular, MarkdownText, Modal, Toast, UserMessageBubble, useClipboardCopy, relativeTime, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MemberPage, MemberQuery, SharedMessage } from '../shared/enterprise.ts'
import type { EnterpriseState } from './enterprise-controller.ts'
import { enterpriseError, format, type EnterpriseLabels } from './enterprise-locale.ts'
import css from './suite.module.css'

export type Call = <T>(path: string, data?: unknown, method?: string) => Promise<T>

/** Read one record; reloads when the path or the controller's data revision changes. */
export function useRecord<T>(path: string | null, call: Call, revision: number) {
  const [result, setResult] = useState<{ path: string; call: Call; data: T | null; error: string }>()
  const [local, setLocal] = useState(0)
  const same = result?.path === path && result?.call === call
  useEffect(() => {
    if (path === null) return
    let active = true
    call<T>(path).then(value => {
      if (active) setResult({ path, call, data: value, error: '' })
    }, (error: unknown) => {
      if (active) setResult(previous => ({
        path, call, data: previous?.path === path && previous.call === call ? previous.data : null,
        error: error instanceof Error ? error.message : 'IPW_SERVICE_UNAVAILABLE',
      }))
    })
    return () => { active = false }
  }, [path, call, revision, local])
  return { data: same ? result.data : null, error: same ? result.error : '', reload: useCallback(() => setLocal(v => v + 1), []) }
}

/** Page and search the authorized directory, retaining the current selection in its owning form. */
export function useMemberDirectory(enterpriseId: string | null, call: Call, revision: number, filter: MemberQuery = {}) {
  const { query = '', department, active, projectId, userId } = filter
  const scope = JSON.stringify([enterpriseId, query, department, active, projectId, userId])
  const [position, setPosition] = useState({ scope, page: 1 })
  const page = position.scope === scope ? position.page : 1
  const [stableQuery, setStableQuery] = useState(query)
  useEffect(() => {
    const timer = window.setTimeout(() => setStableQuery(query), 220)
    return () => window.clearTimeout(timer)
  }, [query])
  const search = useCallback<Call>(path => call(path, { query: stableQuery.trim(), department, projectId, userId, active, page }), [
    call, stableQuery, department, projectId, userId, active, page,
  ])
  const result = useRecord<MemberPage>(
    enterpriseId && query === stableQuery ? '/organizations/' + enterpriseId + '/member-directory' : null, search, revision,
  )
  return { ...result, page, move: (page: number) => setPosition({ scope, page }) }
}

export function PageButtons({ previous, next, t }: { previous?: (() => void) | undefined; next?: (() => void) | undefined; t: EnterpriseLabels }) {
  if (!previous && !next) return null
  return <div className={css.enterpriseActions}>
    <Button size="sm" variant="outline" disabled={!previous} onClick={previous}>{t.previousPage}</Button>
    <Button size="sm" variant="outline" disabled={!next} onClick={next}>{t.nextPage}</Button>
  </div>
}

export function DirectoryStatus({ directory, t }: { directory: ReturnType<typeof useMemberDirectory>; t: EnterpriseLabels }) {
  return <>
    <Notice error={directory.error} t={t} retry={directory.reload}/>
    {!directory.data && !directory.error && <ListSkeleton rows={2}/>}
    <PageButtons t={t} previous={directory.page > 1 ? () => directory.move(directory.page - 1) : undefined}
      next={directory.data?.more ? () => directory.move(directory.page + 1) : undefined}/>
  </>
}

/** Run one user action at a time and keep its failure visible beside the form. */
export function useTask(t: EnterpriseLabels, errorMessage = (error: unknown) => enterpriseError(error instanceof Error ? error.message : '', t)) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return { busy, error, setError, run }
}

export function Notice({ error, t, retry, fallback }: { error: string; t: EnterpriseLabels; retry?: () => void; fallback?: string }) {
  if (!error) return null
  return <div role="alert" className={css.notice}><span>{enterpriseError(error, t, fallback)}</span>{retry && <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={14}/>} onClick={retry}>{t.refresh}</Button>}</div>
}
/** A field failure that already holds a localized message. */
export function FormError({ message }: { message: string }) {
  return message ? <p role="alert" className={css.formError}>{message}</p> : null
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-hidden className={css.listSkeleton}>{Array.from({ length: rows }, (_, i) => <div key={i}><span/><span/></div>)}</div>
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return <div className={css.emptyState}><h2>{title}</h2>{hint && <p>{hint}</p>}{children && <div className={css.enterpriseActions}>{children}</div>}</div>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className={css.enterpriseField}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function Section({ title, meta, actions, children }: { title: string; meta?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className={css.enterpriseBlock}>
    <header><h2>{title}{meta && <small>{meta}</small>}</h2>{actions}</header>
    {children}
  </section>
}

/** Row with a primary text block and trailing actions; the row itself opens when `onOpen` is given. */
export function Row({ title, meta, aside, actions, onOpen }: { title: ReactNode; meta?: ReactNode; aside?: ReactNode; actions?: ReactNode; onOpen?: () => void }) {
  const body = <><span className={css.rowText}><strong>{title}</strong>{meta && <small>{meta}</small>}</span>{aside && <span className={css.rowAside}>{aside}</span>}</>
  return <div className={css.enterpriseItem}>
    {onOpen ? <button type="button" className={css.rowMain} onClick={onOpen}>{body}</button> : <div className={css.rowMain}>{body}</div>}
    {actions && <div className={css.rowActions}>{actions}</div>}
  </div>
}

export function roleName(role: string, t: EnterpriseLabels) { return role === 'owner' || role === 'admin' ? t.admin : t.member }

/** Localized relative time with the absolute time on hover. */
export function When({ at, language }: { at: number; language: string }) {
  const value = relativeTime(at, Date.now())
  const text = value.unit === 'now' ? (language === 'zh' ? '刚刚' : 'just now')
    : new Intl.RelativeTimeFormat(language === 'zh' ? 'zh-CN' : 'en', { numeric: 'auto' }).format(-value.n, value.unit === 'minutes' ? 'minute' : value.unit === 'hours' ? 'hour' : value.unit === 'days' ? 'day' : value.unit === 'months' ? 'month' : 'year')
  return <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>{text}</time>
}

export function useMarkdownLabels(t: EnterpriseLabels): MarkdownLabels {
  return useMemo(() => ({ code: { copyLabel: t.codeCopy, copiedLabel: t.codeCopied }, footnotes: t.footnotes }), [t])
}

/** Untrusted shared text rendered by the native Markdown renderer with raw HTML omitted. */
export function Markdown({ text, t }: { text: string; t: EnterpriseLabels }) {
  const labels = useMarkdownLabels(t)
  return <div className={css.markdown}><MarkdownText text={text} labels={labels} variant="compact" omitHtml/></div>
}

/** Conversation snapshot laid out like the native chat; long snapshots collapse to their latest messages. */
export function Transcript({ messages, t, collapsed = 4 }: { messages: readonly SharedMessage[]; t: EnterpriseLabels; collapsed?: number }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded || messages.length <= collapsed ? messages : messages.slice(-collapsed)
  return <div className={css.transcript}>
    {shown.length < messages.length && <button type="button" className={css.transcriptMore} onClick={() => setExpanded(true)}>{t.showAll} · {format(t.messages, { count: messages.length })}</button>}
    {shown.map((m, i) => m.role === 'user'
      ? <div key={i} className={css.transcriptUser}><UserMessageBubble>{m.content}</UserMessageBubble></div>
      : <div key={i} className={css.transcriptAssistant}><Markdown text={m.content} t={t}/></div>)}
    {expanded && messages.length > collapsed && <button type="button" className={css.transcriptMore} onClick={() => setExpanded(false)}>{t.showLess}</button>}
  </div>
}

export function CopyLink({ url, t, onCopied, label = t.invitation }: { url: string; t: EnterpriseLabels; onCopied?: () => void; label?: string }) {
  const { copied, onCopy } = useClipboardCopy(url)
  useEffect(() => { if (copied) onCopied?.() }, [copied])
  return <div className={css.enterpriseLink}><TextInput aria-label={label} readOnly value={url} onFocus={e => e.currentTarget.select()}/><FormButton variant="outline" onClick={onCopy}>{copied ? t.copied : t.copy}</FormButton></div>
}

/** Destructive confirmation; the dialog stays open with its error when the action fails. */
export function ConfirmDialog({ title, description, confirmLabel, t, run, close }: { title: string; description: string; confirmLabel: string; t: EnterpriseLabels; run(): Promise<void>; close(): void }) {
  const task = useTask(t)
  return <Modal open tone="warning" title={title} description={description} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close() }}
    footer={<div className={css.dialogFooter}><Button variant="outline" disabled={task.busy} onClick={close}>{t.cancel}</Button><Button variant="primary" disabled={task.busy} onClick={() => void task.run(async () => { await run(); close() })}>{confirmLabel}</Button></div>}>
    <FormError message={task.error}/>
  </Modal>
}

/** App-wide transient feedback rendered from `shell.overlay` so it outlives the reporting view. */
export function ToastHost({ useEnterpriseState, dismiss }: { useEnterpriseState<T>(selector: (state: EnterpriseState) => T): T; dismiss(id: number): void }) {
  const toast = useEnterpriseState(s => s.toast)
  return toast ? <Toast key={toast.id} text={toast.text} tone="success" onDone={() => dismiss(toast.id)}/> : null
}
