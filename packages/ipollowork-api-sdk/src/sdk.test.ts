import { describe, expect, test } from "bun:test";

import { IPolloWorkClient, parseEventFrame } from "./client.js";
import { IPolloWorkApiError } from "./errors.js";
import { readSseStream, SseParser } from "./sse.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

/** Records what the client sent so tests can assert on the wire format. */
function recordingFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** The exact envelope `POST|GET /sessions` returns, so the stubs cannot drift from it. */
function sessionEnvelope() {
  return {
    session: { id: "s1", title: "Session one" },
    engine: "opencode",
    capabilities: {
      streaming: true,
      resumableStreaming: true,
      permissions: true,
      questions: true,
      interrupt: true,
      wait: true,
      promptOptions: { system: false, reasoningEffort: false, variant: true },
    },
  };
}

describe("SseParser", () => {
  test("parses a single frame", () => {
    expect(new SseParser().push("event: a\ndata: {\"x\":1}\n\n"))
      .toEqual([{ event: "a", data: '{"x":1}' }]);
  });

  test("keeps the id line", () => {
    expect(new SseParser().push("id: 7\nevent: a\ndata: 1\n\n"))
      .toEqual([{ event: "a", data: "1", id: "7" }]);
  });

  test("reassembles a frame split across chunks", () => {
    const parser = new SseParser();
    expect(parser.push("event: a\nda")).toEqual([]);
    expect(parser.push("ta: hello\n")).toEqual([]);
    expect(parser.push("\n")).toEqual([{ event: "a", data: "hello" }]);
  });

  test("handles several frames in one chunk", () => {
    expect(new SseParser().push("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n"))
      .toEqual([{ event: "a", data: "1" }, { event: "b", data: "2" }]);
  });

  test("joins multiple data lines with newlines", () => {
    expect(new SseParser().push("event: log\ndata: one\ndata: two\n\n"))
      .toEqual([{ event: "log", data: "one\ntwo" }]);
  });

  test("ignores keepalive comments", () => {
    expect(new SseParser().push(": keepalive\n\nevent: a\ndata: 1\n\n"))
      .toEqual([{ event: "a", data: "1" }]);
  });

  test("normalizes CRLF line endings", () => {
    expect(new SseParser().push("event: a\r\ndata: 1\r\n\r\n"))
      .toEqual([{ event: "a", data: "1" }]);
  });

  test("strips only one leading space after the colon", () => {
    expect(new SseParser().push("event: a\ndata:  two-spaces\n\n"))
      .toEqual([{ event: "a", data: " two-spaces" }]);
  });

  test("flush emits a frame that was never terminated", () => {
    const parser = new SseParser();
    expect(parser.push("event: a\ndata: 1")).toEqual([]);
    expect(parser.flush()).toEqual([{ event: "a", data: "1" }]);
  });

  test("flush on an empty buffer yields nothing", () => {
    expect(new SseParser().flush()).toEqual([]);
  });
});

describe("readSseStream", () => {
  test("yields every frame in order", async () => {
    const events = [];
    for await (const event of readSseStream(sseResponse(["event: a\ndata: 1\n\n", "event: b\ndata: 2\n\n"]))) {
      events.push(event);
    }
    expect(events).toEqual([{ event: "a", data: "1" }, { event: "b", data: "2" }]);
  });

  test("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode("event: a\ndata: 1\n\n"));
        // Deliberately left open, so only the abort can end the loop.
      },
    });

    const events = [];
    for await (const event of readSseStream(new Response(stream), controller.signal)) {
      events.push(event);
      controller.abort();
    }
    expect(events).toEqual([{ event: "a", data: "1" }]);
  });
});

describe("parseEventFrame", () => {
  test("returns the typed event payload", () => {
    expect(parseEventFrame("session.idle", '{"type":"session.idle","sessionId":"s1"}'))
      .toEqual({ type: "session.idle", sessionId: "s1" } as never);
  });

  test("adopts the SSE id as the resume cursor", () => {
    expect(parseEventFrame("message.delta", '{"type":"message.delta","sessionId":"s1"}', "42"))
      .toMatchObject({ seq: "42" });
  });

  test("does not overwrite a seq the payload already carries", () => {
    expect(parseEventFrame("x", '{"type":"x","seq":"9"}', "42")).toMatchObject({ seq: "9" });
  });

  test("falls back to the SSE event name when the payload omits a type", () => {
    expect(parseEventFrame("session.idle", '{"sessionId":"s1"}')).toMatchObject({ type: "session.idle" });
  });

  test("rejects a non-JSON payload", () => {
    expect(parseEventFrame("a", "not json")).toBeNull();
  });
});

describe("IPolloWorkClient", () => {
  test("requires a base URL", () => {
    expect(() => new IPolloWorkClient({ baseUrl: "  " })).toThrow(/baseUrl is required/);
  });

  test("sends the bearer token and trims a trailing slash from the base URL", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    await new IPolloWorkClient({ baseUrl: "http://host:8787/", token: "tok", fetch: impl }).health();

    expect(calls[0]!.url.toString()).toBe("http://host:8787/api/v1/health");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  test("omits the authorization header when no token is configured", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl }).health();
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  test("percent-encodes path segments", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse(sessionEnvelope()));
    await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl })
      .getSession("work space/1", "sess/2");

    expect(calls[0]!.url.pathname).toBe("/api/v1/workspaces/work%20space%2F1/sessions/sess%2F2");
  });

  test("posts a prompt body in the documented shape", async () => {
    const { impl, calls } = recordingFetch(() =>
      jsonResponse({ accepted: true, sessionId: "s1", messageId: "m1" }));
    await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl })
      .promptText("w1", "s1", "ship it", { agent: "build" });

    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string))
      .toEqual({ parts: [{ type: "text", text: "ship it" }], agent: "build" });
  });

  test("drops undefined query parameters instead of sending 'undefined'", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse({ items: [] }));
    await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl }).listTasks("w1");
    expect(calls[0]!.url.search).toBe("");
  });

  test("createSession returns the envelope, not a bare session", async () => {
    const { impl } = recordingFetch(() => jsonResponse(sessionEnvelope()));
    const result = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl })
      .createSession("w1", { title: "Session one" });

    // The whole point: `result.session.id` is the id. A flat `result.id` would send the
    // next request to `/sessions/undefined/prompt`.
    expect(result.session.id).toBe("s1");
    expect(result.engine).toBe("opencode");
    expect(result.capabilities.promptOptions.system).toBe(false);
  });

  test("listPermissions returns the `permissions` key the server sends", async () => {
    const { impl } = recordingFetch(() => jsonResponse({ permissions: [{ id: "p1" }] }));
    const result = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl })
      .listPermissions("w1", "s1");
    expect(result.permissions).toHaveLength(1);
  });

  test("listModules returns the bare array the server sends", async () => {
    const { impl } = recordingFetch(() => jsonResponse([{ id: "sessions" }]));
    const result = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl }).listModules();
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]!.id).toBe("sessions");
  });

  test("listWebhooks returns the `webhooks` key and never a secret", async () => {
    const { impl } = recordingFetch(() =>
      jsonResponse({ webhooks: [{ id: "wh1", url: "https://x.test", events: ["*"], hasSecret: true, active: true }] }));
    const result = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl }).listWebhooks("w1");

    expect(result.webhooks[0]!.hasSecret).toBe(true);
    expect(result.webhooks[0]).not.toHaveProperty("secret");
  });

  test("createWebhook surfaces the one-time secret alongside the record", async () => {
    const { impl } = recordingFetch(() =>
      jsonResponse({ webhook: { id: "wh1", hasSecret: true }, secret: "shh" }));
    const result = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl })
      .createWebhook("w1", { url: "https://x.test", events: ["*"] });

    expect(result.webhook.id).toBe("wh1");
    expect(result.secret).toBe("shh");
  });

  test("turns an error body into a typed ApiError", async () => {
    const { impl } = recordingFetch(() =>
      jsonResponse({ code: "session_not_found", message: "Session not found", details: { id: "s1" } }, 404));

    const client = new IPolloWorkClient({ baseUrl: "http://host", fetch: impl });
    const error = await client.getSession("w1", "s1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IPolloWorkApiError);
    expect(error).toMatchObject({ status: 404, code: "session_not_found", details: { id: "s1" } });
    expect((error as IPolloWorkApiError).isRetryable).toBe(false);
  });

  test("synthesizes a code when the error body is not JSON", async () => {
    const { impl } = recordingFetch(() => new Response("<html>502</html>", { status: 502 }));
    const error = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl })
      .health().catch((e: unknown) => e as IPolloWorkApiError);

    expect(error.code).toBe("http_502");
    expect(error.isRetryable).toBe(true);
  });

  test("classifies auth failures", async () => {
    const { impl } = recordingFetch(() => jsonResponse({ code: "forbidden", message: "Insufficient token scope" }, 403));
    const error = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl })
      .health().catch((e: unknown) => e as IPolloWorkApiError);

    expect(error.isAuthError).toBe(true);
    expect(error.isRetryable).toBe(false);
  });

  test("returns undefined for a 204 rather than failing to parse an empty body", async () => {
    const { impl } = recordingFetch(() => new Response(null, { status: 204 }));
    await expect(new IPolloWorkClient({ baseUrl: "http://host", fetch: impl }).deleteSession("w1", "s1"))
      .resolves.toBeUndefined();
  });

  test("reports a timeout as a 408 ApiError", async () => {
    const impl = (async (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })) as unknown as typeof fetch;

    const error = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl, timeoutMs: 10 })
      .health().catch((e: unknown) => e as IPolloWorkApiError);

    expect(error).toBeInstanceOf(IPolloWorkApiError);
    expect(error.status).toBe(408);
    expect(error.code).toBe("request_timeout");
  });

  test("streams session events with the resume cursor applied", async () => {
    const { impl, calls } = recordingFetch(() =>
      sseResponse([
        'id: 1\nevent: message.delta\ndata: {"type":"message.delta","sessionId":"s1","delta":"He"}\n\n',
        ': keepalive\n\n',
        'id: 2\nevent: session.idle\ndata: {"type":"session.idle","sessionId":"s1"}\n\n',
      ]));

    const client = new IPolloWorkClient({ baseUrl: "http://host", fetch: impl });
    const events = [];
    for await (const event of client.streamSession("w1", "s1", { after: "0" })) events.push(event);

    expect(calls[0]!.url.searchParams.get("after")).toBe("0");
    expect((calls[0]!.init.headers as Record<string, string>).accept).toBe("text/event-stream");
    expect(events).toEqual([
      { type: "message.delta", sessionId: "s1", delta: "He", seq: "1" },
      { type: "session.idle", sessionId: "s1", seq: "2" },
    ] as never);
  });

  test("runTask returns immediately when the task is already terminal", async () => {
    let createCalls = 0;
    const impl = (async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/tasks")) {
        createCalls += 1;
        return jsonResponse({ id: "t1", state: "done", goal: "g", workspaceId: "w1", createdAt: 1, updatedAt: 2 });
      }
      throw new Error(`unexpected call to ${url.pathname}`);
    }) as unknown as typeof fetch;

    const task = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl })
      .runTask("w1", { goal: "g" });

    expect(createCalls).toBe(1);
    expect(task.state).toBe("done");
  });

  test("runTask follows the stream to completion and re-reads the final task", async () => {
    const seen: string[] = [];
    const impl = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname.endsWith("/tasks") && init?.method === "POST") {
        return jsonResponse({ id: "t1", state: "queued", goal: "g", workspaceId: "w1", createdAt: 1, updatedAt: 1 });
      }
      if (url.pathname.endsWith("/events")) {
        return sseResponse([
          'event: task.updated\ndata: {"state":"running"}\n\n',
          'event: task.updated\ndata: {"state":"done"}\n\n',
        ]);
      }
      return jsonResponse({ id: "t1", state: "done", goal: "g", workspaceId: "w1", createdAt: 1, updatedAt: 9 });
    }) as unknown as typeof fetch;

    const states: string[] = [];
    const task = await new IPolloWorkClient({ baseUrl: "http://host", fetch: impl })
      .runTask("w1", { goal: "g" }, { onEvent: (_name, data) => states.push((data as { state: string }).state) });

    expect(states).toEqual(["running", "done"]);
    expect(task.state).toBe("done");
    expect(seen).toEqual([
      "POST /api/v1/workspaces/w1/tasks",
      "GET /api/v1/workspaces/w1/tasks/t1/events",
      "GET /api/v1/workspaces/w1/tasks/t1",
    ]);
  });
});
