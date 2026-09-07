type ProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const PROVIDER_FETCH_SYMBOL = Symbol.for("ipollowork.mediaProviderFetch");

/**
 * Route external provider traffic through Electron's system-proxy-aware fetch
 * when the desktop host has installed it. Local and headless runtimes retain
 * the platform fetch fallback.
 */
export function providerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const desktopFetch: unknown = Reflect.get(globalThis, PROVIDER_FETCH_SYMBOL);
  return typeof desktopFetch === "function"
    ? (desktopFetch as ProviderFetch)(input, init)
    : fetch(input, init);
}
