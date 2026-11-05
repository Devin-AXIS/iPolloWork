import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@ipollowork/ui/collapsible";
import { Card, CardContent } from "@ipollowork/ui/card";
import { Alert, AlertDescription, AlertAction } from "@ipollowork/ui/alert";
import { Button } from "@ipollowork/ui/controls";
import { PropertyKeyframeRows } from "./AnimationCardParts";
import type { GsapAnimationEditCallbacks } from "./gsapAnimationCallbacks";
import { usePlayerStore } from "../../player/store/playerStore";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import {
  defaultMotionDuration,
  getMotionPreset,
  readMotionInstanceFromExtras,
  hasManualMotionKeyframes,
  motionSourceMatchesPreset,
  readAuthoredMotionPositionBase,
  type MotionInstance,
  type MotionMutationInput,
  type MotionParameter,
  type MotionPhase,
  type MotionPreset,
  type MotionTargetKind,
} from "@hyperframes/core/motion-presets";
import { Trash } from "../../icons/SystemIcons";
import { useStudioI18n } from "../../i18n";
import { resolveMotionTimelineSpan } from "../../utils/motionPreset";
import type { DomEditSelection } from "./domEditing";
import { isTextEditableSelection } from "./domEditing";
import { ColorField } from "./propertyPanelColor";
import { FlatRow, FlatSelectRow, FlatSlider } from "./propertyPanelFlatPrimitives";

const PHASES: Array<{ id: MotionPhase; label: string }> = [
  { id: "enter", label: "出现" },
  { id: "emphasis", label: "动作" },
  { id: "exit", label: "消失" },
];

const SPEEDS = [
  { id: "slow", label: "慢", durationScale: 1.45 },
  { id: "normal", label: "正常", durationScale: 1 },
  { id: "fast", label: "快", durationScale: 0.7 },
] as const;

export interface ResolvedMotionInstance {
  animation: GsapAnimation;
  instance: MotionInstance;
}

export function resolveMotionTargetKind(element: DomEditSelection): MotionTargetKind {
  const hasAuthoredChildren = Array.from(element.element.children).some(
    (child) =>
      !child.hasAttribute("data-ipw-motion-word") &&
      !child.hasAttribute("data-ipw-motion-char") &&
      child.getAttribute("data-ipw-motion-role") !== "unit",
  );
  return isTextEditableSelection(element) &&
    !hasAuthoredChildren &&
    Boolean(element.textContent?.trim())
    ? "text"
    : "element";
}

export function resolveMotionInstances(animations: GsapAnimation[]): ResolvedMotionInstance[] {
  return animations.flatMap((animation) => {
    const instance = readMotionInstanceFromExtras(animation.extras);
    return instance ? [{ animation, instance }] : [];
  });
}

function clampMotionTime(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Number(Math.min(max, Math.max(min, value)).toFixed(3));
}

function motionInstanceEnd(instance: MotionInstance, start: number): number {
  return instance.end ?? start + instance.duration * (instance.repeat + 1);
}

function displayStart(animation: GsapAnimation, instance: MotionInstance): number {
  if (typeof animation.resolvedStart === "number") return animation.resolvedStart;
  if (typeof animation.position === "number") return animation.position;
  return instance.start;
}

function speedDuration(preset: MotionPreset, durationScale: number): number {
  return Number((defaultMotionDuration(preset) * durationScale).toFixed(2));
}

function closestSpeed(preset: MotionPreset, duration: number): (typeof SPEEDS)[number]["id"] {
  return SPEEDS.reduce((closest, candidate) => {
    const closestDelta = Math.abs(speedDuration(preset, closest.durationScale) - duration);
    const candidateDelta = Math.abs(speedDuration(preset, candidate.durationScale) - duration);
    return candidateDelta < closestDelta ? candidate : closest;
  }).id;
}

function ParameterControl({
  parameter,
  value,
  onChange,
  disabled = false,
}: {
  parameter: MotionParameter;
  value: string | number | boolean | undefined;
  onChange: (value: string | number) => void;
  disabled?: boolean;
}) {
  if (parameter.kind === "select") {
    return (
      <FlatSelectRow
        disabled={disabled}
        label={parameter.label}
        value={String(value ?? "")}
        options={parameter.options ?? []}
        tier="explicitDefault"
        onChange={onChange}
      />
    );
  }
  if (parameter.kind === "color") {
    return (
      <ColorField
        disabled={disabled}
        flat
        label={parameter.label}
        value={String(value ?? "#7c3aed")}
        onCommit={onChange}
      />
    );
  }
  return (
    <FlatSlider
      disabled={disabled}
      label={parameter.label}
      value={Number(value ?? 0)}
      min={parameter.min ?? 0}
      max={parameter.max ?? 100}
      step={parameter.step ?? 1}
      tier="explicitCustom"
      displayValue={`${Number(value ?? 0).toFixed(parameter.step && parameter.step < 0.1 ? 2 : 1)}${parameter.unit ? ` ${parameter.unit}` : ""}`}
      commitMode="release"
      onCommit={onChange}
    />
  );
}

function AppliedMotionEditor({
  resolved,
  element,
  targetKind,
  onMutate,
  compact = false,
  disabled = false,
}: {
  compact?: boolean;
  disabled?: boolean;
  resolved: ResolvedMotionInstance;
  element: DomEditSelection;
  targetKind: MotionTargetKind;
  onMutate: (targetKind: MotionTargetKind, mutation: MotionMutationInput) => Promise<boolean>;
}) {
  const { animation, instance } = resolved;
  const preset = getMotionPreset(instance.presetId);
  if (!preset) return null;
  const start = displayStart(animation, instance);
  const timelineSpan = resolveMotionTimelineSpan(element, instance.duration);
  const end = clampMotionTime(motionInstanceEnd(instance, start), start + 0.1, timelineSpan.end);
  const apply = (updates: Partial<MotionMutationInput>) => {
    if (disabled) return;
    onMutate(targetKind, {
      operation: "upsert",
      phase: instance.phase,
      presetId: instance.presetId,
      templateId: instance.templateId,
      applicationKind: instance.applicationKind,
      start,
      duration: instance.duration,
      parameters: instance.parameters,
      ...updates,
    });
  };
  const preview = () => {
    const store = usePlayerStore.getState();
    const ownerKey = store.selectedElementId ?? element.id ?? element.hfId ?? "";
    store.setSelectedTimelineEffect({ ownerKey, animationId: animation.id, time: start });
    store.requestSeek(start);
    store.requestClipReveal(ownerKey);
  };
  const updateParameter = (parameter: MotionParameter, value: string | number) => {
    apply({
      parameters: {
        ...instance.parameters,
        [parameter.id]: value,
        ...(parameter.kind === "color" && "colorSource" in instance.parameters
          ? { colorSource: "custom" }
          : {}),
      },
    });
  };
  const selectedSpeed = closestSpeed(preset, instance.duration);
  return (
    <div className={compact ? "space-y-3 text-[13px] leading-[18px]" : "space-y-3"}>
      {!compact && (
        <div className="grid grid-cols-[minmax(0,1fr)_34px] gap-2">
          <div className="flex h-[34px] min-w-0 items-center rounded-[6px] bg-panel-input px-3 text-[11px] font-medium text-panel-text-1">
            <span className="truncate">{preset.label}</span>
          </div>
          <button
            type="button"
            aria-label="删除动画"
            onClick={() =>
              onMutate(targetKind, {
                operation: "remove",
                phase: instance.phase,
                templateId: instance.templateId,
                applicationKind: instance.applicationKind,
              })
            }
            className="flex h-[34px] items-center justify-center rounded-[6px] text-panel-text-3 transition-colors hover:bg-panel-input hover:text-panel-text-1"
          >
            <Trash size={17} />
          </button>
        </div>
      )}

      <FlatSlider
        disabled={disabled}
        label="时长"
        value={instance.duration}
        min={0.2}
        max={5}
        step={0.05}
        tier="explicitCustom"
        displayValue={`${instance.duration.toFixed(2)} 秒`}
        commitMode="release"
        onCommit={(duration) => apply({ duration })}
      />

      {!compact && (
        <div className="grid grid-cols-2 gap-2">
          <FlatRow
            label="开始时间"
            value={start.toFixed(2)}
            tier="explicitCustom"
            inputType="number"
            suffix={<span className="text-[12px] leading-[18px] text-panel-text-3">s</span>}
            onCommit={(value) => {
              const nextStart = clampMotionTime(
                Number(value),
                timelineSpan.start,
                Math.max(timelineSpan.start, end - 0.1),
              );
              apply({ start: nextStart, end });
            }}
          />
          <FlatRow
            label="结束时间"
            value={end.toFixed(2)}
            tier="explicitCustom"
            inputType="number"
            suffix={<span className="text-[10px] text-panel-text-3">s</span>}
            onCommit={(value) =>
              apply({
                end: clampMotionTime(Number(value), start + 0.1, timelineSpan.end),
              })
            }
          />
        </div>
      )}

      <div className="flex h-[38px] items-center justify-between rounded-[7px] bg-panel-input px-3">
        <span className="text-[11px] text-panel-text-2">循环播放</span>
        <button
          type="button"
          role="switch"
          aria-checked={instance.loop}
          aria-label="循环播放"
          onClick={() =>
            apply({
              loop: !instance.loop,
              end: !instance.loop
                ? timelineSpan.end
                : Math.min(timelineSpan.end, start + instance.duration),
            })
          }
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/40 ${instance.loop ? "bg-[#1FBAC0]" : "bg-panel-border"}`}
        >
          <span
            className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${instance.loop ? "translate-x-4" : "translate-x-0"}`}
          />
        </button>
      </div>

      {!compact && (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
          <span className="text-[10px] text-panel-text-3">速度</span>
          <div className="grid grid-cols-3 rounded-[7px] bg-panel-input p-1">
            {SPEEDS.map((speed) => (
              <button
                key={speed.id}
                type="button"
                aria-pressed={selectedSpeed === speed.id}
                onClick={() => apply({ duration: speedDuration(preset, speed.durationScale) })}
                className={`h-7 rounded-[5px] text-[10px] font-medium transition-colors ${
                  selectedSpeed === speed.id
                    ? "bg-panel-bg text-panel-text-0 shadow-sm"
                    : "text-panel-text-3 hover:text-panel-text-1"
                }`}
              >
                {speed.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {preset.parameterSchema.map((parameter) => {
          return (
            <ParameterControl
              disabled={disabled}
              key={parameter.id}
              parameter={parameter}
              value={instance.parameters[parameter.id]}
              onChange={(value) => updateParameter(parameter, value)}
            />
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => void preview()}
        className="h-[32px] w-full rounded-[6px] border border-[var(--hf-studio-divider)] text-[11px] font-medium text-panel-text-2 transition-colors hover:bg-panel-input hover:text-panel-text-0"
      >
        在时间轴中定位
      </button>
    </div>
  );
}

export function SemanticMotionPanel({
  element,
  animations,
  onMutate,
  compact = false,
  onEditPropertyKeyframe,
}: {
  element: DomEditSelection;
  animations: GsapAnimation[];
  compact?: boolean;
  onEditPropertyKeyframe?: GsapAnimationEditCallbacks["onEditPropertyKeyframe"];
  onMutate: (targetKind: MotionTargetKind, mutation: MotionMutationInput) => Promise<boolean>;
}) {
  const { tx } = useStudioI18n();
  const selectedEffect = usePlayerStore((state) => state.selectedTimelineEffect);
  const selectedPoint = usePlayerStore((state) => state.selectedPropertyKeyframe);
  const ownerKey =
    usePlayerStore((state) => state.selectedElementId) ?? element.id ?? element.hfId ?? "";
  const targetKind = resolveMotionTargetKind(element);
  const instances = useMemo(() => resolveMotionInstances(animations), [animations]);
  const [phase, setPhase] = useState<MotionPhase>(
    () => instances.at(-1)?.instance.phase ?? "enter",
  );
  const instanceSignature = instances
    .map(({ instance }) => `${instance.id}:${instance.presetId}`)
    .join("|");
  const previousInstanceSignatureRef = useRef(instanceSignature);
  useEffect(() => {
    if (previousInstanceSignatureRef.current === instanceSignature) return;
    previousInstanceSignatureRef.current = instanceSignature;
    const latest = instances.at(-1);
    if (latest) setPhase(latest.instance.phase);
  }, [instanceSignature, instances]);
  // The writer appends replacements after removing the canonical target. Older
  // projects can still contain a legacy selector for the same element, so the
  // newest semantic instance is authoritative until the next mutation cleans
  // the duplicate up server-side.
  const current = instances.filter((item) => item.instance.phase === phase).at(-1);

  const groups = useMemo(() => {
    const grouped = new Map<string, ResolvedMotionInstance[]>();
    for (const item of instances)
      grouped.set(item.instance.id, [...(grouped.get(item.instance.id) ?? []), item]);
    let sourceText = element.textContent ?? "";
    const encoded = element.element.getAttribute("data-ipw-motion-source");
    if (encoded) {
      try {
        const decoded: unknown = JSON.parse(encoded);
        if (typeof decoded === "string") sourceText = decoded;
      } catch {}
    }
    return Array.from(grouped.values()).map((items) => ({
      items,
      manual:
        items.some((item) => hasManualMotionKeyframes(item.animation)) ||
        !motionSourceMatchesPreset(
          items.map((item) => item.animation),
          sourceText,
          readAuthoredMotionPositionBase(animations, items[0].instance.target.selector),
        ),
    }));
  }, [instances, element.element, element.textContent]);
  if (compact)
    return (
      <div data-testid="semantic-motion-panel" className="space-y-3">
        {groups.map(({ items, manual }) => {
          const scope = selectedPoint ?? selectedEffect;
          const matchesPoint = (item: ResolvedMotionInstance) =>
            !!scope?.property &&
            scope.time !== undefined &&
            item.animation.keyframes?.keyframes.some(
              (key) =>
                scope.property &&
                scope.property in key.properties &&
                Math.abs(
                  displayStart(item.animation, item.instance) +
                    ((item.animation.duration ?? item.instance.duration) * key.percentage) / 100 -
                    (scope.time ?? 0),
                ) < 0.001,
            );
          const targeted =
            items.find(matchesPoint) ??
            items.find((item) => item.animation.id === scope?.animationId) ??
            items[items.length - 1];
          const active =
            scope?.ownerKey === ownerKey &&
            (items.some((item) => item.animation.id === scope.animationId) ||
              items.some(matchesPoint));
          const preset = getMotionPreset(targeted.instance.presetId);
          return (
            <Card variant="outline" size="sm"
              key={targeted.instance.id}
              data-semantic-motion-id={targeted.instance.id}
              data-animation-id={targeted.animation.id}
              data-selected={active ? "true" : "false"}
              className="gap-0 rounded-xl"
              style={active ? { borderColor: "var(--hf-panel-accent)" } : undefined}
            >
              <CardContent>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm"
                  type="button"
                  aria-label="Locate effect in timeline"
                  className="h-auto min-w-0 flex-1 justify-start px-0 text-left text-[14px] leading-5 font-medium"
                  onClick={() => {
                    const store = usePlayerStore.getState();
                    const time = displayStart(targeted.animation, targeted.instance);
                    store.setSelectedTimelineEffect({
                      ownerKey,
                      animationId: targeted.animation.id,
                      time,
                    });
                    store.requestSeek(time);
                    store.requestClipReveal(ownerKey);
                  }}
                >
                  {preset?.label ?? "已应用动画"}
                </Button>
                <span className="text-[10px] text-panel-text-3">
                  {PHASES.find((item) => item.id === targeted.instance.phase)?.label}
                </span>
                <Button variant="ghost" size="sm"
                  type="button"
                  aria-label="删除动画"
                  className="size-7 shrink-0 p-0 text-muted-foreground"
                  onClick={() =>
                    onMutate(targetKind, {
                      operation: "remove",
                      phase: targeted.instance.phase,
                      templateId: targeted.instance.templateId,
                      applicationKind: targeted.instance.applicationKind,
                    })
                  }
                >
                  <Trash size={14} />
                </Button>
              </div>
              {targeted.animation.keyframes && onEditPropertyKeyframe && (
                <PropertyKeyframeRows
                  compact
                  ownerKey={ownerKey}
                  animation={targeted.animation}
                  onEdit={onEditPropertyKeyframe}
                />
              )}
              {manual ? (
                <Alert role="status" data-testid="manual-motion-preserved" className="mt-3">
                  <AlertDescription>
                    {tx("Manual editing · Template parameters are locked to preserve your keyframes. Continue editing values and timing in the timeline.")}
                  </AlertDescription>
                  <AlertAction>
                    <Button variant="link" size="sm" data-testid="continue-manual-keyframes" onClick={() => {
                      const store = usePlayerStore.getState();
                      const point = store.selectedPropertyKeyframe;
                      if (!point || point.ownerKey !== ownerKey ||
                        !items.some((item) => item.animation.id === point.animationId || matchesPoint(item)))
                        store.setSelectedTimelineEffect({ownerKey, animationId: targeted.animation.id});
                      store.requestClipReveal(ownerKey);
                    }}>{tx("Continue editing in timeline")}</Button>
                  </AlertAction>
                </Alert>
              ) : (
                <p data-testid="preset-keyframe-guidance" className="mt-3 text-ui-caption text-muted-foreground">
                  {tx("Editing a keyframe switches this effect to manual editing and locks its template parameters.")}
                </p>
              )}
              <Collapsible className="mt-3 border-t border-border pt-2">
                <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="px-0 text-ui-caption text-muted-foreground" />}>{tx("Template parameters")}</CollapsibleTrigger>
                <CollapsibleContent>
                <fieldset disabled={manual} className="pt-3 text-[13px] leading-[18px] [&_input]:!text-[13px] [&_select]:!text-[13px] [&_span]:!text-[13px] [&_button]:!text-[13px] [&_div]:!text-[13px]">
                  <AppliedMotionEditor
                    compact
                    disabled={manual}
                    resolved={targeted}
                    element={element}
                    targetKind={targetKind}
                    onMutate={onMutate}
                  />
                </fieldset>
                </CollapsibleContent>
              </Collapsible>
              <Collapsible className="mt-2 text-ui-caption text-muted-foreground">
                <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="px-0 text-ui-caption text-muted-foreground" />}>{tx("Advanced")}</CollapsibleTrigger>
                <CollapsibleContent>
                <code className="block break-all text-ui-caption">{targeted.instance.id}</code>
                </CollapsibleContent>
              </Collapsible>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  return (
    <div className="space-y-3" data-testid="semantic-motion-panel">
      <div className="grid grid-cols-3 rounded-[8px] bg-panel-input p-1">
        {PHASES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPhase(item.id)}
            className={`h-[30px] rounded-[6px] text-[11px] font-medium transition-colors ${
              phase === item.id
                ? "bg-panel-bg text-panel-text-0 shadow-sm"
                : "text-panel-text-3 hover:text-panel-text-1"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {current ? (
        <AppliedMotionEditor
          resolved={current}
          element={element}
          targetKind={targetKind}
          onMutate={onMutate}
        />
      ) : (
        <div className="rounded-[8px] bg-panel-input px-3 py-4 text-center text-[11px] leading-5 text-panel-text-3">
          当前阶段还没有动画。请到“动画模板”中选择并应用一个模板。
        </div>
      )}
    </div>
  );
}
