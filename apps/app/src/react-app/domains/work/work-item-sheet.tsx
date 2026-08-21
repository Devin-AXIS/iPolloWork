/** @jsxImportSource react */
import * as React from "react";
import { CalendarClock, ChevronDown, LockKeyhole, Trash2 } from "lucide-react";
import type {
  WorkBoardConfig,
  WorkItem,
  WorkItemPriority,
} from "@ipollowork/types/work-items";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";

export type WorkItemEditorValue = {
  title: string;
  description: string | null;
  status: string;
  assignee: string | null;
  priority: WorkItemPriority;
  startAt: number | null;
  dueAt: number | null;
  customFields: Record<string, string | number | boolean | null>;
};

type WorkItemSheetProps = {
  open: boolean;
  item: WorkItem | null;
  board: WorkBoardConfig;
  defaultStatus: string;
  saving: boolean;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: WorkItemEditorValue) => void;
  onDelete?: () => void;
};

const fieldClassName = "h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

function toDateTimeInput(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInput(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function priorityFromValue(value: string): WorkItemPriority {
  if (value === "low" || value === "high" || value === "urgent") return value;
  return "normal";
}

function timeSummary(startAt: number | null, dueAt: number | null): string {
  if (startAt === null && dueAt === null) return t("work.time.unscheduled");
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (startAt !== null && dueAt !== null) {
    return `${formatter.format(startAt)} – ${formatter.format(dueAt)}`;
  }
  return formatter.format(startAt ?? dueAt ?? 0);
}

function emptyEditorValue(status: string): WorkItemEditorValue {
  return {
    title: "",
    description: null,
    status,
    assignee: null,
    priority: "normal",
    startAt: null,
    dueAt: null,
    customFields: {},
  };
}

export function WorkItemSheet(props: WorkItemSheetProps) {
  const [value, setValue] = React.useState<WorkItemEditorValue>(() => emptyEditorValue(props.defaultStatus));
  const [timeOpen, setTimeOpen] = React.useState(false);

  React.useEffect(() => {
    if (!props.open) return;
    setValue(props.item ? {
      title: props.item.title,
      description: props.item.description,
      status: props.item.status,
      assignee: props.item.assignee,
      priority: props.item.priority,
      startAt: props.item.startAt,
      dueAt: props.item.dueAt,
      customFields: props.item.customFields,
    } : emptyEditorValue(props.defaultStatus));
    setTimeOpen(Boolean(props.item && (props.item.startAt !== null || props.item.dueAt !== null)));
  }, [props.defaultStatus, props.item, props.open]);

  const invalidRange = value.startAt !== null && value.dueAt !== null && value.dueAt < value.startAt;
  const updateCustomField = (fieldId: string, next: string | number | boolean | null) => {
    setValue((current) => ({
      ...current,
      customFields: { ...current.customFields, [fieldId]: next },
    }));
  };

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(440px,94vw)] border-l border-white/15 bg-dls-surface/95 shadow-[-24px_0_70px_rgba(20,32,58,0.16)] backdrop-blur-2xl sm:max-w-[440px]"
        data-testid="work-item-sheet"
      >
        <SheetHeader className="border-b border-dls-border px-6 pb-5 pt-6">
          <SheetTitle>{props.item ? t("work.editor.edit_title") : t("work.editor.create_title")}</SheetTitle>
          <SheetDescription>{props.item ? t("work.editor.edit_description") : t("work.editor.create_description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {props.item?.execution ? (
            <div className="rounded-xl border border-dls-border/75 bg-dls-hover/30 px-3.5 py-3" data-testid="work-item-execution-binding">
              <div className="flex items-center gap-2 text-[11px] font-medium text-dls-text">
                <LockKeyhole className="size-3.5 text-dls-secondary" />
                {t("work.execution.bound")}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-dls-secondary">
                <span className="max-w-full truncate rounded-md bg-dls-surface/80 px-2 py-1">{t("work.execution.agent")} · {props.item.execution.agent.name}</span>
                <span className="max-w-full truncate rounded-md bg-dls-surface/80 px-2 py-1">{t("work.execution.runtime")} · {props.item.execution.runtime.engineId}</span>
                <span className="max-w-full truncate rounded-md bg-dls-surface/80 px-2 py-1">
                  {t("work.execution.model")} · {props.item.execution.runtime.model
                    ? props.item.execution.runtime.model.modelId
                    : t("project_overview.follow_project")}
                </span>
              </div>
              <p className="mt-2 text-[9px] leading-4 text-dls-tertiary">{t("work.execution.immutable")}</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="work-item-title">{t("work.field.title")}</Label>
            <Input
              id="work-item-title"
              autoFocus
              value={value.title}
              placeholder={t("work.field.title_placeholder")}
              onChange={(event) => {
                const title = event.currentTarget.value;
                setValue((current) => ({ ...current, title }));
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="work-item-description">{t("work.field.description")}</Label>
            <Textarea
              id="work-item-description"
              value={value.description ?? ""}
              placeholder={t("work.field.description_placeholder")}
              className="min-h-24"
              onChange={(event) => {
                const description = event.currentTarget.value || null;
                setValue((current) => ({ ...current, description }));
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="work-item-status">{t("work.field.status")}</Label>
              <select
                id="work-item-status"
                value={value.status}
                disabled={Boolean(props.item?.execution)}
                className={fieldClassName}
                onChange={(event) => {
                  const status = event.currentTarget.value;
                  setValue((current) => ({ ...current, status }));
                }}
              >
                {props.board.columns.map((column) => (
                  <option key={column.id} value={column.id}>{column.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-item-priority">{t("work.field.priority")}</Label>
              <select
                id="work-item-priority"
                value={value.priority}
                className={fieldClassName}
                onChange={(event) => {
                  const priority = priorityFromValue(event.currentTarget.value);
                  setValue((current) => ({ ...current, priority }));
                }}
              >
                <option value="low">{t("work.priority.low")}</option>
                <option value="normal">{t("work.priority.normal")}</option>
                <option value="high">{t("work.priority.high")}</option>
                <option value="urgent">{t("work.priority.urgent")}</option>
              </select>
            </div>
          </div>

          {!props.item?.execution ? <div className="space-y-2">
            <Label htmlFor="work-item-assignee">{t("work.field.assignee")}</Label>
            <Input
              id="work-item-assignee"
              value={value.assignee ?? ""}
              placeholder={t("work.field.assignee_placeholder")}
              onChange={(event) => {
                const assignee = event.currentTarget.value || null;
                setValue((current) => ({ ...current, assignee }));
              }}
            />
          </div> : null}

          <Collapsible open={timeOpen} onOpenChange={setTimeOpen} className="rounded-xl border border-dls-border/75 bg-dls-surface/45">
            <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <CalendarClock className="size-3.5 shrink-0 text-dls-secondary" />
              <span className="text-[12px] font-medium text-dls-text">{t("work.time.title")}</span>
              <span className="ml-auto min-w-0 truncate text-[10px] text-dls-tertiary">{timeSummary(value.startAt, value.dueAt)}</span>
              <ChevronDown className="size-3.5 shrink-0 text-dls-tertiary transition-transform group-aria-expanded:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-dls-border/70 px-3.5 py-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="work-item-start">{t("work.field.start")}</Label>
                  <Input
                    id="work-item-start"
                    type="datetime-local"
                    value={toDateTimeInput(value.startAt)}
                    onInput={(event) => {
                      const startAt = fromDateTimeInput(event.currentTarget.value);
                      setValue((current) => ({ ...current, startAt }));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="work-item-due">{t("work.field.due")}</Label>
                  <Input
                    id="work-item-due"
                    type="datetime-local"
                    value={toDateTimeInput(value.dueAt)}
                    aria-invalid={invalidRange}
                    onInput={(event) => {
                      const dueAt = fromDateTimeInput(event.currentTarget.value);
                      setValue((current) => ({ ...current, dueAt }));
                    }}
                  />
                </div>
              </div>
              {invalidRange ? <p className="mt-2 text-xs text-destructive">{t("work.field.invalid_range")}</p> : null}
            </CollapsibleContent>
          </Collapsible>

          {props.board.fields.length ? (
            <div className="space-y-4 border-t border-dls-border pt-5">
              <p className="text-xs font-medium text-dls-secondary">{t("work.custom_fields")}</p>
              {props.board.fields.map((field) => {
                const current = value.customFields[field.id];
                if (field.type === "checkbox") {
                  return (
                    <label key={field.id} className="flex items-center justify-between gap-3 text-[13px] text-dls-text">
                      <span>{field.label}</span>
                      <input
                        type="checkbox"
                        checked={current === true}
                        className="size-4 accent-[var(--dls-accent)]"
                        onChange={(event) => updateCustomField(field.id, event.currentTarget.checked)}
                      />
                    </label>
                  );
                }
                if (field.type === "select") {
                  return (
                    <div key={field.id} className="space-y-2">
                      <Label htmlFor={`custom-${field.id}`}>{field.label}</Label>
                      <select
                        id={`custom-${field.id}`}
                        value={typeof current === "string" ? current : ""}
                        className={fieldClassName}
                        onChange={(event) => updateCustomField(field.id, event.currentTarget.value || null)}
                      >
                        <option value="">{t("work.field.not_set")}</option>
                        {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </div>
                  );
                }
                return (
                  <div key={field.id} className="space-y-2">
                    <Label htmlFor={`custom-${field.id}`}>{field.label}</Label>
                    <Input
                      id={`custom-${field.id}`}
                      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                      value={typeof current === "string" || typeof current === "number" ? current : ""}
                      onInput={(event) => updateCustomField(
                        field.id,
                        field.type === "number"
                          ? event.currentTarget.value ? Number(event.currentTarget.value) : null
                          : event.currentTarget.value || null,
                      )}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t border-dls-border px-6 py-4">
          {props.item && props.onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={props.saving || props.deleting}
              onClick={props.onDelete}
            >
              <Trash2 className="size-4" />
              {t("common.delete")}
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!value.title.trim() || invalidRange || props.saving || props.deleting}
              onClick={() => props.onSave({ ...value, title: value.title.trim() })}
            >
              {props.saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
