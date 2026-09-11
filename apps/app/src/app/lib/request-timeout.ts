export async function fetchWithTimeout(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  timeoutMessage = "Request timed out.",
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetchImpl(input, init);

  const callerSignal = init?.signal === undefined && typeof Request !== "undefined" && input instanceof Request
    ? input.signal
    : init?.signal;
  callerSignal?.throwIfAborted();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const signal = controller && callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller?.signal ?? callerSignal;
  const initWithSignal = signal ? { ...init, signal } : init;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    if (callerSignal) {
      onAbort = () => reject(callerSignal.reason);
      callerSignal.addEventListener("abort", onAbort, { once: true });
    }
    timeoutId = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // The deadline must still reject if the transport cannot abort.
      }
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    // The desktop IPC transport can ignore signals, so abort alone is insufficient.
    return await Promise.race([fetchImpl(input, initWithSignal), timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
    if (onAbort) callerSignal?.removeEventListener("abort", onAbort);
  }
}
