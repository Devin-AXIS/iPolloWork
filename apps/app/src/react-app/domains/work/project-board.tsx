/** @jsxImportSource react */
import * as React from "react";
import { Bot, CheckCircle2, Clock3, LoaderCircle, LockKeyhole, Plus, UserRound, XCircle } from "lucide-react";
import type { WorkBoardColumn, WorkBoardConfig } from "@ipollowork/types/work-items";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

import type { WorkCalendarItem } from "./work-calendar";
import type { ProjectRuntimeExecutionRecord } from "./project-runtime-metrics";

export type ProjectBoardItem = WorkCalendarItem & {
  executionRecord?: ProjectRuntimeExecutionRecord;
};

const COLUMN_TONE_CLASS: Record<WorkBoardColumn["tone"], string> = {
  neutral: "bg-zinc-9",
  blue: "bg-sky-9",
  amber: "bg-amber-9",
  violet: "bg-violet-9",
  green: "bg-emerald-9",
  rose: "bg-rose-9",
};

function formatDue(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function priorityLabel(priority: WorkCalendarItem["item"]["priority"]): string {
  if (priority === "urgent") return t("work.priority.urgent");
  if (priority === "high") return t("work.priority.high");
  if (priority === "low") return t("work.priority.low");
  return t("work.priority.normal");
}

function itemStatusColumns(board: WorkBoardConfig, items: ProjectBoardItem[]): WorkBoardColumn[] {
  const known = new Set(board.columns.map((column) => column.id));
  const unknown = Array.from(new Set(items.map((entry) => entry.item.status).filter((status) => !known.has(status))));
  const unknownColumns: WorkBoardColumn[] = unknown.map((status) => ({ id: status, label: status, tone: "neutral" }));
  return [...board.columns, ...unknownColumns];
}

function formatTokens(value: number | null): string | null {
  if (value === null) return null;
  if (value < 1_000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}

function executionStatus(record: ProjectRuntimeExecutionRecord) {
  if (record.status === "running") {
    return { label: t("project_overview.active_tasks"), icon: LoaderCircle, className: "bg-amber-4 text-amber-11" };
  }
  if (record.status === "failed") {
    return { label: t("project_overview.failed_tasks"), icon: XCircle, className: "bg-rose-4 text-rose-11" };
  }
  if (record.status === "completed") {
    return { label: t("project_overview.completed_tasks"), icon: CheckCircle2, className: "bg-emerald-4 text-emerald-11" };
  }
  return { label: t("project_overview.execution_recorded"), icon: Bot, className: "bg-dls-hover text-dls-secondary" };
}

function BoardCard({
  entry,
  board,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  entry: ProjectBoardItem;
  board: WorkBoardConfig;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: (() => void) | null;
}) {
  const visibleFields = board.fields
    .filter((field) => field.showOnCard && entry.item.customFields[field.id] !== undefined)
    .slice(0, 2);
  const due = formatDue(entry.item.dueAt ?? entry.item.startAt);
  const executionBound = Boolean(entry.item.execution || entry.executionRecord);
  const runtimeStatus = entry.executionRecord ? executionStatus(entry.executionRecord) : null;
  const runtimeTokens = entry.executionRecord ? formatTokens(entry.executionRecord.tokens) : null;
  const RuntimeStatusIcon = runtimeStatus?.icon;
  return (
    <article
      draggable={!executionBound}
      data-execution-status={entry.executionRecord?.status}
      data-testid={entry.executionRecord ? "project-runtime-task" : undefined}
      onDragStart={(event) => {
        if (executionBound) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", entry.key);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-xl border border-dls-border/70 bg-white transition-[border-color,background-color,opacity] hover:border-dls-border dark:bg-dls-surface",
        dragging && "opacity-45",
      )}
    >
      <button
        type="button"
        className="w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        disabled={!onOpen}
        onClick={onOpen ?? undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-[14px] font-semibold leading-5 text-dls-text">{entry.item.title}</h3>
          {runtimeStatus && RuntimeStatusIcon ? (
            <span className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-[15px]", runtimeStatus.className)}>
              <RuntimeStatusIcon className={cn("size-3", entry.executionRecord?.status === "running" && "animate-spin")} />
              {runtimeStatus.label}
            </span>
          ) : entry.item.priority === "urgent" || entry.item.priority === "high" ? (
            <span className={cn("mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-[15px]", entry.item.priority === "urgent" ? "bg-red-4 text-red-11" : "bg-amber-4 text-amber-11")}>
              {priorityLabel(entry.item.priority)}
            </span>
          ) : null}
        </div>
        {entry.item.description ? <p className="mt-1.5 line-clamp-2 text-[11px] leading-[15px] text-dls-secondary">{entry.item.description}</p> : null}
        {visibleFields.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {visibleFields.map((field) => (
              <span key={field.id} className="max-w-full truncate rounded-md bg-dls-hover px-1.5 py-0.5 text-[11px] leading-[15px] text-dls-secondary">
                {field.label}: {String(entry.item.customFields[field.id])}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex items-center gap-2 text-[11px] leading-[15px] text-dls-text/45">
          {executionBound ? <span className="flex shrink-0 items-center gap-1" title={t("work.execution.immutable")}><LockKeyhole className="size-3" />{t("work.execution.bound")}</span> : null}
          {entry.item.assignee ? <span className="flex min-w-0 items-center gap-1">{entry.executionRecord ? <Bot className="size-3" /> : <UserRound className="size-3" />}<span className="truncate">{entry.item.assignee}</span></span> : null}
          {runtimeTokens ? <span className="ml-auto shrink-0 tabular-nums">{runtimeTokens} Token</span> : null}
          {due ? <span className="ml-auto flex shrink-0 items-center gap-1"><Clock3 className="size-3" />{due}</span> : null}
        </div>
      </button>
    </article>
  );
}

export function ProjectBoard({
  items,
  board,
  moving,
  onMove,
  onOpen,
  onCreate,
}: {
  items: ProjectBoardItem[];
  board: WorkBoardConfig;
  moving: boolean;
  onMove: (entryKey: string, status: string, position: number) => void;
  onOpen: (entryKey: string) => void;
  onCreate: (status: string) => void;
}) {
  const [draggingKey, setDraggingKey] = React.useState<string | null>(null);
  const columns = itemStatusColumns(board, items);
  const dragged = draggingKey ? items.find((entry) => entry.key === draggingKey) ?? null : null;
  return (
    <div className="no-scrollbar flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2" data-testid="project-board">
      {columns.map((column) => {
        const columnItems = items
          .filter((entry) => entry.item.status === column.id)
          .sort((left, right) => left.item.position - right.item.position);
        return (
          <section
            key={column.id}
            className="flex min-h-0 w-[286px] shrink-0 flex-col rounded-2xl border border-dls-border/70 bg-white dark:bg-dls-surface"
            data-status={column.id}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const key = event.dataTransfer.getData("text/plain") || draggingKey;
              const entry = items.find((candidate) => candidate.key === key);
              setDraggingKey(null);
              if (!entry || entry.item.execution || entry.executionRecord || entry.item.status === column.id) return;
              const lastPosition = columnItems[columnItems.length - 1]?.item.position ?? 0;
              onMove(entry.key, column.id, lastPosition + 1024);
            }}
          >
            <header className="flex h-11 shrink-0 items-center gap-2 px-3">
              <span className={cn("h-4 w-1 rounded-full", COLUMN_TONE_CLASS[column.tone])} aria-hidden="true" />
              <h2 className="text-[14px] font-semibold leading-5 text-dls-text">{column.label}</h2>
              <span className="text-[11px] leading-[15px] tabular-nums text-dls-text/45">{columnItems.length}</span>
              <Button type="button" variant="ghost" size="icon-sm" className="ml-auto size-7" aria-label={t("work.add_to_column", { column: column.label })} onClick={() => onCreate(column.id)}>
                <Plus className="size-3.5" />
              </Button>
            </header>
            <div className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {columnItems.map((entry) => (
                <BoardCard
                  key={entry.key}
                  entry={entry}
                  board={board}
                  dragging={draggingKey === entry.key}
                  onDragStart={() => setDraggingKey(entry.key)}
                  onDragEnd={() => setDraggingKey(null)}
                  onOpen={entry.executionRecord ? null : () => onOpen(entry.key)}
                />
              ))}
              {!columnItems.length ? (
                <button
                  type="button"
                  className="flex min-h-24 w-full items-center justify-center rounded-xl border border-dashed border-dls-border px-4 text-[11px] leading-[15px] text-dls-text/45 transition hover:bg-dls-surface/45 hover:text-dls-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onCreate(column.id)}
                >
                  {moving && dragged ? t("work.board.moving") : t("work.board.empty_column")}
                </button>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
