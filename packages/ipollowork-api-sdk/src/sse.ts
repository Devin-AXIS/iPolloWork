/**
 * SSE parsing.
 *
 * Kept separate from the HTTP client and written as a pure incremental parser, because
 * the failure it has to survive is a network chunk boundary landing in the middle of a
 * frame — the kind of bug that only shows up under load and is untestable if the parsing
 * is buried inside a fetch loop.
 */

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Feeds raw text in and gets whole frames out.
 *
 * Per the SSE spec: fields are separated by newlines, frames by a blank line, a leading
 * space after the colon is stripped, and a line starting with `:` is a comment (our
 * keepalive uses one). Multiple `data:` lines in a frame join with newlines.
 */
export class SseParser {
  #buffer = "";

  push(chunk: string): SseEvent[] {
    this.#buffer += chunk;
    const events: SseEvent[] = [];

    // Normalize CRLF and lone CR so frame splitting is uniform.
    this.#buffer = this.#buffer.replace(/\r\n|\r/g, "\n");

    let boundary = this.#buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = this.#buffer.slice(0, boundary);
      this.#buffer = this.#buffer.slice(boundary + 2);
      const event = parseFrame(raw);
      if (event) events.push(event);
      boundary = this.#buffer.indexOf("\n\n");
    }

    return events;
  }

  /** Flushes a trailing frame that was not terminated by a blank line. */
  flush(): SseEvent[] {
    const raw = this.#buffer;
    this.#buffer = "";
    const event = parseFrame(raw);
    return event ? [event] : [];
  }
}

function parseFrame(raw: string): SseEvent | null {
  if (!raw.trim()) return null;

  let event = "message";
  let id: string | undefined;
  const data: string[] = [];

  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }

  if (data.length === 0 && event === "message") return null;
  return { event, data: data.join("\n"), ...(id !== undefined ? { id } : {}) };
}

/** Streams frames from a `Response` body. */
export async function* readSseStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent, void, unknown> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();

  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        yield event;
      }
    }
    for (const event of parser.flush()) yield event;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Releasing matters when the consumer breaks out of the loop early.
    try {
      reader.releaseLock();
    } catch {
      // Already released by cancel().
    }
  }
}
