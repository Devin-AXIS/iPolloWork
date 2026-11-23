import { FormButton, FormSelect, SegmentedControl, TextInput } from '../../../_shared/ui/controls.tsx'
import { MarketAdd } from './market-add.tsx'
/** Native plugin-page tab. Installation and component management stay with DSH. */
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { PluginArtworkDefault } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketEntry, MarketItem, MarketState } from '../shared/types.ts'
import type { Labels } from './locale.ts'
import type { MarketProps } from './native.ts'
import { installPending, type MarketInstallation } from './market-installation.ts'
import css from './suite.module.css'

export interface MarketPanelProps extends MarketProps {
  useLabels<T>(selector: (value: Labels) => T): T
  load(signal: AbortSignal): Promise<MarketState>
  installation: MarketInstallation
  discover?(source: string): Promise<MarketEntry[]>
  add?(entry: MarketEntry): Promise<void>
}

export function MarketPanel({ useLabels, load, installation, openPackage, update: nativeUpdate, add, discover }: MarketPanelProps) {
  const t = useLabels(value => value)
  const { task, revision } = useSyncExternalStore(installation.subscribe, installation.getSnapshot)
  const [catalog, setCatalog] = useState<{ data: MarketState; revision: number } | null>(null)
  const data = catalog?.data
  const [error, setError] = useState(false)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [enterprise, setEnterprise] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const selected = data?.items.find(item => item.name === selectedName)
  const detailTitle = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef<string | null>(null)
  const cardButtons = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    window.addEventListener('focus', installation.invalidate)
    return () => window.removeEventListener('focus', installation.invalidate)
  }, [installation])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    void load(controller.signal).then(value => {
      if (controller.signal.aborted) return
      setCatalog({ data: value, revision })
      setLoading(false)
    }).catch(() => {
      if (controller.signal.aborted) return
      setLoading(false)
      setError(true)
    })
    return () => controller.abort()
  }, [load, revision, t])
  useEffect(() => {
    if (selected) detailTitle.current?.focus()
    else if (returnFocus.current) cardButtons.current.get(returnFocus.current)?.focus()
  }, [selected?.name])
  const items = data?.items.filter(item => (!category || item.category === category)
    && `${item.title} ${item.name} ${item.description} ${item.author}`.toLowerCase().includes(query.toLowerCase())) ?? []
  const available = (item: MarketItem) => item.installed || item.providedByDsh
  const action = (item: MarketItem) => {
    const currentTask = task?.target.name === item.name ? task : null
    const pending = currentTask && installPending(currentTask.phase)
    const unconfirmed = currentTask?.phase === 'unconfirmed'
    const completed = currentTask?.phase === 'done' && (catalog?.revision ?? 0) < (currentTask.completedRevision ?? 0)
    const installed = available(item)
    const update = item.update !== undefined
    const otherInstallPending = task && task !== currentTask && (installPending(task.phase) || task.phase === 'unconfirmed')
    return {
      label: pending ? (update ? t.marketUpdating : t.installing) : unconfirmed ? t.installView
        : completed ? (update ? t.marketUpdated : t.installed) : update ? t.marketUpdate
          : installed ? t.manage : item.compatible ? t.install : t.incompatible,
      disabled: !pending && !unconfirmed && (completed || ((!installed || update) && (!item.compatible || Boolean(otherInstallPending)))),
      onClick: () => {
        if (pending || unconfirmed) installation.show()
        else if (item.update === 'git') nativeUpdate({ packageName: item.name, version: item.version, spec: item.spec })
        else if (item.update === 'archive' || !installed) installation.start(item)
        else openPackage(item.name)
      },
    }
  }

  return <section className={css.page} aria-busy={loading} {...selected ? { 'data-ipw-market-detail': '' } : {}}>
    {error && <p role="alert" className={css.error}>{t.error} <button className={css.back} onClick={installation.invalidate}>{t.retry}</button></p>}
    {selected ? <PluginDetailPage item={selected} t={t} titleRef={detailTitle}
      onBack={() => setSelectedName(null)} action={action(selected)} onOpenComponents={() => openPackage(selected.name)}/>
      : <>
      <div className={css.heading}>
        <div><h1>{t.market}</h1><p>{t.intro}</p></div>
        <div className={css.marketAdminActions}>
          <FormButton variant="outline" onClick={installation.invalidate} disabled={loading}>{t.refresh}</FormButton>
          {data?.canManage && !enterprise && add && discover && <FormButton variant="primary" onClick={() => setAdding(true)}>{t.marketAdd}</FormButton>}
        </div>
      </div>
      <div className={css.toolbar}>
        <SegmentedControl label={t.market} value={enterprise ? 'enterprise' : 'public'}
          options={[{id: 'public', label: t.public}, {id: 'enterprise', label: t.enterprise}]}
          change={section => setEnterprise(section === 'enterprise')}/>
        {!enterprise && <div className={css.filters}>
          <TextInput className={css.search!} type="search" placeholder={t.search} aria-label={t.search} value={query} onChange={event => setQuery(event.target.value)}/>
          <FormSelect aria-label={t.all} value={category} onChange={event => setCategory(event.target.value)}><option value="">{t.all}</option>{data?.categories.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</FormSelect>
        </div>}
      </div>
      {enterprise ? <p className={css.empty}>{t.enterpriseEmpty}</p> : loading && !data ? <div role="status" className={css.skeletonList}>
        <span className={css.srOnly}>{t.loading}</span>
        {[0, 1, 2].map(key => <div className={css.skeletonRow} key={key} aria-hidden="true"><span/><div><span/><span/></div></div>)}
      </div> : <div className={css.pluginList}>
        {items.map(item => <article className={css.card} key={item.name}>
          <button className={css.cardBody} ref={element => { if (element) cardButtons.current.set(item.name, element); else cardButtons.current.delete(item.name) }} onClick={() => { if (available(item)) openPackage(item.name); else { returnFocus.current = item.name; setSelectedName(item.name) } }} aria-label={`${t.details} · ${item.title}`}>
            <Icon item={item}/>
            <div className={css.cardCopy}>
              <div className={css.titleRow}><h2>{item.title}</h2><span className={css.version}>{item.version}</span></div>
              <p className={css.cardDescription}>{item.description}</p>
              <div className={css.cardMeta}><span>{item.author}</span><span aria-hidden="true">·</span><span>{item.categoryTitle}</span>{available(item) && <><span aria-hidden="true">·</span><span>{item.enabled ? t.enabled : t.disabled}</span></>}</div>
            </div>
          </button>
          <InstallButton action={action(item)} secondary={available(item)}/>
        </article>)}
        {!items.length && !error && <p className={css.empty}>{t.empty}</p>}
      </div>}
    </>}
    {adding && data?.canManage && add && discover && <MarketAdd t={t} discover={discover} close={() => setAdding(false)} save={async entry => { await add(entry); installation.invalidate() }}/>}
  </section>
}

interface InstallAction { label: string; disabled: boolean; onClick(): void }

function InstallButton({ action, secondary = false }: { action: InstallAction; secondary?: boolean }) {
  return <button type="button" className={secondary ? css.secondary : css.primary}
    disabled={action.disabled} onClick={action.onClick}>{action.label}</button>
}

/** One detail template for every catalog entry; installed bundles open DSH's native page. */
function PluginDetailPage({ item, t, titleRef, onBack, action, onOpenComponents }: {
  item: MarketItem; t: Labels; titleRef: RefObject<HTMLHeadingElement>;
  onBack(): void; action: InstallAction; onOpenComponents(): void;
}) {
  const available = (value: MarketItem) => value.installed || value.providedByDsh
  const status = (value: MarketItem) => value.providedByDsh ? t.provided : value.installed ? t.installed : !value.compatible ? t.incompatible : value.categoryTitle
  return <>
      <div className={css.detailTop} data-window-drag>
        <button className={css.back} onClick={() => onBack()}><span aria-hidden="true">←</span> {t.back}</button>
      </div>
      <div className={css.detailHeader}>
        <Icon item={item} large/>
        <InstallButton action={action}/>
      </div>
      <div className={css.detailHeading}>
        <div className={css.titleRow}><h1 ref={titleRef} tabIndex={-1}>{item.title}</h1><span className={css.badge}>{item.version}</span>{(available(item) || !item.compatible) && <span className={css.badge}>{status(item)}</span>}</div>
        <p className={css.detailDescription}>{item.description}</p>
      </div>
      {!item.compatible && <p role="status" className={css.error}>{t.incompatibleHint}</p>}
      <div className={css.detailColumns}>
        <section className={css.resources} aria-labelledby="ipw-market-resources">
          <h2 id="ipw-market-resources">{t.resources}</h2>
          {item.resources.length ? <ul className={css.resourceList}>{item.resources.map(resource => <li key={resource}><code>{resource}</code><span className={css.badge}>{t.component}</span></li>)}</ul>
            : <p className={css.resourceNote}>{available(item) ? t.noResources : t.resourceHint}</p>}
          {available(item) && <button className={css.textAction} onClick={() => onOpenComponents()}>{t.nativeDetails} <span aria-hidden="true">→</span></button>}
        </section>
        <section className={css.pluginInfo} aria-labelledby="ipw-market-information">
          <h2 id="ipw-market-information">{t.information}</h2>
          <dl>
            <div><dt>{t.author}</dt><dd>{item.author}</dd></div>
            <div><dt>{t.category}</dt><dd>{item.categoryTitle}</dd></div>
            <div><dt>{t.version}</dt><dd>{item.version}</dd></div>
            <div><dt>{t.requires}</dt><dd>{item.requirement ?? t.anyVersion}</dd></div>
            <div className={css.packageInfo}><dt>{t.packageName}</dt><dd><code>{item.name}</code></dd></div>
          </dl>
          {item.homepage && <a className={css.link} href={item.homepage} target="_blank" rel="noreferrer">{t.homepage} <span aria-hidden="true">↗</span></a>}
        </section>
      </div>
  </>
}

function Icon({ item, large = false }: { item: MarketItem; large?: boolean }) {
  const [failed, setFailed] = useState<string>()
  return <span className={`${css.icon}${large ? ` ${css.largeIcon}` : ''}`}>{item.icon && item.icon !== failed ? <img src={item.icon} alt="" loading="lazy" onError={() => setFailed(item.icon!)}/> : <PluginArtworkDefault size={36}/>}</span>
}
