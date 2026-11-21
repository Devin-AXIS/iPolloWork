import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Input, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives';
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, lineStroke, X } from './icons.ts';
import { calendarStart, dateOf, dateValue, shiftDay, shiftMonth, todayKey } from './date-keys.ts';
import { FieldPopover, OptionMenu } from './controls.tsx';

export interface DateTimeLabels {
  datePart: string;
  pickDate: string;
  clearDateTime: string;
  customTime: string;
  applyTime: string;
  timeRange: string;
  clearSchedule: string;
  previous: string;
  next: string;
  weekdays: readonly string[];
}

function clockTime(value: number | null): string {
  if (value === null) return '';
  const date = new Date(value);
  return [date.getHours(), date.getMinutes()].map(part => String(part).padStart(2, '0')).join(':');
}

const quarterHours = Array.from({ length: 96 }, (_, index) => {
  const hours = String(Math.floor(index / 4)).padStart(2, '0');
  const minutes = String((index % 4) * 15).padStart(2, '0');
  return hours + ':' + minutes;
});

interface DateTimeEndpoint {
  dateLabel: string;
  timeLabel: string;
  timePlaceholder: string;
  value: number | null;
  change(value: number | null): void;
}

function update(endpoint: DateTimeEndpoint, day: string, time: string) {
  if (dateOf(endpoint.value) === day && clockTime(endpoint.value) === time) return;
  const timestamp = new Date(day + 'T' + time).getTime();
  if (Number.isFinite(timestamp)) endpoint.change(timestamp);
}

function DateField({ endpoint, locale, t }: { endpoint: DateTimeEndpoint; locale: string; t: DateTimeLabels }) {
  const { dateLabel: label, value, change } = endpoint;
  const id = useId();
  const dateControl = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dayButton = useRef<HTMLButtonElement>(null);
  const focusDay = useRef(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(todayKey);
  const date = dateOf(value) ?? '';
  const today = todayKey();
  const anchor = '--ipw-date-' + id.replaceAll(':', '');
  const monthFormat = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }), [locale]);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: 'full', timeZone: 'UTC',
  }), [locale]);
  const pickerLabel = t.pickDate.replace('{label}', label);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !dateControl.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (!open || !focusDay.current) return;
    focusDay.current = false;
    dayButton.current?.focus();
  }, [cursor, open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function toggle() {
    if (open) { close(); return; }
    setCursor(date || today);
    focusDay.current = true;
    setOpen(true);
  }

  function changeDate(day: string) {
    if (!day) change(null);
    else update(endpoint, day, clockTime(value) || '09:00');
  }

  function moveDays(event: KeyboardEvent<HTMLDivElement>) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const distance = offsets[event.key];
    if (distance === undefined) return;
    event.preventDefault();
    focusDay.current = true;
    setCursor(current => shiftDay(current, distance));
  }

  const days = useMemo(() => {
    if (!open) return [];
    const first = calendarStart(cursor);
    return Array.from({ length: 42 }, (_, index) => shiftDay(first, index));
  }, [open, cursor]);

  return <div className="ipw-date-field" role="group" aria-labelledby={id}>
    <span id={id} className="ipw-date-label">{label}</span>
    <div ref={dateControl} className="ipw-control ipw-date-control" style={{ anchorName: anchor }} onKeyDown={event => {
      if (open && event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }}>
      <Input type="date" className="ipw-date-entry" value={date} aria-label={t.datePart.replace('{label}', label)}
        onChange={event => changeDate(event.currentTarget.value)} />
      <Button type="button" variant="ghost" size="sm" className="ipw-date-icon-button" ref={trigger}
        aria-label={pickerLabel} aria-expanded={open} aria-controls={open ? id + '-picker' : undefined}
        onClick={toggle}><CalendarDays className="ipw-calendar-icon" size={14} strokeWidth={lineStroke} aria-hidden="true" /></Button>
      {open && <FieldPopover anchor={anchor}>
        <MenuSurface compact id={id + '-picker'} className="ipw-date-pop" role="group" aria-label={pickerLabel}>
          <div className="ipw-calendar-picker-head">
            <Button type="button" variant="ghost" size="sm" className="ipw-date-icon-button" aria-label={t.previous}
              onClick={() => setCursor(current => shiftMonth(current, -1))}><ChevronLeft strokeWidth={lineStroke} size={15} aria-hidden="true" /></Button>
            <strong aria-live="polite">{monthFormat.format(dateValue(cursor))}</strong>
            <Button type="button" variant="ghost" size="sm" className="ipw-date-icon-button" aria-label={t.next}
              onClick={() => setCursor(current => shiftMonth(current, 1))}><ChevronRight strokeWidth={lineStroke} size={15} aria-hidden="true" /></Button>
          </div>
          <div className="ipw-calendar-picker-grid" onKeyDown={moveDays}>
            {t.weekdays.map(day => <span key={day} className="ipw-calendar-picker-weekday">{day}</span>)}
            {days.map(day => day.slice(0, 7) === cursor.slice(0, 7)
              ? <Button key={day} type="button" variant="ghost" size="sm" className="ipw-calendar-pick-day"
                aria-label={dayFormat.format(dateValue(day))} aria-pressed={date === day}
                aria-current={day === today ? 'date' : undefined}
                ref={cursor === day ? dayButton : undefined} tabIndex={cursor === day ? 0 : -1}
                onClick={() => { changeDate(day); close(); }}>{Number(day.slice(-2))}</Button>
              : <span className="ipw-calendar-adjacent" key={day} aria-hidden="true">{Number(day.slice(-2))}</span>)}
          </div>
          {date && <Button type="button" variant="ghost" size="sm" className="ipw-date-clear"
            aria-label={t.clearDateTime.replace('{label}', label)} onClick={() => { change(null); close(); }}>
            {t.clearDateTime.replace('{label}', label)}
          </Button>}
        </MenuSurface>
      </FieldPopover>}
    </div>
  </div>;
}

function TimePicker({ endpoint, t, buttonRef }: {
  endpoint: DateTimeEndpoint;
  t: DateTimeLabels;
  buttonRef?: { current: HTMLButtonElement | null };
}) {
  const [customTime, setCustomTime] = useState<string | null>(null);
  const customField = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const defaultButton = useRef<HTMLButtonElement | null>(null);
  const trigger = buttonRef ?? defaultButton;
  const id = useId();
  const anchor = '--ipw-custom-time-' + id.replaceAll(':', '');
  const { value, timeLabel, timePlaceholder } = endpoint;
  const time = clockTime(value);
  const times = time && !quarterHours.includes(time) ? [...quarterHours, time].sort() : quarterHours;
  const choices = times.map(id => ({ id, label: id }));
  choices.push({ id: 'custom', label: t.customTime });
  const editing = customTime !== null;

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !customField.current?.contains(event.target)) setCustomTime(null);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [editing]);

  function setTime(next: string) {
    update(endpoint, dateOf(value) ?? todayKey(), next);
  }
  function close() {
    setCustomTime(null);
    trigger.current?.focus();
  }
  function apply() {
    if (!customTime) return;
    setTime(customTime);
    close();
  }

  return <div className="ipw-time-part" style={{ anchorName: anchor }}>
    <OptionMenu label={timeLabel} value={time} choices={choices} placeholder={timePlaceholder} inlineTime scrollToValue buttonRef={trigger}
      change={next => {
        if (next === 'custom') setCustomTime(time || '09:00');
        else setTime(next);
      }} />
    {editing && <FieldPopover anchor={anchor} width="time">
      <MenuSurface compact className="ipw-custom-time" role="group" aria-label={t.customTime}>
        <div ref={customField} className="ipw-custom-time-entry" onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          }
        }}>
          <Input ref={input} type="time" className="ipw-date-entry" aria-label={timeLabel} value={customTime}
            onChange={event => setCustomTime(event.currentTarget.value)} />
          <Button type="button" variant="ghost" size="sm" className="ipw-date-icon-button"
            aria-label={t.applyTime} disabled={!customTime} onClick={apply}>
            <Check strokeWidth={lineStroke} size={14} aria-hidden="true" />
          </Button>
        </div>
      </MenuSurface>
    </FieldPopover>}
  </div>;
}

export function ScheduleRangeField({ start, end, clear, duration, locale, t }: {
  start: DateTimeEndpoint; end: DateTimeEndpoint; clear(): void; duration?: string | undefined;
  locale: string; t: DateTimeLabels;
}) {
  const startButton = useRef<HTMLButtonElement | null>(null);
  const hasDate = start.value !== null || end.value !== null;
  return <div className="ipw-schedule">
    <div className="ipw-date-pair">
      <DateField endpoint={start} locale={locale} t={t} />
      <DateField endpoint={end} locale={locale} t={t} />
    </div>
    <div className="ipw-time-range" role="group" aria-label={t.timeRange}>
      <div className="ipw-time-track">
        <div className="ipw-time-edge">
          <Clock3 size={13} strokeWidth={lineStroke} aria-hidden="true" />
          <TimePicker endpoint={start} t={t} buttonRef={startButton} />
        </div>
        <ArrowRight size={13} strokeWidth={lineStroke} className="ipw-time-arrow" aria-hidden="true" />
        <div className="ipw-time-edge">
          <TimePicker endpoint={end} t={t} />
          {duration && <small className="ipw-time-duration">{duration}</small>}
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" className="ipw-time-clear" disabled={!hasDate}
        aria-label={t.clearSchedule} onClick={() => { clear(); startButton.current?.focus(); }}>
        <X size={14} strokeWidth={lineStroke} aria-hidden="true" />
      </Button>
    </div>
  </div>;
}
