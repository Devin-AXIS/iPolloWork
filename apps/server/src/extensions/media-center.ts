import { ApiError } from "../errors.js";
import type { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";
import { link, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, posix } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveWorkspaceFile, withTemporaryWorkspaceObject, workspaceForContext } from "./storage.js";

// The Alibaba adapter stays internal to this module. The public action
// contract is provider-neutral so Media Center can add providers without
// changing app or OpenCode integration code.
export const MEDIA_EXTENSION_ID = "media";

const DEFAULT_ALIYUN_MEDIA_BASE_URL = "https://dashscope.aliyuncs.com";
const BAILIAN_REQUEST_TIMEOUT_MS = 90_000;
const MAX_TRANSLATION_AUDIO_CHARS = 16 * 1024 * 1024;
const MAX_SYNTHESIZED_AUDIO_BYTES = 50 * 1024 * 1024;
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

type JsonRecord = Record<string, unknown>;

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

async function listWorkspaceVoiceoverAssets(root: string, relativeDirectory: string): Promise<string[]> {
  const assets: string[] = [];
  async function visit(relativePath: string) {
    const absolute = resolveWorkspaceFile(root, relativePath).absolutePath;
    try {
      const entries = await readdir(absolute, { withFileTypes: true });
      for (const entry of entries) {
        const child = `${relativePath.replace(/\/$/, "")}/${entry.name}`.replace(/^\/+/, "");
        if (entry.isDirectory()) {
          await visit(child);
        } else if (entry.isFile() && isVoiceoverAssetPath(child)) {
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

export function validateVoiceoverTimelineHtml(html: string, options: { voiceoverAssets?: string[] } = {}) {
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
      text: visibleTextFromHtml(nodeInnerHtml(html, node)),
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
    description: "Create speech from text with CosyVoice. The result contains a temporary audio URL from Model Studio.",
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
    description: "Create an MP3 voiceover, save it atomically inside the active workspace, and return its measured frame duration for video synchronization.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "One visual scene's narration text." },
        sceneId: { type: "string", description: "The exact .scene element id narrated by this file." },
        sceneText: { type: "string", description: "The scene's visible text snapshot. Must exactly equal text." },
        sceneStart: { type: "number", description: "The exact scene start time in seconds." },
        sceneDuration: { type: "number", description: "The visual scene's current duration in seconds. Used with the measured MP3 duration to return a non-overlapping timeline allocation." },
        outputPath: { type: "string", description: "New immutable .mp3 path relative to the active workspace." },
        compositionPath: { type: "string", description: "Optional index.html path relative to the active workspace. When present, the returned audioElementHtml uses a src relative to that HTML file." },
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
    action: "voiceover_timeline_validate",
    title: "Validate a video voiceover timeline",
    description: "Validate local scene, narration, and composition timing before completing a video task. This action uses no provider quota.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Video index.html path relative to the active workspace." },
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

function compatibleCosyVoiceVoice(model: string, voice: string) {
  if (model !== COSYVOICE_V3_FLASH) return voice;
  return LEGACY_COSYVOICE_V3_PRESET_MIGRATIONS[voice] ?? voice;
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
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ApiError(502, "bailian_audio_url_invalid", "Alibaba Model Studio returned an unsafe synthesized audio URL.");
  }
  return url.toString();
}

async function downloadSynthesizedAudio(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BAILIAN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
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

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
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
    response = await fetch(input.url, {
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
    response = await fetch(endpoint(input.baseUrl, "/compatible-mode/v1/chat/completions"), {
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
    const voiceoverAssets = await listWorkspaceVoiceoverAssets(workspace.path, assetsDirectory);
    const output = validateVoiceoverTimelineHtml(await readFile(source.absolutePath, "utf8"), { voiceoverAssets });
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
      const text = requireString(args, "text");
      const sceneId = requireString(args, "sceneId");
      const sceneText = requireString(args, "sceneText");
      const sceneStart = readOptionalNumber(args, "sceneStart");
      const sceneDuration = readOptionalNumber(args, "sceneDuration");
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
      const outputPath = requireString(args, "outputPath");
      if (extname(outputPath).toLowerCase() !== ".mp3") {
        throw new ApiError(400, "invalid_synthesized_audio_path", "outputPath must use the .mp3 extension.");
      }
      const compositionPath = readStringField(args, "compositionPath");
      if (compositionPath && extname(compositionPath).toLowerCase() !== ".html") {
        throw new ApiError(400, "invalid_voiceover_composition_path", "compositionPath must use the .html extension.");
      }
      const model = readStringField(args, "model") || COSYVOICE_V3_FLASH;
      const requestedVoice = readStringField(args, "voice");
      const voice = requestedVoice ? compatibleCosyVoiceVoice(model, requestedVoice) : "";
      const providerResponse = await requestProviderJson({
        apiKey,
        url: endpoint(baseUrl, "/api/v1/services/audio/tts/SpeechSynthesizer"),
        body: {
          model,
          input: {
            text,
            ...(voice ? { voice } : {}),
            format: "mp3",
            ...(readOptionalNumber(args, "sampleRate") ? { sample_rate: readOptionalNumber(args, "sampleRate") } : {}),
          },
        },
      });
      const audio = await downloadSynthesizedAudio(synthesizedAudioUrl(providerResponse));
      const durationSeconds = mp3DurationSeconds(audio);
      const workspace = workspaceForContext(config, context);
      const destination = resolveWorkspaceFile(workspace.path, outputPath);
      const composition = compositionPath ? resolveWorkspaceFile(workspace.path, compositionPath) : undefined;
      const temporaryPath = `${destination.absolutePath}.${randomUUID()}.tmp`;
      await mkdir(dirname(destination.absolutePath), { recursive: true });
      try {
        await writeFile(temporaryPath, audio, { flag: "wx" });
        await link(temporaryPath, destination.absolutePath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      const timing = planSceneVoiceoverTiming(sceneStart, sceneDuration, durationSeconds);
      const audioElementId = htmlAudioIdForVoiceover(sceneId, destination.relativePath);
      const audioElementSourcePath = relativeHtmlMediaSource(composition?.relativePath, destination.relativePath);
      result = {
        sourcePath: destination.relativePath,
        durationSeconds,
        bytes: audio.byteLength,
        sceneId,
        sceneText,
        sceneStart,
        sceneDuration,
        timing,
        audioElementId,
        audioElementHtml: voiceoverAudioElementHtml({
          id: audioElementId,
          sourcePath: audioElementSourcePath,
          sceneId,
          sceneText,
          startSeconds: timing.startSeconds,
          durationSeconds,
        }),
        timelinePatch: {
          setSceneStartSeconds: timing.startSeconds,
          setSceneDurationSeconds: timing.requiredSceneDurationSeconds,
          shiftFollowingBySeconds: timing.shiftFollowingBySeconds,
          rootDurationMustBeAtLeastSeconds: timing.endSeconds + VOICEOVER_READING_BUFFER_SECONDS,
          keepSceneVisibleUntilSeconds: timing.endSeconds,
        },
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
      const providerResponse = await withTemporaryWorkspaceObject({
        config,
        env,
        context,
        sourcePath,
        purpose: "voice-clone",
        maxBytes: 10 * 1024 * 1024,
        use: (audioUrl) => requestProviderJson({
          apiKey,
          url: endpoint(baseUrl, "/api/v1/services/audio/tts/customization"),
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
        }),
      });
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
