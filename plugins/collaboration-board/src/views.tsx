import { useState } from 'react';
import { Button, IconBranchOutlineRegular,
  IconSparkleRegular, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { Avatar } from './ui.tsx';
import { Clock3, Ellipsis, lineStroke, Plus } from '../../_shared/ui/icons.ts';
import { OptionMenu, SegmentedControl, Tag } from '../../_shared/ui/controls.tsx';
import type { Copy } from './copy.ts';
import { countdown } from './editor.tsx';
import { assigneeProfile, dateOf, dayOffset, displayAgent, shiftDay, span, statuses, timelinePosition, todayKey,
  type AgentChoice, type DateRange, type ProjectRoster, type Status, type Card } from './model.ts';

type Open = (task: Card) => void;
type Selection={ids:ReadonlySet<string>;toggle(id:string):void};
const shortDate = (key: string) => key.slice(5).replace('-', '/');
const timeFormatter = (locale: string) => new Intl.DateTimeFormat(locale, {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function assigneeFor(task: Card, roster: ProjectRoster | null | undefined, agents: readonly AgentChoice[], t: Copy) {
  const person = assigneeProfile(task, roster, agents);
  if (!person) return;
  const agent = task.task?.assigneeAgent;
  return { ...person, avatarName: person.name, name: agent ? displayAgent(agent, t.currentAI) : person.name };
}

function schedule(task: Card, t: Copy, time: Intl.DateTimeFormat) {
  const dates = span(task);
  if (!dates) return t.unscheduled;
  const start = task.task?.startAt;
  const end = task.task?.dueAt;
  if (dates.from === dates.to) {
    const times = [start, end].flatMap(value => value == null ? [] : [time.format(value)]);
    return [shortDate(dates.from), [...new Set(times)].join('–')].filter(Boolean).join(' ');
  }
  const from = start == null ? shortDate(dates.from) : shortDate(dates.from) + ' ' + time.format(start);
  const to = end == null ? shortDate(dates.to) : shortDate(dates.to) + ' ' + time.format(end);
  return from + ' – ' + to;
}

export function Board({ tasks, t, locale, roster, agents, open, move, writable, clock, add, searching,selection }: {
  tasks: Card[]; t: Copy; locale: string; roster: ProjectRoster | null | undefined; agents: readonly AgentChoice[];
  open: Open; writable:boolean; clock:number; searching:boolean;
  move(task: Card, status: Status): void; add(status: Status): void;
  selection?:Selection|undefined;
}) {
  const [dragging, setDragging] = useState<Card | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const active = searching && !tasks.some(task => task.status === status) ? tasks[0]?.status ?? 'todo' : status ?? 'todo';
  const time = timeFormatter(locale);
  const today = dateOf(clock);
  return <>
    <SegmentedControl<Status> label={t.columnStatus} value={active} change={setStatus} className="cb-lane-picker"
      options={statuses.map(value => ({
        id: value, label: t[value], status: value, count: tasks.filter(task => task.status === value).length,
        icon: <i className="cb-status-dot" aria-hidden="true" />,
      }))} />
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
            {writable && <Button type="button" variant="ghost" size="sm" className="cb-icon cb-ghost" onClick={()=>add(value)} aria-label={createLabel} title={createLabel}>
              <Plus strokeWidth={lineStroke} size={16} aria-hidden="true" />
            </Button>}
          </header>
          <div className="cb-stack">
            {!items.length && <p className="cb-empty-lane">{t.emptyLane}</p>}
            {items.map(task => {
              const data = task.task;
              const person = assigneeFor(task, roster, agents, t);
              const participants = (data?.participantIds.length ?? 0) + (data?.participantAgents?.length ?? 0);
              const scheduled = span(task);
              const due = data?.dueAt;
              const countdownText = due != null && task.status !== 'done' ? countdown(due,t,clock) : null;
              const instant = due ?? data?.startAt ?? null;
              const day = dateOf(instant) ?? task.dueOn ?? task.startOn;
              const timeLabel = instant === null || day === null ? schedule(task,t,time)
                : (day === today ? t.today : shortDate(day)) + ' ' + time.format(instant);
              const tagged = data?.priority === 'high' || data?.priority === 'urgent' || data?.blocked || task.running;
              return <article className="cb-card" key={task.id} draggable={writable}
                onDragStart={event => {
                  event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain',task.id); setDragging(task);
                }}
                onDragEnd={()=>{setDragging(null);setOver(null);}}>
                {selection&&data&&<label className="cb-card-selection"><input type="checkbox" checked={selection.ids.has(task.id)} onChange={()=>selection.toggle(task.id)} aria-label={t.selectNamed.replace('{name}',task.title)}/>{t.selectTask}</label>}
                <button type="button" className="cb-card-open" onClick={()=>open(task)} aria-label={task.title}>
                  <strong>{task.title}</strong>
                  {data?.description && <span className="cb-card-description">{data.description}</span>}
                </button>
                {writable && <OptionMenu label={t.changeStatus.replace('{name}',task.title)} value={task.status}
                  choices={statuses.map(id=>({id,label:t[id],disabled:Boolean(data?.blocked && id!=='todo')}))}
                  change={status=>move(task,status)} iconClassName="cb-icon cb-ghost" menuClassName="cb-card-status" glyph={<Ellipsis strokeWidth={lineStroke} size={17} aria-hidden="true" />} />}
                {tagged && <div className="cb-card-flags">
                  {data && data.priority !== 'normal' && <Tag className="cb-chip-tag" tone={data.priority === 'urgent' ? 'warning' : 'neutral'}>{t[data.priority]}</Tag>}
                  {data?.blocked && <Tag className="cb-chip-tag" tone="warning"><IconBranchOutlineRegular size={11} aria-hidden="true" />{t.waiting}</Tag>}
                  {task.running && <Tag className="cb-chip-tag" tone="neutral"><IconSparkleRegular size={11} aria-hidden="true" />{t.active}</Tag>}
                </div>}
                {(person || participants > 0 || scheduled) && <div className="cb-card-meta">
                  {(person || participants > 0) && <div className="cb-card-team">
                    {person && <span className="cb-card-person" title={t.assignee+' · '+person.name}>
                      <Avatar name={person.avatarName} photo={person.avatar} /><span>{person.name}</span>
                    </span>}
                    {participants > 0 && <span className="cb-card-people" title={t.participants+' · '+participants}>
                      <IconUsersOutlineRegular size={13} aria-hidden="true" />{participants}
                    </span>}
                  </div>}
                  {scheduled && <div className="cb-card-date" data-overdue={due != null && due <= clock && task.status !== 'done'}
                    title={schedule(task,t,time)}>
                    <span className="cb-card-when">
                      <Clock3 strokeWidth={lineStroke} size={13} aria-hidden="true" />
                      {instant === null ? <span>{timeLabel}</span> : <time dateTime={new Date(instant).toISOString()}>{timeLabel}</time>}
                    </span>
                    {countdownText && <span className="cb-card-countdown">{countdownText}</span>}
                  </div>}
                </div>}
              </article>;
            })}
          </div>
        </section>;
      })}
    </div>
  </>;
}

export function TaskList({ tasks, t, locale, roster, agents, open,selection }: {
  tasks: Card[]; t: Copy; locale: string; roster: ProjectRoster | null | undefined; agents: readonly AgentChoice[]; open: Open;
  selection?:Selection|undefined;
}) {
  const time = timeFormatter(locale);
  return <div className="cb-overflow"><table className="cb-table">
    <thead><tr>{selection&&<th scope="col">{t.selectTask}</th>}{[t.name, t.status, t.assignee, t.dates].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{tasks.map(task => {
      const person = assigneeFor(task, roster, agents, t);
      return <tr key={task.id}>
        {selection&&<td>{task.task&&<input type="checkbox" checked={selection.ids.has(task.id)} onChange={()=>selection.toggle(task.id)} aria-label={t.selectNamed.replace('{name}',task.title)}/>}</td>}
        <td><button type="button" className="cb-task-link" onClick={() => open(task)}>{task.title}</button></td>
        <td><Tag className="cb-status" tone="neutral">{t[task.status]}</Tag></td>
        <td>{person ? <span className="cb-list-person" title={person.name}>
          <Avatar name={person.avatarName} photo={person.avatar} /><span>{person.name}</span>
        </span> : t.unassigned}</td>
        <td className="cb-list-date">{schedule(task, t, time)}</td>
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
  const time = timeFormatter(locale);
  return <div className="cb-overflow"><div className="cb-calendar">
    {t.weekdays.map(day => <div className="cb-weekday" key={day}>{day}</div>)}
    {Array.from({ length: 42 }, (_, index) => {
      const date = shiftDay(range.from, index);
      return <div key={date} className="cb-day" data-other={date.slice(0, 7) !== anchor.slice(0, 7)}>
        <time dateTime={date} aria-current={date === today ? 'date' : undefined}>{Number(date.slice(8))}</time>
        {byDay.get(date)?.map(({ task, due }) => {
          const instant = due ? task.task?.dueAt : task.task?.startAt;
          const hour = instant == null ? '' : time.format(instant);
          const label = [task.title, due ? t.due : t.start, fullDate.format(new Date(date + 'T00:00:00Z')), hour].filter(Boolean).join(' · ');
          return <button type="button" className="cb-event" data-status={task.status} key={task.id} title={label}
            aria-label={label} onClick={() => open(task)}>
            {hour && <span className="cb-calendar-hour">{hour}</span>}
            <span>{task.title}</span>
          </button>;
        })}
      </div>;
    })}
  </div></div>;
}

export function Timeline({ tasks, range, t, locale, open }: {
  tasks: Card[]; range: DateRange; t: Copy; locale: string; open: Open;
}) {
  const rows = tasks.flatMap(task => {
    const position = timelinePosition(task, range);
    return position ? [{ task, position }] : [];
  }).sort((a, b) => span(a.task)!.from.localeCompare(span(b.task)!.from));
  const weekCount = Math.ceil((dayOffset(range.from, range.to) + 1) / 7);
  const time = timeFormatter(locale);
  return <div className="cb-overflow"><div className="cb-timeline">
    <div className="cb-timeline-row cb-timeline-head"><span>{t.name}</span><div className="cb-weeks">
      {Array.from({ length: weekCount }, (_, index) => <span key={index}>{shortDate(shiftDay(range.from, index * 7))}</span>)}
    </div></div>
    {!rows.length && <p className="cb-empty">{t.noDates}</p>}
    {rows.map(({ task, position }) => {
      const dates = schedule(task, t, time);
      return <div className="cb-timeline-row" key={task.id}>
        <button type="button" className="cb-line-name cb-task-link" onClick={() => open(task)}>
          <strong>{task.title}</strong><span>{dates}</span>
        </button>
        <div className="cb-track">
          <button type="button" className="cb-bar" data-status={task.status} style={position}
            aria-label={task.title + ' · ' + dates} title={task.title + ' · ' + dates}
            onClick={() => open(task)} />
        </div>
      </div>;
    })}
  </div></div>;
}
