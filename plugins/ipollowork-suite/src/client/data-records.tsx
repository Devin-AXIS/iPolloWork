/**
 * One collection of an app on the Data page: search, filters, a sortable grid, pages of fifty records, and a side
 * sheet that adds, edits or deletes one record. Fields are fixed here; only code and the model declare new ones.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCloseOutlineRegular,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DataCollectionInfo, DataFieldType, DataRecord, DataValue } from '../shared/app-data.ts'
import { request } from './api.ts'
import { format } from './enterprise-locale.ts'
import { FormError, ListSkeleton } from './enterprise-ui.tsx'
import type { DataLabels } from './data-locale.ts'
import { OPS, complete, whereOf, type Op, type Rule } from './data-query.ts'
import css from './suite.module.css'

const PAGE = 50
const DEFAULT_SORT = '-createdAt'
const GLYPH: Record<DataFieldType, string> = { text: 'Aa', number: '#', boolean: '◐', json: '{}' }
type Fields = [string, DataFieldType][]
interface Query { sort: string; search: string; rules: Rule[] }

const opLabel = (op: Op, t: DataLabels) =>
  op === 'contains' ? t.opContains : op === 'empty' ? t.opEmpty : op === '=' ? t.opEquals : op === '!=' ? t.opNot : op
function cell(value: DataValue | undefined, type: DataFieldType) {
  if (value === undefined || value === null) return <span className={css.dataFaint}>—</span>
  if (type === 'boolean') return <span className={css.dataCheck} data-on={value ? '' : undefined}>{value ? <IconCheckOutlineRegular size={11} /> : null}</span>
  if (type === 'number' && typeof value === 'number') return value.toLocaleString()
  if (type === 'json') return <code>{JSON.stringify(value)}</code>
  return String(value)
}

/**
 * The record grid of one collection.
 * @param props.appId - the app that owns the collection.
 * @param props.info - the collection's name, declared fields and public access.
 * @param props.t - Data page copy.
 * @param props.changed - called after a record was added or deleted, so the caller refreshes its counts.
 */
export function RecordTable({ appId, info, t, changed }: { appId: string; info: DataCollectionInfo; t: DataLabels; changed(): void }) {
  const fields = Object.entries(info.fields) as Fields
  const [query, setQuery] = useState<Query>({ sort: DEFAULT_SORT, search: '', rules: [] })
  const [typed, setTyped] = useState('')
  const [filtering, setFiltering] = useState(false)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<DataRecord[] | null>(null)
  const [total, setTotal] = useState(info.records)
  const [failed, setFailed] = useState('')
  const [sheet, setSheet] = useState<DataRecord | 'new' | null>(null)
  // cursors[n] opens page n; only the latest request may replace the rows.
  const cursors = useRef<(string | null)[]>([null])
  const turn = useRef(0)
  const run = <T,>(statement: unknown) => request<T>(`/data/apps/${appId}/run`, { method: 'POST', body: JSON.stringify(statement) })
  const load = async (index: number) => {
    const mine = ++turn.current
    const where = whereOf(query.rules, fields)
    const scope = { ...(where ? { where } : {}), ...(query.search ? { search: query.search } : {}) }
    const after = cursors.current[index]
    const find = { find: info.name, sort: query.sort, limit: PAGE, ...scope, ...(after ? { after } : {}) }
    try {
      const value = await run<{ results: [{ items: DataRecord[]; next: string | null }, { count: number }] }>({ batch: [find, { count: info.name, ...scope }] })
      if (mine !== turn.current) return
      const [found, counted] = value.results
      cursors.current[index + 1] = found.next
      setRows(found.items)
      setTotal(counted.count)
      setPage(index)
      setFailed('')
    } catch (error) {
      if (mine === turn.current) setFailed(error instanceof Error ? error.message : t.loadFailed)
    }
  }
  useEffect(() => {
    cursors.current = [null]
    setRows(null)
    void load(0)
  }, [query])
  useEffect(() => {
    const term = typed.trim()
    if (term === query.search) return
    const timer = setTimeout(() => setQuery(current => ({ ...current, search: term })), 250)
    return () => clearTimeout(timer)
  }, [typed])
  const sortBy = (field: string) => setQuery(current => ({
    ...current,
    sort: current.sort === field ? '-' + field : current.sort === '-' + field ? field : (field === 'createdAt' ? '-' : '') + field,
  }))
  const heading = (field: string, label: string, type?: DataFieldType) => {
    const direction = query.sort === field ? 'ascending' : query.sort === '-' + field ? 'descending' : undefined
    return (
      <th key={field} aria-sort={direction} data-type={type}>
        <button type="button" className={css.dataSort} title={format(t.sortBy, { name: label })} onClick={() => sortBy(field)}>
          {type && <span className={css.dataGlyph}>{GLYPH[type]}</span>}
          {label}
          <i aria-hidden>{direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : ''}</i>
        </button>
      </th>
    )
  }
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const narrowed = query.search !== '' || query.rules.length > 0
  return (
    <>
      <div className={css.dataToolbar}>
        <div className={css.dataFilters}>
          <label className={css.miniSearch}>
            <IconSearchOutlineRegular size={13} />
            <input value={typed} placeholder={t.searchRecords} aria-label={t.searchRecords} onChange={event => setTyped(event.target.value)} />
          </label>
          <button type="button" className={css.filterChip} aria-pressed={filtering || query.rules.length > 0} aria-expanded={filtering} onClick={() => setFiltering(value => !value)}>
            {t.filter}
            {query.rules.length > 0 && <small>{query.rules.length}</small>}
          </button>
        </div>
        <Button variant="primary" onClick={() => setSheet('new')}><IconPlusOutlineRegular size={13} />{t.newRecord}</Button>
      </div>
      {filtering && (
        <FilterPanel fields={fields} rules={query.rules} t={t}
          apply={rules => { setQuery(current => ({ ...current, rules })); setFiltering(false) }} />
      )}
      {!filtering && query.rules.length > 0 && (
        <div className={css.dataRules}>
          {query.rules.map((rule, index) => (
            <span key={index} className={css.dataRule}>
              {rule.field} {opLabel(rule.op, t)} {rule.op === 'empty' ? '' : new Map(fields).get(rule.field) === 'boolean' ? (rule.value === 'true' ? t.yes : t.no) : rule.value}
              <button type="button" aria-label={t.removeFilter} onClick={() => setQuery(current => ({ ...current, rules: current.rules.filter((_, at) => at !== index) }))}>
                <IconCloseOutlineRegular size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <FormError message={failed} />
      <div className={css.dataTableWrap} aria-busy={rows === null}>
        <table className={css.dataTable}>
          <thead>
            <tr>
              <th className={css.dataNo} />
              {fields.map(([name, type]) => (type === 'json'
                ? <th key={name}><span className={css.dataGlyph}>{GLYPH[type]}</span>{name}</th>
                : heading(name, name, type)))}
              {heading('createdAt', t.createdAt)}
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row, index) => (
              <tr key={row.id} tabIndex={0} onClick={() => setSheet(row)}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setSheet(row)
                }}>
                <td className={css.dataNo}>{page * PAGE + index + 1}</td>
                {fields.map(([name, type]) => <td key={name} data-type={type}>{cell(row[name], type)}</td>)}
                <td className={css.dataFaint}>{new Date(row.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows === null && !failed && <ListSkeleton rows={3} />}
        {rows?.length === 0 && <p className={css.dataEmptyRows}>{narrowed ? t.noMatchingRecords : t.noRecords}</p>}
        <button type="button" className={css.dataAddRow} onClick={() => setSheet('new')}><IconPlusOutlineRegular size={12} />{t.newRecord}</button>
      </div>
      <footer className={css.dataFoot}>
        <span>
          {format(t.records, { count: total })} · {format(t.fields, { count: fields.length })}
          {info.public.includes('create') && <> · {t.publicCreate}</>}
          {info.public.includes('read') && <> · {t.publicRead}</>}
        </span>
        <span className={css.dataPager}>
          {format(t.pageOf, { page: page + 1, pages })}
          <button type="button" className={css.iconGhost} aria-label={t.previousPage} disabled={page === 0} onClick={() => void load(page - 1)}><IconChevronLeftOutlineRegular size={14} /></button>
          <button type="button" className={css.iconGhost} aria-label={t.nextPage} disabled={!cursors.current[page + 1]} onClick={() => void load(page + 1)}><IconChevronRightOutlineRegular size={14} /></button>
        </span>
      </footer>
      {sheet && (
        <RecordSheet appId={appId} collection={info.name} fields={fields} record={sheet === 'new' ? null : sheet} t={t}
          close={() => setSheet(null)}
          saved={counted => {
            setSheet(null)
            void load(counted ? 0 : page)
            if (counted) changed()
          }} />
      )}
    </>
  )
}

function FilterPanel({ fields, rules, t, apply }: { fields: Fields; rules: Rule[]; t: DataLabels; apply(rules: Rule[]): void }) {
  const first = fields[0]
  const blank = (): Rule => ({ field: first?.[0] ?? '', op: first ? OPS[first[1]][0]! : 'empty', value: '' })
  const [draft, setDraft] = useState<Rule[]>(rules.length ? rules : [blank()])
  const types = new Map(fields)
  const change = (index: number, patch: Partial<Rule>) => setDraft(current => current.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)))
  if (!first) return <p className={css.dataFaint}>{t.noFields}</p>
  return (
    <form className={css.dataFilterPanel} onSubmit={event => { event.preventDefault(); apply(draft.filter(rule => complete(rule, types.get(rule.field)))) }}>
      {draft.map((rule, index) => {
        const type = types.get(rule.field) ?? 'text'
        return (
          <div key={index} className={css.dataFilterRow}>
            <select aria-label={t.filterField} value={rule.field}
              onChange={event => change(index, { field: event.target.value, op: OPS[types.get(event.target.value) ?? 'text'][0]!, value: '' })}>
              {fields.map(([name, kind]) => <option key={name} value={name}>{GLYPH[kind]} {name}</option>)}
            </select>
            <select aria-label={t.filterOperator} value={rule.op} onChange={event => change(index, { op: event.target.value as Op })}>
              {OPS[type].map(op => <option key={op} value={op}>{opLabel(op, t)}</option>)}
            </select>
            {rule.op === 'empty' ? <span /> : type === 'boolean' ? (
              <select aria-label={t.filterValue} value={rule.value || 'true'} onChange={event => change(index, { value: event.target.value })}>
                <option value="true">{t.yes}</option>
                <option value="false">{t.no}</option>
              </select>
            ) : (
              <input aria-label={t.filterValue} placeholder={t.filterValue} inputMode={type === 'number' ? 'decimal' : undefined} value={rule.value}
                onChange={event => change(index, { value: event.target.value })} />
            )}
            <button type="button" className={css.iconGhost} aria-label={t.removeFilter} onClick={() => setDraft(current => current.filter((_, at) => at !== index))}>
              <IconCloseOutlineRegular size={13} />
            </button>
          </div>
        )
      })}
      <div className={css.dataFilterFoot}>
        <button type="button" className={css.dataLink} onClick={() => setDraft(current => [...current, blank()])}><IconPlusOutlineRegular size={12} />{t.addFilter}</button>
        <span>
          <Button variant="outline" type="button" onClick={() => apply([])}>{t.clearFilters}</Button>
          <Button variant="primary" type="submit">{t.applyFilters}</Button>
        </span>
      </div>
    </form>
  )
}

const inputOf = (value: DataValue | undefined, type: DataFieldType) =>
  value === undefined || value === null ? '' : type === 'json' ? JSON.stringify(value, null, 2) : String(value)

/** Add, edit or delete one record. A changed field is sent alone, with the record's version, so a newer edit elsewhere is not overwritten. */
function RecordSheet({ appId, collection, fields, record, t, close, saved }: {
  appId: string; collection: string; fields: Fields; record: DataRecord | null; t: DataLabels; close(): void; saved(counted: boolean): void
}) {
  const initial = Object.fromEntries(fields.map(([name, type]) => [name, inputOf(record?.[name], type)]))
  const [draft, setDraft] = useState<Record<string, string>>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const dirty = fields.some(([name]) => draft[name] !== initial[name])
  const dismiss = () => { if (!busy) close() }
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [busy])
  const send = async (statement: unknown, counted: boolean) => {
    setBusy(true)
    setError('')
    try {
      await request(`/data/apps/${appId}/run`, { method: 'POST', body: JSON.stringify(statement) })
      saved(counted)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.loadFailed)
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const values: Record<string, DataValue> = {}
    for (const [name, type] of fields) {
      const text = draft[name] ?? ''
      if (text === initial[name]) continue
      if (text.trim() === '') {
        // An emptied field is removed; a new record simply omits it.
        if (record) values[name] = null
        continue
      }
      if (type === 'number') {
        const number = Number(text)
        if (!Number.isFinite(number)) return setError(format(t.invalidNumber, { name }))
        values[name] = number
      } else if (type === 'boolean') values[name] = text === 'true'
      else if (type === 'json') {
        try {
          values[name] = JSON.parse(text) as DataValue
        } catch (_error) {
          return setError(format(t.invalidJson, { name }))
        }
      } else values[name] = text
    }
    if (Object.keys(values).length === 0) return record ? close() : setError(t.emptyRecord)
    void send(record ? { update: collection, id: record.id, set: values, version: record.version } : { insert: collection, values }, !record)
  }
  const title = record ? String(fields.map(([name]) => record[name]).find(value => typeof value === 'string' && value !== '') ?? record.id) : t.newRecord
  return (
    <>
      <div className={css.dataSheetBackdrop} onClick={() => { if (!dirty) dismiss() }} />
      <aside className={css.dataSheet} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <small>{collection}</small>
            <strong>{title}</strong>
          </div>
          <button type="button" className={css.iconGhost} aria-label={t.close} disabled={busy} onClick={dismiss}><IconCloseOutlineRegular size={16} /></button>
        </header>
        <form onSubmit={submit}>
          <div className={css.dataSheetBody}>
            {fields.length === 0 && <p className={css.dataFaint}>{t.noFields}</p>}
            {fields.map(([name, type], index) => {
              const value = draft[name] ?? ''
              const set = (next: string) => setDraft(current => ({ ...current, [name]: next }))
              return (
                <label key={name} className={css.dataSheetField}>
                  <span><i className={css.dataGlyph}>{GLYPH[type]}</i>{name}</span>
                  {type === 'boolean' ? (
                    <select value={value} disabled={busy} onChange={event => set(event.target.value)}>
                      <option value="">{t.unset}</option>
                      <option value="true">{t.yes}</option>
                      <option value="false">{t.no}</option>
                    </select>
                  ) : type === 'json' || value.length > 60 || value.includes('\n') ? (
                    <textarea rows={type === 'json' ? 6 : 4} data-code={type === 'json' ? '' : undefined} value={value} disabled={busy} onChange={event => set(event.target.value)} />
                  ) : (
                    <input autoFocus={index === 0 && !record} inputMode={type === 'number' ? 'decimal' : undefined} value={value} disabled={busy} onChange={event => set(event.target.value)} />
                  )}
                </label>
              )
            })}
            {record && (
              <p className={css.dataSheetMeta}>
                id <code>{record.id}</code><br />
                {t.createdAt} {new Date(record.createdAt).toLocaleString()} · {t.updatedAt} {new Date(record.updatedAt).toLocaleString()} · v{record.version}
              </p>
            )}
            <FormError message={error} />
          </div>
          <footer>
            {record && (confirming ? (
              <Button variant="outline" type="button" className={css.dataDangerButton!} disabled={busy}
                onClick={() => void send({ delete: collection, id: record.id, version: record.version }, true)}>{t.confirmDelete}</Button>
            ) : (
              <button type="button" className={css.dataLink} data-danger disabled={busy} onClick={() => setConfirming(true)}>{t.deleteRecord}</button>
            ))}
            <span />
            <Button variant="outline" type="button" disabled={busy} onClick={dismiss}>{t.cancel}</Button>
            <Button variant="primary" type="submit" disabled={busy || (record !== null && !dirty)}>{t.save}</Button>
          </footer>
        </form>
      </aside>
    </>
  )
}
