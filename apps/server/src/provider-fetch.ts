import { isApiError, providerApiError } from "./errors.js";
import { readLimitedRequestBody } from "./limited-request-body.js";

type ProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const PROVIDER_FETCH_SYMBOL = Symbol.for("ipollowork.mediaProviderFetch");

/**
 * Route external provider traffic through Electron's system-proxy-aware fetch
 * when the desktop host has installed it. Local and headless runtimes retain
 * the platform fetch fallback.
 */
export async function providerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const desktopFetch: unknown = Reflect.get(globalThis, PROVIDER_FETCH_SYMBOL);
  // Keep a deadline alive through body consumption, even if a caller clears its
  // own header timer. Mutations are deliberately never retried here.
  const deadline = AbortSignal.timeout(240_000);
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const options = { ...init, signal: signal ? AbortSignal.any([signal, deadline]) : deadline };
  try {
    const response = await (typeof desktopFetch === "function" ? (desktopFetch as ProviderFetch)(input, options) : fetch(input, options));
    if ([401, 402, 403, 408, 429].includes(response.status) || response.status >= 500) {
      let payload: unknown;
      try {
        const bytes = await readLimitedRequestBody(response, 64 * 1024);
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        await response.body?.cancel().catch(() => undefined);
        // HTML, empty, truncated and oversized gateway errors use HTTP status.
      }
      const detail = payload !== null && typeof payload === "object" && "error" in payload ? payload.error : payload;
      const message = detail !== null && typeof detail === "object" && "message" in detail && typeof detail.message === "string" ? detail.message : "";
      const code = detail !== null && typeof detail === "object" && "code" in detail && typeof detail.code === "string" ? detail.code : "";
      throw providerApiError({ status: response.status, message, code }, response.status);
    }
    return response;
  } catch (error) {
    if (isApiError(error)) throw error;
    const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
    throw providerApiError(error, timeout ? 504 : 502);
  }
}
