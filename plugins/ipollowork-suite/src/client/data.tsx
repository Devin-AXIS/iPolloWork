/**
 * The Data page. Apps are compact rows grouped by owner, personal or one organization, and filtered by plugin or public app;
 * an opened app is its records: one tab per collection over the record grid of `data-records.tsx`. Connection details
 * and deletion stay behind header controls.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconChevronLeftOutlineRegular,
  IconCopyOutlineRegular,
  IconDatabaseOutlineRegular,
  IconEllipsisOutlineRegular,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
  Menu,
  } from '@deepseek-ai/dsh-client-ui-primitives'
import { Modal } from '../../../_shared/ui/modal.tsx'
import { SearchInput } from '../../../_shared/ui/controls.tsx'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { DataAppDetail, DataAppList, DataAppSummary } from '../shared/app-data.ts'
import type { ClientContext } from './native.ts'
import type { AccountController, AccountSnapshot } from './account-controller.ts'
import { request } from './api.ts'
import { waitForDeletion, type DeletionEntry } from './deletion.ts'
import { format } from './enterprise-locale.ts'
import { EmptyState, ListSkeleton } from './enterprise-ui.tsx'
import { Monogram } from './glyphs.tsx'
import { dataCopy, dataLabels, type DataLabels } from './data-locale.ts'
import { RecordTable } from './data-records.tsx'
import css from './suite.module.css'

const PANEL = 'ipollowork-data'
const PERSONAL = ':personal'
type Filter = 'all' | 'plugin' | 'public'

interface Props {
  useDataLabels<T>(selector: (labels: DataLabels) => T): T
  useAccount<T>(selector: (snapshot: AccountSnapshot) => T): T
  openAccountSettings(): boolean
}

const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`
const ownerKey = (app: DataAppSummary) => (app.owner.kind === 'user' ? PERSONAL : app.owner.id)
const origin = (app: DataAppSummary, t: DataLabels) =>
  app.workspace ? workspaceDisplayTitle(app.workspace, t.defaultWorkspace) : t.unknownOrigin

function DataPanel(props: Props) {
  const t = props.useDataLabels(v => v)
  const signedIn = props.useAccount(s => s.account?.status === 'signed-in')
  const [list, setList] = useState<DataAppList | null>(null)
  const [failed, setFailed] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [owner, setOwner] = useState(PERSONAL)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<DataAppSummary | null>(null)
  const [history, setHistory] = useState(false)
  const load = async () => {
    setFailed(false)
    try {
      setList(await request<DataAppList>('/data/apps'))
      setDisabled(false)
    } catch (error) {
      // The app data entry was switched off after this page loaded.
      if (error instanceof Error && error.message === 'IPW_APP_DATA_DISABLED') setDisabled(true)
      else setFailed(true)
    }
  }
  useEffect(() => {
    if (signedIn) void load()
    else {
      setList(null)
      setOpen(null)
    }
  }, [signedIn])
  const tabs = useMemo(() => [
    { id: PERSONAL, name: t.personal },
    ...(list?.organizations ?? []).map(org => ({ id: org.id, name: org.name })),
  ], [list, t])
  const owned = (list?.items ?? []).filter(app => ownerKey(app) === owner)
  const needle = query.trim().toLowerCase()
  const visible = owned.filter(app =>
    (filter === 'all' || app.kind === (filter === 'public' ? 'site' : 'plugin')) &&
    (!needle || app.name.toLowerCase().includes(needle) || origin(app, t).toLowerCase().includes(needle)))

  if (open)
    return (
      <section className={css.page + ' ' + css.enterprisePage + ' ' + css.dataPage} data-ipw-data data-wide>
        <AppDetail
          summary={open}
          ownerName={tabs.find(tab => tab.id === ownerKey(open))?.name ?? open.owner.name}
          t={t}
          back={() => setOpen(null)}
          deleted={() => {
            setOpen(null)
            void load()
          }}
        />
      </section>
    )

  let body
  if (!signedIn)
    body = (
      <EmptyState title={t.signIn} hint={t.signInHint}>
        <Button variant="primary" onClick={() => props.openAccountSettings()}>{t.signInAction}</Button>
      </EmptyState>
    )
  else if (disabled) body = <EmptyState title={t.disabled} hint={t.disabledHint} />
  else if (failed)
    body = (
      <EmptyState title={t.loadFailed}>
        <Button variant="outline" onClick={() => void load()}>{t.retry}</Button>
      </EmptyState>
    )
  else if (!list) body = <ListSkeleton rows={4} />
  else
    body = (
      <>
        <div className={css.panelTabStrip + " ipw-tab-strip"} role="tablist" aria-label={t.owners}>
          {tabs.map(tab => (
            <button key={tab.id} type="button" role="tab" aria-selected={tab.id === owner} onClick={() => setOwner(tab.id)}>
              {tab.name}
              <small className={css.dataTabCount}>{list.items.filter(app => ownerKey(app) === tab.id).length}</small>
            </button>
          ))}
        </div>
        <div className={css.dataToolbar}>
          <div className={css.dataFilters} role="group" aria-label={t.kind}>
            {([['all', t.all], ['plugin', t.plugins], ['public', t.publicApps]] as const).map(([id, label]) => (
              <button key={id} type="button" className={css.filterChip} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
                <small>{id === 'all' ? owned.length : owned.filter(app => app.kind === (id === 'public' ? 'site' : 'plugin')).length}</small>
              </button>
            ))}
          </div>
          <SearchInput className={css.compactSearch!} value={query} placeholder={t.search} aria-label={t.search}
            onChange={event => setQuery(event.target.value)} />
        </div>
        {visible.length === 0 ? (
          owned.length ? <EmptyState title={t.noMatch} /> : <EmptyState title={t.empty} hint={t.emptyHint} />
        ) : (
          <div className={css.dataList}>
            {visible.map(app => (
              <button key={app.id} type="button" className={css.dataRow} title={format(t.createdIn, { name: origin(app, t) })} onClick={() => setOpen(app)}>
                <Monogram id={app.id} label={app.name} size={30} />
                <span className={css.dataRowText}>
                  <strong>{app.name}</strong>
                  <small>{format(t.records, { count: app.records })} · {new Date(app.createdAt).toLocaleDateString()}</small>
                </span>
                <span className={css.dataRowKind} data-warn={app.suspended ? '' : undefined}>{app.suspended ? t.suspended : app.kind === 'site' ? t.publicApp : t.plugin}</span>
              </button>
            ))}
          </div>
        )}
      </>
    )
  return (
    <section className={css.page + ' ' + css.enterprisePage + ' ' + css.dataPage} data-ipw-data>
      <div className={css.heading}>
        <div>
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
        {signedIn && <div className={css.enterpriseActions}>
          <Button variant="ghost" onClick={() => setHistory(true)}>{t.deletionHistory}</Button>
          <button type="button" className={css.iconGhost} aria-label={t.refresh} title={t.refresh} onClick={() => void load()}>
            <IconRefreshOutlineRegular size={16} />
          </button>
        </div>}
      </div>
      {body}
      {history && signedIn && <DeletionHistory t={t} close={() => setHistory(false)} />}
    </section>
  )
}

function AppDetail({ summary, ownerName, t, back, deleted }: {
  summary: DataAppSummary; ownerName: string; t: DataLabels; back(): void; deleted(): void
}) {
  const [app, setApp] = useState<DataAppDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [collection, setCollection] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [menu, setMenu] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [granting, setGranting] = useState(false)
  const live = useRef(true)
  const load = () =>
    request<{ app: DataAppDetail }>(`/data/apps/${summary.id}`)
      .then(value => {
        if (!live.current) return
        setApp(value.app)
        setCollection(current => (value.app.collectionList.some(c => c.name === current) ? current : value.app.collectionList[0]?.name ?? ''))
      })
      .catch(() => { if (live.current) setFailed(true) })
  useEffect(() => {
    live.current = true
    void load()
    return () => { live.current = false }
  }, [summary.id])
  const info = app?.collectionList.find(c => c.name === collection)
  const kind = app?.kind ?? summary.kind
  return (
    <>
      <header className={css.dataHead}>
        <button type="button" className={css.iconGhost} aria-label={t.back} title={t.back} onClick={back}>
          <IconChevronLeftOutlineRegular size={16} />
        </button>
        <div className={css.dataHeadTitle}>
          <h1>{summary.name}</h1>
          <p>{ownerName} · {kind === 'site' ? t.publicApp : t.plugin} · {format(t.createdIn, { name: origin(app ?? summary, t) })}</p>
        </div>
        {app && (kind === 'site' || app.public) && (
          <button type="button" className={css.chip} aria-expanded={connecting} onClick={() => setConnecting(value => !value)}>
            <IconLinkOutlineRegular size={12} />{t.connect}
          </button>
        )}
        {app?.canManage && (
          <Menu open={menu} portal align="end" onClose={() => setMenu(false)}
            anchor={<button type="button" className={css.iconGhost} aria-label={t.more} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><IconEllipsisOutlineRegular size={16} /></button>}
            items={[...(app.roles.length ? [{ id: 'admins', label: t.admins }] : []), { id: 'delete', label: t.deleteApp, danger: true }]}
            onSelect={id => { setMenu(false); if (id === 'admins') setGranting(true); else setConfirming(true) }} />
        )}
      </header>
      {app && connecting && (
        <div className={css.dataKeys}>
          <CopyRow label={t.endpoint} value={app.endpoint} t={t} />
          <CopyRow label={t.publicKey} value={app.publicKey} t={t} />
          {app.signin && <CopyRow label={t.signinUrl} value={app.signin} t={t} />}
          <p>{t.publicHint}</p>
        </div>
      )}
      {app?.suspended && <p className={css.dataNotice} role="status">{t.suspendedHint}</p>}
      {failed ? <EmptyState title={t.loadFailed} /> : !app ? <ListSkeleton rows={5} /> : !info ? (
        <EmptyState title={t.noCollections} hint={t.noCollectionsHint} />
      ) : (
        <>
          <div className={'ipw-tab-strip ' + css.panelTabStrip + ' ' + css.dataTabs} role="tablist" aria-label={t.tablesLabel}>
            {app.collectionList.map(c => (
              <button key={c.name} type="button" role="tab" aria-selected={c.name === collection} onClick={() => setCollection(c.name)}>
                {c.name}
                <small className={css.dataTabCount}>{c.records}</small>
              </button>
            ))}
          </div>
          <RecordTable key={info.name} appId={app.id} info={info} t={t} changed={() => void load()} />
        </>
      )}
      {confirming && app && <DeleteDialog app={app} t={t} close={() => setConfirming(false)} deleted={deleted} />}
      {granting && app && <AdminsDialog app={app} t={t} close={() => setGranting(false)} changed={() => void load()} />}
    </>
  )
}

/** Existing app administrators can still be removed while new grants are hidden. */
function AdminsDialog({ app, t, close, changed }: { app: DataAppDetail; t: DataLabels; close(): void; changed(): void }) {
  const [roles, setRoles] = useState(app.roles)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const revoke = (email: string) => {
    setBusy(true)
    setError('')
    request<{ roles: DataAppDetail['roles'] }>(`/data/apps/${app.id}/run`, { method: 'POST', body: JSON.stringify({ revoke: email }) })
      .then(value => { setRoles(value.roles); changed() })
      .catch(cause => setError(cause instanceof Error ? cause.message : t.loadFailed))
      .finally(() => setBusy(false))
  }
  return (
    <Modal open title={t.admins} description={t.adminsHint} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!busy) close() }}>
      {error && <p className={css.dataError} role="alert">{error}</p>}
      {roles.length === 0 ? <p className={css.dataFaint}>{t.noAdmins}</p> : (
        <ul className={css.dataAdminList}>
          {roles.map(role => (
            <li key={role.id}>
              <span><strong>{role.name || role.id}</strong><small>{role.id}</small></span>
              <button type="button" className={css.dataLink} data-danger disabled={busy} onClick={() => revoke(role.email)}>{t.removeAdmin}</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function CopyRow({ label, value, t }: { label: string; value: string; t: DataLabels }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={css.dataCopy}>
      <span>{label}</span>
      <code>{value}</code>
      <button type="button" className={css.iconGhost} aria-label={copied ? t.copied : t.copy} title={copied ? t.copied : t.copy} onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}>
        <IconCopyOutlineRegular size={14} />
      </button>
    </div>
  )
}

function DeleteDialog({ app, t, close, deleted }: { app: DataAppDetail; t: DataLabels; close(): void; deleted(): void }) {
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('')
  const pending = status === t.deletionPending
  const dismiss = pending ? deleted : close
  return (
    <Modal open tone="warning" title={format(t.deleteTitle, { name: app.name })} description={format(t.deleteHint, { count: app.records })}
      closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!busy) dismiss() }}
      footer={<div className={css.dialogFooter}>
        <Button variant="outline" disabled={busy} onClick={dismiss}>{pending ? t.close : t.cancel}</Button>
        <Button variant="primary" disabled={busy} onClick={() => {
          setBusy(true)
          setStatus('')
          request(`/data/apps/${app.id}`, { method: 'DELETE' })
            .then(receipt => waitForDeletion(receipt))
            .then(() => { close(); deleted() })
            .catch((error: Error) => setStatus(error.message === 'IPW_DELETION_PENDING' ? t.deletionPending
              : error.message === 'IPW_DELETION_STATUS_UNAVAILABLE' ? t.deletionStatusUnavailable : t.loadFailed))
            .finally(() => setBusy(false))
        }}>{pending ? t.refresh : t.delete}</Button>
      </div>}>
      {status && <p className={css.dataError} role="status">{status}</p>}
    </Modal>
  )
}

function DeletionHistory({ t, close }: { t: DataLabels; close(): void }) {
  const [entries, setEntries] = useState<DeletionEntry[]>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    let timer: number
    const load = async () => {
      try {
        const list = await request<{ items: DeletionEntry[] }>('/deletions', { signal: abort.signal })
        setEntries(list.items)
        setFailed(false)
      } catch {
        if (!abort.signal.aborted) setFailed(true)
      }
      if (!abort.signal.aborted) timer = window.setTimeout(load, 5000)
    }
    void load()
    return () => { abort.abort(); window.clearTimeout(timer) }
  }, [])
  return <Modal open title={t.deletionHistory} closeLabel={t.close} className={css.enterpriseModal!} onClose={close}>
    {failed ? <p role="alert">{t.deletionStatusUnavailable}</p> : !entries ? <ListSkeleton rows={3} />
      : !entries.length ? <p>{t.noDeletions}</p>
        : <ul className={css.dataAdminList}>{entries.map(entry => <li key={entry.deletionId}>
          <span><strong>{t.deletionKinds[entry.kind] ?? entry.kind}</strong><small>{entry.deletionId}</small></span>
          <span>{entry.status === 'completed' ? t.deletionCompleted : t.deletionInProgress}</span>
        </li>)}</ul>}
  </Modal>
}

/**
 * Register the Data page and its sidebar entry.
 * @param ctx - the client context.
 * @param account - the suite account state; the page asks to sign in when signed out.
 */
export function mountData(ctx: ClientContext, account: AccountController): void {
  const labels = dataLabels(ctx)
  const props = () => ({
    hooks: { dataLabels: labels, account },
    openAccountSettings: account.openAccountSettings,
  })
  ctx.slots.inject('main', () => ctx.slots.register<Props>({ name: 'main', key: PANEL, inject: props }, DataPanel))
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 10, label: () => dataCopy(ctx).title }, IconDatabaseOutlineRegular),
  )
}
