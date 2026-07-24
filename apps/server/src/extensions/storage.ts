import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";

import { ApiError } from "../errors.js";
import type { EnvService } from "../env-file.js";
import {
  createAliyunOssV4PresignedGetUrl,
  createAliyunOssV4Request,
  createS3V4PresignedGetUrl,
  createS3V4Request,
  sha256,
} from "../object-storage-signing.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";

export const STORAGE_EXTENSION_ID = "storage";

const MAX_WORKSPACE_UPLOAD_BYTES = 100 * 1024 * 1024;
const STORAGE_TIMEOUT_MS = 120_000;
const STORAGE_PROVIDERS = ["aliyun-oss", "wasabi"] as const;

type StorageProviderId = (typeof STORAGE_PROVIDERS)[number];
type JsonRecord = Record<string, unknown>;
type StorageValues = Map<string, string>;

export const STORAGE_EXTENSION_ACTIONS = [
  {
    extensionId: STORAGE_EXTENSION_ID,
    action: "status",
    title: "Storage Center status",
    description: "Show the configured object-storage providers and the provider selected for automatic uploads.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    extensionId: STORAGE_EXTENSION_ID,
    action: "upload_workspace_file",
    title: "Upload workspace file",
    description: "Upload one file from the active iPolloWork workspace to the selected object-storage provider. The local artifact stays in place.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Relative path of a file in the active workspace." },
        provider: { type: "string", enum: ["auto", ...STORAGE_PROVIDERS], description: "Optional storage provider. Defaults to the saved route or first configured provider." },
        objectKey: { type: "string", description: "Optional object key. Defaults to ipollowork/<workspace>/<source path>." },
        contentType: { type: "string", description: "Optional MIME type. Defaults from the file extension." },
      },
      required: ["sourcePath"],
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

function requireString(value: unknown, key: string): string {
  const result = readStringField(value, key);
  if (!result) throw new ApiError(400, "invalid_payload", `${key} is required`);
  return result;
}

function isStorageProvider(value: string): value is StorageProviderId {
  return STORAGE_PROVIDERS.some((provider) => provider === value);
}

export function workspaceForContext(config: ServerConfig, context: JsonRecord): WorkspaceInfo {
  const candidates = [readStringField(context, "directory"), readStringField(context, "worktree")]
    .filter(Boolean)
    .map((value) => resolve(value));

  for (const candidate of candidates) {
    const workspace = config.workspaces.find((entry) => {
      const root = resolve(entry.path);
      return candidate === root || candidate.startsWith(`${root}${sep}`);
    });
    if (workspace) return { ...workspace, path: resolve(workspace.path) };
  }

  const workspace = config.workspaces[0];
  if (!workspace) throw new ApiError(404, "workspace_not_found", "Workspace not found for Storage Center");
  return { ...workspace, path: resolve(workspace.path) };
}

export function resolveWorkspaceFile(root: string, sourcePath: string): { absolutePath: string; relativePath: string } {
  const trimmed = sourcePath.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ApiError(400, "invalid_path", "sourcePath must be a relative file path inside the active workspace");
  }
  const resolvedRoot = resolve(root);
  const absolutePath = resolve(resolvedRoot, trimmed);
  if (!absolutePath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new ApiError(400, "invalid_path", "sourcePath must stay inside the active workspace");
  }
  return { absolutePath, relativePath: trimmed };
}

function normalizeObjectKey(value: string): string {
  const key = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!key || key.length > 1_024 || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ApiError(400, "invalid_object_key", "objectKey must be a safe non-empty slash-separated object key");
  }
  return key;
}

function contentTypeForPath(value: string): string {
  switch (extname(value).toLowerCase()) {
    case ".aac": return "audio/aac";
    case ".gif": return "image/gif";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".json": return "application/json";
    case ".m4a": return "audio/mp4";
    case ".md": return "text/markdown; charset=utf-8";
    case ".mov": return "video/quicktime";
    case ".mp3": return "audio/mpeg";
    case ".mp4": return "video/mp4";
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".txt": return "text/plain; charset=utf-8";
    case ".wav": return "audio/wav";
    case ".webm": return "video/webm";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

function publicObjectUrl(baseUrl: string | undefined, objectKey: string): string | undefined {
  const value = baseUrl?.trim();
  if (!value) return undefined;
  try {
    const base = new URL(value);
    if (base.protocol !== "https:" && base.protocol !== "http:") return undefined;
    base.search = "";
    base.hash = "";
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
    return base.toString();
  } catch {
    return undefined;
  }
}

async function valuesFrom(env: EnvService): Promise<StorageValues> {
  const values = new Map((await env.list()).map((entry) => [entry.key, entry.value.trim()] as const));
  for (const key of [
    "ALIYUN_OSS_ACCESS_KEY_ID",
    "ALIYUN_OSS_ACCESS_KEY_SECRET",
    "ALIYUN_OSS_BUCKET",
    "ALIYUN_OSS_REGION",
    "ALIYUN_OSS_PUBLIC_BASE_URL",
    "WASABI_ACCESS_KEY_ID",
    "WASABI_SECRET_ACCESS_KEY",
    "WASABI_BUCKET",
    "WASABI_REGION",
    "STORAGE_DEFAULT_PROVIDER",
  ]) {
    if (!values.get(key)?.trim() && process.env[key]?.trim()) values.set(key, process.env[key]!.trim());
  }
  return values;
}

function requiredValues(values: StorageValues, provider: StorageProviderId): Record<string, string> | null {
  const keys = provider === "aliyun-oss"
    ? ["ALIYUN_OSS_ACCESS_KEY_ID", "ALIYUN_OSS_ACCESS_KEY_SECRET", "ALIYUN_OSS_BUCKET", "ALIYUN_OSS_REGION"]
    : ["WASABI_ACCESS_KEY_ID", "WASABI_SECRET_ACCESS_KEY", "WASABI_BUCKET", "WASABI_REGION"];
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = values.get(key)?.trim() ?? "";
    if (!value) return null;
    result[key] = value;
  }
  if (provider === "aliyun-oss") {
    const publicBaseUrl = values.get("ALIYUN_OSS_PUBLIC_BASE_URL")?.trim();
    if (publicBaseUrl) result.ALIYUN_OSS_PUBLIC_BASE_URL = publicBaseUrl;
  }
  return result;
}

function configuredProviders(values: StorageValues): StorageProviderId[] {
  return STORAGE_PROVIDERS.filter((provider) => requiredValues(values, provider) !== null);
}

function selectedProvider(values: StorageValues, requested: string): StorageProviderId {
  const configured = configuredProviders(values);
  const candidate = requested === "auto" ? values.get("STORAGE_DEFAULT_PROVIDER")?.trim() || "auto" : requested;
  if (isStorageProvider(candidate)) {
    if (configured.includes(candidate)) return candidate;
    throw new ApiError(400, "storage_provider_not_configured", `${candidate} is not configured in Authorization Center`);
  }
  if (candidate !== "auto") {
    throw new ApiError(400, "invalid_storage_provider", "provider must be auto, aliyun-oss, or wasabi");
  }
  const automatic = configured[0];
  if (!automatic) throw new ApiError(400, "storage_not_configured", "Configure an object-storage provider in Authorization Center first");
  return automatic;
}

async function fetchStorage(input: { endpoint: string; method: "DELETE" | "PUT"; headers: Record<string, string>; body?: Buffer }): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
  try {
    const response = await fetch(input.endpoint, {
      method: input.method,
      headers: input.headers,
      ...(input.body ? { body: Uint8Array.from(input.body).buffer } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiError(response.status, "storage_upload_failed", `Storage provider rejected the request (HTTP ${response.status}).`);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "storage_upload_timeout", "Storage upload timed out. Check your connection and try again.");
    }
    throw new ApiError(502, "storage_upload_failed", "Could not upload the file to the storage provider.");
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadToProvider(input: {
  provider: StorageProviderId;
  values: Record<string, string>;
  objectKey: string;
  bytes: Buffer;
  contentType: string;
}): Promise<{ url: string; downloadUrl?: string }> {
  if (input.provider === "aliyun-oss") {
    const request = createAliyunOssV4Request({
      accessKeyId: input.values.ALIYUN_OSS_ACCESS_KEY_ID,
      accessKeySecret: input.values.ALIYUN_OSS_ACCESS_KEY_SECRET,
      bucket: input.values.ALIYUN_OSS_BUCKET,
      region: input.values.ALIYUN_OSS_REGION,
      method: "PUT",
      objectKey: input.objectKey,
      contentType: input.contentType,
    });
    await fetchStorage({ ...request, method: "PUT", body: input.bytes });
    const downloadUrl = publicObjectUrl(input.values.ALIYUN_OSS_PUBLIC_BASE_URL, input.objectKey);
    return { url: request.endpoint, ...(downloadUrl ? { downloadUrl } : {}) };
  }

  if (input.provider === "wasabi") {
    let request: ReturnType<typeof createS3V4Request>;
    try {
      request = createS3V4Request({
        accessKeyId: input.values.WASABI_ACCESS_KEY_ID,
        secretAccessKey: input.values.WASABI_SECRET_ACCESS_KEY,
        bucket: input.values.WASABI_BUCKET,
        region: input.values.WASABI_REGION,
        endpoint: `https://s3.${input.values.WASABI_REGION}.wasabisys.com`,
        method: "PUT",
        objectKey: input.objectKey,
        payloadHash: sha256(input.bytes),
        contentType: input.contentType,
      });
    } catch (error) {
      throw new ApiError(400, "invalid_wasabi_endpoint", error instanceof Error ? error.message : "Wasabi endpoint is invalid.");
    }
    await fetchStorage({ ...request, method: "PUT", body: input.bytes });
    return { url: request.endpoint };
  }

  throw new ApiError(400, "invalid_storage_provider", "Unsupported storage provider");
}

function temporaryReadUrl(input: {
  provider: StorageProviderId;
  values: Record<string, string>;
  objectKey: string;
}): string {
  if (input.provider === "aliyun-oss") {
    return createAliyunOssV4PresignedGetUrl({
      accessKeyId: input.values.ALIYUN_OSS_ACCESS_KEY_ID,
      accessKeySecret: input.values.ALIYUN_OSS_ACCESS_KEY_SECRET,
      bucket: input.values.ALIYUN_OSS_BUCKET,
      region: input.values.ALIYUN_OSS_REGION,
      objectKey: input.objectKey,
      expiresInSeconds: 600,
    });
  }
  return createS3V4PresignedGetUrl({
    accessKeyId: input.values.WASABI_ACCESS_KEY_ID,
    secretAccessKey: input.values.WASABI_SECRET_ACCESS_KEY,
    bucket: input.values.WASABI_BUCKET,
    region: input.values.WASABI_REGION,
    endpoint: `https://s3.${input.values.WASABI_REGION}.wasabisys.com`,
    objectKey: input.objectKey,
    expiresInSeconds: 600,
  });
}

async function deleteFromProvider(input: {
  provider: StorageProviderId;
  values: Record<string, string>;
  objectKey: string;
}): Promise<void> {
  if (input.provider === "aliyun-oss") {
    const request = createAliyunOssV4Request({
      accessKeyId: input.values.ALIYUN_OSS_ACCESS_KEY_ID,
      accessKeySecret: input.values.ALIYUN_OSS_ACCESS_KEY_SECRET,
      bucket: input.values.ALIYUN_OSS_BUCKET,
      region: input.values.ALIYUN_OSS_REGION,
      method: "DELETE",
      objectKey: input.objectKey,
    });
    await fetchStorage({ ...request, method: "DELETE" });
    return;
  }

  const request = createS3V4Request({
    accessKeyId: input.values.WASABI_ACCESS_KEY_ID,
    secretAccessKey: input.values.WASABI_SECRET_ACCESS_KEY,
    bucket: input.values.WASABI_BUCKET,
    region: input.values.WASABI_REGION,
    endpoint: `https://s3.${input.values.WASABI_REGION}.wasabisys.com`,
    method: "DELETE",
    objectKey: input.objectKey,
  });
  await fetchStorage({ ...request, method: "DELETE" });
}

/**
 * Makes one workspace file available to a trusted external provider without
 * making the bucket or its credentials public. The signed link is scoped to
 * this callback and the temporary object is always cleaned up afterwards.
 */
export async function withTemporaryWorkspaceObject<T>(input: {
  config: ServerConfig;
  env: EnvService;
  context: JsonRecord;
  sourcePath: string;
  purpose: string;
  maxBytes: number;
  use: (temporaryReadUrl: string) => Promise<T>;
}): Promise<T> {
  const workspace = workspaceForContext(input.config, input.context);
  const source = resolveWorkspaceFile(workspace.path, input.sourcePath);
  let sourceStat;
  try {
    sourceStat = await stat(source.absolutePath);
  } catch {
    throw new ApiError(404, "workspace_file_not_found", "Workspace file was not found");
  }
  if (!sourceStat.isFile()) throw new ApiError(400, "invalid_path", "sourcePath must point to a file");
  if (sourceStat.size > input.maxBytes) {
    throw new ApiError(413, "workspace_file_too_large", `Source file exceeds the ${Math.floor(input.maxBytes / (1024 * 1024))} MB limit.`);
  }

  const values = await valuesFrom(input.env);
  const provider = selectedProvider(values, "auto");
  const credentials = requiredValues(values, provider);
  if (!credentials) throw new ApiError(400, "storage_provider_not_configured", `${provider} is not configured in Authorization Center`);
  const extension = extname(source.relativePath).toLowerCase();
  const objectKey = normalizeObjectKey(`ipollowork/temp/${input.purpose}/${sha256(workspace.id).slice(0, 12)}/${randomUUID()}${extension}`);
  const bytes = await readFile(source.absolutePath);
  await uploadToProvider({
    provider,
    values: credentials,
    objectKey,
    bytes,
    contentType: contentTypeForPath(source.relativePath),
  });

  try {
    return await input.use(temporaryReadUrl({ provider, values: credentials, objectKey }));
  } finally {
    await deleteFromProvider({ provider, values: credentials, objectKey }).catch(() => undefined);
  }
}

export async function storageStatus(env: EnvService) {
  const values = await valuesFrom(env);
  const configured = configuredProviders(values);
  const savedRoute = values.get("STORAGE_DEFAULT_PROVIDER")?.trim() || "auto";
  const active = savedRoute === "auto" ? configured[0] ?? null : configured.includes(savedRoute as StorageProviderId) ? savedRoute : null;
  return {
    providers: STORAGE_PROVIDERS.map((id) => ({ id, configured: configured.includes(id), selected: id === active })),
    defaultProvider: active,
    savedRoute,
    localArtifactDelivery: "unchanged",
  };
}

async function uploadWorkspaceFile(config: ServerConfig, env: EnvService, args: JsonRecord, context: JsonRecord) {
  const workspace = workspaceForContext(config, context);
  const source = resolveWorkspaceFile(workspace.path, requireString(args, "sourcePath"));
  let sourceStat;
  try {
    sourceStat = await stat(source.absolutePath);
  } catch {
    throw new ApiError(404, "workspace_file_not_found", "Workspace file was not found");
  }
  if (!sourceStat.isFile()) throw new ApiError(400, "invalid_path", "sourcePath must point to a file");
  if (sourceStat.size > MAX_WORKSPACE_UPLOAD_BYTES) {
    throw new ApiError(413, "workspace_file_too_large", "Storage Center currently uploads files up to 100 MB. Split or export the file before uploading.");
  }

  const values = await valuesFrom(env);
  const provider = selectedProvider(values, readStringField(args, "provider") || "auto");
  const credentials = requiredValues(values, provider);
  if (!credentials) throw new ApiError(400, "storage_provider_not_configured", `${provider} is not configured in Authorization Center`);
  const objectKey = normalizeObjectKey(readStringField(args, "objectKey") || `ipollowork/${workspace.id}/${source.relativePath}`);
  const contentType = readStringField(args, "contentType") || contentTypeForPath(source.relativePath);
  const bytes = await readFile(source.absolutePath);
  const uploaded = await uploadToProvider({ provider, values: credentials, objectKey, bytes, contentType });

  return {
    provider,
    objectKey,
    sourcePath: source.relativePath,
    fileName: basename(source.relativePath),
    bytes: bytes.byteLength,
    contentType,
    url: uploaded.url,
    ...(uploaded.downloadUrl ? { downloadUrl: uploaded.downloadUrl } : {}),
    workspaceId: workspace.id,
  };
}

export async function callStorageExtensionAction(
  config: ServerConfig,
  env: EnvService,
  action: string,
  args: JsonRecord,
  context: JsonRecord,
) {
  if (action === "status") {
    return {
      ok: true,
      extensionId: STORAGE_EXTENSION_ID,
      action,
      result: await storageStatus(env),
      context,
    };
  }
  if (action === "upload_workspace_file") {
    const result = await uploadWorkspaceFile(config, env, args, context);
    return {
      ok: true,
      extensionId: STORAGE_EXTENSION_ID,
      action,
      path: result.sourcePath,
      result,
      context,
    };
  }
  return null;
}

export const __test__ = { createAliyunOssV4Request, createS3V4Request, normalizeObjectKey };
