import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ApiError } from "../errors.js";
import type { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";
import { resolveWorkspaceFile, workspaceForContext } from "./storage.js";

export const MINIMAX_EXTENSION_ID = "minimax";
export const MINIMAX_IMAGE_MODEL_REGISTRY = {
  defaultModel: "image-01",
  models: ["image-01", "image-01-live"],
} as const;
export const MINIMAX_IMAGE_ENDPOINT_REGISTRY = [
  { region: "global_en", url: "https://api.minimax.io/v1/image_generation" },
  { region: "cn_zh", url: "https://api.minimaxi.com/v1/image_generation" },
] as const;

const MINIMAX_IMAGE_TIMEOUT_MS = 60_000;
const MINIMAX_IMAGE_RESPONSE_FORMATS = ["url", "base64"] as const;

type JsonRecord = Record<string, unknown>;
type MiniMaxImageModel = (typeof MINIMAX_IMAGE_MODEL_REGISTRY.models)[number];
type MiniMaxImageRegion = (typeof MINIMAX_IMAGE_ENDPOINT_REGISTRY)[number]["region"];
type MiniMaxImageResponseFormat = (typeof MINIMAX_IMAGE_RESPONSE_FORMATS)[number];

export const MINIMAX_EXTENSION_ACTIONS = [
  {
    extensionId: MINIMAX_EXTENSION_ID,
    action: "status",
    title: "MiniMax image generation status",
    description: "Check whether MiniMax image generation is configured and ready for iPolloWork extension actions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    extensionId: MINIMAX_EXTENSION_ID,
    action: "image_generate",
    title: "Generate MiniMax image artifacts",
    description: "Generate workspace image artifacts from a text prompt with MiniMax image generation.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image prompt to turn into workspace artifacts." },
        model: { type: "string", enum: [...MINIMAX_IMAGE_MODEL_REGISTRY.models], description: "Optional MiniMax image model." },
        region: { type: "string", enum: MINIMAX_IMAGE_ENDPOINT_REGISTRY.map((entry) => entry.region), description: "Optional regional endpoint." },
        filename: { type: "string", description: "Optional output filename without extension." },
        aspectRatio: { type: "string", description: "Optional aspect_ratio value." },
        width: { type: "integer", description: "Optional output width." },
        height: { type: "integer", description: "Optional output height." },
        responseFormat: { type: "string", enum: [...MINIMAX_IMAGE_RESPONSE_FORMATS], description: "Optional response format. Defaults to base64." },
        seed: { type: "integer", description: "Optional deterministic seed." },
        n: { type: "integer", description: "Optional number of images." },
        promptOptimizer: { type: "boolean", description: "Optional prompt_optimizer value." },
      },
      required: ["prompt"],
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

function readOptionalNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function readOptionalBoolean(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function readInteger(value: unknown, key: string, positive = false): number | undefined {
  const result = readOptionalNumber(value, key);
  if (result === undefined) return undefined;
  if (!Number.isInteger(result) || (positive && result <= 0)) {
    throw new ApiError(400, "invalid_payload", `${key} must be ${positive ? "a positive " : "an "}integer`);
  }
  return result;
}

function isMiniMaxImageModel(value: string): value is MiniMaxImageModel {
  return MINIMAX_IMAGE_MODEL_REGISTRY.models.some((model) => model === value);
}

function isMiniMaxImageRegion(value: string): value is MiniMaxImageRegion {
  return MINIMAX_IMAGE_ENDPOINT_REGISTRY.some((endpoint) => endpoint.region === value);
}

function isMiniMaxImageResponseFormat(value: string): value is MiniMaxImageResponseFormat {
  return MINIMAX_IMAGE_RESPONSE_FORMATS.some((format) => format === value);
}

function regionFromBaseUrl(value: string): MiniMaxImageRegion {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "invalid_minimax_base_url", "MINIMAX_BASE_URL must be a valid MiniMax HTTPS URL");
  }
  const allowedPaths = new Set(["/", "/v1", "/anthropic"]);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !allowedPaths.has(url.pathname)) {
    throw new ApiError(400, "invalid_minimax_base_url", "MINIMAX_BASE_URL must be a trusted MiniMax HTTPS endpoint");
  }
  if (url.hostname === "api.minimax.io") return "global_en";
  if (url.hostname === "api.minimaxi.com") return "cn_zh";
  throw new ApiError(400, "invalid_minimax_base_url", "MINIMAX_BASE_URL must use an official MiniMax API host");
}

function endpointFor(region: MiniMaxImageRegion) {
  const endpoint = MINIMAX_IMAGE_ENDPOINT_REGISTRY.find((entry) => entry.region === region);
  if (!endpoint) throw new ApiError(400, "invalid_minimax_region", "MiniMax image region is not supported");
  return endpoint;
}

function requestedRegion(value: string): MiniMaxImageRegion | null {
  if (!value) return null;
  if (!isMiniMaxImageRegion(value)) {
    throw new ApiError(
      400,
      "invalid_minimax_region",
      `region must be one of: ${MINIMAX_IMAGE_ENDPOINT_REGISTRY.map((entry) => entry.region).join(", ")}`,
    );
  }
  return value;
}

async function readMiniMaxEnvironment(env: EnvService) {
  const values = new Map((await env.list()).map((entry) => [entry.key, entry.value.trim()] as const));
  return {
    apiKey: values.get("MINIMAX_API_KEY") || process.env.MINIMAX_API_KEY?.trim() || "",
    baseUrl: values.get("MINIMAX_BASE_URL") || process.env.MINIMAX_BASE_URL?.trim() || "",
  };
}

async function resolveMiniMaxImageCredentials(env: EnvService, regionValue: string) {
  const environment = await readMiniMaxEnvironment(env);
  if (!environment.apiKey) {
    throw new ApiError(400, "minimax_api_key_missing", "MiniMax API key missing. Configure MiniMax before generating images.");
  }
  const region = requestedRegion(regionValue)
    ?? (environment.baseUrl ? regionFromBaseUrl(environment.baseUrl) : "global_en");
  return { apiKey: environment.apiKey, endpoint: endpointFor(region) };
}

function mediaProviderFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const desktopFetch: unknown = Reflect.get(globalThis, Symbol.for("ipollowork.mediaProviderFetch"));
  return typeof desktopFetch === "function"
    ? (desktopFetch as typeof fetch)(input, init)
    : fetch(input, init);
}

function minimaxErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const baseResp = isRecord(payload.base_resp) ? payload.base_resp : null;
  return readStringField(baseResp, "status_msg") || readStringField(payload, "message");
}

async function requestMiniMaxImages(input: {
  apiKey: string;
  endpoint: string;
  body: JsonRecord;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MINIMAX_IMAGE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await mediaProviderFetch(input.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "minimax_image_timeout", "MiniMax image generation timed out.");
    }
    throw new ApiError(502, "minimax_image_unreachable", "Could not reach MiniMax image generation.");
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  const baseResp = isRecord(payload) && isRecord(payload.base_resp) ? payload.base_resp : null;
  const statusCode = readOptionalNumber(baseResp, "status_code");
  if (!response.ok || (statusCode !== undefined && statusCode !== 0)) {
    const status = response.ok ? 502 : response.status;
    const suffix = statusCode === undefined ? "" : ` (status_code ${statusCode})`;
    throw new ApiError(
      status,
      "minimax_image_generation_failed",
      minimaxErrorMessage(payload) || `MiniMax image generation failed${suffix}.`,
    );
  }
  return payload;
}

function imageValuesFromPayload(payload: unknown): string[] {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const values = data && Array.isArray(data.image_urls)
    ? data.image_urls
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    : [];
  if (!values.length) {
    throw new ApiError(502, "minimax_image_invalid_response", "MiniMax did not return image data.");
  }
  return values;
}

async function downloadImage(urlValue: string): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new ApiError(502, "minimax_image_invalid_response", "MiniMax returned an invalid image URL.");
  }
  if (url.protocol !== "https:") {
    throw new ApiError(502, "minimax_image_invalid_response", "MiniMax returned a non-HTTPS image URL.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MINIMAX_IMAGE_TIMEOUT_MS);
  try {
    const response = await mediaProviderFetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new ApiError(
        response.status,
        "minimax_image_download_failed",
        `MiniMax image download failed (HTTP ${response.status}).`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "minimax_image_download_timeout", "MiniMax image download timed out.");
    }
    throw new ApiError(502, "minimax_image_download_failed", "Could not download the generated MiniMax image.");
  } finally {
    clearTimeout(timeout);
  }
}

async function imageBytes(value: string): Promise<Buffer> {
  if (value.startsWith("https://")) return downloadImage(value);
  const comma = value.indexOf(",");
  const encoded = value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
  if (!encoded || !/^[A-Za-z0-9+/=\s]+$/.test(encoded)) {
    throw new ApiError(502, "minimax_image_invalid_response", "MiniMax returned invalid base64 image data.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.byteLength) {
    throw new ApiError(502, "minimax_image_invalid_response", "MiniMax returned empty image data.");
  }
  return bytes;
}

function imageFileExtension(bytes: Buffer): "gif" | "jpg" | "png" | "webp" {
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "webp";
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "gif";
  throw new ApiError(502, "minimax_image_invalid_response", "MiniMax returned an unsupported image format.");
}

function slugifyImageArtifactName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "minimax-image";
}

function requestBody(args: JsonRecord) {
  const prompt = readStringField(args, "prompt");
  if (!prompt) throw new ApiError(400, "invalid_payload", "prompt is required");
  const requestedModel = readStringField(args, "model");
  if (requestedModel && !isMiniMaxImageModel(requestedModel)) {
    throw new ApiError(
      400,
      "invalid_minimax_image_model",
      `model must be one of: ${MINIMAX_IMAGE_MODEL_REGISTRY.models.join(", ")}`,
    );
  }
  const model = requestedModel || MINIMAX_IMAGE_MODEL_REGISTRY.defaultModel;
  const requestedResponseFormat = readStringField(args, "responseFormat");
  if (requestedResponseFormat && !isMiniMaxImageResponseFormat(requestedResponseFormat)) {
    throw new ApiError(
      400,
      "invalid_minimax_response_format",
      `responseFormat must be one of: ${MINIMAX_IMAGE_RESPONSE_FORMATS.join(", ")}`,
    );
  }
  const responseFormat = requestedResponseFormat || "base64";
  const aspectRatio = readStringField(args, "aspectRatio");
  const width = readInteger(args, "width", true);
  const height = readInteger(args, "height", true);
  const seed = readInteger(args, "seed");
  const count = readInteger(args, "n", true);
  const promptOptimizer = readOptionalBoolean(args, "promptOptimizer");
  return {
    model,
    prompt,
    responseFormat,
    body: {
      model,
      prompt,
      response_format: responseFormat,
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(seed === undefined ? {} : { seed }),
      ...(count === undefined ? {} : { n: count }),
      ...(promptOptimizer === undefined ? {} : { prompt_optimizer: promptOptimizer }),
    },
  };
}

async function generateMiniMaxImageArtifacts(
  config: ServerConfig,
  env: EnvService,
  args: JsonRecord,
  context: JsonRecord,
) {
  const request = requestBody(args);
  const credentials = await resolveMiniMaxImageCredentials(env, readStringField(args, "region"));
  const payload = await requestMiniMaxImages({
    apiKey: credentials.apiKey,
    endpoint: credentials.endpoint.url,
    body: request.body,
  });
  const values = imageValuesFromPayload(payload);
  const workspace = workspaceForContext(config, context);
  const baseName = slugifyImageArtifactName(readStringField(args, "filename") || request.prompt);
  const artifacts: Array<{ path: string; bytes: number }> = [];
  for (const [index, value] of values.entries()) {
    const bytes = await imageBytes(value);
    const suffix = values.length === 1 ? "" : `-${index + 1}`;
    const relativePath = `artifacts/${baseName}${suffix}.${imageFileExtension(bytes)}`;
    const output = resolveWorkspaceFile(workspace.path, relativePath);
    await mkdir(dirname(output.absolutePath), { recursive: true });
    await writeFile(output.absolutePath, bytes);
    artifacts.push({ path: output.relativePath, bytes: bytes.byteLength });
  }
  const firstArtifact = artifacts[0];
  if (!firstArtifact) {
    throw new ApiError(502, "minimax_image_invalid_response", "MiniMax did not produce an image artifact.");
  }
  const metadata = isRecord(payload) && isRecord(payload.metadata) ? payload.metadata : null;
  return {
    path: firstArtifact.path,
    artifacts,
    model: request.model,
    region: credentials.endpoint.region,
    responseFormat: request.responseFormat,
    metadata: {
      successCount: readOptionalNumber(metadata, "success_count"),
      failedCount: readOptionalNumber(metadata, "failed_count"),
    },
    workspaceId: workspace.id,
  };
}

export async function miniMaxImageGenerationStatus(env: EnvService) {
  try {
    const environment = await readMiniMaxEnvironment(env);
    const region = environment.baseUrl ? regionFromBaseUrl(environment.baseUrl) : "global_en";
    return {
      configured: Boolean(environment.apiKey),
      connected: Boolean(environment.apiKey),
      defaultModel: MINIMAX_IMAGE_MODEL_REGISTRY.defaultModel,
      models: [...MINIMAX_IMAGE_MODEL_REGISTRY.models],
      region,
      endpoint: endpointFor(region).url,
      error: null,
    };
  } catch (error) {
    return {
      configured: false,
      connected: false,
      defaultModel: MINIMAX_IMAGE_MODEL_REGISTRY.defaultModel,
      models: [...MINIMAX_IMAGE_MODEL_REGISTRY.models],
      region: "global_en" as const,
      endpoint: endpointFor("global_en").url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function callMiniMaxExtensionAction(
  config: ServerConfig,
  env: EnvService,
  action: string,
  args: JsonRecord,
  context: JsonRecord,
) {
  if (action === "status") {
    return {
      ok: true,
      extensionId: MINIMAX_EXTENSION_ID,
      action,
      result: await miniMaxImageGenerationStatus(env),
      context,
    };
  }
  if (action === "image_generate") {
    const result = await generateMiniMaxImageArtifacts(config, env, args, context);
    return {
      ok: true,
      extensionId: MINIMAX_EXTENSION_ID,
      action,
      path: result.path,
      result,
      context,
    };
  }
  return null;
}
