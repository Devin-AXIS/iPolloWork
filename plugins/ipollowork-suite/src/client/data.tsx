/**
 * The Data page. App cards are grouped by owner, personal or one organization, and filtered by plugin or public app;
 * an opened app lists its collections beside a read-only record table.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconChevronLeftOutlineRegular,
  IconCopyOutlineRegular,
  IconDatabaseOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { DataAppDetail, DataAppList, DataAppSummary, DataFieldType, DataRecord, DataValue } from '../shared/app-data.ts'
import type { ClientContext } from './native.ts'
import type { AccountController, AccountSnapshot } from './account-controller.ts'
import { request } from './api.ts'
import { format } from './enterprise-locale.ts'
import { EmptyState, ListSkeleton } from './enterprise-ui.tsx'
import { Monogram } from './glyphs.tsx'
import { dataCopy, dataLabels, type DataLabels } from './data-locale.ts'
import css from './suite.module.css'

const PANEL = 'ipollowork-data'
const PAGE = 50
const PERSONAL = ':personal'
const GLYPH: Record<DataFieldType, string> = { text: 'Aa', number: '#', boolean: '◐', json: '{}' }
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
  const [owner, setOwner] = useState(PERSONAL)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<DataAppSummary | null>(null)
  const load = async () => {
    setFailed(false)
    try {
      setList(await request<DataAppList>('/data/apps'))
    } catch (_error) {
      setFailed(true)
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
      <section className={css.page + ' ' + css.enterprisePage + ' ' + css.dataPage} data-ipw-data>
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
        <div className={css.lineTabs} role="tablist" aria-label={t.owners}>
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
          <label className={css.miniSearch}>
            <IconSearchOutlineRegular size={13} />
            <input value={query} placeholder={t.search} aria-label={t.search} onChange={event => setQuery(event.target.value)} />
          </label>
        </div>
        {visible.length === 0 ? (
          owned.length ? <EmptyState title={t.noMatch} /> : <EmptyState title={t.empty} hint={t.emptyHint} />
        ) : (
          <div className={css.dataGrid}>
            {visible.map(app => (
              <button key={app.id} type="button" className={css.dataCard} onClick={() => setOpen(app)}>
                <span className={css.dataCardTop}>
                  <Monogram id={app.id} label={app.name} size={34} />
                  <span className={css.chip} data-static data-tone={app.kind === 'site' ? 'strong' : undefined}>{app.kind === 'site' ? t.publicApp : t.plugin}</span>
                </span>
                <strong>{app.name}</strong>
                <span className={css.dataOrigin}>
                  <IconFolderOpenOutlineRegular size={12} />
                  <span>{format(t.createdIn, { name: origin(app, t) })}</span>
                </span>
                <span className={css.dataCardFoot}>
                  <span>{format(t.tables, { count: app.collections })} · {format(t.records, { count: app.records })}</span>
                  <span>{new Date(app.updatedAt).toLocaleDateString()}</span>
                </span>
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
        {signedIn && (
          <button type="button" className={css.iconGhost} aria-label={t.refresh} title={t.refresh} onClick={() => void load()}>
            <IconRefreshOutlineRegular size={16} />
          </button>
        )}
      </div>
      {body}
    </section>
  )
}

function AppDetail({ summary, ownerName, t, back, deleted }: {
  summary: DataAppSummary; ownerName: string; t: DataLabels; back(): void; deleted(): void
}) {
  const [app, setApp] = useState<DataAppDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [collection, setCollection] = useState('')
  const [rows, setRows] = useState<DataRecord[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    let live = true
    request<{ app: DataAppDetail }>(`/data/apps/${summary.id}`)
      .then(value => {
        if (!live) return
        setApp(value.app)
        setCollection(value.app.collectionList[0]?.name ?? '')
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [summary.id])
  const page = async (after: string | null) => {
    const value = await request<{ items: DataRecord[]; next: string | null }>(`/data/apps/${summary.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ find: collection, limit: PAGE, ...(after ? { after } : {}) }),
    })
    setRows(current => (after && current ? [...current, ...value.items] : value.items))
    setNext(value.next)
  }
  useEffect(() => {
    setRows(null)
    setNext(null)
    if (collection) void page(null).catch(() => setFailed(true))
  }, [collection])
  const info = app?.collectionList.find(c => c.name === collection)
  const fields = info ? Object.entries(info.fields) : []
  return (
    <>
      <nav className={css.dataCrumbs} aria-label={t.title}>
        <button type="button" onClick={back}><IconChevronLeftOutlineRegular size={14} />{t.title}</button>
        <span aria-hidden>/</span>
        <span>{ownerName}</span>
        <span aria-hidden>/</span>
        <strong>{summary.name}</strong>
      </nav>
      {failed ? <EmptyState title={t.loadFailed} /> : !app ? <ListSkeleton rows={5} /> : (
        <div className={css.dataDetail}>
          <aside className={css.dataSide}>
            <div className={css.dataSideHead}>
              <Monogram id={app.id} label={app.name} size={40} />
              <strong>{app.name}</strong>
              <span className={css.dataChips}>
                <span className={css.chip} data-static>{ownerName}</span>
                <span className={css.chip} data-static data-tone={app.kind === 'site' ? 'strong' : undefined}>{app.kind === 'site' ? t.publicApp : t.plugin}</span>
              </span>
              <span className={css.dataOrigin}>
                <IconFolderOpenOutlineRegular size={12} />
                <span>{format(t.createdIn, { name: origin(app, t) })}</span>
              </span>
              <span className={css.dataFaint}>{format(t.records, { count: app.records })} · {size(app.bytes)}</span>
            </div>
            <div className={css.dataSideLabel}>{t.tablesLabel}</div>
            {app.collectionList.length === 0 && <p className={css.dataFaint}>{t.noCollections}</p>}
            {app.collectionList.map(c => (
              <button key={c.name} type="button" className={css.departmentItem} aria-current={c.name === collection ? 'true' : undefined}
                onClick={() => setCollection(c.name)}>
                <IconDatabaseOutlineRegular size={14} />
                <span>{c.name}</span>
                {c.public.length > 0 && <i className={css.dataPublicDot} title={c.public.map(p => (p === 'read' ? t.publicRead : t.publicCreate)).join(' · ')} />}
                <small>{c.records}</small>
              </button>
            ))}
            {app.canManage && (
              <button type="button" className={css.dataDanger} onClick={() => setConfirming(true)}>
                <IconTrashOutlineRegular size={13} />{t.deleteApp}
              </button>
            )}
          </aside>
          <div className={css.dataMain}>
            {(app.kind === 'site' || app.public) && (
              <div className={css.dataKeys}>
                <CopyRow label={t.endpoint} value={app.endpoint} t={t} />
                <CopyRow label={t.publicKey} value={app.publicKey} t={t} />
                <p>{t.publicHint}</p>
              </div>
            )}
            {info ? (
              <>
                <header className={css.dataTableHead}>
                  <h2>{info.name}</h2>
                  {info.public.includes('create') && <span className={css.dataTabTag}>{t.publicCreate}</span>}
                  {info.public.includes('read') && <span className={css.dataTabTag}>{t.publicRead}</span>}
                  <span className={css.dataFaint}>{format(t.records, { count: info.records })} · {format(t.fields, { count: fields.length })}</span>
                </header>
                <div className={css.dataTableWrap}>
                  <table className={css.dataTable}>
                    <thead>
                      <tr>
                        <th className={css.dataIndex} />
                        {fields.map(([name, type]) => (
                          <th key={name}><span className={css.dataGlyph}>{GLYPH[type]}</span>{name}</th>
                        ))}
                        <th>{t.createdAt}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rows ?? []).map((row, index) => (
                        <tr key={row.id}>
                          <td className={css.dataIndex}>{index + 1}</td>
                          {fields.map(([name, type]) => (
                            <td key={name} data-type={type} title={cellTitle(row[name])}>{cell(row[name], type, t)}</td>
                          ))}
                          <td className={css.dataFaint}>{new Date(row.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows === null && <ListSkeleton rows={3} />}
                  {rows?.length === 0 && <p className={css.dataEmptyRows}>{t.noRecords}</p>}
                </div>
                {next && (
                  <div className={css.dataFooter}>
                    <Button variant="outline" disabled={busy} onClick={() => {
                      setBusy(true)
                      void page(next).catch(() => setFailed(true)).finally(() => setBusy(false))
                    }}>{t.loadMore}</Button>
                  </div>
                )}
              </>
            ) : (
              <EmptyState title={t.noCollections} hint={t.noCollectionsHint} />
            )}
          </div>
        </div>
      )}
      {confirming && app && <DeleteDialog app={app} t={t} close={() => setConfirming(false)} deleted={deleted} />}
    </>
  )
}

function cell(value: DataValue | undefined, type: DataFieldType, t: DataLabels) {
  if (value === undefined || value === null) return <span className={css.dataFaint}>—</span>
  if (type === 'boolean') return value ? t.yes : t.no
  if (type === 'number' && typeof value === 'number') return value.toLocaleString()
  if (type === 'json') return <code>{JSON.stringify(value)}</code>
  return String(value)
}
const cellTitle = (value: DataValue | undefined) =>
  value === undefined || value === null ? undefined : typeof value === 'object' ? JSON.stringify(value) : String(value)

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
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  return (
    <Modal open tone="warning" title={format(t.deleteTitle, { name: app.name })} description={format(t.deleteHint, { count: app.records })}
      closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!busy) close() }}
      footer={<div className={css.dialogFooter}>
        <Button variant="outline" disabled={busy} onClick={close}>{t.cancel}</Button>
        <Button variant="primary" disabled={busy} onClick={() => {
          setBusy(true)
          setFailed(false)
          request(`/data/apps/${app.id}`, { method: 'DELETE' })
            .then(() => { close(); deleted() })
            .catch(() => setFailed(true))
            .finally(() => setBusy(false))
        }}>{t.delete}</Button>
      </div>}>
      {failed && <p className={css.dataError} role="alert">{t.loadFailed}</p>}
    </Modal>
  )
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
