import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  IconBranchOutlineRegular, IconCheckOutlineRegular, IconClockOutlineRegular,
  IconCloseOutlineRegular, IconFlatListOutlineRegular, IconPanelLeftOutlineRegular, IconPlanOutlineRegular,
  IconPlusOutlineRegular, IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { Copy } from './copy.ts';
import type { View } from './model.ts';
import { avatarInitial } from './avatar-initial.ts';

export const viewIcons = {
  board: IconPanelLeftOutlineRegular, list: IconFlatListOutlineRegular,
  calendar: IconPlanOutlineRegular, timeline: IconBranchOutlineRegular,
} satisfies Record<View, typeof IconPlanOutlineRegular>;

export function Avatar({ name, photo, ai = false }: { name: string; photo?: string | undefined; ai?: boolean }) {
  const [failed,setFailed] = useState<string>();
  const hue = Array.from(name).reduce((sum, char) => (sum * 31 + char.codePointAt(0)!) % 5, 0);
  return <span aria-hidden="true" className="cb-avatar" data-ai={ai} data-hue={hue}>
    {photo && failed !== photo
      ? <img src={photo} alt="" decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(photo)} />
      : avatarInitial(name)}
  </span>;
}

export function SearchBox({ value, change, label, clear, inputRef, onKeyDown }: {
  value: string; change(value: string): void; label: string; clear: string;
  inputRef?: React.Ref<HTMLInputElement>; onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void;
}) {
  return <div className="cb-search">
    <IconSearchOutlineRegular size={16} aria-hidden="true" />
    <input type="search" ref={inputRef} value={value} aria-label={label} placeholder={label} onKeyDown={onKeyDown}
      onChange={event => change(event.target.value)} />
    {value && <button type="button" className="cb-icon cb-ghost" aria-label={clear} onClick={() => change('')}>
      <IconCloseOutlineRegular size={14} aria-hidden="true" />
    </button>}
  </div>;
}

export type Choice = { id: string; name: string; avatar?: string; avatarName?: string; hint?: string; tag?: string; canView?: boolean; unavailable?: boolean; kind?: 'person' | 'ai' | 'task' };
export function ChoiceIcon({ choice }: { choice: Choice }) {
  if (choice.kind === 'task') return <IconClockOutlineRegular size={15} aria-hidden="true" />;
  return <Avatar name={choice.avatarName ?? choice.name} photo={choice.avatar} ai={choice.kind === 'ai'} />;
}

type ChoiceAction = { kind?: 'person' | 'ai'; label: string; text?: string; search: string; empty?: string; onOpen?(): void };

export function ChoicePicker({ actions, choices, selected, choose, t, showChips = true }: {
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
    <div className="cb-picker-actions">
      {actions.map((action, index) => <button key={action.label} type="button" className="cb-picker-trigger" data-kind={action.kind}
        aria-label={action.label} aria-expanded={index === active} aria-controls={index === active ? panelId : undefined}
        onClick={event => {
          trigger.current = event.currentTarget;
          setQuery('');
          if(index !== active) action.onOpen?.();
          setActive(index === active ? null : index);
        }}>
        <span>{action.text ?? action.label}</span><IconPlusOutlineRegular size={14} aria-hidden="true" />
      </button>)}
    </div>
    {showChips && current.length > 0 && <div className="cb-chips">{current.map(option =>
      <button key={option.id} type="button" className="cb-chip" onClick={() => choose(option.id)}
        aria-label={t.removeChoice.replace('{name}', option.name)}>
        <ChoiceIcon choice={option} /><span>{option.name}</span><IconCloseOutlineRegular size={11} aria-hidden="true" />
      </button>)}</div>}
    {open && <div id={panelId} className="cb-picker-pop" role="group" aria-label={open.label}>
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
              {choice.tag && <span className="cb-choice-tags"><small>{choice.tag}</small>
                {choice.canView && <small>{t.canViewConversation}</small>}
              </span>}
            </span>
            {active && <IconCheckOutlineRegular className="cb-option-check" size={15} aria-hidden="true" />}
          </button>;
        })}
      </div>
      <div className="cb-picker-footer"><button type="button" className="cb-ghost" onClick={close}>{t.doneChoosing}</button></div>
    </div>}
  </div>;
}
