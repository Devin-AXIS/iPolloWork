import { createHash } from "node:crypto";
import type { SharedProviderBrowserLogin } from "@ipollowork/types/provider-credentials";
import { classifyProviderFailure, serviceErrorMessage } from "@ipollowork/types/provider-errors";
import { providerApiError } from "./errors.js";

import { authorizationVault } from "./authorization-runtime.js";
import { createAliyunOssV4Request, createS3V4Request } from "./object-storage-signing.js";
import { providerFetch } from "./provider-fetch.js";
import { resolveOpenAiBrowserSession, type OpenAiCodexOAuthSession } from "./openai-codex-oauth.js";
import type { ServerConfig } from "./types.js";

export const AUTHORIZATION_SERVICE_IDS = [
  "openai-images",
  "aliyun-bailian",
  "minimax-media",
  "volcengine-video",
  "runninghub-video",
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
  browserLogin?: SharedProviderBrowserLogin;
};

export type AuthorizationServiceTestResult = {
  ok: boolean;
  detail: string;
};

export type AuthorizationAccess = {
  read(serviceId: AuthorizationServiceId): Promise<Readonly<Record<string, string>>>;
  openAiBrowserSession?(): Promise<OpenAiCodexOAuthSession | null>;
};

const AUTHORIZATION_SERVICES: readonly AuthorizationServiceDefinition[] = [
  {
    id: "openai-images",
    keys: ["OPENAI_API_KEY"],
    category: "media",
    agent: {
      capability: "OpenAI image generation",
      useWhen: "Use when the user asks to create an image asset.",
      instruction: "Prefer the iPolloWork openai-image-generation/image_generate extension so the PNG is saved as a workspace artifact. List configured models first and wait for the user's explicit model choice; never choose one automatically.",
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
    id: "minimax-media",
    keys: ["MINIMAX_API_KEY"],
    category: "media",
    agent: {
      capability: "MiniMax speech TTS",
      useWhen: "Use when the user asks to synthesize speech or create narration audio with a MiniMax account.",
      instruction:
        "Use the iPolloWork media extension speech_synthesize action from trusted runtime code. It keeps MINIMAX_API_KEY on this device and calls the MiniMax Text to Audio v2 endpoint without modifying OpenCode.",
    },
  },
  {
    id: "volcengine-video",
    keys: ["ARK_API_KEY"],
    category: "media",
    agent: {
      capability: "Volcengine Ark image and video generation",
      useWhen: "Use when the user asks to generate or edit an image with Seedream, or generate a video with Seedance.",
      instruction: "Use the iPolloWork image or media extension and keep generation outputs in the active workspace. Before image or video generation, list configured models and wait for the user's explicit choice; never choose one automatically.",
    },
  },
  {
    id: "runninghub-video",
    keys: ["RUNNINGHUB_API_KEY"],
    category: "media",
    agent: {
      capability: "RunningHub MiniMax H3 video generation",
      useWhen: "Use for MiniMax H3 text, image or multimodal video generation.",
      instruction: "Use video-generation actions only after listing configured video models and receiving the user's explicit model choice. Never select H3 automatically. MiniMax H3 uses the public ComfyUI workflow API with a RunningHub workflow API key; supports text, first-frame and first/last-frame video generation.",
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
  return {
    read: (serviceId) => readAuthorizationServiceValues(config, serviceId),
    openAiBrowserSession: () => resolveOpenAiBrowserSession(config),
  };
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
  return Promise.all(AUTHORIZATION_SERVICES.map(async (service) => {
    const status = authorizationServiceStatus(service, await readAuthorizationServiceValues(config, service.id));
    if (service.id === "openai-images") {
      const session = await resolveOpenAiBrowserSession(config);
      status.browserLogin = { providerId: "openai", connected: Boolean(session?.accountId) };
    }
    return status;
  }));
}

async function fetchAuthorizationTest(url: string, init: RequestInit): Promise<AuthorizationServiceTestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await providerFetch(url, { ...init, signal: controller.signal, redirect: "error" });
    if (response.ok) return { ok: true, detail: "Connection verified." };
    return { ok: false, detail: providerApiError({ status: response.status }, response.status).message };
  } catch (error) {
    return { ok: false, detail: serviceErrorMessage(error) };
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
    case "minimax-media":
      return { ok: true, detail: "MiniMax API key saved. Speech synthesis verifies it when used." };
    case "volcengine-video":
      return fetchAuthorizationTest("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_num=1&page_size=1", { headers: { Authorization: `Bearer ${resolved.values.ARK_API_KEY}` } });
    case "runninghub-video": {
      try {
        const response = await providerFetch("https://www.runninghub.ai/uc/openapi/accountStatus", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apikey: resolved.values.RUNNINGHUB_API_KEY }),
          signal: AbortSignal.timeout(10_000), redirect: "error",
        });
        const data: unknown = await response.json().catch(() => { throw providerApiError({}, 502); });
        const ok = response.ok && data !== null && typeof data === "object" && "code" in data && data.code === 0;
        return { ok, detail: ok ? "连接正常。H3 工作流权限和余额将在提交任务时检查。" : classifyProviderFailure(data)?.message ?? "RunningHub 连接测试未通过，请检查服务状态及工作流 API Key 权限。" };
      } catch (error) {
        return { ok: false, detail: serviceErrorMessage(error) };
      }
    }
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
