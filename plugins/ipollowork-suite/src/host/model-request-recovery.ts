import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { SuiteError } from "./errors.ts";

export function isModelTransportError(error: unknown): boolean {
  return error instanceof TypeError && (error.message === "fetch failed" || error.message === "terminated");
}

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
      const transport = isModelTransportError(error);
      if (attempt >= 5 || (!pending && !transport)) throw error;
      await pause(500 * 2 ** attempt, signal);
    }
  }
}

/** Resume delivery only from a byte-identical, previously completed invocation. */
export async function* readModelResponse(response: Response, requestId: string,
  replay: () => Promise<Response>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const type = response.headers.get("content-type");
  const reader = response.body?.getReader();
  if (!reader) return;
  const prefix = createHash("sha256");
  let sent = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return;
      prefix.update(value);
      sent += value.byteLength;
      yield value;
    }
  } catch (error) {
    signal.throwIfAborted();
    if (!isModelTransportError(error) || !type?.startsWith("text/event-stream")
      || response.headers.get("x-ipollo-call-id") !== requestId) throw error;
  } finally {
    reader.releaseLock();
  }

  const restored = await recoverModelRequest(replay, signal);
  const saved = restored.body?.getReader();
  if (!saved) throw new SuiteError("IPW_MODEL_REPLAY_MISMATCH", 502);
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    if (restored.headers.get("x-ipollo-call-id") !== requestId || restored.headers.get("content-type") !== type)
      throw new SuiteError("IPW_MODEL_REPLAY_MISMATCH", 502);
    for (;;) {
      const { done, value } = await saved.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > 16 * 1024 * 1024) throw new SuiteError("IPW_MODEL_REPLAY_MISMATCH", 502);
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks, length);
    if (length < sent || !createHash("sha256").update(bytes.subarray(0, sent)).digest().equals(prefix.digest()))
      throw new SuiteError("IPW_MODEL_REPLAY_MISMATCH", 502);
    if (length > sent) yield bytes.subarray(sent);
  } finally {
    await saved.cancel().catch(() => {}); // Cleanup cannot recover a failed delivery.
    saved.releaseLock();
  }
}
