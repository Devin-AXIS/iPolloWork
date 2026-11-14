/** The Data page: a read-only view of the records that plugins, sites and apps keep through app data. */
import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconCopyOutlineRegular,
  IconDatabaseOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { DataAppDetail, DataAppSummary, DataFieldType, DataRecord, DataValue } from '../shared/app-data.ts'
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
const GLYPH: Record<DataFieldType, string> = { text: 'Aa', number: '#', boolean: '◐', json: '{}' }

interface Props {
  useDataLabels<T>(selector: (labels: DataLabels) => T): T
  useAccount<T>(selector: (snapshot: AccountSnapshot) => T): T
  openAccountSettings(): boolean
}

const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`

function DataPanel(props: Props) {
  const t = props.useDataLabels(v => v)
  const signedIn = props.useAccount(s => s.account?.status === 'signed-in')
  const [apps, setApps] = useState<DataAppSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const load = async () => {
    setFailed(false)
    try {
      const items = (await request<{ items: DataAppSummary[] }>('/data/apps')).items
      setApps(items)
      setSelected(current => (current && items.some(app => app.id === current) ? current : items[0]?.id ?? null))
    } catch (_error) {
      setFailed(true)
    }
  }
  useEffect(() => {
    if (signedIn) void load()
    else setApps(null)
  }, [signedIn])
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const visible = (apps ?? []).filter(app => !needle || app.name.toLowerCase().includes(needle) || app.owner.name.toLowerCase().includes(needle))
    const byWorkspace = new Map<string, DataAppSummary[]>()
    for (const app of visible) byWorkspace.set(app.workspace, [...(byWorkspace.get(app.workspace) ?? []), app])
    return [...byWorkspace.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  }, [apps, query])

  const heading = (
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
  else if (!apps) body = <ListSkeleton rows={4} />
  else if (!apps.length) body = <EmptyState title={t.empty} hint={t.emptyHint} />
  else
    body = (
      <div className={css.dataLayout}>
        <nav className={css.dataNav} aria-label={t.title}>
          <label className={css.dataSearch}>
            <IconSearchOutlineRegular size={14} />
            <input value={query} placeholder={t.search} aria-label={t.search} onChange={event => setQuery(event.target.value)} />
          </label>
          {groups.length === 0 && <p className={css.dataFaint}>{t.noMatch}</p>}
          {groups.map(([workspace, items]) => (
            <div key={workspace} className={css.dataGroup}>
              <h3>{workspace ? workspaceDisplayTitle(workspace, t.defaultWorkspace) : t.other}</h3>
              {items.map(app => (
                <button
                  key={app.id}
                  type="button"
                  className={css.departmentItem}
                  aria-current={app.id === selected ? 'true' : undefined}
                  onClick={() => setSelected(app.id)}
                >
                  <Monogram id={app.id} label={app.name} size={24} />
                  <span>{app.name}</span>
                  <small>{app.owner.kind === 'user' ? t.personal : app.owner.name}</small>
                </button>
              ))}
            </div>
          ))}
        </nav>
        {selected && (
          <AppView
            key={selected}
            id={selected}
            t={t}
            onDeleted={() => {
              setSelected(null)
              void load()
            }}
          />
        )}
      </div>
    )
  return (
    <section className={css.page + ' ' + css.enterprisePage + ' ' + css.dataPage} data-ipw-data>
      {heading}
      {body}
    </section>
  )
}

function AppView({ id, t, onDeleted }: { id: string; t: DataLabels; onDeleted(): void }) {
  const [app, setApp] = useState<DataAppDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [collection, setCollection] = useState('')
  const [rows, setRows] = useState<DataRecord[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    let live = true
    request<{ app: DataAppDetail }>(`/data/apps/${id}`)
      .then(value => {
        if (!live) return
        setApp(value.app)
        setCollection(value.app.collectionList[0]?.name ?? '')
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [id])
  const page = async (after: string | null) => {
    const value = await request<{ items: DataRecord[]; next: string | null }>(`/data/apps/${id}/run`, {
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
  if (failed) return <div className={css.dataMain}><EmptyState title={t.loadFailed} /></div>
  if (!app) return <div className={css.dataMain}><ListSkeleton rows={5} /></div>
  const info = app.collectionList.find(c => c.name === collection)
  const fields = info ? Object.entries(info.fields) : []
  return (
    <div className={css.dataMain}>
      <header className={css.dataHeader}>
        <Monogram id={app.id} label={app.name} size={36} />
        <div>
          <h2>{app.name}</h2>
          <div className={css.dataChips}>
            <span className={css.chip} data-static>{app.owner.kind === 'user' ? t.personal : app.owner.name}</span>
            <span className={css.chip} data-static data-tone={app.public ? 'strong' : undefined}>{app.public ? t.external : t.internal}</span>
            <span className={css.dataFaint}>{format(t.records, { count: app.records })} · {size(app.bytes)}</span>
          </div>
        </div>
        {app.canManage && (
          <button type="button" className={css.iconGhost} aria-label={t.deleteApp} title={t.deleteApp} onClick={() => setConfirming(true)}>
            <IconTrashOutlineRegular size={16} />
          </button>
        )}
      </header>
      {app.public && (
        <div className={css.dataKeys}>
          <CopyRow label={t.endpoint} value={app.endpoint} t={t} />
          <CopyRow label={t.publicKey} value={app.publicKey} t={t} />
          <p>{t.publicHint}</p>
        </div>
      )}
      {app.collectionList.length === 0 ? (
        <EmptyState title={t.noCollections} />
      ) : (
        <>
          <div className={css.lineTabs} role="tablist">
            {app.collectionList.map(c => (
              <button key={c.name} type="button" role="tab" aria-selected={c.name === collection} onClick={() => setCollection(c.name)}>
                {c.name}
                <small className={css.dataTabCount}>{c.records}</small>
                {c.public.includes('create') && <span className={css.dataTabTag}>{t.publicCreate}</span>}
                {c.public.includes('read') && <span className={css.dataTabTag}>{t.publicRead}</span>}
              </button>
            ))}
          </div>
          <div className={css.dataTableWrap}>
            <table className={css.dataTable}>
              <thead>
                <tr>
                  <th className={css.dataIndex} />
                  {fields.map(([name, type]) => (
                    <th key={name}><span className={css.dataGlyph}>{GLYPH[type]}</span>{name}</th>
                  ))}
                  <th><span className={css.dataGlyph}><IconDatabaseOutlineRegular size={11} /></span>{t.createdAt}</th>
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
          <footer className={css.dataFooter}>
            <span>{format(t.records, { count: info?.records ?? 0 })} · {format(t.fields, { count: fields.length })}</span>
            {next && (
              <Button variant="outline" disabled={busy} onClick={() => {
                setBusy(true)
                void page(next).catch(() => setFailed(true)).finally(() => setBusy(false))
              }}>{t.loadMore}</Button>
            )}
          </footer>
        </>
      )}
      {confirming && (
        <DeleteDialog app={app} t={t} close={() => setConfirming(false)} deleted={onDeleted} />
      )}
    </div>
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
