import { FormButton, FormSelect, TextArea, TextInput } from "../../../_shared/ui/controls.tsx"
import { useId, useState, type FormEvent } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketEntry } from '../shared/types.ts'
import type { Labels } from './locale.ts'
import css from './suite.module.css'

/** Source-first import. DSH reads metadata; the administrator previews before publishing. */
export function MarketAdd({ t, discover, save, close }: {
  t: Labels; discover(source: string): Promise<MarketEntry[]>; save(entry: MarketEntry): Promise<void>; close(): void;
}) {
  const formId = useId()
  const [source, setSource] = useState('')
  const [entries, setEntries] = useState<MarketEntry[]>([])
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const entry = entries[selected]
  const fail = (cause: unknown) => {
    const code = cause instanceof Error ? cause.message : ''
    setError(code === 'MARKET_DUPLICATE' ? t.marketDuplicate
      : code === 'ADMIN_REQUIRED' || code === 'IPW_SIGN_IN_REQUIRED' ? t.marketPermission
      : code === 'MARKET_NO_COMPATIBLE_PLUGIN' ? t.marketNoPlugin
      : code === 'MARKET_INVALID_SOURCE' ? t.marketInvalidSource
      : code === 'MARKET_LOOKUP_FAILED' ? t.marketLookupFailed : t.marketSaveFailed)
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      if (!entry) { setEntries(await discover(source)); setSelected(0) }
      else { await save(entry); close() }
    } catch (cause) { fail(cause) }
    finally { setBusy(false) }
  }
  const update = (patch: Partial<MarketEntry>) => setEntries(items => items.map((item, index) => index === selected ? { ...item, ...patch } : item))
  return <Modal open title={t.marketAdd} description={t.marketImportHint} closeLabel={t.cancel}
    className={`${css.page} ${css.marketDialog}`} contentClassName={css.marketDialogContent!}
    onClose={() => { if (!busy) close() }} footer={<>
      <FormButton variant="outline" disabled={busy} onClick={close}>{t.cancel}</FormButton>
      <FormButton variant="primary" type="submit" form={formId} disabled={busy || (!entry && !source.trim())}>
        {busy ? entry ? t.marketSaving : t.marketReading : entry ? t.marketPublish : t.marketRead}
      </FormButton>
    </>}>
    <form id={formId} className={css.marketForm} onSubmit={event => void submit(event)}>
      {!entry ? <label>{t.marketAddress}<TextInput autoFocus value={source} onChange={event => { setSource(event.target.value); setError('') }} required disabled={busy}
        placeholder="https://github.com/author/plugin 或 @scope/package" autoCapitalize="none" spellCheck={false} maxLength={2048}/></label> : <>
        <div className={css.marketImportSource}><span>{source}</span><button type="button" className={css.back} disabled={busy} onClick={() => { setEntries([]); setError('') }}>{t.marketChangeSource}</button></div>
        {entries.length > 1 && <label>{t.marketChoosePlugin}<FormSelect value={selected} disabled={busy} onChange={event => setSelected(Number(event.target.value))}>
          {entries.map((item, index) => <option key={item.name} value={index}>{item.title} · {item.name}</option>)}
        </FormSelect></label>}
        <div className={css.marketImportPreview}>
          {entry.icon && <img src={entry.icon} alt="" width={40} height={40}/>}<h2>{entry.title}</h2><p>{entry.description || t.marketNoDescription}</p>
          <div className={css.cardMeta}><span>{entry.name}</span><span>{entry.versions[0].version}</span>{entry.author && <span>{entry.author}</span>}</div>
        </div>
        <details><summary>{t.marketAdvanced}</summary><fieldset disabled={busy}>
          <label>{t.marketTitle}<TextInput value={entry.title} onChange={event => update({ title: event.target.value })} required maxLength={100}/></label>
          <label>{t.category}<FormSelect value={entry.metadata.category} onChange={event => update({ metadata: { category: event.target.value as MarketEntry['metadata']['category'] } })}>
            <option value="productivity">{t.marketProductivity}</option><option value="communication">{t.marketCommunication}</option><option value="creative">{t.marketCreative}</option>
          </FormSelect></label>
          <label className={css.marketWide}>{t.marketDescription}<TextArea value={entry.description ?? ''} onChange={event => update({ description: event.target.value })} maxLength={2000} rows={3}/></label>
          {entry.versions[0].source.type === 'npm' && <label className={css.marketWide}>{t.marketRegistry}<TextInput type="url" value={entry.versions[0].source.registry ?? ''} placeholder="https://registry.npmjs.org" onChange={event => {
            const version = entry.versions[0], registry = event.target.value.trim()
            update({ versions: [{ ...version, source: { type: 'npm', ...(registry ? { registry } : {}) } }] })
          }}/></label>}
        </fieldset></details>
      </>}
      {error && <p role="alert" className={css.error}>{error}</p>}
    </form>
  </Modal>
}
