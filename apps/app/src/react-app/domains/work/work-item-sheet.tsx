/** @jsxImportSource react */
import * as React from "react";
import { CalendarClock, ChevronDown, LockKeyhole, Trash2 } from "lucide-react";
import {
  WORK_ITEM_TITLE_MAX_LENGTH,
  type WorkBoardConfig,
  type WorkItem,
  type WorkItemPriority,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
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

export type WorkItemScheduleDraft = {
  startAt: number;
  dueAt: number;
};

type WorkItemSheetProps = {
  open: boolean;
  item: WorkItem | null;
  board: WorkBoardConfig;
  defaultStatus: string;
  scheduleMode: boolean;
  initialSchedule: WorkItemScheduleDraft | null;
  saving: boolean;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: WorkItemEditorValue) => void;
  onDelete?: () => void;
};

const filledValueClassName = "font-medium text-dls-accent dark:text-dls-text";
const placeholderClassName = "placeholder:font-normal placeholder:text-dls-secondary/60";
const compactInputClassName = `h-[34px] rounded-lg px-2 text-[13px] ${filledValueClassName} ${placeholderClassName}`;
const compactSelectTriggerClassName = `h-[34px] w-full rounded-lg border-border bg-background px-2 py-2 text-[13px] shadow-none data-[size=default]:h-[34px] ${filledValueClassName}`;
const UNSET_CUSTOM_FIELD_VALUE = "__unset__";
const SCHEDULE_SLOT_MS = 30 * 60 * 1_000;
const DEFAULT_SCHEDULE_DURATION_MS = 60 * 60 * 1_000;

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

function formatDateTime(timestamp: number | null): string {
  if (timestamp === null) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(timestamp);
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

function emptyEditorValue(status: string, scheduled: boolean, initialSchedule: WorkItemScheduleDraft | null): WorkItemEditorValue {
  const startAt = initialSchedule?.startAt ?? (scheduled ? Math.ceil(Date.now() / SCHEDULE_SLOT_MS) * SCHEDULE_SLOT_MS : null);
  return {
    title: "",
    description: null,
    status,
    assignee: null,
    priority: "normal",
    startAt,
    dueAt: initialSchedule?.dueAt ?? (startAt === null ? null : startAt + DEFAULT_SCHEDULE_DURATION_MS),
    customFields: {},
  };
}

function editorValuesEqual(left: WorkItemEditorValue, right: WorkItemEditorValue): boolean {
  return left.title === right.title
    && left.description === right.description
    && left.status === right.status
    && left.assignee === right.assignee
    && left.priority === right.priority
    && left.startAt === right.startAt
    && left.dueAt === right.dueAt
    && JSON.stringify(left.customFields) === JSON.stringify(right.customFields);
}

function RequiredMark() {
  return <span className="text-destructive" aria-hidden="true"> *</span>;
}

function DateTimeField(props: {
  id: string;
  inputRef: React.Ref<HTMLInputElement>;
  value: number | null;
  required: boolean;
  min?: number | null;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className={cn(
      "relative h-[34px] rounded-lg border border-border bg-background transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
      props.invalid && "border-destructive ring-3 ring-destructive/20",
    )}>
      <Input
        ref={props.inputRef}
        id={props.id}
        type="datetime-local"
        required={props.required}
        min={toDateTimeInput(props.min ?? null)}
        value={toDateTimeInput(props.value)}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer border-0 opacity-0"
        aria-invalid={props.invalid}
        aria-describedby={props.describedBy}
        onClick={(event) => event.currentTarget.showPicker()}
        onInput={(event) => props.onChange(fromDateTimeInput(event.currentTarget.value))}
      />
      <span className={cn(
        "pointer-events-none absolute inset-y-0 left-2 right-8 flex items-center truncate text-[13px] tabular-nums",
        props.value === null ? "font-normal text-dls-secondary/60" : filledValueClassName,
      )}>
        {formatDateTime(props.value) || t("work.time.unscheduled")}
      </span>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function WorkItemSheet(props: WorkItemSheetProps) {
  const [value, setValue] = React.useState<WorkItemEditorValue>(() => emptyEditorValue(props.defaultStatus, props.scheduleMode, props.initialSchedule));
  const [timeOpen, setTimeOpen] = React.useState(false);
  const [validationAttempted, setValidationAttempted] = React.useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = React.useState(false);
  const initialValueRef = React.useRef(value);
  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const startInputRef = React.useRef<HTMLInputElement>(null);
  const dueInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!props.open) return;
    const nextValue = props.item ? {
      title: props.item.title,
      description: props.item.description,
      status: props.item.status,
      assignee: props.item.assignee,
      priority: props.item.priority,
      startAt: props.item.startAt,
      dueAt: props.item.dueAt,
      customFields: props.item.customFields,
    } : emptyEditorValue(props.defaultStatus, props.scheduleMode, props.initialSchedule);
    initialValueRef.current = nextValue;
    setValue(nextValue);
    setTimeOpen(props.scheduleMode || Boolean(props.item && (props.item.startAt !== null || props.item.dueAt !== null)));
    setValidationAttempted(false);
    setDiscardConfirmOpen(false);
  }, [props.defaultStatus, props.initialSchedule, props.item, props.open, props.scheduleMode]);

  const scheduleRequired = props.scheduleMode;
  const titleMissing = !value.title.trim();
  const startMissing = scheduleRequired && value.startAt === null;
  const dueMissing = scheduleRequired && value.dueAt === null;
  const invalidRange = value.startAt !== null && value.dueAt !== null && value.dueAt < value.startAt;
  const isDirty = !editorValuesEqual(value, initialValueRef.current);
  const requestClose = () => {
    if (props.saving || props.deleting) return;
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    props.onOpenChange(false);
  };
  const save = () => {
    setValidationAttempted(true);
    if (titleMissing || startMissing || dueMissing || invalidRange) {
      requestAnimationFrame(() => {
        if (titleMissing) titleInputRef.current?.focus();
        else if (startMissing) startInputRef.current?.focus();
        else dueInputRef.current?.focus();
      });
      return;
    }
    props.onSave({ ...value, title: value.title.trim() });
  };
  const updateCustomField = (fieldId: string, next: string | number | boolean | null) => {
    setValue((current) => ({
      ...current,
      customFields: { ...current.customFields, [fieldId]: next },
    }));
  };

  return (
    <>
    <Sheet open={props.open} onOpenChange={(open) => {
      if (open) props.onOpenChange(true);
      else requestClose();
    }}>
      <SheetContent
        side="right"
        showCloseButton
        className="w-[min(396px,100vw)] border-l-0 bg-background font-['PingFang_SC',sans-serif] shadow-[-16px_0_40px_rgba(0,0,0,0.08)] data-[side=right]:w-[min(396px,100vw)] data-[side=right]:border-s-0 data-[side=right]:sm:max-w-[396px]"
        data-testid="work-item-sheet"
      >
        <SheetHeader className="gap-1.5 px-6 pb-0 pt-6">
          <SheetTitle className="text-2xl font-semibold leading-8">{props.item ? t("work.editor.edit_title") : t("work.editor.create_title")}</SheetTitle>
          <SheetDescription className="text-[13px] leading-5 text-foreground">{props.item
            ? t("work.editor.edit_description")
            : props.scheduleMode
              ? t("work.editor.create_schedule_description")
              : t("work.editor.create_description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6 pt-4">
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

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="work-item-title" className="gap-0 text-sm font-semibold leading-5">{t("work.field.title")}<RequiredMark /></Label>
              <span className="text-[11px] leading-4 text-foreground">{value.title.length}/{WORK_ITEM_TITLE_MAX_LENGTH}</span>
            </div>
            <Input
              ref={titleInputRef}
              id="work-item-title"
              autoFocus
              required
              maxLength={WORK_ITEM_TITLE_MAX_LENGTH}
              value={value.title}
              placeholder={t("work.field.title_placeholder")}
              className={compactInputClassName}
              aria-invalid={validationAttempted && titleMissing}
              aria-describedby={validationAttempted && titleMissing ? "work-item-title-error" : undefined}
              onChange={(event) => {
                const title = event.currentTarget.value;
                setValue((current) => ({ ...current, title }));
              }}
            />
            {validationAttempted && titleMissing
              ? <p id="work-item-title-error" className="text-xs text-destructive">{t("work.field.title_required")}</p>
              : null}
          </div>

          <div className="space-y-3">
            <Label htmlFor="work-item-description" className="text-sm font-semibold leading-5">{t("work.field.description")}</Label>
            <Textarea
              id="work-item-description"
              value={value.description ?? ""}
              placeholder={t("work.field.description_placeholder")}
              className={cn("h-32 min-h-32 rounded-lg px-3 py-3 text-[13px]", filledValueClassName, placeholderClassName)}
              onChange={(event) => {
                const description = event.currentTarget.value || null;
                setValue((current) => ({ ...current, description }));
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex min-w-0 flex-col gap-3">
              <Label htmlFor="work-item-status" className="text-sm font-semibold leading-5">{t("work.field.status")}</Label>
              <Select
                value={value.status}
                disabled={Boolean(props.item?.execution)}
                onValueChange={(status) => {
                  if (!status) return;
                  setValue((current) => ({ ...current, status }));
                }}
              >
                <SelectTrigger id="work-item-status" className={compactSelectTriggerClassName}>
                  <SelectValue>{props.board.columns.find((column) => column.id === value.status)?.label}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {props.board.columns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>{column.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <Label htmlFor="work-item-priority" className="text-sm font-semibold leading-5">{t("work.field.priority")}</Label>
              <Select
                value={value.priority}
                onValueChange={(nextPriority) => {
                  if (!nextPriority) return;
                  const priority = priorityFromValue(nextPriority);
                  setValue((current) => ({ ...current, priority }));
                }}
              >
                <SelectTrigger id="work-item-priority" className={compactSelectTriggerClassName}>
                  <SelectValue>{t(`work.priority.${value.priority}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="low">{t("work.priority.low")}</SelectItem>
                  <SelectItem value="normal">{t("work.priority.normal")}</SelectItem>
                  <SelectItem value="high">{t("work.priority.high")}</SelectItem>
                  <SelectItem value="urgent">{t("work.priority.urgent")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {!props.item?.execution ? <div className="space-y-3">
            <Label htmlFor="work-item-assignee" className="text-sm font-semibold leading-5">{t("work.field.assignee")}</Label>
            <Input
              id="work-item-assignee"
              value={value.assignee ?? ""}
              placeholder={t("work.field.assignee_placeholder")}
              className={compactInputClassName}
              onChange={(event) => {
                const assignee = event.currentTarget.value || null;
                setValue((current) => ({ ...current, assignee }));
              }}
            />
          </div> : null}

          {scheduleRequired ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="min-w-0 space-y-3">
                <Label htmlFor="work-item-start" className="gap-0 text-sm font-semibold leading-5">{t("work.field.start")}<RequiredMark /></Label>
                <DateTimeField
                  id="work-item-start"
                  inputRef={startInputRef}
                  value={value.startAt}
                  required
                  invalid={validationAttempted && startMissing}
                  describedBy={validationAttempted && startMissing ? "work-item-start-error" : undefined}
                  onChange={(startAt) => setValue((current) => ({ ...current, startAt }))}
                />
                {validationAttempted && startMissing
                  ? <p id="work-item-start-error" className="text-xs text-destructive">{t("work.field.start_required")}</p>
                  : null}
              </div>
              <div className="min-w-0 space-y-3">
                <Label htmlFor="work-item-due" className="gap-0 text-sm font-semibold leading-5">{t("work.field.due")}<RequiredMark /></Label>
                <DateTimeField
                  id="work-item-due"
                  inputRef={dueInputRef}
                  value={value.dueAt}
                  required
                  min={value.startAt}
                  invalid={invalidRange || (validationAttempted && dueMissing)}
                  describedBy={validationAttempted && dueMissing ? "work-item-due-error" : invalidRange ? "work-item-range-error" : undefined}
                  onChange={(dueAt) => setValue((current) => ({ ...current, dueAt }))}
                />
                {validationAttempted && dueMissing
                  ? <p id="work-item-due-error" className="text-xs text-destructive">{t("work.field.due_required")}</p>
                  : null}
              </div>
              {invalidRange ? <p id="work-item-range-error" className="col-span-2 text-xs text-destructive">{t("work.field.invalid_range")}</p> : null}
            </div>
          ) : <Collapsible open={timeOpen} onOpenChange={setTimeOpen} className="rounded-xl border border-dls-border/75 bg-dls-surface/45">
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
                  <DateTimeField
                    id="work-item-start"
                    inputRef={startInputRef}
                    value={value.startAt}
                    required={false}
                    invalid={false}
                    onChange={(startAt) => setValue((current) => ({ ...current, startAt }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="work-item-due">{t("work.field.due")}</Label>
                  <DateTimeField
                    id="work-item-due"
                    inputRef={dueInputRef}
                    value={value.dueAt}
                    required={false}
                    min={value.startAt}
                    invalid={invalidRange}
                    describedBy={invalidRange ? "work-item-range-error" : undefined}
                    onChange={(dueAt) => setValue((current) => ({ ...current, dueAt }))}
                  />
                </div>
              </div>
              {invalidRange ? <p id="work-item-range-error" className="mt-2 text-xs text-destructive">{t("work.field.invalid_range")}</p> : null}
            </CollapsibleContent>
          </Collapsible>}

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
                  const selectedValue = typeof current === "string" ? current : UNSET_CUSTOM_FIELD_VALUE;
                  return (
                    <div key={field.id} className="space-y-2">
                      <Label htmlFor={`custom-${field.id}`}>{field.label}</Label>
                      <Select
                        value={selectedValue}
                        onValueChange={(nextValue) => {
                          if (nextValue) updateCustomField(field.id, nextValue === UNSET_CUSTOM_FIELD_VALUE ? null : nextValue);
                        }}
                      >
                        <SelectTrigger id={`custom-${field.id}`} className={compactSelectTriggerClassName}>
                          <SelectValue>{selectedValue === UNSET_CUSTOM_FIELD_VALUE ? t("work.field.not_set") : selectedValue}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value={UNSET_CUSTOM_FIELD_VALUE}>{t("work.field.not_set")}</SelectItem>
                          {(field.options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
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

        <SheetFooter className="flex-row items-center justify-between px-6 pb-6 pt-0">
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
          <div className="flex items-center gap-4">
            <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-3 text-[13px] font-medium text-muted-foreground shadow-none" disabled={props.saving || props.deleting} onClick={requestClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg px-3 text-[13px] font-medium shadow-none before:shadow-none"
              disabled={props.saving || props.deleting}
              onClick={save}
            >
              {props.saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
    <ConfirmModal
      open={discardConfirmOpen}
      title={t("work.unsaved.title")}
      message={t("work.unsaved.description")}
      confirmLabel={t("work.unsaved.discard")}
      cancelLabel={t("work.unsaved.continue")}
      variant="danger"
      onConfirm={() => {
        setDiscardConfirmOpen(false);
        props.onOpenChange(false);
      }}
      onCancel={() => setDiscardConfirmOpen(false)}
    />
    </>
  );
}
