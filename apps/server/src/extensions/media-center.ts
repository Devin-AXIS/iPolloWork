import { ApiError } from "../errors.js";
import type { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";
import { withTemporaryWorkspaceObject } from "./storage.js";
import { extname } from "node:path";

// The Alibaba adapter stays internal to this module. The public action
// contract is provider-neutral so Media Center can add providers without
// changing app or OpenCode integration code.
export const MEDIA_EXTENSION_ID = "media";

const DEFAULT_ALIYUN_MEDIA_BASE_URL = "https://dashscope.aliyuncs.com";
const BAILIAN_REQUEST_TIMEOUT_MS = 90_000;
const MAX_TRANSLATION_AUDIO_CHARS = 16 * 1024 * 1024;
const COSYVOICE_V3_FLASH = "cosyvoice-v3-flash";
const LEGACY_COSYVOICE_V3_PRESET_MIGRATIONS: Record<string, string> = {
  longxiaochun: "longyingmu_v3",
  longxiaoxia: "longyingmu_v3",
  longwan: "longyingmu_v3",
  longwanwan: "longanhuan_v3",
  longlaotie: "longanlang_v3",
  longfei: "longanlang_v3",
};

type JsonRecord = Record<string, unknown>;

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
