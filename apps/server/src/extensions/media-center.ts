import { readiPolloWorkWorkspaceConfig, writeiPolloWorkWorkspaceConfig } from "../ipollowork-workspace-config-store.js";
import { ApiError, isApiError } from "../errors.js";
import { repairVideoTimelineRegistry, validateVideoHtmlScripts, validateVideoScriptAssets } from "../video-html-validation.js";
import type { AuthorizationAccess } from "../authorization-center.js";
import { providerFetch } from "../provider-fetch.js";
import type { ServerConfig } from "../types.js";
import type { VideoDeliveryRequirements } from "@ipollowork/types/hyperframes-project";
import { link, mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, dirname, extname, posix } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resolveWorkspaceFile, withTemporaryWorkspaceObject, workspaceForContext } from "./storage.js";
import { resolveWithinRoot } from "../paths.js";
import { checkVideoComponents, installVideoComponents } from "./video-components.js";
import { z } from "zod";
import { analyzeVideoMusic, prepareVideoSoundtrack, prepareVideoLanguageTiming, videoSoundtrackInput, videoLanguageTimingInput } from "./video-audio-analysis.js";
import { videoRenderAction, analyzeVideoReference, videoRenderInput, videoReferenceInput } from "./video-render.js";
import { queryVideoRecipeCatalog } from "../hyperframes-catalog.js";

// The Alibaba adapter stays internal to this module. The public action
// contract is provider-neutral so Media Center can add providers without
// changing app or OpenCode integration code.
export const MEDIA_EXTENSION_ID = "media";

const DEFAULT_ALIYUN_MEDIA_BASE_URL = "https://dashscope.aliyuncs.com";
const BAILIAN_REQUEST_TIMEOUT_MS = 90_000;
const MAX_TRANSLATION_AUDIO_CHARS = 16 * 1024 * 1024;
const MAX_SYNTHESIZED_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_VOICEOVER_BATCH_SCENES = 3;
const VOICEOVER_BATCH_CONCURRENCY = 3;
const MAX_VOICEOVER_AUDIO_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_VOICEOVER_AUDIO_CACHE_ENTRIES = 128;
const COSYVOICE_V3_FLASH = "cosyvoice-v3-flash";
const DEFAULT_COSYVOICE_V3_FLASH_VOICE = "longanyang";
const VOICEOVER_READING_BUFFER_SECONDS = 0.25;
const LEGACY_COSYVOICE_V3_PRESET_MIGRATIONS: Record<string, string> = {
  longxiaochun: "longyingmu_v3",
  longxiaoxia: "longyingmu_v3",
  longwan: "longyingmu_v3",
  longwanwan: "longanhuan_v3",
  longlaotie: "longanlang_v3",
  longfei: "longanlang_v3",
};

type JsonRecord = Record<string, unknown>;

type VoiceoverWordTiming = {
  text: string;
  beginIndex: number;
  endIndex: number;
  startSeconds: number;
  endSeconds: number;
};

type CachedVoiceover = { audio: Buffer; wordTimings: VoiceoverWordTiming[]; alignmentIssues?: string[] };

const voiceoverAudioCache = new Map<string, CachedVoiceover>();
const voiceoverAudioRequests = new Map<string, Promise<CachedVoiceover>>();
let voiceoverAudioCacheBytes = 0;

function voiceoverAudioCacheKey(input: {
  apiKey: string;
  baseUrl: string;
  text: string;
  model: string;
  voice: string;
  sampleRate?: number;
  rate: number;
  pitch: number;
  volume: number;
  instruction: string;
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
    .update(String(input.rate))
    .update("\0")
    .update(String(input.pitch))
    .update("\0")
    .update(String(input.volume))
    .update("\0")
    .update(input.instruction)
    .update("\0")
    .update(input.text)
    .digest("hex");
}

function readCachedVoiceoverAudio(key: string) {
  const cached = voiceoverAudioCache.get(key);
  if (!cached) return null;
  voiceoverAudioCache.delete(key);
  voiceoverAudioCache.set(key, cached);
  return cached;
}

function cacheVoiceoverAudio(key: string, cached: CachedVoiceover) {
  if (cached.audio.byteLength > MAX_VOICEOVER_AUDIO_CACHE_BYTES) return;
  const existing = voiceoverAudioCache.get(key);
  if (existing) voiceoverAudioCacheBytes -= existing.audio.byteLength;
  voiceoverAudioCache.delete(key);
  voiceoverAudioCache.set(key, cached);
  voiceoverAudioCacheBytes += cached.audio.byteLength;
  while (
    voiceoverAudioCache.size > MAX_VOICEOVER_AUDIO_CACHE_ENTRIES
    || voiceoverAudioCacheBytes > MAX_VOICEOVER_AUDIO_CACHE_BYTES
  ) {
    const oldest = voiceoverAudioCache.entries().next().value;
    if (!oldest) break;
    voiceoverAudioCache.delete(oldest[0]);
    voiceoverAudioCacheBytes -= oldest[1].audio.byteLength;
  }
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
  model: string;
  voice: string;
  controls: SpeechSynthesisControls;
}) {
  return [
    `<audio id="${escapeHtmlAttribute(input.id)}"`,
    `src="${escapeHtmlAttribute(input.sourcePath)}"`,
    `data-ipw-voiceover="true"`,
    `data-ipw-voice="${escapeHtmlAttribute(input.voice)}"`,
    `data-ipw-voice-model="${escapeHtmlAttribute(input.model)}"`,
    `data-ipw-voice-rate="${input.controls.rate}"`,
    `data-ipw-voice-pitch="${input.controls.pitch}"`,
    `data-ipw-voice-volume="${input.controls.volume}"`,
    `data-ipw-voice-instruction="${escapeHtmlAttribute(input.controls.instruction)}"`,
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
  // Keep offsets into the original HTML, but ignore examples and strings that
  // do not create DOM timeline clips.
  const markup = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (match) => " ".repeat(match.length));
  return Array.from(markup.matchAll(/<(?!\/|!)([a-zA-Z][\w:-]*)\b([^>]*)>/g), (match) => {
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

async function workspaceAssetHash(root: string, relativePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(resolveWorkspaceFile(root, relativePath).absolutePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function musicDuplicatesNarration(
  root: string,
  sourceDirectory: string,
  musicAsset: string,
  mediaAssets: string[],
  voiceoverAssets: string[],
) {
  const normalized = musicAsset.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  const musicPath = mediaAssets.find((path) => path === normalized || path === posix.normalize(posix.join(sourceDirectory, normalized)));
  if (!musicPath) return false;
  const musicSize = (await stat(resolveWorkspaceFile(root, musicPath).absolutePath)).size;
  const sameSizeVoiceovers: string[] = [];
  for (const path of voiceoverAssets) {
    if (path === musicPath) return true;
    if ((await stat(resolveWorkspaceFile(root, path).absolutePath)).size === musicSize) sameSizeVoiceovers.push(path);
  }
  if (sameSizeVoiceovers.length === 0) return false;
  const musicHash = await workspaceAssetHash(root, musicPath);
  for (const path of sameSizeVoiceovers) {
    if (await workspaceAssetHash(root, path) === musicHash) return true;
  }
  return false;
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

/** Read narration attached to the composition rather than unused audio assets. */
export function avatarTimelineContext(html: string) {
  const source = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const clips = timelineNodes(source).flatMap(node => {
    const attrs = node.attributes;
    const src = decodeHtmlText(attrs.get("src") ?? "");
    const id = attrs.get("id") ?? "";
    if (node.tagName !== "audio" || !(attrs.get("data-ipw-voiceover") === "true" || id === "voiceover" || id.startsWith("vo-") || id.startsWith("narration-") || isVoiceoverSource(src))) return [];
    const volume = finiteTimelineNumber(node, "data-volume") ?? 1;
    if (volume === 0 || /\bmuted(?:\s|=|>)/i.test(source.slice(source.lastIndexOf("<", node.contentStart - 1), node.contentStart))) return [];
    return [{ id, sceneId: attrs.get("data-ipw-scene-id") ?? "", voiceId: attrs.get("data-ipw-voice") ?? "",
      src, start: finiteTimelineNumber(node, "data-start"), duration: finiteTimelineNumber(node, "data-duration"),
      offset: finiteTimelineNumber(node, "data-media-start") ?? finiteTimelineNumber(node, "data-playback-start") ?? 0, volume }];
  });
  return { content: visibleTextFromHtml(source).slice(0, 4000), clips };
}

type StoryboardDeliveryFrame = { durationSeconds: number; voiceover: string; transitionIn?: string };
type StoryboardDeliveryPlan = { music: { prompt: string; asset: string }; frames: StoryboardDeliveryFrame[] };

// Read only delivery-owned fields using the canonical storyboard's first-colon
// and paired-quote rules; authoring remains owned by the shared storyboard parser.
async function readStoryboardDeliveryPlan(path: string): Promise<StoryboardDeliveryPlan | undefined> {
  const file = await open(path, "r").catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  });
  if (!file) return undefined;
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").trimStart().split(/\r?\n/);
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (lines[0]?.trim() !== "---" || end < 0) throw new ApiError(400, "invalid_storyboard_music_plan", "STORYBOARD.md needs a closed frontmatter block within its first 256 KiB and an explicit music_prompt decision.");
    const plan: StoryboardDeliveryPlan = { music: { prompt: "", asset: "" }, frames: [] };
    for (const line of lines.slice(1, end)) {
      const colon = line.indexOf(":");
      const key = line.slice(0, colon).trim().toLowerCase().replace(/_/g, "");
      if (colon < 0 || (key !== "musicprompt" && key !== "musicasset")) continue;
      const value = line.slice(colon + 1).trim();
      plan.music[key === "musicprompt" ? "prompt" : "asset"] = /^("[\s\S]*"|'[\s\S]*')$/.test(value) ? value.slice(1, -1) : value;
    }
    let frame: Partial<StoryboardDeliveryFrame> | null = null;
    for (const line of lines.slice(end + 1)) {
      if (/^##\s+Frame\s+\d+\b/i.test(line.trim())) {
        if (frame?.durationSeconds != null) plan.frames.push({ ...frame, durationSeconds: frame.durationSeconds, voiceover: frame.voiceover ?? "" });
        frame = {};
        continue;
      }
      if (!frame) continue;
      const match = /^\s*-\s*(duration|voiceover|transition_in)\s*:\s*(.*)$/i.exec(line);
      if (!match) continue;
      const value = match[2]!.trim().replace(/^("([\s\S]*)"|'([\s\S]*)')$/, "$2$3");
      if (match[1]!.toLowerCase() === "duration") {
        const duration = /^(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?$/i.exec(value);
        if (duration) frame.durationSeconds = Number(duration[1]);
      } else if (match[1]!.toLowerCase() === "transition_in") frame.transitionIn = value;
      else frame.voiceover = value;
    }
    if (frame?.durationSeconds != null) plan.frames.push({ ...frame, durationSeconds: frame.durationSeconds, voiceover: frame.voiceover ?? "" });
    return plan;
  } finally { await file.close(); }
}

export function validateVoiceoverTimelineHtml(html: string, options: {
  voiceoverAssets?: string[];
  mediaAssets?: string[];
  musicPlan?: { prompt: string; asset: string };
  sourceDirectory?: string;
  storyboardFrames?: StoryboardDeliveryFrame[];
  requirements?: Partial<VideoDeliveryRequirements>;
} = {}) {
  const epsilon = 0.001;
  const issues: VoiceoverTimelineIssue[] = validateVideoHtmlScripts(html);
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
      transitionIn: node.attributes.get("data-ipw-transition-in") ?? "",
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
      const timelineRole = node.attributes.get("data-timeline-role") ?? "";
      if ((timelineRole === "music" || timelineRole === "sfx") && node.attributes.get("data-ipw-voiceover") !== "true") {
        return false;
      }
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
  const storyboardFrames = options.storyboardFrames;
  if (storyboardFrames) {
    if (storyboardFrames.length !== orderedScenes.length) {
      issues.push({
        code: "storyboard_scene_count_mismatch",
        message: `STORYBOARD.md defines ${storyboardFrames.length} frames, but index.html contains ${orderedScenes.length} timed scenes. Rebuild the composition from the current storyboard.`,
      });
    }
    const orderedVoiceovers = [...voiceovers]
      .filter((voiceover): voiceover is typeof voiceover & { start: number } => voiceover.start != null)
      .sort((left, right) => left.start - right.start);
    for (let index = 0; index < Math.min(storyboardFrames.length, orderedScenes.length); index += 1) {
      const frame = storyboardFrames[index]!;
      const scene = orderedScenes[index]!;
      if (index > 0 && frame.transitionIn && frame.transitionIn !== scene.transitionIn) {
        issues.push({ code: "storyboard_transition_mismatch", sceneId: scene.id, message: `Storyboard frame ${index + 1} requires ${frame.transitionIn}, but its rendered scene declares ${scene.transitionIn || "no transition"}. Apply the approved transition, do not silently replace it with a cut.` });
      }
      if (Math.abs(frame.durationSeconds - scene.duration) > 0.05) {
        issues.push({
          code: "storyboard_scene_duration_mismatch",
          message: `Storyboard frame ${index + 1} is ${frame.durationSeconds} seconds, but its rendered scene is ${scene.duration} seconds.`,
          ...(scene.id ? { sceneId: scene.id } : {}),
        });
      }
      const voiceover = orderedVoiceovers[index];
      if (frame.voiceover && (!voiceover || normalizeSceneText(decodeHtmlText(voiceover.sceneText)) !== normalizeSceneText(frame.voiceover))) {
        issues.push({
          code: "storyboard_voiceover_mismatch",
          message: `Storyboard frame ${index + 1} narration does not match the synthesized narration metadata in index.html.`,
          ...(scene.id ? { sceneId: scene.id } : {}),
        });
      }
    }
  }
  const captions = nodes.filter((node) => node.attributes.get("data-ipw-caption") === "true");
  const bgmNodes = nodes.filter((node) => node.tagName === "audio"
    && (node.attributes.has("data-timeline-role")
      ? node.attributes.get("data-timeline-role") === "music"
      : node.attributes.get("data-ipw-bgm") === "true"));
  const sfxNodes = nodes.filter((node) => node.tagName === "audio" && node.attributes.get("data-timeline-role") === "sfx");
  const explicitlyNonNarrationSources = new Set(
    [...bgmNodes, ...sfxNodes]
      .filter(node => node.attributes.get("data-ipw-voiceover") !== "true")
      .map(node => decodeHtmlText(node.attributes.get("src") ?? "").replace(/\\/g, "/").replace(/^\.\//, ""))
      .filter(Boolean),
  );
  const musicPlan = options.musicPlan;
  if (musicPlan) {
    const prompt = musicPlan.prompt.trim();
    const silent = prompt.toLowerCase() === "none";
    const asset = musicPlan.asset.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    const mounted = bgmNodes.map((node) => posix.normalize(posix.join(
      options.sourceDirectory ?? ".",
      decodeHtmlText(node.attributes.get("src") ?? "").replace(/\\/g, "/").replace(/^\.\//, ""),
    )));
    if (!musicPlan.prompt.trim()) {
      issues.push({ code: "music_plan_missing", message: "Set STORYBOARD.md music_prompt to a deliberate music direction, or none for an intentionally music-free video." });
    }
    if (!silent && /^none\b/i.test(prompt)) {
      issues.push({ code: "invalid_music_decision", message: "Use the exact music_prompt value none only for an intentionally music-free video; keep the explanation in the script body. Otherwise provide a real music direction and deliver its soundtrack." });
    }
    if (silent && (asset || mounted.length || options.requirements?.bgm)) {
      issues.push({ code: "music_plan_conflict", message: "STORYBOARD.md requests no background music, but the delivery requires background music, or music_asset/a music timeline clip is still present." });
    } else if (!silent) {
      if ((musicPlan.prompt.trim() || mounted.length) && !asset) {
        issues.push({ code: "music_asset_missing", message: "Choose appropriate music and write its actual project-relative path to STORYBOARD.md music_asset; do not leave the script out of sync with the video." });
      }
      if (asset && (mounted.length === 0 || mounted.some((source) => (
        source !== asset && posix.relative(options.sourceDirectory ?? ".", source) !== asset
      )))) {
        issues.push({ code: "music_asset_mismatch", message: "The music timeline must reference the exact music_asset selected in STORYBOARD.md." });
      }
      if (musicPlan.prompt.trim() && mounted.length === 0) {
        issues.push({ code: "planned_music_missing", message: "STORYBOARD.md has a music direction, but no background music is mounted on the timeline." });
      }
    }
  }
  const implementedAnimationReferences = new Set(
    nodes.flatMap((node) => (node.attributes.get("data-ipw-animation-reference") ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean)),
  );
  // A mounted registry component owns its native timeline. Count the
  // component itself as implemented so the delivery gate verifies actual
  // per-video mounting instead of requiring a duplicate marker in the nested
  // composition.
  for (const node of nodes) {
    if (node.attributes.get("data-ipw-registry-component") === "spatial-camera-suite"
      && node.attributes.get("data-composition-src")) {
      implementedAnimationReferences.add("spatial-camera-suite");
    }
  }
  const requirements = {
    ...options.requirements,
    bgm: options.requirements?.bgm || Boolean(musicPlan?.prompt.trim() && musicPlan.prompt.trim().toLowerCase() !== "none"),
  };
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
  const available = new Set((options.mediaAssets ?? []).map((asset) => asset.replace(/\\/g, "/").replace(/^\.\//, "")));
  for (const { requirement, role, clips } of [
    { requirement: "bgm", role: "music", clips: bgmNodes },
    { requirement: "sfx", role: "sfx", clips: sfxNodes },
  ] satisfies Array<{ requirement: "bgm" | "sfx"; role: string; clips: TimelineNode[] }>) {
    if (requirements[requirement] && clips.length === 0) {
      issues.push({ code: `required_${requirement}_missing`, message: `The user requested ${requirement.toUpperCase()}, but the timeline has no data-timeline-role="${role}" audio node.` });
    }
    let unmutedClips = 0;
    for (const clip of clips) {
      const source = decodeHtmlText(clip.attributes.get("src") ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
      const start = finiteTimelineNumber(clip, "data-start");
      const duration = finiteTimelineNumber(clip, "data-duration");
      const local = source.length > 0 && !/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(source) && !source.split("/").includes("..");
      const sourceExists = options.mediaAssets === undefined || available.has(source);
      if (!local || !sourceExists || start == null || start < 0 || duration == null || duration <= 0
        || (compositionDuration != null && start + duration > compositionDuration + epsilon)) {
        issues.push({ code: `invalid_${requirement}_timeline`, message: `${requirement.toUpperCase()} must reference an existing project-relative audio file with a positive duration and a window inside the composition.` });
      }
      const openingTag = html.slice(html.lastIndexOf("<", clip.contentStart - 1), clip.contentStart);
      if (!/\smuted(?:\s|=|\/?>)/i.test(openingTag)) unmutedClips += 1;
    }
    // Initial volume can legitimately be zero for a timeline-owned fade-in.
    // Sampled playback/export, not static source, proves the resulting level.
    if (requirements[requirement] && clips.length > 0 && unmutedClips === 0) {
      issues.push({ code: `inaudible_${requirement}`, message: `All requested ${requirement.toUpperCase()} clips are muted; timeline presence alone does not satisfy audible delivery.` });
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
  const referencedSources = referencedVoiceoverSources(html);
  for (const source of [...referencedSources]) {
    const fileName = source.split("/").pop() ?? source;
    if ([...explicitlyNonNarrationSources].some((candidate) => {
      const candidateFileName = candidate.split("/").pop() ?? candidate;
      return candidate === source || candidateFileName === fileName;
    })) {
      referencedSources.delete(source);
    }
  }
  if (referencedSources.size > voiceovers.length) {
    issues.push({
      code: "voiceover_assets_not_on_timeline",
      message: "Voiceover MP3 references exist outside HyperFrames audio timeline nodes. Insert each voiceover as <audio data-ipw-voiceover=\"true\" ...> with data-start/data-duration.",
    });
  }
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
  // Stale synthesis files do not require narration in a silent video. When
  // narration is requested or planned, the files must be mounted on the timeline.
  if (orphanAssets.length > 0 && referencedSources.size === 0
    && (options.requirements?.voiceover === true || options.storyboardFrames?.some(frame => Boolean(frame.voiceover)))) {
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
    sfxCount: sfxNodes.length,
    animationReferences: Array.from(implementedAnimationReferences),
    compositionDurationSeconds: compositionDuration,
    requiredDurationSeconds: roundVoiceoverTime(latestEnd + (voiceovers.length ? VOICEOVER_READING_BUFFER_SECONDS : 0)),
    issues,
  };
}

export const MEDIA_EXTENSION_ACTIONS = [
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "video_recipe_catalog",
    title: "Select video shot recipes",
    description: "Search all locally installable video recipes offline by narrative need or semantic pattern. recipes lists native and Shotcraft ports with exact componentId, narrative intent, useWhen and avoidWhen; recipeCategories gives available pattern counts. Choose by the audience outcome, not by visual effect alone. Imported Shotcraft cards also expose source/preview and full rules via up to three cardIds. Unported reference cards and previews are not bundled. Install only returned componentIds.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 200 }, category: { type: "string", maxLength: 64 },
        cardIds: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" } },
        offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 20 },
        includeMethodology: { type: "boolean", description: "Read the pinned production-methodology source for comparison. Active iPolloWork video.md and explicit user script-review requests remain authoritative." },
      },
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "video_audio_analyze",
    title: "Analyze Video Studio music",
    description: "Run the bundled HyperFrames beat detector for the active editable video project and return saved, reproducible cue times for audio-reactive motion. The project must contain a local audio element marked data-timeline-role=music.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Exact current composition path: video/<project-id>/index.html, relative to this workspace." },
      },
      required: ["sourcePath"],
      additionalProperties: false,
    },
  },
  ...[
    { action: "video_reference_analyze", title: "Measure reference video rhythm", description: "Decode a local reference in this video's assets. Return bounded motion/stillness curves and audio health; measurements support creative choices and do not judge meaning.", schema: videoReferenceInput },
    { action: "video_soundtrack_prepare", title: "Prepare event-synchronized sound", description: "Create editable local sound clips from locked film events and a shared room; return native GSAP music ducking envelopes for matching preview and export.", schema: videoSoundtrackInput },
    { action: "video_language_timing_prepare", title: "Map measured narration across languages", description: "Use exact provider word timing and explicit phrase pairs to map one authored composition into a second language. Return reversible anchors and root/child timeline integration; do not invent speech durations.", schema: videoLanguageTimingInput },
  ].map(({ action, title, description, schema }) => ({
    extensionId: MEDIA_EXTENSION_ID, action, title, description, inputSchema: z.toJSONSchema(schema, { io: "input" }),
  })),
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "video_component_install",
    title: "Install Video Studio components",
    description: "Install only the selected bundled HyperFrames registry components into the active editable video project. Use the returned data-composition-src snippets instead of recreating the component from memory or treating the component map as visual inspiration.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Exact current composition path: video/<project-id>/index.html, relative to this workspace." },
        componentIds: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }, description: "Registry component IDs selected from core-v1-video/motion/component-map.md." },
        motionStyle: { type: "string", enum: ["restrained", "balanced", "energetic"], description: "Choose one style for the whole video, not a different style per scene. The server compiles distance, emphasis scale, easing and event duration into installed recipes. Defaults to balanced." },
        mount: { type: "boolean", description: "Use true with complete instances to atomically fill matching empty section slots in index.html. Existing authored scenes and mounted hosts are never overwritten. Selection is recorded on the root even for preparation-only installs; selected but unmounted recipes fail delivery." },
        instances: { type: "array", minItems: 1, maxItems: 48, description: "Optional ready-to-mount semantic recipe scenes. Select by recipeSummary.intent/useWhen/avoidWhen, then read only the selected manifest's variables and motionRecipe.usage (intent, inputRules, readingOrder, cueBindings, fallback, acceptance). Each instance supplies sceneId, componentId, start, duration, timingSource, values (all real content variables), optional cueTimes (event IDs to measured scene-relative seconds), track, transition, transitionDuration and transitionIntent. The host validates capacity, assets and ordered cues, then returns escaped placeholder-free instances[].snippet without overwriting index.html.", items: {
          type: "object",
          properties: {
            sceneId: { type: "string" }, componentId: { type: "string" },
            start: { type: "number", minimum: 0 }, duration: { type: "number", exclusiveMinimum: 0, maximum: 120 },
            track: { type: "integer", minimum: 0 },
            values: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
            cueTimes: { type: "object", additionalProperties: { type: "number", minimum: 0 } },
            narration: { type: "object", description: "For measured speech, supply the validated timing sidecar, exact full narration text and an exact spoken phrase for EVERY active event. Do not also supply cueTimes. Ambiguous repeated phrases require occurrence (1-based). The server converts measured starts to 30fps cue times.", properties: {
              timingSourcePath: { type: "string" }, text: { type: "string" }, bindings: { type: "object", additionalProperties: { type: "object", properties: { phrase: { type: "string" }, occurrence: { type: "integer", minimum: 1 } }, required: ["phrase"], additionalProperties: false } },
            }, required: ["timingSourcePath", "text", "bindings"], additionalProperties: false },
            timingSource: { type: "string", enum: ["voiceover", "estimated-reading", "visual-cue", "music", "media"] },
            transition: { type: "string", enum: ["cut", "preset:element.enter.fade", "preset:element.enter.slide", "preset:element.enter.scale"] },
            transitionDuration: { type: "number", minimum: 0 },
            transitionIntent: { type: "string", enum: ["continue", "topic-change", "time-change", "location-change", "compare", "reveal", "closure"] },
          },
          required: ["sceneId", "componentId", "start", "duration", "timingSource", "values"],
          additionalProperties: false,
        } },
      },
      required: ["sourcePath", "componentIds"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "video_component_check",
    title: "Check Video Studio component reuse",
    description: "Verify that every substantive video scene either references an installed registry component with real variables and a motion pattern, or records a specific custom-composition reason. Run once before final video acceptance.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Exact current composition path: video/<project-id>/index.html, relative to this workspace." },
      },
      required: ["sourcePath"],
      additionalProperties: false,
    },
  },
  ...["video_render_start", "video_render_status"].map(action => ({
    extensionId: MEDIA_EXTENSION_ID, action,
    title: action === "video_render_start" ? "Export video to MP4" : "Read MP4 export progress",
    description: "Built-in local Video Studio MP4 export. No external CLI, npm package, manual Export click, or provider key. Start returns immediately with preparing/rendering; poll status using the SAME sourcePath and operationKey every 2 seconds. The app starts bundled Studio automatically. Complete returns outputPath for douyin-ops import-media. Failed returns the actual error; never publish a failed export or change operationKey to blindly retry.",
    inputSchema: z.toJSONSchema(videoRenderInput, { io: "input" }),
  })),
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
        rate: { type: "number", minimum: 0.5, maximum: 2, description: "Speech rate from 0.5 to 2. Defaults to 1." },
        pitch: { type: "number", minimum: 0.5, maximum: 2, description: "Speech pitch from 0.5 to 2. Defaults to 1." },
        volume: { type: "number", minimum: 0, maximum: 100, description: "Speech volume from 0 to 100. Defaults to 50." },
        instruction: { type: "string", maxLength: 100, description: "Optional CosyVoice v3 expression instruction supported by the selected voice." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "speech_synthesize_workspace_file",
    title: "Synthesize speech to a workspace file",
    description: "Built-in iPolloWork CosyVoice action. Create an MP3 voiceover without an external CLI, save provider word timings beside it, and return measured timing for video synchronization.",
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
        rate: { type: "number", minimum: 0.5, maximum: 2, description: "Speech rate from 0.5 to 2. Defaults to 1." },
        pitch: { type: "number", minimum: 0.5, maximum: 2, description: "Speech pitch from 0.5 to 2. Defaults to 1." },
        volume: { type: "number", minimum: 0, maximum: 100, description: "Speech volume from 0 to 100. Defaults to 50." },
        instruction: { type: "string", maxLength: 100, description: "Optional CosyVoice v3 expression instruction supported by the selected voice." },
      },
      required: ["text", "sceneId", "sceneText", "sceneStart", "sceneDuration", "outputPath"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "speech_synthesize_workspace_batch",
    title: "Synthesize scene voiceovers to workspace files",
    description: "Built-in iPolloWork CosyVoice action. Without installing an external CLI, synthesize at most three scenes per call concurrently. Save each returned batch before requesting the next; carry its totalShiftSeconds into later sceneStart values. Retry the SAME output paths after interruption: matching saved synthesis receipts are reused without a new provider request. Successful scene files survive partial failure. Return ordered non-overlapping timeline allocations; incomplete batches are not delivery success.",
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
              voice: { type: "string", description: "Optional scene voice override." },
              model: { type: "string", description: "Optional scene model override." },
              rate: { type: "number", minimum: 0.5, maximum: 2, description: "Optional scene speech-rate override." },
              pitch: { type: "number", minimum: 0.5, maximum: 2, description: "Optional scene pitch override." },
              volume: { type: "number", minimum: 0, maximum: 100, description: "Optional scene volume override." },
              instruction: { type: "string", maxLength: 100, description: "Optional scene expression override." },
            },
            required: ["text", "sceneId", "sceneText", "sceneStart", "sceneDuration", "outputPath"],
            additionalProperties: false,
          },
        },
        compositionPath: { type: "string", description: "Optional current index.html path relative to the active workspace. Bare assets/<file>.mp3 scene outputs are scoped to this HTML file's directory." },
        targetDurationSeconds: { type: "number", description: "Optional explicitly user-requested final duration, never a template default. Used for advisory estimates, not a synthesis rejection; validate actual final timing separately." },
        voice: { type: "string", description: "Model Studio voice name or cloned voice id." },
        model: { type: "string", description: "Speech model. Defaults to cosyvoice-v3-flash." },
        sampleRate: { type: "number", description: "Optional output sample rate in Hz." },
        rate: { type: "number", minimum: 0.5, maximum: 2, description: "Default speech rate from 0.5 to 2." },
        pitch: { type: "number", minimum: 0.5, maximum: 2, description: "Default speech pitch from 0.5 to 2." },
        volume: { type: "number", minimum: 0, maximum: 100, description: "Default speech volume from 0 to 100." },
        instruction: { type: "string", maxLength: 100, description: "Default CosyVoice v3 expression instruction." },
      },
      required: ["scenes"],
      additionalProperties: false,
    },
  },
  {
    extensionId: MEDIA_EXTENSION_ID,
    action: "voiceover_timeline_validate",
    title: "Validate a video voiceover timeline",
    description: "Validate local scene, narration, composition timing, inline JavaScript syntax and animation dependencies before completing a video task. Safely adds missing window.__timelines initialization to the source HTML; other errors must be fixed before delivery. This action uses no provider quota.",
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
            sfx: { type: "boolean" },
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
        name: { type: "string", description: "Optional display name, up to 80 characters, saved in the current workspace." },
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
        prompt: { type: "string", description: "Video prompt." },
        model: { type: "string", description: "Optional Wan model. Defaults to wan2.6-t2v." },
        imageUrl: { type: "string", description: "Optional public image URL for models that support image guidance." },
        audioUrl: { type: "string", description: "Optional public audio URL for models that support audio guidance." },
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

function isCosyVoiceInstructionError(status: number, message: string | null) {
  return status === 428 && /(?:cosyvoice|tts).*engine return error code:\s*428/i.test(message ?? "");
}

function compatibleCosyVoiceVoice(model: string, voice: string) {
  if (model !== COSYVOICE_V3_FLASH) return voice;
  return LEGACY_COSYVOICE_V3_PRESET_MIGRATIONS[voice] ?? voice;
}

function defaultCosyVoiceVoice(model: string) {
  return model === COSYVOICE_V3_FLASH ? DEFAULT_COSYVOICE_V3_FLASH_VOICE : "";
}

type SpeechSynthesisControls = {
  rate: number;
  pitch: number;
  volume: number;
  instruction: string;
};

function boundedSpeechNumber(value: unknown, key: string, fallback: number, min: number, max: number) {
  const candidate = readOptionalNumber(value, key);
  if (candidate === undefined) return fallback;
  if (candidate < min || candidate > max) {
    throw new ApiError(400, "invalid_payload", `${key} must be between ${min} and ${max}`);
  }
  return candidate;
}

function optionalBoundedSpeechNumber(value: unknown, key: string, min: number, max: number) {
  const candidate = readOptionalNumber(value, key);
  if (candidate === undefined) return undefined;
  if (candidate < min || candidate > max) {
    throw new ApiError(400, "invalid_payload", `${key} must be between ${min} and ${max}`);
  }
  return candidate;
}

function speechSynthesisControls(value: unknown): SpeechSynthesisControls {
  const instruction = readStringField(value, "instruction");
  if (instruction.length > 100) {
    throw new ApiError(400, "invalid_payload", "instruction cannot exceed 100 characters");
  }
  return {
    rate: boundedSpeechNumber(value, "rate", 1, 0.5, 2),
    pitch: boundedSpeechNumber(value, "pitch", 1, 0.5, 2),
    volume: boundedSpeechNumber(value, "volume", 50, 0, 100),
    instruction,
  };
}

function speechSynthesisInput(text: string, voice: string, format: string, sampleRate: number | undefined, controls: SpeechSynthesisControls): JsonRecord {
  return {
    text,
    ...(voice ? { voice } : {}),
    ...(format ? { format } : {}),
    ...(sampleRate ? { sample_rate: sampleRate } : {}),
    rate: controls.rate,
    pitch: controls.pitch,
    volume: controls.volume,
    ...(controls.instruction ? { instruction: controls.instruction } : {}),
  };
}

function taskIdFromPayload(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.output)) return null;
  const taskId = payload.output.task_id;
  return typeof taskId === "string" && taskId.trim() ? taskId.trim() : null;
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
    response = await providerFetch(url, { signal: controller.signal, redirect: "error" });
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

function wordTimingsFromProviderPayload(payload: unknown): VoiceoverWordTiming[] {
  if (!isRecord(payload) || !isRecord(payload.output) || !isRecord(payload.output.sentence) || !Array.isArray(payload.output.sentence.words)) return [];
  return payload.output.sentence.words.flatMap((word) => {
    if (!isRecord(word)) return [];
    const text = readStringField(word, "text");
    const beginIndex = readOptionalNumber(word, "begin_index");
    const endIndex = readOptionalNumber(word, "end_index");
    const beginTime = readOptionalNumber(word, "begin_time");
    const endTime = readOptionalNumber(word, "end_time");
    if (!text || beginIndex === undefined || endIndex === undefined || beginTime === undefined || endTime === undefined) return [];
    return [{ text, beginIndex, endIndex, startSeconds: roundVoiceoverTime(beginTime / 1_000), endSeconds: roundVoiceoverTime(endTime / 1_000) }];
  });
}

/** Cumulative provider events revise words; character offsets are sentence-local. */
export function reconcileVoiceoverWordTimings(payloads: unknown[], text: string, durationSeconds: number) {
  const sentences = new Map<number, { text: string; words: Map<string, VoiceoverWordTiming> }>();
  for (const payload of payloads) {
    if (!isRecord(payload) || !isRecord(payload.output) || !isRecord(payload.output.sentence)) continue;
    const sentence = payload.output.sentence;
    const index = readOptionalNumber(sentence, "index") ?? 0;
    let entry = sentences.get(index);
    if (!entry) {
      entry = { text: readStringField(sentence, "original_text"), words: new Map() };
      sentences.set(index, entry);
    }
    if (readStringField(sentence, "original_text")) entry.text = readStringField(sentence, "original_text");
    for (const word of wordTimingsFromProviderPayload(payload)) entry.words.set(`${word.beginIndex}:${word.endIndex}`, word);
  }
  const words: VoiceoverWordTiming[] = [];
  const issues: string[] = [];
  let cursor = 0;
  for (const [, sentence] of [...sentences].sort(([a], [b]) => a - b)) {
    const offset = sentence.text ? text.indexOf(sentence.text, cursor) : sentences.size === 1 ? 0 : -1;
    if (offset < 0) { issues.push("sentence-text-unresolved"); continue; }
    for (const word of [...sentence.words.values()].sort((a, b) => a.beginIndex - b.beginIndex)) {
      words.push({ ...word, beginIndex: offset + word.beginIndex, endIndex: offset + word.endIndex });
    }
    cursor = offset + sentence.text.length;
  }
  const significant = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "");
  const covered = new Set<number>();
  for (const [index, word] of words.entries()) {
    const previous = words[index - 1];
    if (!Number.isInteger(word.beginIndex) || !Number.isInteger(word.endIndex) || word.beginIndex < 0
      || word.endIndex <= word.beginIndex || word.endIndex > text.length
      || significant(text.slice(word.beginIndex, word.endIndex)) !== significant(word.text)) {
      issues.push("word-text-mismatch");
      continue;
    }
    if (word.startSeconds < 0 || word.endSeconds <= word.startSeconds || word.endSeconds > durationSeconds + 1 / 30
      || (previous && (word.beginIndex < previous.endIndex || word.startSeconds < previous.endSeconds))) issues.push("word-boundary-invalid");
    for (let position = word.beginIndex; position < word.endIndex; position++) covered.add(position);
  }
  if (!words.length || [...text.matchAll(/[^\s\p{P}\p{S}]/gu)].some(match => !covered.has(match.index))) issues.push("word-coverage-incomplete");
  return { words: issues.length ? [] : words, issues: [...new Set(issues)] };
}

/** Phrase boundaries come from speech, never proportional character timing. */
export function compileVoiceoverCaptions(text: string, words: VoiceoverWordTiming[], startSeconds: number, durationSeconds: number) {
  if (!words.length) return [{ text, startFrame: Math.round(startSeconds * 30), endFrame: Math.ceil((startSeconds + durationSeconds) * 30), alignment: "scene-fallback" }];
  const captions = [];
  let first = 0;
  for (let index = 0; index < words.length; index++) {
    const current = words[index]!, next = words[index + 1];
    const initial = words[first]!;
    const separator = text.slice(current.endIndex, next?.beginIndex ?? text.length);
    if (next && !/[，。！？；,.!?;]/.test(separator) && next.startSeconds - current.endSeconds < .45
      && next.endSeconds - initial.startSeconds <= 3.5 && text.slice(initial.beginIndex, next.endIndex).length <= 24) continue;
    captions.push({ text: text.slice(initial.beginIndex, next?.beginIndex ?? text.length).trim(), startFrame: Math.round((startSeconds + initial.startSeconds) * 30), endFrame: Math.ceil((startSeconds + current.endSeconds) * 30), alignment: "provider" });
    first = index + 1;
  }
  return captions;
}

async function requestStreamingVoiceover(input: {
  apiKey: string;
  url: string;
  body: JsonRecord;
  text: string;
}): Promise<CachedVoiceover> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BAILIAN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await providerFetch(input.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json", "X-DashScope-SSE": "enable" },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new ApiError(504, "bailian_timeout", "Alibaba Model Studio did not respond before the request timed out.");
    if (isApiError(error)) throw error;
    throw new ApiError(502, "bailian_unreachable", "Could not reach Alibaba Model Studio. Check the network and try again.");
  } finally {
    clearTimeout(timeout);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, "bailian_request_failed", providerMessage(payload) || `Alibaba Model Studio request failed (HTTP ${response.status}).`);
    const audio = await downloadSynthesizedAudio(synthesizedAudioUrl(payload));
    const alignment = reconcileVoiceoverWordTimings([payload], input.text, mp3DurationSeconds(audio));
    return { audio, wordTimings: alignment.words, alignmentIssues: alignment.issues };
  }
  const stream = await response.text();
  if (!response.ok) throw new ApiError(response.status, "bailian_request_failed", `Alibaba Model Studio request failed (HTTP ${response.status}).`);
  const payloads = stream.split(/\r?\n\r?\n/).flatMap((event) => {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
    if (!data || data === "[DONE]") return [];
    try { return [JSON.parse(data) as unknown]; } catch { return []; }
  });
  const chunks = payloads.flatMap((payload) => {
    if (!isRecord(payload) || !isRecord(payload.output) || !isRecord(payload.output.audio)) return [];
    const data = readStringField(payload.output.audio, "data");
    return data ? [Buffer.from(data, "base64")] : [];
  });
  const audio = chunks.length
    ? Buffer.concat(chunks)
    : await downloadSynthesizedAudio(synthesizedAudioUrl(payloads.at(-1)));
  if (!audio.byteLength || audio.byteLength > MAX_SYNTHESIZED_AUDIO_BYTES) throw new ApiError(502, "bailian_audio_invalid", "Alibaba Model Studio returned invalid streaming audio.");
  const alignment = reconcileVoiceoverWordTimings(payloads, input.text, mp3DurationSeconds(audio));
  return { audio, wordTimings: alignment.words, alignmentIssues: alignment.issues };
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
  voice: string;
  model: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  instruction: string;
};

type SynthesizedWorkspaceVoiceover = {
  controls: SpeechSynthesisControls;
  scene: WorkspaceVoiceoverSceneInput;
  sourcePath: string;
  absolutePath: string;
  timingSourcePath: string;
  durationSeconds: number;
  bytes: number;
  model: string;
  voice: string;
  wordTimings: VoiceoverWordTiming[];
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
  const instruction = readStringField(value, "instruction");
  if (instruction.length > 100) {
    throw new ApiError(400, "invalid_payload", "instruction cannot exceed 100 characters");
  }
  return {
    text,
    sceneId,
    sceneText,
    sceneStart,
    sceneDuration,
    outputPath,
    voice: readStringField(value, "voice"),
    model: readStringField(value, "model"),
    rate: optionalBoundedSpeechNumber(value, "rate", 0.5, 2),
    pitch: optionalBoundedSpeechNumber(value, "pitch", 0.5, 2),
    volume: optionalBoundedSpeechNumber(value, "volume", 0, 100),
    instruction,
  };
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

async function requireVoiceoverProject(root: string, composition: string | undefined) {
  if (!composition) return;
  const project = await resolveWithinRoot(root, dirname(composition));
  if (!(await stat(project).catch(() => null))?.isDirectory()) {
    throw new ApiError(409, "voiceover_project_missing", "The current video project does not exist in the media workspace. Repair the workspace binding before synthesis; no provider request was made.");
  }
}

function isVoiceoverWordTiming(value: unknown): value is VoiceoverWordTiming {
  return isRecord(value) && typeof value.text === "string"
    && typeof value.beginIndex === "number" && typeof value.endIndex === "number"
    && typeof value.startSeconds === "number" && typeof value.endSeconds === "number";
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
  controls: SpeechSynthesisControls;
}): Promise<SynthesizedWorkspaceVoiceover> {
  const cacheKey = voiceoverAudioCacheKey({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    text: input.scene.text,
    model: input.model,
    voice: input.voice,
    sampleRate: input.sampleRate,
    ...input.controls,
  });
  const workspace = workspaceForContext(input.config, input.context);
  const destination = resolveWorkspaceFile(workspace.path, input.scene.outputPath);
  const timingDestination = resolveWorkspaceFile(workspace.path, input.scene.outputPath.replace(/\.mp3$/i, ".timings.json"));
  const existingAudio = await readFile(destination.absolutePath).catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  });
  let synthesized: CachedVoiceover | null = null;
  if (existingAudio) {
    const receipt: unknown = JSON.parse(await readFile(timingDestination.absolutePath, "utf8"));
    if (!isRecord(receipt) || receipt.synthesisFingerprint !== cacheKey
      || receipt.audioSha256 !== createHash("sha256").update(existingAudio).digest("hex")
      || !Array.isArray(receipt.words) || !receipt.words.every(isVoiceoverWordTiming)) {
      throw new ApiError(409, "voiceover_output_conflict", "Existing narration does not match this request. Preserve it and use a new revision path only for an explicitly changed narration.");
    }
    synthesized = { audio: existingAudio, wordTimings: receipt.words };
  } else {
    if (await stat(timingDestination.absolutePath).catch(() => null)) {
      throw new ApiError(409, "voiceover_output_conflict", "An incomplete timing receipt already exists. Preserve it and repair this output before retrying.");
    }
    synthesized = readCachedVoiceoverAudio(cacheKey);
  }
  if (!synthesized) {
    let request = voiceoverAudioRequests.get(cacheKey);
    if (!request) {
      if (voiceoverAudioRequests.size >= MAX_VOICEOVER_AUDIO_CACHE_ENTRIES) {
        throw new ApiError(429, "voiceover_busy", "Too many narration requests are running. Wait before retrying the same batch.");
      }
      request = requestStreamingVoiceover({
        apiKey: input.apiKey,
        text: input.scene.text,
        url: endpoint(input.baseUrl, "/api/v1/services/audio/tts/SpeechSynthesizer"),
        body: {
          model: input.model,
          input: speechSynthesisInput(input.scene.text, input.voice, "mp3", input.sampleRate, input.controls),
          parameters: { word_timestamp_enabled: true },
        },
      }).then(result => { cacheVoiceoverAudio(cacheKey, result); return result; })
        .finally(() => { voiceoverAudioRequests.delete(cacheKey); });
      voiceoverAudioRequests.set(cacheKey, request);
    }
    synthesized = await request;
  }
  const audio = synthesized.audio;
  const temporaryPath = `${destination.absolutePath}.${randomUUID()}.tmp`;
  const temporaryTimingPath = `${timingDestination.absolutePath}.${randomUUID()}.tmp`;
  let timingLinked = false;
  if (!existingAudio) {
    await mkdir(dirname(destination.absolutePath), { recursive: true });
    try {
      await writeFile(temporaryPath, audio, { flag: "wx" });
      await writeFile(temporaryTimingPath, `${JSON.stringify({ alignment: synthesized.wordTimings.length ? "provider" : "unavailable", words: synthesized.wordTimings, synthesisFingerprint: cacheKey, audioSha256: createHash("sha256").update(audio).digest("hex"), ...(synthesized.alignmentIssues?.length ? { issues: synthesized.alignmentIssues } : {}) }, null, 2)}\n`, { flag: "wx" });
      await link(temporaryTimingPath, timingDestination.absolutePath);
      timingLinked = true;
      await link(temporaryPath, destination.absolutePath);
    } catch (error) {
      if (timingLinked) await rm(timingDestination.absolutePath, { force: true });
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
      await rm(temporaryTimingPath, { force: true });
    }
  }
  return {
    scene: input.scene,
    controls: input.controls,
    sourcePath: destination.relativePath,
    absolutePath: destination.absolutePath,
    timingSourcePath: timingDestination.relativePath,
    durationSeconds: mp3DurationSeconds(audio),
    bytes: audio.byteLength,
    model: input.model,
    voice: input.voice,
    wordTimings: synthesized.wordTimings,
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
  const captionCues = compileVoiceoverCaptions(scene.sceneText, synthesized.wordTimings, timing.startSeconds, synthesized.durationSeconds);
  return {
    sourcePath: synthesized.sourcePath,
    timingSourcePath: synthesized.timingSourcePath,
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
      model: synthesized.model,
      voice: synthesized.voice,
      controls: synthesized.controls,
    }),
    timelinePatch: {
      setSceneStartSeconds: timing.startSeconds,
      setSceneDurationSeconds: timing.requiredSceneDurationSeconds,
      shiftFollowingBySeconds: timing.shiftFollowingBySeconds,
      rootDurationMustBeAtLeastSeconds: timing.endSeconds + VOICEOVER_READING_BUFFER_SECONDS,
      keepSceneVisibleUntilSeconds: timing.endSeconds,
    },
    model: synthesized.model,
    wordTimings: synthesized.wordTimings,
    wordTimingAlignment: synthesized.wordTimings.length ? "provider" : "unavailable",
    captionCues,
    captionElementsHtml: captionCues.map((cue, index) => `<div id="${escapeHtmlAttribute(`caption-${scene.sceneId}-${index + 1}`)}" class="clip caption" data-ipw-caption="true" data-start="${cue.startFrame / 30}" data-duration="${(cue.endFrame - cue.startFrame) / 30}" data-track-index="20" style="position:absolute;top:auto;left:5%;right:5%;bottom:5%;height:auto;display:flex;align-items:flex-end;justify-content:center;overflow:visible;background:transparent;pointer-events:none"><span data-ipw-caption-text="true" style="max-width:90%;background:transparent;color:white;text-align:center;text-shadow:0 2px 8px black;font-size:var(--ipw-video-caption-size,40px);line-height:1.35">${escapeHtmlAttribute(cue.text)}</span></div>`).join("\n"),
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

async function resolveBailianCredentials(authorization: AuthorizationAccess): Promise<{ apiKey: string; baseUrl: string }> {
  const values = await authorization.read("aliyun-bailian");
  const apiKey = values.DASHSCOPE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new ApiError(400, "dashscope_api_key_missing", "Model Studio API key missing. Configure Alibaba Model Studio media in Authorization Center.");
  }
  const configuredBaseUrl = values.DASHSCOPE_BASE_URL?.trim() || DEFAULT_ALIYUN_MEDIA_BASE_URL;
  return { apiKey, baseUrl: safeProviderBaseUrl(configuredBaseUrl) };
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
    response = await providerFetch(input.url, {
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
    if (isApiError(error)) throw error;
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
    if (isCosyVoiceInstructionError(response.status, message)) {
      throw new ApiError(422, "bailian_instruction_incompatible", "The selected CosyVoice style instruction is not supported by this voice. Clear the style instruction or choose a compatible voice and try again.");
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
    const response = await providerFetch(uploadHost, { method: "POST", body: form, signal: controller.signal });
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
    response = await providerFetch(endpoint(input.baseUrl, "/compatible-mode/v1/chat/completions"), {
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
    if (isApiError(error)) throw error;
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

export async function bailianMediaStatus(authorization: AuthorizationAccess) {
  try {
    const { apiKey, baseUrl } = await resolveBailianCredentials(authorization);
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
  authorization: AuthorizationAccess,
  action: string,
  args: JsonRecord,
  context: JsonRecord,
) {
  if (action === "video_recipe_catalog") {
    const output = await queryVideoRecipeCatalog(args);
    return { ok: true, extensionId: MEDIA_EXTENSION_ID, action, result: { provider: "local", operation: action, output }, context };
  }
  if (action === "video_audio_analyze" || action === "video_component_install" || action === "video_component_check") {
    const workspace = workspaceForContext(config, context);
    const output = action === "video_audio_analyze"
      ? await analyzeVideoMusic(workspace, args)
      : action === "video_component_install"
        ? await installVideoComponents(workspace, args)
        : await checkVideoComponents(workspace, args);
    return { ok: true, extensionId: MEDIA_EXTENSION_ID, action, result: { provider: "local", operation: action, output }, context };
  }
  if (action === "video_reference_analyze" || action === "video_soundtrack_prepare" || action === "video_language_timing_prepare") {
    const workspace = workspaceForContext(config, context);
    const output = action === "video_reference_analyze"
      ? await analyzeVideoReference(workspace, args)
      : action === "video_soundtrack_prepare"
        ? await prepareVideoSoundtrack(workspace, args)
        : await prepareVideoLanguageTiming(workspace, args);
    return { ok: true, extensionId: MEDIA_EXTENSION_ID, action, result: { provider: "local", operation: action, output }, context };
  }
  if (action === "video_render_start" || action === "video_render_status") {
    const output = await videoRenderAction(workspaceForContext(config, context), action, args);
    return { ok: true, extensionId: MEDIA_EXTENSION_ID, action, result: { provider: "local", operation: action, output }, context };
  }
  if (action === "status") {
    return {
      ok: true,
      extensionId: MEDIA_EXTENSION_ID,
      action,
      result: {
        provider: "aliyun-bailian",
        operation: action,
        output: await bailianMediaStatus(authorization),
      },
      context,
    };
  }

  if (action === "voiceover_timeline_validate") {
    if (isRecord(args) && args.requirements !== undefined && !isRecord(args.requirements)) {
      throw new ApiError(400, "invalid_video_delivery_requirements", "requirements must be a JSON object.");
    }
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
    // Do not silently disable requested deliverables when a model stringifies JSON.
    for (const key of ["voiceover", "captions", "bgm", "sfx", "recipesOnly"]) {
      if (requirementInput[key] !== undefined && typeof requirementInput[key] !== "boolean") {
        throw new ApiError(400, "invalid_video_delivery_requirements", `requirements.${key} must be a JSON boolean, not a string.`);
      }
    }
    if (requirementInput.targetDurationSeconds !== undefined
      && (typeof requirementInput.targetDurationSeconds !== "number" || !Number.isFinite(requirementInput.targetDurationSeconds) || requirementInput.targetDurationSeconds <= 0)) {
      throw new ApiError(400, "invalid_video_delivery_requirements", "requirements.targetDurationSeconds must be a positive JSON number.");
    }
    if (requirementInput.animationReferences !== undefined
      && (!Array.isArray(requirementInput.animationReferences) || !requirementInput.animationReferences.every(item => typeof item === "string"))) {
      throw new ApiError(400, "invalid_video_delivery_requirements", "requirements.animationReferences must be a JSON array of strings.");
    }
    const originalHtml = await readFile(source.absolutePath, "utf8");
    const html = repairVideoTimelineRegistry(originalHtml);
    if (html !== originalHtml) await writeFile(source.absolutePath, html, "utf8");
    let storyboardIssue: { code: string; message: string } | undefined;
    const storyboardPlan = await readStoryboardDeliveryPlan(resolveWorkspaceFile(workspace.path, posix.join(sourceDirectory, "STORYBOARD.md")).absolutePath).catch((error: unknown) => {
      if (!isApiError(error) || error.code !== "invalid_storyboard_music_plan") throw error;
      // Invalid authored content belongs in the bounded delivery repair pass.
      // Filesystem, path and authorization failures still abort normally.
      storyboardIssue = { code: error.code, message: error.message };
      return undefined;
    });
    const output = validateVoiceoverTimelineHtml(html, {
      voiceoverAssets,
      sourceDirectory,
      musicPlan: storyboardPlan?.music,
      storyboardFrames: storyboardPlan?.frames,
      mediaAssets: mediaAssets.map((path) => posix.relative(sourceDirectory, path)),
      requirements: {
        voiceover: readOptionalBoolean(requirementInput, "voiceover") === true,
        captions: readOptionalBoolean(requirementInput, "captions") === true,
        captionStyle: readStringField(requirementInput, "captionStyle") === "custom" ? "custom" : "transparent-bottom",
        bgm: readOptionalBoolean(requirementInput, "bgm") === true,
        sfx: readOptionalBoolean(requirementInput, "sfx") === true,
        animationReferences: readStringArray(requirementInput, "animationReferences"),
        targetDurationSeconds: readOptionalNumber(requirementInput, "targetDurationSeconds") ?? undefined,
      },
    });
    const componentCheck = requirementInput.recipesOnly === true || /^video\/[A-Za-z0-9_-]+\/index\.html$/u.test(source.relativePath)
      ? await checkVideoComponents(workspace, { sourcePath: source.relativePath, recipesOnly: requirementInput.recipesOnly === true })
      : null;
    const issues = [
      ...(storyboardIssue ? [storyboardIssue] : []),
      ...output.issues,
      ...await validateVideoScriptAssets(html, dirname(source.absolutePath)),
      ...(storyboardPlan?.music.asset && await musicDuplicatesNarration(
        workspace.path, sourceDirectory, storyboardPlan.music.asset, mediaAssets, voiceoverAssets,
      ) ? [{ code: "music_reuses_narration", message: "Background music is identical to a narration asset. Use a real instrumental music file; renaming or copying voiceover audio does not make it BGM." }] : []),
      ...(componentCheck?.issues ?? []),
    ];
    return {
      ok: true,
      extensionId: MEDIA_EXTENSION_ID,
      action,
      result: {
        provider: "local",
        operation: action,
        output: {
          sourcePath: source.relativePath,
          ...output,
          valid: issues.length === 0,
          issues,
          ...(componentCheck ? { componentCheck } : {}),
        },
      },
      context,
    };
  }

  const { apiKey, baseUrl } = await resolveBailianCredentials(authorization);
  let result: unknown;
  switch (action) {
    case "speech_synthesize": {
      const text = requireString(args, "text");
      const model = readStringField(args, "model") || COSYVOICE_V3_FLASH;
      const requestedVoice = readStringField(args, "voice");
      const input = speechSynthesisInput(
        text,
        requestedVoice ? compatibleCosyVoiceVoice(model, requestedVoice) : defaultCosyVoiceVoice(model),
        readStringField(args, "format"),
        readOptionalNumber(args, "sampleRate"),
        speechSynthesisControls(args),
      );
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
      const voice = requestedVoice ? compatibleCosyVoiceVoice(model, requestedVoice) : defaultCosyVoiceVoice(model);
      const composition = compositionPath
        ? resolveWorkspaceFile(workspaceForContext(config, context).path, compositionPath).relativePath
        : undefined;
      const scene = scopeVoiceoverSceneToComposition(parsedScene, composition);
      await requireVoiceoverProject(workspaceForContext(config, context).path, composition);
      const synthesized = await synthesizeWorkspaceVoiceover({
        config,
        context,
        apiKey,
        baseUrl,
        scene,
        model,
        voice,
        sampleRate: readOptionalNumber(args, "sampleRate"),
        controls: speechSynthesisControls(args),
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
      await requireVoiceoverProject(workspace.path, composition);
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
      const model = readStringField(args, "model") || COSYVOICE_V3_FLASH;
      const requestedVoice = readStringField(args, "voice");
      const voice = requestedVoice ? compatibleCosyVoiceVoice(model, requestedVoice) : defaultCosyVoiceVoice(model);
      const sampleRate = readOptionalNumber(args, "sampleRate");
      const controls = speechSynthesisControls(args);
      const created: SynthesizedWorkspaceVoiceover[] = [];
      let synthesizedScenes: SynthesizedWorkspaceVoiceover[];
      try {
        synthesizedScenes = await mapWithConcurrency(scenes, VOICEOVER_BATCH_CONCURRENCY, async (scene) => {
          const sceneModel = scene.model || model;
          const sceneVoiceRequest = scene.voice || voice || defaultCosyVoiceVoice(scene.model || model);
          const synthesized = await synthesizeWorkspaceVoiceover({
            config,
            context,
            apiKey,
            baseUrl,
            scene,
            model: sceneModel,
            voice: sceneVoiceRequest ? compatibleCosyVoiceVoice(sceneModel, sceneVoiceRequest) : "",
            sampleRate,
            controls: {
              rate: scene.rate ?? controls.rate,
              pitch: scene.pitch ?? controls.pitch,
              volume: scene.volume ?? controls.volume,
              instruction: scene.instruction || controls.instruction,
            },
          });
          created.push(synthesized);
          return synthesized;
        });
      } catch (error) {
        throw new ApiError(isApiError(error) ? error.status : 502, "voiceover_batch_incomplete",
          "Narration batch is incomplete. Successful files were preserved; correct the failure and retry the SAME batch and output paths to reuse them. Do not mark the video complete.",
          { completedPaths: created.map(item => item.sourcePath), cause: error instanceof Error ? error.message : String(error) });
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
        ...(targetDurationSeconds !== undefined ? {
          targetDurationSeconds,
          estimatedTargetExceeded: estimatedTimelineEndSeconds > targetDurationSeconds,
        } : {}),
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
      const saved = config.workspaces.length ? await readiPolloWorkWorkspaceConfig(config, workspaceForContext(config, context).id) : {};
      const names = readRecord(saved, "voiceNames");
      result = {
        items: voiceListFromPayload(providerResponse).map(voice => ({ ...voice, ...(readStringField(names, voice.id) ? { name: readStringField(names, voice.id) } : {}) })),
        pageIndex: readOptionalNumber(output, "page_index") ?? pageIndex,
        pageSize: readOptionalNumber(output, "page_size") ?? pageSize,
        totalCount: readOptionalNumber(output, "total_count") ?? null,
      };
      break;
    }
    case "voice_clone_workspace_file": {
      const name = readStringField(args, "name");
      if (name.length > 80) throw new ApiError(400, "invalid_voice_name", "Voice name must be 80 characters or fewer.");
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
          authorization,
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
      if (name) await writeiPolloWorkWorkspaceConfig(config, workspaceForContext(config, context).id, current => ({
        ...current,
        voiceNames: { ...readRecord(current, "voiceNames"), [voiceId]: name },
      }));
      result = { voiceId, model: targetModel, ...(name ? { name } : {}) };
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
