/** @jsxImportSource react */
import * as React from "react";
import { CalendarClock, CalendarDays, ChevronDown, LockKeyhole, Timer, Trash2 } from "lucide-react";
import {
  WORK_ITEM_TITLE_MAX_LENGTH,
  type WorkBoardConfig,
  type WorkItem,
  type WorkItemAutomation,
  type WorkItemAutomationRecurrence,
  type WorkItemPriority,
} from "@ipollowork/types/work-items";
import type { ProjectAgent, ProjectAgentModel } from "@ipollowork/types/project-workspace";

import type { ProviderListItem } from "@/app/types";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { Switch } from "@/components/ui/switch";
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
  automation: WorkItemAutomation | null;
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
  agents: ProjectAgent[];
  providers: ProviderListItem[];
  connectedProviderIds: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (value: WorkItemEditorValue) => void;
  onDelete?: () => void;
};

const filledValueClassName = "font-medium text-dls-accent dark:text-dls-text";
const placeholderClassName = "placeholder:font-normal placeholder:text-dls-secondary/60";
const compactInputClassName = `h-[34px] rounded-lg px-2 text-[13px] ${filledValueClassName} ${placeholderClassName}`;
const compactSelectTriggerClassName = `h-[34px] w-full rounded-lg border-border bg-background px-2 py-2 text-[13px] shadow-none data-[size=default]:h-[34px] ${filledValueClassName}`;
const UNASSIGNED_ASSIGNEE_VALUE = "__unassigned__";
const FOLLOW_PROJECT_MODEL_VALUE = "__follow_project_model__";
const UNSET_CUSTOM_FIELD_VALUE = "__unset__";
const SCHEDULE_SLOT_MS = 30 * 60 * 1_000;
const DEFAULT_SCHEDULE_DURATION_MS = 60 * 60 * 1_000;
const TIME_PICKER_INTERVAL_MINUTES = 15;
const TIME_OPTIONS_15_MINUTES = Array.from(
  { length: (24 * 60) / TIME_PICKER_INTERVAL_MINUTES },
  (_, index) => {
    const totalMinutes = index * TIME_PICKER_INTERVAL_MINUTES;
    const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minute = String(totalMinutes % 60).padStart(2, "0");
    return `${hour}:${minute}`;
  },
);

function toDateInput(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTimeInput(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function fromDateAndTime(dateValue: string, timeValue: string): number | null {
  if (!dateValue || !timeValue) return null;
  const timestamp = new Date(`${dateValue}T${timeValue}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function updateDatePart(timestamp: number | null, dateValue: string): number | null {
  if (!dateValue) return null;
  return fromDateAndTime(dateValue, toTimeInput(timestamp) || "09:00");
}

function updateTimePart(timestamp: number | null, timeValue: string): number | null {
  if (!timeValue) return null;
  return fromDateAndTime(toDateInput(timestamp) || toDateInput(Date.now()), timeValue);
}

function timePickerOptions(selectedTime: string): string[] {
  if (!selectedTime || TIME_OPTIONS_15_MINUTES.includes(selectedTime)) return TIME_OPTIONS_15_MINUTES;
  return [...TIME_OPTIONS_15_MINUTES, selectedTime].sort();
}

type DateTimePickerFieldProps = {
  id: string;
  label: string;
  timestamp: number | null;
  inputRef?: React.Ref<HTMLInputElement>;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  min?: number | null;
  onChange: (timestamp: number | null) => void;
};

function openNativePicker(event: React.MouseEvent<HTMLInputElement>) {
  event.currentTarget.showPicker();
}

type TimePicker24HourProps = {
  id: string;
  label: string;
  timestamp: number | null;
  minimumTime?: string;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (timestamp: number | null) => void;
};

function TimePicker24Hour(props: TimePicker24HourProps) {
  const time = toTimeInput(props.timestamp);

  return (
    <div data-testid={`${props.id}-time-picker-24h`}>
      <Select
        value={time || undefined}
        onValueChange={(nextTime) => {
          if (!nextTime) return;
          props.onChange(updateTimePart(props.timestamp, nextTime));
        }}
      >
        <SelectTrigger
          id={`${props.id}-time`}
          className={cn(
            compactSelectTriggerClassName,
            "rounded-[8px] border-[#EBEBEB] pe-4 leading-[18px] dark:border-border [&_svg]:text-[#858A94] [&_svg]:[stroke-width:1.333]",
            !time && "font-normal text-dls-secondary",
          )}
          aria-label={`${props.label} · ${t("work.time.time_picker")}`}
          aria-required={props.required || undefined}
          aria-invalid={props.invalid || undefined}
          aria-describedby={props.describedBy}
        >
          <SelectValue>{time || "--:--"}</SelectValue>
        </SelectTrigger>
        <SelectContent
          side="bottom"
          align="end"
          collisionAvoidance={{ side: "none", align: "shift", fallbackAxisSide: "none" }}
          className="max-h-64 w-(--anchor-width) min-w-(--anchor-width) p-1"
        >
          {timePickerOptions(time).map((option) => (
            <SelectItem
              key={option}
              value={option}
              disabled={Boolean(props.minimumTime && option < props.minimumTime)}
              className="h-8 px-2 py-0 text-[13px] font-normal"
            >
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DateTimePickerField(props: DateTimePickerFieldProps) {
  const minimumDate = toDateInput(props.min ?? null);
  const minimumTime = minimumDate && minimumDate === toDateInput(props.timestamp)
    ? toTimeInput(props.min ?? null)
    : undefined;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold leading-5 text-foreground">
        {props.label}{props.required ? <RequiredMark /> : null}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative min-w-0">
          <Input
            ref={props.inputRef}
            id={`${props.id}-date`}
            type="date"
            required={props.required}
            min={minimumDate || undefined}
            value={toDateInput(props.timestamp)}
            className={cn(
              compactInputClassName,
              "rounded-[8px] border-[#EBEBEB] pe-10 leading-[18px] dark:border-border [&::-webkit-calendar-picker-indicator]:opacity-0",
            )}
            aria-label={`${props.label} · ${t("work.time.date_picker")}`}
            aria-invalid={props.invalid || undefined}
            aria-describedby={props.describedBy}
            onClick={openNativePicker}
            onChange={(event) => props.onChange(updateDatePart(props.timestamp, event.currentTarget.value))}
          />
          <CalendarDays
            aria-hidden="true"
            strokeWidth={1}
            className="pointer-events-none absolute end-4 top-1/2 size-3.5 -translate-y-1/2 text-black dark:text-dls-text"
          />
        </div>
        <TimePicker24Hour
          id={props.id}
          label={props.label}
          timestamp={props.timestamp}
          minimumTime={minimumTime}
          required={props.required}
          invalid={props.invalid}
          describedBy={props.describedBy}
          onChange={props.onChange}
        />
      </div>
    </fieldset>
  );
}

function priorityFromValue(value: string): WorkItemPriority {
  if (value === "low" || value === "high" || value === "urgent") return value;
  return "normal";
}

function automationRecurrenceFromValue(value: string): WorkItemAutomationRecurrence {
  if (value === "daily" || value === "weekly") return value;
  return "once";
}

function automationModelValue(model: ProjectAgentModel): string {
  return JSON.stringify([model.providerId, model.modelId]);
}

function automationModelFromValue(value: string): ProjectAgentModel | null {
  if (value === FOLLOW_PROJECT_MODEL_VALUE) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed)
      || parsed.length !== 2
      || typeof parsed[0] !== "string"
      || typeof parsed[1] !== "string"
    ) return null;
    return { providerId: parsed[0], modelId: parsed[1] };
  } catch {
    return null;
  }
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
    automation: null,
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
    && JSON.stringify(left.automation) === JSON.stringify(right.automation)
    && JSON.stringify(left.customFields) === JSON.stringify(right.customFields);
}

function shouldInitiallyOpenTimePanel(item: WorkItem | null, scheduleMode: boolean): boolean {
  return item === null
    || scheduleMode
    || item.startAt !== null
    || item.dueAt !== null
    || item.automation !== null;
}

function RequiredMark() {
  return <span className="text-destructive" aria-hidden="true"> *</span>;
}

export function WorkItemSheet(props: WorkItemSheetProps) {
  const [value, setValue] = React.useState<WorkItemEditorValue>(() => emptyEditorValue(props.defaultStatus, props.scheduleMode, props.initialSchedule));
  const [timeOpen, setTimeOpen] = React.useState(() => shouldInitiallyOpenTimePanel(props.item, props.scheduleMode));
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
      automation: props.item.automation,
      customFields: props.item.customFields,
    } : emptyEditorValue(props.defaultStatus, props.scheduleMode, props.initialSchedule);
    initialValueRef.current = nextValue;
    setValue(nextValue);
    setTimeOpen(shouldInitiallyOpenTimePanel(props.item, props.scheduleMode));
    setValidationAttempted(false);
    setDiscardConfirmOpen(false);
  }, [props.defaultStatus, props.initialSchedule, props.item, props.open, props.scheduleMode]);

  const scheduleRequired = props.scheduleMode;
  const titleMissing = !value.title.trim();
  const startMissing = scheduleRequired && value.startAt === null;
  const dueMissing = scheduleRequired && value.dueAt === null;
  const invalidRange = value.startAt !== null && value.dueAt !== null && value.dueAt < value.startAt;
  const invalidAutomation = value.automation?.enabled === true && value.startAt === null;
  const connectedProviders = new Set(props.connectedProviderIds);
  const modelProviders = props.providers.filter((provider) => (
    connectedProviders.has(provider.id) && Object.keys(provider.models).length > 0
  ));
  const selectedAutomationModel = value.automation?.model;
  const selectedAutomationModelAvailable = !selectedAutomationModel || modelProviders.some((provider) => (
    provider.id === selectedAutomationModel.providerId && selectedAutomationModel.modelId in provider.models
  ));
  const selectedAutomationProvider = selectedAutomationModel
    ? modelProviders.find((provider) => provider.id === selectedAutomationModel.providerId)
    : undefined;
  const selectedAutomationModelName = selectedAutomationModel
    ? selectedAutomationProvider?.models[selectedAutomationModel.modelId]?.name || selectedAutomationModel.modelId
    : t("work.automation.follow_project_model");
  const selectedAssignee = value.assignee
    ? props.agents.find((agent) => agent.id === value.assignee)
    : undefined;
  const selectedAssigneeAvailable = !value.assignee || Boolean(selectedAssignee);
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
    if (titleMissing || startMissing || dueMissing || invalidRange || invalidAutomation) {
      requestAnimationFrame(() => {
        if (titleMissing) titleInputRef.current?.focus();
        else if (startMissing || invalidAutomation) startInputRef.current?.focus();
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
            <Select
              value={value.assignee ?? UNASSIGNED_ASSIGNEE_VALUE}
              onValueChange={(nextAssignee) => {
                if (!nextAssignee) return;
                const assignee = nextAssignee === UNASSIGNED_ASSIGNEE_VALUE ? null : nextAssignee;
                setValue((current) => ({ ...current, assignee }));
              }}
            >
              <SelectTrigger id="work-item-assignee" className={compactSelectTriggerClassName}>
                <SelectValue>{value.assignee ? selectedAssignee?.name ?? value.assignee : t("project_overview.unassigned")}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value={UNASSIGNED_ASSIGNEE_VALUE}>{t("project_overview.unassigned")}</SelectItem>
                {!selectedAssigneeAvailable && value.assignee ? (
                  <SelectItem value={value.assignee}>{value.assignee}</SelectItem>
                ) : null}
                {props.agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div> : null}

          <Collapsible
            open={timeOpen}
            onOpenChange={setTimeOpen}
            className="rounded-xl border border-dls-border/75 bg-dls-surface/45"
          >
            <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <CalendarClock className="size-3.5 shrink-0 text-dls-secondary" />
              <span className="text-[12px] font-medium text-dls-text">{t("work.time.title")}</span>
              <span className="ml-auto min-w-0 truncate text-[10px] text-dls-tertiary">{timeSummary(value.startAt, value.dueAt)}</span>
              <ChevronDown className="size-3.5 shrink-0 text-dls-tertiary transition-transform group-aria-expanded:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-dls-border/70 px-3.5 py-3">
              <div className="space-y-3" data-testid="work-item-time-pickers">
                <DateTimePickerField
                  id="work-item-start"
                  label={t("work.field.start")}
                  timestamp={value.startAt}
                  inputRef={startInputRef}
                  required={scheduleRequired}
                  invalid={(validationAttempted && startMissing) || invalidAutomation}
                  describedBy={validationAttempted && startMissing
                    ? "work-item-start-error"
                    : invalidAutomation
                      ? "work-item-automation-error"
                      : undefined}
                  onChange={(startAt) => setValue((current) => ({ ...current, startAt }))}
                />
                {validationAttempted && startMissing
                  ? <p id="work-item-start-error" className="text-xs text-destructive">{t("work.field.start_required")}</p>
                  : null}
                <DateTimePickerField
                  id="work-item-due"
                  label={t("work.field.due")}
                  timestamp={value.dueAt}
                  inputRef={dueInputRef}
                  required={scheduleRequired}
                  min={value.startAt}
                  invalid={invalidRange || (validationAttempted && dueMissing)}
                  describedBy={validationAttempted && dueMissing ? "work-item-due-error" : invalidRange ? "work-item-range-error" : undefined}
                  onChange={(dueAt) => setValue((current) => ({ ...current, dueAt }))}
                />
                {validationAttempted && dueMissing
                  ? <p id="work-item-due-error" className="text-xs text-destructive">{t("work.field.due_required")}</p>
                  : null}
              </div>
              {invalidRange ? <p id="work-item-range-error" className="mt-2 text-xs text-destructive">{t("work.field.invalid_range")}</p> : null}
              {!props.item?.execution ? (
                <div className="mt-4 border-t border-dls-border/70 pt-4" data-testid="work-item-automation">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-dls-hover text-dls-secondary">
                      <Timer className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium text-dls-text">{t("work.automation.title")}</span>
                    </span>
                    <Switch
                      checked={value.automation?.enabled === true}
                      aria-label={t("work.automation.title")}
                      onCheckedChange={(enabled) => setValue((current) => ({
                        ...current,
                        automation: {
                          enabled,
                          recurrence: current.automation?.recurrence ?? "once",
                          model: current.automation?.model ?? null,
                        },
                      }))}
                    />
                  </div>

                  {value.automation?.enabled ? (
                    <div className="mt-3 space-y-2">
                      <Label htmlFor="work-item-automation-recurrence">{t("work.automation.recurrence")}</Label>
                      <Select
                        value={value.automation.recurrence}
                        onValueChange={(nextRecurrence) => {
                          if (!nextRecurrence) return;
                          const recurrence = automationRecurrenceFromValue(nextRecurrence);
                          setValue((current) => ({
                            ...current,
                            automation: { enabled: true, recurrence, model: current.automation?.model ?? null },
                          }));
                        }}
                      >
                        <SelectTrigger id="work-item-automation-recurrence" className={compactSelectTriggerClassName}>
                          <SelectValue>{t(`work.automation.${value.automation.recurrence}`)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="once">{t("work.automation.once")}</SelectItem>
                          <SelectItem value="daily">{t("work.automation.daily")}</SelectItem>
                          <SelectItem value="weekly">{t("work.automation.weekly")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Label htmlFor="work-item-automation-model">{t("work.automation.model")}</Label>
                      <Select
                        value={selectedAutomationModel
                          ? automationModelValue(selectedAutomationModel)
                          : FOLLOW_PROJECT_MODEL_VALUE}
                        onValueChange={(nextModel) => {
                          if (!nextModel) return;
                          const model = automationModelFromValue(nextModel);
                          setValue((current) => ({
                            ...current,
                            automation: current.automation
                              ? { ...current.automation, model }
                              : { enabled: true, recurrence: "once", model },
                          }));
                        }}
                      >
                        <SelectTrigger id="work-item-automation-model" className={compactSelectTriggerClassName}>
                          <SelectValue>{selectedAutomationModelName}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value={FOLLOW_PROJECT_MODEL_VALUE}>{t("work.automation.follow_project_model")}</SelectItem>
                          {!selectedAutomationModelAvailable && selectedAutomationModel ? (
                            <SelectItem value={automationModelValue(selectedAutomationModel)}>
                              {selectedAutomationModel.providerId} · {selectedAutomationModel.modelId}
                            </SelectItem>
                          ) : null}
                          {modelProviders.map((provider) => (
                            <SelectGroup key={provider.id}>
                              <SelectLabel>{provider.name || provider.id}</SelectLabel>
                              {Object.values(provider.models).map((model) => (
                                <SelectItem key={model.id} value={automationModelValue({ providerId: provider.id, modelId: model.id })}>
                                  {model.name || model.id}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      {modelProviders.length === 0 ? (
                        <p className="text-[9px] leading-4 text-dls-tertiary">{t("work.automation.no_models")}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {invalidAutomation ? (
                    <p id="work-item-automation-error" className="mt-2 text-xs text-destructive">{t("work.automation.start_required")}</p>
                  ) : null}
                  {props.item?.automationLastRunAt ? (
                    <p className="mt-2 text-[9px] leading-4 text-dls-tertiary">
                      {t("work.automation.last_started", {
                        time: new Intl.DateTimeFormat(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(props.item.automationLastRunAt),
                      })}
                    </p>
                  ) : null}
                  {props.item?.automationLastError ? (
                    <p className="mt-2 text-[9px] leading-4 text-destructive">
                      {t("work.automation.last_failed", { error: props.item.automationLastError })}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[9px] leading-4 text-dls-tertiary">{t("work.automation.runtime_notice")}</p>
                </div>
              ) : null}
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
