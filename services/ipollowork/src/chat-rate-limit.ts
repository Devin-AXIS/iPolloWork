import { setTimeout as delay } from "node:timers/promises";
import { ServiceError } from "./errors.js";

function connectFailure(error: unknown): boolean {
  const cause = error instanceof TypeError ? error.cause : undefined;
  return cause instanceof Error && "code" in cause
    && ["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"].includes(String(cause.code));
}

/** Retry chat only after explicit rate limiting or failure to establish the connection. */
export async function fetchChatWithRateLimitRecovery(fetcher: typeof fetch, url: string, init: RequestInit, retry: boolean): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetcher(url, init);
    } catch (error) {
      if (!retry || !connectFailure(error)) throw error;
      const failed = new ServiceError("SERVICE_UPSTREAM_CONNECTION_FAILED", 503, undefined, { cause: error });
      if (attempt >= 1 || init.signal?.aborted) throw failed;
      await delay(500, undefined, { signal: init.signal ?? undefined }).catch(() => { throw failed; });
      continue;
    }
    if (!retry || response.status !== 429 || attempt >= 2) return response;
    const header = response.headers.get("retry-after");
    const requested = header === null ? NaN : /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    const wait = Number.isFinite(requested) ? Math.max(0, requested) : 500 * 2 ** attempt;
    // Leave long cooldowns visible to the caller instead of holding a request indefinitely.
    if (wait > 4000) return response;
    await response.body?.cancel();
    try {
      await delay(wait, undefined, { signal: init.signal ?? undefined });
    } catch (cause) {
      // No inference was accepted: cancellation during cooldown must release its reservation.
      throw new ServiceError("SERVICE_RATE_LIMITED", 429, "SERVICE_RATE_LIMITED", { cause });
    }
  }
}
