/** @jsxImportSource react */
import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus } from "lucide-react";
import type { WorkItem } from "@ipollowork/types/work-items";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { currentLocale, t } from "@/i18n";

import type { WorkItemScheduleDraft } from "./work-item-sheet";

export type WorkCalendarView = "week" | "month";

export type WorkCalendarItem = {
  key: string;
  item: WorkItem;
  projectName: string;
};

type WorkCalendarProps = {
  items: WorkCalendarItem[];
  anchorDate: Date;
  view: WorkCalendarView;
  canCreateSchedule: boolean;
  onAnchorDateChange: (date: Date) => void;
  onViewChange: (view: WorkCalendarView) => void;
  onCreateSchedule: (schedule: WorkItemScheduleDraft) => void;
  onSelectItem: (item: WorkCalendarItem) => void;
};

const HOUR_START = 6;
const HOUR_END = 22;
const HOUR_HEIGHT = 64;
const SCHEDULE_SLOT_MINUTES = 30;
const DEFAULT_SCHEDULE_MINUTES = 60;
const TOTAL_GRID_MINUTES = (HOUR_END - HOUR_START + 1) * 60;
const PROJECT_TONES = [
  "border-sky-8/35 bg-sky-4/80 text-sky-12",
  "border-emerald-8/35 bg-emerald-4/80 text-emerald-12",
  "border-amber-8/35 bg-amber-4/80 text-amber-12",
  "border-violet-8/35 bg-violet-4/80 text-violet-12",
  "border-rose-8/35 bg-rose-4/80 text-rose-12",
];

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scheduledAt(item: WorkItem): number | null {
  return item.startAt ?? item.dueAt;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number): Date {
  const day = date.getDate();
  const next = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function snapWorkCalendarSlot(offset: number, height: number): number {
  if (height <= 0) return 0;
  const minutes = Math.round((Math.max(0, Math.min(offset, height)) / height * TOTAL_GRID_MINUTES) / SCHEDULE_SLOT_MINUTES) * SCHEDULE_SLOT_MINUTES;
  return Math.min(TOTAL_GRID_MINUTES - DEFAULT_SCHEDULE_MINUTES, minutes);
}

export function workCalendarScheduleRange(day: Date, minutesFromGridStart: number): WorkItemScheduleDraft {
  const start = startOfDay(day);
  start.setHours(HOUR_START, minutesFromGridStart, 0, 0);
  return {
    startAt: start.getTime(),
    dueAt: start.getTime() + DEFAULT_SCHEDULE_MINUTES * 60_000,
  };
}

function monthDayScheduleRange(day: Date): WorkItemScheduleDraft {
  const today = new Date();
  if (localDateKey(day) === localDateKey(today)) {
    const startAt = Math.ceil(today.getTime() / (SCHEDULE_SLOT_MINUTES * 60_000)) * SCHEDULE_SLOT_MINUTES * 60_000;
    return { startAt, dueAt: startAt + DEFAULT_SCHEDULE_MINUTES * 60_000 };
  }
  const start = startOfDay(day);
  start.setHours(9, 0, 0, 0);
  return { startAt: start.getTime(), dueAt: start.getTime() + DEFAULT_SCHEDULE_MINUTES * 60_000 };
}

export function startOfWorkWeek(date: Date): Date {
  const next = startOfDay(date);
  const day = next.getDay();
  next.setDate(next.getDate() - (day === 0 ? 6 : day - 1));
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function workCalendarRange(anchorDate: Date, view: WorkCalendarView): { from: number; to: number } {
  if (view === "week") {
    const start = startOfWorkWeek(anchorDate);
    return { from: start.getTime(), to: endOfDay(addDays(start, 6)).getTime() };
  }
  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const gridStart = startOfWorkWeek(monthStart);
  return { from: gridStart.getTime(), to: endOfDay(addDays(gridStart, 41)).getTime() };
}

function formatRange(anchorDate: Date, view: WorkCalendarView): string {
  const locale = currentLocale();
  if (view === "month") {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(anchorDate);
  }
  const start = startOfWorkWeek(anchorDate);
  const end = addDays(start, 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = new Intl.DateTimeFormat(locale, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(end);
  return `${startLabel} - ${endLabel}`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(currentLocale(), { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function projectTone(projectName: string): string {
  let hash = 0;
  for (const character of projectName) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return PROJECT_TONES[hash % PROJECT_TONES.length];
}

function CalendarToolbar(props: Pick<WorkCalendarProps, "anchorDate" | "view" | "onAnchorDateChange" | "onViewChange">) {
  const isToday = localDateKey(props.anchorDate) === localDateKey(new Date());
  const movePeriod = (direction: -1 | 1) => {
    props.onAnchorDateChange(props.view === "week"
      ? addDays(props.anchorDate, direction * 7)
      : addMonths(props.anchorDate, direction));
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dls-border px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("work.calendar.previous")} onClick={() => movePeriod(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("work.calendar.next")} onClick={() => movePeriod(1)}>
          <ChevronRight className="size-4" />
        </Button>
        <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => props.onAnchorDateChange(new Date())}>
          {t(isToday ? "work.calendar.today" : "work.calendar.back_to_today")}
        </Button>
        <h2 className="ml-1 truncate text-[15px] font-medium tracking-[-0.2px] text-dls-text">{formatRange(props.anchorDate, props.view)}</h2>
      </div>
      <div className="inline-flex rounded-lg bg-dls-hover/70 p-1">
        <button
          type="button"
          className={cn("h-7 rounded-md px-3 text-xs transition", props.view === "week" ? "bg-dls-surface text-dls-text shadow-sm" : "text-dls-secondary hover:text-dls-text")}
          onClick={() => props.onViewChange("week")}
        >
          {t("work.calendar.week")}
        </button>
        <button
          type="button"
          className={cn("h-7 rounded-md px-3 text-xs transition", props.view === "month" ? "bg-dls-surface text-dls-text shadow-sm" : "text-dls-secondary hover:text-dls-text")}
          onClick={() => props.onViewChange("month")}
        >
          {t("work.calendar.month")}
        </button>
      </div>
    </div>
  );
}

function AgendaList({ items, onSelectItem }: Pick<WorkCalendarProps, "items" | "onSelectItem">) {
  const scheduled = items
    .filter((entry) => scheduledAt(entry.item) !== null)
    .sort((left, right) => (scheduledAt(left.item) ?? 0) - (scheduledAt(right.item) ?? 0));
  if (!scheduled.length) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
        <CalendarDays className="size-7 text-dls-tertiary" />
        <p className="mt-3 text-sm font-medium text-dls-text">{t("work.calendar.empty_title")}</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-dls-secondary">{t("work.calendar.empty_description")}</p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-dls-border">
      {scheduled.map((entry) => {
        const time = scheduledAt(entry.item);
        if (time === null) return null;
        return (
          <button
            key={entry.key}
            type="button"
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-dls-hover/45 focus-visible:bg-dls-hover/45 focus-visible:outline-none"
            onClick={() => onSelectItem(entry)}
          >
            <div className="w-16 shrink-0 text-xs font-medium tabular-nums text-dls-secondary">
              {new Intl.DateTimeFormat(currentLocale(), { month: "short", day: "numeric" }).format(time)}
              <span className="mt-0.5 block text-[10px] font-normal text-dls-tertiary">{formatTime(time)}</span>
            </div>
            <span className={cn("h-8 w-1 shrink-0 rounded-full border", projectTone(entry.projectName))} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-dls-text">{entry.item.title}</span>
              <span className="mt-0.5 block truncate text-[11px] text-dls-secondary">{entry.projectName}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WeekDayColumn(props: {
  day: Date;
  items: WorkCalendarItem[];
  canCreateSchedule: boolean;
  onCreateSchedule: WorkCalendarProps["onCreateSchedule"];
  onSelectItem: WorkCalendarProps["onSelectItem"];
}) {
  const [hoverMinutes, setHoverMinutes] = React.useState<number | null>(null);
  const pointerDownRef = React.useRef<{ x: number; y: number } | null>(null);
  const schedule = hoverMinutes === null ? null : workCalendarScheduleRange(props.day, hoverMinutes);
  const previewTop = hoverMinutes === null ? 0 : hoverMinutes / 60 * HOUR_HEIGHT;
  const updateHover = (element: HTMLElement, clientY: number) => {
    const rect = element.getBoundingClientRect();
    const next = snapWorkCalendarSlot(clientY - rect.top, rect.height);
    setHoverMinutes((current) => current === next ? current : next);
  };
  const column = (
    <div
      className={cn(
        "relative border-r border-dls-border bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_63px,var(--dls-border)_64px)]",
        props.canCreateSchedule && "cursor-crosshair",
      )}
      data-testid="work-calendar-week-day"
      onPointerMove={(event) => {
        if (!props.canCreateSchedule || event.pointerType === "touch" || event.buttons !== 0) {
          setHoverMinutes(null);
          return;
        }
        updateHover(event.currentTarget, event.clientY);
      }}
      onPointerLeave={() => setHoverMinutes(null)}
      onPointerDown={(event) => {
        pointerDownRef.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        if (!props.canCreateSchedule) return;
        const pointerDown = pointerDownRef.current;
        pointerDownRef.current = null;
        if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) return;
        const rect = event.currentTarget.getBoundingClientRect();
        props.onCreateSchedule(workCalendarScheduleRange(props.day, snapWorkCalendarSlot(event.clientY - rect.top, rect.height)));
      }}
      onContextMenu={(event) => {
        if (props.canCreateSchedule) updateHover(event.currentTarget, event.clientY);
      }}
    >
      {schedule && props.canCreateSchedule ? (
        <div
          className="pointer-events-none absolute left-1 right-1 z-0 overflow-hidden rounded-lg border border-dashed border-dls-secondary/40 bg-dls-hover/75 px-2 py-1.5 text-left text-dls-secondary"
          data-testid="work-calendar-slot-preview"
          style={{ top: previewTop, height: DEFAULT_SCHEDULE_MINUTES / 60 * HOUR_HEIGHT }}
        >
          <span className="flex items-center gap-1 text-[10px] font-medium text-dls-text"><Plus className="size-3" />{t("work.new_schedule")}</span>
          <span className="mt-0.5 block text-[9px] tabular-nums">{formatTime(schedule.startAt)}–{formatTime(schedule.dueAt)}</span>
        </div>
      ) : null}
      {props.items.map((entry, index) => {
        const timestamp = scheduledAt(entry.item);
        if (timestamp === null) return null;
        const start = new Date(timestamp);
        const minutes = Math.max(0, (start.getHours() - HOUR_START) * 60 + start.getMinutes());
        const endTimestamp = entry.item.dueAt ?? timestamp + 45 * 60_000;
        const duration = Math.max(30, Math.min((endTimestamp - timestamp) / 60_000, 180));
        const top = Math.min(minutes / 60 * HOUR_HEIGHT, (HOUR_END - HOUR_START) * HOUR_HEIGHT);
        const height = Math.max(34, duration / 60 * HOUR_HEIGHT);
        return (
          <button
            key={entry.key}
            type="button"
            className={cn(
              "absolute z-[1] overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-[0_4px_16px_rgba(35,55,82,0.08)] transition hover:z-[2] hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(35,55,82,0.14)] focus-visible:z-[2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              projectTone(entry.projectName),
            )}
            style={{ top, height, left: 5 + index % 3 * 4, right: 5 }}
            onPointerEnter={() => setHoverMinutes(null)}
            onPointerMove={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onSelectItem(entry);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <span className="block truncate text-[11px] font-semibold">{entry.item.title}</span>
            <span className="mt-0.5 block truncate text-[9px] opacity-70">{formatTime(timestamp)} {entry.projectName}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger render={column} />
      <ContextMenuContent className="w-56">
        <ContextMenuItem
          disabled={!schedule || !props.canCreateSchedule}
          onClick={() => {
            if (schedule) props.onCreateSchedule(schedule);
          }}
        >
          <Plus className="size-4" />
          <span className="min-w-0"><span className="block">{t("work.new_schedule")}</span>{schedule ? <span className="block text-[10px] font-normal text-muted-foreground">{formatTime(schedule.startAt)}–{formatTime(schedule.dueAt)}</span> : null}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function WeekGrid({ items, anchorDate, canCreateSchedule, onCreateSchedule, onSelectItem }: Pick<WorkCalendarProps, "items" | "anchorDate" | "canCreateSchedule" | "onCreateSchedule" | "onSelectItem">) {
  const weekStart = startOfWorkWeek(anchorDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, index) => HOUR_START + index);
  const itemsByDate = new Map<string, WorkCalendarItem[]>();
  for (const entry of items) {
    const timestamp = scheduledAt(entry.item);
    if (timestamp === null) continue;
    const key = localDateKey(new Date(timestamp));
    itemsByDate.set(key, [...(itemsByDate.get(key) ?? []), entry]);
  }
  return (
    <div className="hidden min-h-0 flex-1 overflow-auto lg:block">
      <div className="min-w-[920px]">
        <div className="sticky top-0 z-10 grid grid-cols-[64px_repeat(7,minmax(118px,1fr))] border-b border-dls-border bg-dls-surface/90 backdrop-blur-xl">
          <div />
          {days.map((day) => {
            const today = localDateKey(day) === localDateKey(new Date());
            return (
              <div key={localDateKey(day)} className="border-l border-dls-border px-2 py-3 text-center">
                <span className="block text-[10px] font-medium uppercase tracking-[0.08em] text-dls-tertiary">
                  {new Intl.DateTimeFormat(currentLocale(), { weekday: "short" }).format(day)}
                </span>
                <span className={cn("mx-auto mt-1 flex size-7 items-center justify-center rounded-full text-sm font-medium", today ? "bg-dls-text text-dls-surface" : "text-dls-text")}>{day.getDate()}</span>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[64px_repeat(7,minmax(118px,1fr))]" style={{ height: (HOUR_END - HOUR_START + 1) * HOUR_HEIGHT }}>
          <div className="relative border-r border-dls-border">
            {hours.map((hour, index) => (
              <span key={hour} className="absolute right-3 -translate-y-1/2 text-[10px] tabular-nums text-dls-tertiary" style={{ top: index * HOUR_HEIGHT }}>
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((day) => {
            const dayItems = (itemsByDate.get(localDateKey(day)) ?? []).sort((left, right) => (scheduledAt(left.item) ?? 0) - (scheduledAt(right.item) ?? 0));
            return (
              <WeekDayColumn
                key={localDateKey(day)}
                day={day}
                items={dayItems}
                canCreateSchedule={canCreateSchedule}
                onCreateSchedule={onCreateSchedule}
                onSelectItem={onSelectItem}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthDayCell(props: {
  day: Date;
  items: WorkCalendarItem[];
  inMonth: boolean;
  today: boolean;
  canCreateSchedule: boolean;
  onCreateSchedule: WorkCalendarProps["onCreateSchedule"];
  onSelectItem: WorkCalendarProps["onSelectItem"];
}) {
  const schedule = monthDayScheduleRange(props.day);
  const cell = (
    <div className="group relative min-h-28 border-b border-r border-dls-border p-2" data-testid="work-calendar-month-day">
      {props.canCreateSchedule ? (
        <button
          type="button"
          className="absolute inset-0 z-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`${t("work.new_schedule")} ${new Intl.DateTimeFormat(currentLocale(), { month: "short", day: "numeric" }).format(props.day)}`}
          onClick={() => props.onCreateSchedule(schedule)}
        />
      ) : null}
      <span className={cn("relative z-[1] flex size-6 pointer-events-none items-center justify-center rounded-full text-[11px]", props.today ? "bg-dls-text text-dls-surface" : props.inMonth ? "text-dls-text" : "text-dls-tertiary")}>{props.day.getDate()}</span>
      {props.canCreateSchedule ? (
        <span className="pointer-events-none absolute right-2 top-2 z-[1] flex items-center gap-1 rounded-md bg-dls-hover px-1.5 py-1 text-[9px] font-medium text-dls-secondary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Plus className="size-3" />{t("work.new_schedule")}
        </span>
      ) : null}
      <div className="relative z-[1] mt-1.5 space-y-1">
        {props.items.slice(0, 3).map((entry) => {
          const timestamp = scheduledAt(entry.item);
          return (
            <button
              key={entry.key}
              type="button"
              className={cn("block w-full truncate rounded-md border px-1.5 py-1 text-left text-[10px] font-medium transition hover:-translate-y-px", projectTone(entry.projectName))}
              onClick={(event) => {
                event.stopPropagation();
                props.onSelectItem(entry);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {timestamp === null ? "" : formatTime(timestamp)} {entry.item.title}
            </button>
          );
        })}
        {props.items.length > 3 ? <span className="block px-1 text-[10px] text-dls-tertiary">+{props.items.length - 3}</span> : null}
      </div>
    </div>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger render={cell} />
      <ContextMenuContent className="w-56">
        <ContextMenuItem disabled={!props.canCreateSchedule} onClick={() => props.onCreateSchedule(schedule)}>
          <Plus className="size-4" />{t("work.new_schedule")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MonthGrid({ items, anchorDate, canCreateSchedule, onCreateSchedule, onSelectItem }: Pick<WorkCalendarProps, "items" | "anchorDate" | "canCreateSchedule" | "onCreateSchedule" | "onSelectItem">) {
  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const gridStart = startOfWorkWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const itemsByDate = new Map<string, WorkCalendarItem[]>();
  for (const entry of items) {
    const timestamp = scheduledAt(entry.item);
    if (timestamp === null) continue;
    const key = localDateKey(new Date(timestamp));
    itemsByDate.set(key, [...(itemsByDate.get(key) ?? []), entry]);
  }
  return (
    <div className="hidden min-h-0 flex-1 overflow-auto lg:block">
      <div className="min-w-[820px]">
        <div className="sticky top-0 z-10 grid grid-cols-7 border-l border-t border-dls-border bg-dls-surface/90 backdrop-blur-xl">
          {days.slice(0, 7).map((day) => (
            <div key={localDateKey(day)} className="border-b border-r border-dls-border px-2 py-2 text-center text-[10px] font-medium uppercase tracking-[0.08em] text-dls-tertiary">
              {new Intl.DateTimeFormat(currentLocale(), { weekday: "short" }).format(day)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l border-dls-border">
          {days.map((day) => {
            const dayItems = (itemsByDate.get(localDateKey(day)) ?? []).sort((left, right) => (scheduledAt(left.item) ?? 0) - (scheduledAt(right.item) ?? 0));
            const inMonth = day.getMonth() === anchorDate.getMonth();
            const today = localDateKey(day) === localDateKey(new Date());
            return (
              <MonthDayCell
                key={localDateKey(day)}
                day={day}
                items={dayItems}
                inMonth={inMonth}
                today={today}
                canCreateSchedule={canCreateSchedule}
                onCreateSchedule={onCreateSchedule}
                onSelectItem={onSelectItem}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function WorkCalendar(props: WorkCalendarProps) {
  const range = workCalendarRange(props.anchorDate, props.view);
  const agendaItems = props.items.filter((entry) => {
    const startsAt = entry.item.startAt ?? entry.item.dueAt;
    const endsAt = entry.item.dueAt ?? entry.item.startAt;
    return startsAt !== null && endsAt !== null && endsAt >= range.from && startsAt <= range.to;
  });
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/20 bg-dls-surface/90 shadow-[0_22px_60px_rgba(30,48,74,0.10),inset_0_1px_0_rgba(255,255,255,0.55)] backdrop-blur-2xl dark:border-white/[0.07] dark:shadow-[0_22px_70px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.05)]">
      <CalendarToolbar {...props} />
      <div className="min-h-0 flex-1 overflow-y-auto lg:hidden">
        <AgendaList items={agendaItems} onSelectItem={props.onSelectItem} />
      </div>
      {props.view === "week" ? (
        <WeekGrid items={props.items} anchorDate={props.anchorDate} canCreateSchedule={props.canCreateSchedule} onCreateSchedule={props.onCreateSchedule} onSelectItem={props.onSelectItem} />
      ) : (
        <MonthGrid items={props.items} anchorDate={props.anchorDate} canCreateSchedule={props.canCreateSchedule} onCreateSchedule={props.onCreateSchedule} onSelectItem={props.onSelectItem} />
      )}
      <div className="hidden items-center gap-2 border-t border-dls-border px-4 py-2 text-[10px] text-dls-tertiary lg:flex">
        <Clock3 className="size-3" />
        {t("work.calendar.timezone", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
      </div>
    </section>
  );
}
