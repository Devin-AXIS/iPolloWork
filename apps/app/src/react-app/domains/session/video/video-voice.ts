import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { videoProjectDirectory } from "./video-project";

export const VOICEOVER_SETTINGS_FILE = "voiceover.json";
export const MAX_VOICE_SAMPLE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_COSYVOICE_MODEL = "cosyvoice-v3-flash";
export const DEFAULT_COSYVOICE_VOICE = "longanyang";
const VIDEO_VOICE_DISPLAY_PREFIX = "Video voice display:";

export type VideoVoiceSource = "preset" | "cloned";
export type VideoVoiceSelectionMode = "auto" | "manual";

export type VideoVoiceControls = {
  rate: number;
  pitch: number;
  volume: number;
  instruction: string;
};

export type VideoVoiceoverSettings = VideoVoiceControls & {
  provider: "aliyun-bailian";
  model: string;
  voiceId: string;
  source: VideoVoiceSource;
  enabled: boolean;
  selectionMode: VideoVoiceSelectionMode;
  updatedAt: string;
};

export type VideoVoiceAiReference = Pick<VideoVoiceoverSettings, "model" | "voiceId" | "rate" | "pitch" | "volume" | "instruction"> & {
  label: string;
};

export type VoiceSampleDescriptor = {
  name: string;
  size: number;
  type?: string;
};

type VoiceSampleValidationMessages = {
  invalidType: string;
  empty: string;
  tooLarge: string;
};

const DEFAULT_VOICE_SAMPLE_VALIDATION_MESSAGES: VoiceSampleValidationMessages = {
  invalidType: "请选择 WAV、MP3 或 M4A 音频文件。",
  empty: "音频文件为空，无法复刻。",
  tooLarge: "音频文件不能超过 10 MB。",
};

export const BAILIAN_PRESET_GROUPS = ["narration", "warm", "character", "marketing", "dialect"] as const;

// Official cosyvoice-v3-flash catalog (2026-09-14):
// https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list
// Display names and descriptions live in the locale dictionaries.
export const BAILIAN_PRESET_VOICES = [
  { id: "longanyang", group: "narration" },
  { id: "longanhuan_v3", group: "narration" },
  { id: "longanlang_v3", group: "narration" },
  { id: "longyingmu_v3", group: "narration" },
  { id: "longanzhi_v3", group: "narration" },
  { id: "longanyun_v3", group: "warm" },
  { id: "longwan_v3", group: "warm" },
  { id: "longhuhu_v3", group: "character" },
  { id: "longjielidou_v3", group: "character" },
  { id: "longlaobo_v3", group: "character" },
  { id: "longjiqi_v3", group: "character" },
  { id: "longhouge_v3", group: "character" },
  { id: "longanxuan_v3", group: "marketing" },
  { id: "longyingxiao_v3", group: "marketing" },
  { id: "longanyue_v3", group: "dialect" },
  { id: "longshange_v3", group: "dialect" },
] as const;

export const DEFAULT_VIDEO_VOICE_CONTROLS: VideoVoiceControls = {
  rate: 1,
  pitch: 1,
  volume: 50,
  instruction: "",
};

export function defaultVideoVoiceoverSettings(now = new Date().toISOString()): VideoVoiceoverSettings {
  return {
    provider: "aliyun-bailian",
    model: DEFAULT_COSYVOICE_MODEL,
    voiceId: DEFAULT_COSYVOICE_VOICE,
    source: "preset",
    enabled: true,
    selectionMode: "auto",
    ...DEFAULT_VIDEO_VOICE_CONTROLS,
    updatedAt: now,
  };
}

// Earlier Video Studio builds paired these v1 voices with cosyvoice-v3-flash.
// Model Studio rejects that combination with its opaque Engine 418 response.
const LEGACY_PRESET_VOICE_MIGRATIONS: Record<string, (typeof BAILIAN_PRESET_VOICES)[number]["id"]> = {
  longxiaochun: "longyingmu_v3",
  longxiaoxia: "longyingmu_v3",
  longwan: "longyingmu_v3",
  longwanwan: "longanhuan_v3",
  longlaotie: "longanlang_v3",
  longfei: "longanlang_v3",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === "string" ? value[key].trim() : "";
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  return isRecord(value) && isRecord(value[key]) ? value[key] : {};
}

/**
 * Model Studio now returns non-streaming TTS as `output.audio.url`.
 * Keep the former `audio_url` spelling for already released endpoints.
 */
export function synthesizedAudioUrl(value: unknown): string {
  return readString(readRecord(value, "output"), "audio_url")
    || readString(readRecord(readRecord(value, "output"), "audio"), "url");
}

export function videoVoiceoverSettingsPath(sessionId: string) {
  return `${videoProjectDirectory(sessionId)}/${VOICEOVER_SETTINGS_FILE}`;
}

export function videoVoiceoverAvailability(status: unknown, savedContent: string | null) {
  const configured = isRecord(status)
    && status.ok === true
    && isRecord(status.result)
    && isRecord(status.result.output)
    && status.result.output.configured === true;
  const saved = savedContent ? parseVideoVoiceoverSettings(savedContent) : null;
  return { configured, enabled: configured && saved?.enabled !== false };
}

export async function readVideoVoiceoverAvailability(
  client: Pick<iPolloWorkServerClient, "callMedia" | "readWorkspaceFile">,
  workspaceId: string,
  sessionId: string,
  workspaceRoot?: string,
) {
  const [status, saved] = await Promise.all([
    client.callMedia("status", {}, workspaceRoot ? { directory: workspaceRoot } : undefined).catch(() => null),
    client.readWorkspaceFile(workspaceId, videoVoiceoverSettingsPath(sessionId)).catch(() => null),
  ]);
  return videoVoiceoverAvailability(status, saved?.content ?? null);
}

export function parseVideoVoiceoverSettings(content: string): VideoVoiceoverSettings | null {
  try {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) return null;
    const provider = value.provider;
    const model = value.model;
    const voiceId = value.voiceId;
    const source = value.source;
    const updatedAt = value.updatedAt;
    if (
      provider !== "aliyun-bailian"
      || typeof model !== "string" || !model.trim()
      || typeof voiceId !== "string" || !voiceId.trim()
      || (source !== "preset" && source !== "cloned")
      || typeof updatedAt !== "string" || !updatedAt.trim()
    ) return null;
    const rate = typeof value.rate === "number" && value.rate >= 0.5 && value.rate <= 2 ? value.rate : DEFAULT_VIDEO_VOICE_CONTROLS.rate;
    const pitch = typeof value.pitch === "number" && value.pitch >= 0.5 && value.pitch <= 2 ? value.pitch : DEFAULT_VIDEO_VOICE_CONTROLS.pitch;
    const volume = typeof value.volume === "number" && value.volume >= 0 && value.volume <= 100 ? value.volume : DEFAULT_VIDEO_VOICE_CONTROLS.volume;
    const instruction = typeof value.instruction === "string" ? value.instruction.trim().slice(0, 100) : "";
    return {
      provider,
      model,
      voiceId,
      source,
      enabled: value.enabled !== false,
      selectionMode: value.selectionMode === "auto" ? "auto" : "manual",
      rate,
      pitch,
      volume,
      instruction,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function migrateVideoVoiceoverSettings(value: VideoVoiceoverSettings): VideoVoiceoverSettings {
  if (value.source !== "preset" || value.model !== DEFAULT_COSYVOICE_MODEL) return value;
  const voiceId = LEGACY_PRESET_VOICE_MIGRATIONS[value.voiceId];
  return voiceId ? { ...value, voiceId } : value;
}

export function serializeVideoVoiceoverSettings(value: VideoVoiceoverSettings) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function videoVoiceDisplayMetadata(reference: VideoVoiceAiReference) {
  return `${VIDEO_VOICE_DISPLAY_PREFIX}${JSON.stringify(reference)}`;
}

export function parseVideoVoiceDisplayMetadata(text: string): VideoVoiceAiReference | null {
  const line = text
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(VIDEO_VOICE_DISPLAY_PREFIX));
  if (!line) return null;
  try {
    const value: unknown = JSON.parse(line.slice(VIDEO_VOICE_DISPLAY_PREFIX.length));
    if (!isRecord(value)) return null;
    const voiceId = readString(value, "voiceId");
    const model = readString(value, "model");
    const label = readString(value, "label");
    if (!voiceId || !model || !label) return null;
    return {
      voiceId,
      model,
      label,
      rate: typeof value.rate === "number" ? value.rate : DEFAULT_VIDEO_VOICE_CONTROLS.rate,
      pitch: typeof value.pitch === "number" ? value.pitch : DEFAULT_VIDEO_VOICE_CONTROLS.pitch,
      volume: typeof value.volume === "number" ? value.volume : DEFAULT_VIDEO_VOICE_CONTROLS.volume,
      instruction: typeof value.instruction === "string" ? value.instruction : "",
    };
  } catch {
    return null;
  }
}

export function validateVoiceSampleFile(
  file: VoiceSampleDescriptor,
  messages: VoiceSampleValidationMessages = DEFAULT_VOICE_SAMPLE_VALIDATION_MESSAGES,
): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "wav" && extension !== "mp3" && extension !== "m4a") {
    return messages.invalidType;
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return messages.empty;
  if (file.size > MAX_VOICE_SAMPLE_BYTES) return messages.tooLarge;
  return null;
}

export function voiceSampleWorkspacePath(sessionId: string, fileName: string, timestamp = Date.now()) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "wav";
  return `${videoProjectDirectory(sessionId)}/.voice-samples/${timestamp}-${extension}.${extension}`;
}
