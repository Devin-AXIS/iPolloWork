import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  Button, Input, MenuSurface,
  IconCheckOutlineRegular, IconClockOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { CalendarDays, Columns3, GanttChart, lineStroke, List, Plus, Search, X } from '../../_shared/ui/icons.ts';
import { Avatar as SharedAvatar, Tag } from '../../_shared/ui/controls.tsx';
import type { Copy } from './copy.ts';
import type { View } from './model.ts';
import { avatarInitial } from './avatar-initial.ts';

export const viewIcons = {
  board: Columns3, list: List, calendar: CalendarDays, timeline: GanttChart,
} satisfies Record<View, typeof CalendarDays>;

export function Avatar({ name, photo }: { name: string; photo?: string | undefined }) {
  return <SharedAvatar className="cb-avatar" photo={photo} fallback={avatarInitial(name)} />;
}

export function SearchBox({ value, change, label, clear, inputRef, onKeyDown }: {
  value: string; change(value: string): void; label: string; clear: string;
  inputRef?: React.Ref<HTMLInputElement>; onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void;
}) {
  return <div className="cb-search ipw-control">
    <Input className="cb-search-entry" icon={<Search strokeWidth={lineStroke} size={16} aria-hidden="true" />}
      type="search" ref={inputRef} value={value} aria-label={label} placeholder={label} onKeyDown={onKeyDown}
      onChange={event => change(event.target.value)} />
    {value && <Button variant="ghost" size="sm" type="button" className="cb-icon cb-ghost" aria-label={clear} onClick={() => change('')}>
      <X strokeWidth={lineStroke} size={14} aria-hidden="true" />
    </Button>}
  </div>;
}

export type Choice = { id: string; name: string; avatar?: string; avatarName?: string; hint?: string; tag?: string; canView?: boolean; unavailable?: boolean; kind?: 'person' | 'ai' | 'task' };
export function ChoiceIcon({ choice }: { choice: Choice }) {
  if (choice.kind === 'task') return <IconClockOutlineRegular size={15} aria-hidden="true" />;
  return <Avatar name={choice.avatarName ?? choice.name} photo={choice.avatar} />;
}

type ChoiceAction = { kind?: 'person' | 'ai'; label: string; text?: string; search: string; empty?: string; onOpen?(): void };

export function ChoicePicker({ heading, actions, choices, selected, choose, t, showChips = true }: {
  heading: string;
  actions: readonly ChoiceAction[]; choices: Choice[]; selected: readonly string[];
  choose(id: string): void; t: Copy; showChips?: boolean;
}) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const open = active === null ? undefined : actions[active];
  const [query, setQuery] = useState('');
  const current = choices.filter(choice => selected.includes(choice.id));
  const filter = query.trim().toLocaleLowerCase();
  const matching = choices.filter(choice =>
    (!open?.kind || choice.kind === open.kind) &&
    [choice.name, choice.hint, choice.tag].join(' ').toLocaleLowerCase().includes(filter));
  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setActive(null);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [active]);
  function close() {
    setActive(null);
    trigger.current?.focus();
  }
  return <div className="cb-picker" ref={root} onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}>
    <div className="cb-picker-head">
      <h3 className="cb-section-title">{heading}</h3>
      <div className="cb-picker-actions">
        {actions.map((action, index) => <Button key={action.label} type="button" className="cb-picker-trigger" variant="ghost"
          aria-label={action.label} aria-expanded={index === active} aria-controls={index === active ? panelId : undefined}
          onClick={event => {
            trigger.current = event.currentTarget;
            setQuery('');
            if(index !== active) action.onOpen?.();
            setActive(index === active ? null : index);
          }}>
          <span>{action.text ?? action.label}</span><Plus strokeWidth={lineStroke} size={14} aria-hidden="true" />
        </Button>)}
      </div>
    </div>
    {showChips && current.length > 0 && <div className="cb-chips">{current.map(option =>
      <button key={option.id} type="button" className="cb-chip" onClick={() => choose(option.id)}
        aria-label={t.removeChoice.replace('{name}', option.name)}>
        <ChoiceIcon choice={option} /><span>{option.name}</span><X strokeWidth={lineStroke} size={11} aria-hidden="true" />
      </button>)}</div>}
    {open && <MenuSurface compact id={panelId} className="cb-picker-pop" role="group" aria-label={open.label}>
      <SearchBox label={open.search} clear={t.clearSearch} value={query} change={setQuery} inputRef={searchInput}
        onKeyDown={event => {
          if (event.key === 'Enter') event.preventDefault();
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            root.current?.querySelector<HTMLButtonElement>('.cb-choice')?.focus();
          }
        }} />
      <div className="cb-picker-choices">
        {!matching.length && <p className="cb-picker-empty">{query ? t.noOptions : open.empty ?? t.noOptions}</p>}
        {matching.map(choice => {
          const active = selected.includes(choice.id);
          return <button type="button" className="cb-choice" data-kind={choice.kind} aria-pressed={active} key={choice.id} disabled={Boolean(choice.unavailable && !active)}
            onClick={() => choose(choice.id)}>
            <ChoiceIcon choice={choice} />
            <span className="cb-choice-profile">
              <span>{choice.name}</span>
              {choice.hint && <small>{choice.hint}</small>}
              {choice.tag && <span className="cb-choice-tags"><Tag tone="neutral">{choice.tag}</Tag>
                {choice.canView && <Tag tone="neutral">{t.canViewConversation}</Tag>}
              </span>}
            </span>
            {active && <IconCheckOutlineRegular className="cb-option-check" size={15} aria-hidden="true" />}
          </button>;
        })}
      </div>
      <div className="cb-picker-footer"><button type="button" className="cb-ghost" onClick={close}>{t.doneChoosing}</button></div>
    </MenuSurface>}
  </div>;
}
