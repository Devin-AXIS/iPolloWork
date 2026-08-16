import { ApiError } from "../errors.js";
import type { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";
import { link, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, posix } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resolveWorkspaceFile, withTemporaryWorkspaceObject, workspaceForContext } from "./storage.js";

// The Alibaba adapter stays internal to this module. The public action
// contract is provider-neutral so Media Center can add providers without
// changing app or OpenCode integration code.
export const MEDIA_EXTENSION_ID = "media";

const DEFAULT_ALIYUN_MEDIA_BASE_URL = "https://dashscope.aliyuncs.com";
const BAILIAN_REQUEST_TIMEOUT_MS = 90_000;
const MAX_TRANSLATION_AUDIO_CHARS = 16 * 1024 * 1024;
const MAX_SYNTHESIZED_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_VOICEOVER_BATCH_SCENES = 24;
const VOICEOVER_BATCH_CONCURRENCY = 3;
const MAX_VOICEOVER_AUDIO_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_VOICEOVER_AUDIO_CACHE_ENTRIES = 128;
const COSYVOICE_V3_FLASH = "cosyvoice-v3-flash";
const VOICEOVER_READING_BUFFER_SECONDS = 0.25;
const LEGACY_COSYVOICE_V3_PRESET_MIGRATIONS: Record<string, string> = {
  longxiaochun: "longyingmu_v3",
  longxiaoxia: "longyingmu_v3",
  longwan: "longyingmu_v3",
  longwanwan: "longanhuan_v3",
  longlaotie: "longanlang_v3",
  longfei: "longanlang_v3",
};
export const MINIMAX_IMAGE_TO_VIDEO_MODELS = {
  defaultModel: "MiniMax-H3",
  v2: ["MiniMax-H3"],
  v1: [
    "MiniMax-Hailuo-2.3",
    "MiniMax-Hailuo-2.3-Fast",
    "MiniMax-Hailuo-02",
    "I2V-01-Director",
    "I2V-01-live",
    "I2V-01",
  ],
};
export const MINIMAX_IMAGE_TO_VIDEO_ENDPOINTS = [
  { region: "global_en", apiVersion: "v2", url: "https://api.minimax.io/v2/video_generation" },
  { region: "cn_zh", apiVersion: "v2", url: "https://api.minimaxi.com/v2/video_generation" },
  { region: "global_en", apiVersion: "v1", url: "https://api.minimax.io/v1/video_generation" },
  { region: "cn_zh", apiVersion: "v1", url: "https://api.minimaxi.com/v1/video_generation" },
];

type JsonRecord = Record<string, unknown>;

const voiceoverAudioCache = new Map<string, Buffer>();
let voiceoverAudioCacheBytes = 0;

function voiceoverAudioCacheKey(input: {
  apiKey: string;
  baseUrl: string;
  text: string;
  model: string;
  voice: string;
  sampleRate?: number;
}) {
  return createHash("sha256")
    .update(input.apiKey)
    .update("\0")
    .update(input.baseUrl)
    .update("\0")
    .update(input.model)
    .update("\0")
    .update(input.voice)
    .update("\0")
    .update(String(input.sampleRate ?? ""))
    .update("\0")
    .update(input.text)
    .digest("hex");
}

function readCachedVoiceoverAudio(key: string) {
  const audio = voiceoverAudioCache.get(key);
  if (!audio) return null;
  voiceoverAudioCache.delete(key);
  voiceoverAudioCache.set(key, audio);
  return audio;
}

function cacheVoiceoverAudio(key: string, audio: Buffer) {
  if (audio.byteLength > MAX_VOICEOVER_AUDIO_CACHE_BYTES) return;
  const existing = voiceoverAudioCache.get(key);
  if (existing) voiceoverAudioCacheBytes -= existing.byteLength;
  voiceoverAudioCache.delete(key);
  voiceoverAudioCache.set(key, audio);
  voiceoverAudioCacheBytes += audio.byteLength;
  while (
    voiceoverAudioCache.size > MAX_VOICEOVER_AUDIO_CACHE_ENTRIES
    || voiceoverAudioCacheBytes > MAX_VOICEOVER_AUDIO_CACHE_BYTES
  ) {
    const oldest = voiceoverAudioCache.entries().next().value;
    if (!oldest) break;
    voiceoverAudioCache.delete(oldest[0]);
    voiceoverAudioCacheBytes -= oldest[1].byteLength;
  }
}

function mediaProviderFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const desktopFetch: unknown = Reflect.get(globalThis, Symbol.for("ipollowork.mediaProviderFetch"));
  return typeof desktopFetch === "function"
    ? (desktopFetch as typeof fetch)(input, init)
    : fetch(input, init);
}

function roundVoiceoverTime(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function htmlAudioIdForVoiceover(sceneId: string, sourcePath: string) {
  const sourceName = basename(sourcePath, extname(sourcePath)).replace(/[^A-Za-z0-9_-]+/g, "-");
  const sceneName = sceneId.replace(/[^A-Za-z0-9_-]+/g, "-");
  return `voiceover-${sceneName}-${sourceName}`.replace(/-+/g, "-");
}

function relativeHtmlMediaSource(compositionPath: string | undefined, mediaPath: string) {
  if (!compositionPath) return mediaPath;
  const fromDirectory = posix.dirname(compositionPath.replace(/\\/g, "/"));
  const relativePath = posix.relative(fromDirectory === "." ? "" : fromDirectory, mediaPath.replace(/\\/g, "/"));
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function scopeVoiceoverSceneToComposition(
  scene: WorkspaceVoiceoverSceneInput,
  compositionPath: string | undefined,
): WorkspaceVoiceoverSceneInput {
  if (!compositionPath) return scene;
  const compositionDirectory = posix.dirname(compositionPath.replace(/\\/g, "/"));
  const assetDirectory = compositionDirectory === "." ? "assets" : `${compositionDirectory}/assets`;
  const requestedPath = posix.normalize(scene.outputPath.replace(/\\/g, "/"));
  const outputPath = requestedPath.startsWith("assets/") && compositionDirectory !== "."
    ? posix.join(compositionDirectory, requestedPath)
    : requestedPath;
  const relativeToAssets = posix.relative(assetDirectory, outputPath);
  if (relativeToAssets === ".." || relativeToAssets.startsWith("../") || posix.isAbsolute(relativeToAssets)) {
    throw new ApiError(
      400,
      "voiceover_output_outside_composition",
      `outputPath must be inside the current composition assets directory (${assetDirectory}/).`,
    );
  }
  return outputPath === scene.outputPath ? scene : { ...scene, outputPath };
}

function voiceoverAudioElementHtml(input: {
  id: string;
  sourcePath: string;
  sceneId: string;
  sceneText: string;
  startSeconds: number;
  durationSeconds: number;
}) {
  return [
    `<audio id="${escapeHtmlAttribute(input.id)}"`,
    `src="${escapeHtmlAttribute(input.sourcePath)}"`,
    `data-ipw-voiceover="true"`,
    `data-ipw-scene-id="${escapeHtmlAttribute(input.sceneId)}"`,
    `data-ipw-scene-text="${escapeHtmlAttribute(input.sceneText)}"`,
    `data-ipw-narration-text="${escapeHtmlAttribute(input.sceneText)}"`,
    `data-start="${roundVoiceoverTime(input.startSeconds)}"`,
    `data-duration="${roundVoiceoverTime(input.durationSeconds)}"`,
    `data-track-index="10"`,
    `data-volume="1"></audio>`,
  ].join(" ");
}

export function planSceneVoiceoverTiming(
  sceneStart: number,
  sceneDuration: number,
  audioDuration: number,
) {
  const requiredSceneDuration = Math.max(
    sceneDuration,
    audioDuration + VOICEOVER_READING_BUFFER_SECONDS,
  );
  return {
    startSeconds: roundVoiceoverTime(sceneStart),
    endSeconds: roundVoiceoverTime(sceneStart + audioDuration),
    requiredSceneDurationSeconds: roundVoiceoverTime(requiredSceneDuration),
    shiftFollowingBySeconds: roundVoiceoverTime(requiredSceneDuration - sceneDuration),
    readingBufferSeconds: VOICEOVER_READING_BUFFER_SECONDS,
  };
}

type VoiceoverTimelineIssue = {
  code: string;
  message: string;
  sceneId?: string;
};

type VideoTimelineRequirements = {
  voiceover?: boolean;
  captions?: boolean;
  captionStyle?: "transparent-bottom" | "custom";
  bgm?: boolean;
  animationReferences?: string[];
  targetDurationSeconds?: number;
};

type TimelineNode = {
  tagName: string;
  attributes: Map<string, string>;
  classNames: Set<string>;
  contentStart: number;
};

function htmlAttributeMap(source: string) {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function timelineNodes(html: string): TimelineNode[] {
  return Array.from(html.matchAll(/<(?!\/|!)([a-zA-Z][\w:-]*)\b([^>]*)>/g), (match) => {
    const attributes = htmlAttributeMap(match[2] ?? "");
    return {
      tagName: match[1]!.toLowerCase(),
      attributes,
      classNames: new Set((attributes.get("class") ?? "").split(/\s+/).filter(Boolean)),
      contentStart: (match.index ?? 0) + match[0].length,
    };
  });
}

function decodeHtmlText(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : "";
    });
}

function normalizeSceneText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function visibleTextFromHtml(value: string) {
  return normalizeSceneText(decodeHtmlText(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*(?:hidden|aria-hidden\s*=\s*["']?true|display\s*:\s*none)[^>]*>[\s\S]*?<\/[a-zA-Z][\w:-]*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ));
}

function narrationSourceTextFromHtml(value: string) {
  const sources = Array.from(
    value.matchAll(/<([a-zA-Z][\w:-]*)\b(?=[^>]*\bdata-ipw-narration-source\s*=\s*["']true["'])[^>]*>([\s\S]*?)<\/\1>/gi),
    (match) => visibleTextFromHtml(match[2] ?? ""),
  ).filter(Boolean);
  return sources.length > 0 ? normalizeSceneText(sources.join(" ")) : visibleTextFromHtml(value);
}

function nodeInnerHtml(html: string, node: TimelineNode) {
  const closeTag = `</${node.tagName}>`;
  const end = html.toLowerCase().indexOf(closeTag, node.contentStart);
  return end >= 0 ? html.slice(node.contentStart, end) : "";
}

function scriptContents(html: string) {
  return Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), (match) => match[1] ?? "");
}

function containsManualVoiceoverPlayback(html: string) {
  const scripts = scriptContents(html).join("\n");
  if (!scripts.trim()) return false;
  const mentionsVoiceover = /\b(?:voiceover|narration|vo[-_]|data-ipw-voiceover)\b/i.test(scripts);
  const manualPlaybackCall = /(?:^|[^\w$])[\w$]*(?:audio|voiceover|narration|vo)[\w$]*\s*\.\s*(?:play|pause)\s*\(/i.test(scripts)
    || /getElementById\s*\(\s*["'](?:voiceover|vo[-_][^"']*|narration[-_][^"']*|voiceover[-_][^"']*)["']\s*\)[\s\S]{0,160}\.\s*(?:play|pause)\s*\(/i.test(scripts)
    || /querySelector(?:All)?\s*\(\s*["'][^"']*(?:data-ipw-voiceover|voiceover|narration|vo[-_])[^"']*["']\s*\)[\s\S]{0,240}\.\s*(?:play|pause)\s*\(/i.test(scripts);
  const manualSeek = mentionsVoiceover && /\.currentTime\s*=/i.test(scripts);
  return manualPlaybackCall || manualSeek;
}

function referencedVoiceoverSources(html: string) {
  const sources = new Set<string>();
  for (const match of html.matchAll(/["'`](?:\.\/)?([^"'`]*?(?:vo_\d+|voiceover_\d+|voiceover|voiceover-[^"'`/]+|narration-[^"'`/]+)\.mp3)(?:[?#][^"'`]*)?["'`]/gi)) {
    sources.add((match[1] ?? "").replace(/\\/g, "/").replace(/^\.\//, ""));
  }
  return sources;
}

function isVoiceoverSource(src: string) {
  return /(?:^|\/)vo_\d+\.mp3(?:[?#].*)?$/i.test(src)
    || /(?:^|\/)voiceover(?:_\d+)?\.mp3(?:[?#].*)?$/i.test(src)
    || /(?:^|\/)audio\/voice\//i.test(src)
    || /(?:^|\/)audio\/narration-[^/]+\.mp3(?:[?#].*)?$/i.test(src)
    || /(?:^|\/)narration-[^/]+\.mp3(?:[?#].*)?$/i.test(src)
    || /(?:^|\/)voiceover-[^/]+\.mp3(?:[?#].*)?$/i.test(src);
}

function isVoiceoverAssetPath(value: string) {
  return /(?:^|\/)(?:vo_\d+|voiceover(?:_\d+)?|voiceover-[^/]+|narration-[^/]+)\.mp3$/i.test(value.replace(/\\/g, "/"));
}

async function listWorkspaceAssets(
  root: string,
  relativeDirectory: string,
  accepts: (path: string) => boolean,
): Promise<string[]> {
  const assets: string[] = [];
  async function visit(relativePath: string) {
    const absolute = resolveWorkspaceFile(root, relativePath).absolutePath;
    try {
      const entries = await readdir(absolute, { withFileTypes: true });
      for (const entry of entries) {
        const child = `${relativePath.replace(/\/$/, "")}/${entry.name}`.replace(/^\/+/, "");
        if (entry.isDirectory()) {
          await visit(child);
        } else if (entry.isFile() && accepts(child)) {
          assets.push(child);
        }
      }
    } catch {
      return;
    }
  }
  await visit(relativeDirectory);
  return assets.sort();
}

function finiteTimelineNumber(node: TimelineNode, name: string): number | null {
  const raw = node.attributes.get(name);
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function inlineStyleDeclarations(node: TimelineNode) {
  const declarations = new Map<string, string>();
  for (const declaration of (node.attributes.get("style") ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim().toLowerCase().replace(/\s*!important\s*$/, "");
    if (property && value) declarations.set(property, value);
  }
  return declarations;
}

function insetSides(value: string) {
  const values = value.trim().split(/\s+/).filter(Boolean);
  if (values.length < 1 || values.length > 4) return null;
  const [top, second = top, third = top, fourth = second] = values;
  return values.length === 2
    ? { top, right: second, bottom: top, left: second }
    : values.length === 3
      ? { top, right: second, bottom: third, left: second }
      : { top, right: second, bottom: third, left: fourth };
}

function captionStyleDeclarations(html: string, node: TimelineNode) {
  const values = new Map<string, { value: string; specificity: number; order: number }>();
  let order = 0;
  const apply = (property: string, value: string, specificity: number) => {
    order += 1;
    const current = values.get(property);
    if (!current || specificity > current.specificity || (specificity === current.specificity && order > current.order)) {
      values.set(property, { value, specificity, order });
    }
  };
  const applyDeclarations = (declarations: Map<string, string>, specificity: number) => {
    for (const [property, value] of declarations) {
      if (property === "inset") {
        const sides = insetSides(value);
        if (sides) for (const [side, sideValue] of Object.entries(sides)) apply(side, sideValue, specificity);
      } else {
        apply(property, value, specificity);
      }
    }
  };
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = (style[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = inlineStyleDeclarations({ ...node, attributes: new Map([["style", rule[2] ?? ""]]) });
      for (const selector of (rule[1] ?? "").split(",")) {
        const normalized = selector.trim();
        if (!/^\.[-_A-Za-z0-9]+(?:\.[-_A-Za-z0-9]+)*$/.test(normalized)) continue;
        const classes = normalized.split(".").filter(Boolean);
        if (classes.every((className) => node.classNames.has(className))) {
          applyDeclarations(declarations, classes.length);
        }
      }
    }
  }
  applyDeclarations(inlineStyleDeclarations(node), 1_000);
  return new Map(Array.from(values, ([property, entry]) => [property, entry.value]));
}

function defaultCaptionStyleIssues(html: string, caption: TimelineNode): VoiceoverTimelineIssue[] {
  const issues: VoiceoverTimelineIssue[] = [];
  const captionId = caption.attributes.get("id")?.trim();
  const label = captionId ? `Caption ${captionId}` : "Every default caption";
  const outer = captionStyleDeclarations(html, caption);
  const hasHorizontalBounds = outer.has("left") && outer.has("right");
  const hasBottomAnchor = outer.has("bottom");
  if (
    outer.get("position") !== "absolute"
    || outer.get("top") !== "auto"
    || !hasHorizontalBounds
    || !hasBottomAnchor
    || outer.get("height") !== "auto"
    || outer.get("display") !== "flex"
    || outer.get("justify-content") !== "center"
    || !["center", "flex-end"].includes(outer.get("align-items") ?? "")
    || outer.get("overflow") !== "visible"
    || outer.get("background") !== "transparent"
  ) {
    issues.push({
      code: "default_caption_layout_invalid",
      message: `${label} must use the canonical transparent-bottom layout so global .clip inset/stretch rules cannot turn it into a full-height panel.`,
    });
  }
  const captionChildren = timelineNodes(nodeInnerHtml(html, caption));
  const captionText = captionChildren.find((node) => node.attributes.get("data-ipw-caption-text") === "true")
    ?? captionChildren.find((node) => node.classNames.has("caption-inner"));
  const textStyle = captionText ? captionStyleDeclarations(html, captionText) : new Map<string, string>();
  if (
    !captionText
    || textStyle.get("background") !== "transparent"
    || textStyle.get("text-align") !== "center"
    || !textStyle.has("max-width")
    || !textStyle.has("color")
    || (!textStyle.has("text-shadow") && !textStyle.has("-webkit-text-stroke"))
  ) {
    issues.push({
      code: "default_caption_background_invalid",
      message: `${label} text must explicitly use a transparent background, centered bounded text, and shadow or stroke for contrast.`,
    });
  }
  return issues;
}

export function validateVoiceoverTimelineHtml(html: string, options: {
  voiceoverAssets?: string[];
  mediaAssets?: string[];
  requirements?: VideoTimelineRequirements;
} = {}) {
  const epsilon = 0.001;
  const issues: VoiceoverTimelineIssue[] = [];
  const nodes = timelineNodes(html);
  const composition = nodes.find((node) => node.attributes.has("data-composition-id"));
  const compositionDuration = composition ? finiteTimelineNumber(composition, "data-duration") : null;
  if (compositionDuration == null || compositionDuration <= 0) {
    issues.push({ code: "invalid_composition_duration", message: "Root composition needs an explicit positive data-duration." });
  }

  const scenes = nodes
    .filter((node) => node.classNames.has("scene") || node.attributes.has("data-scene"))
    .map((node) => ({
      id: node.attributes.get("id")?.trim() ?? "",
      start: finiteTimelineNumber(node, "data-start"),
      duration: finiteTimelineNumber(node, "data-duration"),
      text: narrationSourceTextFromHtml(nodeInnerHtml(html, node)),
    }));
  const scenesById = new Map(scenes.filter((scene) => scene.id).map((scene) => [scene.id, scene]));
  for (const scene of scenes) {
    if (!scene.id || scene.start == null || scene.duration == null || scene.duration <= 0) {
      issues.push({ code: "invalid_scene_window", message: "Every narrated scene needs an id and explicit positive numeric start/duration.", ...(scene.id ? { sceneId: scene.id } : {}) });
    }
  }
  const orderedScenes = scenes
    .filter((scene): scene is typeof scene & { start: number; duration: number } => scene.start != null && scene.duration != null && scene.duration > 0)
    .sort((a, b) => a.start - b.start);
  for (let index = 1; index < orderedScenes.length; index += 1) {
    const previous = orderedScenes[index - 1]!;
    const current = orderedScenes[index]!;
    if (current.start < previous.start + previous.duration - epsilon) {
      issues.push({ code: "scene_overlap", message: `Scene ${current.id || index + 1} starts before the previous scene ends.`, ...(current.id ? { sceneId: current.id } : {}) });
    }
  }
  if (scenes.length === 0 && referencedVoiceoverSources(html).size > 0) {
    issues.push({
      code: "missing_hyperframes_scenes",
      message: "Voiceover videos must declare visual scenes as .scene.clip elements with seconds-based data-start/data-duration.",
    });
  }

  const legacyFrameDurations = nodes
    .filter((node) => node.tagName === "section" && node.classNames.has("frame") && !node.classNames.has("scene"))
    .map((node) => finiteTimelineNumber(node, "data-duration"))
    .filter((value): value is number => value != null && value > 100);
  if (legacyFrameDurations.length > 0) {
    issues.push({
      code: "legacy_frame_millisecond_timeline",
      message: "Legacy frame sections use millisecond durations. Convert them to .scene.clip elements with seconds-based data-start/data-duration.",
    });
    const legacyTotalSeconds = roundVoiceoverTime(legacyFrameDurations.reduce((sum, value) => sum + value, 0) / 1000);
    if (compositionDuration != null && legacyTotalSeconds > compositionDuration + epsilon) {
      issues.push({
        code: "declared_duration_mismatch",
        message: `Root data-duration is ${compositionDuration} seconds, but legacy scene declarations total ${legacyTotalSeconds} seconds. Rebuild the real HyperFrames timeline to match the intended duration.`,
      });
    }
  }

  const voiceovers = nodes
    .filter((node) => {
      if (node.tagName !== "audio") return false;
      const id = node.attributes.get("id") ?? "";
      const src = node.attributes.get("src") ?? "";
      return node.attributes.get("data-ipw-voiceover") === "true"
        || id === "voiceover"
        || id.startsWith("vo-")
        || id.startsWith("narration-")
        || isVoiceoverSource(src);
    })
    .map((node) => ({
      sceneId: node.attributes.get("data-ipw-scene-id")?.trim() ?? "",
      sceneText: node.attributes.get("data-ipw-scene-text")?.trim() ?? "",
      narrationText: node.attributes.get("data-ipw-narration-text")?.trim() ?? "",
      start: finiteTimelineNumber(node, "data-start"),
      duration: finiteTimelineNumber(node, "data-duration"),
    }));
  const captions = nodes.filter((node) => node.attributes.get("data-ipw-caption") === "true");
  const bgmNodes = nodes.filter((node) => node.tagName === "audio" && node.attributes.get("data-ipw-bgm") === "true");
  const implementedAnimationReferences = new Set(
    nodes.flatMap((node) => (node.attributes.get("data-ipw-animation-reference") ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean)),
  );
  const requirements = options.requirements ?? {};
  if (requirements.targetDurationSeconds != null && requirements.targetDurationSeconds > 0 && compositionDuration != null) {
    const toleranceSeconds = Math.max(0.5, requirements.targetDurationSeconds * 0.1);
    const minimumDuration = requirements.targetDurationSeconds - toleranceSeconds;
    const maximumDuration = requirements.targetDurationSeconds + toleranceSeconds;
    if (compositionDuration < minimumDuration || compositionDuration > maximumDuration) {
      issues.push({
        code: "requested_duration_mismatch",
        message: `The user requested about ${requirements.targetDurationSeconds} seconds, but the composition is ${compositionDuration} seconds. Keep the final duration between ${roundVoiceoverTime(minimumDuration)} and ${roundVoiceoverTime(maximumDuration)} seconds.`,
      });
    }
  }
  if (requirements.voiceover && voiceovers.length === 0) {
    issues.push({ code: "required_voiceover_missing", message: "The user requested narration, but the timeline has no data-ipw-voiceover audio nodes." });
  }
  if (requirements.captions && captions.length === 0) {
    issues.push({ code: "required_captions_missing", message: "The user requested captions, but the timeline has no data-ipw-caption clips." });
  }
  for (const caption of captions) {
    const start = finiteTimelineNumber(caption, "data-start");
    const duration = finiteTimelineNumber(caption, "data-duration");
    if (!caption.classNames.has("clip") || start == null || duration == null || duration <= 0) {
      issues.push({ code: "invalid_caption_window", message: "Every caption must be a timed .clip with explicit data-start and positive data-duration." });
    }
    const dataHfId = caption.attributes.get("data-hf-id")?.trim() ?? "";
    const id = caption.attributes.get("id")?.trim() ?? "";
    if (dataHfId && !id && html.includes(`#${dataHfId}`)) {
      issues.push({
        code: "caption_animation_target_missing",
        message: `Caption ${dataHfId} is targeted as #${dataHfId}, but it has no matching id attribute and can remain invisible. Use a matching id or a data-hf-id selector.`,
      });
    }
    const hasInfiniteAnimation = Array.from(caption.classNames).some((className) => {
      const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\.${escapedClassName}[^{}]*\\{[^{}]*animation\\s*:[^;{}]*\\binfinite\\b`, "i").test(html);
    });
    if (hasInfiniteAnimation) {
      issues.push({
        code: "non_seek_safe_caption_animation",
        message: "Caption animation must use a finite seek-safe timeline; infinite CSS animation can diverge between preview and render.",
      });
    }
    if (requirements.captions && requirements.captionStyle !== "custom") {
      issues.push(...defaultCaptionStyleIssues(html, caption));
    }
  }
  if (requirements.bgm && bgmNodes.length === 0) {
    issues.push({ code: "required_bgm_missing", message: "The user requested BGM, but the timeline has no data-ipw-bgm audio node." });
  }
  for (const bgm of bgmNodes) {
    const source = (bgm.attributes.get("src") ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
    const start = finiteTimelineNumber(bgm, "data-start");
    const duration = finiteTimelineNumber(bgm, "data-duration");
    const available = new Set((options.mediaAssets ?? []).map((asset) => asset.replace(/\\/g, "/").replace(/^\.\//, "")));
    const fileName = source.split("/").pop() ?? source;
    const sourceExists = options.mediaAssets === undefined || available.has(source) || Array.from(available).some((asset) => asset.endsWith(`/${fileName}`));
    if (!source || start == null || duration == null || duration <= 0 || !sourceExists) {
      issues.push({ code: "invalid_bgm_timeline", message: "BGM must reference a real local media file and have explicit data-start and positive data-duration." });
    }
  }
  for (const reference of requirements.animationReferences ?? []) {
    if (!implementedAnimationReferences.has(reference)) {
      issues.push({ code: "required_animation_missing", message: `The selected animation ${reference} is not marked on an implemented timeline element.` });
    }
  }
  if (voiceovers.length > 0 && containsManualVoiceoverPlayback(html)) {
    issues.push({
      code: "manual_voiceover_playback",
      message: "Remove manual voiceover play/pause/seek script; HyperFrames must own narration playback from data-start/data-duration.",
    });
  }
  if (referencedVoiceoverSources(html).size > voiceovers.length) {
    issues.push({
      code: "voiceover_assets_not_on_timeline",
      message: "Voiceover MP3 references exist outside HyperFrames audio timeline nodes. Insert each voiceover as <audio data-ipw-voiceover=\"true\" ...> with data-start/data-duration.",
    });
  }
  const referencedSources = referencedVoiceoverSources(html);
  const normalizedAssets = (options.voiceoverAssets ?? []).map((value) => value.replace(/\\/g, "/").replace(/^\.\//, ""));
  if (options.voiceoverAssets !== undefined) {
    const availableFileNames = new Set(normalizedAssets.map((asset) => asset.split("/").pop() ?? asset));
    const missingAssets = Array.from(referencedSources).filter((source) => {
      const fileName = source.split("/").pop() ?? source;
      return !availableFileNames.has(fileName);
    });
    if (missingAssets.length > 0) {
      issues.push({
        code: "voiceover_assets_missing",
        message: `Voiceover timeline files are missing from the composition assets directory: ${missingAssets.slice(0, 5).join(", ")}${missingAssets.length > 5 ? ", ..." : ""}.`,
      });
    }
  }
  const orphanAssets = normalizedAssets.filter((asset) => {
    const fileName = asset.split("/").pop() ?? asset;
    return !referencedSources.has(asset) && !referencedSources.has(`assets/${fileName}`) && !referencedSources.has(fileName);
  });
  if (orphanAssets.length > 0) {
    issues.push({
      code: "voiceover_assets_unreferenced",
      message: `Voiceover assets are present but not attached to the HyperFrames timeline: ${orphanAssets.slice(0, 5).join(", ")}${orphanAssets.length > 5 ? ", ..." : ""}.`,
    });
  }
  const orderedVoiceovers: Array<{ sceneId: string; start: number; duration: number }> = [];
  for (const voiceover of voiceovers) {
    const scene = scenesById.get(voiceover.sceneId);
    if (!voiceover.sceneId || !voiceover.sceneText || !voiceover.narrationText) {
      issues.push({ code: "invalid_voiceover_binding", message: "Remove legacy narration or add complete scene synchronization metadata before export.", ...(voiceover.sceneId ? { sceneId: voiceover.sceneId } : {}) });
    }
    if (!scene || voiceover.start == null || voiceover.duration == null || voiceover.duration <= 0) {
      issues.push({ code: "invalid_voiceover_window", message: "Every voiceover needs a valid scene binding and explicit positive numeric start/duration.", ...(voiceover.sceneId ? { sceneId: voiceover.sceneId } : {}) });
      if (voiceover.start != null && voiceover.duration != null && voiceover.duration > 0) {
        orderedVoiceovers.push({ sceneId: voiceover.sceneId || "legacy voiceover", start: voiceover.start, duration: voiceover.duration });
      }
      continue;
    }
    if (!voiceover.sceneText || voiceover.narrationText !== voiceover.sceneText) {
      issues.push({ code: "voiceover_text_mismatch", message: `Voiceover text does not match visible text for scene ${voiceover.sceneId}.`, sceneId: voiceover.sceneId });
    }
    if (scene.text && normalizeSceneText(voiceover.sceneText) !== scene.text) {
      issues.push({ code: "voiceover_scene_text_mismatch", message: `Voiceover metadata does not match the current visible text in scene ${voiceover.sceneId}.`, sceneId: voiceover.sceneId });
    }
    if (scene.start == null || scene.duration == null || Math.abs(voiceover.start - scene.start) >= epsilon) {
      issues.push({ code: "voiceover_start_mismatch", message: `Voiceover for scene ${voiceover.sceneId} must start with its scene.`, sceneId: voiceover.sceneId });
    } else if (voiceover.start + voiceover.duration > scene.start + scene.duration + epsilon) {
      issues.push({ code: "voiceover_exceeds_scene", message: `Extend scene ${voiceover.sceneId}; its voiceover continues after the scene ends.`, sceneId: voiceover.sceneId });
    }
    orderedVoiceovers.push({ sceneId: voiceover.sceneId, start: voiceover.start, duration: voiceover.duration });
  }
  orderedVoiceovers.sort((a, b) => a.start - b.start);
  for (let index = 1; index < orderedVoiceovers.length; index += 1) {
    const previous = orderedVoiceovers[index - 1]!;
    const current = orderedVoiceovers[index]!;
    if (current.start < previous.start + previous.duration - epsilon) {
      issues.push({ code: "voiceover_overlap", message: `Voiceovers for ${previous.sceneId} and ${current.sceneId} overlap.`, sceneId: current.sceneId });
    }
  }
  const latestEnd = orderedVoiceovers.reduce((maximum, voiceover) => Math.max(maximum, voiceover.start + voiceover.duration), 0);
  if (compositionDuration != null && latestEnd > compositionDuration + epsilon) {
    issues.push({ code: "composition_too_short", message: `Extend the composition to at least ${roundVoiceoverTime(latestEnd + VOICEOVER_READING_BUFFER_SECONDS)} seconds.` });
  }
  return {
    valid: issues.length === 0,
    sceneCount: scenes.length,
    voiceoverCount: voiceovers.length,
    voiceoverAssetCount: normalizedAssets.length,
    captionCount: captions.length,
    bgmCount: bgmNodes.length,
    animationReferences: Array.from(implementedAnimationReferences),
    compositionDurationSeconds: compositionDuration,
    requiredDurationSeconds: roundVoiceoverTime(latestEnd + (voiceovers.length ? VOICEOVER_READING_BUFFER_SECONDS : 0)),
    issues,
  };
}

export const MEDIA_EXTENSION_ACTIONS = [
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "status",
    title: "Media Center status",
    description: "Check whether the configured Media Center provider is ready.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "speech_synthesize",
    title: "Synthesize speech",
    description: "Built-in iPolloWork CosyVoice action. Create speech without installing or authenticating an external CLI; the result contains a temporary audio URL from Model Studio.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to synthesize." },
        voice: { type: "string", description: "Optional Model Studio voice name or cloned voice id." },
        model: { type: "string", description: "Optional speech model. Defaults to cosyvoice-v3-flash." },
        format: { type: "string", description: "Optional audio format, for example wav or mp3." },
        sampleRate: { type: "number", description: "Optional output sample rate in Hz." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "speech_synthesize_workspace_file",
    title: "Synthesize speech to a workspace file",
    description: "Built-in iPolloWork CosyVoice action. Create an MP3 voiceover without an external CLI, save it atomically inside the active workspace, and return its measured frame duration for video synchronization.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "One visual scene's narration text." },
        sceneId: { type: "string", description: "The exact .scene element id narrated by this file." },
        sceneText: { type: "string", description: "The scene's marked narration-source transcript, or full visible text for legacy scenes. Must exactly equal text." },
        sceneStart: { type: "number", description: "The exact scene start time in seconds." },
        sceneDuration: { type: "number", description: "The visual scene's current duration in seconds. Used with the measured MP3 duration to return a non-overlapping timeline allocation." },
        outputPath: { type: "string", description: "New immutable .mp3 path. With compositionPath, use assets/<file>.mp3 (preferred) or the full workspace-relative path inside that composition's assets directory; output outside the current composition is rejected." },
        compositionPath: { type: "string", description: "Optional current index.html path relative to the active workspace. When present, bare assets/<file>.mp3 output is scoped to this HTML file's directory and audioElementHtml uses a relative src." },
        voice: { type: "string", description: "Model Studio voice name or cloned voice id." },
        model: { type: "string", description: "Speech model. Defaults to cosyvoice-v3-flash." },
        sampleRate: { type: "number", description: "Optional output sample rate in Hz." },
      },
      required: ["text", "sceneId", "sceneText", "sceneStart", "sceneDuration", "outputPath"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "speech_synthesize_workspace_batch",
    title: "Synthesize scene voiceovers to workspace files",
    description: "Built-in iPolloWork CosyVoice action. Without installing an external CLI, create a bounded batch of scene MP3 voiceovers, synthesize up to three scenes concurrently, and return ordered non-overlapping timeline allocations.",
    inputSchema: {
      type: "object",
      properties: {
        scenes: {
          type: "array",
          minItems: 1,
          maxItems: MAX_VOICEOVER_BATCH_SCENES,
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "One visual scene's narration text." },
              sceneId: { type: "string", description: "The exact .scene element id narrated by this file." },
              sceneText: { type: "string", description: "The scene's marked narration-source transcript, or full visible text for legacy scenes. Must exactly equal text." },
              sceneStart: { type: "number", description: "The scene's current start time before narration shifts are applied." },
              sceneDuration: { type: "number", description: "The scene's current duration in seconds." },
              outputPath: { type: "string", description: "New immutable .mp3 path. With compositionPath, use assets/<file>.mp3 (preferred) or the full workspace-relative path inside that composition's assets directory; cross-project output is rejected." },
            },
            required: ["text", "sceneId", "sceneText", "sceneStart", "sceneDuration", "outputPath"],
            additionalProperties: false,
          },
        },
        compositionPath: { type: "string", description: "Optional current index.html path relative to the active workspace. Bare assets/<file>.mp3 scene outputs are scoped to this HTML file's directory." },
        targetDurationSeconds: { type: "number", description: "Optional user-requested final duration. Narration is rejected before synthesis when its estimated timeline cannot fit." },
        voice: { type: "string", description: "Model Studio voice name or cloned voice id." },
        model: { type: "string", description: "Speech model. Defaults to cosyvoice-v3-flash." },
        sampleRate: { type: "number", description: "Optional output sample rate in Hz." },
      },
      required: ["scenes"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "voiceover_timeline_validate",
    title: "Validate a video voiceover timeline",
    description: "Validate local scene, narration, and composition timing before completing a video task. This action uses no provider quota.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Video index.html path relative to the active workspace." },
        requirements: {
          type: "object",
          description: "Deliverables explicitly requested by the user in the current or unresolved earlier turns.",
          properties: {
            voiceover: { type: "boolean" },
            captions: { type: "boolean" },
            captionStyle: { type: "string", enum: ["transparent-bottom", "custom"], description: "Defaults to transparent-bottom. Use custom only when the user explicitly requested a different caption position or background treatment." },
            bgm: { type: "boolean" },
            animationReferences: { type: "array", items: { type: "string" } },
            targetDurationSeconds: { type: "number", description: "Optional user-requested final video duration. The final composition must remain within ten percent of this target." },
          },
          additionalProperties: false,
        },
      },
      required: ["sourcePath"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "voice_clone",
    title: "Clone a voice",
    description: "Create a reusable Model Studio voice from an accessible audio URL. Keep the returned voice id for later speech synthesis.",
    inputSchema: {
      type: "object",
      properties: {
        audioUrl: { type: "string", description: "Public HTTPS URL of the clean reference audio." },
        prefix: { type: "string", description: "Short unique prefix used to identify the cloned voice." },
        targetModel: { type: "string", description: "Optional synthesis model to pair with the voice. Defaults to cosyvoice-v3-flash." },
        languageHints: { type: "array", items: { type: "string" }, description: "Optional language hints, for example [\"zh\"] or [\"en\"]." },
      },
      required: ["audioUrl", "prefix"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "voice_list",
    title: "List cloned voices",
    description: "List reusable CosyVoice voices created in the current Alibaba Model Studio account.",
    inputSchema: {
      type: "object",
      properties: {
        pageIndex: { type: "number", description: "Optional zero-based page index. Defaults to 0." },
        pageSize: { type: "number", description: "Optional page size. Defaults to 100." },
      },
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "voice_clone_workspace_file",
    title: "Clone a workspace voice sample",
    description: "Clone one WAV, MP3, or M4A workspace file without exposing a public bucket or requiring a manual URL.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Relative WAV, MP3, or M4A path inside the active workspace." },
        targetModel: { type: "string", description: "Optional CosyVoice model. Defaults to cosyvoice-v3-flash." },
        languageHints: { type: "array", items: { type: "string" }, description: "Optional language hints for the clean voice sample." },
      },
      required: ["sourcePath"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "speech_transcribe",
    title: "Transcribe audio or video",
    description: "Submit an asynchronous Fun-ASR transcription task for one accessible audio or video URL.",
    inputSchema: {
      type: "object",
      properties: {
        fileUrl: { type: "string", description: "Public HTTPS URL or data URI of the audio or video input." },
        model: { type: "string", description: "Optional ASR model. Defaults to fun-asr." },
        parameters: { type: "object", description: "Optional documented Fun-ASR parameters." },
      },
      required: ["fileUrl"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "speech_recognize_realtime",
    title: "Recognize speech with a realtime model",
    description: "Run Fun-ASR realtime recognition for a short accessible audio segment. Use this for low-latency segmented input, not a browser-side credential flow.",
    inputSchema: {
      type: "object",
      properties: {
        audioUrl: { type: "string", description: "Public HTTPS URL of the current audio segment." },
        format: { type: "string", description: "Audio format, for example wav, mp3, or pcm." },
      },
      required: ["audioUrl", "format"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "speech_translate",
    title: "Translate audio or video",
    description: "Translate an accessible audio or video file with Qwen LiveTranslate. Returns translated text and, when requested, decoded audio chunks.",
    inputSchema: {
      type: "object",
      properties: {
        fileUrl: { type: "string", description: "Public HTTPS URL or data URI of the audio or video input." },
        fileType: { type: "string", enum: ["audio", "video"], description: "Input media type. Defaults to audio." },
        format: { type: "string", description: "Audio format when fileType is audio, for example wav or mp3." },
        sourceLanguage: { type: "string", description: "Optional source language code. Omit for automatic detection." },
        targetLanguage: { type: "string", description: "Required target language code, for example en or zh." },
        includeAudio: { type: "boolean", description: "Return translated audio chunks as base64 in addition to text. Defaults to false." },
        voice: { type: "string", description: "Output voice when includeAudio is true. Defaults to Cherry." },
      },
      required: ["fileUrl", "targetLanguage"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "video_generate",
    title: "Generate video",
    description: "Submit an asynchronous Wan text or image guided video generation task.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["minimax"], description: "Set to minimax to use MiniMax image-to-video generation." },
        region: { type: "string", enum: ["global_en", "cn_zh"], description: "Optional MiniMax region. Defaults to global_en." },
        prompt: { type: "string", description: "Video prompt." },
        model: { type: "string", description: "Optional video model. MiniMax defaults to MiniMax-H3." },
        imageUrl: { type: "string", description: "Optional public image URL for models that support image guidance." },
        audioUrl: { type: "string", description: "Optional public audio URL for models that support audio guidance." },
        resolution: { type: "string", description: "Optional MiniMax output resolution." },
        duration: { type: "integer", description: "Optional MiniMax output duration in seconds." },
        ratio: { type: "string", enum: ["adaptive"], description: "MiniMax H3 image-to-video uses the input image ratio." },
        promptOptimizer: { type: "boolean", description: "Optional MiniMax v1 prompt optimization setting." },
        fastPretreatment: { type: "boolean", description: "Optional MiniMax v1 fast pretreatment setting." },
        callbackUrl: { type: "string", description: "Optional MiniMax task callback URL." },
        parameters: { type: "object", description: "Optional documented Wan parameters such as size, duration, or prompt_extend." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "video_edit",
    title: "Edit video",
    description: "Submit an asynchronous Wan video edit task. Pass only the input and parameters documented for the selected model.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Wan video edit model enabled in the configured Model Studio workspace." },
        input: { type: "object", description: "Model-specific video edit input, including accessible source URLs." },
        parameters: { type: "object", description: "Optional model-specific edit parameters." },
      },
      required: ["model", "input"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "digital_human_generate",
    title: "Generate digital human video",
    description: "Create a Wan digital-human lip-sync task from one public image URL and one public audio URL.",
    inputSchema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "Public HTTPS URL of the person or character image." },
        audioUrl: { type: "string", description: "Public HTTPS URL of the driving audio." },
        parameters: { type: "object", description: "Optional documented Wan digital-human parameters, for example resolution or style." },
      },
      required: ["imageUrl", "audioUrl"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "task_get",
    title: "Get media task",
    description: "Read the status and result of an asynchronous Model Studio media task.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["minimax"], description: "Set to minimax to query a MiniMax video task." },
        region: { type: "string", enum: ["global_en", "cn_zh"], description: "Optional MiniMax region. Defaults to global_en." },
        apiVersion: { type: "string", enum: ["v1", "v2"], description: "MiniMax API version used to create the task. Defaults to v2." },
        taskId: { type: "string", description: "Task id returned by a media generation or transcription action." },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function readOptionalBoolean(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value) || typeof value[key] !== "boolean") return undefined;
  return value[key] as boolean;
}

function readOptionalNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value) || typeof value[key] !== "number" || !Number.isFinite(value[key])) return undefined;
  return value[key] as number;
}

function boundedInteger(value: unknown, key: string, fallback: number, min: number, max: number): number {
  const candidate = readOptionalNumber(value, key);
  if (candidate === undefined) return fallback;
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new ApiError(400, "invalid_payload", `${key} must be an integer between ${min} and ${max}`);
  }
  return candidate;
}

function readRecord(value: unknown, key: string): JsonRecord {
  return isRecord(value) && isRecord(value[key]) ? value[key] : {};
}

function readStringArray(value: unknown, key: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[key])) return [];
  return value[key]
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireString(value: unknown, key: string): string {
  const result = readStringField(value, key);
  if (!result) throw new ApiError(400, "invalid_payload", `${key} is required`);
  return result;
}

function providerMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message) return message;
  const output = isRecord(payload.output) ? payload.output : null;
  const nestedMessage = typeof output?.message === "string" ? output.message.trim() : "";
  return nestedMessage || null;
}

function isCosyVoiceCompatibilityError(status: number, message: string | null) {
  return status === 418 && /(?:cosyvoice|tts).*engine return error code:\s*418/i.test(message ?? "");
}

function compatibleCosyVoiceVoice(model: string, voice: string) {
  if (model !== COSYVOICE_V3_FLASH) return voice;
  return LEGACY_COSYVOICE_V3_PRESET_MIGRATIONS[voice] ?? voice;
}

function taskIdFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return readStringField(payload, "task_id")
    || readStringField(readRecord(payload, "task"), "id")
    || readStringField(readRecord(payload, "output"), "task_id")
    || null;
}

function voiceIdFromPayload(payload: unknown): string {
  const output = readRecord(payload, "output");
  return readStringField(output, "voice_id") || readStringField(output, "voice");
}

function synthesizedAudioUrl(payload: unknown): string {
  const output = readRecord(payload, "output");
  const audio = readRecord(output, "audio");
  const value = readStringField(audio, "url") || readStringField(output, "audio_url");
  if (!value) {
    throw new ApiError(502, "bailian_audio_url_missing", "Alibaba Model Studio did not return a synthesized audio URL.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(502, "bailian_audio_url_invalid", "Alibaba Model Studio returned an invalid synthesized audio URL.");
  }
  const hostname = url.hostname.toLowerCase();
  const trustedResultHost = /^dashscope-result(?:-[a-z0-9-]+)?\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(hostname);
  if (!trustedResultHost || url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new ApiError(502, "bailian_audio_url_invalid", "Alibaba Model Studio returned an unsafe synthesized audio URL.");
  }
  // Model Studio's documented non-streaming TTS response still returns an
  // HTTP URL on its own OSS result host. Upgrade only that trusted host before
  // downloading; arbitrary HTTP URLs remain rejected.
  url.protocol = "https:";
  return url.toString();
}

async function downloadSynthesizedAudio(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BAILIAN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await mediaProviderFetch(url, { signal: controller.signal, redirect: "error" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "bailian_audio_download_timeout", "The synthesized audio download timed out.");
    }
    throw new ApiError(502, "bailian_audio_download_failed", "Could not download synthesized audio from Alibaba Model Studio.");
  }
  try {
    if (!response.ok) {
      throw new ApiError(response.status, "bailian_audio_download_failed", `Synthesized audio download failed (HTTP ${response.status}).`);
    }
    const declaredBytes = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SYNTHESIZED_AUDIO_BYTES) {
      throw new ApiError(413, "bailian_audio_too_large", "Synthesized audio exceeded the local file size limit.");
    }
    if (!response.body) throw new ApiError(502, "bailian_audio_download_failed", "Synthesized audio response was empty.");

    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_SYNTHESIZED_AUDIO_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "bailian_audio_too_large", "Synthesized audio exceeded the local file size limit.");
      }
      chunks.push(chunk.value);
    }
    if (!bytes) throw new ApiError(502, "bailian_audio_download_failed", "Synthesized audio response was empty.");
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "bailian_audio_download_timeout", "The synthesized audio download timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mp3DurationSeconds(bytes: Uint8Array): number {
  let offset = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    offset = 10 + size + ((bytes[5]! & 0x10) ? 10 : 0);
  }

  const mpeg1Layer3Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const mpeg2Layer3Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const baseSampleRates = [44_100, 48_000, 32_000, 0];
  let duration = 0;
  let frames = 0;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1]! & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const versionBits = (bytes[offset + 1]! >> 3) & 0x03;
    const layerBits = (bytes[offset + 1]! >> 1) & 0x03;
    const bitrateIndex = (bytes[offset + 2]! >> 4) & 0x0f;
    const sampleRateIndex = (bytes[offset + 2]! >> 2) & 0x03;
    const padding = (bytes[offset + 2]! >> 1) & 0x01;
    if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      offset += 1;
      continue;
    }
    const mpeg1 = versionBits === 3;
    const sampleRateDivisor = mpeg1 ? 1 : versionBits === 2 ? 2 : 4;
    const sampleRate = baseSampleRates[sampleRateIndex]! / sampleRateDivisor;
    const bitrateKbps = (mpeg1 ? mpeg1Layer3Bitrates : mpeg2Layer3Bitrates)[bitrateIndex]!;
    const samplesPerFrame = mpeg1 ? 1_152 : 576;
    const frameLength = Math.floor(((mpeg1 ? 144_000 : 72_000) * bitrateKbps) / sampleRate) + padding;
    if (frameLength < 4 || offset + frameLength > bytes.length) break;
    duration += samplesPerFrame / sampleRate;
    frames += 1;
    offset += frameLength;
  }
  if (!frames) throw new ApiError(502, "bailian_audio_invalid", "Alibaba Model Studio returned audio without valid MP3 frames.");
  return duration;
}

type WorkspaceVoiceoverSceneInput = {
  text: string;
  sceneId: string;
  sceneText: string;
  sceneStart: number;
  sceneDuration: number;
  outputPath: string;
};

type SynthesizedWorkspaceVoiceover = {
  scene: WorkspaceVoiceoverSceneInput;
  sourcePath: string;
  absolutePath: string;
  durationSeconds: number;
  bytes: number;
  model: string;
  voice: string;
};

function workspaceVoiceoverSceneInput(value: unknown): WorkspaceVoiceoverSceneInput {
  const text = requireString(value, "text");
  const sceneId = requireString(value, "sceneId");
  const sceneText = requireString(value, "sceneText");
  const sceneStart = readOptionalNumber(value, "sceneStart");
  const sceneDuration = readOptionalNumber(value, "sceneDuration");
  if (text !== sceneText) {
    throw new ApiError(400, "voiceover_scene_text_mismatch", "text must exactly equal sceneText so narration matches the visible scene.");
  }
  if (!/^[-_A-Za-z0-9:.]+$/.test(sceneId)) {
    throw new ApiError(400, "invalid_voiceover_scene_id", "sceneId contains unsupported characters.");
  }
  if (sceneStart === undefined || sceneStart < 0) {
    throw new ApiError(400, "invalid_voiceover_scene_start", "sceneStart must be a non-negative number.");
  }
  if (sceneDuration === undefined || sceneDuration <= 0) {
    throw new ApiError(400, "invalid_voiceover_scene_duration", "sceneDuration must be greater than zero.");
  }
  const outputPath = requireString(value, "outputPath");
  if (extname(outputPath).toLowerCase() !== ".mp3") {
    throw new ApiError(400, "invalid_synthesized_audio_path", "outputPath must use the .mp3 extension.");
  }
  return { text, sceneId, sceneText, sceneStart, sceneDuration, outputPath };
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: Array<R | undefined> = new Array(items.length);
  let nextIndex = 0;
  let firstError: unknown;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (firstError === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await map(items[index]!);
      } catch (error) {
        firstError = error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError !== undefined) throw firstError;
  return results.filter((value): value is R => value !== undefined);
}

async function synthesizeWorkspaceVoiceover(input: {
  config: ServerConfig;
  context: JsonRecord;
  apiKey: string;
  baseUrl: string;
  scene: WorkspaceVoiceoverSceneInput;
  model: string;
  voice: string;
  sampleRate?: number;
}): Promise<SynthesizedWorkspaceVoiceover> {
  const cacheKey = voiceoverAudioCacheKey({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    text: input.scene.text,
    model: input.model,
    voice: input.voice,
    sampleRate: input.sampleRate,
  });
  let audio = readCachedVoiceoverAudio(cacheKey);
  if (!audio) {
    const providerResponse = await requestProviderJson({
      apiKey: input.apiKey,
      url: endpoint(input.baseUrl, "/api/v1/services/audio/tts/SpeechSynthesizer"),
      body: {
        model: input.model,
        input: {
          text: input.scene.text,
          ...(input.voice ? { voice: input.voice } : {}),
          format: "mp3",
          ...(input.sampleRate ? { sample_rate: input.sampleRate } : {}),
        },
      },
    });
    audio = await downloadSynthesizedAudio(synthesizedAudioUrl(providerResponse));
    cacheVoiceoverAudio(cacheKey, audio);
  }
  const workspace = workspaceForContext(input.config, input.context);
  const destination = resolveWorkspaceFile(workspace.path, input.scene.outputPath);
  const temporaryPath = `${destination.absolutePath}.${randomUUID()}.tmp`;
  await mkdir(dirname(destination.absolutePath), { recursive: true });
  try {
    await writeFile(temporaryPath, audio, { flag: "wx" });
    await link(temporaryPath, destination.absolutePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return {
    scene: input.scene,
    sourcePath: destination.relativePath,
    absolutePath: destination.absolutePath,
    durationSeconds: mp3DurationSeconds(audio),
    bytes: audio.byteLength,
    model: input.model,
    voice: input.voice,
  };
}

export function estimateVoiceoverDurationSeconds(text: string) {
  const cjkCharacters = Array.from(text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)).length;
  const latinWords = text
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ")
    .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const sentencePauses = text.match(/[。！？!?；;:：]/g)?.length ?? 0;
  return roundVoiceoverTime(Math.max(0.5, (cjkCharacters / 4) + (latinWords / 2.5) + (sentencePauses * 0.12)));
}

function workspaceVoiceoverResult(
  synthesized: SynthesizedWorkspaceVoiceover,
  compositionPath: string | undefined,
  startSeconds: number,
) {
  const scene = synthesized.scene;
  const timing = planSceneVoiceoverTiming(startSeconds, scene.sceneDuration, synthesized.durationSeconds);
  const audioElementId = htmlAudioIdForVoiceover(scene.sceneId, synthesized.sourcePath);
  const audioElementSourcePath = relativeHtmlMediaSource(compositionPath, synthesized.sourcePath);
  return {
    sourcePath: synthesized.sourcePath,
    durationSeconds: synthesized.durationSeconds,
    bytes: synthesized.bytes,
    sceneId: scene.sceneId,
    sceneText: scene.sceneText,
    sceneStart: timing.startSeconds,
    originalSceneStart: scene.sceneStart,
    sceneDuration: scene.sceneDuration,
    timing,
    audioElementId,
    audioElementHtml: voiceoverAudioElementHtml({
      id: audioElementId,
      sourcePath: audioElementSourcePath,
      sceneId: scene.sceneId,
      sceneText: scene.sceneText,
      startSeconds: timing.startSeconds,
      durationSeconds: synthesized.durationSeconds,
    }),
    timelinePatch: {
      setSceneStartSeconds: timing.startSeconds,
      setSceneDurationSeconds: timing.requiredSceneDurationSeconds,
      shiftFollowingBySeconds: timing.shiftFollowingBySeconds,
      rootDurationMustBeAtLeastSeconds: timing.endSeconds + VOICEOVER_READING_BUFFER_SECONDS,
      keepSceneVisibleUntilSeconds: timing.endSeconds,
    },
    model: synthesized.model,
    ...(synthesized.voice ? { voice: synthesized.voice } : {}),
  };
}

function voiceListFromPayload(payload: unknown) {
  const output = readRecord(payload, "output");
  const entries = Array.isArray(output.voice_list) ? output.voice_list : [];
  return entries.flatMap((entry) => {
    const id = voiceIdFromPayload({ output: entry });
    if (!id) return [];
    return [{
      id,
      status: readStringField(entry, "status") || "UNKNOWN",
      createdAt: readStringField(entry, "gmt_create") || null,
      updatedAt: readStringField(entry, "gmt_modified") || null,
      model: readStringField(entry, "target_model") || null,
    }];
  });
}

function safeProviderBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "invalid_bailian_base_url", "DASHSCOPE_BASE_URL must be a valid HTTPS Model Studio endpoint");
  }
  const hostname = url.hostname.toLowerCase();
  const isAllowed = hostname === "dashscope.aliyuncs.com" ||
    hostname === "dashscope-intl.aliyuncs.com" ||
    hostname.endsWith(".maas.aliyuncs.com");
  if (url.protocol !== "https:" || !isAllowed || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ApiError(400, "invalid_bailian_base_url", "DASHSCOPE_BASE_URL must be a trusted HTTPS Model Studio origin without a path");
  }
  return url.origin;
}

async function resolveBailianCredentials(env: EnvService): Promise<{ apiKey: string; baseUrl: string }> {
  const records = await env.list();
  const values = new Map(records.map((item) => [item.key, item.value.trim()] as const));
  const apiKey = values.get("DASHSCOPE_API_KEY") || process.env.DASHSCOPE_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new ApiError(400, "dashscope_api_key_missing", "Model Studio API key missing. Configure Alibaba Model Studio media in Authorization Center.");
  }
  const configuredBaseUrl = values.get("DASHSCOPE_BASE_URL") || process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_ALIYUN_MEDIA_BASE_URL;
  return { apiKey, baseUrl: safeProviderBaseUrl(configuredBaseUrl) };
}

function miniMaxImageToVideoApiVersion(model: string) {
  if (MINIMAX_IMAGE_TO_VIDEO_MODELS.v2.includes(model)) return "v2";
  if (MINIMAX_IMAGE_TO_VIDEO_MODELS.v1.includes(model)) return "v1";
  throw new ApiError(
    400,
    "invalid_minimax_video_model",
    `MiniMax image-to-video model must be one of: ${[
      ...MINIMAX_IMAGE_TO_VIDEO_MODELS.v2,
      ...MINIMAX_IMAGE_TO_VIDEO_MODELS.v1,
    ].join(", ")}`,
  );
}

function miniMaxImageToVideoEndpoint(region: string, apiVersion: string) {
  const endpoint = MINIMAX_IMAGE_TO_VIDEO_ENDPOINTS.find(
    (candidate) => candidate.region === region && candidate.apiVersion === apiVersion,
  );
  if (!endpoint) {
    throw new ApiError(400, "invalid_minimax_video_endpoint", "MiniMax region must be global_en or cn_zh, and API version must be v1 or v2.");
  }
  return endpoint;
}

async function resolveMiniMaxCredentials(env: EnvService) {
  const records = await env.list();
  const values = new Map(records.map((item) => [item.key, item.value.trim()]));
  const apiKey = values.get("MINIMAX_API_KEY") || process.env.MINIMAX_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new ApiError(400, "minimax_api_key_missing", "MiniMax API key missing. Configure MINIMAX_API_KEY before generating video.");
  }
  return apiKey;
}

async function requestMiniMaxVideo(input: {
  apiKey: string;
  url: string;
  method?: "GET" | "POST";
  body?: JsonRecord;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BAILIAN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await mediaProviderFetch(input.url, {
      method: input.method ?? "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "minimax_video_timeout", "MiniMax video generation did not respond before the request timed out.");
    }
    throw new ApiError(502, "minimax_video_unreachable", "Could not reach MiniMax video generation. Check the network and try again.");
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  const baseResponse = readRecord(payload, "base_resp");
  const statusCode = readOptionalNumber(baseResponse, "status_code");
  if (!response.ok || (statusCode !== undefined && statusCode !== 0)) {
    const message = readStringField(baseResponse, "status_msg") || providerMessage(payload);
    const fallback = response.ok
      ? `MiniMax video generation failed (status_code ${statusCode}).`
      : `MiniMax video generation failed (HTTP ${response.status}).`;
    throw new ApiError(response.ok ? 502 : response.status, "minimax_video_request_failed", message || fallback);
  }
  return payload;
}

function miniMaxImageToVideoBody(args: JsonRecord, model: string, apiVersion: string) {
  const prompt = requireString(args, "prompt");
  const imageUrl = requireString(args, "imageUrl");
  const callbackUrl = readStringField(args, "callbackUrl");
  if (apiVersion === "v2") {
    const duration = boundedInteger(args, "duration", 6, 4, 15);
    const resolution = readStringField(args, "resolution") || "2K";
    if (resolution !== "2K") {
      throw new ApiError(400, "invalid_minimax_video_resolution", "MiniMax H3 resolution must be 2K.");
    }
    return {
      model,
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl }, role: "first_frame" },
      ],
      resolution,
      duration,
      ratio: "adaptive",
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    };
  }

  const duration = readOptionalNumber(args, "duration");
  const resolution = readStringField(args, "resolution");
  return {
    model,
    first_frame_image: imageUrl,
    prompt,
    ...(readOptionalBoolean(args, "promptOptimizer") === undefined
      ? {}
      : { prompt_optimizer: readOptionalBoolean(args, "promptOptimizer") }),
    ...(readOptionalBoolean(args, "fastPretreatment") === undefined
      ? {}
      : { fast_pretreatment: readOptionalBoolean(args, "fastPretreatment") }),
    ...(duration === undefined ? {} : { duration }),
    ...(resolution ? { resolution } : {}),
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
  };
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

function safeBailianUploadHost(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(502, "bailian_upload_policy_invalid", "Alibaba Model Studio returned an invalid temporary upload host.");
  }
  const hostname = url.hostname.toLowerCase();
  const isAliyunOssHost = /^[a-z0-9.-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(hostname);
  if (url.protocol !== "https:" || !isAliyunOssHost || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ApiError(502, "bailian_upload_policy_invalid", "Alibaba Model Studio returned an untrusted temporary upload host.");
  }
  return url.origin;
}

async function requestProviderJson(input: {
  apiKey: string;
  url: string;
  method?: "GET" | "POST";
  body?: JsonRecord;
  headers?: Record<string, string>;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BAILIAN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await mediaProviderFetch(input.url, {
      method: input.method ?? "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...input.headers,
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "bailian_timeout", "Alibaba Model Studio did not respond before the request timed out.");
    }
    throw new ApiError(502, "bailian_unreachable", "Could not reach Alibaba Model Studio. Check the network and try again.");
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = providerMessage(payload);
    if (isCosyVoiceCompatibilityError(response.status, message)) {
      throw new ApiError(422, "bailian_voice_incompatible", "The selected CosyVoice voice is incompatible with its model or is not ready. Select a compatible v3 voice, or wait for a cloned voice to reach OK status.");
    }
    throw new ApiError(response.status, "bailian_request_failed", message || `Alibaba Model Studio request failed (HTTP ${response.status}).`);
  }
  return payload;
}

async function uploadWorkspaceFileToBailianTemporaryStorage(input: {
  config: ServerConfig;
  apiKey: string;
  baseUrl: string;
  context: JsonRecord;
  sourcePath: string;
  maxBytes: number;
}): Promise<string> {
  const workspace = workspaceForContext(input.config, input.context);
  const source = resolveWorkspaceFile(workspace.path, input.sourcePath);
  let bytes: Buffer;
  try {
    bytes = await readFile(source.absolutePath);
  } catch {
    throw new ApiError(404, "workspace_file_not_found", "Workspace file was not found");
  }
  if (bytes.byteLength > input.maxBytes) {
    throw new ApiError(413, "workspace_file_too_large", `Source file exceeds the ${Math.floor(input.maxBytes / (1024 * 1024))} MB limit.`);
  }

  const policyPayload = await requestProviderJson({
    apiKey: input.apiKey,
    url: `${endpoint(input.baseUrl, "/api/v1/uploads")}?action=getPolicy&model=voice-enrollment`,
    method: "GET",
  });
  const policy = readRecord(policyPayload, "data");
  const uploadHost = safeBailianUploadHost(readStringField(policy, "upload_host"));
  const uploadDirectory = readStringField(policy, "upload_dir").replace(/^\/+|\/+$/g, "");
  const accessKeyId = readStringField(policy, "oss_access_key_id");
  const signature = readStringField(policy, "signature");
  const encodedPolicy = readStringField(policy, "policy");
  const objectAcl = readStringField(policy, "x_oss_object_acl");
  const forbidOverwrite = readStringField(policy, "x_oss_forbid_overwrite");
  if (!uploadDirectory || uploadDirectory.split("/").some((segment) => !segment || segment === "." || segment === "..") || !accessKeyId || !signature || !encodedPolicy || !objectAcl || !forbidOverwrite) {
    throw new ApiError(502, "bailian_upload_policy_invalid", "Alibaba Model Studio returned an incomplete temporary upload policy.");
  }

  const extension = extname(source.relativePath).toLowerCase();
  const fileName = `${randomUUID()}${extension}`;
  const objectKey = `${uploadDirectory}/${fileName}`;
  const form = new FormData();
  form.append("OSSAccessKeyId", accessKeyId);
  form.append("Signature", signature);
  form.append("policy", encodedPolicy);
  form.append("x-oss-object-acl", objectAcl);
  form.append("x-oss-forbid-overwrite", forbidOverwrite);
  form.append("key", objectKey);
  form.append("success_action_status", "200");
  form.append("file", new Blob([Uint8Array.from(bytes)], { type: "application/octet-stream" }), fileName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BAILIAN_REQUEST_TIMEOUT_MS);
  try {
    const response = await mediaProviderFetch(uploadHost, { method: "POST", body: form, signal: controller.signal });
    if (!response.ok) {
      throw new ApiError(response.status, "bailian_temporary_upload_failed", `Alibaba Model Studio temporary storage rejected the audio upload (HTTP ${response.status}).`);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "bailian_temporary_upload_timeout", "Alibaba Model Studio temporary storage did not finish the upload in time.");
    }
    throw new ApiError(502, "bailian_temporary_upload_failed", "Could not upload the audio to Alibaba Model Studio temporary storage.");
  } finally {
    clearTimeout(timeout);
  }
  return `oss://${objectKey}`;
}

type TranslationResult = {
  text: string;
  audioChunks?: string[];
  usage?: unknown;
};

async function requestTranslation(input: {
  apiKey: string;
  baseUrl: string;
  fileUrl: string;
  fileType: "audio" | "video";
  format: string;
  sourceLanguage: string;
  targetLanguage: string;
  includeAudio: boolean;
  voice: string;
}): Promise<TranslationResult> {
  const content = input.fileType === "video"
    ? [{ type: "video_url", video_url: { url: input.fileUrl } }]
    : [{ type: "input_audio", input_audio: { data: input.fileUrl, format: input.format } }];
  const body: JsonRecord = {
    model: "qwen3-livetranslate-flash",
    messages: [{ role: "user", content }],
    modalities: input.includeAudio ? ["text", "audio"] : ["text"],
    stream: true,
    stream_options: { include_usage: true },
    translation_options: {
      ...(input.sourceLanguage ? { source_lang: input.sourceLanguage } : {}),
      target_lang: input.targetLanguage,
    },
    ...(input.includeAudio ? { audio: { voice: input.voice, format: "wav" } } : {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BAILIAN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await mediaProviderFetch(endpoint(input.baseUrl, "/compatible-mode/v1/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "bailian_timeout", "Alibaba Model Studio translation did not finish before the request timed out.");
    }
    throw new ApiError(502, "bailian_unreachable", "Could not reach Alibaba Model Studio. Check the network and try again.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new ApiError(response.status, "bailian_translation_failed", providerMessage(payload) || `Alibaba Model Studio translation failed (HTTP ${response.status}).`);
  }

  const raw = await response.text();
  let text = "";
  const audioChunks: string[] = [];
  let audioLength = 0;
  let usage: unknown;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (!isRecord(payload)) continue;
    if (payload.usage !== undefined) usage = payload.usage;
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      if (!isRecord(choice) || !isRecord(choice.delta)) continue;
      const contentDelta = choice.delta.content;
      if (typeof contentDelta === "string") text += contentDelta;
      const audio = isRecord(choice.delta.audio) ? choice.delta.audio : null;
      const audioData = typeof audio?.data === "string" ? audio.data : "";
      if (!audioData) continue;
      audioLength += audioData.length;
      if (audioLength > MAX_TRANSLATION_AUDIO_CHARS) {
        throw new ApiError(413, "bailian_translation_audio_too_large", "Translated audio exceeded the local response limit. Request text only or split the input file.");
      }
      audioChunks.push(audioData);
    }
  }
  return {
    text,
    ...(input.includeAudio ? { audioChunks } : {}),
    ...(usage === undefined ? {} : { usage }),
  };
}

function asMediaTask(action: string, payload: unknown): JsonRecord {
  const taskId = taskIdFromPayload(payload);
  return {
    action,
    ...(taskId ? { taskId } : {}),
    providerResponse: payload,
  };
}

export async function bailianMediaStatus(env: EnvService) {
  try {
    const { apiKey, baseUrl } = await resolveBailianCredentials(env);
    return { configured: Boolean(apiKey), connected: Boolean(apiKey), baseUrl, error: null };
  } catch (error) {
    return {
      configured: false,
      connected: false,
      baseUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function callMediaExtensionAction(
  config: ServerConfig,
  env: EnvService,
  action: string,
  args: JsonRecord,
  context: JsonRecord,
) {
  if (action === "status") {
    return {
      ok: true,
      extensionId: MEDIA_EXTENSION_ID,
      action,
      result: {
        provider: "aliyun-bailian",
        operation: action,
        output: await bailianMediaStatus(env),
      },
      context,
    };
  }

  if (action === "voiceover_timeline_validate") {
    const workspace = workspaceForContext(config, context);
    const source = resolveWorkspaceFile(workspace.path, requireString(args, "sourcePath"));
    if (extname(source.absolutePath).toLowerCase() !== ".html") {
      throw new ApiError(400, "invalid_voiceover_timeline_path", "sourcePath must use the .html extension.");
    }
    const sourceDirectory = posix.dirname(source.relativePath);
    const assetsDirectory = sourceDirectory === "." ? "assets" : `${sourceDirectory}/assets`;
    const mediaAssets = await listWorkspaceAssets(workspace.path, assetsDirectory, (path) => /\.(?:mp3|wav|m4a|aac|ogg|flac)$/i.test(path));
    const voiceoverAssets = mediaAssets.filter(isVoiceoverAssetPath);
    const requirementInput = readRecord(args, "requirements");
    const output = validateVoiceoverTimelineHtml(await readFile(source.absolutePath, "utf8"), {
      voiceoverAssets,
      mediaAssets,
      requirements: {
        voiceover: readOptionalBoolean(requirementInput, "voiceover") === true,
        captions: readOptionalBoolean(requirementInput, "captions") === true,
        captionStyle: readStringField(requirementInput, "captionStyle") === "custom" ? "custom" : "transparent-bottom",
        bgm: readOptionalBoolean(requirementInput, "bgm") === true,
        animationReferences: readStringArray(requirementInput, "animationReferences"),
        targetDurationSeconds: readOptionalNumber(requirementInput, "targetDurationSeconds") ?? undefined,
      },
    });
    return {
      ok: true,
      extensionId: MEDIA_EXTENSION_ID,
      action,
      result: {
        provider: "local",
        operation: action,
        output: { sourcePath: source.relativePath, ...output },
      },
      context,
    };
  }

  if (readStringField(args, "provider") === "minimax") {
    if (action !== "video_generate" && action !== "task_get") {
      throw new ApiError(400, "unsupported_minimax_media_action", "MiniMax is not configured for this Media Center action.");
    }
    const region = readStringField(args, "region") || "global_en";
    const apiKey = await resolveMiniMaxCredentials(env);
    let apiVersion: string;
    let providerResponse: unknown;
    if (action === "video_generate") {
      const model = readStringField(args, "model") || MINIMAX_IMAGE_TO_VIDEO_MODELS.defaultModel;
      apiVersion = miniMaxImageToVideoApiVersion(model);
      const endpoint = miniMaxImageToVideoEndpoint(region, apiVersion);
      providerResponse = await requestMiniMaxVideo({
        apiKey,
        url: endpoint.url,
        body: miniMaxImageToVideoBody(args, model, apiVersion),
      });
    } else {
      apiVersion = readStringField(args, "apiVersion") || "v2";
      const taskId = requireString(args, "taskId");
      if (!/^[A-Za-z0-9_-]+$/.test(taskId)) {
        throw new ApiError(400, "invalid_payload", "taskId contains unsupported characters");
      }
      const endpoint = miniMaxImageToVideoEndpoint(region, apiVersion);
      const queryUrl = apiVersion === "v2"
        ? `${new URL(endpoint.url).origin}/v2/query/video_generation/${encodeURIComponent(taskId)}`
        : `${new URL(endpoint.url).origin}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`;
      providerResponse = await requestMiniMaxVideo({ apiKey, url: queryUrl, method: "GET" });
    }
    const result = asMediaTask(action, providerResponse);
    return {
      ok: true,
      extensionId: MEDIA_EXTENSION_ID,
      action,
      result: {
        provider: "minimax",
        apiVersion,
        operation: action,
        ...(typeof result.taskId === "string" ? { taskId: result.taskId } : {}),
        output: result,
      },
      context,
    };
  }

  const { apiKey, baseUrl } = await resolveBailianCredentials(env);
  let result: unknown;
  switch (action) {
    case "speech_synthesize": {
      const text = requireString(args, "text");
      const model = readStringField(args, "model") || COSYVOICE_V3_FLASH;
      const voice = readStringField(args, "voice");
      const input: JsonRecord = {
        text,
        ...(voice ? { voice: compatibleCosyVoiceVoice(model, voice) } : {}),
        ...(readStringField(args, "format") ? { format: readStringField(args, "format") } : {}),
        ...(readOptionalNumber(args, "sampleRate") ? { sample_rate: readOptionalNumber(args, "sampleRate") } : {}),
      };
      result = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, "/api/v1/services/audio/tts/SpeechSynthesizer"),
        body: { model, input },
      });
      break;
    }
    case "speech_synthesize_workspace_file": {
      const parsedScene = workspaceVoiceoverSceneInput(args);
      const compositionPath = readStringField(args, "compositionPath");
      if (compositionPath && extname(compositionPath).toLowerCase() !== ".html") {
        throw new ApiError(400, "invalid_voiceover_composition_path", "compositionPath must use the .html extension.");
      }
      const model = readStringField(args, "model") || COSYVOICE_V3_FLASH;
      const requestedVoice = readStringField(args, "voice");
      const voice = requestedVoice ? compatibleCosyVoiceVoice(model, requestedVoice) : "";
      const composition = compositionPath
        ? resolveWorkspaceFile(workspaceForContext(config, context).path, compositionPath).relativePath
        : undefined;
      const scene = scopeVoiceoverSceneToComposition(parsedScene, composition);
      const synthesized = await synthesizeWorkspaceVoiceover({
        config,
        context,
        apiKey,
        baseUrl,
        scene,
        model,
        voice,
        sampleRate: readOptionalNumber(args, "sampleRate"),
      });
      result = workspaceVoiceoverResult(synthesized, composition, scene.sceneStart);
      break;
    }
    case "speech_synthesize_workspace_batch": {
      const rawScenes = Array.isArray(args.scenes) ? args.scenes : [];
      if (rawScenes.length < 1 || rawScenes.length > MAX_VOICEOVER_BATCH_SCENES) {
        throw new ApiError(400, "invalid_voiceover_batch", `scenes must contain between 1 and ${MAX_VOICEOVER_BATCH_SCENES} items.`);
      }
      const compositionPath = readStringField(args, "compositionPath");
      if (compositionPath && extname(compositionPath).toLowerCase() !== ".html") {
        throw new ApiError(400, "invalid_voiceover_composition_path", "compositionPath must use the .html extension.");
      }
      const workspace = workspaceForContext(config, context);
      const composition = compositionPath
        ? resolveWorkspaceFile(workspace.path, compositionPath).relativePath
        : undefined;
      const scenes = rawScenes
        .map(workspaceVoiceoverSceneInput)
        .map((scene) => scopeVoiceoverSceneToComposition(scene, composition));
      if (new Set(scenes.map((scene) => scene.sceneId)).size !== scenes.length) {
        throw new ApiError(400, "duplicate_voiceover_scene", "Each batch sceneId must be unique.");
      }
      if (new Set(scenes.map((scene) => scene.outputPath)).size !== scenes.length) {
        throw new ApiError(400, "duplicate_voiceover_output", "Each batch outputPath must be unique.");
      }
      if (scenes.some((scene, index) => index > 0 && scene.sceneStart < scenes[index - 1]!.sceneStart)) {
        throw new ApiError(400, "unordered_voiceover_scenes", "Batch scenes must be ordered by sceneStart.");
      }
      let estimatedShiftSeconds = 0;
      let estimatedTimelineEndSeconds = 0;
      for (const scene of scenes) {
        const estimatedStart = scene.sceneStart + estimatedShiftSeconds;
        const estimatedTiming = planSceneVoiceoverTiming(
          estimatedStart,
          scene.sceneDuration,
          estimateVoiceoverDurationSeconds(scene.text),
        );
        estimatedShiftSeconds = roundVoiceoverTime(estimatedShiftSeconds + estimatedTiming.shiftFollowingBySeconds);
        estimatedTimelineEndSeconds = Math.max(
          estimatedTimelineEndSeconds,
          estimatedStart + estimatedTiming.requiredSceneDurationSeconds,
        );
      }
      estimatedTimelineEndSeconds = roundVoiceoverTime(estimatedTimelineEndSeconds);
      const targetDurationSeconds = readOptionalNumber(args, "targetDurationSeconds");
      if (targetDurationSeconds !== undefined && targetDurationSeconds <= 0) {
        throw new ApiError(400, "invalid_voiceover_target_duration", "targetDurationSeconds must be greater than zero.");
      }
      if (targetDurationSeconds !== undefined && estimatedTimelineEndSeconds > targetDurationSeconds + 1) {
        throw new ApiError(
          400,
          "voiceover_target_duration_exceeded",
          `Narration is estimated to require ${estimatedTimelineEndSeconds} seconds, exceeding the requested ${targetDurationSeconds} seconds. Preserve the important page facts, but compact the narration before synthesis.`,
        );
      }
      const model = readStringField(args, "model") || COSYVOICE_V3_FLASH;
      const requestedVoice = readStringField(args, "voice");
      const voice = requestedVoice ? compatibleCosyVoiceVoice(model, requestedVoice) : "";
      const sampleRate = readOptionalNumber(args, "sampleRate");
      const created: SynthesizedWorkspaceVoiceover[] = [];
      let synthesizedScenes: SynthesizedWorkspaceVoiceover[];
      try {
        synthesizedScenes = await mapWithConcurrency(scenes, VOICEOVER_BATCH_CONCURRENCY, async (scene) => {
          const synthesized = await synthesizeWorkspaceVoiceover({
            config,
            context,
            apiKey,
            baseUrl,
            scene,
            model,
            voice,
            sampleRate,
          });
          created.push(synthesized);
          return synthesized;
        });
      } catch (error) {
        await Promise.all(created.map((item) => rm(item.absolutePath, { force: true })));
        throw error;
      }
      let cumulativeShiftSeconds = 0;
      const items = synthesizedScenes.map((synthesized) => {
        const startSeconds = synthesized.scene.sceneStart + cumulativeShiftSeconds;
        const item = workspaceVoiceoverResult(synthesized, composition, startSeconds);
        cumulativeShiftSeconds = roundVoiceoverTime(cumulativeShiftSeconds + item.timing.shiftFollowingBySeconds);
        return { ...item, cumulativeShiftAfterSeconds: cumulativeShiftSeconds };
      });
      result = {
        items,
        sceneCount: items.length,
        estimatedTimelineDurationSeconds: estimatedTimelineEndSeconds,
        totalShiftSeconds: cumulativeShiftSeconds,
        rootDurationMustBeAtLeastSeconds: roundVoiceoverTime(items.reduce(
          (maximum, item) => Math.max(maximum, item.timelinePatch.rootDurationMustBeAtLeastSeconds),
          0,
        )),
        model,
        ...(voice ? { voice } : {}),
      };
      break;
    }
    case "voice_clone": {
      result = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, "/api/v1/services/audio/tts/customization"),
        body: {
          model: "voice-enrollment",
          input: {
            action: "create_voice",
            target_model: readStringField(args, "targetModel") || "cosyvoice-v3-flash",
            prefix: requireString(args, "prefix"),
            url: requireString(args, "audioUrl"),
            ...(readStringArray(args, "languageHints").length ? { language_hints: readStringArray(args, "languageHints") } : {}),
          },
        },
      });
      break;
    }
    case "voice_list": {
      const pageIndex = boundedInteger(args, "pageIndex", 0, 0, 10_000);
      const pageSize = boundedInteger(args, "pageSize", 100, 1, 100);
      const providerResponse = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, "/api/v1/services/audio/tts/customization"),
        body: {
          model: "voice-enrollment",
          input: {
            action: "list_voice",
            page_index: pageIndex,
            page_size: pageSize,
          },
        },
      });
      const output = readRecord(providerResponse, "output");
      result = {
        items: voiceListFromPayload(providerResponse),
        pageIndex: readOptionalNumber(output, "page_index") ?? pageIndex,
        pageSize: readOptionalNumber(output, "page_size") ?? pageSize,
        totalCount: readOptionalNumber(output, "total_count") ?? null,
      };
      break;
    }
    case "voice_clone_workspace_file": {
      const sourcePath = requireString(args, "sourcePath");
      if (!/\.(?:m4a|mp3|wav)$/i.test(extname(sourcePath))) {
        throw new ApiError(400, "invalid_voice_sample", "Voice samples must be WAV, MP3, or M4A files.");
      }
      const targetModel = readStringField(args, "targetModel") || "cosyvoice-v3-flash";
      const createVoice = (audioUrl: string, headers?: Record<string, string>) => requestProviderJson({
          apiKey,
          url: endpoint(baseUrl, "/api/v1/services/audio/tts/customization"),
          ...(headers ? { headers } : {}),
          body: {
            model: "voice-enrollment",
            input: {
              action: "create_voice",
              target_model: targetModel,
              prefix: `ipw${Date.now().toString(36).slice(-7)}`,
              url: audioUrl,
              ...(readStringArray(args, "languageHints").length ? { language_hints: readStringArray(args, "languageHints") } : {}),
            },
          },
        });
      let providerResponse: unknown;
      try {
        providerResponse = await withTemporaryWorkspaceObject({
          config,
          env,
          context,
          sourcePath,
          purpose: "voice-clone",
          maxBytes: 10 * 1024 * 1024,
          use: (audioUrl) => createVoice(audioUrl),
        });
      } catch (error) {
        const storageIsMissing = error instanceof ApiError
          && (error.code === "storage_not_configured" || error.code === "storage_provider_not_configured");
        if (!storageIsMissing) throw error;
        const audioUrl = await uploadWorkspaceFileToBailianTemporaryStorage({
          config,
          apiKey,
          baseUrl,
          context,
          sourcePath,
          maxBytes: 10 * 1024 * 1024,
        });
        providerResponse = await createVoice(audioUrl, { "X-DashScope-OssResourceResolve": "enable" });
      }
      const voiceId = voiceIdFromPayload(providerResponse);
      if (!voiceId) throw new ApiError(502, "voice_clone_failed", "Alibaba Model Studio did not return a reusable voice ID.");
      result = { voiceId, model: targetModel };
      break;
    }
    case "speech_transcribe": {
      result = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, "/api/v1/services/audio/asr/transcription"),
        headers: { "X-DashScope-Async": "enable" },
        body: {
          model: readStringField(args, "model") || "fun-asr",
          input: { file_urls: [requireString(args, "fileUrl")] },
          ...(Object.keys(readRecord(args, "parameters")).length ? { parameters: readRecord(args, "parameters") } : {}),
        },
      });
      result = asMediaTask(action, result);
      break;
    }
    case "speech_recognize_realtime": {
      result = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, "/api/v1/services/aigc/multimodal-generation/generation"),
        headers: { "X-DashScope-SSE": "disable" },
        body: {
          model: "fun-asr-realtime",
          input: { messages: [] },
          parameters: {
            audio_address: requireString(args, "audioUrl"),
            format: requireString(args, "format"),
          },
          resources: [],
        },
      });
      break;
    }
    case "speech_translate": {
      result = await requestTranslation({
        apiKey,
        baseUrl,
        fileUrl: requireString(args, "fileUrl"),
        fileType: readStringField(args, "fileType") === "video" ? "video" : "audio",
        format: readStringField(args, "format") || "wav",
        sourceLanguage: readStringField(args, "sourceLanguage"),
        targetLanguage: requireString(args, "targetLanguage"),
        includeAudio: readOptionalBoolean(args, "includeAudio") === true,
        voice: readStringField(args, "voice") || "Cherry",
      });
      break;
    }
    case "video_generate": {
      result = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, "/api/v1/services/aigc/video-generation/video-synthesis"),
        headers: { "X-DashScope-Async": "enable" },
        body: {
          model: readStringField(args, "model") || "wan2.6-t2v",
          input: {
            prompt: requireString(args, "prompt"),
            ...(readStringField(args, "imageUrl") ? { img_url: readStringField(args, "imageUrl") } : {}),
            ...(readStringField(args, "audioUrl") ? { audio_url: readStringField(args, "audioUrl") } : {}),
          },
          ...(Object.keys(readRecord(args, "parameters")).length ? { parameters: readRecord(args, "parameters") } : {}),
        },
      });
      result = asMediaTask(action, result);
      break;
    }
    case "video_edit": {
      result = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, "/api/v1/services/aigc/video-generation/video-synthesis"),
        headers: { "X-DashScope-Async": "enable" },
        body: {
          model: requireString(args, "model"),
          input: readRecord(args, "input"),
          ...(Object.keys(readRecord(args, "parameters")).length ? { parameters: readRecord(args, "parameters") } : {}),
        },
      });
      result = asMediaTask(action, result);
      break;
    }
    case "digital_human_generate": {
      result = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, "/api/v1/services/aigc/image2video/video-synthesis"),
        headers: { "X-DashScope-Async": "enable" },
        body: {
          model: "wan2.2-s2v",
          input: {
            image_url: requireString(args, "imageUrl"),
            audio_url: requireString(args, "audioUrl"),
          },
          ...(Object.keys(readRecord(args, "parameters")).length ? { parameters: readRecord(args, "parameters") } : {}),
        },
      });
      result = asMediaTask(action, result);
      break;
    }
    case "task_get": {
      const taskId = requireString(args, "taskId");
      if (!/^[A-Za-z0-9_-]+$/.test(taskId)) {
        throw new ApiError(400, "invalid_payload", "taskId contains unsupported characters");
      }
      result = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, `/api/v1/tasks/${encodeURIComponent(taskId)}`),
        method: "GET",
      });
      break;
    }
    default:
      return null;
  }

  return {
    ok: true,
    extensionId: MEDIA_EXTENSION_ID,
    action,
    result: {
      provider: "aliyun-bailian",
      operation: action,
      ...(isRecord(result) && typeof result.taskId === "string" ? { taskId: result.taskId } : {}),
      output: result,
    },
    context,
  };
}
