/** @jsxImportSource react */
import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Timer } from "lucide-react";
import type { WorkItem } from "@ipollowork/types/work-items";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentLocale, t } from "@/i18n";

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
  onAnchorDateChange: (date: Date) => void;
  onViewChange: (view: WorkCalendarView) => void;
  onSelectItem: (item: WorkCalendarItem) => void;
};

const HOUR_START = 6;
const HOUR_END = 22;
const HOUR_HEIGHT = 64;
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
          {t("work.calendar.today")}
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

function WeekGrid({ items, anchorDate, onSelectItem }: Pick<WorkCalendarProps, "items" | "anchorDate" | "onSelectItem">) {
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
              <div
                key={localDateKey(day)}
                className="relative border-r border-dls-border bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_63px,var(--dls-border)_64px)]"
              >
                {dayItems.map((entry, index) => {
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
                      onClick={() => onSelectItem(entry)}
                    >
                      <span className="flex items-center gap-1 text-[11px] font-semibold">
                        <span className="truncate">{entry.item.title}</span>
                        {entry.item.automation?.enabled ? <Timer className="size-3 shrink-0" aria-label={t("work.automation.enabled")} /> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[9px] opacity-70">{formatTime(timestamp)} {entry.projectName}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ items, anchorDate, onSelectItem }: Pick<WorkCalendarProps, "items" | "anchorDate" | "onSelectItem">) {
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
              <div key={localDateKey(day)} className="min-h-28 border-b border-r border-dls-border p-2">
                <span className={cn("flex size-6 items-center justify-center rounded-full text-[11px]", today ? "bg-dls-text text-dls-surface" : inMonth ? "text-dls-text" : "text-dls-tertiary")}>{day.getDate()}</span>
                <div className="mt-1.5 space-y-1">
                  {dayItems.slice(0, 3).map((entry) => {
                    const timestamp = scheduledAt(entry.item);
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        className={cn("block w-full truncate rounded-md border px-1.5 py-1 text-left text-[10px] font-medium transition hover:-translate-y-px", projectTone(entry.projectName))}
                        onClick={() => onSelectItem(entry)}
                      >
                        <span className="flex items-center gap-1">
                          {entry.item.automation?.enabled ? <Timer className="size-3 shrink-0" aria-label={t("work.automation.enabled")} /> : null}
                          <span className="truncate">{timestamp === null ? "" : formatTime(timestamp)} {entry.item.title}</span>
                        </span>
                      </button>
                    );
                  })}
                  {dayItems.length > 3 ? <span className="block px-1 text-[10px] text-dls-tertiary">+{dayItems.length - 3}</span> : null}
                </div>
              </div>
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
      {props.view === "week" ? <WeekGrid items={props.items} anchorDate={props.anchorDate} onSelectItem={props.onSelectItem} /> : <MonthGrid items={props.items} anchorDate={props.anchorDate} onSelectItem={props.onSelectItem} />}
      <div className="hidden items-center gap-2 border-t border-dls-border px-4 py-2 text-[10px] text-dls-tertiary lg:flex">
        <Clock3 className="size-3" />
        {t("work.calendar.timezone", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
      </div>
    </section>
  );
}
