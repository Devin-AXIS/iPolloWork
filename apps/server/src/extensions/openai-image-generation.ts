import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { basename, extname, resolve, sep } from "node:path";

import { ApiError } from "../errors.js";
import type { AuthorizationAccess, AuthorizationServiceId } from "../authorization-center.js";
import { resolveWithinRoot } from "../paths.js";
import { providerFetch } from "../provider-fetch.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { generateCodexImage, optimizeCodexImagePrompt } from "./codex-image-generation.js";
import { recordSessionArtifact, sessionArtifactOwner } from "../session-artifacts.js";
import { prepareImageSelection, saveImageSelection, loadImageSelection } from "./image-selection.js";
import { rememberImageEditResult, saveImageEditResult, validateImageEditSource } from "./image-edit-results.js";

export const OPENAI_IMAGE_GENERATION_EXTENSION_ID = "openai-image-generation";
const IMAGE_API_TIMEOUT_MS = 120_000;
const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;

type ImageModelAdapterId = "openai" | "openai-codex" | "volcengine-ark" | "unavailable";

type ImageParameter = {
  values: readonly string[];
  default: string;
  delivery: "native" | "prompt";
  experimentalValues?: readonly string[];
  customRatio?: boolean;
};

type ImageModelDefinition = {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  adapter: ImageModelAdapterId;
  upstreamModel: string;
  authorizationService: AuthorizationServiceId | null;
  credentialKey: string | null;
  available: boolean;
  unavailableReason?: string;
  parameters: { size: ImageParameter | null; quality: ImageParameter | null };
  capabilities: {
    generate: boolean;
    edit: boolean;
    mask: boolean;
    region: boolean;
  };
};

type NormalizedSelectionBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

// Adding a model for an existing provider should only require one catalog entry.
// New providers add one adapter branch below and reuse the same action contract.
const IMAGE_MODELS: readonly ImageModelDefinition[] = [
  {
    id: "openai/gpt-image-2",
    label: "GPT Image 2 · API",
    provider: "openai",
    providerLabel: "OpenAI",
    adapter: "openai",
    upstreamModel: "gpt-image-2",
    authorizationService: "openai-images",
    credentialKey: "OPENAI_API_KEY",
    available: true,
    // https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options
    parameters: {
      size: { values: ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x1152", "1152x2048", "2048x2048", "3840x2160", "2160x3840"], default: "auto", delivery: "native", experimentalValues: ["2048x2048", "3840x2160", "2160x3840"] },
      quality: { values: ["auto", "low", "medium", "high"], default: "auto", delivery: "native" },
    },
    capabilities: { generate: true, edit: true, mask: true, region: true },
  },
  {
    id: "openai/gpt-image-2-codex",
    label: "GPT Image 2 · ChatGPT 登录",
    provider: "openai",
    providerLabel: "ChatGPT / Codex",
    adapter: "openai-codex",
    upstreamModel: "gpt-image-2",
    authorizationService: "openai-images",
    credentialKey: null,
    available: true,
    // The app-server adapter accepts a prompt, not native image size/quality settings.
    parameters: {
      size: { values: ["auto", "1024x1024", "1536x1024", "1024x1536", "16x9", "9x16", "4x3", "3x4", "21x9"], default: "auto", delivery: "prompt", customRatio:true },
      quality: null,
    },
    capabilities: { generate: true, edit: true, mask: false, region: true },
  },
  {
    id: "volcengine/seedream-5",
    label: "即梦 Seedream 5.0",
    provider: "volcengine",
    providerLabel: "火山引擎 Ark",
    adapter: "volcengine-ark",
    upstreamModel: "doubao-seedream-5-0-260128",
    authorizationService: "volcengine-video",
    credentialKey: "ARK_API_KEY",
    available: true,
    // Seedream 5 presets; do not reuse GPT's unsupported 1K sizes or quality field.
    // https://docs.byteplus.com/api/docs/ModelArk/1824121
    parameters: {
      size: { values: ["2K", "3K", "2048x2048", "2496x1664", "1664x2496", "2848x1600", "1600x2848", "3072x3072"], default: "2K", delivery: "native" },
      quality: null,
    },
    capabilities: { generate: true, edit: true, mask: false, region: true },
  },
  {
    id: "midjourney/official",
    label: "Midjourney",
    provider: "midjourney",
    providerLabel: "Midjourney",
    adapter: "unavailable",
    upstreamModel: "",
    authorizationService: null,
    credentialKey: null,
    available: false,
    parameters: { size: null, quality: null },
    unavailableReason: "Midjourney 官方暂未开放公共 API，当前不能在第三方工作台中直接调用。",
    capabilities: { generate: false, edit: false, mask: false, region: false },
  },
] as const;

const DEFAULT_IMAGE_MODEL_ID = IMAGE_MODELS[0].id;

const imageParameterSchemas = Object.fromEntries(["size", "quality"].map((key) => [key, {
  type: "string",
  description: `Use values from status.models[].parameters.${key} for the selected model. Omit unsupported parameters; auto uses the model default. Prompt-delivered settings are intent, not exact controls.`,
  ...(key === "size" ? { pattern: "^(auto|2K|3K|[1-9][0-9]{0,3}x[1-9][0-9]{0,3})$" } : { enum: [...new Set(["auto", ...IMAGE_MODELS.flatMap(model => model.parameters.quality?.values ?? [])])] }),
}]));

export const OPENAI_IMAGE_GENERATION_EXTENSION_ACTIONS = [
  {
    extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
    action: "image_edit_save",
    title: "Save reviewed image edit",
    description: "After the user reviews an edited copy, keep both versions with copy, or explicitly replace the original and remove this copy with overwrite. Never choose overwrite without the user's request.",
    effect: "write" as const,
    inputSchema: {
      type: "object",
      properties: { editId: { type: "string" }, mode: { type: "string", enum: ["copy", "overwrite"] } },
      required: ["editId", "mode"], additionalProperties: false,
    },
  },
  {
    extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
    action: "selection_capture",
    title: "Capture image selection",
    description: "Freeze the displayed source and exact mask for this conversation. No model request is made.",
    effect: "write" as const,
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string" },
        sourceDataUrl: { type: "string" },
        maskDataUrl: { type: "string" },
      },
      required: ["sourcePath", "sourceDataUrl", "maskDataUrl"],
      additionalProperties: false,
    },
  },
  {
    extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
    action: "prompt_optimize",
    title: "Optimize image prompt",
    description: "Optimize an image description in the background using ChatGPT login without creating a conversation or an image.",
    inputSchema: { type: "object", properties: { prompt: { type: "string", minLength: 1, maxLength: 8000 }, referencePath: { type: "string" }, mediaKind: { type: "string", enum: ["image", "video"] }, settings: { type: "object", additionalProperties: { type: "string" } } }, required: ["prompt"], additionalProperties: false },
  },
  {
    extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
    action: "status",
    title: "Image model status",
    description: "List the image models, capabilities, and authorization state available to iPolloWork extension actions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
    action: "image_generate",
    title: "Generate image artifact",
    description: "Generate and save a PNG workspace artifact without opening Image Studio. If model is omitted, use the first available connected image model.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image prompt to turn into an artifact." },
        model: { type: "string", description: "Stable image model ID returned by status." },
        filename: { type: "string", description: "Optional output filename without extension." },
        ...imageParameterSchemas,
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
    action: "image_edit",
    title: "Edit image artifact",
    description: "Edit a workspace image with an optional transparent PNG mask and save the result as a new PNG artifact. Works without opening Image Studio; omit model to use an available connected image model.",
    effect: "write" as const,
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Workspace-relative PNG, JPEG, or WebP source path." },
        reviewResult: { type: "boolean", description: "Keep a save-review receipt for the resulting copy. Requires sessionId and sourceRevision; does not overwrite the source." },
        sourceRevision: { type: "string", description: "SHA-256 of the source bytes loaded in Image Studio, used to reject stale edits." },
        prompt: { type: "string", description: "Describe the requested change." },
        model: { type: "string", description: "Stable image model ID returned by status." },
        maskDataUrl: { type: "string", description: "Optional PNG data URL whose transparent pixels identify the edit area." },
        selectionId: { type: "string", description: "Immutable selection captured for this conversation. Uses its original image and exact mask, even when Image Studio is closed. Do not substitute a new selection." },
        selectionBlend: { type: "string", enum: ["natural", "strict"], description: "natural feathers inward for a smooth transition while preserving unselected pixels; strict uses the exact mask without additional feathering. Defaults to strict for existing callers." },
        selectionBounds: {
          type: "object",
          description: "Optional normalized selected region, measured from the top-left of the image.",
          properties: {
            left: { type: "number", minimum: 0, maximum: 1 },
            top: { type: "number", minimum: 0, maximum: 1 },
            right: { type: "number", minimum: 0, maximum: 1 },
            bottom: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["left", "top", "right", "bottom"],
          additionalProperties: false,
        },
        filename: { type: "string", description: "Optional output filename without extension." },
        ...imageParameterSchemas,
      },
      required: ["sourcePath", "prompt"],
      additionalProperties: false,
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function readSelectionBounds(value: unknown): NormalizedSelectionBounds | null {
  if (value === undefined) return null;
  if (!isRecord(value)) throw new ApiError(400, "invalid_selection_bounds", "selectionBounds must be an object");
  const left = value.left;
  const top = value.top;
  const right = value.right;
  const bottom = value.bottom;
  if (
    typeof left !== "number" || !Number.isFinite(left)
    || typeof top !== "number" || !Number.isFinite(top)
    || typeof right !== "number" || !Number.isFinite(right)
    || typeof bottom !== "number" || !Number.isFinite(bottom)
    || left < 0 || top < 0 || right > 1 || bottom > 1
    || left >= right || top >= bottom
  ) {
    throw new ApiError(400, "invalid_selection_bounds", "selectionBounds must contain normalized left, top, right, and bottom values");
  }
  return { left, top, right, bottom };
}

function promptWithApproximateRegion(prompt: string, bounds: NormalizedSelectionBounds): string {
  const percent = (value: number) => Math.round(value * 100);
  return `${prompt}\n\nApply this change only inside the approximate selected region: left ${percent(bounds.left)}%, top ${percent(bounds.top)}%, right ${percent(bounds.right)}%, bottom ${percent(bounds.bottom)}%, measured from the top-left corner. Preserve all content outside this region.`;
}

function selectionPrompt(input: { prompt: string; selectionGuide?: Buffer; selectionBounds: NormalizedSelectionBounds | null; mask?: Buffer | null }) {
  const continuity = "Change only the requested subject or property, not the whole selected background. Keep the original sky, terrain, texture, perspective and lighting unless explicitly requested otherwise. Integrate the subject and any glow naturally into the existing scene; keep boundary colours and details continuous. Do not create a rectangular patch, inset, panel, border, collage, or visible mask. Return the complete edited image with the original composition, framing and dimensions, not a crop.";
  if (input.selectionGuide) return `${input.prompt}\n\nImage 1 is the original. Image 2 is an exact, pixel-aligned selection mask: WHITE is editable, BLACK must remain unchanged, gray is a soft edge. Edit ONLY the white/gray area of image 1. The mask is guidance, not content to draw.\n${continuity}`;
  if (input.mask) return `${input.prompt}\n\nThe transparent mask marks the allowed edit area. Preserve everything outside it.\n${continuity}`;
  return input.selectionBounds ? promptWithApproximateRegion(input.prompt, input.selectionBounds) : input.prompt;
}

function slugifyImageArtifactName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "ipollowork-image";
}

async function modelForId(value: string, authorization: AuthorizationAccess): Promise<ImageModelDefinition> {
  const requested = value || (await openAiImageGenerationStatus(authorization)).defaultModel;
  const model = IMAGE_MODELS.find((entry) => entry.id === requested);
  if (!model) throw new ApiError(400, "image_model_unknown", `Unknown image model: ${requested}`);
  if (!model.available) {
    throw new ApiError(400, "image_model_unavailable", model.unavailableReason ?? `${model.label} is not available.`);
  }
  return model;
}

async function modelCredential(authorization: AuthorizationAccess, model: ImageModelDefinition): Promise<string> {
  if (!model.authorizationService || !model.credentialKey) return "";
  return (await authorization.read(model.authorizationService))[model.credentialKey]?.trim() ?? "";
}

function modelMissingAuthorizationMessage(model: ImageModelDefinition): string {
  if (model.adapter === "openai") return "OpenAI API key missing. Connect OpenAI Images in Authorization Center.";
  if (model.adapter === "volcengine-ark") return "Ark API key missing. Connect Volcengine Ark in Authorization Center.";
  return `${model.label} is not available.`;
}

export async function openAiImageGenerationStatus(authorization: AuthorizationAccess) {
  try {
    const credentials = new Map<AuthorizationServiceId, Readonly<Record<string, string>>>();
    const services = new Set(IMAGE_MODELS.flatMap((model) => model.authorizationService ? [model.authorizationService] : []));
    await Promise.all([...services].map(async (service) => {
      credentials.set(service, await authorization.read(service));
    }));
    const browserSession = await authorization.openAiBrowserSession?.();
    const models = IMAGE_MODELS.map((model) => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      providerLabel: model.providerLabel,
      available: model.available,
      configured: model.adapter === "openai-codex"
        ? Boolean(browserSession?.accountId)
        : Boolean(model.authorizationService && model.credentialKey && credentials.get(model.authorizationService)?.[model.credentialKey]?.trim()),
      authorizationService: model.authorizationService,
      unavailableReason: model.unavailableReason ?? null,
      capabilities: model.capabilities,
      parameters: model.parameters,
    }));
    const defaultModel = models.find((model) => model.available && model.configured)?.id ?? DEFAULT_IMAGE_MODEL_ID;
    const configured = models.some((model) => model.available && model.configured);
    return { configured, connected: configured, model: defaultModel, defaultModel, models, error: null };
  } catch (error) {
    return {
      configured: false,
      connected: false,
      model: DEFAULT_IMAGE_MODEL_ID,
      defaultModel: DEFAULT_IMAGE_MODEL_ID,
      models: IMAGE_MODELS.map((model) => ({
        id: model.id,
        label: model.label,
        provider: model.provider,
        providerLabel: model.providerLabel,
        available: model.available,
        configured: false,
        authorizationService: model.authorizationService,
        unavailableReason: model.unavailableReason ?? null,
        capabilities: model.capabilities,
        parameters: model.parameters,
      })),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function workspaceForContext(config: ServerConfig, context: Record<string, unknown>): WorkspaceInfo {
  const candidates = [readStringField(context, "directory"), readStringField(context, "worktree")]
    .filter((value) => value.length > 0)
    .map((value) => resolve(value));

  for (const candidate of candidates) {
    const match = config.workspaces.find((workspace) => {
      const workspaceRoot = resolve(workspace.path);
      return candidate === workspaceRoot || candidate.startsWith(`${workspaceRoot}${sep}`);
    });
    if (match) return { ...match, path: resolve(match.path) };
  }

  const workspace = config.workspaces[0];
  if (!workspace) throw new ApiError(404, "workspace_not_found", "Workspace not found for OpenAI image generation");
  return { ...workspace, path: resolve(workspace.path) };
}

function resolveSafeChildPath(root: string, child: string): string {
  const rootResolved = resolve(root);
  const candidate = resolve(rootResolved, child);
  if (candidate === rootResolved || !candidate.startsWith(`${rootResolved}${sep}`)) {
    throw new ApiError(400, "invalid_path", "Path traversal is not allowed");
  }
  return candidate;
}

function providerRequestError(error: unknown, input: {
  providerLabel: string;
  operation: string;
  timeoutCode: string;
  unavailableCode: string;
}): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new ApiError(
      504,
      input.timeoutCode,
      `${input.providerLabel} ${input.operation} timed out. Check your connection or system proxy and try again.`,
    );
  }
  return new ApiError(
    502,
    input.unavailableCode,
    `Could not reach ${input.providerLabel} for ${input.operation}. Check your connection or system proxy and try again.`,
  );
}

async function fetchOpenAiImage(input: { apiKey: string; model: string; prompt: string; quality: string; size: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await providerFetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: input.model, prompt: input.prompt, quality: input.quality, size: input.size }),
      signal: controller.signal,
    });
  } catch (error) {
    throw providerRequestError(error, {
      providerLabel: "OpenAI",
      operation: "image generation",
      timeoutCode: "openai_image_generation_timeout",
      unavailableCode: "openai_image_generation_unreachable",
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const message = typeof errorPayload?.message === "string"
      ? errorPayload.message
      : isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : "OpenAI image generation failed.";
    throw new ApiError(response.status, "openai_image_generation_failed", message);
  }
  return payload;
}

async function imageDataFromPayload(payload: unknown, providerLabel: string): Promise<Buffer> {
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const first = data.find(isRecord);
  const b64 = typeof first?.b64_json === "string" ? first.b64_json.trim() : "";
  if (b64) return Buffer.from(b64, "base64");
  const url = typeof first?.url === "string" ? first.url.trim() : "";
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new ApiError(502, "image_invalid_response", `${providerLabel} returned an unsafe image URL.`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_API_TIMEOUT_MS);
    try {
      const response = await providerFetch(parsed, { signal: controller.signal });
      if (!response.ok) throw new ApiError(502, "image_download_failed", `${providerLabel} image download failed.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.byteLength > MAX_IMAGE_INPUT_BYTES) {
        throw new ApiError(502, "image_invalid_response", `${providerLabel} returned an empty or oversized image.`);
      }
      return bytes;
    } catch (error) {
      throw providerRequestError(error, {
        providerLabel,
        operation: "image download",
        timeoutCode: "image_download_timeout",
        unavailableCode: "image_download_failed",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new ApiError(502, "image_invalid_response", `${providerLabel} did not return image data.`);
}

function imageMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    default: throw new ApiError(400, "invalid_image", "sourcePath must point to a PNG, JPEG, or WebP image");
  }
}

function decodedPngDataUrl(value: string): Buffer | null {
  if (!value) return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match?.[1]) throw new ApiError(400, "invalid_mask", "maskDataUrl must be a base64 PNG data URL");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length || bytes.byteLength > MAX_IMAGE_INPUT_BYTES) {
    throw new ApiError(413, "invalid_mask", "Image mask is empty or too large");
  }
  return bytes;
}

function imageOption(model: ImageModelDefinition, args: Record<string, unknown>, key: "size" | "quality"): string {
  const value = args[key];
  const parameter = model.parameters[key];
  // Existing callers send auto for omitted controls; resolve it to this model's default.
  if (value === undefined || value === "auto") return parameter?.default ?? "auto";
  if (typeof value !== "string" || !(parameter?.values.includes(value) || (key === "size" && parameter?.customRatio && /^[1-9]\d{0,2}x[1-9]\d{0,2}$/.test(value)))) {
    throw new ApiError(400, "image_parameter_unsupported", `${model.label} does not support ${key}=${String(value)}. Allowed: ${parameter?.values.join(", ") || "auto (provider managed)"}.`);
  }
  return value;
}

function blobBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return bytes;
}

async function fetchOpenAiImageEdit(input: {
  apiKey: string;
  model: string;
  image: Buffer;
  imageName: string;
  imageType: string;
  mask: Buffer | null;
  prompt: string;
  quality: string;
  size: string;
}) {
  const form = new FormData();
  form.append("model", input.model);
  form.append("prompt", input.prompt);
  form.append("quality", input.quality);
  form.append("size", input.size);
  form.append("image", new Blob([blobBytes(input.image)], { type: input.imageType }), input.imageName);
  if (input.mask) form.append("mask", new Blob([blobBytes(input.mask)], { type: "image/png" }), "selection-mask.png");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await providerFetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    throw providerRequestError(error, {
      providerLabel: "OpenAI",
      operation: "image editing",
      timeoutCode: "openai_image_edit_timeout",
      unavailableCode: "openai_image_edit_unreachable",
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const message = typeof errorPayload?.message === "string" ? errorPayload.message : "OpenAI image editing failed.";
    throw new ApiError(response.status, "openai_image_edit_failed", message);
  }
  return payload;
}

function providerErrorMessage(payload: unknown, fallback: string): string {
  const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  if (typeof errorPayload?.message === "string") return errorPayload.message;
  if (isRecord(payload) && typeof payload.message === "string") return payload.message;
  return fallback;
}

async function fetchArkImage(input: {
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  image?: { bytes: Buffer; mimeType: string };
  selectionGuide?: Buffer;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_API_TIMEOUT_MS);
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    response_format: "b64_json",
    output_format: "png",
    watermark: false,
  };
  if (input.size !== "auto") body.size = input.size;
  if (input.image) body.image = `data:${input.image.mimeType};base64,${input.image.bytes.toString("base64")}`;
  if (input.image && input.selectionGuide) body.image = [body.image, `data:image/png;base64,${input.selectionGuide.toString("base64")}`];

  let response: Response;
  try {
    response = await providerFetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw providerRequestError(error, {
      providerLabel: "Volcengine Ark",
      operation: "image generation",
      timeoutCode: "ark_image_generation_timeout",
      unavailableCode: "ark_image_generation_unreachable",
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, "ark_image_generation_failed", providerErrorMessage(payload, "Volcengine Ark image generation failed."));
  }
  return payload;
}

async function generateWithModel(model: ImageModelDefinition, apiKey: string, args: Record<string, unknown>, prompt: string, authorization: AuthorizationAccess) {
  const size = imageOption(model, args, "size");
  const quality = imageOption(model, args, "quality");
  if (model.adapter === "openai-codex") {
    const bytes = await generateCodexImage(authorization, { prompt, size, quality });
    return { data: [{ b64_json: bytes.toString("base64") }] };
  }
  if (model.adapter === "openai") {
    return fetchOpenAiImage({
      apiKey,
      model: model.upstreamModel,
      prompt,
      quality,
      size,
    });
  }
  if (model.adapter === "volcengine-ark") {
    return fetchArkImage({ apiKey, model: model.upstreamModel, prompt, size });
  }
  throw new ApiError(400, "image_model_unavailable", model.unavailableReason ?? `${model.label} is not available.`);
}

async function editWithModel(model: ImageModelDefinition, apiKey: string, args: Record<string, unknown>, input: {
  image: Buffer;
  imageName: string;
  imageType: string;
  mask: Buffer | null;
  selectionBounds: NormalizedSelectionBounds | null;
  selectionGuide?: Buffer;
  prompt: string;
}, authorization: AuthorizationAccess) {
  const size = imageOption(model, args, "size");
  const quality = imageOption(model, args, "quality");
  if (input.mask && !model.capabilities.mask) {
    if (!model.capabilities.region) {
      throw new ApiError(400, "image_model_region_unsupported", `${model.label} does not support selected-region editing.`);
    }
  }
  if (model.adapter === "openai-codex") {
    const bytes = await generateCodexImage(authorization, {
      prompt: selectionPrompt(input),
      size,
      quality,
      image: { bytes: input.image, mimeType: input.imageType },
      selectionGuide: input.selectionGuide,
    });
    return { data: [{ b64_json: bytes.toString("base64") }] };
  }
  if (model.adapter === "openai") {
    return fetchOpenAiImageEdit({
      apiKey,
      model: model.upstreamModel,
      ...input,
      prompt: selectionPrompt({ ...input, selectionGuide: undefined }),
      quality,
      size,
    });
  }
  if (model.adapter === "volcengine-ark") {
    return fetchArkImage({
      apiKey,
      model: model.upstreamModel,
      prompt: selectionPrompt(input),
      size,
      image: { bytes: input.image, mimeType: input.imageType },
      selectionGuide: input.selectionGuide,
    });
  }
  throw new ApiError(400, "image_model_unavailable", model.unavailableReason ?? `${model.label} is not available.`);
}

async function saveImageArtifact(workspace: WorkspaceInfo, fileName: string, bytes: Buffer): Promise<string> {
  const directory = await resolveWithinRoot(workspace.path, "artifacts");
  await mkdir(directory, { recursive: true });
  let path = `artifacts/${fileName}`;
  try {
    await writeFile(resolveSafeChildPath(workspace.path, path), bytes, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    path = `artifacts/${basename(fileName, ".png")}-${randomUUID()}.png`;
    await writeFile(resolveSafeChildPath(workspace.path, path), bytes, { flag: "wx" });
  }
  return path;
}

async function generateImageArtifact(config: ServerConfig, authorization: AuthorizationAccess, args: Record<string, unknown>, context: Record<string, unknown>) {
  const prompt = readStringField(args, "prompt");
  if (!prompt) throw new ApiError(400, "invalid_payload", "prompt is required");
  const model = await modelForId(readStringField(args, "model"), authorization);
  if (!model.capabilities.generate) throw new ApiError(400, "image_model_capability_unavailable", `${model.label} does not support image generation.`);
  const apiKey = await modelCredential(authorization, model);
  if (!apiKey && model.adapter !== "openai-codex") throw new ApiError(400, "image_model_authorization_missing", modelMissingAuthorizationMessage(model));

  const workspace = workspaceForContext(config, context);
  const requestedName = readStringField(args, "filename");
  const fileName = requestedName
    ? `${slugifyImageArtifactName(requestedName)}.png`
    : `${slugifyImageArtifactName(prompt)}-${randomUUID()}.png`;
  const payload = await generateWithModel(model, apiKey, args, prompt, authorization);
  const bytes = await imageDataFromPayload(payload, model.providerLabel);
  const relativePath = await saveImageArtifact(workspace, fileName, bytes);
  const dimensions = await sharp(bytes).metadata().catch(() => null);

  return {
    path: relativePath,
    bytes: bytes.byteLength,
    width: dimensions?.width,
    height: dimensions?.height,
    model: model.id,
    modelLabel: model.label,
    provider: model.provider,
    workspaceId: workspace.id,
  };
}

async function editImageArtifact(config: ServerConfig, authorization: AuthorizationAccess, args: Record<string, unknown>, context: Record<string, unknown>) {
  const sourcePath = readStringField(args, "sourcePath");
  const prompt = readStringField(args, "prompt");
  if (!sourcePath || !prompt) throw new ApiError(400, "invalid_payload", "sourcePath and prompt are required");

  const model = await modelForId(readStringField(args, "model"), authorization);
  if (!model.capabilities.edit) throw new ApiError(400, "image_model_capability_unavailable", `${model.label} does not support image editing.`);
  const apiKey = await modelCredential(authorization, model);
  if (!apiKey && model.adapter !== "openai-codex") throw new ApiError(400, "image_model_authorization_missing", modelMissingAuthorizationMessage(model));

  const workspace = workspaceForContext(config, context);
  const sourceCandidate = resolveSafeChildPath(workspace.path, sourcePath);
  if (args.reviewResult !== undefined && typeof args.reviewResult !== "boolean") throw new ApiError(400, "invalid_payload", "reviewResult must be a boolean");
  const review = args.reviewResult === true;
  if (review) sessionArtifactOwner(context.sessionId);
  const sourceHash = review ? await validateImageEditSource(workspace, sourcePath, args.sourceRevision) : null;
  const selectionId = readStringField(args, "selectionId");
  const frozen = selectionId ? await loadImageSelection(config, workspace, context.sessionId, selectionId) : null;
  if (frozen && frozen.sourcePath !== sourcePath) throw new ApiError(400, "selection_source_mismatch", "Selection belongs to another source image");
  let image: Buffer;
  if (frozen) image = frozen.image;
  else {
    const sourceFile = await realpath(await resolveWithinRoot(workspace.path, sourceCandidate));
    const sourceStats = await stat(sourceFile);
    if (!sourceStats.isFile()) throw new ApiError(400, "invalid_path", "Source path must point to a file");
    if (!sourceStats.size || sourceStats.size > MAX_IMAGE_INPUT_BYTES) throw new ApiError(413, "invalid_image", "Source image is empty or too large");
    image = await readFile(sourceFile);
  }
  const mask = frozen?.mask ?? decodedPngDataUrl(readStringField(args, "maskDataUrl"));
  const blend = args.selectionBlend ?? "strict";
  if (blend !== "natural" && blend !== "strict") throw new ApiError(400, "invalid_selection_blend", "selectionBlend must be natural or strict");
  const selection = mask ? await prepareImageSelection(image, mask, blend) : null;
  const sourceBaseName = basename(sourcePath, extname(sourcePath));
  const requestedName = readStringField(args, "filename");
  const fileName = requestedName
    ? `${slugifyImageArtifactName(requestedName)}.png`
    : `${sourceBaseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 60) || "image"}-edited-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "")}-${randomUUID().slice(0, 8)}.png`;
  const payload = await editWithModel(model, apiKey, args, {
    image: selection?.image ?? image,
    imageName: selection ? `${sourceBaseName}.png` : basename(sourcePath),
    imageType: selection ? "image/png" : imageMimeType(sourcePath),
    mask: selection?.mask ?? null,
    selectionGuide: selection?.guide,
    selectionBounds: readSelectionBounds(args.selectionBounds),
    prompt,
  }, authorization);
  const generated = await imageDataFromPayload(payload, model.providerLabel);
  const bytes = selection ? await selection.composite(generated) : generated;
  const relativePath = await saveImageArtifact(workspace, fileName, bytes);
  const dimensions = await sharp(bytes).metadata().catch(() => null);
  const reviewInfo = sourceHash ? await rememberImageEditResult(config, workspace, context.sessionId, sourcePath, sourceHash, relativePath, bytes) : {};
  return { path: relativePath, bytes: bytes.byteLength, width: dimensions?.width, height: dimensions?.height, model: model.id, modelLabel: model.label, provider: model.provider, workspaceId: workspace.id, ...reviewInfo };
}

export async function callOpenAiImageGenerationExtensionAction(config: ServerConfig, authorization: AuthorizationAccess, action: string, args: Record<string, unknown>, context: Record<string, unknown>) {
  if (action === "prompt_optimize") {
    const prompt = readStringField(args, "prompt").trim();
    if (!prompt || prompt.length > 8000) throw new ApiError(400, "invalid_prompt", "请输入不超过 8000 字的图片描述。");
    const mediaKind = args.mediaKind === "video" ? "video" : "image";
    const settings: Record<string, string> = {};
    if (args.settings && typeof args.settings === "object" && !Array.isArray(args.settings)) {
      for (const [key, value] of Object.entries(args.settings)) {
        if (["model", "operation", "size", "quality", "style", "camera", "lighting", "pace", "resolution", "duration", "ratio", "generateAudio", "watermark"].includes(key) && typeof value === "string" && value.length <= 200) settings[key] = value;
      }
    }
    const referencePath = readStringField(args, "referencePath");
    let image: { bytes: Buffer; mimeType: string } | undefined;
    if (referencePath) {
      const path = await resolveWithinRoot(workspaceForContext(config, context).path, referencePath);
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_IMAGE_INPUT_BYTES) throw new ApiError(400, "invalid_image", "参考图过大或不可用。");
      image = { bytes: await readFile(path), mimeType: imageMimeType(path) };
    }
    return { ok: true, extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID, action, result: { prompt: await optimizeCodexImagePrompt(authorization, { prompt, image, mediaKind, settings }) } };
  }
  if (action === "image_edit_save") {
    if (config.readOnly) throw new ApiError(403, "read_only", "Workspace is read-only");
    const result = await saveImageEditResult(config, workspaceForContext(config, context), context.sessionId, args.editId, args.mode);
    return { ok: true, extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID, action, path: result.path, result, context };
  }
  if (action === "selection_capture") {
    const workspace = workspaceForContext(config, context);
    const sourcePath = readStringField(args, "sourcePath");
    resolveSafeChildPath(workspace.path, sourcePath);
    const image = decodedPngDataUrl(readStringField(args, "sourceDataUrl"));
    const mask = decodedPngDataUrl(readStringField(args, "maskDataUrl"));
    if (!image || !mask) throw new ApiError(400, "invalid_selection", "Source PNG and selection mask are required");
    const selection = await prepareImageSelection(image, mask);
    const selectionId = await saveImageSelection(config, workspace, context.sessionId, sourcePath, selection.image, selection.mask);
    return { ok: true, extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID, action, result: { selectionId, sourcePath }, context };
  }
  // Capture and validate ownership before a long-running provider request.
  const sessionId = (action === "image_generate" || action === "image_edit") && context.sessionId
    ? sessionArtifactOwner(context.sessionId)
    : null;
  if (action === "status") {
    return {
      ok: true,
      extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
      action,
      result: await openAiImageGenerationStatus(authorization),
      context,
    };
  }
  if (action === "image_generate") {
    const result = await generateImageArtifact(config, authorization, args, context);
    if (sessionId) await recordSessionArtifact(config, workspaceForContext(config, context), sessionId, result.path, undefined, {
      id: randomUUID(), kind: "image", model: result.modelLabel, completedAt: Date.now(), width: result.width, height: result.height,
    });
    return {
      ok: true,
      extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
      action,
      path: result.path,
      result,
      context,
    };
  }
  if (action === "image_edit") {
    const result = await editImageArtifact(config, authorization, args, context);
    if (sessionId) await recordSessionArtifact(config, workspaceForContext(config, context), sessionId, result.path, undefined, {
      id: randomUUID(), kind: "image", model: result.modelLabel, completedAt: Date.now(), width: result.width, height: result.height,
    });
    return {
      ok: true,
      extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
      action,
      path: result.path,
      result,
      context,
    };
  }
  return null;
}
