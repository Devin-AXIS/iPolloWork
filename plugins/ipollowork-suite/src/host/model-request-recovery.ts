import { setTimeout as delay } from "node:timers/promises";
import { SuiteError } from "./errors.ts";

/** Replay the same gateway invocation before response headers, never a new model call. */
export async function recoverModelRequest(invoke: () => Promise<Response>, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await invoke();
    } catch (error) {
      signal.throwIfAborted();
      const pending = error instanceof SuiteError && error.code === "SERVICE_CALL_RUNNING";
      const transport = error instanceof TypeError && error.message === "fetch failed";
      if (attempt >= 3 || (!pending && !transport)) throw error;
      await delay(500 * 2 ** attempt, undefined, { signal });
    }
  }
}
