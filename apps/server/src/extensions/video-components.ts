import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { ApiError } from "../errors.js";
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
  targets: z.array(z.string().min(1)).min(1),
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
}).passthrough();

const MAX_STILL_SECONDS = 4;

export const videoComponentInstallInput = z.object({
  sourcePath: videoSourcePathSchema,
  componentIds: z.array(componentIdSchema).min(1).max(12),
}).strict();

export const videoComponentCheckInput = z.object({
  sourcePath: videoSourcePathSchema,
}).strict();

type Workspace = { id: string; path: string };
type InstalledComponent = {
  componentId: string;
  durationSeconds?: number;
  written: string[];
  snippet: string;
  motionContract: MotionContract;
};

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
  const configured = process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT?.trim();
  const cli = process.env.HYPERFRAMES_CLI_PATH?.trim();
  const current = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    configured,
    cli ? resolve(dirname(cli), "../../../registry/blocks") : undefined,
    resolve(current, "../../../../vendor/hyperframes/registry/blocks"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const available = candidates.find(candidate => existsSync(candidate));
  if (!available) {
    throw new ApiError(503, "video_component_registry_unavailable", "The bundled HyperFrames component registry is unavailable. Restart the complete iPolloWork client before retrying.");
  }
  return resolve(available);
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
  return `<section id="<scene-id>" class="scene clip" data-ipw-scene data-composition-id="${componentId}-<scene-id>" data-composition-src="${target}" data-ipw-registry-component="${componentId}" data-ipw-timing-owner="host" data-motion-pattern="<selected-pattern>" data-ipw-timing-source="<voiceover|estimated-reading|visual-cue|music|media>" data-ipw-beats='[{"start":0,"end":${duration},"intent":"<spoken-or-silent-intent>","focus":"<visual-focus>","action":"<visual-action>","result":"<land-state>","targets":["#<scene-id>"],"animation":"component:${componentId}","motion":{"start":0,"end":${duration}}}]' data-ipw-motion-contract='${JSON.stringify(motionContract)}' data-variable-values='{}' data-start="<seconds>" data-duration="${duration}" data-track-index="<track>"></section>`;
}

function attribute(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "isu").exec(tag);
  return match?.[2]?.trim() ?? "";
}

function normalizeInstalledComposition(html: string): string {
  const rootTag = /<[a-z][^>]*\bdata-composition-id\s*=\s*(["']).*?\1[^>]*>/iu;
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

export async function installVideoComponents(workspace: Workspace, raw: unknown) {
  const input = videoComponentInstallInput.parse(raw);
  const source = resolveWorkspaceFile(workspace.path, input.sourcePath);
  const sourceFile = await stat(source.absolutePath).catch(() => null);
  if (!sourceFile?.isFile()) throw new ApiError(404, "video_source_not_found", "The active video index.html does not exist");
  const projectRelative = posix.dirname(source.relativePath);
  const root = registryRoot();
  const installed = new Map<string, InstalledComponent>();

  const install = async (componentId: string, requested: boolean): Promise<void> => {
    if (installed.has(componentId)) return;
    const { directory, manifest } = await readRegistryComponent(root, componentId).catch((error: unknown) => {
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
    });
  };

  for (const componentId of [...new Set(input.componentIds)]) await install(componentId, true);
  return {
    sourcePath: source.relativePath,
    components: [...installed.values()],
    instruction: "Reference each installed composition from index.html with the returned host-timed snippet. Existing project copies are preserved instead of overwritten. Replace all placeholders, set the real scene duration, preserve data-ipw-timing-owner=host, and replace data-variable-values with the scene's real content. The motionContract identifies declared native duration and authored targets only; measure actual establish, develop, and land windows from the rendered component instead of inventing percentage timings. Every beat must include a truthful scene-relative motion window. If narration extends beyond native motion, call list_motion_presets for a suitable element preset and mutate_motion with explicit start and end times, or split the scene at a semantic beat. For every scene after the first, add the supported incoming transition, duration, and intent metadata. The client runs the aggregate delivery validator after the turn.",
  };
}

function numberAttribute(tag: string, name: string): number | null {
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
  if (!animation.startsWith("preset:")) return true;
  const presetId = animation.slice("preset:".length);
  return sceneTag.includes(`data-ipw-animation-reference="${presetId}"`) || sceneTag.includes(`data-ipw-animation-reference='${presetId}'`);
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
  const fail = (code: string, message: string) => issues.push({ code, sceneId, message });
  if (pattern === "montage" && active.length < 3) {
    fail("montage_missing_shot_states", `${sceneId} uses montage but records fewer than three intentional shot or focus changes.`);
  }
  if (pattern === "camera-journey" && (active.length < 3 || distinctFocus.size < 3)) {
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
  const openingTags = html.match(/<[^/!][^>]*>/gu) ?? [];
  const sceneTags = openingTags.filter(tag => /\bdata-ipw-scene(?:\s|=|>)/iu.test(tag));
  const issues: Array<{ code: string; sceneId?: string; message: string }> = [];
  const repairPlan: Repair[] = [];
  const scenes = [];
  const compositionIds = new Set<string>();
  const timedScenes: Array<{ sceneId: string; start: number; end: number; transition: string; transitionDuration: number | null; transitionIntent: string }> = [];

  for (const tag of openingTags) {
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
    const variableValues = attribute(tag, "data-variable-values");
    const timingOwner = attribute(tag, "data-ipw-timing-owner");
    const timingSource = attribute(tag, "data-ipw-timing-source");
    const transition = attribute(tag, "data-ipw-transition-in");
    const transitionDuration = numberAttribute(tag, "data-ipw-transition-duration");
    const transitionIntent = attribute(tag, "data-ipw-transition-intent");
    const start = numberAttribute(tag, "data-start");
    const duration = numberAttribute(tag, "data-duration");
    const track = numberAttribute(tag, "data-track-index");

    if (sceneId === "unnamed-scene") issues.push({ code: "missing_scene_id", sceneId, message: "Every video scene must have a stable id." });
    if (start === null || start < 0) issues.push({ code: "invalid_scene_start", sceneId, message: `${sceneId} must have a non-negative numeric data-start.` });
    if (duration === null || duration <= 0) issues.push({ code: "invalid_scene_duration", sceneId, message: `${sceneId} must have a positive numeric data-duration.` });
    if (track === null || !Number.isInteger(track) || track < 0) issues.push({ code: "invalid_scene_track", sceneId, message: `${sceneId} must have a non-negative integer data-track-index.` });
    if (!videoTimingSourceSchema.safeParse(timingSource).success) {
      issues.push({ code: "invalid_scene_timing_source", sceneId, message: `${sceneId} must record whether timing comes from voiceover, estimated reading, a visual cue, music, or media.` });
    }
    const beatMap = validateBeatMap(tag, sceneId, duration);
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
          message: `${sceneId} declares a ${interval.duration.toFixed(2)}s intentional hold (${interval.start.toFixed(2)}-${interval.end.toFixed(2)}s). Keep a readable hold at four seconds or less, or split it at a real semantic boundary.`,
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
          const componentHtml = await readFile(installed.absolutePath, "utf8");
          const rootTag = componentHtml.match(/<[a-z][^>]*\bdata-composition-id\s*=\s*(["']).*?\1[^>]*>/iu)?.[0] ?? "";
          const nativeDuration = numberAttribute(rootTag, "data-ipw-native-duration");
          if (!rootTag || attribute(rootTag, "data-ipw-timing-owner") !== "host") {
            issues.push({ code: "component_timing_not_host_owned", sceneId, message: `${sceneId} uses an older component copy whose internal root can end before the parent scene. Reinstall ${componentId}.` });
          }
          if (["data-start", "data-end", "data-duration", "data-track-index"].some(name => attribute(rootTag, name))) {
            issues.push({ code: "component_has_internal_clip_timing", sceneId, message: `${sceneId} component source must not carry an independent clip window.` });
          }
          if (nativeDuration !== null && duration !== null && duration - nativeDuration > 2) {
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
          if (!z.record(z.string(), z.unknown()).safeParse(values).success) throw new Error("invalid values");
        } catch {
          issues.push({ code: "invalid_component_values", sceneId, message: `${sceneId} must use literal valid JSON in data-variable-values.` });
        }
      }
    } else if (!customDecision.startsWith("custom:")) {
      issues.push({ code: "missing_component_decision", sceneId, message: `${sceneId} must use an installed registry component or record data-ipw-component-decision="custom:<specific reason>".` });
    }
    scenes.push({ sceneId, componentId: componentId || null, customDecision: customDecision || null, motionPattern: motionPattern || null, compositionSource: compositionSource || null, compositionId: compositionId || null, timingSource: timingSource || null, transition: transition || null, transitionDuration, transitionIntent: transitionIntent || null });
  }
  timedScenes.sort((left, right) => left.start - right.start);
  for (let index = 1; index < timedScenes.length; index += 1) {
    const previous = timedScenes[index - 1];
    const current = timedScenes[index];
    if (!previous || !current) continue;
    if (Math.abs(current.start - previous.end) > 0.05) {
      issues.push({ code: current.start > previous.end ? "scene_timeline_gap" : "scene_timeline_overlap", sceneId: current.sceneId, message: `${previous.sceneId} and ${current.sceneId} must meet at one boundary; run the transition inside the incoming scene instead of exposing a gap or overlapping full scene windows.` });
    }
    if (!videoTransitionPresets.has(current.transition)) {
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
    }
    if (!videoTransitionIntentSchema.safeParse(current.transitionIntent).success) {
      issues.push({ code: "invalid_scene_transition_intent", sceneId: current.sceneId, message: `${current.sceneId} must explain the transition with a supported data-ipw-transition-intent.` });
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
