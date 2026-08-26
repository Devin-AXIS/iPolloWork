/** @jsxImportSource react */
import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, Search, Timer } from "lucide-react";
import type { WorkItem } from "@ipollowork/types/work-items";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { menuSurfaceClassName } from "@/components/ui/menu-styles";
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
const TASK_TONES = [
  {
    block: "bg-cyan-4/80 text-cyan-12 before:bg-cyan-9 hover:bg-cyan-5/80 focus-visible:ring-cyan-8/50",
    compact: "border-cyan-8/40 bg-cyan-4/80 text-cyan-12",
    marker: "border-cyan-8/40 bg-cyan-9",
  },
  {
    block: "bg-sky-4/80 text-sky-12 before:bg-sky-9 hover:bg-sky-5/80 focus-visible:ring-sky-8/50",
    compact: "border-sky-8/40 bg-sky-4/80 text-sky-12",
    marker: "border-sky-8/40 bg-sky-9",
  },
  {
    block: "bg-violet-4/80 text-violet-12 before:bg-violet-9 hover:bg-violet-5/80 focus-visible:ring-violet-8/50",
    compact: "border-violet-8/40 bg-violet-4/80 text-violet-12",
    marker: "border-violet-8/40 bg-violet-9",
  },
  {
    block: "bg-rose-4/80 text-rose-12 before:bg-rose-9 hover:bg-rose-5/80 focus-visible:ring-rose-8/50",
    compact: "border-rose-8/40 bg-rose-4/80 text-rose-12",
    marker: "border-rose-8/40 bg-rose-9",
  },
  {
    block: "bg-amber-4/80 text-amber-12 before:bg-amber-9 hover:bg-amber-5/80 focus-visible:ring-amber-8/50",
    compact: "border-amber-8/40 bg-amber-4/80 text-amber-12",
    marker: "border-amber-8/40 bg-amber-9",
  },
  {
    block: "bg-grass-4/80 text-grass-12 before:bg-grass-9 hover:bg-grass-5/80 focus-visible:ring-grass-8/50",
    compact: "border-grass-8/40 bg-grass-4/80 text-grass-12",
    marker: "border-grass-8/40 bg-grass-9",
  },
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

export function formatWorkCalendarRange(anchorDate: Date, view: WorkCalendarView, locale = currentLocale()): string {
  if (view === "month") {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(anchorDate);
  }
  const start = startOfWorkWeek(anchorDate);
  const end = addDays(start, 6);
  if (locale.toLowerCase().startsWith("zh")) {
    const formatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" });
    return `${formatter.format(start)} - ${formatter.format(end)}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = new Intl.DateTimeFormat(locale, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(end);
  return `${startLabel} - ${endLabel}`;
}

export function formatWorkCalendarTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function searchWorkCalendarItems(items: WorkCalendarItem[], query: string): WorkCalendarItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((entry) => `${entry.item.title} ${entry.projectName}`.toLocaleLowerCase().includes(normalizedQuery));
}

function taskTone(taskTitle: string): (typeof TASK_TONES)[number] {
  let hash = 0;
  for (const character of taskTitle) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return TASK_TONES[hash % TASK_TONES.length];
}

function CalendarToolbar(props: Pick<WorkCalendarProps, "items" | "anchorDate" | "view" | "onAnchorDateChange" | "onViewChange"> & {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const isToday = localDateKey(props.anchorDate) === localDateKey(new Date());
  const searchResults = searchWorkCalendarItems(props.items, props.searchQuery)
    .filter((entry) => scheduledAt(entry.item) !== null)
    .sort((left, right) => (scheduledAt(left.item) ?? 0) - (scheduledAt(right.item) ?? 0))
    .slice(0, 8);
  const movePeriod = (direction: -1 | 1) => {
    props.onAnchorDateChange(props.view === "week"
      ? addDays(props.anchorDate, direction * 7)
      : addMonths(props.anchorDate, direction));
  };
  const locateItem = (entry: WorkCalendarItem) => {
    const timestamp = scheduledAt(entry.item);
    if (timestamp === null) return;
    props.onSearchQueryChange(entry.item.title);
    props.onAnchorDateChange(new Date(timestamp));
    setSearchOpen(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-dls-border px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 gap-px">
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-l-md bg-dls-hover text-dls-text transition-colors hover:bg-dls-active focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("work.calendar.previous")}
            onClick={() => movePeriod(-1)}
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            className="h-7 shrink-0 bg-dls-hover px-4 text-[12px] font-normal leading-4 text-dls-text transition-colors hover:bg-dls-active focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => props.onAnchorDateChange(new Date())}
          >
            {t(isToday ? "work.calendar.today" : "work.calendar.back_to_today")}
          </button>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-r-md bg-dls-hover text-dls-text transition-colors hover:bg-dls-active focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("work.calendar.next")}
            onClick={() => movePeriod(1)}
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
        <h2 className="truncate text-[15px] font-medium tracking-[-0.2px] text-dls-text">{formatWorkCalendarRange(props.anchorDate, props.view)}</h2>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-4">
        <div className="inline-flex items-center">
          <button
            type="button"
            className={cn(
              "h-7 rounded-lg px-4 text-[13px] font-medium leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              props.view === "week" ? "bg-dls-active text-dls-text" : "text-dls-secondary hover:bg-dls-hover",
            )}
            onClick={() => props.onViewChange("week")}
          >
            {t("work.calendar.week")}
          </button>
          <button
            type="button"
            className={cn(
              "h-7 rounded-lg px-4 text-[13px] font-medium leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              props.view === "month" ? "bg-dls-active text-dls-text" : "text-dls-secondary hover:bg-dls-hover",
            )}
            onClick={() => props.onViewChange("month")}
          >
            {t("work.calendar.month")}
          </button>
        </div>
        <div
          className="relative w-[184px]"
          onFocusCapture={() => setSearchOpen(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
          }}
        >
          <Search className="pointer-events-none absolute left-2 top-1/2 z-[1] size-3.5 -translate-y-1/2 text-dls-secondary" />
          <Input
            type="search"
            value={props.searchQuery}
            data-testid="work-calendar-search"
            className="h-7 rounded-lg border-0 bg-dls-hover py-1 pl-[30px] pr-2 text-[12px] font-normal leading-[18px] text-dls-text shadow-none placeholder:text-dls-tertiary focus-visible:ring-2 focus-visible:ring-ring/30"
            placeholder={t("work.calendar.search_placeholder")}
            aria-expanded={searchOpen && Boolean(props.searchQuery.trim())}
            onChange={(event) => {
              props.onSearchQueryChange(event.currentTarget.value);
              setSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && searchResults[0]) locateItem(searchResults[0]);
              if (event.key === "Escape") {
                props.onSearchQueryChange("");
                setSearchOpen(false);
              }
            }}
          />
          {searchOpen && props.searchQuery.trim() ? (
            <div className={cn(menuSurfaceClassName, "absolute right-0 top-9 z-30 w-72 gap-0 overflow-hidden p-1")}>
              {searchResults.length ? searchResults.map((entry) => {
                const timestamp = scheduledAt(entry.item);
                if (timestamp === null) return null;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none"
                    onClick={() => locateItem(entry)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-dls-text">{entry.item.title}</span>
                      <span className="block truncate text-[10px] text-dls-tertiary">{entry.projectName}</span>
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-dls-secondary">
                      {new Intl.DateTimeFormat(currentLocale(), { month: "short", day: "numeric" }).format(timestamp)} {formatWorkCalendarTime(timestamp)}
                    </span>
                  </button>
                );
              }) : (
                <p className="px-2 py-3 text-center text-[11px] text-dls-tertiary">{t("work.calendar.search_empty")}</p>
              )}
            </div>
          ) : null}
        </div>
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
              <span className="mt-0.5 block text-[10px] font-normal text-dls-tertiary">{formatWorkCalendarTime(time)}</span>
            </div>
            <span className={cn("h-8 w-1 shrink-0 rounded-full border", taskTone(entry.item.title).marker)} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-dls-text">
                <span className="truncate">{entry.item.title}</span>
                {entry.item.automation?.enabled ? <Timer className="size-3 shrink-0" aria-label={t("work.automation.enabled")} /> : null}
              </span>
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
          <span className="mt-0.5 block text-[9px] tabular-nums">{formatWorkCalendarTime(schedule.startAt)}–{formatWorkCalendarTime(schedule.dueAt)}</span>
        </div>
      ) : null}
      {props.items.map((entry) => {
        const timestamp = scheduledAt(entry.item);
        if (timestamp === null) return null;
        const start = new Date(timestamp);
        const minutes = Math.max(0, (start.getHours() - HOUR_START) * 60 + start.getMinutes());
        const endTimestamp = entry.item.dueAt ?? timestamp + 45 * 60_000;
        const duration = Math.max(30, Math.min((endTimestamp - timestamp) / 60_000, 180));
        const top = Math.min(minutes / 60 * HOUR_HEIGHT, (HOUR_END - HOUR_START) * HOUR_HEIGHT);
        const height = Math.max(34, duration / 60 * HOUR_HEIGHT - 2);
        const tone = taskTone(entry.item.title);
        return (
          <button
            key={entry.key}
            type="button"
            className={cn("absolute z-[1] flex flex-col items-start justify-start overflow-hidden rounded-[4px] py-1.5 pl-[9px] pr-1.5 text-left transition-colors before:absolute before:inset-y-0 before:left-0 before:w-[3px] hover:z-[2] focus-visible:z-[2] focus-visible:outline-none focus-visible:ring-2", tone.block)}
            style={{ top, height, left: 5, right: 5 }}
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
            <span className="flex h-[18px] w-full shrink-0 items-center gap-1 text-[12px] font-semibold leading-[18px]" data-testid="work-calendar-event-title">
              <span className="min-w-0 truncate">{entry.item.title}</span>
              {entry.item.automation?.enabled ? (
                <span className="flex size-3 shrink-0 items-center justify-center rounded-full bg-dls-text text-dls-surface">
                  <Timer className="size-2" aria-label={t("work.automation.enabled")} />
                </span>
              ) : null}
            </span>
            {duration >= 45 ? (
              <span className="block h-4 w-full shrink-0 truncate text-[11px] font-medium leading-4" data-testid="work-calendar-event-project">{entry.projectName}</span>
            ) : null}
            {duration >= 60 ? (
              <span className="block h-[15px] w-full shrink-0 truncate text-[10px] font-normal leading-[15px] tabular-nums opacity-75" data-testid="work-calendar-event-time">
                {formatWorkCalendarTime(timestamp)}–{formatWorkCalendarTime(endTimestamp)}
              </span>
            ) : null}
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
          <span className="min-w-0"><span className="block">{t("work.new_schedule")}</span>{schedule ? <span className="block text-[10px] font-normal text-muted-foreground">{formatWorkCalendarTime(schedule.startAt)}–{formatWorkCalendarTime(schedule.dueAt)}</span> : null}</span>
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
              <span
                key={hour}
                className={cn("absolute right-3 text-[10px] tabular-nums text-dls-tertiary", index > 0 && "-translate-y-1/2")}
                style={{ top: index === 0 ? 8 : index * HOUR_HEIGHT }}
              >
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
              className={cn("block w-full truncate rounded-md border px-1.5 py-1 text-left text-[10px] font-medium transition hover:-translate-y-px", taskTone(entry.item.title).compact)}
              onClick={(event) => {
                event.stopPropagation();
                props.onSelectItem(entry);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <span className="flex items-center gap-1">
                {entry.item.automation?.enabled ? <Timer className="size-3 shrink-0" aria-label={t("work.automation.enabled")} /> : null}
                <span className="truncate">{timestamp === null ? "" : formatWorkCalendarTime(timestamp)} {entry.item.title}</span>
              </span>
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
  const [searchQuery, setSearchQuery] = React.useState("");
  const range = workCalendarRange(props.anchorDate, props.view);
  const visibleItems = searchWorkCalendarItems(props.items, searchQuery);
  const agendaItems = visibleItems.filter((entry) => {
    const startsAt = entry.item.startAt ?? entry.item.dueAt;
    const endsAt = entry.item.dueAt ?? entry.item.startAt;
    return startsAt !== null && endsAt !== null && endsAt >= range.from && startsAt <= range.to;
  });
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-dls-border bg-dls-surface/90 shadow-lg backdrop-blur-2xl">
      <CalendarToolbar {...props} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} />
      <div className="min-h-0 flex-1 overflow-y-auto lg:hidden">
        <AgendaList items={agendaItems} onSelectItem={props.onSelectItem} />
      </div>
      {props.view === "week" ? (
        <WeekGrid items={visibleItems} anchorDate={props.anchorDate} canCreateSchedule={props.canCreateSchedule} onCreateSchedule={props.onCreateSchedule} onSelectItem={props.onSelectItem} />
      ) : (
        <MonthGrid items={visibleItems} anchorDate={props.anchorDate} canCreateSchedule={props.canCreateSchedule} onCreateSchedule={props.onCreateSchedule} onSelectItem={props.onSelectItem} />
      )}
      <div className="hidden items-center gap-2 border-t border-dls-border px-4 py-2 text-[10px] text-dls-tertiary lg:flex">
        <Clock3 className="size-3" />
        {t("work.calendar.timezone", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
      </div>
    </section>
  );
}
