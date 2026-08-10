import { useMemo, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import {
  defaultMotionDuration,
  listMotionPresets,
  readMotionInstanceFromExtras,
  type MotionInstance,
  type MotionMutationInput,
  type MotionParameter,
  type MotionPhase,
  type MotionPreset,
  type MotionTargetKind,
} from "@hyperframes/core/motion-presets";
import { Trash } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import { isTextEditableSelection } from "./domEditing";
import { ColorField } from "./propertyPanelColor";
import { FlatSelectRow, FlatSlider } from "./propertyPanelFlatPrimitives";

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
    (child) => !child.hasAttribute("data-ipw-motion-word"),
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

function PresetGrid({
  presets,
  onChoose,
}: {
  presets: MotionPreset[];
  onChoose: (preset: MotionPreset) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onChoose(preset)}
          className="group min-h-[56px] rounded-[8px] border border-transparent bg-panel-input px-3 py-2 text-left transition-colors hover:border-[var(--hf-studio-accent)]"
        >
          <div className="text-[12px] font-medium text-panel-text-1">{preset.label}</div>
          <div className="mt-1 truncate text-[10px] text-panel-text-3">
            {preset.semantics.tones.slice(0, 2).join(" · ")}
          </div>
        </button>
      ))}
    </div>
  );
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
  presets,
  targetKind,
  onMutate,
  onPreview,
}: {
  resolved: ResolvedMotionInstance;
  presets: MotionPreset[];
  targetKind: MotionTargetKind;
  onMutate: (targetKind: MotionTargetKind, mutation: MotionMutationInput) => void;
  onPreview: (start: number, duration: number) => void;
}) {
  const { animation, instance } = resolved;
  const preset = presets.find((candidate) => candidate.id === instance.presetId) ?? presets[0];
  if (!preset) return null;
  const start = displayStart(animation, instance);
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
  const updateParameter = (id: string, value: string | number) => {
    apply({ parameters: { ...instance.parameters, [id]: value } });
  };
  const selectedSpeed = closestSpeed(preset, instance.duration);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_34px] gap-2">
        <FlatSelectRow
          ariaLabel="动画效果"
          label=""
          value={instance.presetId}
          options={presets.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
          tier="explicitDefault"
          valueOnly
          onChange={(presetId) => {
            const nextPreset = presets.find((candidate) => candidate.id === presetId);
            if (nextPreset) apply({ presetId, parameters: nextPreset.defaults });
          }}
        />
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
        {preset.parameterSchema
          .filter((parameter) => parameter.id !== "ease")
          .map((parameter) => (
            <ParameterControl
              key={parameter.id}
              parameter={parameter}
              value={instance.parameters[parameter.id]}
              onChange={(value) => updateParameter(parameter.id, value)}
            />
          ))}
      </div>

      <button
        type="button"
        onClick={() => onPreview(start, instance.duration)}
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
  onPreview,
}: {
  element: DomEditSelection;
  animations: GsapAnimation[];
  onMutate: (targetKind: MotionTargetKind, mutation: MotionMutationInput) => void;
  onPreview: (start: number, duration: number) => void;
}) {
  const [phase, setPhase] = useState<MotionPhase>("enter");
  const targetKind = resolveMotionTargetKind(element);
  const instances = useMemo(() => resolveMotionInstances(animations), [animations]);
  const current = instances.find((item) => item.instance.phase === phase);
  const presets = listMotionPresets({ targetKind, phase });

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
          presets={presets}
          targetKind={targetKind}
          onMutate={onMutate}
          onPreview={onPreview}
        />
      ) : (
        <PresetGrid
          presets={presets}
          onChoose={(preset) =>
            onMutate(targetKind, {
              operation: "upsert",
              phase,
              presetId: preset.id,
              parameters: preset.defaults,
            })
          }
        />
      )}
    </div>
  );
}
