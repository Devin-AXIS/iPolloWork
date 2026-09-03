const SHARED_PROVIDER_CREDENTIAL_PREFIX = "AGENT_PROVIDER_"
const SHARED_PROVIDER_CREDENTIAL_SUFFIX = "_API_KEY"
const SHARED_PROVIDER_PROFILE_SUFFIX = "_PROFILE"
const SHARED_PROVIDER_DISCONNECTED_SUFFIX = "_DISCONNECTED"

export type SharedProviderModelProfile = {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

export type SharedProviderProtocol =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"

export type SharedProviderRuntimeRoute = Readonly<{
  api: SharedProviderProtocol
  baseURL: string
}>

const SHARED_PROVIDER_RUNTIME_ROUTES: Readonly<Record<string, SharedProviderRuntimeRoute>> = {
  "ant-ling": { api: "openai-completions", baseURL: "https://api.ant-ling.com/v1" },
  alibaba: { api: "openai-completions", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  "alibaba-cn": { api: "openai-completions", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  anthropic: { api: "anthropic-messages", baseURL: "https://api.anthropic.com" },
  cerebras: { api: "openai-completions", baseURL: "https://api.cerebras.ai/v1" },
  cohere: { api: "openai-completions", baseURL: "https://api.cohere.ai/compatibility/v1" },
  deepseek: { api: "openai-completions", baseURL: "https://api.deepseek.com" },
  fireworks: { api: "openai-completions", baseURL: "https://api.fireworks.ai/inference/v1" },
  google: { api: "openai-completions", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai" },
  groq: { api: "openai-completions", baseURL: "https://api.groq.com/openai/v1" },
  huggingface: { api: "openai-completions", baseURL: "https://router.huggingface.co/v1" },
  "kimi-for-coding": { api: "anthropic-messages", baseURL: "https://api.kimi.com/coding" },
  meta: { api: "openai-completions", baseURL: "https://api.meta.ai/v1" },
  minimax: { api: "anthropic-messages", baseURL: "https://api.minimax.io/anthropic" },
  "minimax-cn": { api: "anthropic-messages", baseURL: "https://api.minimaxi.com/anthropic" },
  mistral: { api: "openai-completions", baseURL: "https://api.mistral.ai/v1" },
  moonshotai: { api: "openai-completions", baseURL: "https://api.moonshot.ai/v1" },
  "moonshotai-cn": { api: "openai-completions", baseURL: "https://api.moonshot.cn/v1" },
  nvidia: { api: "openai-completions", baseURL: "https://integrate.api.nvidia.com/v1" },
  openai: { api: "openai-responses", baseURL: "https://api.openai.com/v1" },
  openrouter: { api: "openai-completions", baseURL: "https://openrouter.ai/api/v1" },
  perplexity: { api: "openai-completions", baseURL: "https://api.perplexity.ai" },
  "qwen-token-plan": { api: "openai-completions", baseURL: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" },
  "qwen-token-plan-cn": { api: "openai-completions", baseURL: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" },
  siliconflow: { api: "openai-completions", baseURL: "https://api.siliconflow.com/v1" },
  "siliconflow-cn": { api: "openai-completions", baseURL: "https://api.siliconflow.cn/v1" },
  stepfun: { api: "openai-completions", baseURL: "https://api.stepfun.com/v1" },
  "stepfun-ai": { api: "openai-completions", baseURL: "https://api.stepfun.ai/v1" },
  together: { api: "openai-completions", baseURL: "https://api.together.ai/v1" },
  "tencent-tokenhub": { api: "openai-completions", baseURL: "https://tokenhub.tencentmaas.com/v1" },
  "vercel-ai-gateway": { api: "anthropic-messages", baseURL: "https://ai-gateway.vercel.sh" },
  xai: { api: "openai-responses", baseURL: "https://api.x.ai/v1" },
  xiaomi: { api: "openai-completions", baseURL: "https://api.xiaomimimo.com/v1" },
  "xiaomi-token-plan-ams": { api: "openai-completions", baseURL: "https://token-plan-ams.xiaomimimo.com/v1" },
  "xiaomi-token-plan-cn": { api: "openai-completions", baseURL: "https://token-plan-cn.xiaomimimo.com/v1" },
  "xiaomi-token-plan-sgp": { api: "openai-completions", baseURL: "https://token-plan-sgp.xiaomimimo.com/v1" },
  zai: { api: "openai-completions", baseURL: "https://api.z.ai/api/coding/paas/v4" },
  "zai-coding-cn": { api: "openai-completions", baseURL: "https://open.bigmodel.cn/api/coding/paas/v4" },
  zhipuai: { api: "openai-completions", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
}

const SHARED_PROVIDER_RUNTIME_ROUTE_ALIASES: Readonly<Record<string, string>> = {
  "deepseek-official": "deepseek",
  "kimi-coding": "kimi-for-coding",
  qwen: "alibaba-cn",
}

/**
 * Portable provider routes used only when a connected provider does not
 * already supply an explicit protocol and endpoint. Providers with dynamic
 * account URLs or multi-value credentials intentionally have no fallback.
 */
export function sharedProviderRuntimeRoute(
  providerId: string,
): SharedProviderRuntimeRoute | undefined {
  const resolved = providerId.trim().toLowerCase()
  const route = SHARED_PROVIDER_RUNTIME_ROUTES[
    SHARED_PROVIDER_RUNTIME_ROUTE_ALIASES[resolved] ?? resolved
  ]
  return route ? { ...route } : undefined
}

/**
 * Engine-neutral provider metadata stored next to the shared credential.
 * Agent runtimes consume this description at their adapter boundary instead
 * of reading another engine's private configuration file.
 */
export type SharedProviderProfile = {
  schemaVersion: 1
  providerId: string
  displayName: string
  api?: SharedProviderProtocol
  baseURL?: string
  models: SharedProviderModelProfile[]
}

type SharedProviderEnvRecord = { key: string; value: string }

function encodedProviderId(providerId: string): string {
  return Array.from(new TextEncoder().encode(providerId.trim().toLowerCase()))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}

function providerIdFromEnvKey(key: string, suffix: string): string | null {
  const resolved = key.trim().toUpperCase()
  if (
    !resolved.startsWith(SHARED_PROVIDER_CREDENTIAL_PREFIX)
    || !resolved.endsWith(suffix)
  ) {
    return null
  }
  const encoded = resolved.slice(
    SHARED_PROVIDER_CREDENTIAL_PREFIX.length,
    -suffix.length,
  )
  if (!encoded || encoded.length % 2 !== 0 || !/^[0-9A-F]+$/.test(encoded)) return null
  try {
    const bytes = Uint8Array.from(encoded.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16))
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes) || null
  } catch {
    return null
  }
}

/** User-level credential mirror consumed by non-OpenCode agent engines. */
export function sharedProviderCredentialEnvKey(providerId: string): string {
  return `${SHARED_PROVIDER_CREDENTIAL_PREFIX}${encodedProviderId(providerId)}${SHARED_PROVIDER_CREDENTIAL_SUFFIX}`
}

export function sharedProviderIdFromCredentialEnvKey(key: string): string | null {
  return providerIdFromEnvKey(key, SHARED_PROVIDER_CREDENTIAL_SUFFIX)
}

/** Durable account-level opt-out that takes precedence over credential discovery. */
export function sharedProviderDisconnectedEnvKey(providerId: string): string {
  return `${SHARED_PROVIDER_CREDENTIAL_PREFIX}${encodedProviderId(providerId)}${SHARED_PROVIDER_DISCONNECTED_SUFFIX}`
}

export function sharedProviderIdFromDisconnectedEnvKey(key: string): string | null {
  return providerIdFromEnvKey(key, SHARED_PROVIDER_DISCONNECTED_SUFFIX)
}

export function sharedProviderDisconnectedIdsFromEnvKeys(keys: readonly string[]): string[] {
  return [
    ...new Set(
      keys.flatMap((key) => {
        const providerId = sharedProviderIdFromDisconnectedEnvKey(key)
        return providerId ? [providerId] : []
      }),
    ),
  ].sort()
}

/** Provider connections owned by the current iPolloWork user account. */
export function sharedProviderIdsFromEnvKeys(keys: readonly string[]): string[] {
  const disconnected = new Set(sharedProviderDisconnectedIdsFromEnvKeys(keys))
  return [
    ...new Set(
      keys.flatMap((key) => {
        const providerId = sharedProviderIdFromCredentialEnvKey(key)
        return providerId && !disconnected.has(providerId) ? [providerId] : []
      }),
    ),
  ].sort()
}

export function sharedProviderProfileEnvKey(providerId: string): string {
  return `${SHARED_PROVIDER_CREDENTIAL_PREFIX}${encodedProviderId(providerId)}${SHARED_PROVIDER_PROFILE_SUFFIX}`
}

export function sharedProviderIdFromProfileEnvKey(key: string): string | null {
  return providerIdFromEnvKey(key, SHARED_PROVIDER_PROFILE_SUFFIX)
}

/**
 * Account-level provider connections include API-key credentials and OAuth
 * connections. When the caller has an authoritative OAuth directory, a
 * profile is metadata only and cannot revive a disconnected provider. The
 * profile fallback remains for older servers that do not expose OAuth IDs.
 */
export function sharedConfiguredProviderIdsFromEnvKeys(
  keys: readonly string[],
  oauthProviderIds?: readonly string[],
): string[] {
  const hasAuthoritativeOAuthDirectory = oauthProviderIds !== undefined
  const disconnected = new Set(sharedProviderDisconnectedIdsFromEnvKeys(keys))
  return [
    ...new Set(
      [
        ...keys.flatMap((key) => {
          const providerId = sharedProviderIdFromCredentialEnvKey(key)
            ?? (hasAuthoritativeOAuthDirectory ? null : sharedProviderIdFromProfileEnvKey(key))
          return providerId ? [providerId] : []
        }),
        ...(oauthProviderIds ?? [])
          .map((providerId) => providerId.trim().toLowerCase())
          .filter(Boolean),
      ].filter((providerId) => !disconnected.has(providerId)),
    ),
  ].sort()
}

export function serializeSharedProviderProfile(profile: SharedProviderProfile): string {
  return JSON.stringify(profile)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseSharedProviderProfile(value: string): SharedProviderProfile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) return null
  if (typeof parsed.providerId !== "string" || !parsed.providerId.trim()) return null
  if (typeof parsed.displayName !== "string" || !parsed.displayName.trim()) return null
  if (
    parsed.api !== undefined
    && parsed.api !== "openai-completions"
    && parsed.api !== "openai-responses"
    && parsed.api !== "anthropic-messages"
  ) {
    return null
  }
  if (parsed.baseURL !== undefined && typeof parsed.baseURL !== "string") return null
  if (!Array.isArray(parsed.models)) return null
  const models: SharedProviderModelProfile[] = []
  for (const model of parsed.models) {
    if (!isRecord(model) || typeof model.id !== "string" || !model.id.trim()) return null
    if (model.name !== undefined && typeof model.name !== "string") return null
    if (model.contextWindow !== undefined && typeof model.contextWindow !== "number") return null
    if (model.maxTokens !== undefined && typeof model.maxTokens !== "number") return null
    models.push({
      id: model.id.trim(),
      ...(typeof model.name === "string" && model.name.trim() ? { name: model.name.trim() } : {}),
      ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
      ...(typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {}),
    })
  }
  return {
    schemaVersion: 1,
    providerId: parsed.providerId.trim().toLowerCase(),
    displayName: parsed.displayName.trim(),
    ...(parsed.api ? { api: parsed.api } : {}),
    ...(typeof parsed.baseURL === "string" && parsed.baseURL.trim()
      ? { baseURL: parsed.baseURL.trim().replace(/\/+$/, "") }
      : {}),
    models,
  }
}

export function sharedProviderProfiles(
  records: ReadonlyArray<SharedProviderEnvRecord>,
): Map<string, SharedProviderProfile> {
  const disconnected = new Set(
    sharedProviderDisconnectedIdsFromEnvKeys(records.map((record) => record.key)),
  )
  const profiles = new Map<string, SharedProviderProfile>()
  for (const record of records) {
    const providerId = providerIdFromEnvKey(record.key, SHARED_PROVIDER_PROFILE_SUFFIX)
    const profile = parseSharedProviderProfile(record.value)
    if (
      !providerId
      || disconnected.has(providerId)
      || !profile
      || profile.providerId !== providerId
    ) continue
    profiles.set(providerId, profile)
  }
  return profiles
}

/** Credential reference used by the shared DSH/pi-ai provider bridge. */
export function providerApiKeyCredentialRef(providerId: string): string {
  const resolved = providerId.trim().toLowerCase()
  if (resolved === "deepseek-official") return "DEEPSEEK_API_KEY"
  return `${resolved.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`
}
