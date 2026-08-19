const SHARED_PROVIDER_CREDENTIAL_PREFIX = "AGENT_PROVIDER_"
const SHARED_PROVIDER_CREDENTIAL_SUFFIX = "_API_KEY"

/** User-level credential mirror consumed by non-OpenCode agent engines. */
export function sharedProviderCredentialEnvKey(providerId: string): string {
  const encoded = Array.from(new TextEncoder().encode(providerId.trim().toLowerCase()))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
  return `${SHARED_PROVIDER_CREDENTIAL_PREFIX}${encoded}${SHARED_PROVIDER_CREDENTIAL_SUFFIX}`
}

export function sharedProviderIdFromCredentialEnvKey(key: string): string | null {
  const resolved = key.trim().toUpperCase()
  if (
    !resolved.startsWith(SHARED_PROVIDER_CREDENTIAL_PREFIX)
    || !resolved.endsWith(SHARED_PROVIDER_CREDENTIAL_SUFFIX)
  ) {
    return null
  }
  const encoded = resolved.slice(
    SHARED_PROVIDER_CREDENTIAL_PREFIX.length,
    -SHARED_PROVIDER_CREDENTIAL_SUFFIX.length,
  )
  if (!encoded || encoded.length % 2 !== 0 || !/^[0-9A-F]+$/.test(encoded)) return null
  try {
    const bytes = Uint8Array.from(encoded.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16))
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes) || null
  } catch {
    return null
  }
}

/** Credential reference used by the shared DSH/pi-ai provider bridge. */
export function providerApiKeyCredentialRef(providerId: string): string {
  const resolved = providerId.trim().toLowerCase()
  if (resolved === "deepseek-official") return "DEEPSEEK_API_KEY"
  return `${resolved.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`
}
