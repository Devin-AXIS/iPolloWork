import { videoProjectDirectory } from "./video-project";

export const VOICEOVER_SETTINGS_FILE = "voiceover.json";
export const MAX_VOICE_SAMPLE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_COSYVOICE_MODEL = "cosyvoice-v3-flash";

export type VideoVoiceSource = "preset" | "cloned";

export type VideoVoiceoverSettings = {
  provider: "aliyun-bailian";
  model: string;
  voiceId: string;
  source: VideoVoiceSource;
  updatedAt: string;
};

export type VoiceSampleDescriptor = {
  name: string;
  size: number;
  type?: string;
};

export const BAILIAN_PRESET_VOICES = [
  { id: "longanyang", label: "龙安阳", description: "阳光自然的中文男声" },
  { id: "longanhuan_v3", label: "龙安欢", description: "明朗欢快的中文女声" },
  { id: "longanlang_v3", label: "龙安朗", description: "清爽清晰的中文男声" },
  { id: "longyingmu_v3", label: "龙莺木", description: "知性沉稳的中文女声" },
] as const;

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
    return { provider, model, voiceId, source, updatedAt };
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

export function validateVoiceSampleFile(file: VoiceSampleDescriptor): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "wav" && extension !== "mp3" && extension !== "m4a") {
    return "请选择 WAV、MP3 或 M4A 音频文件。";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return "音频文件为空，无法复刻。";
  if (file.size > MAX_VOICE_SAMPLE_BYTES) return "音频文件不能超过 10 MB。";
  return null;
}

export function voiceSampleWorkspacePath(sessionId: string, fileName: string, timestamp = Date.now()) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "wav";
  return `${videoProjectDirectory(sessionId)}/.voice-samples/${timestamp}-${extension}.${extension}`;
}
