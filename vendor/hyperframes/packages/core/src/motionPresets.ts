import { MOTION_PRESETS, resolveStructuredTextRecipe } from "./motionPresetCatalog.js";
import { buildPresetKeyframes } from "./motionPresetKeyframes.js";
import {
  compileStructuredTextMotion,
  isStructuredTextPreset,
  type CompiledStructuredTextMotion,
  type StructuredTextRecipe,
} from "./structuredTextMotion.js";

export {
  materializeStructuredText,
  restoreStructuredText,
  snapshotStructuredText,
  unwrapStructuredText,
  type StructuredTextSnapshot,
} from "./structuredTextDom.js";

export {
  MOTION_COLOR_SOURCE_PARAMETER,
  MOTION_COMMON_PARAMETERS,
  MOTION_DIRECTION_PARAMETER,
  MOTION_PRESETS,
  MOTION_TEXT_PARAMETERS,
} from "./motionPresetCatalog.js";

export type MotionPhase = "enter" | "emphasis" | "exit";
export type MotionTargetKind = "text" | "element";
export type MotionTextUnit = "whole" | "word" | "character";

export type MotionParameterValue = string | number | boolean;
export type MotionParameters = Record<string, MotionParameterValue>;

export interface MotionParameterOption {
  value: string;
  label: string;
}

export interface MotionParameter {
  id: string;
  label: string;
  kind: "number" | "select" | "color";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: MotionParameterOption[];
}

export interface MotionPreset {
  id: string;
  version: 1;
  label: string;
  phase: MotionPhase;
  targetKinds: MotionTargetKind[];
  parameterSchema: MotionParameter[];
  defaults: MotionParameters;
  semantics: {
    intents: string[];
    tones: string[];
    preferredFor: string[];
    avoidFor: string[];
  };
  structuredText?: StructuredTextRecipe;
}

export interface StableElementLocator {
  selector: string;
  elementId?: string;
  hfId?: string;
}

export interface MotionInstance {
  id: string;
  presetId: string;
  target: StableElementLocator;
  targetKind: MotionTargetKind;
  phase: MotionPhase;
  start: number;
  /** Absolute timeline boundary for the complete effect window. */
  end?: number;
  duration: number;
  loop: boolean;
  repeat: number;
  parameters: MotionParameters;
}

export interface MotionMutationInput {
  operation: "upsert" | "remove";
  phase: MotionPhase;
  presetId?: string;
  start?: number;
  end?: number;
  duration?: number;
  loop?: boolean;
  parameters?: MotionParameters;
}

export interface MotionKeyframe {
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
}

export interface CompiledMotion {
  targetSelector: string;
  position: number;
  duration: number;
  keyframes: MotionKeyframe[];
  ease: string;
  extras: Record<string, MotionParameterValue>;
  structured?: CompiledStructuredTextMotion;
}

export interface MotionValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface MotionValidationResult {
  valid: boolean;
  issues: MotionValidationIssue[];
  parameters: MotionParameters;
}

export const MOTION_DATA_PREFIX = "ipw-motion:v1:";

const PRESETS_BY_ID = new Map(MOTION_PRESETS.map((preset) => [preset.id, preset]));

const MIGRATED_CAPTION_DURATIONS: Record<string, number> = {
  "text.emphasis.highlight-sweep": 1.45,
  "text.enter.matrix-decode": 1.8,
  "text.emphasis.gradient-fill": 1.5,
  "text.emphasis.neon-glow": 2,
  "text.emphasis.neon-accent": 1.7,
  "text.emphasis.rgb-glitch": 1.8,
  "text.enter.clip-wipe": 1.6,
  "text.emphasis.weight-shift": 1.4,
  "text.emphasis.texture-fill": 1.5,
  "text.emphasis.kinetic-slam": 1.35,
  "text.emphasis.emoji-pop": 1.35,
  "text.emphasis.particle-burst": 2,
};

const MOTION_SEARCH_ALIASES: Record<string, string[]> = {
  modern: ["现代"],
  restrained: ["克制"],
  playful: ["活泼", "俏皮"],
  technology: ["科技"],
  cinematic: ["电影感"],
  gentle: ["柔和"],
  energetic: ["动感"],
  warning: ["警示", "警告"],
  emphasis: ["强调"],
  title: ["标题"],
  reveal: ["出现", "进入", "揭示"],
  enter: ["进入", "出现"],
  exit: ["退出", "离开", "消失"],
  fade: ["淡入", "淡出"],
  typewriter: ["打字", "逐字"],
  decode: ["解码"],
  highlight: ["高亮", "扫光"],
  glitch: ["故障"],
};

export function getMotionPreset(presetId: string): MotionPreset | undefined {
  return PRESETS_BY_ID.get(presetId);
}

export function listMotionPresets(filters?: {
  targetKind?: MotionTargetKind;
  phase?: MotionPhase;
  intent?: string;
  tone?: string;
}): MotionPreset[] {
  const searchTerms = (value?: string): string[] => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return [];
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return Array.from(
      new Set([
        normalized,
        ...tokens,
        ...tokens.flatMap((token) => MOTION_SEARCH_ALIASES[token] ?? []),
      ]),
    );
  };
  const intentTerms = searchTerms(filters?.intent);
  const toneTerms = searchTerms(filters?.tone);
  return MOTION_PRESETS.filter((preset) => {
    if (filters?.targetKind && !preset.targetKinds.includes(filters.targetKind)) return false;
    if (filters?.phase && preset.phase !== filters.phase) return false;
    const intentValues = [
      preset.id,
      preset.label,
      ...preset.semantics.intents,
      ...preset.semantics.preferredFor,
    ].map((item) => item.toLowerCase());
    const toneValues = preset.semantics.tones.map((item) => item.toLowerCase());
    if (
      intentTerms.length > 0 &&
      !intentTerms.some((term) => intentValues.some((value) => value.includes(term)))
    )
      return false;
    if (
      toneTerms.length > 0 &&
      !toneTerms.some((term) => toneValues.some((value) => value.includes(term)))
    )
      return false;
    return true;
  });
}

function finiteNumber(value: MotionParameterValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function validateMotionParameters(
  preset: MotionPreset,
  input: MotionParameters = {},
): MotionValidationResult {
  const issues: MotionValidationIssue[] = [];
  const parameters: MotionParameters = { ...preset.defaults };
  const schema = new Map(preset.parameterSchema.map((parameter) => [parameter.id, parameter]));
  for (const key of Object.keys(input)) {
    if (!schema.has(key))
      issues.push({
        path: `parameters.${key}`,
        code: "unknown_parameter",
        message: `Unknown parameter: ${key}`,
      });
  }
  for (const parameter of preset.parameterSchema) {
    const supplied = input[parameter.id];
    if (supplied === undefined) continue;
    if (parameter.kind === "number") {
      const value = finiteNumber(supplied);
      if (value === undefined) {
        issues.push({
          path: `parameters.${parameter.id}`,
          code: "invalid_number",
          message: `${parameter.label} must be a finite number`,
        });
        continue;
      }
      if (
        (parameter.min !== undefined && value < parameter.min) ||
        (parameter.max !== undefined && value > parameter.max)
      ) {
        issues.push({
          path: `parameters.${parameter.id}`,
          code: "out_of_range",
          message: `${parameter.label} is outside the supported range`,
        });
        continue;
      }
      parameters[parameter.id] = value;
      continue;
    }
    if (typeof supplied !== "string") {
      issues.push({
        path: `parameters.${parameter.id}`,
        code: "invalid_string",
        message: `${parameter.label} must be a string`,
      });
      continue;
    }
    if (
      parameter.kind === "select" &&
      !parameter.options?.some((option) => option.value === supplied)
    ) {
      issues.push({
        path: `parameters.${parameter.id}`,
        code: "invalid_option",
        message: `${parameter.label} is not supported`,
      });
      continue;
    }
    if (parameter.kind === "color" && !/^#[0-9a-f]{6}$/i.test(supplied)) {
      issues.push({
        path: `parameters.${parameter.id}`,
        code: "invalid_color",
        message: `${parameter.label} must use #RRGGBB`,
      });
      continue;
    }
    parameters[parameter.id] = supplied;
  }
  return { valid: issues.length === 0, issues, parameters };
}

function encodeMotionData(instance: MotionInstance): string {
  return `${MOTION_DATA_PREFIX}${JSON.stringify(instance)}`;
}

function readExtraString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("__raw:")) return value;
  const raw = value.slice(6);
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function readMotionInstanceFromExtras(
  extras: Record<string, unknown> | undefined,
): MotionInstance | null {
  const data = readExtraString(extras?.data);
  if (!data?.startsWith(MOTION_DATA_PREFIX)) return null;
  try {
    const value = JSON.parse(data.slice(MOTION_DATA_PREFIX.length)) as MotionInstance;
    if (!value || typeof value !== "object") return null;
    const preset = getMotionPreset(value.presetId);
    if (!preset || !value.target?.selector) return null;
    if (preset.phase !== value.phase || !preset.targetKinds.includes(value.targetKind)) return null;
    if (!Number.isFinite(value.start) || value.start < 0) return null;
    if (!Number.isFinite(value.duration) || value.duration <= 0) return null;
    const validated = validateMotionParameters(preset, value.parameters);
    if (!validated.valid) return null;
    const loop = value.loop === true;
    const repeat =
      loop && Number.isFinite(value.repeat) && value.repeat >= 0
        ? Math.floor(value.repeat)
        : loop
          ? 1
          : 0;
    const end =
      Number.isFinite(value.end) && Number(value.end) > value.start
        ? Number(value.end)
        : value.start + value.duration * (repeat + 1);
    return { ...value, end, loop, repeat, parameters: validated.parameters };
  } catch {
    return null;
  }
}

export function compileMotionInstance(instance: MotionInstance, text = ""): CompiledMotion {
  const preset = getMotionPreset(instance.presetId);
  if (!preset) throw new Error(`Unknown motion preset: ${instance.presetId}`);
  if (preset.phase !== instance.phase)
    throw new Error(`Preset ${preset.id} does not support phase ${instance.phase}`);
  if (!preset.targetKinds.includes(instance.targetKind))
    throw new Error(`Preset ${preset.id} does not support ${instance.targetKind}`);
  if (!Number.isFinite(instance.start) || instance.start < 0)
    throw new Error("Motion start must be a finite non-negative number");
  if (!Number.isFinite(instance.duration) || instance.duration <= 0)
    throw new Error("Motion duration must be a finite positive number");
  const validated = validateMotionParameters(preset, instance.parameters);
  if (!validated.valid) throw new Error(validated.issues.map((issue) => issue.message).join("; "));
  const unit = String(validated.parameters.unit ?? "whole") as MotionTextUnit;
  const targetSelector =
    unit === "character"
      ? `${instance.target.selector} [data-ipw-motion-char]`
      : unit === "word"
        ? `${instance.target.selector} > [data-ipw-motion-word]`
        : instance.target.selector;
  const stagger = unit === "whole" ? 0 : Number(validated.parameters.stagger ?? 0);
  const compiled: CompiledMotion = {
    targetSelector,
    position: instance.start,
    duration: instance.duration,
    keyframes: buildPresetKeyframes(preset.id, validated.parameters),
    ease: String(validated.parameters.ease ?? "power2.out"),
    extras: {
      // GSAP preserves `id` on the runtime Animation (including its keyframe
      // wrapper), giving Studio a stable, direct replacement handle.
      id: instance.id,
      data: encodeMotionData({ ...instance, parameters: validated.parameters }),
      ...(instance.loop && instance.repeat > 0 ? { repeat: instance.repeat } : {}),
      ...(stagger > 0 ? { stagger } : {}),
    },
  };
  if (isStructuredTextPreset(preset)) {
    compiled.structured = compileStructuredTextMotion(
      { ...instance, parameters: validated.parameters },
      text,
      resolveStructuredTextRecipe(preset, validated.parameters),
    );
  }
  return compiled;
}

export function defaultMotionDuration(preset: MotionPreset): number {
  const migratedCaptionDuration = MIGRATED_CAPTION_DURATIONS[preset.id];
  if (migratedCaptionDuration !== undefined) return migratedCaptionDuration;
  if (preset.id.startsWith("background.")) return 3.2;
  if (preset.id === "text.enter.fold-reveal") return 0.9;
  if (preset.id === "motion.enter.gradual-focus") return 0.85;
  if (preset.id === "motion.enter.scan-reveal") return 0.75;
  if (preset.id === "element.enter.bounce-card") return 0.9;
  if (preset.id === "motion.emphasis.soft-float") return 1.6;
  if (preset.id === "motion.emphasis.focus-tilt") return 1.1;
  if (preset.id === "motion.emphasis.magnetic-snap") return 0.9;
  if (preset.id === "text.emphasis.prism-glow") return 1.4;
  if (preset.id === "text.emphasis.shiny-sweep") return 1.4;
  if (preset.id === "text.emphasis.true-focus") return 1.2;
  if (preset.id === "element.emphasis.spotlight-card") return 1.1;
  if (preset.id === "element.emphasis.glare-sweep") return 1.1;
  if (preset.phase === "emphasis") return 0.8;
  if (preset.id === "text.enter.typewriter" || preset.id === "text.enter.decode") return 1.2;
  return 0.65;
}

export function createMotionInstance(input: {
  presetId: string;
  target: StableElementLocator;
  targetKind: MotionTargetKind;
  start: number;
  duration?: number;
  end?: number;
  loop?: boolean;
  repeat?: number;
  parameters?: MotionParameters;
}): MotionInstance {
  const preset = getMotionPreset(input.presetId);
  if (!preset) throw new Error(`Unknown motion preset: ${input.presetId}`);
  const validated = validateMotionParameters(preset, input.parameters);
  if (!validated.valid) throw new Error(validated.issues.map((issue) => issue.message).join("; "));
  const loop = input.loop === true;
  const repeat =
    loop && Number.isFinite(input.repeat) && Number(input.repeat) >= 0
      ? Math.floor(Number(input.repeat))
      : loop
        ? 1
        : 0;
  const duration = input.duration ?? defaultMotionDuration(preset);
  const end = input.end ?? input.start + duration * (repeat + 1);
  if (!Number.isFinite(end) || end <= input.start) {
    throw new Error("Motion end must be later than motion start");
  }
  return {
    id: `motion:${input.target.selector}:${preset.phase}`,
    presetId: preset.id,
    target: input.target,
    targetKind: input.targetKind,
    phase: preset.phase,
    start: input.start,
    end,
    duration,
    loop,
    repeat,
    parameters: validated.parameters,
  };
}
