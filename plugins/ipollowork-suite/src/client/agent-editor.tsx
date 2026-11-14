/** Focused bot creation with optional, existing capabilities. */
import { useEffect, useId, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentItem, AgentService, AgentModelChoice, AgentModelOption } from '../shared/agents.ts'
import type { AgentLabels } from './agent-locale.ts'
import css from './suite.module.css'
import { AvatarPicker } from './agent-avatar.tsx'

export interface AgentDraft {
  id?: string; revision?: number; name: string; description: string; prompt: string;
  enabled: boolean; skillNames: string[]; serviceNames: string[]; mcp: AgentItem['mcp'];
  avatar: string;
  model: AgentModelChoice | null;
}
export const newDraft = (): AgentDraft => ({ name: '', description: '', prompt: '', avatar: '', model: null, enabled: true, skillNames: [], serviceNames: [], mcp: [] })
export function draftFrom(item: AgentItem, services: AgentService[]): AgentDraft {
  return { ...item, avatar: item.avatar ?? '', model: item.model ?? null, skillNames: item.skills.map(skill => skill.name), serviceNames: item.serviceNames ?? services.map(service => service.name) }
}
interface Props {
  t: AgentLabels; draft: AgentDraft; busy: boolean; error: string; services: AgentService[];
  skills: { name: string; description: string }[]; onChange: Dispatch<SetStateAction<AgentDraft>>;
  onClose(): void; onSave(): void; onRefresh(): void;
  models: AgentModelOption[]; modelsUnavailable: boolean;
}
const modelKey = (model: AgentModelChoice | null) => model ? JSON.stringify([model.provider, model.model]) : ''
export function AgentEditor({ t, draft, busy, error, services, skills, models, modelsUnavailable, onChange, onClose, onSave, onRefresh }: Props) {
  const formId = useId()
  const [skillSearch, setSkillSearch] = useState('')
  const [extra, setExtra] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const change = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => onChange(current => ({ ...current, [key]: value }))
  const toggle = (key: 'skillNames' | 'serviceNames', value: string, checked: boolean) => change(key, checked ? [...draft[key], value] : draft[key].filter(item => item !== value))
  const options = skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(skillSearch.toLowerCase()))
  useEffect(() => { setSkillSearch(''); setExtra(false) }, [draft.id])
  const example = (kind: 'research' | 'writing' | 'review') => onChange({ ...draft, name: t[`${kind}Name`], prompt: t[`${kind}Prompt`] })
  return <Modal open title={draft.id ? t.editTitle : t.createTitle} closeLabel={t.close} onClose={() => { if (!busy) onClose() }} className={`${css.page} ${css.agentDialog}`} contentClassName={css.agentDialogContent!} description={t.basicsHint}
    footer={<><button className={css.secondary} disabled={busy} onClick={onClose}>{t.cancel}</button><button className={css.primary} form={formId} type="submit" disabled={busy || avatarBusy || !draft.name.trim()}>{busy ? t.working : t.save}</button></>}>
    <form id={formId} className={css.agentFields} onSubmit={event => { event.preventDefault(); if (!avatarBusy && !busy) onSave() }}>
      <AvatarPicker name={draft.name} value={draft.avatar} disabled={busy} t={t} onProcessing={setAvatarBusy} onChange={avatar => onChange(current => ({ ...current, avatar }))} />
      {!draft.id && <div className={css.agentExamples}><span>{t.examples}</span>{(['research', 'writing', 'review'] as const).map(kind => <button type="button" className={css.secondary} key={kind} disabled={busy} onClick={() => example(kind)}>{t[kind]}</button>)}</div>}
      <label>{t.name}<input required maxLength={100} placeholder={t.nameHint} value={draft.name} disabled={busy} onChange={event => change('name', event.target.value)} /></label>
      <label>{t.prompt}<textarea rows={5} placeholder={t.promptHint} value={draft.prompt} disabled={busy} maxLength={32000} onChange={event => change('prompt', event.target.value)} /></label>
      <label>{t.model}<select aria-label={t.model} value={modelKey(draft.model)} disabled={busy} onChange={event => {
        const selected = models.find(model => modelKey(model) === event.target.value)
        change('model', selected ? { provider: selected.provider, model: selected.model } : null)
      }}><option value="">{t.followModel}</option>{draft.model && !models.some(model => modelKey(model) === modelKey(draft.model)) && <option value={modelKey(draft.model)}>{draft.model.model} · {t.unavailable}</option>}{models.map(model => <option key={modelKey(model)} value={modelKey(model)}>{model.providerName} · {model.name}</option>)}</select><small className={css.muted}>{draft.model ? t.fixedModelHint : t.followModelHint}</small>{modelsUnavailable && <small className={css.muted}>{t.modelsUnavailable}</small>}</label>
      <details className={css.agentCapability}><summary><span>{t.skills}</span><span>{draft.skillNames.length ? `${draft.skillNames.length} ${t.selected}` : t.optional}</span></summary>
        <p className={css.muted}>{t.skillsHint}</p><input type="search" aria-label={t.searchSkills} placeholder={t.searchSkills} value={skillSearch} onChange={event => setSkillSearch(event.target.value)} />
        <div className={css.agentOptions}>{options.map(skill => <label key={skill.name} className={css.agentCheck} title={skill.description}><input type="checkbox" checked={draft.skillNames.includes(skill.name)} disabled={busy} onChange={event => toggle('skillNames', skill.name, event.target.checked)} /><span>{skill.name}<small>{skill.description}</small></span></label>)}{!options.length && <p className={css.muted}>{t.noSkills}</p>}</div>
      </details>
      <details className={css.agentCapability}><summary><span>{t.services}</span><span>{draft.serviceNames.length ? `${draft.serviceNames.length} ${t.selected}` : t.optional}</span></summary>
        <p className={css.muted}>{t.servicesHint}</p><div className={css.agentOptions}>{services.map(service => <label key={service.name} className={css.agentCheck}><input type="checkbox" checked={draft.serviceNames.includes(service.name)} disabled={busy} onChange={event => toggle('serviceNames', service.name, event.target.checked)} /><span>{service.name}<small>{service.state === 'connected' ? t.connected : t.unavailable}</small></span></label>)}</div>
        {!services.length && <p>{t.noServices}<br /><span className={css.muted}>{t.serviceSetup}</span></p>}
        {draft.serviceNames.filter(name => !services.some(service => service.name === name)).map(name => <label key={name} className={css.agentCheck}><input type="checkbox" checked disabled={busy} onChange={() => toggle('serviceNames', name, false)} /><span>{name}<small>{t.unavailable}</small></span></label>)}
        <button type="button" className={css.textAction} disabled={busy} onClick={onRefresh}>{t.refresh}</button>
        {draft.mcp.length > 0 && <p className={css.muted}>{t.legacy}</p>}
      </details>
      <button className={css.textAction} type="button" aria-expanded={extra} onClick={() => setExtra(!extra)}>{t.more}</button>
      {extra && <><label>{t.description} · {t.optional}<input maxLength={1000} value={draft.description} disabled={busy} onChange={event => change('description', event.target.value)} /></label><label className={css.agentCheck}><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => change('enabled', event.target.checked)} />{t.enabled}</label></>}
      {error && <p className={css.error} role="alert">{error}</p>}
    </form>
  </Modal>
}
