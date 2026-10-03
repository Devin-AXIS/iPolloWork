import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { z } from "zod";
import sharp from "sharp";
import { hyperframesEffectVariableSchema, hyperframesMotionRecipeSchema, hyperframesVideoInstanceSchema, hyperframesPageCaptureSchema } from "@ipollowork/types/hyperframes";

import { ApiError } from "../errors.js";
import { resolveHyperframesRegistryRoot } from "../hyperframes-catalog.js";
import { resolveWorkspaceFile } from "./storage.js";

const componentIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const videoSourcePathSchema = z.string().regex(/^video\/[A-Za-z0-9_-]+\/index\.html$/u);
const videoMotionWindowSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
}).strict().refine(window => window.end > window.start, { message: "Motion end must be after its start" });
const videoBeatSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  intent: z.string().min(1),
  focus: z.string().min(1),
  action: z.string().min(1),
  result: z.string().min(1),
  targets: z.preprocess(
    value => typeof value === "string" ? [value] : value,
    z.array(z.string().min(1)).min(1),
  ),
  animation: z.string().regex(/^(?:component|preset|custom|hold):\S(?:.*\S)?$/u),
  motion: videoMotionWindowSchema,
}).strict().superRefine((beat, context) => {
  if (beat.end <= beat.start) context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "Beat end must be after its start" });
  if (beat.motion.start < beat.start || beat.motion.end > beat.end) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["motion"], message: "Motion must stay inside its beat" });
  }
});
const videoBeatMapSchema = z.array(videoBeatSchema).min(1);
const videoAudioCueSchema = z.array(z.object({ time: z.number().nonnegative(), strength: z.number().min(0).max(1) }).strict()).min(1);
const videoTimingSourceSchema = z.enum(["voiceover", "estimated-reading", "visual-cue", "music", "media"]);
const videoTransitionIntentSchema = z.enum(["continue", "topic-change", "time-change", "location-change", "compare", "reveal", "closure"]);
const videoTransitionPresets = new Set([
  "cut",
  "preset:element.enter.fade",
  "preset:element.enter.slide",
  "preset:element.enter.scale",
  "preset:motion.enter.content-reveal",
  "preset:motion.enter.gradual-focus",
  "preset:motion.enter.scan-reveal",
  "preset:transition.depth-push",
  "preset:transition.diagonal-slice",
  "preset:transition.lens-focus",
  "preset:transition.split-wipe",
]);
const customTransitionId = /^custom:[a-z][a-z0-9-]*$/u;
const customTransitionHandoffSchema = z.object({
  fromSceneId: z.string().min(1),
  outgoingResult: z.string().trim().min(8),
  incomingSubject: z.string().trim().min(8),
  continuity: z.string().trim().min(8),
  visualAction: z.string().trim().min(8),
  target: z.string().trim().min(1),
}).strict();
const registryFileSchema = z.object({
  path: z.string().min(1),
  target: z.string().min(1),
  type: z.string().min(1),
}).strict();
const registryManifestSchema = z.object({
  name: componentIdSchema,
  type: z.enum(["hyperframes:block", "hyperframes:component"]),
  duration: z.number().positive().optional(),
  files: z.array(registryFileSchema).min(1),
  registryDependencies: z.array(componentIdSchema).optional(),
  visualComponent: z.object({ surfaces: z.array(z.string()) }).passthrough().optional(),
  variables: z.array(z.object({ id: z.string().min(1) }).passthrough()).optional(),
  motionRecipe: hyperframesMotionRecipeSchema.optional(),
}).passthrough();

const MAX_STILL_SECONDS = 4;
const SPATIAL_CAMERA_RECIPES = new Set([
  "graze-face-tour",
  "depth-layer-moves",
  "spotlight-hero-card",
  "runway-ground-skim",
  "steep-tilt-glide",
]);

export const videoComponentInstallInput = z.object({
  sourcePath: videoSourcePathSchema,
  componentIds: z.array(componentIdSchema).min(1).max(12),
  instances: z.array(hyperframesVideoInstanceSchema).min(1).max(48).optional(),
  motionStyle: z.enum(["restrained", "balanced", "energetic"]).default("balanced"),
  mount: z.boolean().default(false),
}).strict();

const motionStyles = {
  restrained: { distance: 10, emphasisScale: 1.006, durationFactor: 1.15, ease: "power1.out", resolveEase: "power1.inOut" },
  balanced: { distance: 16, emphasisScale: 1.012, durationFactor: 1, ease: "power2.out", resolveEase: "power2.inOut" },
  energetic: { distance: 24, emphasisScale: 1.02, durationFactor: .85, ease: "power3.out", resolveEase: "power2.inOut" },
};

const customRecipeEvidenceSchema = z.object({
  candidates: z.array(z.object({ componentId: componentIdSchema, limitation: z.string().trim().min(20).max(500) }).strict()).min(1).max(3),
  splitOrCombine: z.string().trim().min(20).max(500),
  minimalScope: z.string().trim().min(20).max(500),
}).strict();

async function resolveNarrationCues(workspace: Workspace, projectRelative: string,
  narration: NonNullable<z.infer<typeof hyperframesVideoInstanceSchema>["narration"]>, eventIds: string[], duration: number) {
  const path = resolveWorkspaceFile(workspace.path, narration.timingSourcePath);
  if (!path.relativePath.startsWith(`${projectRelative}/assets/`)) throw new ApiError(400, "invalid_video_recipe_alignment", "Timing must belong to this video project.");
  const timing = z.object({ alignment: z.literal("provider"), words: z.array(z.object({
    text: z.string(), beginIndex: z.number().int().nonnegative(), endIndex: z.number().int().positive(),
    startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(),
  })).min(1).max(10000) }).parse(JSON.parse(await readFile(path.absolutePath, "utf8")));
  const significant = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "");
  if (significant(timing.words.map(word => word.text).join("")) !== significant(narration.text)
    || timing.words.some((word, index) => significant(narration.text.slice(word.beginIndex, word.endIndex)) !== significant(word.text)
      || word.endSeconds > duration || word.endSeconds <= word.startSeconds
      || (index > 0 && (word.startSeconds < timing.words[index - 1]!.endSeconds || word.beginIndex < timing.words[index - 1]!.endIndex)))) {
    throw new ApiError(400, "invalid_video_recipe_alignment", "Timing must cover the exact narration in order and within scene boundaries.");
  }
  if (Object.keys(narration.bindings).length !== eventIds.length || eventIds.some(id => !narration.bindings[id])) {
    throw new ApiError(400, "invalid_video_recipe_alignment", "Bind every active semantic event to an exact spoken phrase.");
  }
  const cues: Record<string, number> = {};
  for (const id of eventIds) {
    const binding = narration.bindings[id]!;
    const matches: number[] = [];
    for (let index = narration.text.indexOf(binding.phrase); index >= 0; index = narration.text.indexOf(binding.phrase, index + binding.phrase.length)) matches.push(index);
    const index = matches[(binding.occurrence ?? 1) - 1];
    if (index === undefined || (!binding.occurrence && matches.length !== 1)) throw new ApiError(400, "invalid_video_recipe_alignment", "Spoken phrase missing or ambiguous; specify occurrence rather than guessing.");
    const word = timing.words.find(word => word.beginIndex <= index && word.endIndex > index);
    if (!word) throw new ApiError(400, "invalid_video_recipe_alignment", "The spoken phrase has no measured word anchor.");
    cues[id] = Math.round(word.startSeconds * 30) / 30;
  }
  return cues;
}

export const videoComponentCheckInput = z.object({
  sourcePath: videoSourcePathSchema,
  recipesOnly: z.boolean().optional(),
}).strict();

type Workspace = { id: string; path: string };
type InstalledComponent = {
  componentId: string;
  durationSeconds?: number;
  written: string[];
  snippet: string;
  motionContract: MotionContract;
  motionRecipe?: z.infer<typeof hyperframesMotionRecipeSchema>;
  variables?: z.infer<typeof registryManifestSchema>["variables"];
};

function htmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Resolve all inputs before copying files; never silently truncate user content. */
async function resolveRecipeInstance(
  workspace: Workspace,
  projectRelative: string,
  instance: z.infer<typeof hyperframesVideoInstanceSchema>,
  manifest: z.infer<typeof registryManifestSchema>,
  motionStyle: keyof typeof motionStyles = "balanced",
) {
  const recipe = manifest.motionRecipe;
  if (!recipe) throw new ApiError(400, "video_recipe_unavailable", `${instance.componentId} has no authored semantic recipe; use the existing manual composition path.`);
  const variables = z.array(hyperframesEffectVariableSchema).parse(manifest.variables);
  const values: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(instance.values)) {
    if (key === "motionCueTimes" || key === "motionStyle" || !variables.some(variable => variable.id === key)) {
      throw new ApiError(400, "invalid_video_recipe_values", `Unknown or reserved recipe variable: ${key}`);
    }
  }
  for (const variable of variables) {
    if (variable.id === "motionCueTimes") continue;
    const value = instance.values[variable.id];
    const valid = variable.type === "number"
      ? typeof value === "number" && (variable.min === undefined || value >= variable.min) && (variable.max === undefined || value <= variable.max)
      : variable.type === "boolean"
      ? typeof value === "boolean"
      : typeof value === "string" && value.trim().length > 0
        && (variable.type !== "string" || variable.maxLength === undefined || value.length <= variable.maxLength)
        && (variable.type !== "enum" || variable.options.some(option => option.value === value))
        && (variable.type !== "color" || /^#[a-f0-9]{6}$/iu.test(value));
    if (!valid || value === undefined) throw new ApiError(400, "invalid_video_recipe_values", `Supply a valid ${variable.id} for ${instance.componentId}; content is never replaced by demo defaults.`);
    values[variable.id] = value;
    if (variable.id === "mediaUrl") {
      if (typeof value !== "string" || !value.startsWith("assets/") || posix.normalize(value) !== value || value.includes("\\")) throw new ApiError(400, "invalid_video_recipe_asset", "Recipe media must be an existing project-relative assets/ file");
      const asset = resolveWorkspaceFile(workspace.path, `${projectRelative}/${value}`);
      const file = await stat(asset.absolutePath).catch(() => null);
      if (!file?.isFile() || file.size === 0) throw new ApiError(400, "video_recipe_asset_missing", `Missing or empty recipe asset: ${value}`);
    }
  }
  if (values.captureLayout !== undefined) {
    let capture;
    try { capture = hyperframesPageCaptureSchema.parse(JSON.parse(String(values.captureLayout))); }
    catch { throw new ApiError(400, "invalid_video_capture_layout", "Provide bounded, unique screenshot regions in CSS-page coordinates, with valid hero and foreground IDs."); }
    if (typeof values.mediaUrl !== "string") throw new ApiError(400, "invalid_video_recipe_asset", "Page-space recipes need an existing screenshot mediaUrl.");
    const source = resolveWorkspaceFile(workspace.path, `${projectRelative}/${values.mediaUrl}`);
    const image = await sharp(source.absolutePath).metadata().catch(() => null);
    if (!image || image.width !== Math.round(capture.width * capture.pixelRatio) || image.height !== Math.round(capture.height * capture.pixelRatio)) {
      throw new ApiError(400, "video_capture_dimensions_mismatch", "Screenshot pixel dimensions must match captureLayout CSS width/height multiplied by pixelRatio. Recapture or correct measured geometry; do not guess crop positions.");
    }
  }
  for (const [key, limit] of Object.entries(recipe.textLimits ?? {})) {
    const text = values[key];
    const lines = typeof text === "string" ? text.replaceAll("\\n", "\n").split("\n") : [];
    if (!lines.length || lines.length > limit.maxLines || lines.some(line => line.length > limit.maxLineLength)) {
      throw new ApiError(400, "video_recipe_text_overflow", `${key} exceeds ${limit.maxLines} lines or ${limit.maxLineLength} characters per line. ${recipe.usage.fallback.overflow}`);
    }
  }
  let itemCount: number | undefined;
  if (recipe.capacity) {
    const capacity = recipe.capacity;
    const raw = String(values[capacity.variable]).replaceAll("\\n", "\n");
    const parts = raw.split(capacity.separator.replaceAll("\\n", "\n"));
    const count = capacity.variable === "code" ? parts.length : parts.filter(part => part.trim()).length;
    if (count < recipe.capacity.minItems || count > recipe.capacity.maxItems) throw new ApiError(400, "video_recipe_capacity_exceeded", `${instance.componentId} supports ${recipe.capacity.minItems}–${recipe.capacity.maxItems} items; ${recipe.usage.fallback.overflow}`);
    if (capacity.fieldSeparator) {
      for (const item of parts.filter(part => part.trim())) {
        const fields = item.split(capacity.fieldSeparator).map(field => field.trim());
        const numeric = capacity.numericField;
        if (fields.length !== capacity.fieldsPerItem || fields.some(field => !field || (capacity.maxFieldLength !== undefined && field.length > capacity.maxFieldLength))
          || (numeric !== undefined && (!/^\d+(?:\.\d+)?$/.test(fields[numeric] ?? "") || !Number.isFinite(Number(fields[numeric]))))) {
          throw new ApiError(400, "invalid_video_recipe_item", `Malformed ${recipe.capacity.variable}: ${recipe.usage.inputRules[recipe.capacity.variable]}`);
        }
      }
    }
    itemCount = count;
  }
  // These numeric families have different measurement domains, not just different skins.
  if (["metric-signal", "gauge-scorecard", "benchmark-scorecard", "conversion-funnel", "cohort-retention", "sparkline-grid"].includes(instance.componentId)) {
    const rows = String(values.items).split("|").map(item => item.split("::")[1]!.split(",").map(Number));
    const series = instance.componentId === "cohort-retention" || instance.componentId === "sparkline-grid";
    const percent = ["gauge-scorecard", "benchmark-scorecard", "cohort-retention"].includes(instance.componentId);
    const malformed = rows.some(row => row.length !== (series ? 3 : 1) || row.some(value => !Number.isFinite(value) || value < 0 || (percent && value > 100)));
    const invalidRetention = instance.componentId === "cohort-retention" && rows.some(row => row.some((value, index) => index > 0 && value > row[index - 1]!));
    const invalidFunnel = instance.componentId === "conversion-funnel" && (rows[0]![0] === 0 || rows.some((row, index) => index > 0 && row[0]! > rows[index - 1]![0]!));
    if (malformed || invalidRetention || invalidFunnel || (series && String(values.items).split("|").some(item => !/^\d+(?:\.\d+)?,\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(item.split("::")[1]!)))) {
      throw new ApiError(400, "invalid_video_recipe_data", recipe.usage.inputRules.items);
    }
  }
  for (const key of ["highlight", "focus", "active", "activeStep", "focusLine"]) {
    const value = values[key];
    if (typeof value === "number" && (!Number.isInteger(value) || (itemCount !== undefined && value > itemCount))) {
      throw new ApiError(400, "invalid_video_recipe_focus", "Focus must identify an existing item; do not clamp missing content.");
    }
  }
  if (instance.componentId === "comparison-matrix" && String(values.options).split("|").filter(value => value.trim()).length !== 2) {
    throw new ApiError(400, "invalid_video_recipe_options", "A comparison matrix requires exactly two named alternatives.");
  }
  const activeEvents = recipe.events.filter(event => itemCount === undefined || !event.id.startsWith("step-") || Number(event.id.slice(5)) <= itemCount);
  if (instance.narration) {
    if (instance.timingSource !== "voiceover" || instance.cueTimes) throw new ApiError(400, "invalid_video_recipe_alignment", "Measured narration bindings cannot be mixed with manual cueTimes.");
    instance = { ...instance, cueTimes: await resolveNarrationCues(workspace, projectRelative, instance.narration, activeEvents.map(event => event.id), instance.duration) };
  }
  for (const key of Object.keys(instance.cueTimes ?? {})) {
    if (!activeEvents.some(event => event.id === key)) throw new ApiError(400, "invalid_video_recipe_cues", `Unknown or unused semantic event: ${key}`);
  }
  const events = activeEvents.map((event, index) => {
    const previous = activeEvents[index - 1];
    const defaultTime = event.id === "resolve" && previous && !instance.cueTimes
      ? Math.min(event.time, previous.time + previous.duration + MAX_STILL_SECONDS)
      : event.time;
    return { ...event, duration: event.duration * motionStyles[motionStyle].durationFactor, time: instance.cueTimes?.[event.id] ?? defaultTime };
  });
  const last = events.at(-1);
  if (!last || last.time + last.duration > instance.duration - recipe.minHoldSeconds
    || instance.duration - last.time - last.duration > MAX_STILL_SECONDS
    || events.some((event, index) => index > 0 && (event.time < events[index - 1]!.time + events[index - 1]!.duration
      || event.time - events[index - 1]!.time - events[index - 1]!.duration > MAX_STILL_SECONDS))) {
    throw new ApiError(400, "invalid_video_recipe_cues", `The measured cues for ${instance.componentId} do not fit this scene: ${events.map(event => `${event.id}@${event.time.toFixed(2)}s`).join(", ")}. Keep events ordered without overlap, leave ${recipe.minHoldSeconds}s for the final result, and avoid gaps over ${MAX_STILL_SECONDS}s. Split at a spoken boundary or choose another recipe; a cue failure is not a reason to draw a custom scene.`);
  }
  if (instance.transition !== "cut" || instance.transitionDuration !== 0) {
    throw new ApiError(400, "invalid_video_recipe_transition", "Instantiate with a zero-duration cut; apply an incoming preset through mutate_motion afterward instead of declaring an unimplemented transition");
  }
  const cueTimes = Object.fromEntries(events.map(event => [event.id, event.time]));
  values.motionCueTimes = JSON.stringify(cueTimes);
  values.motionStyle = JSON.stringify(motionStyles[motionStyle]);
  const establish = events[0]!.time > 0 ? [{
    start: 0, end: events[0]!.time, intent: "Establish the scene", focus: "Context",
    action: "Orient before semantic development", result: "Readable context",
    targets: ["[data-composition-id]"], animation: `component:${instance.componentId}`,
    motion: { start: 0, end: Math.min(.65, events[0]!.time) },
  }] : [];
  const beats = [...establish, ...events.map((event, index) => ({
    start: event.time, end: events[index + 1]?.time ?? instance.duration,
    intent: event.action, focus: event.target, action: event.action, result: index === events.length - 1 ? "Resolved readable result" : "Evidence remains visible",
    targets: [event.target], animation: `component:${instance.componentId}`,
    motion: { start: event.time, end: event.time + event.duration },
  }))];
  return { instance, values, beats, recipe, cueTimes };
}

type MotionContract = {
  version: 2;
  source: "authored-timeline" | "manifest-variables" | "component-root";
  durationSeconds: number;
  targets: string[];
  timing: "measure-from-render";
};

type Repair = {
  sceneId: string;
  code: string;
  interval?: { start: number; end: number; duration: number };
  action: "apply-motion-preset" | "split-scene" | "shorten-scene" | "repair-metadata";
  message: string;
  suggestedSplitSeconds?: number[];
};

function registryRoot(): string {
  const available = resolveHyperframesRegistryRoot("blocks");
  if (!available) {
    throw new ApiError(503, "video_component_registry_unavailable", "The bundled HyperFrames component registry is unavailable. Restart the complete iPolloWork client before retrying.");
  }
  return available;
}

function safeRegistryPath(root: string, relativePath: string, field: "path" | "target"): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !normalized
    || normalized.startsWith("/")
    || posix.normalize(normalized) !== normalized
    || normalized.split("/").some(segment => !segment || segment === "." || segment === "..")
  ) {
    throw new ApiError(500, "invalid_video_component_manifest", `Registry component ${field} is unsafe: ${relativePath}`);
  }
  const absolute = resolve(root, normalized);
  if (!absolute.startsWith(`${resolve(root)}${sep}`)) {
    throw new ApiError(500, "invalid_video_component_manifest", `Registry component ${field} escapes its root: ${relativePath}`);
  }
  return absolute;
}

async function readRegistryComponent(root: string, componentId: string) {
  const directory = safeRegistryPath(root, componentId, "path");
  const manifestPath = resolve(directory, "registry-item.json");
  const manifest = registryManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (manifest.name !== componentId) {
    throw new ApiError(500, "invalid_video_component_manifest", `Registry directory ${componentId} contains manifest ${manifest.name}`);
  }
  return { directory, manifest };
}

function authoredMotionTargets(html: string): string[] {
  const targets: string[] = [];
  const add = (value: string) => {
    const target = value.trim();
    if (target && !targets.includes(target)) targets.push(target);
  };
  for (const match of html.matchAll(/\.(?:fromTo|from|to|set)\(\s*root\.querySelector(?:All)?\(\s*(["'])(.*?)\1/gsu)) {
    if (match[2]) add(match[2]);
  }
  for (const match of html.matchAll(/\.(?:fromTo|from|to|set)\(\s*(["'])(.*?)\1/gsu)) {
    if (match[2]) add(match[2]);
  }
  return targets.slice(0, 12);
}

function componentMotionContract(componentId: string, durationSeconds: number, variableIds: string[], authoredTargets: string[]): MotionContract {
  const variableTargets = authoredTargets.length > 0
    ? authoredTargets
    : variableIds.length > 0
    ? variableIds.map(id => `[data-ipw-variable="${id}"]`)
    : [`#${componentId}`];
  return {
    version: 2,
    source: authoredTargets.length > 0 ? "authored-timeline" : variableIds.length > 0 ? "manifest-variables" : "component-root",
    durationSeconds,
    targets: variableTargets,
    timing: "measure-from-render",
  };
}

function componentSnippet(componentId: string, target: string, motionContract: MotionContract): string {
  const duration = motionContract.durationSeconds;
  const animationReference = componentId === "spatial-camera-suite" ? ` data-ipw-animation-reference="${componentId}"` : "";
  return `<section id="<scene-id>" class="scene clip" data-ipw-scene data-composition-id="${componentId}-<scene-id>" data-composition-src="${target}" data-ipw-registry-component="${componentId}"${animationReference} data-ipw-timing-owner="host" data-motion-pattern="<selected-pattern>" data-ipw-timing-source="<voiceover|estimated-reading|visual-cue|music|media>" data-ipw-beats='[{"start":0,"end":${duration},"intent":"<spoken-or-silent-intent>","focus":"<visual-focus>","action":"<visual-action>","result":"<land-state>","targets":["#<scene-id>"],"animation":"component:${componentId}","motion":{"start":0,"end":${duration}}}]' data-ipw-motion-contract='${JSON.stringify(motionContract)}' data-variable-values='{}' data-start="<seconds>" data-duration="${duration}" data-track-index="<track>"></section>`;
}

export function attribute(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s"'=<>\u0060]+))`, "isu").exec(tag);
  return (match?.[2] ?? match?.[3] ?? "").replace(
    /&(?:quot|apos|amp|lt|gt|#(\d+)|#x([\da-f]+));/giu,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      const codePoint = decimal
        ? Number.parseInt(decimal, 10)
        : hexadecimal ? Number.parseInt(hexadecimal, 16) : null;
      if (codePoint !== null) return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
      switch (entity.toLowerCase()) {
        case "&quot;": return '"';
        case "&apos;": return "'";
        case "&amp;": return "&";
        case "&lt;": return "<";
        case "&gt;": return ">";
        default: return entity;
      }
    },
  ).trim();
}

function normalizeInstalledComposition(html: string, includeMotionStyle = true): string {
  if (includeMotionStyle && html.includes('data-ipw-motion-recipe="1"')) {
    const declarationsTag = openingTags(html).find(tag => attribute(tag, "data-composition-variables"));
    if (declarationsTag) {
      const declarations = z.array(hyperframesEffectVariableSchema).parse(JSON.parse(attribute(declarationsTag, "data-composition-variables")));
      declarations.push(hyperframesEffectVariableSchema.parse({ id: "motionStyle", label: "Whole-video motion style", type: "string", default: JSON.stringify(motionStyles.balanced), update: "reload" }));
      html = html.replace(declarationsTag, tag => tag.replace(/data-composition-variables=(["']).*?\1/s, `data-composition-variables="${htmlAttribute(JSON.stringify(declarations))}"`));
    }
    html = html.replace(/(<script data-ipw-motion-recipe="1">)([\s\S]*?)(<\/script>)/g, (_match, open: string, script: string, close: string) => {
      // Source-preserving adapters already own their profile; rewriting numeric
      // prefixes would corrupt authored coordinates such as x:1240.
      if (script.includes("const motionStyle=")) return open + script + close;
      return open + script
      .replace(/const (cues|times)=JSON.parse/, `const motionStyle=JSON.parse(String(values.motionStyle??'${JSON.stringify(motionStyles.balanced)}'));\n  recipe.events.forEach(event=>event.duration*=motionStyle.durationFactor);\n  const $1=JSON.parse`)
      .replaceAll('y:16', 'y:motionStyle.distance').replaceAll('y:18', 'y:motionStyle.distance').replaceAll('y:24', 'y:motionStyle.distance*1.5').replaceAll('x:12', 'x:motionStyle.distance*.75')
      .replace(/ease:"power[123]\.out"/g, 'ease:motionStyle.ease').replaceAll('ease:"power2.inOut"', 'ease:motionStyle.resolveEase')
      .replaceAll('scale:1.012', 'scale:motionStyle.emphasisScale') + close;
    });
  }
  const rootTag = openingTags(html).find(tag => attribute(tag, "data-composition-id"));
  if (!rootTag) return html;
  return html.replace(rootTag, tag => {
    const duration = attribute(tag, "data-duration");
    let normalized = tag.replace(/\sdata-(?:start|end|duration|track-index)\s*=\s*(["']).*?\1/giu, "");
    if (!attribute(normalized, "data-ipw-timing-owner")) {
      const metadata = ` data-ipw-timing-owner="host"${duration ? ` data-ipw-native-duration="${duration}"` : ""}`;
      normalized = normalized.replace(/\s*\/?>$/u, ending => `${metadata}${ending}`);
    }
    return normalized;
  });
}

export function openingTags(html: string): string[] {
  // A quoted JSON/default/code value may legitimately contain > or =>.
  return html.match(/<[a-z](?:[^"'<>]|"[^"]*"|'[^']*')*>/giu) ?? [];
}

export async function installVideoComponents(workspace: Workspace, raw: unknown) {
  const input = videoComponentInstallInput.parse(raw);
  const source = resolveWorkspaceFile(workspace.path, input.sourcePath);
  const sourceFile = await stat(source.absolutePath).catch(() => null);
  if (!sourceFile?.isFile()) throw new ApiError(404, "video_source_not_found", "The active video index.html does not exist");
  const projectRelative = posix.dirname(source.relativePath);
  const originalHtml = await readFile(source.absolutePath, "utf8");
  const compositionRoot = openingTags(originalHtml).find(tag => attribute(tag, "data-composition-id"));
  if (!compositionRoot) throw new ApiError(400, "video_root_missing", "Create the root composition before selecting recipes.");
  if (input.mount && !input.instances) throw new ApiError(400, "video_instances_required", "Automatic mounting needs fully resolved instances.");
  // Only explicit empty slots may be filled; never replace an authored scene.
  for (const instance of input.mount ? input.instances ?? [] : []) {
    const slots = openingTags(originalHtml).filter(tag => attribute(tag, "id") === instance.sceneId);
    const slot = slots[0];
    if (slots.length !== 1 || !slot || !/^<section\b/iu.test(slot) || attribute(slot, "data-composition-src")
      || sceneMarkup(originalHtml, slot).slice(slot.length).trim() !== "</section>") {
      throw new ApiError(409, "video_mount_slot_conflict", `Prepare one empty section with id=${instance.sceneId}; authored content is preserved.`);
    }
  }
  const root = registryRoot();
  const manifests = new Map<string, Awaited<ReturnType<typeof readRegistryComponent>>>();
  const readComponent = async (componentId: string) => {
    const cached = manifests.get(componentId);
    if (cached) return cached;
    const component = await readRegistryComponent(root, componentId);
    manifests.set(componentId, component);
    return component;
  };
  const installed = new Map<string, InstalledComponent>();
  // Resolve every requested ID before writing any component.
  for (const componentId of input.componentIds) {
    if (existsSync(resolve(root, componentId, "registry-item.json"))) continue;
    throw new ApiError(404, "video_component_not_found", `Video component ${componentId} is not available in the bundled registry`);
  }
  const instanceIds = new Set<string>();
  const resolvedInstances = [];
  for (const instance of input.instances ?? []) {
    if (instance.timingSource === "voiceover" && !instance.narration) throw new ApiError(400, "video_recipe_alignment_required", "Narrated recipe instances need exact phrase bindings and a validated timing sidecar; manual cueTimes are not precise speech alignment.");
    if (!input.componentIds.includes(instance.componentId) || instanceIds.has(instance.sceneId)) {
      throw new ApiError(400, "invalid_video_recipe_instance", "Every instance needs a unique sceneId and a selected componentId");
    }
    instanceIds.add(instance.sceneId);
    const { manifest } = await readComponent(instance.componentId);
    resolvedInstances.push(await resolveRecipeInstance(workspace, projectRelative, instance, manifest, input.motionStyle));
  }

  const install = async (componentId: string, requested: boolean): Promise<void> => {
    if (installed.has(componentId)) return;
    const { directory, manifest } = await readComponent(componentId).catch((error: unknown) => {
      if (error instanceof ApiError) throw error;
      throw new ApiError(404, "video_component_not_found", `Video component ${componentId} is not available in the bundled registry`);
    });
    if (requested && !manifest.visualComponent?.surfaces.includes("video")) {
      throw new ApiError(400, "video_component_surface_mismatch", `${componentId} is not approved for the video surface`);
    }
    for (const dependency of manifest.registryDependencies ?? []) await install(dependency, false);

    const written: string[] = [];
    let primaryTarget = "";
    let nativeComposition = "";
    for (const file of manifest.files) {
      const sourceAbsolute = safeRegistryPath(directory, file.path, "path");
      const target = file.target.replaceAll("\\", "/");
      if (!target.startsWith("compositions/")) {
        throw new ApiError(500, "invalid_video_component_manifest", `Registry component target must stay under compositions/: ${target}`);
      }
      safeRegistryPath("/registry-target", target, "target");
      const destination = resolveWorkspaceFile(workspace.path, `${projectRelative}/${target}`);
      await mkdir(dirname(destination.absolutePath), { recursive: true });
      const existing = await stat(destination.absolutePath).catch(() => null);
      if (!existing) {
        await copyFile(sourceAbsolute, destination.absolutePath);
        if (file.type === "hyperframes:composition") {
          const copied = await readFile(destination.absolutePath, "utf8");
          await writeFile(destination.absolutePath, normalizeInstalledComposition(copied));
        }
      } else if (manifest.motionRecipe && file.type === "hyperframes:composition") {
        // Upgrade only byte-identical old bundled copies; never overwrite user edits.
        const bundled = await readFile(sourceAbsolute, "utf8");
        if (await readFile(destination.absolutePath, "utf8") === normalizeInstalledComposition(bundled, false)) {
          await writeFile(destination.absolutePath, normalizeInstalledComposition(bundled));
        }
      }
      if (file.type === "hyperframes:composition") {
        const installedSource = await readFile(destination.absolutePath, "utf8");
        if (!nativeComposition) nativeComposition = installedSource;
      }
      written.push(destination.relativePath);
      if (!primaryTarget && file.type === "hyperframes:composition") primaryTarget = target;
      if (!primaryTarget) primaryTarget = target;
    }
    const motionContract = componentMotionContract(
      componentId,
      manifest.duration ?? 8,
      (manifest.variables ?? []).map(variable => variable.id),
      authoredMotionTargets(nativeComposition),
    );
    installed.set(componentId, {
      componentId,
      ...(manifest.duration === undefined ? {} : { durationSeconds: manifest.duration }),
      written,
      snippet: componentSnippet(componentId, primaryTarget, motionContract),
      motionContract,
      ...(manifest.motionRecipe ? { motionRecipe: manifest.motionRecipe } : {}),
      ...(manifest.variables ? { variables: manifest.variables } : {}),
    });
  };

  for (const componentId of [...new Set(input.componentIds)]) await install(componentId, true);
  const instances = [];
  for (const resolved of resolvedInstances) {
    const { instance, values, beats, recipe } = resolved;
    const component = installed.get(instance.componentId)!;
    const target = attribute(component.snippet, "data-composition-src");
    const copied = resolveWorkspaceFile(workspace.path, `${projectRelative}/${target}`);
    const copiedHtml = await readFile(copied.absolutePath, "utf8");
    if (!copiedHtml.includes('data-ipw-motion-recipe="1"')) {
      throw new ApiError(409, "video_recipe_copy_outdated", "The existing project component is not recipe-enabled. Preserve its edits; explicitly migrate it or instantiate in a new project.");
    }
    if (!copiedHtml.includes("const motionStyle=")) throw new ApiError(409, "video_recipe_style_outdated", "Preserve the existing edited component; explicitly migrate its motion-style runtime or install into a new project.");
    const attrs = {
      id: instance.sceneId, class: "scene clip", "data-ipw-scene": "true",
      "data-composition-id": `${instance.componentId}-${instance.sceneId}`,
      "data-composition-src": target, "data-ipw-registry-component": instance.componentId,
      "data-ipw-timing-owner": "host", "data-motion-pattern": recipe.pattern,
      "data-ipw-timing-source": instance.timingSource,
      "data-start": String(instance.start), "data-duration": String(instance.duration),
      "data-track-index": String(instance.track),
      "data-variable-values": JSON.stringify(values), "data-ipw-beats": JSON.stringify(beats),
      "data-ipw-transition-in": instance.transition,
      "data-ipw-transition-duration": String(instance.transitionDuration),
      "data-ipw-transition-intent": instance.transitionIntent,
      "data-ipw-motion-style": input.motionStyle,
      ...(instance.narration ? { "data-ipw-narration-binding": JSON.stringify(instance.narration) } : {}),
    };
    instances.push({
      sceneId: instance.sceneId,
      snippet: `<section ${Object.entries(attrs).map(([key, value]) => `${key}="${htmlAttribute(value)}"`).join(" ")}></section>`,
      cueTimes: resolved.cueTimes,
    });
  }
  if (await readFile(source.absolutePath, "utf8") !== originalHtml) throw new ApiError(409, "video_source_changed", "The composition changed during installation; retry against its latest saved source.");
  let updatedHtml = originalHtml;
  if (input.mount) {
    for (const instance of instances) {
      const slot = openingTags(updatedHtml).find(tag => attribute(tag, "id") === instance.sceneId)!;
      updatedHtml = updatedHtml.replace(sceneMarkup(updatedHtml, slot), instance.snippet);
    }
  }
  const previousSelection = attribute(compositionRoot, "data-ipw-selected-components");
  const selected = z.array(componentIdSchema).max(48).parse(previousSelection ? JSON.parse(previousSelection) : []);
  const selection = [...new Set([...selected, ...input.componentIds])];
  const recipePolicy = attribute(compositionRoot, "data-ipw-recipe-policy");
  const updatedRoot = compositionRoot.replace(/\sdata-ipw-selected-components\s*=\s*(["']).*?\1/giu, "")
    .replace(/>$/u, `${recipePolicy ? "" : ' data-ipw-recipe-policy="recipe-first"'} data-ipw-selected-components="${htmlAttribute(JSON.stringify(selection))}">`);
  updatedHtml = updatedHtml.replace(compositionRoot, updatedRoot);
  const stagedPath = `${source.absolutePath}.${randomUUID()}.mount`;
  try {
    await writeFile(stagedPath, updatedHtml, { flag: "wx" });
    if (await readFile(source.absolutePath, "utf8") !== originalHtml) throw new ApiError(409, "video_source_changed", "The composition changed during installation; retry against its latest saved source.");
    await rename(stagedPath, source.absolutePath);
  } finally {
    await rm(stagedPath, { force: true });
  }
  return {
    sourcePath: source.relativePath,
    components: [...installed.values()],
    instances,
    mounted: input.mount,
    instruction: "Mount the returned host-timed snippets in index.html using real content, durations and data-variable-values. Preserve data-ipw-timing-owner=host, data-ipw-selected-components and data-ipw-recipe-policy; existing edited project copies are retained. motionContract reports declared duration and authored targets, not measured beat timing. Follow the Video Studio skill workflow for measured narration, scene beats, custom-scene evidence and transitions. Save the source and let the client run its single aggregate delivery validator after the turn.",
  };
}

export function numberAttribute(tag: string, name: string): number | null {
  const value = attribute(tag, name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classTokens(tag: string): Set<string> {
  return new Set(attribute(tag, "class").split(/\s+/u).filter(Boolean));
}

function validateBeatMap(tag: string, sceneId: string, duration: number | null) {
  const issues: Array<{ code: string; sceneId: string; message: string }> = [];
  const raw = attribute(tag, "data-ipw-beats");
  if (!raw) {
    return { beats: [], issues: [{ code: "missing_scene_beats", sceneId, message: `${sceneId} must record a continuous data-ipw-beats map.` }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { beats: [], issues: [{ code: "invalid_scene_beats", sceneId, message: `${sceneId} has invalid JSON in data-ipw-beats.` }] };
  }
  const result = videoBeatMapSchema.safeParse(parsed);
  if (!result.success) {
    return { beats: [], issues: [{ code: "invalid_scene_beats", sceneId, message: `${sceneId} has an invalid data-ipw-beats structure.` }] };
  }
  const tolerance = 0.05;
  if (result.data[0]?.start !== 0) {
    issues.push({ code: "scene_beats_do_not_start_at_zero", sceneId, message: `${sceneId} beat timing must begin at 0 seconds relative to the scene.` });
  }
  for (let index = 1; index < result.data.length; index += 1) {
    const previous = result.data[index - 1];
    const current = result.data[index];
    if (previous && current && Math.abs(previous.end - current.start) > tolerance) {
      issues.push({ code: "scene_beat_gap_or_overlap", sceneId, message: `${sceneId} beats ${index} and ${index + 1} must meet without an unexplained gap or overlap.` });
    }
  }
  const finalBeat = result.data.at(-1);
  if (duration !== null && finalBeat && Math.abs(finalBeat.end - duration) > tolerance) {
    issues.push({ code: "scene_beats_do_not_cover_duration", sceneId, message: `${sceneId} beat map must cover its complete ${duration}-second scene duration.` });
  }
  return { beats: result.data, issues };
}

function hasAnimationReference(sceneTag: string, animation: string): boolean {
  if (!animation.startsWith("preset:") && !animation.startsWith("custom:")) return true;
  const referenceId = animation.slice(animation.indexOf(":") + 1);
  return sceneTag.includes(`data-ipw-animation-reference="${referenceId}"`) || sceneTag.includes(`data-ipw-animation-reference='${referenceId}'`);
}

function sceneMarkup(html: string, openingTag: string): string {
  const start = html.indexOf(openingTag);
  if (start < 0) return openingTag;
  const end = html.indexOf("</section>", start + openingTag.length);
  return end < 0 ? openingTag : html.slice(start, end + "</section>".length);
}

function patternEvidenceIssues(
  tag: string,
  sceneId: string,
  pattern: string,
  timingSource: string,
  beats: z.infer<typeof videoBeatMapSchema>,
  duration: number | null,
) {
  const issues: Array<{ code: string; sceneId: string; message: string }> = [];
  const active = beats.filter(beat => !beat.animation.startsWith("hold:"));
  const distinctFocus = new Set(active.map(beat => beat.focus.trim().toLocaleLowerCase()));
  const declaredCameraJourney = [
    "data-ipw-camera-origin",
    "data-ipw-camera-waypoint",
    "data-ipw-camera-destination",
  ].every(name => attribute(tag, name).length > 0);
  const fail = (code: string, message: string) => issues.push({ code, sceneId, message });
  if (pattern === "montage" && active.length < 3) {
    fail("montage_missing_shot_states", `${sceneId} uses montage but records fewer than three intentional shot or focus changes.`);
  }
  if (pattern === "camera-journey" && !declaredCameraJourney && (active.length < 3 || distinctFocus.size < 3)) {
    fail("camera_journey_missing_waypoints", `${sceneId} uses camera-journey but does not record an origin, meaningful waypoint, and destination.`);
  }
  if (pattern === "dialogue" && distinctFocus.size < 2) {
    fail("dialogue_missing_turns", `${sceneId} uses dialogue but does not alternate at least two identifiable speakers or viewpoints.`);
  }
  if (pattern === "kinetic-type" && (active.length < 2 || distinctFocus.size < 2)) {
    fail("kinetic_type_missing_phrase_changes", `${sceneId} uses kinetic-type but does not record at least two semantic phrase or emphasis states.`);
  }
  if (pattern === "audio-reactive") {
    if (!["voiceover", "music", "media"].includes(timingSource)) {
      fail("audio_reactive_invalid_timing_source", `${sceneId} uses audio-reactive but its timing source is not measured audio.`);
    }
    let cues: z.infer<typeof videoAudioCueSchema> = [];
    try {
      cues = videoAudioCueSchema.parse(JSON.parse(attribute(tag, "data-ipw-audio-cues")));
    } catch {
      fail("audio_reactive_missing_cues", `${sceneId} must record saved measured cues in data-ipw-audio-cues.`);
    }
    if (duration !== null && cues.some(cue => cue.time > duration)) {
      fail("audio_reactive_cue_out_of_bounds", `${sceneId} has an audio cue outside its declared duration.`);
    }
    if (cues.some(cue => !active.some(beat => cue.time >= beat.motion.start - 0.05 && cue.time <= beat.motion.end + 0.05))) {
      fail("audio_reactive_cue_unbound", `${sceneId} has a measured audio cue that is not bound to an active visual motion window.`);
    }
  }
  return issues;
}

function unplannedStillIntervals(
  beats: z.infer<typeof videoBeatMapSchema>,
  duration: number,
): Array<{ start: number; end: number; duration: number }> {
  const active = beats
    .filter(beat => !beat.animation.startsWith("hold:"))
    .map(beat => beat.motion)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const window of active) {
    const previous = merged.at(-1);
    if (previous && window.start <= previous.end + 0.05) previous.end = Math.max(previous.end, window.end);
    else merged.push({ ...window });
  }
  const gaps: Array<{ start: number; end: number; duration: number }> = [];
  let cursor = 0;
  for (const window of merged) {
    if (window.start - cursor > MAX_STILL_SECONDS) gaps.push({ start: cursor, end: window.start, duration: window.start - cursor });
    cursor = Math.max(cursor, window.end);
  }
  if (duration - cursor > MAX_STILL_SECONDS) gaps.push({ start: cursor, end: duration, duration: duration - cursor });
  return gaps;
}

function repairForStillInterval(sceneId: string, interval: { start: number; end: number; duration: number }): Repair {
  const shouldSplit = interval.duration > MAX_STILL_SECONDS * 2;
  return {
    sceneId,
    code: "scene_still_interval_too_long",
    interval,
    action: shouldSplit ? "split-scene" : "apply-motion-preset",
    message: shouldSplit
      ? `Split ${sceneId} at the nearest real narration or content beat around ${interval.start}-${interval.end}s; do not use the mathematical midpoint unless it is also a semantic boundary.`
      : `Call list_motion_presets for the focus at ${interval.start}-${interval.end}s, then call mutate_motion with an explicit start and end inside that interval.`,
  };
}

export async function checkVideoComponents(workspace: Workspace, raw: unknown) {
  const input = videoComponentCheckInput.parse(raw);
  const source = resolveWorkspaceFile(workspace.path, input.sourcePath);
  const html = await readFile(source.absolutePath, "utf8");
  const projectRelative = posix.dirname(source.relativePath);
  const tags = openingTags(html);
  const sceneTags = tags.filter(tag => /\bdata-ipw-scene(?:\s|=|>)/iu.test(tag));
  const issues: Array<{ code: string; sceneId?: string; message: string }> = [];
  const compositionRoot = tags.find(tag => attribute(tag, "data-composition-id")) ?? "";
  const selection = attribute(compositionRoot, "data-ipw-selected-components");
  const recipePolicy = attribute(compositionRoot, "data-ipw-recipe-policy");
  const recipesOnly = input.recipesOnly === true || recipePolicy === "recipes-only";
  const recipeFirst = recipePolicy === "recipe-first" || (!recipePolicy && Boolean(selection));
  if (selection) {
    try {
      for (const componentId of z.array(componentIdSchema).max(48).parse(JSON.parse(selection))) {
        if (!sceneTags.some(tag => attribute(tag, "data-ipw-registry-component") === componentId && attribute(tag, "data-composition-src"))) {
          issues.push({ code: "selected_recipe_not_mounted", message: `Selected recipe ${componentId} is not mounted. Mount its real instance; do not replace it with custom graphics or delete the selection to pass.` });
        }
      }
    } catch {
      issues.push({ code: "invalid_recipe_selection", message: "The root recipe selection must be a bounded list of registry IDs." });
    }
  }
  const styles = new Set(sceneTags.map(tag => attribute(tag, "data-ipw-motion-style")).filter(Boolean));
  if (styles.size > 1) issues.push({ code: "mixed_video_motion_styles", message: "Choose one whole-video motion style; do not independently restyle every scene." });
  const repairPlan: Repair[] = [];
  const scenes = [];
  const compositionIds = new Set<string>();
  const timedScenes: Array<{ sceneId: string; start: number; end: number; transition: string; transitionDuration: number | null; transitionIntent: string }> = [];
  const sceneBeats = new Map<string, z.infer<typeof videoBeatMapSchema>>();
  let hasSpatialCameraRecipe = false;

  for (const tag of tags) {
    const classes = classTokens(tag);
    if (classes.has("scene") && classes.has("clip") && !/\bdata-ipw-scene(?:\s|=|>)/iu.test(tag)) {
      const sceneId = attribute(tag, "id") || "unnamed-scene";
      issues.push({ code: "untracked_video_scene", sceneId, message: `${sceneId} is a full .scene.clip but is missing data-ipw-scene, so it cannot be accepted or sampled.` });
    }
  }

  for (const tag of sceneTags) {
    const markup = sceneMarkup(html, tag);
    const sceneId = attribute(tag, "id") || "unnamed-scene";
    const componentId = attribute(tag, "data-ipw-registry-component");
    const compositionId = attribute(tag, "data-composition-id");
    const customDecision = attribute(tag, "data-ipw-component-decision");
    const motionPattern = attribute(tag, "data-motion-pattern");
    const compositionSource = attribute(tag, "data-composition-src");
    if (recipesOnly && (!componentId || !compositionSource || customDecision)) {
      issues.push({ code: "recipe_only_scene_required", sceneId, message: `${sceneId} must mount an authored recipe. The user disallowed custom graphics; split or select another recipe instead.` });
    }
    const variableValues = attribute(tag, "data-variable-values");
    const timingOwner = attribute(tag, "data-ipw-timing-owner");
    const timingSource = attribute(tag, "data-ipw-timing-source");
    const transition = attribute(tag, "data-ipw-transition-in");
    const transitionDuration = numberAttribute(tag, "data-ipw-transition-duration");
    const transitionIntent = attribute(tag, "data-ipw-transition-intent");
    const start = numberAttribute(tag, "data-start");
    const duration = numberAttribute(tag, "data-duration");
    const track = numberAttribute(tag, "data-track-index");
    let componentInstalled = false;

    if (sceneId === "unnamed-scene") issues.push({ code: "missing_scene_id", sceneId, message: "Every video scene must have a stable id." });
    if (start === null || start < 0) issues.push({ code: "invalid_scene_start", sceneId, message: `${sceneId} must have a non-negative numeric data-start.` });
    if (duration === null || duration <= 0) issues.push({ code: "invalid_scene_duration", sceneId, message: `${sceneId} must have a positive numeric data-duration.` });
    if (track === null || !Number.isInteger(track) || track < 0) issues.push({ code: "invalid_scene_track", sceneId, message: `${sceneId} must have a non-negative integer data-track-index.` });
    if (!videoTimingSourceSchema.safeParse(timingSource).success) {
      issues.push({ code: "invalid_scene_timing_source", sceneId, message: `${sceneId} must record whether timing comes from voiceover, estimated reading, a visual cue, music, or media.` });
    }
    const beatMap = validateBeatMap(tag, sceneId, duration);
    sceneBeats.set(sceneId, beatMap.beats);
    issues.push(...beatMap.issues);
    const patternIssues = patternEvidenceIssues(tag, sceneId, motionPattern, timingSource, beatMap.beats, duration);
    issues.push(...patternIssues);
    for (const issue of patternIssues) {
      repairPlan.push({
        sceneId,
        code: issue.code,
        action: "repair-metadata",
        message: `Repair the ${motionPattern} beat map and its executable timeline together: ${issue.message}`,
      });
    }
    if (duration !== null && duration > 0) {
      for (const interval of unplannedStillIntervals(beatMap.beats, duration)) {
        issues.push({
          code: "scene_still_interval_too_long",
          sceneId,
          message: `${sceneId} has ${interval.duration.toFixed(2)}s without an active visual change (${interval.start.toFixed(2)}-${interval.end.toFixed(2)}s); the maximum accepted still interval is ${MAX_STILL_SECONDS}s.`,
        });
        repairPlan.push(repairForStillInterval(sceneId, interval));
      }
      for (const beat of beatMap.beats.filter(item => item.animation.startsWith("hold:") && item.end - item.start > MAX_STILL_SECONDS)) {
        const interval = { start: beat.start, end: beat.end, duration: beat.end - beat.start };
        issues.push({
          code: "scene_hold_too_long",
          sceneId,
          message: `${sceneId} declares a ${interval.duration.toFixed(2)}s intentional hold (${interval.start.toFixed(2)}-${interval.end.toFixed(2)}s). Keep it to ${MAX_STILL_SECONDS} seconds or less, or split it at a real semantic boundary.`,
        });
        repairPlan.push(repairForStillInterval(sceneId, interval));
      }
    }
    for (const beat of beatMap.beats) {
      if (beat.animation.startsWith("preset:") && !hasAnimationReference(markup, beat.animation)) {
        issues.push({ code: "missing_beat_animation_reference", sceneId, message: `${sceneId} beat ${beat.start}-${beat.end}s names ${beat.animation} but the saved composition has no matching data-ipw-animation-reference.` });
      }
      if (beat.animation.startsWith("component:") && beat.animation !== `component:${componentId}`) {
        issues.push({ code: "invalid_component_beat_reference", sceneId, message: `${sceneId} beat ${beat.start}-${beat.end}s must reference its installed component ${componentId || "or use another executable animation"}.` });
      }
    }
    if (start !== null && duration !== null && start >= 0 && duration > 0) timedScenes.push({ sceneId, start, end: start + duration, transition, transitionDuration, transitionIntent });

    if (!motionPattern) issues.push({ code: "missing_motion_pattern", sceneId, message: `${sceneId} must record its primary data-motion-pattern.` });
    if (componentId) {
      if (!componentIdSchema.safeParse(componentId).success) {
        issues.push({ code: "invalid_registry_component", sceneId, message: `${sceneId} has an invalid registry component id.` });
      }
      if (!compositionSource) {
        issues.push({ code: "missing_component_source", sceneId, message: `${sceneId} names ${componentId} but does not reference it with data-composition-src.` });
      } else {
        const installed = resolveWorkspaceFile(workspace.path, `${projectRelative}/${compositionSource}`);
        const installedFile = await stat(installed.absolutePath).catch(() => null);
        if (!installedFile?.isFile()) {
          issues.push({ code: "component_source_not_installed", sceneId, message: `${sceneId} references missing component source ${compositionSource}.` });
        } else {
          componentInstalled = true;
          const componentHtml = await readFile(installed.absolutePath, "utf8");
          const rootTag = openingTags(componentHtml).find(tag => attribute(tag, "data-composition-id")) ?? "";
          let nativeDuration = numberAttribute(rootTag, "data-ipw-native-duration");
          let semanticRecipeValidated = false;
          if (componentHtml.includes('data-ipw-motion-recipe="1"') && start !== null && duration !== null) {
            try {
              const { manifest } = await readRegistryComponent(registryRoot(), componentId);
              if (manifest.motionRecipe) {
                if (attribute(tag, "data-ipw-motion-style") && timingSource === "voiceover" && !attribute(tag, "data-ipw-narration-binding")) throw new Error("Narrated recipe is missing measured phrase bindings.");
                const values = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])).parse(JSON.parse(variableValues));
                const cueTimes = z.record(z.string(), z.number().nonnegative()).parse(JSON.parse(String(values.motionCueTimes ?? "{}")));
                const instance = hyperframesVideoInstanceSchema.parse({
                  sceneId, componentId, start, duration, timingSource,
                  values: Object.fromEntries(Object.entries(values).filter(([key]) => key !== "motionCueTimes" && key !== "motionStyle")),
                  ...(attribute(tag, "data-ipw-narration-binding") ? { narration: JSON.parse(attribute(tag, "data-ipw-narration-binding")) } : { cueTimes }),
                });
                const style = videoComponentInstallInput.shape.motionStyle.parse(attribute(tag, "data-ipw-motion-style") || undefined);
                const resolved = await resolveRecipeInstance(workspace, projectRelative, instance, manifest, style);
                if (JSON.stringify(resolved.cueTimes) !== JSON.stringify(cueTimes)) throw new Error("Mounted cue times no longer match measured narration bindings.");
                if (values.motionStyle !== undefined && values.motionStyle !== resolved.values.motionStyle) throw new Error("Mounted motion parameters differ from the declared whole-video style.");
                nativeDuration = resolved.beats.at(-1)!.motion.end;
                semanticRecipeValidated = true;
              }
            } catch (error) {
              issues.push({ code: "invalid_semantic_recipe_instance", sceneId, message: error instanceof Error ? error.message : "Invalid semantic recipe values or cues" });
            }
          }
          if ((recipesOnly || recipeFirst) && !semanticRecipeValidated) issues.push({ code: recipesOnly ? "recipe_only_scene_required" : "recipe_scene_not_validated", sceneId, message: `${sceneId} needs a validated authored recipe, not just a registry component label.` });
          if (!rootTag || attribute(rootTag, "data-ipw-timing-owner") !== "host") {
            issues.push({ code: "component_timing_not_host_owned", sceneId, message: `${sceneId} uses an older component copy whose internal root can end before the parent scene. Reinstall ${componentId}.` });
          }
          if (["data-start", "data-end", "data-duration", "data-track-index"].some(name => attribute(rootTag, name))) {
            issues.push({ code: "component_has_internal_clip_timing", sceneId, message: `${sceneId} component source must not carry an independent clip window.` });
          }
          if (!semanticRecipeValidated && nativeDuration !== null && duration !== null && duration - nativeDuration > 2) {
            const laterMotion = beatMap.beats.some(beat => beat.start >= nativeDuration - 0.05 && !beat.animation.startsWith("hold:") && !beat.animation.startsWith("component:"));
            if (!laterMotion) {
              issues.push({ code: "component_motion_ends_too_early", sceneId, message: `${sceneId} lasts ${duration}s but ${componentId} resolves at ${nativeDuration}s. Add a later preset/custom beat or shorten the scene; a long implicit hold is not accepted.` });
              repairPlan.push({
                sceneId,
                code: "component_motion_ends_too_early",
                interval: { start: nativeDuration, end: duration, duration: duration - nativeDuration },
                action: duration - nativeDuration > MAX_STILL_SECONDS * 2 ? "split-scene" : "apply-motion-preset",
                message: `Keep ${componentId} at its native ${nativeDuration}s duration. Split the narration after the component lands or animate a specific follow-up target through list_motion_presets and mutate_motion.`,
                ...(duration - nativeDuration > MAX_STILL_SECONDS * 2 ? { suggestedSplitSeconds: [nativeDuration] } : {}),
              });
            }
          }
        }
      }
      if (!compositionId) {
        issues.push({ code: "missing_component_composition_id", sceneId, message: `${sceneId} must give its component host a unique data-composition-id.` });
      } else if (compositionIds.has(compositionId)) {
        issues.push({ code: "duplicate_component_composition_id", sceneId, message: `${sceneId} reuses data-composition-id ${compositionId}; every mounted component needs a unique identity.` });
      } else {
        compositionIds.add(compositionId);
      }
      if (timingOwner !== "host") issues.push({ code: "missing_host_timing_owner", sceneId, message: `${sceneId} must keep component visibility owned by its parent scene with data-ipw-timing-owner="host".` });
      if (!variableValues) {
        issues.push({ code: "missing_component_values", sceneId, message: `${sceneId} must pass scene content through data-variable-values.` });
      } else {
        try {
          const values: unknown = JSON.parse(variableValues);
          const parsedValues = z.record(z.string(), z.unknown()).safeParse(values);
          if (!parsedValues.success) throw new Error("invalid values");
          if (componentId === "spatial-camera-suite") {
            const shotStyle = parsedValues.data.shotStyle;
            if (componentInstalled && typeof shotStyle === "string" && SPATIAL_CAMERA_RECIPES.has(shotStyle)) {
              hasSpatialCameraRecipe = true;
            } else if (typeof shotStyle !== "string" || !SPATIAL_CAMERA_RECIPES.has(shotStyle)) {
              issues.push({ code: "invalid_spatial_camera_recipe", sceneId, message: `${sceneId} must choose one real spatial-camera-suite shotStyle: ${Array.from(SPATIAL_CAMERA_RECIPES).join(", ")}.` });
            }
          }
        } catch {
          issues.push({ code: "invalid_component_values", sceneId, message: `${sceneId} must use literal valid JSON in data-variable-values.` });
        }
      }
    } else if (!customDecision.startsWith("custom:")) {
      issues.push({ code: "missing_component_decision", sceneId, message: `${sceneId} must use an installed registry component or record data-ipw-component-decision="custom:<specific reason>".` });
    } else {
      if (recipeFirst) {
        try {
          const evidence = customRecipeEvidenceSchema.parse(JSON.parse(attribute(tag, "data-ipw-custom-recipe-evidence")));
          if (/(?:phrase|cue|binding|install|对齐|绑定|安装|时间戳)/iu.test(customDecision)
            || evidence.candidates.some(candidate => /(?:phrase|cue|binding|install|对齐|绑定|安装|时间戳)/iu.test(candidate.limitation))) {
            throw new Error("A phrase-alignment or installation failure is not a structural recipe gap; repair the cue, split the scene, or choose another recipe.");
          }
          for (const candidate of evidence.candidates) {
            const manifest = await stat(resolve(registryRoot(), candidate.componentId, "registry-item.json")).catch(() => null);
            if (!manifest?.isFile()) throw new Error(`${candidate.componentId} is not an available executable recipe candidate.`);
          }
        } catch (error) {
          issues.push({ code: "custom_recipe_evidence_required", sceneId, message: `${sceneId} needs up to three real recipe candidates, each specific structural limitation, why splitting/combining cannot preserve the content, and the minimal custom scope. ${error instanceof Error ? error.message : "Invalid evidence."}` });
        }
      }
      if (timingSource === "voiceover") {
        try {
          const narration = hyperframesVideoInstanceSchema.shape.narration.unwrap().parse(JSON.parse(attribute(tag, "data-ipw-narration-binding")));
          const active = beatMap.beats.filter(beat => !beat.animation.startsWith("hold:"));
          const ids = active.map(beat => beat.animation);
          if (new Set(ids).size !== ids.length || duration === null) throw new Error("Custom events need unique animation references and a valid scene duration.");
          const cues = await resolveNarrationCues(workspace, projectRelative, narration, ids, duration);
          if (active.some(beat => Math.abs(beat.motion.start - cues[beat.animation]!) > 1 / 30 + 0.001)) throw new Error("Custom motion windows must start at their measured spoken phrase (within one frame).");
        } catch (error) {
          issues.push({ code: "invalid_custom_narration_binding", sceneId, message: error instanceof Error ? error.message : "Custom narrated scenes need validated phrase bindings." });
        }
      }
    }
    scenes.push({ sceneId, componentId: componentId || null, customDecision: customDecision || null, motionPattern: motionPattern || null, compositionSource: compositionSource || null, compositionId: compositionId || null, timingSource: timingSource || null, transition: transition || null, transitionDuration, transitionIntent: transitionIntent || null });
  }
  if (/data-ipw-registry-component\s*=\s*["']spatial-camera-suite["']/iu.test(html) && !hasSpatialCameraRecipe) {
    issues.push({
      code: "missing_spatial_camera_component",
      message: "This video declares spatial-camera-suite but has no valid installed camera recipe. Install the component and select one of its five shotStyle values before delivery.",
    });
  }
  timedScenes.sort((left, right) => left.start - right.start);
  for (let index = 1; index < timedScenes.length; index += 1) {
    const previous = timedScenes[index - 1];
    const current = timedScenes[index];
    if (!previous || !current) continue;
    if (Math.abs(current.start - previous.end) > 0.05) {
      issues.push({ code: current.start > previous.end ? "scene_timeline_gap" : "scene_timeline_overlap", sceneId: current.sceneId, message: `${previous.sceneId} and ${current.sceneId} must meet at one boundary; run the transition inside the incoming scene instead of exposing a gap or overlapping full scene windows.` });
    }
    const authoredTransition = customTransitionId.test(current.transition);
    if (!videoTransitionPresets.has(current.transition) && !authoredTransition) {
      issues.push({ code: "invalid_scene_transition", sceneId: current.sceneId, message: `${current.sceneId} must declare a supported data-ipw-transition-in.` });
    } else if (current.transition === "cut") {
      if (current.transitionDuration !== 0) issues.push({ code: "invalid_scene_transition_duration", sceneId: current.sceneId, message: `${current.sceneId} uses a cut, so data-ipw-transition-duration must be 0.` });
    } else {
      if (current.transitionDuration === null || current.transitionDuration < 0.2 || current.transitionDuration > 1.5) {
        issues.push({ code: "invalid_scene_transition_duration", sceneId: current.sceneId, message: `${current.sceneId} transition duration must be between 0.2 and 1.5 seconds.` });
      }
      const currentTag = sceneTags.find(tag => attribute(tag, "id") === current.sceneId) ?? "";
      if (!hasAnimationReference(currentTag, current.transition)) {
        issues.push({ code: "missing_transition_animation_reference", sceneId: current.sceneId, message: `${current.sceneId} declares ${current.transition} but has no matching data-ipw-animation-reference.` });
      }
      if (authoredTransition) {
        try {
          const handoff = customTransitionHandoffSchema.parse(JSON.parse(attribute(currentTag, "data-ipw-transition-handoff")));
          if (handoff.fromSceneId !== previous.sceneId) throw new Error("The handoff must name the actual outgoing scene.");
          const transitionBeat = sceneBeats.get(current.sceneId)?.find(beat => beat.animation === current.transition);
          if (!transitionBeat || transitionBeat.motion.start > 0.05
            || transitionBeat.motion.end > (current.transitionDuration ?? 0) + 0.05
            || !transitionBeat.targets.includes(handoff.target)) {
            throw new Error("A matching incoming beat must animate the declared target from the scene start within the transition window.");
          }
        } catch (error) {
          issues.push({ code: "invalid_custom_transition_handoff", sceneId: current.sceneId, message: `${current.sceneId} needs a truthful outgoing result, incoming subject, continuity, visual action, target, and a matching timed custom beat. ${error instanceof Error ? error.message : "Invalid handoff."}` });
        }
      }
    }
    if (!videoTransitionIntentSchema.safeParse(current.transitionIntent).success) {
      issues.push({ code: "invalid_scene_transition_intent", sceneId: current.sceneId, message: `${current.sceneId} must use one supported data-ipw-transition-intent: continue, topic-change, time-change, location-change, compare, reveal, or closure.` });
    }
  }
  if (sceneTags.length === 0) issues.push({ code: "missing_video_scenes", message: "No data-ipw-scene elements were found in the video composition." });
  return {
    valid: issues.length === 0,
    sourcePath: source.relativePath,
    sceneCount: sceneTags.length,
    reusedComponentCount: scenes.filter(scene => scene.componentId).length,
    customSceneCount: scenes.filter(scene => scene.customDecision).length,
    scenes,
    issues,
    repairPlan,
    pacing: { maxStillSeconds: MAX_STILL_SECONDS },
  };
}
