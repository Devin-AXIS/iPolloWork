import { useEffect, useMemo, useRef, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import {
  compileMotionInstance,
  createMotionInstance,
  defaultMotionDuration,
  getMotionPreset,
  readMotionInstanceFromExtras,
  type MotionInstance,
  type MotionMutationInput,
  type MotionParameter,
  type MotionPhase,
  type MotionPreset,
  type MotionTargetKind,
} from "@hyperframes/core/motion-presets";
import type { AnimationTemplateDraft } from "../sidebar/AnimationTemplatesTab";
import { Trash } from "../../icons/SystemIcons";
import {
  rebaseMotionPresetKeyframes,
  resolveSemanticMotionTiming,
  resolveMotionTimelineSpan,
  resolveStructuredTextMotionTiming,
} from "../../utils/motionPreset";
import type { DomEditSelection } from "./domEditing";
import { isTextEditableSelection } from "./domEditing";
import { ColorField } from "./propertyPanelColor";
import { FlatRow, FlatSelectRow, FlatSlider } from "./propertyPanelFlatPrimitives";
import {
  driveMotionPreviewTimeline,
  materializeMotionTextPreviewParts,
  previewStructuredMotion,
} from "./structuredMotionPreview";

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

type MotionPreviewTarget = HTMLElement | HTMLElement[];

interface MotionPreviewTimeline {
  to?: (
    target: MotionPreviewTarget,
    vars: Record<string, unknown>,
    position: number,
  ) => MotionPreviewTimeline;
  set?: (
    target: MotionPreviewTarget,
    vars: Record<string, unknown>,
    position: number,
  ) => MotionPreviewTimeline;
  play?: (position?: number) => MotionPreviewTimeline;
  progress?: (value: number) => MotionPreviewTimeline;
  eventCallback?: (type: "onComplete", callback: () => void) => MotionPreviewTimeline;
  kill?: () => void;
}

type MotionPreviewWindow = Window & {
  gsap?: {
    timeline?: (options: Record<string, unknown>) => MotionPreviewTimeline;
    getProperty?: (target: Element, property: string) => number | string;
  };
};

function finiteGsapPosition(value: number | string | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function keyframesForPreview(
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
  }>,
): Record<string, Record<string, number | string>> {
  return Object.fromEntries(
    keyframes.map((frame) => [
      `${frame.percentage}%`,
      { ...frame.properties, ...(frame.ease ? { ease: frame.ease } : {}) },
    ]),
  );
}

function previewMotionDraft(
  draft: AnimationTemplateDraft,
  duration: number,
  loop: boolean,
): (() => void) | undefined {
  const target = draft.selection.element;
  const win = target.ownerDocument.defaultView as MotionPreviewWindow | null;
  const structuredPreview = win?.gsap
    ? previewStructuredMotion({
        target,
        presetId: draft.presetId,
        targetKind: draft.targetKind,
        parameters: draft.parameters,
        duration,
        loop,
        gsap: win.gsap,
      })
    : undefined;
  if (structuredPreview) return structuredPreview.cleanup;

  let compiled: ReturnType<typeof compileMotionInstance>;
  try {
    compiled = compileMotionInstance(
      createMotionInstance({
        presetId: draft.presetId,
        target: { selector: "[data-ipw-motion-preview]" },
        targetKind: draft.targetKind,
        start: 0,
        duration,
        parameters: draft.parameters,
      }),
      target.textContent ?? "",
    );
  } catch {
    return undefined;
  }
  const timeline = win?.gsap?.timeline?.({ paused: true });
  if (!timeline?.to) return undefined;
  const originalStyle = target.getAttribute("style");
  const previewParts =
    draft.targetKind === "text"
      ? materializeMotionTextPreviewParts(target, String(draft.parameters.unit ?? "whole"))
      : { targets: [target], restore: () => undefined };
  const previewTarget =
    previewParts.targets.length === 1 && previewParts.targets[0] === target
      ? target
      : previewParts.targets;
  const previewKeyframes =
    previewTarget === target
      ? rebaseMotionPresetKeyframes(compiled.keyframes, {
          x: finiteGsapPosition(win?.gsap?.getProperty?.(target, "x")),
          y: finiteGsapPosition(win?.gsap?.getProperty?.(target, "y")),
        })
      : compiled.keyframes;
  const keyframes = keyframesForPreview(previewKeyframes);
  let restored = false;
  let stopDriving: () => void = () => undefined;
  const restoreCurrentFrame = () => {
    if (restored) return;
    restored = true;
    stopDriving();
    timeline.kill?.();
    previewParts.restore();
    if (originalStyle === null) target.removeAttribute("style");
    else target.setAttribute("style", originalStyle);
  };
  timeline.to(
    previewTarget,
    {
      keyframes,
      duration,
      ease: compiled.ease,
      ...(typeof compiled.extras.stagger === "number" ? { stagger: compiled.extras.stagger } : {}),
    },
    0,
  );
  stopDriving = driveMotionPreviewTimeline({
    timeline,
    duration,
    loop,
    view: win,
    onComplete: loop ? undefined : restoreCurrentFrame,
  });
  return restoreCurrentFrame;
}

function speedForDuration(preset: MotionPreset, duration: number): number {
  return Math.max(0.25, Math.min(2, defaultMotionDuration(preset) / duration));
}

function clampMotionTime(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Number(Math.min(max, Math.max(min, value)).toFixed(3));
}

function motionInstanceEnd(instance: MotionInstance, start: number): number {
  return instance.end ?? start + instance.duration * (instance.repeat + 1);
}

export function AnimationPropertiesPanel({
  draft,
  element,
  animations,
  onMutate,
  onApplied,
}: {
  draft: AnimationTemplateDraft | null;
  element: DomEditSelection | null;
  animations: GsapAnimation[];
  onMutate: (
    targetKind: MotionTargetKind,
    mutation: MotionMutationInput,
    selectionOverride?: DomEditSelection | null,
  ) => Promise<boolean>;
  onApplied: () => void;
}) {
  const existing = useMemo(() => resolveMotionInstances(animations).at(-1), [animations]);
  const selection = draft?.selection ?? element;
  const presetId = draft?.presetId ?? existing?.instance.presetId;
  const preset = presetId ? getMotionPreset(presetId) : undefined;
  const targetKind = draft?.targetKind ?? existing?.instance.targetKind;
  const parameters = draft?.parameters ?? existing?.instance.parameters;
  const initialDuration = preset
    ? !draft && existing?.instance.presetId === preset.id
      ? existing.instance.duration
      : defaultMotionDuration(preset)
    : 0.65;
  const initialLoop =
    !draft &&
    existing !== undefined &&
    existing.instance.presetId === presetId &&
    existing.instance.loop;
  const timelineSpan = selection
    ? resolveMotionTimelineSpan(selection, initialDuration)
    : { start: 0, end: initialDuration, duration: initialDuration, constrained: false };
  const initialTiming =
    selection && preset
      ? preset.structuredText
        ? resolveStructuredTextMotionTiming(selection, preset.phase, initialDuration)
        : resolveSemanticMotionTiming(selection, preset.phase, initialDuration)
      : { position: 0, duration: initialDuration };
  const initialStart =
    !draft && existing
      ? displayStart(existing.animation, existing.instance)
      : initialTiming.position;
  const initialEnd =
    !draft && existing
      ? motionInstanceEnd(existing.instance, initialStart)
      : Math.min(timelineSpan.end, initialStart + initialTiming.duration);
  const [speed, setSpeed] = useState(() =>
    preset ? speedForDuration(preset, initialDuration) : 1,
  );
  const [loop, setLoop] = useState(Boolean(initialLoop));
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [applying, setApplying] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);
  const speedRef = useRef(speed);
  const loopRef = useRef(loop);
  const startTimeRef = useRef(startTime);
  const endTimeRef = useRef(endTime);
  const activePreviewCleanupRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      activePreviewCleanupRef.current?.();
      activePreviewCleanupRef.current = null;
    },
    [],
  );
  const signature = `${selection?.sourceFile ?? ""}:${selection?.id ?? selection?.hfId ?? selection?.selector ?? ""}:${presetId ?? ""}`;
  const previewSignature =
    selection && preset && targetKind && parameters
      ? JSON.stringify({
          templateId: draft?.templateId ?? `applied:${preset.id}`,
          sourceFile: selection.sourceFile,
          compositionPath: selection.compositionPath,
          locator: selection.hfId ?? selection.id ?? selection.selector,
          presetId: preset.id,
          targetKind,
          parameters,
        })
      : "";

  useEffect(() => {
    const nextSpeed = preset ? speedForDuration(preset, initialDuration) : 1;
    const nextLoop = Boolean(initialLoop);
    speedRef.current = nextSpeed;
    loopRef.current = nextLoop;
    startTimeRef.current = initialStart;
    endTimeRef.current = initialEnd;
    setSpeed(nextSpeed);
    setLoop(nextLoop);
    setStartTime(initialStart);
    setEndTime(initialEnd);
    setApplyFailed(false);
  }, [initialDuration, initialEnd, initialLoop, initialStart, preset, signature]);

  const duration = preset ? Number((defaultMotionDuration(preset) / speed).toFixed(2)) : 0.65;
  // Selection geometry is refreshed while its overlay is visible. The
  // structural signature keeps that harmless refresh from restarting the
  // same autoplay preview on every render.
  const previewDraft = useMemo<AnimationTemplateDraft | null>(() => {
    if (draft) return draft;
    if (!selection || !preset || !targetKind || !parameters) return null;
    return {
      templateId: `applied:${preset.id}`,
      presetId: preset.id,
      targetKind,
      selection,
      parameters,
    };
  }, [previewSignature, selection?.element]);
  useEffect(() => {
    if (!previewDraft || !preset) return;
    const cleanup = previewMotionDraft(previewDraft, duration, loop);
    activePreviewCleanupRef.current = cleanup ?? null;
    return () => {
      cleanup?.();
      if (activePreviewCleanupRef.current === cleanup) {
        activePreviewCleanupRef.current = null;
      }
    };
  }, [duration, loop, preset, previewDraft]);

  if (!selection || !preset || !targetKind || !parameters) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-[11px] leading-5 text-panel-text-3">
        请先选择一个动画，或在视频播放区选择已有动画的元素。
      </div>
    );
  }

  const confirm = async () => {
    if (applying) return;
    setApplying(true);
    setApplyFailed(false);
    const confirmedDuration = Number((defaultMotionDuration(preset) / speedRef.current).toFixed(2));
    try {
      const applied = await onMutate(
        targetKind,
        {
          operation: "upsert",
          phase: preset.phase,
          presetId: preset.id,
          start: startTimeRef.current,
          end: endTimeRef.current,
          duration: confirmedDuration,
          loop: loopRef.current,
          parameters,
        },
        selection,
      );
      if (!applied) {
        setApplyFailed(true);
        return;
      }
      onApplied();
    } catch {
      setApplyFailed(true);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4 px-4 py-3" data-testid="animation-properties-panel">
      <div className="rounded-[8px] bg-[#20bbc0]/10 px-3 py-2 text-[10px] leading-4 text-[#168e92]">
        {selection.label} · {preset.label}
      </div>
      <FlatSlider
        label="动画速度"
        value={speed}
        min={0.25}
        max={2}
        step={0.05}
        tier="explicitCustom"
        displayValue={`${speed.toFixed(2)}×`}
        commitMode="release"
        onCommit={(value) => {
          speedRef.current = value;
          setSpeed(value);
          if (!loopRef.current && preset) {
            const nextDuration = defaultMotionDuration(preset) / value;
            const nextEnd = clampMotionTime(
              startTimeRef.current + nextDuration,
              startTimeRef.current + 0.1,
              timelineSpan.end,
            );
            endTimeRef.current = nextEnd;
            setEndTime(nextEnd);
          }
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <FlatRow
          label="开始时间"
          value={startTime.toFixed(2)}
          tier="explicitCustom"
          inputType="number"
          suffix={<span className="text-[10px] text-panel-text-3">s</span>}
          onCommit={(value) => {
            const next = clampMotionTime(
              Number(value),
              timelineSpan.start,
              Math.max(timelineSpan.start, endTimeRef.current - 0.1),
            );
            startTimeRef.current = next;
            setStartTime(next);
          }}
        />
        <FlatRow
          label="结束时间"
          value={endTime.toFixed(2)}
          tier="explicitCustom"
          inputType="number"
          suffix={<span className="text-[10px] text-panel-text-3">s</span>}
          onCommit={(value) => {
            const next = clampMotionTime(
              Number(value),
              startTimeRef.current + 0.1,
              timelineSpan.end,
            );
            endTimeRef.current = next;
            setEndTime(next);
          }}
        />
      </div>
      <div className="flex h-[38px] items-center justify-between rounded-[7px] bg-panel-input px-3">
        <span className="text-[11px] text-panel-text-2">循环播放</span>
        <button
          type="button"
          role="switch"
          aria-checked={loop}
          aria-label="循环播放"
          onClick={() => {
            const next = !loopRef.current;
            loopRef.current = next;
            setLoop(next);
            const nextEnd = next
              ? timelineSpan.end
              : clampMotionTime(
                  startTimeRef.current + duration,
                  startTimeRef.current + 0.1,
                  timelineSpan.end,
                );
            endTimeRef.current = nextEnd;
            setEndTime(nextEnd);
          }}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20bbc0]/40 ${loop ? "bg-[#20bbc0]" : "bg-panel-border"}`}
        >
          <span
            className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${loop ? "translate-x-4" : "translate-x-0"}`}
          />
        </button>
      </div>
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={applying}
        className="h-9 w-full rounded-[7px] bg-[#20bbc0] text-[12px] font-semibold text-white transition-colors hover:bg-[#18a9ae] disabled:cursor-wait disabled:opacity-70"
      >
        {applying ? "正在应用…" : "确定应用"}
      </button>
      {applyFailed ? (
        <p role="alert" className="text-[10px] leading-4 text-red-400">
          动画未能保存，请重新选择元素后再试。
        </p>
      ) : null}
    </div>
  );
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
}: {
  parameter: MotionParameter;
  value: string | number | boolean | undefined;
  onChange: (value: string | number) => void;
}) {
  if (parameter.kind === "select") {
    return (
      <FlatSelectRow
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
        flat
        label={parameter.label}
        value={String(value ?? "#7c3aed")}
        onCommit={onChange}
      />
    );
  }
  return (
    <FlatSlider
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
}: {
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
  const persistedStart =
    typeof animation.position === "number" ? animation.position : instance.start;
  const [previewRun, setPreviewRun] = useState(0);
  useEffect(() => {
    if (previewRun === 0) return;
    return previewMotionDraft(
      {
        templateId: `applied:${instance.presetId}`,
        presetId: instance.presetId,
        targetKind,
        selection: element,
        parameters: instance.parameters,
      },
      instance.duration,
      instance.loop,
    );
  }, [element.element, instance, previewRun, targetKind]);
  const apply = (updates: Partial<MotionMutationInput>) => {
    onMutate(targetKind, {
      operation: "upsert",
      phase: instance.phase,
      presetId: instance.presetId,
      start,
      duration: instance.duration,
      parameters: instance.parameters,
      ...updates,
    });
  };
  const preview = async () => {
    const timing = resolveSemanticMotionTiming(element, instance.phase, instance.duration, start);
    if (timing.position !== persistedStart || timing.duration !== instance.duration) {
      await onMutate(targetKind, {
        operation: "upsert",
        phase: instance.phase,
        presetId: instance.presetId,
        start: timing.position,
        duration: timing.duration,
        parameters: instance.parameters,
      });
    }
    setPreviewRun((run) => run + 1);
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
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_34px] gap-2">
        <div className="flex h-[34px] min-w-0 items-center rounded-[6px] bg-panel-input px-3 text-[11px] font-medium text-panel-text-1">
          <span className="truncate">{preset.label}</span>
        </div>
        <button
          type="button"
          aria-label="删除动画"
          onClick={() => onMutate(targetKind, { operation: "remove", phase: instance.phase })}
          className="flex h-[34px] items-center justify-center rounded-[6px] text-panel-text-3 transition-colors hover:bg-panel-input hover:text-panel-text-1"
        >
          <Trash size={17} />
        </button>
      </div>

      <FlatSlider
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

      <div className="grid grid-cols-2 gap-2">
        <FlatRow
          label="开始时间"
          value={start.toFixed(2)}
          tier="explicitCustom"
          inputType="number"
          suffix={<span className="text-[10px] text-panel-text-3">s</span>}
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
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20bbc0]/40 ${instance.loop ? "bg-[#20bbc0]" : "bg-panel-border"}`}
        >
          <span
            className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${instance.loop ? "translate-x-4" : "translate-x-0"}`}
          />
        </button>
      </div>

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

      <div className="space-y-2">
        {preset.parameterSchema.map((parameter) => {
          return (
            <ParameterControl
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
        预览动画
      </button>
    </div>
  );
}

export function SemanticMotionPanel({
  element,
  animations,
  onMutate,
}: {
  element: DomEditSelection;
  animations: GsapAnimation[];
  onMutate: (targetKind: MotionTargetKind, mutation: MotionMutationInput) => Promise<boolean>;
}) {
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
