import { createHash } from "node:crypto";

import { authorizationVault } from "./authorization-runtime.js";
import type { EnvService } from "./env-file.js";
import { createAliyunOssV4Request, createS3V4Request } from "./object-storage-signing.js";
import type { ServerConfig } from "./types.js";

export const AUTHORIZATION_SERVICE_IDS = [
  "openai-images",
  "aliyun-bailian",
  "volcengine-video",
  "aliyun-oss",
  "wasabi",
  "storage-routing",
] as const;

export type AuthorizationServiceId = (typeof AUTHORIZATION_SERVICE_IDS)[number];

type AuthorizationServiceDefinition = {
  id: AuthorizationServiceId;
  keys: readonly string[];
  optionalKeys?: readonly string[];
  category: "media" | "storage";
  kind?: "credentials" | "routing";
  agent: AuthorizationServiceAgentInfo;
};

export type AuthorizationServiceAgentInfo = {
  capability: string;
  useWhen: string;
  instruction: string;
};

export type AuthorizationServiceStatus = {
  id: AuthorizationServiceId;
  configured: boolean;
  fields: Array<{ key: string; configured: boolean }>;
  category: "media" | "storage";
  kind: "credentials" | "routing";
  agent: AuthorizationServiceAgentInfo;
};

export type AuthorizationServiceTestResult = {
  ok: boolean;
  detail: string;
};

export type AuthorizationAccess = {
  read(serviceId: AuthorizationServiceId): Promise<Readonly<Record<string, string>>>;
};

const AUTHORIZATION_SERVICES: readonly AuthorizationServiceDefinition[] = [
  {
    id: "openai-images",
    keys: ["OPENAI_API_KEY"],
    category: "media",
    agent: {
      capability: "OpenAI image generation",
      useWhen: "Use when the user asks to create an image asset.",
      instruction: "Prefer the iPolloWork openai-image-generation/image_generate extension so the PNG is saved as a workspace artifact.",
    },
  },
  {
    id: "aliyun-bailian",
    keys: ["DASHSCOPE_API_KEY"],
    optionalKeys: ["DASHSCOPE_BASE_URL"],
    category: "media",
    agent: {
      capability: "Alibaba Cloud Model Studio media",
      useWhen: "Use when the user asks for speech, voice cloning, transcription, translation, video generation, video editing, or a digital human.",
      instruction: "Use the iPolloWork media extension actions. iPolloWork keeps the connection private and exposes only bounded media operations.",
    },
  },
  {
    id: "volcengine-video",
    keys: ["ARK_API_KEY"],
    category: "media",
    agent: {
      capability: "Volcengine Ark video generation",
      useWhen: "Use when the user asks to generate a video.",
      instruction: "Use the iPolloWork media extension and keep generation outputs in the active workspace.",
    },
  },
  {
    id: "aliyun-oss",
    keys: ["ALIYUN_OSS_ACCESS_KEY_ID", "ALIYUN_OSS_ACCESS_KEY_SECRET", "ALIYUN_OSS_BUCKET", "ALIYUN_OSS_REGION"],
    optionalKeys: ["ALIYUN_OSS_PUBLIC_BASE_URL"],
    category: "storage",
    agent: {
      capability: "Alibaba Cloud OSS object storage",
      useWhen: "Use when generated media or artifacts need durable object storage.",
      instruction: "Use the iPolloWork storage extension. Never expose access keys, sign requests in the browser, or place credentials in generated files.",
    },
  },
  {
    id: "wasabi",
    keys: ["WASABI_ACCESS_KEY_ID", "WASABI_SECRET_ACCESS_KEY", "WASABI_BUCKET", "WASABI_REGION"],
    category: "storage",
    agent: {
      capability: "Wasabi object storage",
      useWhen: "Use when media or artifacts need durable international object storage in Wasabi.",
      instruction: "Use the iPolloWork storage extension. It signs requests locally and never exposes storage credentials to engines or generated files.",
    },
  },
  {
    id: "storage-routing",
    keys: ["STORAGE_DEFAULT_PROVIDER"],
    category: "storage",
    kind: "routing",
    agent: {
      capability: "Storage Center routing",
      useWhen: "Use when a storage operation does not name a provider.",
      instruction: "Call storage/status or use provider auto. Storage Center selects the saved default only when that provider is configured.",
    },
  },
];

function definitionFor(id: string): AuthorizationServiceDefinition | null {
  return AUTHORIZATION_SERVICES.find((service) => service.id === id) ?? null;
}

function methodId(service: AuthorizationServiceDefinition): string {
  return service.kind === "routing" ? "routing" : "credentials";
}

function methodFingerprint(service: AuthorizationServiceDefinition): string {
  return createHash("sha256").update(JSON.stringify({
    kind: service.kind ?? "credentials",
    keys: service.keys,
    optionalKeys: service.optionalKeys ?? [],
  })).digest("hex");
}

function requiredValues(service: AuthorizationServiceDefinition, values: Readonly<Record<string, string>>): { values: Record<string, string>; missingKeys: string[] } {
  const resolved: Record<string, string> = {};
  const missingKeys: string[] = [];
  for (const key of service.keys) {
    const value = values[key]?.trim() ?? "";
    if (value) resolved[key] = value;
    else missingKeys.push(key);
  }
  for (const key of service.optionalKeys ?? []) {
    const value = values[key]?.trim() ?? "";
    if (value) resolved[key] = value;
  }
  return { values: resolved, missingKeys };
}

export function isAuthorizationServiceId(value: string): value is AuthorizationServiceId {
  return AUTHORIZATION_SERVICE_IDS.some((id) => id === value);
}

export async function readAuthorizationServiceValues(config: ServerConfig, serviceId: AuthorizationServiceId): Promise<Readonly<Record<string, string>>> {
  const service = definitionFor(serviceId);
  if (!service) return {};
  const values = await (await authorizationVault(config)).readCredentialForAccount({
    connectionId: service.id,
    accountId: "default",
    methodId: methodId(service),
    methodFingerprint: methodFingerprint(service),
  });
  return Object.freeze(values ?? {});
}

export function createAuthorizationAccess(config: ServerConfig): AuthorizationAccess {
  return { read: (serviceId) => readAuthorizationServiceValues(config, serviceId) };
}

export async function saveAuthorizationService(config: ServerConfig, serviceId: AuthorizationServiceId, input: unknown): Promise<AuthorizationServiceStatus> {
  const service = definitionFor(serviceId);
  if (!service) throw new Error("Authorization service not found");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Authorization values must be an object");
  const allowed = new Set([...service.keys, ...(service.optionalKeys ?? [])]);
  const current = await readAuthorizationServiceValues(config, serviceId);
  const values = { ...current };
  for (const [key, rawValue] of Object.entries(input)) {
    if (!allowed.has(key)) throw new Error(`Unknown authorization field: ${key}`);
    if (typeof rawValue !== "string") throw new Error(`Authorization field must be a string: ${key}`);
    const value = rawValue.trim();
    if (value) values[key] = value;
  }
  const resolved = requiredValues(service, values);
  if (resolved.missingKeys.length) throw new Error(`Authorization field is required: ${resolved.missingKeys[0]}`);
  await saveAuthorizationServiceValues(config, service, values);
  return authorizationServiceStatus(service, values);
}

async function saveAuthorizationServiceValues(config: ServerConfig, service: AuthorizationServiceDefinition, values: Record<string, string>): Promise<void> {
  await (await authorizationVault(config)).saveCredential({
    connectionId: service.id,
    accountId: "default",
    methodId: methodId(service),
    methodFingerprint: methodFingerprint(service),
    values,
    secretFields: service.kind === "routing" ? [] : Object.keys(values),
  });
}

function authorizationServiceStatus(service: AuthorizationServiceDefinition, values: Readonly<Record<string, string>>): AuthorizationServiceStatus {
  const fields = [...service.keys, ...(service.optionalKeys ?? [])].map((key) => ({ key, configured: Boolean(values[key]?.trim()) }));
  return {
    id: service.id,
    configured: service.keys.every((key) => Boolean(values[key]?.trim())),
    fields,
    category: service.category,
    kind: service.kind ?? "credentials",
    agent: service.agent,
  };
}

export async function listAuthorizationServices(config: ServerConfig): Promise<AuthorizationServiceStatus[]> {
  return Promise.all(AUTHORIZATION_SERVICES.map(async (service) =>
    authorizationServiceStatus(service, await readAuthorizationServiceValues(config, service.id))
  ));
}

export async function migrateLegacyAuthorizationServices(config: ServerConfig, env: EnvService): Promise<number> {
  let records: Awaited<ReturnType<EnvService["list"]>>;
  try {
    records = await env.list();
  } catch {
    return 0;
  }
  const legacy = new Map(records.map((record) => [record.key, record.value.trim()] as const));
  let migrated = 0;
  for (const service of AUTHORIZATION_SERVICES) {
    const current = await readAuthorizationServiceValues(config, service.id);
    if (Object.keys(current).length) continue;
    const values = Object.fromEntries([...service.keys, ...(service.optionalKeys ?? [])]
      .map((key) => [key, legacy.get(key) ?? ""] as const)
      .filter(([, value]) => Boolean(value)));
    if (!Object.keys(values).length) continue;
    await saveAuthorizationServiceValues(config, service, values);
    migrated += 1;
  }

  const storageKeys = AUTHORIZATION_SERVICES
    .filter((service) => service.category === "storage" && service.kind !== "routing")
    .flatMap((service) => [...service.keys, ...(service.optionalKeys ?? [])]);
  for (const key of storageKeys) {
    if (legacy.has(key)) await env.delete(key);
  }
  return migrated;
}

async function fetchAuthorizationTest(url: string, init: RequestInit): Promise<AuthorizationServiceTestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: "error" });
    if (response.ok) return { ok: true, detail: "Connection verified." };
    return { ok: false, detail: `The service rejected this authorization (HTTP ${response.status}).` };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { ok: false, detail: "The connection test timed out." };
    return { ok: false, detail: "Could not reach the service. Check your network and try again." };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testAuthorizationService(config: ServerConfig, serviceId: AuthorizationServiceId): Promise<AuthorizationServiceTestResult & { missingKeys?: string[] }> {
  const service = definitionFor(serviceId);
  if (!service) return { ok: false, detail: "This authorization service is not available." };
  const resolved = requiredValues(service, await readAuthorizationServiceValues(config, serviceId));
  if (resolved.missingKeys.length) {
    return { ok: false, detail: "Complete the required fields before testing this service.", missingKeys: resolved.missingKeys };
  }

  switch (serviceId) {
    case "openai-images":
      return fetchAuthorizationTest("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${resolved.values.OPENAI_API_KEY}` } });
    case "aliyun-bailian":
      return fetchAuthorizationTest("https://dashscope.aliyuncs.com/compatible-mode/v1/models", { headers: { Authorization: `Bearer ${resolved.values.DASHSCOPE_API_KEY}` } });
    case "volcengine-video":
      return fetchAuthorizationTest("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_num=1&page_size=1", { headers: { Authorization: `Bearer ${resolved.values.ARK_API_KEY}` } });
    case "aliyun-oss": {
      const request = createAliyunOssV4Request({
        accessKeyId: resolved.values.ALIYUN_OSS_ACCESS_KEY_ID,
        accessKeySecret: resolved.values.ALIYUN_OSS_ACCESS_KEY_SECRET,
        bucket: resolved.values.ALIYUN_OSS_BUCKET,
        region: resolved.values.ALIYUN_OSS_REGION,
        method: "GET",
        query: "list-type=2&max-keys=1",
      });
      return fetchAuthorizationTest(request.endpoint, { headers: request.headers });
    }
    case "wasabi": {
      try {
        const request = createS3V4Request({
          accessKeyId: resolved.values.WASABI_ACCESS_KEY_ID,
          secretAccessKey: resolved.values.WASABI_SECRET_ACCESS_KEY,
          bucket: resolved.values.WASABI_BUCKET,
          region: resolved.values.WASABI_REGION,
          endpoint: `https://s3.${resolved.values.WASABI_REGION}.wasabisys.com`,
          method: "GET",
          query: "list-type=2&max-keys=1",
        });
        return fetchAuthorizationTest(request.endpoint, { headers: request.headers });
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : "Wasabi endpoint is invalid." };
      }
    }
    case "storage-routing":
      return { ok: true, detail: "Default storage provider saved. Storage Center verifies the provider when it is used." };
  }
}

export const __test__ = { createAliyunOssV4Request, createS3V4Request };
