import { useState } from 'react';
import { IconBranchOutlineRegular, IconClockOutlineRegular, IconEllipsisOutlineRegular, IconPlusOutlineRegular,
  IconSparkleRegular, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { Avatar } from './ui.tsx';
import type { Copy } from './copy.ts';
import { countdown } from './editor.tsx';
import { assigneeProfile, dayOffset, shiftDay, span, statuses, timelinePosition, todayKey,
  type AgentChoice, type DateRange, type ProjectRoster, type Status, type Card } from './model.ts';

type Open = (task: Card) => void;
const shortDate = (key: string) => key.slice(5).replace('-', '/');
function schedule(task: Card, t: Copy) {
  const dates = span(task);
  if (!dates) return t.unscheduled;
  return dates.from === dates.to ? shortDate(dates.from) : `${shortDate(dates.from)} – ${shortDate(dates.to)}`;
}

export function Board({ tasks, t, roster, agents, open, move, writable, clock, add, searching }: {
  tasks: Card[]; t: Copy; roster: ProjectRoster | null | undefined; agents: readonly AgentChoice[];
  open: Open; writable:boolean; clock:number; searching:boolean;
  move(task: Card, status: Status): void; add(status: Status): void;
}) {
  const [dragging, setDragging] = useState<Card | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const active = searching && !tasks.some(task => task.status === status) ? tasks[0]?.status ?? 'todo' : status ?? 'todo';
  return <>
    <nav className="cb-lane-picker" aria-label={t.columnStatus}>
      {statuses.map(value => <button type="button" className="cb-ghost" key={value} data-status={value}
        aria-pressed={active === value} onClick={() => setStatus(value)}>
        <i className="cb-status-dot" aria-hidden="true" />{t[value]}
        <span>{tasks.filter(task=>task.status===value).length}</span>
      </button>)}
    </nav>
    <div className="cb-columns">
      {statuses.map(value => {
        const items = tasks.filter(task => task.status === value);
        const createLabel = t.addInStatus.replace('{status}', t[value]);
        return <section key={value} className="cb-lane" data-status={value} data-current={active===value} data-over={over===value}
          onDragOver={event => {
            if (dragging && dragging.status !== value && (!dragging.task?.blocked || value==='todo')) {
              event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(value);
            }
          }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null); }}
          onDrop={event => {
            event.preventDefault();
            if (dragging && dragging.status!==value && (!dragging.task?.blocked || value==='todo')) move(dragging,value);
            setDragging(null); setOver(null);
          }}>
          <header className="cb-lane-head">
            <i className="cb-status-dot" aria-hidden="true" /><h3>{t[value]}</h3><span className="cb-lane-count">{items.length}</span>
            {writable && <button type="button" className="cb-icon cb-ghost" onClick={()=>add(value)} aria-label={createLabel} title={createLabel}>
              <IconPlusOutlineRegular size={16} aria-hidden="true" />
            </button>}
          </header>
          <div className="cb-stack">
            {!items.length && <p className="cb-empty-lane">{t.emptyLane}</p>}
            {items.map(task => {
              const data = task.task;
              const person = assigneeProfile(task,roster,agents);
              const participants = (data?.participantIds.length ?? 0) + (data?.participantAgents?.length ?? 0);
              const scheduled = span(task);
              const due = data?.dueAt;
              const countdownText = due != null && task.status!=='done' ? countdown(due,t,clock) : null;
              return <article className="cb-card" key={task.id} draggable={writable}
                onDragStart={event => {
                  event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain',task.id); setDragging(task);
                }}
                onDragEnd={()=>{setDragging(null);setOver(null);}}>
                <button type="button" className="cb-card-open" onClick={()=>open(task)} aria-label={task.title}>
                  <strong>{task.title}</strong>
                  {data?.description && <span className="cb-card-description">{data.description}</span>}
                </button>
                {writable && <label className="cb-card-status" title={t.changeStatus.replace('{name}',task.title)}>
                  <IconEllipsisOutlineRegular size={17} aria-hidden="true" />
                  <select value={task.status} aria-label={t.changeStatus.replace('{name}',task.title)}
                    onChange={event=>move(task,event.target.value as Status)}>
                    {statuses.map(option=><option key={option} value={option} disabled={data?.blocked && option!=='todo'}>{t[option]}</option>)}
                  </select>
                </label>}
                {(data || task.running) && <div className="cb-card-flags">
                  {data && <span className="cb-chip-tag cb-priority" data-priority={data.priority}>{t[data.priority]}</span>}
                  {data?.blocked && <span className="cb-chip-tag cb-waiting"><IconBranchOutlineRegular size={11} aria-hidden="true" />{t.waiting}</span>}
                  {task.running && <span className="cb-chip-tag cb-running"><IconSparkleRegular size={11} aria-hidden="true" />{t.active}</span>}
                </div>}
                {(person || participants>0 || scheduled) && <div className="cb-card-meta">
                  {person && <span className="cb-card-person" title={t.assignee+' · '+person.name}>
                    <Avatar name={person.name} photo={person.avatar} ai={person.ai} /><span>{person.name}</span>
                  </span>}
                  {participants>0 && <span className="cb-card-people" title={t.participants+' · '+participants}>
                    <IconUsersOutlineRegular size={13} aria-hidden="true" />{participants}
                  </span>}
                  {scheduled && <span className="cb-card-date" data-overdue={Boolean(due!=null && due<=clock && countdownText)}
                    title={schedule(task,t)}><IconClockOutlineRegular size={12} aria-hidden="true" />{countdownText ?? schedule(task,t)}</span>}
                </div>}
              </article>;
            })}
          </div>
        </section>;
      })}
    </div>
  </>;
}

export function TaskList({ tasks, t, roster, agents, open }: {
  tasks: Card[]; t: Copy; roster: ProjectRoster | null | undefined; agents: readonly AgentChoice[]; open: Open;
}) {
  return <div className="cb-overflow"><table className="cb-table">
    <thead><tr>{[t.name, t.status, t.assignee, t.dates].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{tasks.map(task => {
      const person = assigneeProfile(task,roster,agents);
      return <tr key={task.id}>
        <td><button type="button" className="cb-task-link" onClick={() => open(task)}>{task.title}</button></td>
        <td><span className="cb-status" data-status={task.status}><i className="cb-status-dot" aria-hidden="true" />{t[task.status]}</span></td>
        <td>{person ? <span className="cb-list-person" title={person.name}>
          <Avatar name={person.name} photo={person.avatar} ai={person.ai} /><span>{person.name}</span>
        </span> : t.unassigned}</td>
        <td>{schedule(task, t)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}
export function Calendar({ tasks, range, anchor, locale, t, open }: {
  tasks: Card[]; range: DateRange; anchor: string; locale: string; t: Copy; open: Open;
}) {
  const byDay = new Map<string, { task: Card; due: boolean }[]>();
  const place = (key: string, task: Card, due: boolean) => {
    if (key >= range.from && key <= range.to) byDay.set(key, [...(byDay.get(key) ?? []), { task, due }]);
  };
  for (const task of tasks) {
    if (task.startOn && task.startOn !== task.dueOn) place(task.startOn, task, false);
    if (task.dueOn) place(task.dueOn, task, true);
  }
  const today = todayKey();
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
  return <div className="cb-overflow"><div className="cb-calendar">
    {t.weekdays.map(day => <div className="cb-weekday" key={day}>{day}</div>)}
    {Array.from({ length: 42 }, (_, index) => {
      const date = shiftDay(range.from, index);
      return <div key={date} className="cb-day" data-other={date.slice(0, 7) !== anchor.slice(0, 7)}>
        <time dateTime={date} aria-current={date === today ? 'date' : undefined}>{Number(date.slice(8))}</time>
        {byDay.get(date)?.map(({ task, due }) => {
          const label = `${task.title} · ${due ? t.due : t.start} · ${fullDate.format(new Date(date + 'T00:00:00Z'))}`;
          return <button type="button" className="cb-event" data-status={task.status} key={task.id} title={label}
            aria-label={label} onClick={() => open(task)}>{task.title}</button>;
        })}
      </div>;
    })}
  </div></div>;
}

export function Timeline({ tasks, range, t, open }: {
  tasks: Card[]; range: DateRange; t: Copy; open: Open;
}) {
  const rows = tasks.flatMap(task => {
    const position = timelinePosition(task, range);
    return position ? [{ task, position }] : [];
  }).sort((a, b) => span(a.task)!.from.localeCompare(span(b.task)!.from));
  const weekCount = Math.ceil((dayOffset(range.from, range.to) + 1) / 7);
  return <div className="cb-overflow"><div className="cb-timeline">
    <div className="cb-timeline-row cb-timeline-head"><span>{t.name}</span><div className="cb-weeks">
      {Array.from({ length: weekCount }, (_, index) => <span key={index}>{shortDate(shiftDay(range.from, index * 7))}</span>)}
    </div></div>
    {!rows.length && <p className="cb-empty">{t.noDates}</p>}
    {rows.map(({ task, position }) => <div className="cb-timeline-row" key={task.id}>
      <button type="button" className="cb-line-name cb-task-link" onClick={() => open(task)}>
        <strong>{task.title}</strong><span>{schedule(task, t)}</span>
      </button>
      <div className="cb-track">
        <button type="button" className="cb-bar" data-status={task.status} style={position}
          aria-label={`${task.title} · ${schedule(task, t)}`} title={`${task.title} · ${schedule(task, t)}`}
          onClick={() => open(task)} />
      </div>
    </div>)}
  </div></div>;
}
