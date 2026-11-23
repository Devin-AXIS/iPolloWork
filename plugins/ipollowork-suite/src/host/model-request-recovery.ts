import { setTimeout as delay } from "node:timers/promises";
import { SuiteError } from "./errors.ts";

/** Replay the same gateway invocation before response headers, never a new model call. */
export async function recoverModelRequest(invoke: () => Promise<Response>, signal: AbortSignal,
  pause: (milliseconds: number, signal: AbortSignal) => Promise<void> = (milliseconds, signal) => delay(milliseconds, undefined, { signal }),
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await invoke();
    } catch (error) {
      signal.throwIfAborted();
      // Admission rejections have not invoked the model. A malformed proxy response may
      // hide a completed invocation; replaying its original id reads the saved result.
      const pending = error instanceof SuiteError && [
        "SERVICE_CALL_RUNNING", "SERVICE_DRAINING", "SERVICE_BUSY", "SERVICE_QUEUE_TIMEOUT", "IPW_INVALID_RESPONSE",
      ].includes(error.code);
      const transport = error instanceof TypeError && error.message === "fetch failed";
      if (attempt >= 5 || (!pending && !transport)) throw error;
      await pause(500 * 2 ** attempt, signal);
    }
  }
}
