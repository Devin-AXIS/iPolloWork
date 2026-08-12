import type {
  MotionInstance,
  MotionKeyframe,
  MotionPreset,
  MotionTextUnit,
} from "./motionPresets.js";

export type StructuredTextRole =
  | "unit"
  | "text"
  | "background"
  | "clone-primary"
  | "clone-accent"
  | "mask"
  | "texture"
  | "particle-container"
  | "particle";

export interface StructuredTextLayer {
  role: StructuredTextRole;
  perUnit: boolean;
  className: string;
}

export interface CompiledStructuredTrack {
  role: StructuredTextRole;
  keyframes: MotionKeyframe[];
  position: number;
  duration: number;
  stagger: number;
}

export interface StructuredTextParticleSpec {
  count: number;
  x: readonly [number, number];
  y: readonly [number, number];
  size: readonly [number, number];
  delay: readonly [number, number];
}

export interface StructuredTextRecipe {
  version: 1;
  id: string;
  presetId: string;
  split: MotionTextUnit;
  layers: StructuredTextLayer[];
  tracks: CompiledStructuredTrack[];
  particles?: StructuredTextParticleSpec;
  assets?: string[];
  seed?: number | string;
}

export interface CompiledStructuredTextMotion {
  version: 1;
  recipeId: string;
  split: MotionTextUnit;
  units: Array<{ index: number; sourceText: string }>;
  layers: StructuredTextLayer[];
  tracks: CompiledStructuredTrack[];
  particles?: Array<{ unitIndex: number; x: number; y: number; size: number; delay: number }>;
  assets?: string[];
  seed: number;
}

const STRUCTURED_TEXT_ROLES = new Set<StructuredTextRole>([
  "unit", "text", "background", "clone-primary", "clone-accent", "mask", "texture",
  "particle-container", "particle",
]);

const STRUCTURED_MOTION_PROPERTIES = new Set([
  "opacity", "x", "y", "scale", "scaleX", "scaleY", "rotation", "rotationX", "rotationY",
  "skewX", "skewY", "color", "backgroundColor", "backgroundImage", "backgroundClip",
  "backgroundPosition", "backgroundSize", "borderRadius", "boxShadow", "clipPath", "filter",
  "fontWeight", "letterSpacing", "mixBlendMode", "textShadow", "transformOrigin", "visibility",
  "WebkitTextFillColor",
]);

const MAX_LAYERS = 16;
const MAX_TRACKS = 32;
const MAX_KEYFRAMES_PER_TRACK = 16;
const MAX_PARTICLES = 96;
const MAX_TEXT_UNITS = 512;
const MAX_ASSETS = 8;
const MAX_ASSET_PATH_LENGTH = 256;
const MAX_EASE_LENGTH = 96;
const GSAP_EASE_PATTERN = /^(?:none|linear|(?:power[0-4]|sine|expo|circ|back|elastic|bounce|steps)(?:\.(?:in|out|inOut))?)(?:\(-?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+))*\))?$/;

export function segmentStructuredText(text: string, split: MotionTextUnit): string[] {
  return segmentStructuredTextFallback(text, split);
}

type SegmenterResult = { segment: string; isWordLike?: boolean };
type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: "word" | "grapheme" },
) => { segment(input: string): Iterable<SegmenterResult> };

export function segmentStructuredTextFallback(text: string, split: MotionTextUnit): string[] {
  if (split === "whole") return text ? [text] : [];
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
  if (!Segmenter) {
    throw new Error("Structured text motion requires Intl.Segmenter support");
  }
  const segments = Array.from(
    new Segmenter("und", { granularity: split === "word" ? "word" : "grapheme" }).segment(text),
  );
  return split === "word"
    ? segments.filter((segment) => segment.isWordLike).map((segment) => segment.segment)
    : segments.map((segment) => segment.segment);
}

export function structuredTextSeed(value: string | number): number {
  const input = String(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createStructuredTextRng(seed: string | number): () => number {
  let state = structuredTextSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function assertFinite(value: number, label: string, max = 60): void {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a finite number between 0 and ${max}`);
  }
}

function validateRole(role: string, path: string): void {
  if (!STRUCTURED_TEXT_ROLES.has(role as StructuredTextRole)) {
    throw new Error(`${path} has an unsupported structured text role: ${role}`);
  }
}

function validateKeyframes(keyframes: MotionKeyframe[], path: string): void {
  if (!Array.isArray(keyframes) || keyframes.length === 0 || keyframes.length > MAX_KEYFRAMES_PER_TRACK) {
    throw new Error(`${path} must contain between 1 and ${MAX_KEYFRAMES_PER_TRACK} keyframes`);
  }
  for (const [index, keyframe] of keyframes.entries()) {
    assertFinite(keyframe.percentage, `${path}[${index}].percentage`, 100);
    for (const [property, value] of Object.entries(keyframe.properties)) {
      if (!STRUCTURED_MOTION_PROPERTIES.has(property)) {
        throw new Error(`${path}[${index}] has an unsupported property: ${property}`);
      }
      if (typeof value !== "number" && typeof value !== "string") {
        throw new Error(`${path}[${index}].${property} must be a finite number or string value`);
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error(`${path}[${index}].${property} must be finite`);
      }
    }
    if (
      keyframe.ease !== undefined &&
      (typeof keyframe.ease !== "string" ||
        keyframe.ease.length === 0 ||
        keyframe.ease.length > MAX_EASE_LENGTH ||
        !GSAP_EASE_PATTERN.test(keyframe.ease))
    ) {
      throw new Error(`${path}[${index}].ease must use a safe GSAP ease string`);
    }
  }
}

function validateRange(range: readonly [number, number], path: string): void {
  if (range.length !== 2 || !Number.isFinite(range[0]) || !Number.isFinite(range[1])) {
    throw new Error(`${path} must contain two finite numbers`);
  }
}

function copyValidatedAssets(assets: unknown): string[] | undefined {
  if (assets === undefined) return undefined;
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS) {
    throw new Error(`Structured text assets must contain at most ${MAX_ASSETS} registry-relative paths`);
  }
  return assets.map((asset, index) => {
    if (
      typeof asset !== "string" ||
      asset.length === 0 ||
      asset.length > MAX_ASSET_PATH_LENGTH ||
      !asset.startsWith("registry/") ||
      asset.startsWith("/") ||
      asset.startsWith("\\") ||
      asset.startsWith("//") ||
      asset.startsWith("\\\\") ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(asset) ||
      !/^[A-Za-z0-9._/-]+$/.test(asset) ||
      asset.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) {
      throw new Error(`assets[${index}] must be a safe registry-relative path`);
    }
    return asset;
  });
}

export function validateStructuredTextRecipe(recipe: StructuredTextRecipe): void {
  if (recipe.version !== 1) throw new Error("Structured text recipe version must be 1");
  if (!recipe.id.trim() || !recipe.presetId.trim()) throw new Error("Structured text recipe ids are required");
  if (!(["whole", "word", "character"] as const).includes(recipe.split)) {
    throw new Error(`Unsupported structured text split: ${recipe.split}`);
  }
  if (!Array.isArray(recipe.layers) || recipe.layers.length === 0 || recipe.layers.length > MAX_LAYERS) {
    throw new Error(`Structured text recipes support between 1 and ${MAX_LAYERS} layers`);
  }
  recipe.layers.forEach((layer, index) => {
    validateRole(layer.role, `layers[${index}]`);
    if (typeof layer.perUnit !== "boolean" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(layer.className)) {
      throw new Error(`layers[${index}] must use a boolean perUnit and safe className`);
    }
  });
  if (!Array.isArray(recipe.tracks) || recipe.tracks.length === 0 || recipe.tracks.length > MAX_TRACKS) {
    throw new Error(`Structured text recipes support between 1 and ${MAX_TRACKS} tracks`);
  }
  recipe.tracks.forEach((track, index) => {
    validateRole(track.role, `tracks[${index}]`);
    assertFinite(track.position, `tracks[${index}].position`);
    assertFinite(track.duration, `tracks[${index}].duration`);
    assertFinite(track.stagger, `tracks[${index}].stagger`, 10);
    validateKeyframes(track.keyframes, `tracks[${index}].keyframes`);
  });
  if (recipe.particles) {
    if (!Number.isInteger(recipe.particles.count) || recipe.particles.count < 0 || recipe.particles.count > MAX_PARTICLES) {
      throw new Error(`Structured text particle count must be an integer between 0 and ${MAX_PARTICLES}`);
    }
    validateRange(recipe.particles.x, "particles.x");
    validateRange(recipe.particles.y, "particles.y");
    validateRange(recipe.particles.size, "particles.size");
    validateRange(recipe.particles.delay, "particles.delay");
  }
  copyValidatedAssets(recipe.assets);
}

function randomInRange(random: () => number, range: readonly [number, number]): number {
  return range[0] + (range[1] - range[0]) * random();
}

function roundTime(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function naturalTrackEnd(track: CompiledStructuredTrack, unitCount: number): number {
  return track.position + track.duration + track.stagger * Math.max(0, unitCount - 1);
}

function structuredTimingScale(
  tracks: readonly CompiledStructuredTrack[],
  unitCount: number,
  duration: number,
): number {
  const naturalDuration = Math.max(...tracks.map((track) => naturalTrackEnd(track, unitCount)), 0);
  if (naturalDuration <= 0) return 1;
  return duration / naturalDuration;
}

export function compileStructuredTextMotion(
  instance: MotionInstance,
  text: string,
  recipe?: StructuredTextRecipe,
): CompiledStructuredTextMotion | undefined {
  if (!recipe) return undefined;
  validateStructuredTextRecipe(recipe);
  if (recipe.presetId !== instance.presetId) {
    throw new Error(`Structured text recipe ${recipe.id} does not match ${instance.presetId}`);
  }
  const units = segmentStructuredText(text, recipe.split);
  if (units.length > MAX_TEXT_UNITS) {
    throw new Error(`Structured text recipes support at most ${MAX_TEXT_UNITS} text units`);
  }
  const seed = structuredTextSeed(recipe.seed ?? `${instance.id}:${recipe.id}:${text}`);
  const random = createStructuredTextRng(seed);
  const assets = copyValidatedAssets(recipe.assets);
  const particleSpec = recipe.particles;
  const timingScale = structuredTimingScale(recipe.tracks, units.length, instance.duration);
  const particles = particleSpec && units.length > 0
    ? Array.from({ length: particleSpec.count }, (_, index) => ({
        unitIndex: units.length ? index % units.length : 0,
        x: randomInRange(random, particleSpec.x),
        y: randomInRange(random, particleSpec.y),
        size: randomInRange(random, particleSpec.size),
        delay: randomInRange(random, particleSpec.delay),
      }))
    : undefined;
  return {
    version: 1,
    recipeId: recipe.id,
    split: recipe.split,
    units: units.map((sourceText, index) => ({ index, sourceText })),
    layers: recipe.layers.map((layer) => ({ ...layer })),
    tracks: recipe.tracks.map((track) => ({
      ...track,
      position: roundTime(track.position * timingScale),
      duration: roundTime(track.duration * timingScale),
      stagger: roundTime(track.stagger * timingScale),
      keyframes: track.keyframes.map((keyframe) => ({ ...keyframe, properties: { ...keyframe.properties } })),
    })),
    ...(particles ? { particles } : {}),
    ...(assets ? { assets } : {}),
    seed,
  };
}

export function isStructuredTextPreset(
  preset: Pick<MotionPreset, "structuredText">,
): preset is MotionPreset & { structuredText: StructuredTextRecipe } {
  return preset.structuredText !== undefined;
}

export function structuredMotionSelector(baseSelector: string, role: StructuredTextRole): string {
  validateRole(role, "role");
  return `${baseSelector} [data-ipw-motion-role="${role}"]`;
}
