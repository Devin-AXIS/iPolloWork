import { describe, expect, test } from "bun:test";

import { createSseResponse, formatSseFrame, SSE_HEADERS } from "./sse.js";

async function readAll(response: Response, limit?: number): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
    if (limit !== undefined && out.length >= limit) {
      await reader.cancel();
      break;
    }
  }
  return out;
}

describe("formatSseFrame", () => {
  test("emits event and data lines", () => {
    expect(formatSseFrame({ event: "session.idle", data: { sessionId: "s1" } }))
      .toBe('event: session.idle\ndata: {"sessionId":"s1"}\n\n');
  });

  test("emits the id line first when a cursor is present", () => {
    expect(formatSseFrame({ event: "message.delta", data: { d: 1 }, id: "42" }))
      .toBe('id: 42\nevent: message.delta\ndata: {"d":1}\n\n');
  });

  test("omits an empty id", () => {
    expect(formatSseFrame({ event: "x", data: null, id: "" })).toBe("event: x\ndata: null\n\n");
  });

  test("splits a multi-line string payload across data lines", () => {
    expect(formatSseFrame({ event: "log", data: "line one\nline two" }))
      .toBe("event: log\ndata: line one\ndata: line two\n\n");
  });

  test("strips newlines from the event name so a payload cannot forge SSE fields", () => {
    const frame = formatSseFrame({ event: "evil\ndata: injected", data: { ok: true } });
    expect(frame).toBe('event: evil data: injected\ndata: {"ok":true}\n\n');
    expect(frame.split("\n").filter((line) => line.startsWith("data:"))).toHaveLength(1);
  });

  test("strips newlines from the id for the same reason", () => {
    expect(formatSseFrame({ event: "x", data: 1, id: "1\nevent: forged" }))
      .toBe("id: 1 event: forged\nevent: x\ndata: 1\n\n");
  });

  test("serializes undefined data as null rather than dropping the field", () => {
    expect(formatSseFrame({ event: "x", data: undefined })).toBe("event: x\ndata: null\n\n");
  });
});

describe("createSseResponse", () => {
  test("sets streaming headers", () => {
    const response = createSseResponse({ start: async () => {}, keepAliveMs: 0 });
    for (const [key, value] of Object.entries(SSE_HEADERS)) {
      expect(response.headers.get(key)).toBe(value);
    }
  });

  test("streams emitted frames and closes when the producer resolves", async () => {
    const response = createSseResponse({
      keepAliveMs: 0,
      start: async (emit) => {
        emit({ event: "a", data: 1 });
        emit({ event: "b", data: 2, id: "7" });
      },
    });

    expect(await readAll(response)).toBe("event: a\ndata: 1\n\nid: 7\nevent: b\ndata: 2\n\n");
  });

  test("writes the hello frame before the producer runs", async () => {
    const response = createSseResponse({
      keepAliveMs: 0,
      hello: { event: "stream.open", data: { after: null } },
      start: async (emit) => emit({ event: "a", data: 1 }),
    });

    expect(await readAll(response)).toBe(
      'event: stream.open\ndata: {"after":null}\n\nevent: a\ndata: 1\n\n',
    );
  });

  test("reports a producer failure as a stream.error frame instead of a broken stream", async () => {
    const response = createSseResponse({
      keepAliveMs: 0,
      start: async () => {
        throw new Error("engine exploded");
      },
    });

    expect(await readAll(response)).toBe(
      'event: stream.error\ndata: {"code":"stream_failed","message":"engine exploded"}\n\n',
    );
  });

  test("aborts the producer when the client disconnects", async () => {
    const clientGone = new AbortController();
    let producerObservedAbort = false;

    const response = createSseResponse({
      keepAliveMs: 0,
      signal: clientGone.signal,
      start: async (emit, signal) => {
        emit({ event: "first", data: 1 });
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            producerObservedAbort = true;
            resolve();
          }, { once: true });
        });
      },
    });

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("event: first\ndata: 1\n\n");

    clientGone.abort();
    await reader.read().catch(() => undefined);

    expect(producerObservedAbort).toBe(true);
  });

  test("returns an already-closed stream when the client aborted before subscribing", async () => {
    const aborted = AbortSignal.abort();
    let producerRan = false;

    const response = createSseResponse({
      keepAliveMs: 0,
      signal: aborted,
      start: async () => {
        producerRan = true;
      },
    });

    expect(await readAll(response)).toBe("");
    expect(producerRan).toBe(false);
  });

  test("a late emit after the stream ends is dropped rather than throwing", async () => {
    let lateEmit: (() => void) | undefined;

    const response = createSseResponse({
      keepAliveMs: 0,
      start: async (emit) => {
        emit({ event: "a", data: 1 });
        lateEmit = () => emit({ event: "late", data: 2 });
      },
    });

    expect(await readAll(response)).toBe("event: a\ndata: 1\n\n");
    expect(() => lateEmit?.()).not.toThrow();
  });

  test("sends keepalive comments while the producer is idle", async () => {
    const done = new AbortController();
    const response = createSseResponse({
      keepAliveMs: 5,
      signal: done.signal,
      start: async (_emit, signal) => {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      },
    });

    const reader = response.body!.getReader();
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toBe(": keepalive\n\n");

    done.abort();
    await reader.read().catch(() => undefined);
  });
});
