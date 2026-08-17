import { describe, expect, test } from "bun:test";

import { isApiError } from "../../../errors.js";
import type { RequestContext, Route } from "../../../routes/registry.js";
import { matchRoute } from "../../../routes/registry.js";
import type { ServerConfig } from "../../../types.js";
import type {
  EngineAdapter,
  EngineAdapterRegistry,
  EngineCapabilities,
  EngineConnection,
  EngineEvent,
  EnginePermission,
  EnginePromptInput,
  EngineQuestion,
  EngineSession,
  EngineSubscribeInput,
} from "../../engine/types.js";
import { registerApiModules, type ApiModuleContext, type ApiOperation } from "../../module.js";
import {
  buildPromptParts,
  formatSessionEventFrame,
  sessionEventToSseFrame,
  sessionsModule,
  SESSIONS_OPERATION_IDS,
} from "./module.js";

const config = { workspaces: [], readOnly: false } as unknown as ServerConfig;

const FULL_CAPABILITIES: EngineCapabilities = {
  streaming: true,
  resumableStreaming: true,
  permissions: true,
  questions: true,
  interrupt: true,
  wait: true,
  promptOptions: { system: true, reasoningEffort: true, variant: true },
};

interface StubCall {
  name: string;
  args: unknown;
}

interface StubConnection {
  connection: EngineConnection;
  calls: StubCall[];
  /** Events the stubbed `subscribe` replays before resolving. */
  events: EngineEvent[];
  subscribed: EngineSubscribeInput[];
}

function session(overrides: Partial<EngineSession> = {}): EngineSession {
  return { id: "s1", title: "Session one", ...overrides };
}

function createStubConnection(
  capabilities: Partial<EngineCapabilities> = {},
  engineId = "opencode",
): StubConnection {
  const calls: StubCall[] = [];
  const events: EngineEvent[] = [];
  const subscribed: EngineSubscribeInput[] = [];
  const record = (name: string, args: unknown) => {
    calls.push({ name, args });
  };

  const connection: EngineConnection = {
    engineId,
    // `promptOptions` is nested, so a spread alone would hand every stub the same object
    // and let one test's mutation leak into the next.
    capabilities: {
      ...FULL_CAPABILITIES,
      ...capabilities,
      promptOptions: { ...FULL_CAPABILITIES.promptOptions, ...capabilities.promptOptions },
    },
    async createSession(input) {
      record("createSession", input);
      return session({ id: "created-1", title: input.title ?? "Untitled" });
    },
    async getSession(sessionId) {
      record("getSession", sessionId);
      return session({ id: sessionId, title: "Renamed" });
    },
    async deleteSession(sessionId) {
      record("deleteSession", sessionId);
    },
    async renameSession(sessionId, title) {
      record("renameSession", { sessionId, title });
    },
    async prompt(input: EnginePromptInput) {
      record("prompt", input);
      return { messageId: "msg-1" };
    },
    async interrupt(sessionId) {
      record("interrupt", sessionId);
      return true;
    },
    async wait(sessionId) {
      record("wait", sessionId);
    },
    async listPermissions(sessionId) {
      record("listPermissions", sessionId);
      const permission: EnginePermission = {
        id: "p1",
        sessionId,
        kind: "bash",
        resources: ["ls"],
        remember: ["session"],
        metadata: {},
        receivedAt: 1,
      };
      return [permission];
    },
    async replyPermission(input) {
      record("replyPermission", input);
    },
    async listQuestions(sessionId) {
      record("listQuestions", sessionId);
      const question: EngineQuestion = {
        id: "q1",
        sessionId,
        questions: [{ question: "Proceed?", options: [{ label: "Yes" }, { label: "No" }] }],
        receivedAt: 2,
      };
      return [question];
    },
    async replyQuestion(input) {
      record("replyQuestion", input);
    },
    async subscribe(input) {
      record("subscribe", { sessionId: input.sessionId, after: input.after });
      subscribed.push(input);
      for (const event of events) input.onEvent(event);
    },
  };

  return { connection, calls, events, subscribed };
}

function createRegistry(connection: EngineConnection, engineId = "opencode"): EngineAdapterRegistry {
  const adapter: EngineAdapter = { id: engineId, connect: () => connection };
  return {
    get: () => adapter,
    has: () => true,
    ids: () => [engineId],
  } as unknown as EngineAdapterRegistry;
}

function createContext(connection: EngineConnection, overrides: Partial<ApiModuleContext> = {}): ApiModuleContext {
  return {
    config,
    ensureWritable: () => {},
    requireClientScope: () => {},
    jsonResponse: (data, status = 200) => Response.json(data as never, { status }),
    readJsonBody: async (request) => (await request.json()) as Record<string, unknown>,
    resolveWorkspace: async (_config, id) => ({ id, engineId: connection.engineId }),
    services: { engines: createRegistry(connection, connection.engineId) },
    ...overrides,
  };
}

function requestContext(request: Request, params: Record<string, string>): RequestContext {
  return {
    request,
    url: new URL(request.url),
    params,
    config,
    approvals: {} as never,
    reloadEvents: {} as never,
    tokens: {} as never,
  };
}

function operations(context: ApiModuleContext): Map<string, ApiOperation> {
  return new Map(sessionsModule.register(context).map((operation) => [operation.operationId, operation]));
}

interface InvokeInput {
  body?: unknown;
  params?: Record<string, string>;
  search?: string;
  signal?: AbortSignal;
}

async function invoke(
  operationId: string,
  connection: EngineConnection,
  input: InvokeInput = {},
  contextOverrides: Partial<ApiModuleContext> = {},
): Promise<Response> {
  const context = createContext(connection, contextOverrides);
  const operation = operations(context).get(operationId);
  if (!operation) throw new Error(`Unknown operation: ${operationId}`);
  const params = { workspaceId: "w1", sessionId: "s1", ...input.params };
  const url = `http://localhost/api/v1/workspaces/w1/sessions/s1${input.search ?? ""}`;
  const request = new Request(url, {
    method: operation.method,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return operation.handler(requestContext(request, params));
}

async function expectApiError(promise: Promise<unknown>): Promise<{ status: number; code: string; details?: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (!isApiError(error)) throw error;
    return { status: error.status, code: error.code, details: error.details };
  }
  throw new Error("Expected the handler to throw an ApiError");
}

describe("sessionsModule declaration", () => {
  test("registers exactly the documented operation ids, in order", () => {
    const stub = createStubConnection();
    const ids = sessionsModule.register(createContext(stub.connection)).map((operation) => operation.operationId);
    expect(ids).toEqual([...SESSIONS_OPERATION_IDS]);
  });

  test("identifies itself as a stable 1.0.0 module", () => {
    expect(sessionsModule.id).toBe("sessions");
    expect(sessionsModule.version).toBe("1.0.0");
    expect(sessionsModule.stability).toBe("stable");
  });

  test("every operation carries a summary, a v1 path and at least one documented response", () => {
    const stub = createStubConnection();
    for (const operation of sessionsModule.register(createContext(stub.connection))) {
      expect(operation.summary.length).toBeGreaterThan(0);
      expect(operation.description?.length ?? 0).toBeGreaterThan(0);
      expect(operation.path.startsWith("/api/v1/workspaces/:workspaceId/sessions")).toBe(true);
      const responses = Object.entries(operation.responses ?? {});
      expect(responses.length).toBeGreaterThan(0);
      for (const [, spec] of responses) {
        expect(spec.description.length).toBeGreaterThan(0);
      }
    }
  });

  test("documents a request body for every operation that reads one", () => {
    const stub = createStubConnection();
    const byId = operations(createContext(stub.connection));
    for (const id of ["createSession", "updateSession", "promptSession", "replySessionPermission", "replySessionQuestion"]) {
      expect(byId.get(id)?.requestBody).toBeDefined();
    }
    expect(byId.get("streamSessionEvents")?.query).toBeDefined();
    expect(byId.get("streamSessionEvents")?.streaming).toBe("sse");
    expect(byId.get("deleteSession")?.effect).toBe("destructive");
  });

  test("registers routable paths on the shared route table", () => {
    const stub = createStubConnection();
    const routes: Route[] = [];
    const result = registerApiModules(routes, [sessionsModule], createContext(stub.connection));
    expect(result.operations).toHaveLength(SESSIONS_OPERATION_IDS.length);

    const matched = matchRoute(routes, "POST", "/api/v1/workspaces/w1/sessions/s1/permissions/perm-9");
    expect(matched).not.toBeNull();
    expect(matched?.params).toEqual({ workspaceId: "w1", sessionId: "s1", permissionId: "perm-9" });
  });
});

describe("engine-backed handlers", () => {
  test("createSession forwards the body and answers 201", async () => {
    const stub = createStubConnection();
    const response = await invoke("createSession", stub.connection, {
      body: { title: "Nightly run", agent: "build", model: { providerID: "anthropic", modelID: "claude" } },
      params: { sessionId: "" },
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      session: { id: "created-1", title: "Nightly run" },
      engine: "opencode",
      capabilities: FULL_CAPABILITIES,
    });
    expect(stub.calls[0]).toEqual({
      name: "createSession",
      args: { title: "Nightly run", agent: "build", model: { providerID: "anthropic", modelID: "claude" } },
    });
  });

  test("promptSession folds `text` into a leading text part and answers 202", async () => {
    const stub = createStubConnection();
    const response = await invoke("promptSession", stub.connection, {
      body: {
        text: "hello",
        parts: [{ type: "file", mime: "image/png", url: "https://example.test/a.png" }],
        delivery: "queue",
      },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, sessionId: "s1", messageId: "msg-1" });
    expect(stub.calls[0]?.name).toBe("prompt");
    expect(stub.calls[0]?.args).toEqual({
      sessionId: "s1",
      parts: [
        { type: "text", text: "hello" },
        { type: "file", mime: "image/png", url: "https://example.test/a.png" },
      ],
      delivery: "queue",
    });
  });

  test("promptSession rejects a prompt option the engine would silently drop", async () => {
    const stub = createStubConnection();
    stub.connection.capabilities.promptOptions.system = false;

    const error = await expectApiError(
      invoke("promptSession", stub.connection, { body: { text: "hi", system: "be terse" } }),
    );

    expect(error.status).toBe(501);
    expect(error.code).toBe("engine_prompt_option_unsupported");
    expect(error.details).toMatchObject({ unsupported: ["system"] });
    // The turn must not reach the engine at all, or the caller would be billed for a run
    // whose system prompt was never applied.
    expect(stub.calls).toEqual([]);
  });

  test("promptSession names every unsupported option, not just the first", async () => {
    const stub = createStubConnection();
    stub.connection.capabilities.promptOptions.system = false;
    stub.connection.capabilities.promptOptions.reasoningEffort = false;

    const error = await expectApiError(
      invoke("promptSession", stub.connection, {
        body: { text: "hi", system: "be terse", reasoningEffort: "high", variant: "thinking" },
      }),
    );

    expect(error.details).toMatchObject({ unsupported: ["system", "reasoningEffort"] });
  });

  test("promptSession passes supported options through", async () => {
    const stub = createStubConnection();
    const response = await invoke("promptSession", stub.connection, {
      body: { text: "hi", system: "be terse", reasoningEffort: "high", variant: "thinking" },
    });

    expect(response.status).toBe(202);
    expect(stub.calls[0]?.args).toMatchObject({
      system: "be terse",
      reasoningEffort: "high",
      variant: "thinking",
    });
  });

  test("interruptSession reports the engine result", async () => {
    const stub = createStubConnection();
    const response = await invoke("interruptSession", stub.connection);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ interrupted: true, sessionId: "s1" });
    expect(stub.calls).toEqual([{ name: "interrupt", args: "s1" }]);
  });

  test("updateSession renames then re-reads the session", async () => {
    const stub = createStubConnection();
    const response = await invoke("updateSession", stub.connection, { body: { title: "Renamed" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ session: { id: "s1", title: "Renamed" } });
    expect(stub.calls.map((call) => call.name)).toEqual(["renameSession", "getSession"]);
  });

  test("deleteSession reports the deleted id", async () => {
    const stub = createStubConnection();
    const response = await invoke("deleteSession", stub.connection);
    expect(await response.json()).toEqual({ deleted: true, sessionId: "s1" });
    expect(stub.calls).toEqual([{ name: "deleteSession", args: "s1" }]);
  });

  test("permission and question replies pass the path ids through", async () => {
    const stub = createStubConnection();
    const permission = await invoke("replySessionPermission", stub.connection, {
      body: { reply: "always" },
      params: { permissionId: "perm-9" },
    });
    expect(await permission.json()).toEqual({ ok: true, permissionId: "perm-9", reply: "always" });

    const question = await invoke("replySessionQuestion", stub.connection, {
      body: { answers: [["Yes"]] },
      params: { questionId: "q-3" },
    });
    expect(await question.json()).toEqual({ ok: true, questionId: "q-3" });

    expect(stub.calls).toEqual([
      { name: "replyPermission", args: { sessionId: "s1", permissionId: "perm-9", reply: "always" } },
      { name: "replyQuestion", args: { sessionId: "s1", questionId: "q-3", answers: [["Yes"]] } },
    ]);
  });

  test("list endpoints wrap the engine collections", async () => {
    const stub = createStubConnection();
    expect(await (await invoke("listSessionPermissions", stub.connection)).json()).toMatchObject({
      permissions: [{ id: "p1", kind: "bash" }],
    });
    expect(await (await invoke("listSessionQuestions", stub.connection)).json()).toMatchObject({
      questions: [{ id: "q1" }],
    });
  });

  test("a missing engine registry is a 500 rather than a crash", async () => {
    const stub = createStubConnection();
    const error = await expectApiError(
      invoke("getSession", stub.connection, {}, { services: {} }),
    );
    expect(error.status).toBe(500);
    expect(error.code).toBe("engine_registry_unavailable");
  });
});

describe("request validation", () => {
  test("rejects a non-string title with 400 invalid_payload and issue details", async () => {
    const stub = createStubConnection();
    const error = await expectApiError(invoke("createSession", stub.connection, { body: { title: 42 } }));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_payload");
    expect((error.details as { issues: Array<{ path: string }> }).issues[0]?.path).toBe("title");
  });

  test("rejects unknown body properties", async () => {
    const stub = createStubConnection();
    const error = await expectApiError(invoke("createSession", stub.connection, { body: { nope: true } }));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_payload");
  });

  test("rejects a prompt with neither text nor parts", async () => {
    const stub = createStubConnection();
    const error = await expectApiError(invoke("promptSession", stub.connection, { body: { delivery: "steer" } }));
    expect(error.status).toBe(400);
    expect((error.details as { issues: Array<{ message: string }> }).issues[0]?.message).toContain("non-empty `parts`");
    expect(stub.calls).toEqual([]);
  });

  test("rejects an unknown prompt part type", async () => {
    const stub = createStubConnection();
    const error = await expectApiError(
      invoke("promptSession", stub.connection, { body: { parts: [{ type: "video", url: "x" }] } }),
    );
    expect(error.status).toBe(400);
  });

  test("rejects an unknown permission reply", async () => {
    const stub = createStubConnection();
    const error = await expectApiError(
      invoke("replySessionPermission", stub.connection, { body: { reply: "maybe" }, params: { permissionId: "p" } }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_payload");
  });

  test("rejects an empty answers array", async () => {
    const stub = createStubConnection();
    const error = await expectApiError(
      invoke("replySessionQuestion", stub.connection, { body: { answers: [] }, params: { questionId: "q" } }),
    );
    expect(error.status).toBe(400);
  });

  test("rejects a blank path parameter", async () => {
    const stub = createStubConnection();
    const error = await expectApiError(invoke("getSession", stub.connection, { params: { sessionId: "  " } }));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_request");
  });

  test("buildPromptParts keeps text first and preserves part order", () => {
    expect(
      buildPromptParts({ text: "a", parts: [{ type: "agent", name: "build" }, { type: "text", text: "b" }] }),
    ).toEqual([
      { type: "text", text: "a" },
      { type: "agent", name: "build" },
      { type: "text", text: "b" },
    ]);
  });
});

describe("capability gating", () => {
  test("interrupt is 501 when the engine cannot interrupt", async () => {
    const stub = createStubConnection({ interrupt: false }, "deepseek-harness");
    const error = await expectApiError(invoke("interruptSession", stub.connection));
    expect(error.status).toBe(501);
    expect(error.code).toBe("engine_capability_unsupported");
    expect(error.details).toEqual({
      engine: "deepseek-harness",
      capability: "interrupt",
      operationId: "interruptSession",
    });
    expect(stub.calls).toEqual([]);
  });

  test("permissions and questions are 501 when unsupported", async () => {
    const noPermissions = createStubConnection({ permissions: false }, "deepseek-harness");
    expect((await expectApiError(invoke("listSessionPermissions", noPermissions.connection))).status).toBe(501);
    const noQuestions = createStubConnection({ questions: false }, "deepseek-harness");
    expect((await expectApiError(invoke("listSessionQuestions", noQuestions.connection))).status).toBe(501);
  });

  test("streaming is 501 when the engine cannot stream", async () => {
    const stub = createStubConnection({ streaming: false }, "deepseek-harness");
    const error = await expectApiError(invoke("streamSessionEvents", stub.connection));
    expect(error.status).toBe(501);
    expect((error.details as { capability: string }).capability).toBe("streaming");
  });

  test("`?after=` is 501 when the engine stream is not resumable", async () => {
    const stub = createStubConnection({ resumableStreaming: false }, "deepseek-harness");
    const error = await expectApiError(invoke("streamSessionEvents", stub.connection, { search: "?after=42" }));
    expect(error.status).toBe(501);
    expect((error.details as { capability: string }).capability).toBe("resumableStreaming");
  });

  test("a non-resumable engine still streams without `?after=`", async () => {
    const stub = createStubConnection({ resumableStreaming: false }, "deepseek-harness");
    const response = await invoke("streamSessionEvents", stub.connection);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    await response.body?.cancel();
  });
});

describe("SSE framing", () => {
  test("maps an event type onto the event line and seq onto the id line", () => {
    const event: EngineEvent = {
      type: "message.delta",
      sessionId: "s1",
      messageId: "m1",
      partId: "p1",
      kind: "text",
      delta: "hi",
      seq: "17",
    };
    expect(sessionEventToSseFrame(event)).toEqual({
      event: "message.delta",
      id: "17",
      data: { type: "message.delta", sessionId: "s1", messageId: "m1", partId: "p1", kind: "text", delta: "hi" },
    });
    expect(formatSessionEventFrame(event)).toBe(
      'id: 17\nevent: message.delta\ndata: {"type":"message.delta","sessionId":"s1","messageId":"m1","partId":"p1","kind":"text","delta":"hi"}\n\n',
    );
  });

  test("omits the id line when the engine reports no cursor", () => {
    const frame = formatSessionEventFrame({ type: "session.idle", sessionId: "s1" });
    expect(frame).toBe('event: session.idle\ndata: {"type":"session.idle","sessionId":"s1"}\n\n');
    expect(frame.includes("id:")).toBe(false);
  });

  test("every frame ends with a blank line and has exactly one event line", () => {
    const frame = formatSessionEventFrame({
      type: "tool.called",
      sessionId: "s1",
      messageId: "m1",
      callId: "c1",
      tool: "bash",
      input: { command: "ls" },
      seq: "3",
    });
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame.split("\n").filter((line) => line.startsWith("event:"))).toHaveLength(1);
    expect(frame.split("\n").filter((line) => line.startsWith("data:"))).toHaveLength(1);
  });
});

describe("streamSessionEvents", () => {
  test("opens with a hello frame, replays engine events, and closes", async () => {
    const stub = createStubConnection();
    stub.events.push(
      { type: "session.status", sessionId: "s1", status: { type: "busy" }, seq: "1" },
      { type: "session.idle", sessionId: "s1", seq: "2" },
    );
    const response = await invoke("streamSessionEvents", stub.connection, { search: "?after=0" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");

    const body = await new Response(response.body).text();
    expect(body).toContain("event: stream.open");
    expect(body).toContain('"after":"0"');
    expect(body).toContain("id: 1\nevent: session.status\n");
    expect(body).toContain("id: 2\nevent: session.idle\n");

    const subscribe = stub.calls.find((call) => call.name === "subscribe");
    expect(subscribe?.args).toEqual({ sessionId: "s1", after: "0" });
  });

  test("resolves the session before opening the stream", async () => {
    const stub = createStubConnection();
    const response = await invoke("streamSessionEvents", stub.connection);
    expect(stub.calls[0]?.name).toBe("getSession");
    await response.body?.cancel();
  });

  test("a client abort aborts the engine subscription and ends the stream", async () => {
    const stub = createStubConnection();
    let resolveSubscribe: (() => void) | undefined;
    const connection: EngineConnection = {
      ...stub.connection,
      async subscribe(input) {
        stub.subscribed.push(input);
        await new Promise<void>((resolve) => {
          resolveSubscribe = resolve;
          input.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    };

    const controller = new AbortController();
    const response = await invoke("streamSessionEvents", connection, { signal: controller.signal });
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: stream.open");

    controller.abort();
    // The producer's inner signal is what stops the upstream subscription.
    await Promise.resolve();
    expect(stub.subscribed[0]?.signal.aborted).toBe(true);
    resolveSubscribe?.();

    const rest = await reader.read();
    expect(rest.done).toBe(true);
  });
});
