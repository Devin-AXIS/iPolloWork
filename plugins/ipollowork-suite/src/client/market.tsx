/** Native plugin-page tab. Installation and component management stay with DSH. */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { PluginArtworkDefault } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketItem, MarketState } from '../shared/types.ts'
import type { Labels } from './locale.ts'
import type { MarketProps } from './native.ts'
import css from './suite.module.css'

export interface MarketPanelProps extends MarketProps {
  useLabels<T>(selector: (value: Labels) => T): T
  load(signal: AbortSignal): Promise<MarketState>
  subscribeChanges(listener: () => void): () => void
}

export function MarketPanel({ useLabels, load, subscribeChanges, install, openPackage }: MarketPanelProps) {
  const t = useLabels(value => value)
  const [data, setData] = useState<MarketState | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [enterprise, setEnterprise] = useState(false)
  const [selected, setSelected] = useState<MarketItem | null>(null)
  const [revision, refresh] = useState(0)
  const detailTitle = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef<string | null>(null)
  const cardButtons = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => subscribeChanges(() => refresh(value => value + 1)), [subscribeChanges])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    void load(controller.signal).then(value => {
      if (controller.signal.aborted) return
      setData(value)
      setLoading(false)
      setSelected(previous => previous ? value.items.find(item => item.name === previous.name) ?? null : null)
    }).catch(() => {
      if (controller.signal.aborted) return
      setLoading(false)
      setError(true)
    })
    return () => controller.abort()
  }, [load, revision])
  useEffect(() => {
    if (selected) detailTitle.current?.focus()
    else if (returnFocus.current) cardButtons.current.get(returnFocus.current)?.focus()
  }, [selected?.name])
  const items = data?.items.filter(item => (!category || item.category === category)
    && `${item.title} ${item.name} ${item.description} ${item.author}`.toLowerCase().includes(query.toLowerCase())) ?? []
  const available = (item: MarketItem) => item.installed || item.providedByDsh
  const action = (item: MarketItem) => available(item) ? openPackage(item.name)
    : install({ spec: item.spec, title: item.title, version: item.version, ...(item.registry ? { registry: item.registry } : {}) })

  return <section className={css.page} aria-busy={loading} {...selected ? { 'data-ipw-market-detail': '' } : {}}>
    {error && <p role="alert" className={css.error}>{t.error} <button className={css.back} onClick={() => refresh(value => value + 1)}>{t.retry}</button></p>}
    {selected ? <PluginDetailPage item={selected} t={t} titleRef={detailTitle}
      onBack={() => setSelected(null)} onAction={() => action(selected)} onOpenComponents={() => openPackage(selected.name)}/>
      : <>
      <div className={css.heading}><div><h1>{t.market}</h1><p>{t.intro}</p></div><button className={css.secondary} onClick={() => refresh(value => value + 1)} disabled={loading}>{t.refresh}</button></div>
      <div className={css.toolbar}>
        <div className={css.segmented} role="group" aria-label={t.market}>
          <button aria-pressed={!enterprise} onClick={() => setEnterprise(false)}>{t.public}</button><button aria-pressed={enterprise} onClick={() => setEnterprise(true)}>{t.enterprise}</button>
        </div>
        {!enterprise && <div className={css.filters}>
          <input className={css.search} type="search" placeholder={t.search} aria-label={t.search} value={query} onChange={event => setQuery(event.target.value)}/>
          <select aria-label={t.all} value={category} onChange={event => setCategory(event.target.value)}><option value="">{t.all}</option>{data?.categories.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        </div>}
      </div>
      {enterprise ? <p className={css.empty}>{t.enterpriseEmpty}</p> : loading && !data ? <div role="status" className={css.skeletonList}>
        <span className={css.srOnly}>{t.loading}</span>
        {[0, 1, 2].map(key => <div className={css.skeletonRow} key={key} aria-hidden="true"><span/><div><span/><span/></div></div>)}
      </div> : <div className={css.pluginList}>
        {items.map(item => <article className={css.card} key={item.name}>
          <button className={css.cardBody} ref={element => { if (element) cardButtons.current.set(item.name, element); else cardButtons.current.delete(item.name) }} onClick={() => { if (available(item)) openPackage(item.name); else { returnFocus.current = item.name; setSelected(item) } }} aria-label={`${t.details} · ${item.title}`}>
            <Icon item={item}/>
            <div className={css.cardCopy}>
              <div className={css.titleRow}><h2>{item.title}</h2><span className={css.version}>{item.version}</span></div>
              <p className={css.cardDescription}>{item.description}</p>
              <div className={css.cardMeta}><span>{item.author}</span><span aria-hidden="true">·</span><span>{item.categoryTitle}</span>{available(item) && <><span aria-hidden="true">·</span><span>{item.enabled ? t.enabled : t.disabled}</span></>}</div>
            </div>
          </button>
          <button className={available(item) ? css.secondary : css.primary} disabled={!available(item) && !item.compatible} onClick={() => action(item)}>{available(item) ? t.manage : item.compatible ? t.install : t.incompatible}</button>
        </article>)}
        {!items.length && !error && <p className={css.empty}>{t.empty}</p>}
      </div>}
    </>}
  </section>
}

/** One detail template for every catalog entry; installed bundles open DSH's native page. */
function PluginDetailPage({ item, t, titleRef, onBack, onAction, onOpenComponents }: {
  item: MarketItem; t: Labels; titleRef: RefObject<HTMLHeadingElement>;
  onBack(): void; onAction(): void; onOpenComponents(): void;
}) {
  const available = (value: MarketItem) => value.installed || value.providedByDsh
  const status = (value: MarketItem) => value.providedByDsh ? t.provided : value.installed ? t.installed : !value.compatible ? t.incompatible : value.categoryTitle
  return <>
      <div className={css.detailTop} data-window-drag>
        <button className={css.back} onClick={() => onBack()}><span aria-hidden="true">←</span> {t.back}</button>
      </div>
      <div className={css.detailHeader}>
        <Icon item={item} large/>
        <button className={css.primary} disabled={!available(item) && !item.compatible} onClick={() => onAction()}>{available(item) ? t.manage : t.install}</button>
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
