import { useEffect, useRef, useState } from 'react';
import { IconLinkOutlineRegular, IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { ChoiceIcon, ChoicePicker, type Choice } from './ui.tsx';
import { agentKey, type BoardAgent, type ProjectTask, type TaskDraft, type TaskWrite } from '../../../services/ipollowork/src/project-board-contract.ts';
import { errorMessage, type Copy } from './copy.ts';
import { displayAgent, statuses, taskCollaborators, taskDefaults, updateCollaborator,
  type AgentChoice, type AgentPlan, type Card, type ProjectRoster } from './model.ts';

import { FormButton, OptionMenu, TextArea, TextInput } from '../../_shared/ui/controls.tsx';
import { CalendarDays, Clock3, lineStroke, X } from '../../_shared/ui/icons.ts';
import { ScheduleRangeField } from '../../_shared/ui/date-time-field.tsx';

const priorities = ['normal','high','urgent'] as const;

function durationParts(totalMinutes: number, t: Copy): string[] {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  return [
    days ? days + t.day : '',
    hours ? hours + t.hour : '',
    minutes || totalMinutes === 0 ? minutes + t.minute : '',
  ].filter(Boolean);
}

export function countdown(dueAt: number | null, t: Copy, now: number) {
  if (dueAt === null) return t.unscheduled;
  const minutes = Math.ceil((dueAt-now)/60_000);
  if (minutes<=0) return t.overdue;
  return t.remaining + ' ' + durationParts(minutes, t).slice(0, 2).join(' ');
}
export function aiInstruction(id: string, t: Copy, plan?: AgentPlan) {
  const instructions = t.aiWork.replace('{id}', id);
  if (!plan) return instructions;
  const presets = plan.delegates.map(agent => agent.preset);
  return [
    instructions,
    ...(presets.length ? [t.aiPresets.replace('{presets}', JSON.stringify(presets))] : []),
    ...(plan.external.length ? [t.aiExternal.replace('{tools}', JSON.stringify(plan.external))] : []),
  ].join('\n');
}
export function TaskEditor({ card, roster, agents, refreshAgents, tasks, writable, t, locale, clock, initialStatus, projectTitle, close, save, open, sessions, delegate, report, conversation }: {
  card: Card | undefined; roster: ProjectRoster | null | undefined; agents: readonly AgentChoice[]; tasks: readonly ProjectTask[]; writable: boolean; t: Copy; locale: string;
  clock: number; projectTitle: string; initialStatus: TaskDraft['status'] | undefined; sessions: readonly string[];
  close(): void; save(input:TaskWrite):Promise<void>; open(sessionId:string):void; delegate(taskId:string):Promise<void>; report(error: unknown):void;
  refreshAgents(): void;
  conversation?: { title: string; grant(userIds: string[], signal: AbortSignal): Promise<{ link: string }> } | undefined;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const title=useRef<HTMLInputElement>(null);
  const creating=!card;
  const [id]=useState(()=>card?.task?.id ?? crypto.randomUUID());
  const [initial]=useState<TaskDraft>(() => {
    const base = taskDefaults(card,roster);
    return initialStatus ? { ...base, status:initialStatus } : base;
  });
  const [draft,setDraft]=useState(initial);
  const changed=!card?.task || JSON.stringify(draft)!==JSON.stringify(initial);
  const hasAI=Boolean(draft.assigneeAgent || draft.participantAgents?.length);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>();
  const [copied,setCopied]=useState(false);
  const [granting,setGranting]=useState(false);
  const [shared,setShared]=useState<{link:string; selected:string}>();
  const [linkCopied,setLinkCopied]=useState(false);
  const shareRequest=useRef<AbortController>(null);
  const waiting=draft.predecessorIds.some(id=>{
    const predecessor=tasks.find(task=>task.id===id);
    return predecessor ? predecessor.status!=='done' : Boolean(card?.task?.blocked);
  });
  useEffect(()=>{
    const element=dialog.current;
    element?.showModal();
    if (creating) title.current?.focus();
    return ()=>element?.close();
  },[creating]);
  useEffect(()=>()=>shareRequest.current?.abort(),[]);
  function dismiss() {
    dialog.current?.close();
    close();
  }
  function field<K extends keyof TaskDraft>(key:K,value:TaskDraft[K]) {setDraft(current=>({...current,[key]:value}));}
  const aiOptions = agents.map(({ id, name }): BoardAgent => ({ id, name, ownerId: roster?.viewerId ?? null }));
  const { lead, members } = taskCollaborators(draft);
  const people = roster?.members ?? [];
  const humanIds = new Set(people.map(person => person.userId));
  const savedPeople = new Set([...(draft.assigneeId ? [draft.assigneeId] : []), ...draft.participantIds]);
  const selectedMembers = people.filter(person => person.userId !== roster?.viewerId && savedPeople.has(person.userId));
  const selected = selectedMembers.map(person => person.userId).sort().join(',');
  const recipients = selectedMembers.filter(person => !person.canViewConversation).map(person => person.userId);
  const sharedLink = shared && shared.selected === selected ? shared.link : undefined;
  const humanChoices: Choice[] = [
    ...people.map(person => ({
      id: 'person:'+person.userId, name: person.name, tag: t.memberTag, kind: 'person' as const,
      ...(person.email ? { hint: person.email } : {}), ...(person.avatar ? { avatar: person.avatar } : {}), canView: Boolean(person.canViewConversation),
    })),
    ...[...savedPeople].filter(person => !humanIds.has(person)).map(person =>
      ({ id: 'person:'+person, name: t.agentUnavailableShort, unavailable:true, kind: 'person' as const })),
  ];
  const activeAi = new Map(aiOptions.map(agent => [agentKey(agent), agent]));
  const knownAi = new Map([
    ...[...members.values()].filter(agent=>typeof agent!=='string').map(agent=>[agentKey(agent),agent] as const),
    ...activeAi,
  ]);
  const availableChoices = new Map(agents.map(agent=>[agent.id,agent]));
  const assignmentChoices: Choice[] = [
    ...humanChoices,
    ...[...knownAi].map(([key, agent]) => {
      const available = activeAi.has(key);
      const choice = available ? availableChoices.get(agent.id) : undefined;
      return {
        id: 'ai:'+key, name: displayAgent(agent, t.currentAI), avatarName: agent.name,
        tag: choice?.nativeTool ? t.nativeDelegate : agent.id === 'current' ? '' : t.aiGroup, kind: 'ai' as const,
        ...(choice?.avatar ? { avatar:choice.avatar } : {}), ...(!available ? { hint: t.agentUnavailableShort, unavailable: true } : {}),
      };
    }),
  ];
  const choicesById = new Map(assignmentChoices.map(choice=>[choice.id,choice]));
  const selectedChoices = [...members.keys()].flatMap(id => choicesById.get(id) ?? []);
  const dependencyChoices: Choice[] = tasks.filter(task => task.id !== id).map(task =>
    ({ id: task.id, name: task.title, hint: t[task.status], kind: 'task' }));
  const knownDependencies = new Set(dependencyChoices.map(task => task.id));
  for (const taskId of draft.predecessorIds) {
    if (!knownDependencies.has(taskId)) dependencyChoices.push({ id:taskId, name:t.predecessors, kind:'task' });
  }
  function changeCollaborator(id: string, action: 'toggle' | 'lead' = 'toggle') {
    const choice = choicesById.get(id);
    if (!choice || (choice.unavailable && (action === 'lead' || !members.has(id)))) return;
    const member = members.get(id) ?? (choice.kind === 'ai' ? activeAi.get(id.slice(3)) : id.slice(7));
    if (member) setDraft(current => updateCollaborator(current,member,action));
  }
  const ready = !waiting && draft.status !== 'done' && (draft.startAt ?? 0) <= clock;
  const autoStart = Boolean(draft.assigneeAgent && draft.status === 'todo' && draft.startAt !== null && draft.startAt > clock);
  async function submit(run = false) {
    if (shareRequest.current) return;
    if (draft.startAt!==null && draft.dueAt!==null && draft.startAt>draft.dueAt) {
      setError(new Error('invalid_note')); return;
    }
    setBusy(true);setError(undefined);
    try {
      await save({id,revision:card?.task?.revision ?? 0,task:draft});
      if (run) await delegate(id).catch(report);
      dismiss();
    }
    catch(error) {setError(error);}
    finally {setBusy(false);}
  }
  async function copyInstructions() {
    const instruction = t.scheduleInstructions + '\n' + aiInstruction(id,t);
    try {await navigator.clipboard.writeText(instruction);setCopied(true);}
    catch {setError(new Error('unavailable'));}
  }
  async function sendToAi() {
    setBusy(true);setError(undefined);
    try {await delegate(id);}
    catch(error) {setError(error);}
    finally {setBusy(false);}
  }
  async function grantConversation() {
    if (!conversation || !recipients.length || shareRequest.current) return;
    const controller = new AbortController();
    shareRequest.current = controller;
    setGranting(true); setError(undefined); setLinkCopied(false);
    try {
      const { link } = await conversation.grant(recipients,controller.signal);
      if (!controller.signal.aborted) setShared({link,selected});
    } catch {
      if (!controller.signal.aborted) setError(new Error('BOARD_SHARE_UNAVAILABLE'));
    } finally {
      shareRequest.current = null;
      if (!controller.signal.aborted) setGranting(false);
    }
  }
  async function copyConversation(link: string) {
    try { await navigator.clipboard.writeText(link); setLinkCopied(true); }
    catch { setError(new Error('unavailable')); }
  }
  const { startAt, dueAt } = draft;
  const duration = startAt !== null && dueAt !== null && dueAt >= startAt
    ? Math.round((dueAt - startAt) / 60_000) : null;
  const durationText = duration === null ? undefined : durationParts(duration, t).join(' ');
  const linkedSession = draft.sessionId && sessions.includes(draft.sessionId) ? draft.sessionId : null;
  return <dialog className="cb-dialog cb-sheet ipw-ui ipw-frosted" ref={dialog} aria-labelledby="cb-edit-title"
    onCancel={event => { event.preventDefault(); if (!busy && !granting) dismiss(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy && !granting && !changed) dismiss(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <header className="cb-dialog-head cb-sheet-head">
        <div>
          <h2 id="cb-edit-title">{card ? t.details : t.newTask}</h2>
          <span className="cb-sheet-project" title={projectTitle}>{projectTitle}</span>
        </div>
        <button type="button" aria-label={t.close} disabled={busy || granting} className="cb-icon cb-ghost" onClick={dismiss}>
          <X strokeWidth={lineStroke} size={19} aria-hidden="true" />
        </button>
      </header>
      <div className="cb-sheet-body">
        <fieldset className="cb-sheet-fields" disabled={busy || granting || !writable}>
          <div className="cb-sheet-identity">
            <label className="cb-title-field"><span className="cb-sr-only">{t.titleField}</span>
              <TextInput ref={title} value={draft.title} maxLength={160} required placeholder={t.taskPlaceholder}
                onChange={event => field('title',event.target.value)} />
            </label>
            <label className="cb-description-field"><span className="cb-label">{t.description}</span>
              <TextArea value={draft.description} rows={2} maxLength={8000} placeholder={t.optionalDescription}
                onChange={event => field('description',event.target.value)} />
            </label>
          </div>
          <div className="cb-property-pair" role="group" aria-label={t.editProperties}>
            <div className="cb-property">
              <span className="cb-label">{t.status}</span>
              <OptionMenu label={t.status} value={draft.status} change={value=>field('status',value)}
                choices={statuses.map(id=>({id,label:t[id],disabled:waiting && id!=='todo'}))} />
            </div>
            <div className="cb-property">
              <span className="cb-label">{t.priority}</span>
              <OptionMenu label={t.priority} value={draft.priority} change={value=>field('priority',value)}
                choices={priorities.map(id=>({id,label:t[id]}))} />
            </div>
          </div>
          <section className="cb-dates" aria-label={t.dates}>
            <h3 className="cb-section-title"><CalendarDays size={14} strokeWidth={lineStroke} aria-hidden="true" />{t.dates}</h3>
            <ScheduleRangeField
              start={{ dateLabel: t.start, timeLabel: t.startTime, timePlaceholder: t.timeFrom, value: startAt, change: value => field('startAt', value) }}
              end={{ dateLabel: t.due, timeLabel: t.dueTime, timePlaceholder: t.timeTo, value: dueAt, change: value => field('dueAt', value) }}
              clear={() => setDraft(current => ({ ...current, startAt: null, dueAt: null }))}
              duration={durationText} locale={locale} t={t} />
            {autoStart && <p className="cb-inline-note" role="status">{t.autoStart}</p>}
            {draft.dueAt!==null && draft.status!=='done' && <span className="cb-inline-note" data-overdue={draft.dueAt<=clock}>
              <Clock3 strokeWidth={lineStroke} size={14} aria-hidden="true" />{countdown(draft.dueAt,t,clock)}
            </span>}
          </section>
          <section className="cb-collaboration" aria-label={t.collaborators}>
            <ChoicePicker heading={t.collaborators} actions={[
              {kind:'person',label:t.participants,search:t.searchPeople,empty:t.noPeople},
              {kind:'ai',label:t.addAI,search:t.searchAI,onOpen:refreshAgents},
            ]} choices={assignmentChoices} selected={[...members.keys()]} choose={changeCollaborator} t={t} showChips={false} />
            {selectedChoices.length > 0 && <ul className="cb-collaborators">
              {selectedChoices.map(choice => {
                const isLead = lead === choice.id;
                const role = (isLead ? t.clearLead : t.makeLead) + ' · ' + choice.name;
                return <li key={choice.id}>
                  <ChoiceIcon choice={choice} />
                  <span className="cb-collaborator-name" title={choice.name}>{choice.name}</span>
                  <button type="button" className="cb-role" aria-label={role} aria-pressed={isLead}
                    disabled={choice.unavailable} onClick={()=>changeCollaborator(choice.id,'lead')}>{isLead ? t.lead : t.makeLead}</button>
                  <button type="button" className="cb-icon cb-ghost cb-remove-member" aria-label={t.removeChoice.replace('{name}',choice.name)}
                    onClick={()=>changeCollaborator(choice.id)}><X strokeWidth={lineStroke} size={12} aria-hidden="true" /></button>
                </li>;
              })}
            </ul>}
            {conversation && selectedMembers.length > 0 && <div className="cb-conversation-access">
              {!recipients.length ? <>
                <p className="cb-inline-note" role="status">{t.canViewConversation}</p>
                {sharedLink && <button type="button" className="cb-ghost" onClick={()=>void copyConversation(sharedLink)}>
                  <IconLinkOutlineRegular size={14} aria-hidden="true" />{linkCopied ? t.copied : t.copyConversation}
                </button>}
              </> : <>
                <button type="button" className="cb-ghost" onClick={()=>void grantConversation()}>
                  <IconLinkOutlineRegular size={14} aria-hidden="true" />{granting ? t.grantPending : t.grantConversation}
                </button>
                <p className="cb-inline-note">{t.grantTarget.replace('{title}', conversation.title)}</p>
              </>}
            </div>}
          </section>
          <section className="cb-dependencies" aria-label={t.predecessors}>
            <ChoicePicker heading={t.predecessors} actions={[{label:t.predecessors,text:t.choosePredecessors,search:t.search,empty:t.noPredecessors}]}
              choices={dependencyChoices} selected={draft.predecessorIds}
              choose={value=>field('predecessorIds',draft.predecessorIds.includes(value)
                ? draft.predecessorIds.filter(item=>item!==value) : [...draft.predecessorIds,value])} t={t} />
            {waiting && <p className="cb-inline-note"><Clock3 strokeWidth={lineStroke} size={14} aria-hidden="true" />{t.waiting}</p>}
          </section>
        </fieldset>
      </div>
      <footer className="cb-sheet-footer">
        {!writable && <p className="cb-inline-note">{t.needsWrite}</p>}
        {error!==undefined && <p role="alert" className="cb-alert">{errorMessage(error,t)}</p>}
        <div className="cb-sheet-actions">
          <div className="cb-sheet-links">
            {linkedSession && <button type="button" className="cb-ghost" disabled={granting} title={t.open} onClick={()=>open(linkedSession)}>
              <IconLinkOutlineRegular size={15} aria-hidden="true" />{t.open}
            </button>}
            {card?.task && writable && !autoStart && <button type="button" className="cb-ghost" disabled={busy || granting}
              onClick={()=>void copyInstructions()}><Clock3 strokeWidth={lineStroke} size={15} aria-hidden="true" />{copied?t.copied:t.ai}</button>}
          </div>
          <div className="cb-sheet-save">
            {writable && <FormButton type="button" variant="ghost" disabled={busy || granting} onClick={dismiss}>{t.cancel}</FormButton>}
            {writable && card?.task && !changed && ready && <FormButton type="button" className="cb-ai-action" disabled={busy || granting}
              onClick={()=>void sendToAi()}><IconSparkleRegular size={16} aria-hidden="true" />{t.delegate}</FormButton>}
            {writable && changed && hasAI && ready && <FormButton type="button" className="cb-ai-action" disabled={busy || granting || !draft.title.trim()}
              onClick={()=>void submit(true)}><IconSparkleRegular size={16} aria-hidden="true" />{t.saveAndDelegate}</FormButton>}
            {writable && <FormButton variant="primary" type="submit" disabled={busy || granting || !draft.title.trim()}>{t.save}</FormButton>}
          </div>
        </div>
      </footer>
    </form>
  </dialog>;
}
