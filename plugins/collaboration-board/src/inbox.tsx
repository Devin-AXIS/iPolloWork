import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IconBranchOutlineRegular, IconCloseOutlineRegular, IconMailUnreadOutlineRegular,
  IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import type { BoardNotice, ProjectTask, TaskStatusWrite } from '../../../services/ipollowork/src/project-board-contract.ts';
import { errorMessage, type Copy } from './copy.ts';
import { statuses } from './model.ts';
import { OptionMenu } from '../../_shared/ui/controls.tsx';

type ReceivedTask = Pick<ProjectTask, 'title' | 'description' | 'status' | 'priority' | 'startAt' | 'dueAt' | 'blocked' | 'revision'> & { editable: boolean };
type StatusUpdate = Pick<TaskStatusWrite, 'status' | 'revision'>;
export type InboxRequest = (input?: { id: string; action: 'view' | 'read' } |
  { id: string; action: 'status'; update: StatusUpdate }) => Promise<{ notices?: BoardNotice[]; task?: ReceivedTask }>;
export function projectInbox(request: InboxRequest) {
  let snapshot: readonly BoardNotice[] = [];
  let selection: BoardNotice | undefined;
  const listeners = new Set<() => void>();
  let generation = 0;
  function update(value: readonly BoardNotice[]) {
    snapshot = value;
    for (const listener of listeners) listener();
  }
  async function load() {
    const current = ++generation;
    try {
      const result = await request();
      if (current === generation && result.notices) update(result.notices);
    } catch { if (current === generation && !snapshot.length) update([]); }
  }
  return {
    get: () => snapshot,
    selection: () => selection,
    select(id?: string) {
      selection = snapshot.find(item => item.id === id);
      update(snapshot);
    },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    reset: () => { generation++; selection = undefined; update([]); },
    async mark(id: string) { await request({ id, action: 'read' }); await load(); },
    async view(id: string) {
      const { task } = await request({ id, action: 'view' });
      if (!task) throw new Error('BOARD_NOTICE_NOT_FOUND');
      return task;
    },
    async setStatus(id: string, update: StatusUpdate) {
      const { task } = await request({ id, action: 'status', update });
      if (!task) throw new Error('BOARD_NOTICE_NOT_FOUND');
      return task;
    },
  };
}
export type Inbox = ReturnType<typeof projectInbox>;
export const noticeMessage = (kind: BoardNotice['kind'], t: Copy) =>
  kind==='due'?t.dueNotice:kind === 'ready' ? t.readyNotice : kind === 'assigned' ? t.assignedNotice : t.participatingNotice;
export function InboxBadge({ inbox }: { inbox: Inbox }) {
  const notices = useSyncExternalStore(inbox.subscribe, inbox.get);
  const unread = notices.filter(item => !item.read).length;
  return <span className="cb-inbox-mark" aria-label={unread ? String(unread) : undefined}><IconMailUnreadOutlineRegular size={16} aria-hidden="true" />{unread > 0 && <sup>{unread}</sup>}</span>;
}
function NoticeDetails({ item, inbox, t, close }: { item: BoardNotice; inbox: Inbox; t: Copy; close(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [task,setTask] = useState<ReceivedTask>();
  const [error,setError] = useState<unknown>();
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const element = ref.current;
    element?.showModal();
    void inbox.view(item.id).then(task => {
      if (live) { setTask(task); if (!item.read) void inbox.mark(item.id).catch(() => {}); }
    }).catch(error => { if (live) setError(error); });
    return () => { live = false; element?.close(); };
  }, [inbox,item]);
  async function change(status: ReceivedTask['status']) {
    if (!task || busy) return;
    setBusy(true); setError(undefined);
    try { setTask(await inbox.setStatus(item.id, { status, revision:task.revision })); }
    catch (error) { setError(error); void inbox.view(item.id).then(setTask).catch(() => {}); }
    finally { setBusy(false); }
  }
  return <dialog className="cb-dialog ipw-ui ipw-frosted" ref={ref} aria-labelledby="cb-notice-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="cb-notice-details">
      <header className="cb-dialog-head"><h2 id="cb-notice-title">{item.title}</h2>
        <button className="cb-icon" type="button" aria-label={t.close} onClick={close}><IconCloseOutlineRegular size={18} aria-hidden="true" /></button></header>
      {!task && !error && <p role="status">{t.loading}</p>}
      {task && <>
        <p>{task.description}</p>
        {task.dueAt !== null && <p>{t.due} · {new Date(task.dueAt).toLocaleString()}</p>}
        {task.blocked && <p>{t.waiting}</p>}
        {task.editable
          ? <div className="cb-property"><span className="cb-label">{t.status}</span>
            <OptionMenu label={t.status} value={task.status} disabled={busy || task.blocked}
              choices={statuses.map(id=>({id,label:t[id]}))} change={status=>void change(status)} />
          </div>
          : <p>{t[task.status]}</p>}
      </>}
      {error !== undefined && <p role="alert">{errorMessage(error,t)}</p>}
    </div>
  </dialog>;
}
export function InboxPanel({ inbox,t }: { inbox: Inbox; t: Copy }) {
  const notices = useSyncExternalStore(inbox.subscribe,inbox.get);
  const selected = useSyncExternalStore(inbox.subscribe,inbox.selection);
  const unread=notices.filter(item=>!item.read).length;
  return <section className="cb-panel cb-inbox ipw-ui">
    <header className="cb-heading">
      <div className="cb-project-heading">
        <span className="cb-notice-icon"><IconMailUnreadOutlineRegular size={20} aria-hidden="true" /></span>
        <div><h1>{t.notices}</h1>
          {unread>0 && <div className="cb-project-summary">{t.unreadCount.replace('{count}',String(unread))}</div>}
        </div>
      </div>
    </header>
    {!notices.length ? <p className="cb-empty">{t.noNotices}</p> :
      <ul>{notices.map(item => <li key={item.id} data-unread={!item.read}>
        <span className="cb-notice-icon">{item.kind==='ready'
          ? <IconBranchOutlineRegular size={17} aria-hidden="true" />
          : <IconUsersOutlineRegular size={17} aria-hidden="true" />}</span>
        <div className="cb-notice-copy"><button className="cb-task-link" type="button" onClick={() => inbox.select(item.id)}>{item.title}</button>
          <p>{item.projectTitle} · {noticeMessage(item.kind,t)}</p></div>
        {!item.read && <button type="button" className="cb-ghost" onClick={() => void inbox.mark(item.id).catch(() => {})}>{t.markRead}</button>}
      </li>)}</ul>}
    {selected && notices.some(item => item.id === selected.id) && <NoticeDetails key={selected.id} item={selected} inbox={inbox} t={t} close={() => inbox.select()} />}
  </section>;
}
