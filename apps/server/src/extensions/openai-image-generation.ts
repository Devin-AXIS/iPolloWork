import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve, sep } from "node:path";

import { ApiError } from "../errors.js";
import type { AuthorizationAccess, AuthorizationServiceId } from "../authorization-center.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";

export const OPENAI_IMAGE_GENERATION_EXTENSION_ID = "openai-image-generation";
const IMAGE_API_TIMEOUT_MS = 120_000;
const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;

type ImageModelAdapterId = "openai" | "volcengine-ark" | "unavailable";

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
    label: "GPT Image 2",
    provider: "openai",
    providerLabel: "OpenAI",
    adapter: "openai",
    upstreamModel: "gpt-image-2",
    authorizationService: "openai-images",
    credentialKey: "OPENAI_API_KEY",
    available: true,
    capabilities: { generate: true, edit: true, mask: true, region: true },
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
    unavailableReason: "Midjourney 官方暂未开放公共 API，当前不能在第三方工作台中直接调用。",
    capabilities: { generate: false, edit: false, mask: false, region: false },
  },
] as const;

const DEFAULT_IMAGE_MODEL_ID = IMAGE_MODELS[0].id;

export const OPENAI_IMAGE_GENERATION_EXTENSION_ACTIONS = [
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
    description: "Generate a PNG image artifact using a registered image model.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image prompt to turn into an artifact." },
        model: { type: "string", description: "Stable image model ID returned by status." },
        filename: { type: "string", description: "Optional output filename without extension." },
        quality: { type: "string", enum: ["low", "medium", "high", "auto"] },
        size: { type: "string", enum: ["1024x1024", "1024x1536", "1536x1024", "auto"] },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID,
    action: "image_edit",
    title: "Edit image artifact",
    description: "Edit a workspace image with an optional transparent PNG mask and save the result as a new PNG artifact.",
    effect: "write" as const,
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Workspace-relative PNG, JPEG, or WebP source path." },
        prompt: { type: "string", description: "Describe the requested change." },
        model: { type: "string", description: "Stable image model ID returned by status." },
        maskDataUrl: { type: "string", description: "Optional PNG data URL whose transparent pixels identify the edit area." },
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
        quality: { type: "string", enum: ["low", "medium", "high", "auto"] },
        size: { type: "string", enum: ["1024x1024", "1024x1536", "1536x1024", "auto"] },
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

function slugifyImageArtifactName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "ipollowork-image";
}

function modelForId(value: string): ImageModelDefinition {
  const requested = value || DEFAULT_IMAGE_MODEL_ID;
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
    const models = IMAGE_MODELS.map((model) => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      providerLabel: model.providerLabel,
      available: model.available,
      configured: Boolean(model.authorizationService && model.credentialKey && credentials.get(model.authorizationService)?.[model.credentialKey]?.trim()),
      authorizationService: model.authorizationService,
      unavailableReason: model.unavailableReason ?? null,
      capabilities: model.capabilities,
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

async function fetchOpenAiImage(input: { apiKey: string; model: string; prompt: string; quality: string; size: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: input.model, prompt: input.prompt, quality: input.quality, size: input.size }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenAI image generation timed out. Check your connection and try again.");
    }
    throw error;
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
      const response = await fetch(parsed, { signal: controller.signal });
      if (!response.ok) throw new ApiError(502, "image_download_failed", `${providerLabel} image download failed.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.byteLength > MAX_IMAGE_INPUT_BYTES) {
        throw new ApiError(502, "image_invalid_response", `${providerLabel} returned an empty or oversized image.`);
      }
      return bytes;
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

function imageOption(value: string, allowed: readonly string[], fallback: string): string {
  return allowed.includes(value) ? value : fallback;
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
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenAI image editing timed out. Check your connection and try again.");
    }
    throw error;
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
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_API_TIMEOUT_MS);
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    response_format: "b64_json",
    watermark: false,
  };
  if (input.size !== "auto") body.size = input.size;
  if (input.image) body.image = `data:${input.image.mimeType};base64,${input.image.bytes.toString("base64")}`;

  let response: Response;
  try {
    response = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
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
      throw new Error("Volcengine Ark image generation timed out. Check your connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, "ark_image_generation_failed", providerErrorMessage(payload, "Volcengine Ark image generation failed."));
  }
  return payload;
}

async function generateWithModel(model: ImageModelDefinition, apiKey: string, args: Record<string, unknown>, prompt: string) {
  const size = imageOption(readStringField(args, "size"), ["1024x1024", "1024x1536", "1536x1024", "auto"], "auto");
  if (model.adapter === "openai") {
    return fetchOpenAiImage({
      apiKey,
      model: model.upstreamModel,
      prompt,
      quality: imageOption(readStringField(args, "quality"), ["low", "medium", "high", "auto"], "auto"),
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
  prompt: string;
}) {
  const size = imageOption(readStringField(args, "size"), ["1024x1024", "1024x1536", "1536x1024", "auto"], "auto");
  if (input.mask && !model.capabilities.mask) {
    if (!model.capabilities.region) {
      throw new ApiError(400, "image_model_region_unsupported", `${model.label} does not support selected-region editing.`);
    }
    if (!input.selectionBounds) {
      throw new ApiError(400, "image_selection_bounds_required", `${model.label} requires selectionBounds for approximate selected-region editing.`);
    }
  }
  if (model.adapter === "openai") {
    return fetchOpenAiImageEdit({
      apiKey,
      model: model.upstreamModel,
      ...input,
      quality: imageOption(readStringField(args, "quality"), ["low", "medium", "high", "auto"], "auto"),
      size,
    });
  }
  if (model.adapter === "volcengine-ark") {
    return fetchArkImage({
      apiKey,
      model: model.upstreamModel,
      prompt: input.selectionBounds && !model.capabilities.mask
        ? promptWithApproximateRegion(input.prompt, input.selectionBounds)
        : input.prompt,
      size,
      image: { bytes: input.image, mimeType: input.imageType },
    });
  }
  throw new ApiError(400, "image_model_unavailable", model.unavailableReason ?? `${model.label} is not available.`);
}

async function generateImageArtifact(config: ServerConfig, authorization: AuthorizationAccess, args: Record<string, unknown>, context: Record<string, unknown>) {
  const prompt = readStringField(args, "prompt");
  if (!prompt) throw new ApiError(400, "invalid_payload", "prompt is required");
  const model = modelForId(readStringField(args, "model"));
  if (!model.capabilities.generate) throw new ApiError(400, "image_model_capability_unavailable", `${model.label} does not support image generation.`);
  const apiKey = await modelCredential(authorization, model);
  if (!apiKey) throw new ApiError(400, "image_model_authorization_missing", modelMissingAuthorizationMessage(model));

  const workspace = workspaceForContext(config, context);
  const fileName = `${slugifyImageArtifactName(readStringField(args, "filename") || prompt)}.png`;
  const relativePath = `artifacts/${fileName}`;
  const outputPath = resolveSafeChildPath(workspace.path, relativePath);
  const payload = await generateWithModel(model, apiKey, args, prompt);
  const bytes = await imageDataFromPayload(payload, model.providerLabel);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);

  return {
    path: relativePath,
    bytes: bytes.byteLength,
    model: model.id,
    provider: model.provider,
    workspaceId: workspace.id,
  };
}

async function editImageArtifact(config: ServerConfig, authorization: AuthorizationAccess, args: Record<string, unknown>, context: Record<string, unknown>) {
  const sourcePath = readStringField(args, "sourcePath");
  const prompt = readStringField(args, "prompt");
  if (!sourcePath || !prompt) throw new ApiError(400, "invalid_payload", "sourcePath and prompt are required");

  const model = modelForId(readStringField(args, "model"));
  if (!model.capabilities.edit) throw new ApiError(400, "image_model_capability_unavailable", `${model.label} does not support image editing.`);
  const apiKey = await modelCredential(authorization, model);
  if (!apiKey) throw new ApiError(400, "image_model_authorization_missing", modelMissingAuthorizationMessage(model));

  const workspace = workspaceForContext(config, context);
  const sourceFile = resolveSafeChildPath(workspace.path, sourcePath);
  const image = await readFile(sourceFile);
  if (!image.length || image.byteLength > MAX_IMAGE_INPUT_BYTES) {
    throw new ApiError(413, "invalid_image", "Source image is empty or too large");
  }
  const sourceBaseName = basename(sourcePath, extname(sourcePath));
  const requestedName = readStringField(args, "filename");
  const fileName = `${slugifyImageArtifactName(requestedName || `${sourceBaseName}-edited-${Date.now()}`)}.png`;
  const relativePath = `artifacts/${fileName}`;
  const outputPath = resolveSafeChildPath(workspace.path, relativePath);
  const payload = await editWithModel(model, apiKey, args, {
    image,
    imageName: basename(sourcePath),
    imageType: imageMimeType(sourcePath),
    mask: decodedPngDataUrl(readStringField(args, "maskDataUrl")),
    selectionBounds: readSelectionBounds(args.selectionBounds),
    prompt,
  });
  const bytes = await imageDataFromPayload(payload, model.providerLabel);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  return { path: relativePath, bytes: bytes.byteLength, model: model.id, provider: model.provider, workspaceId: workspace.id };
}

export async function callOpenAiImageGenerationExtensionAction(config: ServerConfig, authorization: AuthorizationAccess, action: string, args: Record<string, unknown>, context: Record<string, unknown>) {
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
