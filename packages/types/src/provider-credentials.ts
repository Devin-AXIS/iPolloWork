const SHARED_PROVIDER_CREDENTIAL_PREFIX = "AGENT_PROVIDER_"
const SHARED_PROVIDER_CREDENTIAL_SUFFIX = "_API_KEY"
const SHARED_PROVIDER_PROFILE_SUFFIX = "_PROFILE"

export type SharedProviderModelProfile = {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
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
  api?: "openai-completions" | "openai-responses" | "anthropic-messages"
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

/** Provider connections owned by the current iPolloWork user account. */
export function sharedProviderIdsFromEnvKeys(keys: readonly string[]): string[] {
  return [
    ...new Set(
      keys.flatMap((key) => {
        const providerId = sharedProviderIdFromCredentialEnvKey(key)
        return providerId ? [providerId] : []
      }),
    ),
  ].sort()
}

export function sharedProviderProfileEnvKey(providerId: string): string {
  return `${SHARED_PROVIDER_CREDENTIAL_PREFIX}${encodedProviderId(providerId)}${SHARED_PROVIDER_PROFILE_SUFFIX}`
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
  const profiles = new Map<string, SharedProviderProfile>()
  for (const record of records) {
    const providerId = providerIdFromEnvKey(record.key, SHARED_PROVIDER_PROFILE_SUFFIX)
    const profile = parseSharedProviderProfile(record.value)
    if (!providerId || !profile || profile.providerId !== providerId) continue
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
