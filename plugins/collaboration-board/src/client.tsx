import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, IconUserOutlineRegular, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { projectBoardOwnershipEvent, projectBoardPeopleEvent, type ProjectBoardPeopleAction,
  type ProjectConversationShare } from '../../ipollowork-suite/src/shared/enterprise.ts';
import { FormButton,FormSelect, SegmentedControl, Tag } from '../../_shared/ui/controls.tsx';
import { ChevronLeft, ChevronRight, lineStroke, Plus } from '../../_shared/ui/icons.ts';
import { SearchBox, viewIcons } from './ui.tsx';
import { copyFor, errorMessage, type Copy } from './copy.ts';
import { TaskEditor, aiInstruction } from './editor.tsx';
import { InboxBadge, InboxPanel, noticeMessage, projectInbox, type InboxRequest } from './inbox.tsx';
import type { NotificationCenter } from '../../notification-center/src/contract.ts';
import type { BoardNotice, ProjectTask, TaskStatusWrite, TaskWrite,TaskActionWrite,TaskListQuery,TaskPage as StoredPage } from '../../../services/ipollowork/src/project-board-contract.ts';
import { cardFor, dateRange, dateValue, projectCards, shiftDay, shiftMonth, todayKey, views,
  assigneeName, currentAgent, type AgentChoice, type AgentPlan, type BoardNote, type Card, type NativeConversation, type Project, type ProjectRoster, type View } from './model.ts';
import { Board, Calendar, TaskList, Timeline } from './views.tsx';
import stylesheet from './style.css';
import controlsStyles from '../../_shared/ui/controls.css';

interface Observable<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}
interface ProjectViewProps {
  sessionId: string;
  openView(view: string, focus: string): void;
}
interface SessionReference {
  binding: { session: { prompt(content: { type: 'text'; text: string }[], mode: 'queue', signal?: AbortSignal): Promise<{ ok: boolean }> } };
}
interface Client {
  inject(names: ['ipolloProjectConversationShare'], install: (scope: Client & { ipolloProjectConversationShare: ProjectConversationShare }) => void): void;
  inject(names: ['ipolloNotificationCenter', 'layout'], install: (scope: Client & {
    ipolloNotificationCenter: NotificationCenter; layout: { selectPanel(id: string): void };
  }) => void): void;
  slots: {
    inject(name: string, install: () => () => void): () => void;
    register(options: { name:'main'|'sidebar.panellist'; key?:string; id?:string; label?:()=>string; order?:number }, component:()=>ReactNode):()=>void;
    register(options: { name: 'conversation.view'; id: string; order: number; label(): string }, component: (props: ProjectViewProps) => ReactNode): () => void;
  };
  effect(install: () => () => void): void;
  locale: Observable<{ active: string }>;
  uiWorkspace: { openSession(sessionId: string): void };
  sessions: {
    list: Observable<{ byId: Readonly<Record<string, NativeConversation>>; phase: 'pending' | 'ready' }>;
    using<T>(sessionId: string, options: { source: string; signal: AbortSignal }, operation: (reference: SessionReference) => Promise<T>): Promise<T>;
  };
  workspaces: { list: Observable<{ items: readonly Project[]; archivedSessionIds: readonly string[]; phase: 'pending' | 'ready' }> };
}
type Notes = Record<string, BoardNote>;
const endpoint = '/ipollo-project-board';
interface TaskPage extends StoredPage { remote: boolean }
export const inject = ['slots', 'locale', 'uiWorkspace', 'sessions', 'workspaces'];

function useSnapshot<T>(source: Observable<T>): T {
  return useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot());
}
async function request<T>(path: string, signal: AbortSignal, update?: unknown): Promise<T> {
  const response = await fetch(path, {
    signal, cache: 'no-store',
    ...(update === undefined ? {} : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) }),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('unavailable');
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? 'unavailable');
  return value;
}

function ProjectBoard({ project, sessionId, summaries, archived, loading, locale, t, open, delegate, lifetime, shareConversation }: {
  project: Project; summaries: Readonly<Record<string, NativeConversation>>; archived: readonly string[];
  sessionId: string; shareConversation: ProjectConversationShare | undefined;
  loading: boolean; locale: string; t: Copy; open(sessionId:string): void; delegate(task:ProjectTask,ai:AgentPlan,signal:AbortSignal):Promise<void>; lifetime: AbortSignal;
}) {
  const [view,setView]=useState<View>('board');
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState('');
  const [taskScope,setTaskScope]=useState<TaskListQuery['scope']>('active');
  const [selecting,setSelecting]=useState(false);
  const [selected,setSelected]=useState<ReadonlySet<string>>(new Set());
  const [anchor,setAnchor]=useState(todayKey);
  const [notes,setNotes]=useState<Notes>({});
  const [page,setPage]=useState<TaskPage>();
  const [roster,setRoster]=useState<ProjectRoster | null>();
  const [agents,setAgents]=useState<AgentChoice[]>([currentAgent]);
  const [agentRevision,refreshAgents]=useState(0);
  const [suite,setSuite]=useState(false);
  const [edit,setEdit]=useState<{card?:Card; status?:TaskStatusWrite['status']}>();
  const [error,setError]=useState<unknown>();
  const [loadError,setLoadError]=useState<unknown>();
  const visibleError=error??loadError;
  const [scheduleFeedback,setScheduleFeedback]=useState<'scheduled'|'scheduleSaveFailed'>();
  const [generation,refresh]=useState(0);
  const [pending,setPending]=useState(false);
  const [clock,tick]=useState(Date.now);
  const scope=useRef(lifetime);
  const loaded=useRef(0);
  const sequence=useRef(0);
  const operation=useRef<AbortSignal|null>(null);
  const report=(error:unknown)=>{if(!(error && typeof error==='object' && 'name' in error && error.name==='AbortError'))setError(error);};
  const url=endpoint+'?'+new URLSearchParams({workspace:project.workspaceId});
  const taskUrl=url+'&'+new URLSearchParams({resource:'tasks',session:sessionId,query:search,scope:taskScope});
  const agentUrl=url+'&resource=agents';
  const session = archived.includes(sessionId) ? null : summaries[sessionId];
  const rosterUrl=url+'&'+new URLSearchParams({resource:'members', ...(session ? {session:sessionId} : {})});
  useEffect(()=>{
    const timer=window.setInterval(()=>tick(Date.now()),30_000);
    return ()=>window.clearInterval(timer);
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>setSearch(query),250);return ()=>window.clearTimeout(timer);},[query]);
  useEffect(()=>{loaded.current=0;setPage(undefined);setSelected(new Set());},[taskUrl]);
  useEffect(()=>{
    let controller=new AbortController();
    scope.current=AbortSignal.any([controller.signal,lifetime]);
    const accountChanged=()=>{
      controller.abort();controller=new AbortController();scope.current=AbortSignal.any([controller.signal,lifetime]);
      sequence.current++;loaded.current=0;operation.current=null;setPending(false);setError(undefined);setLoadError(undefined);
      setAgents([currentAgent]);setSuite(false);setEdit(undefined);setNotes({});setPage(undefined);setRoster(undefined);setSelected(new Set());setQuery('');setSearch('');setTaskScope('active');setScheduleFeedback(undefined);refresh(value=>value+1);
    };
    window.addEventListener('ipollo-account-identity-changed',accountChanged);
    window.addEventListener(projectBoardOwnershipEvent,accountChanged);
    return ()=>{
      controller.abort();window.removeEventListener('ipollo-account-identity-changed',accountChanged);
      window.removeEventListener(projectBoardOwnershipEvent,accountChanged);
    };
  },[url,lifetime]);
  useEffect(()=>{
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,scope.current]);
    void request<{agents:AgentChoice[]; suite?:boolean}>(agentUrl,signal).then(result=>{
      if(!signal.aborted){setAgents(result.agents);setSuite(Boolean(result.suite));}
    }).catch(()=>{if(!signal.aborted)setAgents([currentAgent]);});
    return ()=>controller.abort();
  },[agentUrl,agentRevision,lifetime,generation]);
  useEffect(()=>{
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,scope.current]);
    void request<{notes:Notes}>(url,signal).then(result=>{if(!signal.aborted)setNotes(result.notes);}).catch(()=>{});
    async function load(initial: boolean) {
      if(operation.current)return;
      const version=++sequence.current;
      const target=loaded.current;
      try {
        let result = await request<TaskPage>(taskUrl,signal);
        const tasks=[...result.tasks];
        while(result.next && tasks.length<target) {
          signal.throwIfAborted();
          const next=await request<TaskPage>(taskUrl+'&after='+encodeURIComponent(result.next),signal);
          if(next.remote!==result.remote)throw new Error('BOARD_CONFLICT');
          result=next;tasks.push(...next.tasks);
        }
        if (signal.aborted || version!==sequence.current) return;
        loaded.current=tasks.length;
        setPage({...result,tasks});
        setSelected(current=>new Set([...current].filter(id=>tasks.some(task=>task.id===id))));
        setLoadError(undefined);
      } catch (error) {
        if (!signal.aborted && version===sequence.current) { if(initial)setPage(undefined);setLoadError(error); }
      }
    }
    function loadRoster() {
      void request<{roster:ProjectRoster|null}>(rosterUrl,signal).then(result=>{
        if(!signal.aborted)setRoster(result.roster);
      }).catch(()=>{if(!signal.aborted)setRoster(undefined);});
    }
    void load(true);
    loadRoster();
    const poll = window.setInterval(() => { if (!document.hidden) {void load(false);loadRoster();} },15_000);
    window.addEventListener('focus',loadRoster);
    return ()=>{
      controller.abort();window.clearInterval(poll);
      window.removeEventListener('focus',loadRoster);
    };
  },[url,taskUrl,rosterUrl,lifetime,generation]);

  const organization = Boolean(roster || page?.remote);
  const writable=Boolean(page && (!page.remote || roster?.canAssign));
  const enhanced=Boolean(page&&(!page.remote||page.version===2));
  const taskItems=page?.tasks ?? [];
  const linked=new Set(page?.linkedSessionIds??taskItems.map(task=>task.sessionId));
  const cards=[...taskItems.map(task=>cardFor(task,roster,summaries)),
    ...(taskScope==='active'?projectCards(project,summaries,archived,notes).filter(card=>!linked.has(card.id)):[])];
  const filter=query.trim().toLocaleLowerCase();
  const visible=filter ? cards.filter(card => [card.title, card.task?.description, assigneeName(card,roster,t.currentAI)]
    .some(value=>value?.toLocaleLowerCase().includes(filter))) : cards;
  const conversations=visible.filter(card=>!card.task);
  const total=(page?.totals?.total??taskItems.length)+conversations.length;
  const done=(page?.totals?.done??taskItems.filter(task=>task.status==='done').length)+conversations.filter(card=>card.status==='done').length;
  const counts=t.taskTotals.replace('{total}',String(total)).replace('{done}',String(done));
  async function save(input:TaskWrite|TaskStatusWrite) {
    if(!writable || operation.current) throw new Error('BOARD_WRITE_FORBIDDEN');
    const signal=scope.current;
    signal.throwIfAborted();
    operation.current=signal;sequence.current++;
    setPending(true);
    try {
      const result=await request<{task:ProjectTask; scheduled?:boolean; scheduleFailed?:boolean}>(taskUrl,signal,input);
      signal.throwIfAborted();
      setPage(current=>current ? {...current,tasks:[result.task,...current.tasks.filter(task=>task.id!==result.task.id)]} : current);
      setScheduleFeedback(result.scheduleFailed ? 'scheduleSaveFailed' : result.scheduled ? 'scheduled' : undefined);
      setError(undefined);
      refresh(value=>value+1);
    } catch(error) {
      if(!signal.aborted && error instanceof Error && error.message==='BOARD_CONFLICT')refresh(value=>value+1);
      throw error;
    } finally {if(operation.current===signal){operation.current=null;setPending(false);}}
  }
  async function more() {
    if(!page?.next || operation.current)return;
    const signal=scope.current;
    if(signal.aborted)return;
    operation.current=signal;sequence.current++;
    setPending(true);
    try {
      const result=await request<TaskPage>(taskUrl+'&after='+encodeURIComponent(page.next),signal);
      if(signal.aborted)return;
      if(result.remote!==page.remote){refresh(value=>value+1);return;}
      loaded.current=page.tasks.length+result.tasks.length;
      setPage(current=>current ? {...result,tasks:[...current.tasks,...result.tasks]} : current);
    } catch(error) {if(!signal.aborted)setLoadError(error);}
    finally {if(operation.current===signal){operation.current=null;setPending(false);}}
  }
  async function act(inputs:TaskActionWrite[]){
    if(!writable||!enhanced||operation.current)throw new Error('BOARD_WRITE_FORBIDDEN');
    const signal=scope.current;signal.throwIfAborted();operation.current=signal;sequence.current++;setPending(true);
    const completed=new Set<string>();let failure:unknown;
    try{
      for(const input of inputs){
        signal.throwIfAborted();
        try{
          await request<{task:ProjectTask}>(taskUrl,signal,input);signal.throwIfAborted();completed.add(input.id);
        }catch(error){if(signal.aborted)throw error;failure=error;}
      }
      setSelected(current=>new Set([...current].filter(id=>!completed.has(id))));
      refresh(value=>value+1);
      if(failure){const error=new Error(t.batchPartial.replace('{done}',String(completed.size)).replace('{total}',String(inputs.length))+' '+errorMessage(failure,t));error.name='BoardBatchError';throw error;}
      setError(undefined);
    }finally{if(operation.current===signal){operation.current=null;setPending(false);}}
  }
  function bulk(action:TaskActionWrite['action']){
    const chosen=taskItems.filter(task=>selected.has(task.id)),ordered:ProjectTask[]=[],seen=new Set<string>();
    const visit=(task:ProjectTask)=>{
      if(seen.has(task.id))return;seen.add(task.id);
      if(action==='delete')chosen.filter(other=>other.predecessorIds.includes(task.id)).forEach(visit);
      if(action==='restore')chosen.filter(other=>task.predecessorIds.includes(other.id)).forEach(visit);
      ordered.push(task);
    };
    chosen.forEach(visit);void act(ordered.map(task=>({id:task.id,revision:task.revision,action}))).catch(report);
  }
  const selection=selecting&&writable&&enhanced?{ids:selected,toggle(id:string){
    if(!selected.has(id)&&selected.size>=100){setError(new Error('BOARD_BATCH_LIMIT'));return;}
    setSelected(current=>{
    const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;
  });}}:undefined;
  const range=view==='calendar'||view==='timeline' ? dateRange(view,anchor) : null;
  const month=new Intl.DateTimeFormat(locale,{year:'numeric',month:'long',timeZone:'UTC'});
  const date=new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  const navigate=(direction:number)=>setAnchor(current=>view==='calendar'?shiftMonth(current,direction):shiftDay(current,direction*28));
  const details=(card:Card)=>setEdit({card});
  const openPeople=(action:ProjectBoardPeopleAction)=>window.dispatchEvent(new CustomEvent(projectBoardPeopleEvent,{detail:action}));
  return <section className="cb-panel ipw-ui" aria-label={t.title} data-project-board={project.workspaceId}>
    <header className="cb-heading cb-project-header">
      <div className="cb-project-heading">
        <h2 className="cb-project-name" title={project.title}>{project.title}</h2>
        {(roster || page) && <div className="cb-scope-row">
          <Tag className="cb-scope" tone="neutral">
            {organization ? <IconUsersOutlineRegular size={13} aria-hidden="true" /> : <IconUserOutlineRegular size={13} aria-hidden="true" />}
            <span>{organization ? roster?.organizationName ?? t.organizationScope : t.personalScope}</span>
            {roster && <small>{t.projectPeople.replace('{count}',String(roster.members.length))}</small>}
          </Tag>
          {page && <div className="cb-project-summary">
            <span>{counts}</span>
            {total > 0 && <progress aria-label={counts} max={total} value={done} />}
          </div>}
          {roster?.canInvite && roster.projectId && roster.enterpriseId ? <button type="button" className="cb-ghost"
            onClick={()=>openPeople({kind:'invite',projectId:roster.projectId!,enterpriseId:roster.enterpriseId!})}>
            <Plus strokeWidth={lineStroke} size={13} aria-hidden="true" />{t.inviteProject}
          </button> : !organization && suite && <button type="button" className="cb-ghost"
            onClick={()=>openPeople({kind:'ownership',workspaceId:project.workspaceId})}>{t.connectOrganization}</button>}
        </div>}
      </div>
      <FormButton variant="primary" type="button" className="cb-create" disabled={!writable || pending||taskScope!=='active'} onClick={()=>setEdit({})}>
        <Plus strokeWidth={lineStroke} size={15} aria-hidden="true" />{t.newTask}
      </FormButton>
    </header>
    <div className="cb-toolbar">
      <SegmentedControl<View> label={t.viewMode} value={view} change={setView} className="cb-views"
        options={views.map(item => {
          const Icon = viewIcons[item];
          return { id: item, label: t[item], icon: <Icon size={14} strokeWidth={lineStroke} aria-hidden="true" /> };
        })} />
      {range && <div className="cb-datebar">
        <Button type="button" variant="ghost" className="cb-icon" aria-label={t.previous} onClick={()=>navigate(-1)}><ChevronLeft strokeWidth={lineStroke} size={16} aria-hidden="true" /></Button>
        <strong>{view==='calendar'?month.format(dateValue(anchor)):date.formatRange(dateValue(range.from),dateValue(range.to))}</strong>
        <Button type="button" variant="ghost" className="cb-icon" aria-label={t.next} onClick={()=>navigate(1)}><ChevronRight strokeWidth={lineStroke} size={16} aria-hidden="true" /></Button>
        <Button type="button" variant="outline" onClick={()=>setAnchor(todayKey())}>{t.today}</Button>
      </div>}
      <SearchBox value={query} change={setQuery} label={t.search} clear={t.clearSearch} />
    </div>
    <div className="cb-lifecycle-toolbar">
      <FormSelect aria-label={t.taskScope} value={taskScope} disabled={!enhanced||pending} onChange={event=>setTaskScope(event.target.value as TaskListQuery['scope'])}>
        <option value="active">{t.activeTasks}</option><option value="archived">{t.archivedTasks}</option><option value="trash">{t.trash}</option>
      </FormSelect>
      {enhanced&&writable&&<button type="button" className="cb-ghost" aria-pressed={selecting} disabled={pending} onClick={()=>{setSelecting(!selecting);setSelected(new Set());}}>{selecting?t.doneChoosing:t.batchSelect}</button>}
      {selection&&<>
        <button type="button" className="cb-ghost" disabled={pending||!taskItems.length} onClick={()=>setSelected(new Set(taskItems.slice(0,100).map(task=>task.id)))}>{t.selectLoaded}</button>
        <span>{t.selectedTasks.replace('{count}',String(selected.size))}</span>
        {selected.size>0&&<>
          {taskScope!=='trash'&&<button type="button" disabled={pending} onClick={()=>bulk(taskScope==='archived'?'unarchive':'archive')}>{taskScope==='archived'?t.unarchive:t.archive}</button>}
          <button type="button" disabled={pending} onClick={()=>bulk(taskScope==='trash'?'restore':'delete')}>{taskScope==='trash'?t.restore:t.deleteTask}</button>
        </>}
      </>}
    </div>
    {page?.remote&&!enhanced&&<p className="cb-inline-note">{t.serverUpgradeRequired}</p>}
    {visibleError!==undefined && <div className="cb-alert"><span role="alert">{errorMessage(visibleError,t)}</span>
      <button type="button" onClick={()=>{setError(undefined);refresh(value=>value+1);}}>{t.retry}</button></div>}
    {scheduleFeedback && <p className={scheduleFeedback==='scheduleSaveFailed' ? 'cb-alert' : 'cb-inline-note'}
      role={scheduleFeedback==='scheduleSaveFailed' ? 'alert' : 'status'}>{t[scheduleFeedback]}</p>}
    {page?.next && <p className="cb-inline-note" role="status">{page.version===2?t.partialGlobal:t.partialTasks}</p>}
    {(loading || !page && visibleError===undefined) && <p className="cb-empty" role="status">{t.loading}</p>}
    {!loading && page && !visible.length && <p className="cb-empty cb-board-message">{filter ? t.noMatches : t.empty}</p>}
    <div className="cb-content">
      {view==='board' && <Board tasks={visible} t={t} locale={locale} roster={roster} agents={agents} selection={selection} open={details} clock={clock} writable={writable && !pending&&taskScope==='active'} searching={Boolean(filter)} add={status=>setEdit({status})} move={(card,status)=>{
        if(card.task && writable && !pending)void save({id:card.id,revision:card.revision,status}).catch(report);
        else if(writable)setEdit({card,status});
      }} />}
      {view==='list' && <TaskList tasks={visible} t={t} locale={locale} roster={roster} agents={agents} selection={selection} open={details} />}
      {view==='calendar' && range && <Calendar tasks={visible} t={t} open={details} range={range} anchor={anchor} locale={locale} />}
      {view==='timeline' && range && <Timeline tasks={visible} t={t} locale={locale} open={details} range={range} />}
      {page?.next && <button type="button" disabled={pending} onClick={()=>void more()}>{t.more}</button>}
    </div>
    {edit && <TaskEditor key={sessionId+':'+(edit.card?.id ?? 'new')} card={edit.card} roster={page?.remote ? roster : null} agents={agents} tasks={taskItems}
      refreshAgents={()=>refreshAgents(value=>value+1)}
      writable={writable&&taskScope==='active'} manage={writable&&enhanced} act={async action=>{const task=edit.card?.task;if(task)await act([{id:task.id,revision:task.revision,action}]);}}
      t={t} locale={locale} clock={clock} projectTitle={project.title} initialStatus={edit.status} report={report} close={()=>setEdit(undefined)} save={save}
      open={id=>{setEdit(undefined);open(id);}} sessions={project.sessionIds.filter(id=>!archived.includes(id))}
      conversation={session && shareConversation ? {
        title: session.displayTitle || project.title,
        grant: async (userIds, signal) => {
          const access=AbortSignal.any([signal,scope.current]);
          const result = await shareConversation({workspaceId:project.workspaceId, sessionId, sessionTitle:(session.displayTitle || project.title).slice(0,120), userIds},
            access);
          if (!access.aborted) {
            const granted = new Set(userIds);
            setRoster(current => current && {
              ...current, members: current.members.map(person =>
                granted.has(person.userId) ? { ...person, canViewConversation: true } : person),
            });
            refresh(value=>value+1);
          }
          return result;
        },
      } : undefined}
      delegate={async taskId=>{
        const signal=scope.current;
        const { task, ai } = await request<{ task: ProjectTask; ai: AgentPlan }>(url+'&resource=delegate&task='+taskId,signal);
        signal.throwIfAborted();
        if(task.archived||task.deletedAt!=null)throw new Error('BOARD_TASK_INACTIVE');
        if(task.blocked)throw new Error('BOARD_TASK_BLOCKED');
        if(task.startAt!==null && task.startAt>Date.now())throw new Error('BOARD_TASK_NOT_STARTED');
        if(task.status==='done')throw new Error('BOARD_TASK_DONE');
        if(ai.unavailable)throw new Error('BOARD_AGENT_UNAVAILABLE');
        await delegate(task,ai,signal);
        signal.throwIfAborted();
        setEdit(undefined);
      }} />}
  </section>;
}

export function apply(ctx: Client): void {
  if ('__DSH_LIVESHARE_VIEWER__' in globalThis) return;
  const lifetime = new AbortController();
  let shareConversation: ProjectConversationShare | undefined;
  const shareListeners = new Set<() => void>();
  const sharing: Observable<ProjectConversationShare | undefined> = {
    getSnapshot: () => shareConversation,
    subscribe(listener) { shareListeners.add(listener); return () => { shareListeners.delete(listener); }; },
  };
  const updateSharing = (service: ProjectConversationShare | undefined) => {
    shareConversation = service;
    for (const listener of shareListeners) listener();
  };
  ctx.inject(['ipolloProjectConversationShare'], scope => scope.effect(() => {
    updateSharing(scope.ipolloProjectConversationShare);
    return () => updateSharing(undefined);
  }));
  const style = document.createElement('style');
  style.textContent = stylesheet + '\n' + controlsStyles;
  const inboxId='ipollo-project-board-inbox';
  const inbox=projectInbox(async input=>{
    const params=new URLSearchParams({resource:'inbox'});
    if(input)params.set('notice',input.id);
    if(input?.action==='status')params.set('action','status');
    const update=input?.action==='status' ? input.update : input?.action==='read' ? {} : undefined;
    return request<Awaited<ReturnType<InboxRequest>>>(endpoint+'?'+params,lifetime.signal,update);
  });
  ctx.effect(()=>{
    const poll=()=>{if(!document.hidden)void inbox.load();};
    const reset=()=>{inbox.reset();poll();};
    const timer=window.setInterval(poll,15_000);
    window.addEventListener('focus',poll);
    window.addEventListener('ipollo-account-identity-changed',reset);
    poll();
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',poll);window.removeEventListener('ipollo-account-identity-changed',reset);inbox.reset();};
  });
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:inboxId},()=>{
    const {active}=useSnapshot(ctx.locale);
    return <InboxPanel inbox={inbox} t={copyFor(active)} />;
  }));
  const addInboxEntry = () => ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({
    name:'sidebar.panellist',id:inboxId,order:11,label:()=>copyFor(ctx.locale.getSnapshot().active).notices,
  },()=> <InboxBadge inbox={inbox} />));
  let removeInboxEntry = addInboxEntry();
  ctx.inject(['ipolloNotificationCenter','layout'], scope => scope.effect(() => {
    const language = () => copyFor(ctx.locale.getSnapshot().active);
    const unregister = scope.ipolloNotificationCenter.registerSource('ipollo.project-board', {
      label: () => language().title,
      getSnapshot: () => inbox.get().map(item => ({
        id: item.id, title: item.title, createdAt: item.createdAt, read: item.read,
        tone: item.kind === 'ready' ? 'success' : 'action',
        summary: item.projectTitle + ' · ' + noticeMessage(item.kind, language()),
      })),
      subscribe(listener) {
        const stopInbox = inbox.subscribe(listener);
        const stopLocale = ctx.locale.subscribe(listener);
        return () => { stopInbox(); stopLocale(); };
      },
      markRead: id => inbox.mark(id),
      open(id) { inbox.select(id); scope.layout.selectPanel(inboxId); },
    });
    removeInboxEntry();
    return () => {
      unregister();
      if (!lifetime.signal.aborted) removeInboxEntry = addInboxEntry();
    };
  }));
  ctx.effect(() => {
    document.head.append(style);
    return () => { lifetime.abort(); style.remove(); };
  });
  function ProjectView({ sessionId, openView }: ProjectViewProps) {
    const { active } = useSnapshot(ctx.locale);
    const sessions = useSnapshot(ctx.sessions.list);
    const workspaces = useSnapshot(ctx.workspaces.list);
    const share = useSnapshot(sharing);
    const t = copyFor(active);
    const project = workspaces.items.find(item => item.sessionIds.includes(sessionId));
    if (!project) return <section className="cb-panel ipw-ui" aria-label={t.title}>
      <p className="cb-empty">{workspaces.phase === 'pending' ? t.loading : t.noProject}</p>
    </section>;
    return <ProjectBoard key={project.workspaceId} project={project} sessionId={sessionId} summaries={sessions.byId}
      shareConversation={share}
      archived={workspaces.archivedSessionIds} loading={sessions.phase === 'pending'} locale={active}
      t={t} open={id => {
        openView('chat', '');
        if (id !== sessionId) ctx.uiWorkspace.openSession(id);
      }} delegate={async (task,ai,signal)=>{
        const target=task.sessionId && project.sessionIds.includes(task.sessionId) &&
          !workspaces.archivedSessionIds.includes(task.sessionId) ? task.sessionId : sessionId;
        const result = await ctx.sessions.using(target, { source: 'projectBoard', signal }, reference =>
          reference.binding.session.prompt([{ type: 'text', text: aiInstruction(task.id,t,ai) }], 'queue', signal));
        signal.throwIfAborted();
        if(!result.ok)throw new Error('BOARD_AI_UNAVAILABLE');
        openView('chat','');
        if(target!==sessionId)ctx.uiWorkspace.openSession(target);
      }} lifetime={lifetime.signal} />;
  }
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'ipollo-project-board',
    order: 5,
    label: () => copyFor(ctx.locale.getSnapshot().active).title,
  }, ProjectView));
}
