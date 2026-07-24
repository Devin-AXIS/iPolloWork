import type { EnvRecord, EnvService } from "./env-file.js";
import { createAliyunOssV4Request, createS3V4Request } from "./object-storage-signing.js";

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

const AUTHORIZATION_SERVICES: readonly AuthorizationServiceDefinition[] = [
  {
    id: "openai-images",
    keys: ["OPENAI_API_KEY"],
    category: "media",
    agent: {
      capability: "OpenAI image generation",
      useWhen: "Use when the user asks to create an image asset.",
      instruction:
        "Prefer the iPolloWork openai-image-generation/image_generate extension when it is available so the PNG is saved as a workspace artifact. Otherwise use OPENAI_API_KEY only from trusted runtime code.",
    },
  },
  {
    id: "aliyun-bailian",
    keys: ["DASHSCOPE_API_KEY"],
    category: "media",
    agent: {
      capability: "Alibaba Cloud Model Studio media",
      useWhen: "Use when the user asks for speech, voice cloning, transcription, translation, video generation, video editing, or a digital human.",
      instruction:
        "Use the iPolloWork media extension actions from trusted runtime code. They keep DASHSCOPE_API_KEY on this device and provide the supported media operations without modifying OpenCode.",
    },
  },
  {
    id: "volcengine-video",
    keys: ["ARK_API_KEY"],
    category: "media",
    agent: {
      capability: "Volcengine Ark video generation",
      useWhen: "Use when the user asks to generate a video.",
      instruction:
        "Use ARK_API_KEY with the official Volcengine Ark video-generation API from trusted runtime code. Keep generation outputs in the active workspace.",
    },
  },
  {
    id: "aliyun-oss",
    keys: [
      "ALIYUN_OSS_ACCESS_KEY_ID",
      "ALIYUN_OSS_ACCESS_KEY_SECRET",
      "ALIYUN_OSS_BUCKET",
      "ALIYUN_OSS_REGION",
    ],
    optionalKeys: ["ALIYUN_OSS_PUBLIC_BASE_URL"],
    category: "storage",
    agent: {
      capability: "Alibaba Cloud OSS object storage",
      useWhen: "Use when generated media or artifacts need durable object storage.",
      instruction:
        "Use the iPolloWork storage extension from trusted runtime code. Never expose access keys, sign requests in the browser, or place credentials in generated files.",
      },
  },
  {
    id: "wasabi",
    keys: ["WASABI_ACCESS_KEY_ID", "WASABI_SECRET_ACCESS_KEY", "WASABI_BUCKET", "WASABI_REGION"],
    category: "storage",
    agent: {
      capability: "Wasabi object storage",
      useWhen: "Use when media or artifacts need durable international object storage in Wasabi.",
      instruction:
        "Use the iPolloWork storage extension from trusted runtime code. It signs Wasabi S3-compatible requests locally and keeps access keys out of browser code, generated files, and chat output.",
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
      instruction:
        "Call storage/status or use provider auto. The Storage Center selects the saved default only when that provider is configured; it never changes the existing local artifact delivery flow.",
    },
  },
];

function definitionFor(id: string): AuthorizationServiceDefinition | null {
  return AUTHORIZATION_SERVICES.find((service) => service.id === id) ?? null;
}

function valueMap(items: EnvRecord[]): Map<string, string> {
  return new Map(items.map((item) => [item.key, item.value] as const));
}

function requiredValues(
  service: AuthorizationServiceDefinition,
  values: Map<string, string>,
): { values: Record<string, string>; missingKeys: string[] } {
  const resolved: Record<string, string> = {};
  const missingKeys: string[] = [];
  for (const key of service.keys) {
    const value = values.get(key)?.trim() ?? "";
    if (!value) {
      missingKeys.push(key);
    } else {
      resolved[key] = value;
    }
  }
  for (const key of service.optionalKeys ?? []) {
    const value = values.get(key)?.trim() ?? "";
    if (value) resolved[key] = value;
  }
  return { values: resolved, missingKeys };
}

export function listAuthorizationServices(items: EnvRecord[]): AuthorizationServiceStatus[] {
  const values = valueMap(items);
  return AUTHORIZATION_SERVICES.map((service) => {
    const fields = [...service.keys, ...(service.optionalKeys ?? [])].map((key) => ({ key, configured: Boolean(values.get(key)?.trim()) }));
    return {
      id: service.id,
      configured: service.keys.every((key) => Boolean(values.get(key)?.trim())),
      fields,
      category: service.category,
      kind: service.kind ?? "credentials",
      agent: service.agent,
    };
  });
}

export function isAuthorizationServiceId(value: string): value is AuthorizationServiceId {
  return AUTHORIZATION_SERVICE_IDS.some((id) => id === value);
}

async function fetchAuthorizationTest(url: string, init: RequestInit): Promise<AuthorizationServiceTestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    });
    if (response.ok) {
      return { ok: true, detail: "Connection verified." };
    }
    return {
      ok: false,
      detail: `The service rejected this authorization (HTTP ${response.status}).`,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, detail: "The connection test timed out." };
    }
    return { ok: false, detail: "Could not reach the service. Check your network and try again." };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testAuthorizationService(
  env: EnvService,
  serviceId: AuthorizationServiceId,
): Promise<AuthorizationServiceTestResult & { missingKeys?: string[] }> {
  const service = definitionFor(serviceId);
  if (!service) {
    return { ok: false, detail: "This authorization service is not available." };
  }
  const values = valueMap(await env.list());
  const resolved = requiredValues(service, values);
  if (resolved.missingKeys.length > 0) {
    return {
      ok: false,
      detail: "Complete the required fields before testing this service.",
      missingKeys: resolved.missingKeys,
    };
  }

  switch (serviceId) {
    case "openai-images":
      return fetchAuthorizationTest("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${resolved.values.OPENAI_API_KEY}` },
      });
    case "aliyun-bailian":
      return fetchAuthorizationTest("https://dashscope.aliyuncs.com/compatible-mode/v1/models", {
        headers: { Authorization: `Bearer ${resolved.values.DASHSCOPE_API_KEY}` },
      });
    case "volcengine-video":
      return fetchAuthorizationTest(
        "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_num=1&page_size=1",
        { headers: { Authorization: `Bearer ${resolved.values.ARK_API_KEY}` } },
      );
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
      let request: ReturnType<typeof createS3V4Request>;
      try {
        request = createS3V4Request({
          accessKeyId: resolved.values.WASABI_ACCESS_KEY_ID,
          secretAccessKey: resolved.values.WASABI_SECRET_ACCESS_KEY,
          bucket: resolved.values.WASABI_BUCKET,
          region: resolved.values.WASABI_REGION,
          endpoint: `https://s3.${resolved.values.WASABI_REGION}.wasabisys.com`,
          method: "GET",
          query: "list-type=2&max-keys=1",
        });
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : "Wasabi endpoint is invalid." };
      }
      return fetchAuthorizationTest(request.endpoint, { headers: request.headers });
    }
    case "storage-routing":
      return { ok: true, detail: "Default storage provider saved. Storage Center verifies the provider when it is used." };
  }
}

export const __test__ = { createAliyunOssV4Request, createS3V4Request };
