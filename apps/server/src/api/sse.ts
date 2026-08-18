/**
 * Server-sent events for the public API.
 *
 * The server has no first-party SSE stream to copy: `/workspace/:id/events` is a polling
 * endpoint returning `{items, cursor}` (`routes/operations.ts:31`), and the DeepSeek
 * Harness route only forwards an upstream body verbatim (`routes/deepseek-harness.ts:113`).
 * So this is the one place where the streaming contract is defined, and everything that
 * streams — sessions, tasks — goes through it, rather than each module hand-rolling a
 * stream with its own subtly different abort and keepalive behaviour.
 */

export interface SseFrame {
  /** Becomes the SSE `event:` line. */
  event: string;
  data: unknown;
  /** Becomes the SSE `id:` line — the cursor a client resumes from. */
  id?: string;
}

/**
 * Formats one frame.
 *
 * Multi-line payloads need one `data:` line each, or the client sees a truncated event;
 * `JSON.stringify` normally emits a single line, but a hand-built string payload may not.
 */
export function formatSseFrame(frame: SseFrame): string {
  const payload = typeof frame.data === "string" ? frame.data : JSON.stringify(frame.data ?? null);
  const lines: string[] = [];
  if (frame.id !== undefined && frame.id !== "") {
    lines.push(`id: ${sanitizeSseValue(frame.id)}`);
  }
  lines.push(`event: ${sanitizeSseValue(frame.event)}`);
  for (const line of String(payload).split("\n")) {
    lines.push(`data: ${line}`);
  }
  return `${lines.join("\n")}\n\n`;
}

/**
 * Strips CR/LF from a single-line SSE field.
 *
 * An event type or id carrying a newline would otherwise let a payload forge extra SSE
 * fields — the stream equivalent of header injection.
 */
function sanitizeSseValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // Proxies that buffer by default will otherwise hold the stream until it ends.
  "x-accel-buffering": "no",
};

export interface SseStreamOptions {
  /**
   * Produces the stream. Call `emit` for each frame; resolve to end the stream.
   * `signal` aborts when the client disconnects.
   */
  start: (emit: (frame: SseFrame) => void, signal: AbortSignal) => Promise<void>;
  /** Client disconnect signal, normally `ctx.request.signal`. */
  signal?: AbortSignal;
  /** Comment heartbeat interval. Set to 0 to disable. */
  keepAliveMs?: number;
  /** Frame sent before the producer starts, so clients see an immediately open stream. */
  hello?: SseFrame;
}

const DEFAULT_KEEPALIVE_MS = 15_000;

/**
 * Builds a streaming `Response`.
 *
 * Two failure modes drive the shape of this function. A producer that keeps running after
 * the client has gone leaks an upstream subscription, so the client's abort is propagated
 * inward through an `AbortController` the producer is handed. And enqueueing onto a closed
 * controller throws, so every write goes through a guard that goes quiet once the stream is
 * done — otherwise a late event from the engine turns into an unhandled rejection.
 */
export function createSseResponse(options: SseStreamOptions): Response {
  const { start, signal, keepAliveMs = DEFAULT_KEEPALIVE_MS, hello } = options;
  const encoder = new TextEncoder();
  const controller = new AbortController();

  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let onAbort: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          streamController.enqueue(encoder.encode(chunk));
        } catch {
          // The consumer went away between our `closed` check and the enqueue.
          closed = true;
        }
      };

      const finish = (error?: unknown): void => {
        if (closed) return;
        closed = true;
        if (keepAlive !== undefined) clearInterval(keepAlive);
        if (onAbort && signal) signal.removeEventListener("abort", onAbort);
        controller.abort();
        try {
          if (error !== undefined) streamController.error(error);
          else streamController.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      if (signal) {
        if (signal.aborted) {
          finish();
          return;
        }
        onAbort = () => finish();
        signal.addEventListener("abort", onAbort, { once: true });
      }

      if (hello) write(formatSseFrame(hello));

      if (keepAliveMs > 0) {
        keepAlive = setInterval(() => {
          // A comment line keeps intermediaries from timing the connection out
          // without being delivered to the client as an event.
          write(": keepalive\n\n");
        }, keepAliveMs);
        // Do not hold the process open for an idle stream.
        (keepAlive as unknown as { unref?: () => void }).unref?.();
      }

      const emit = (frame: SseFrame): void => {
        write(formatSseFrame(frame));
      };

      start(emit, controller.signal)
        .then(() => finish())
        .catch((error: unknown) => {
          // A disconnect surfaces here as an abort; that is a normal end, not a failure.
          if (controller.signal.aborted || closed) {
            finish();
            return;
          }
          write(formatSseFrame({
            event: "stream.error",
            data: { code: "stream_failed", message: errorMessage(error) },
          }));
          finish();
        });
    },
    cancel() {
      closed = true;
      if (keepAlive !== undefined) clearInterval(keepAlive);
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      controller.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Stream failed";
}
