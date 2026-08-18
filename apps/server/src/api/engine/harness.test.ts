import { describe, expect, test } from "bun:test";

import {
  DeepSeekHarnessRpcError,
  DeepSeekHarnessUnavailableError,
} from "../../deepseek-harness-runtime.js";
import { ApiError } from "../../errors.js";
import {
  createHarnessEngineAdapter,
  createHarnessStreamState,
  HARNESS_CAPABILITIES,
  harnessPromptContent,
  mapHarnessError,
  mapHarnessEvent,
  mapHarnessEvents,
  normalizeHarnessErrorText,
  type HarnessRuntimeLike,
} from "./harness.js";
import type { EngineEvent } from "./types.js";

const SESSION_ID = "dsh-session";

function envelope(payload: Record<string, unknown>, rpcId = "rpc-1") {
  return { type: "server-request", rpcId, payload };
}

function sessionEvent(event: Record<string, unknown>, sessionId = SESSION_ID) {
  return envelope({ type: "session/event", sessionId, event });
}

function sseResponse(frames: unknown[]): Response {
  const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
  return new Response(new TextEncoder().encode(body));
}

type RuntimeCall = { method: string; payload: unknown };

function stubRuntime(input: {
  results?: Record<string, unknown>;
  mux?: unknown[];
  host?: unknown[];
} = {}) {
  const calls: RuntimeCall[] = [];
  const responded: Array<{ rpcId: string; result: unknown }> = [];
  const runtime: HarnessRuntimeLike = {
    async call<T>(method: string, payload: unknown): Promise<T> {
      calls.push({ method, payload });
      return (input.results?.[method] ?? {}) as T;
    },
    async respond(request) {
      responded.push(request);
    },
    async events(stream) {
      return sseResponse((stream === "mux" ? input.mux : input.host) ?? []);
    },
  };
  return { runtime, calls, responded };
}

describe("mapHarnessEvent", () => {
  test("maps an assistant text delta to message.delta without a durable cursor", () => {
    const event = mapHarnessEvent(
      sessionEvent({
        type: "assistant/chunk",
        seq: 7,
        time: 10,
        data: { turn: 1, step: 2, chunk: { type: "text-delta", index: 0, text: "Hel" } },
      }),
      SESSION_ID,
    );

    expect(event).toEqual({
      type: "message.delta",
      sessionId: SESSION_ID,
      messageId: "dsh:dsh-session:assistant:1:2",
      partId: "dsh:dsh-session:assistant:1:2:block:0",
      kind: "text",
      delta: "Hel",
    });
    expect(event && "seq" in event).toBe(false);
  });

  test("maps a reasoning delta to the reasoning kind", () => {
    expect(mapHarnessEvent(
      sessionEvent({
        type: "assistant/chunk",
        seq: 8,
        time: 11,
        data: { turn: 0, step: 0, chunk: { type: "reasoning-delta", index: 3, text: "why" } },
      }),
      SESSION_ID,
    )).toMatchObject({ type: "message.delta", kind: "reasoning", delta: "why" });
  });

  test("maps a user message and strips the internal system block", () => {
    const event = mapHarnessEvent(
      sessionEvent({
        type: "user/message",
        seq: 1,
        time: 5,
        data: {
          id: "user-1",
          role: "user",
          content: [
            { type: "text", text: "<system>\n<!-- ipollowork-internal-context -->\nhidden\n</system>Build it" },
          ],
        },
      }),
      SESSION_ID,
    );

    expect(event).toEqual({
      type: "message.upsert",
      sessionId: SESSION_ID,
      message: {
        id: "user-1",
        role: "user",
        parts: [{ id: "user-1:block:0", type: "text", text: "Build it" }],
        createdAt: 5,
      },
    });
  });

  test("drops plugin-authored user turns", () => {
    expect(mapHarnessEvent(
      sessionEvent({
        type: "user/message",
        seq: 2,
        time: 6,
        data: {
          id: "runtime-context",
          role: "user",
          source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt" },
          content: [{ type: "text", text: "Current runtime context" }],
        },
      }),
      SESSION_ID,
    )).toBeNull();
  });

  test("maps an assistant message onto the turn/step message id", () => {
    expect(mapHarnessEvent(
      sessionEvent({
        type: "assistant/message",
        seq: 4,
        time: 20,
        data: {
          turn: 1,
          step: 1,
          message: { id: "assistant-native", role: "assistant", content: [{ type: "text", text: "Done" }] },
        },
      }),
      SESSION_ID,
    )).toEqual({
      type: "message.upsert",
      sessionId: SESSION_ID,
      message: {
        id: "dsh:dsh-session:assistant:1:1",
        role: "assistant",
        parts: [{ id: "dsh:dsh-session:assistant:1:1:block:0", type: "text", text: "Done" }],
        createdAt: 20,
      },
    });
  });

  test("maps tool/call and normalizes snake_case tool input", () => {
    expect(mapHarnessEvent(
      sessionEvent({
        type: "tool/call",
        seq: 9,
        time: 30,
        data: {
          turn: 1,
          step: 0,
          callId: "call-1",
          name: "read",
          arguments: JSON.stringify({ file_path: "/tmp/a.txt" }),
        },
      }),
      SESSION_ID,
    )).toEqual({
      type: "tool.called",
      sessionId: SESSION_ID,
      messageId: "dsh:dsh-session:assistant:1:0",
      callId: "call-1",
      tool: "read",
      input: { filePath: "/tmp/a.txt" },
    });
  });

  test("pairs tool/result with the recorded tool/call through the stream state", () => {
    const state = createHarnessStreamState();
    mapHarnessEvents(
      sessionEvent({
        type: "tool/call",
        seq: 9,
        time: 30,
        data: { turn: 2, step: 1, callId: "call-9", name: "bash", arguments: { command: "ls" } },
      }),
      SESSION_ID,
      state,
    );

    expect(mapHarnessEvents(
      sessionEvent({
        type: "tool/result",
        seq: 10,
        time: 31,
        data: {
          message: {
            content: [{ type: "tool-result", toolCallId: "call-9", content: [{ type: "text", text: "a.txt" }] }],
          },
        },
      }),
      SESSION_ID,
      state,
    )).toEqual([{
      type: "tool.completed",
      sessionId: SESSION_ID,
      messageId: "dsh:dsh-session:assistant:2:1",
      callId: "call-9",
      tool: "bash",
      status: "success",
      output: "a.txt",
    }]);
    expect(state.tools.size).toBe(0);
  });

  test("reports a failed tool result", () => {
    expect(mapHarnessEvent(
      sessionEvent({
        type: "tool/result",
        seq: 11,
        time: 32,
        data: {
          name: "bash",
          message: {
            content: [{ type: "tool-result", toolCallId: "call-x", content: [], isError: true }],
          },
          error: { name: "CommandFailed" },
        },
      }),
      SESSION_ID,
    )).toMatchObject({ type: "tool.completed", status: "failed", tool: "bash", error: "CommandFailed" });
  });

  test("maps an approval request to a permission carrying its reply address", () => {
    const event = mapHarnessEvent(
      envelope({
        type: "approval/requested",
        sessionId: SESSION_ID,
        approvalId: "approval-1",
        toolName: "bash",
        reason: "Run tests",
      }, "rpc-approval"),
      SESSION_ID,
    );

    expect(event).toMatchObject({
      type: "permission.asked",
      permission: {
        id: "approval-1",
        sessionId: SESSION_ID,
        kind: "bash",
        resources: ["Run tests"],
        // Harness cannot persist an answer, so no scope is offered.
        remember: [],
        metadata: { rpcId: "rpc-approval", toolName: "bash", reason: "Run tests" },
      },
    });
  });

  test("maps approval/resolved and question/resolved to replies", () => {
    expect(mapHarnessEvent(
      envelope({ type: "approval/resolved", sessionId: SESSION_ID, approvalId: "approval-1" }),
      SESSION_ID,
    )).toEqual({ type: "permission.replied", sessionId: SESSION_ID, requestId: "approval-1" });

    expect(mapHarnessEvent(
      envelope({ type: "question/resolved", sessionId: SESSION_ID, questionRpcId: "rpc-question" }),
      SESSION_ID,
    )).toEqual({ type: "question.replied", sessionId: SESSION_ID, requestId: "rpc-question" });
  });

  test("maps a question request, using the rpc id as the question id", () => {
    expect(mapHarnessEvent(
      envelope({
        type: "question/requested",
        sessionId: SESSION_ID,
        questions: [{
          id: "q1",
          header: "Pick",
          question: "Which build?",
          options: [{ label: "debug", description: "slow" }, { label: "release" }],
          multiSelect: false,
        }],
      }, "rpc-question"),
      SESSION_ID,
    )).toEqual({
      type: "question.asked",
      question: {
        id: "rpc-question",
        sessionId: SESSION_ID,
        questions: [{
          header: "Pick",
          question: "Which build?",
          options: [{ label: "debug", description: "slow" }, { label: "release" }],
          multiple: false,
          custom: true,
        }],
        receivedAt: expect.any(Number),
      },
    });
  });

  test("turn/start and turn/end carry the session lifecycle", () => {
    expect(mapHarnessEvent(
      sessionEvent({ type: "turn/start", seq: 3, time: 9, data: { turn: 1 } }),
      SESSION_ID,
    )).toEqual({ type: "session.status", sessionId: SESSION_ID, status: { type: "busy" } });

    expect(mapHarnessEvents(
      sessionEvent({ type: "turn/end", seq: 6, time: 40, data: { turn: 1, reason: { kind: "completed" } } }),
      SESSION_ID,
    )).toEqual([
      { type: "session.status", sessionId: SESSION_ID, status: { type: "idle" } },
      { type: "session.idle", sessionId: SESSION_ID },
    ]);
  });

  test("a failed turn reports the error before idling", () => {
    const events = mapHarnessEvents(
      sessionEvent({
        type: "turn/end",
        seq: 6,
        time: 40,
        data: {
          turn: 1,
          reason: {
            kind: "error",
            error: { message: 'llm-deepseek: no API key for provider route "deepseek-official"' },
          },
        },
      }),
      SESSION_ID,
    );

    expect(events.map((event) => event.type)).toEqual(["session.error", "session.status", "session.idle"]);
    expect(events[0]).toMatchObject({ error: { message: expect.stringContaining("API key") } });
  });

  test("maps todos, titles, compaction and host frames", () => {
    expect(mapHarnessEvent(
      sessionEvent({
        type: "todo/write",
        seq: 5,
        time: 30,
        data: { todos: [{ content: "Verify", status: "in_progress" }] },
      }),
      SESSION_ID,
    )).toEqual({
      type: "todo.updated",
      sessionId: SESSION_ID,
      todos: [{ id: "dsh-session:0:Verify", content: "Verify", status: "in_progress", priority: "medium" }],
    });

    expect(mapHarnessEvent(
      envelope({ type: "session/projection", sessionId: SESSION_ID, key: "title", value: "Ship it" }),
      SESSION_ID,
    )).toEqual({
      type: "session.updated",
      sessionId: SESSION_ID,
      session: { id: SESSION_ID, title: "Ship it" },
    });

    expect(mapHarnessEvent(
      sessionEvent({ type: "compaction/start", seq: 12, time: 50, data: {} }),
      SESSION_ID,
    )).toEqual({ type: "session.compaction", sessionId: SESSION_ID, running: true });

    expect(mapHarnessEvent(
      envelope({ type: "host/session-removed", sessionId: SESSION_ID }),
      SESSION_ID,
    )).toEqual({ type: "session.deleted", sessionId: SESSION_ID });

    expect(mapHarnessEvent(
      envelope({ type: "host/agent-error", sessionId: SESSION_ID, message: "boom" }),
      SESSION_ID,
    )).toEqual({ type: "session.error", sessionId: SESSION_ID, error: { message: "boom" } });
  });

  test("filters frames belonging to another session", () => {
    const other = sessionEvent(
      { type: "turn/start", seq: 3, time: 9, data: { turn: 1 } },
      "another-session",
    );
    expect(mapHarnessEvent(other, SESSION_ID)).toBeNull();
    expect(mapHarnessEvents(other, SESSION_ID)).toEqual([]);
    expect(mapHarnessEvent(
      envelope({ type: "approval/requested", sessionId: "another-session", approvalId: "a" }),
      SESSION_ID,
    )).toBeNull();
  });

  test("returns null for unknown, malformed and deliberately ignored frames", () => {
    expect(mapHarnessEvent(null, SESSION_ID)).toBeNull();
    expect(mapHarnessEvent("nope", SESSION_ID)).toBeNull();
    expect(mapHarnessEvent({ type: "server-request", rpcId: "r" }, SESSION_ID)).toBeNull();
    expect(mapHarnessEvent(envelope({ type: "totally/unknown", sessionId: SESSION_ID }), SESSION_ID)).toBeNull();
    expect(mapHarnessEvent(sessionEvent({ type: "unknown/inner", seq: 1, time: 1, data: {} }), SESSION_ID)).toBeNull();
    // host/session-status races the ordered turn lifecycle and is dropped on purpose.
    expect(mapHarnessEvent(
      envelope({ type: "host/session-status", sessionId: SESSION_ID, running: true }),
      SESSION_ID,
    )).toBeNull();
  });
});

describe("mapHarnessError", () => {
  test("maps an unavailable runtime to 503 with its own code", () => {
    const mapped = mapHarnessError(new DeepSeekHarnessUnavailableError("DeepSeek Harness could not be reached"));
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped).toMatchObject({
      status: 503,
      code: "deepseek_harness_unavailable",
      message: "DeepSeek Harness could not be reached",
    });
  });

  test("maps not-found RPC failures to 404 and everything else to 502", () => {
    for (const code of ["not-found", "session-not-found"]) {
      expect(mapHarnessError(new DeepSeekHarnessRpcError({ code, message: "gone" }))).toMatchObject({
        status: 404,
        code: `deepseek_harness_${code}`,
      });
    }

    expect(mapHarnessError(new DeepSeekHarnessRpcError({
      code: "bad-request",
      message: "nope",
      details: { field: "sessionId" },
    }))).toMatchObject({
      status: 502,
      code: "deepseek_harness_bad-request",
      message: "nope",
      details: { field: "sessionId" },
    });
  });

  test("passes unrelated errors through untouched", () => {
    const error = new Error("unrelated");
    expect(mapHarnessError(error)).toBe(error);
    const apiError = new ApiError(404, "session_not_found", "Session not found");
    expect(mapHarnessError(apiError)).toBe(apiError);
  });

  test("replaces credential internals with an actionable message", () => {
    expect(normalizeHarnessErrorText(
      'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service',
    )).toContain("API key");
    expect(normalizeHarnessErrorText("")).toBe("DeepSeek Harness failed to run this turn");
  });
});

describe("harness engine connection", () => {
  const adapter = createHarnessEngineAdapter({ runtime: stubRuntime().runtime });

  test("reports capabilities honestly", () => {
    expect(adapter.id).toBe("deepseek-harness");
    expect(HARNESS_CAPABILITIES).toEqual({
      streaming: true,
      resumableStreaming: false,
      permissions: true,
      questions: true,
      interrupt: true,
      wait: false,
      promptOptions: { system: true, reasoningEffort: true, variant: true },
    });
  });

  test("routes each operation to its allowlisted RPC method", async () => {
    const { runtime, calls } = stubRuntime({
      results: {
        "session.create": { sessionId: "s1", agentPreset: "standard" },
        // A workspace-scoped connection confirms ownership before every write, so the
        // session has to be visible in this cwd for the writes below to be allowed.
        "session.list": {
          items: [{ sessionId: "s1", updatedAt: 1, running: false, blank: false, cwd: "/work/repo" }],
        },
        "workspace.list": { archivedSessionIds: [] },
      },
    });
    const connection = createHarnessEngineAdapter({ runtime }).connect({ path: "/work/repo" });

    const session = await connection.createSession({ title: "Ship it", agent: "code" });
    expect(session).toMatchObject({ id: "s1", title: "Ship it", directory: "/work/repo" });

    await connection.renameSession("s1", "Renamed");
    expect(await connection.interrupt("s1")).toBe(true);
    await connection.prompt({
      sessionId: "s1",
      parts: [{ type: "text", text: "hello" }],
      model: { providerID: "deepseek", modelID: "deepseek-chat" },
      reasoningEffort: "high",
    });

    // `session.list` + `workspace.list` pairs are the ownership check that precedes each
    // write; the writes themselves keep their original order.
    expect(calls.map((entry) => entry.method).filter((method) => method !== "session.list" && method !== "workspace.list"))
      .toEqual([
        "session.create",
        "agentPreset.select",
        "session.rename",
        "session.rename",
        "session.cancel",
        "session.selectModel",
        "session.prompt",
      ]);
    expect(calls.at(-2)?.payload).toMatchObject({ reasoningEffort: "high", model: "deepseek-chat" });
    expect(calls.at(-1)?.payload).toMatchObject({
      sessionId: "s1",
      mode: "queue",
      content: [{ type: "text", text: "hello" }],
    });
  });

  test("throws 501 for operations DeepSeek Harness has no RPC for", async () => {
    const connection = createHarnessEngineAdapter({ runtime: stubRuntime().runtime }).connect({});

    const rejects = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        return error as ApiError;
      }
      throw new Error("expected a rejection");
    };

    for (const promise of [
      connection.deleteSession("s1"),
      connection.prompt({ sessionId: "s1", parts: [], delivery: "steer" }),
      connection.replyPermission({ sessionId: "s1", permissionId: "p1", reply: "always" }),
      connection.subscribe({
        sessionId: "s1",
        after: "42",
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    ]) {
      const error = await rejects(promise);
      expect(error.status).toBe(501);
      expect(error.code).toBe("engine_capability_unsupported");
      expect(error.message).toContain("DeepSeek Harness");
    }
  });

  test("subscribe consumes both multiplexed streams and answers a permission", async () => {
    const { runtime, responded } = stubRuntime({
      mux: [
        envelope({
          type: "approval/requested",
          sessionId: SESSION_ID,
          approvalId: "approval-1",
          toolName: "bash",
          reason: "Run tests",
        }, "rpc-approval"),
        sessionEvent({ type: "turn/end", seq: 6, time: 40, data: { turn: 1, reason: { kind: "completed" } } }),
        sessionEvent({ type: "turn/start", seq: 1, time: 1, data: { turn: 0 } }, "other-session"),
      ],
      host: [envelope({ type: "host/agent-error", sessionId: SESSION_ID, message: "boom" })],
    });
    const connection = createHarnessEngineAdapter({ runtime }).connect({});
    const events: EngineEvent[] = [];

    await connection.subscribe({
      sessionId: SESSION_ID,
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    });

    expect(events.map((event) => event.type).sort()).toEqual([
      "permission.asked",
      "session.error",
      "session.idle",
      "session.status",
    ]);
    expect(await connection.listPermissions(SESSION_ID)).toHaveLength(1);
    expect(await connection.listPermissions("other-session")).toHaveLength(0);

    await connection.replyPermission({ sessionId: SESSION_ID, permissionId: "approval-1", reply: "once" });
    expect(responded).toEqual([{
      rpcId: "rpc-approval",
      result: {
        ok: true,
        value: { sessionId: SESSION_ID, approvalId: "approval-1", outcome: "allowed-once" },
      },
    }]);
    expect(await connection.listPermissions(SESSION_ID)).toHaveLength(0);
  });

  test("answers a question against the pending frame and rejects a stale id", async () => {
    const { runtime, responded } = stubRuntime({
      mux: [envelope({
        type: "question/requested",
        sessionId: SESSION_ID,
        questions: [{
          id: "q1",
          question: "Which build?",
          options: [{ label: "debug" }, { label: "release" }],
          multiSelect: true,
        }],
      }, "rpc-question")],
    });
    const connection = createHarnessEngineAdapter({ runtime }).connect({});
    await connection.subscribe({
      sessionId: SESSION_ID,
      signal: new AbortController().signal,
      onEvent: () => undefined,
    });

    expect(await connection.listQuestions(SESSION_ID)).toHaveLength(1);
    await connection.replyQuestion({
      sessionId: SESSION_ID,
      questionId: "rpc-question",
      answers: [["release", "wasm"]],
    });
    expect(responded).toEqual([{
      rpcId: "rpc-question",
      result: {
        ok: true,
        value: { sessionId: SESSION_ID, answer: { answers: [{ id: "q1", selected: ["release"], custom: "wasm" }] } },
      },
    }]);

    await expect(connection.replyQuestion({
      sessionId: SESSION_ID,
      questionId: "rpc-question",
      answers: [[]],
    })).rejects.toMatchObject({ status: 404, code: "engine_question_not_found" });
  });

  test("getSession maps the summary and refuses a session from another workspace", async () => {
    const { runtime } = stubRuntime({
      results: {
        "session.list": {
          items: [
            {
              sessionId: SESSION_ID,
              updatedAt: 1_700_000,
              running: false,
              blank: false,
              cwd: "/work/repo",
              projections: { asOfSeq: 3, values: { title: "Ship it" } },
            },
            { sessionId: "elsewhere", updatedAt: 1, running: false, blank: true, cwd: "/other/repo" },
          ],
        },
        "workspace.list": { archivedSessionIds: [SESSION_ID] },
      },
    });
    const connection = createHarnessEngineAdapter({ runtime }).connect({ path: "/work/repo" });

    expect(await connection.getSession(SESSION_ID)).toEqual({
      id: SESSION_ID,
      title: "Ship it",
      parentId: null,
      directory: "/work/repo",
      createdAt: 1_700_000,
      updatedAt: 1_700_000,
      archivedAt: 1_700_000,
    });
    await expect(connection.getSession("elsewhere"))
      .rejects.toMatchObject({ status: 404, code: "session_not_found" });
  });

  test("write operations refuse a session that belongs to another workspace", async () => {
    // The Harness runtime is one process shared by every workspace and `session.list`
    // returns all of them, so a session id proves nothing about access on its own.
    // Without the check, a prompt aimed at another workspace's session would run there —
    // against its files and its agent.
    const foreign = () => stubRuntime({
      results: {
        "session.list": {
          items: [
            { sessionId: SESSION_ID, updatedAt: 1, running: false, blank: false, cwd: "/work/repo" },
            { sessionId: "elsewhere", updatedAt: 1, running: false, blank: true, cwd: "/other/repo" },
          ],
        },
        "workspace.list": { archivedSessionIds: [] },
      },
    });

    for (const [label, act] of [
      ["prompt", (c: ReturnType<ReturnType<typeof createHarnessEngineAdapter>["connect"]>) =>
        c.prompt({ sessionId: "elsewhere", parts: [{ type: "text", text: "hi" }] })],
      ["renameSession", (c: ReturnType<ReturnType<typeof createHarnessEngineAdapter>["connect"]>) =>
        c.renameSession("elsewhere", "renamed")],
      ["interrupt", (c: ReturnType<ReturnType<typeof createHarnessEngineAdapter>["connect"]>) =>
        c.interrupt("elsewhere")],
    ] as const) {
      const { runtime, calls } = foreign();
      const connection = createHarnessEngineAdapter({ runtime }).connect({ path: "/work/repo" });

      await expect(act(connection)).rejects.toMatchObject({ status: 404, code: "session_not_found" });
      // The mutation must not reach the runtime at all.
      expect(calls.map((call) => call.method)).not.toContain("session.prompt");
      expect(calls.map((call) => call.method)).not.toContain("session.rename");
      expect(calls.map((call) => call.method)).not.toContain("session.cancel");
      expect(label).toBeTruthy();
    }
  });

  test("write operations still work on a session in this workspace", async () => {
    const { runtime, calls } = stubRuntime({
      results: {
        "session.list": {
          items: [{ sessionId: SESSION_ID, updatedAt: 1, running: false, blank: false, cwd: "/work/repo" }],
        },
        "workspace.list": { archivedSessionIds: [] },
      },
    });
    const connection = createHarnessEngineAdapter({ runtime }).connect({ path: "/work/repo" });

    await connection.interrupt(SESSION_ID);
    expect(calls.map((call) => call.method)).toContain("session.cancel");
  });

  test("an unscoped connection skips the ownership lookup", async () => {
    // A connection with no directory is not workspace-scoped, so there is nothing to
    // check and the extra `session.list` round-trip would be wasted.
    const { runtime, calls } = stubRuntime();
    const connection = createHarnessEngineAdapter({ runtime }).connect({});

    await connection.interrupt(SESSION_ID);
    expect(calls.map((call) => call.method)).toEqual(["session.cancel"]);
  });

  test("wait polls session.list until the session stops running", async () => {
    let running = true;
    const runtime: HarnessRuntimeLike = {
      async call<T>(method: string): Promise<T> {
        if (method === "workspace.list") return { archivedSessionIds: [] } as T;
        const items = [{ sessionId: SESSION_ID, updatedAt: 1, running, blank: false }];
        running = false;
        return { items } as T;
      },
      async respond() {},
      async events() {
        return sseResponse([]);
      },
    };
    const connection = createHarnessEngineAdapter({ runtime, waitPollIntervalMs: 1 }).connect({});

    await connection.wait(SESSION_ID);
    expect(connection.capabilities.wait).toBe(false);
  });

  test("wait aborts with the caller's signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const connection = createHarnessEngineAdapter({ runtime: stubRuntime().runtime, waitPollIntervalMs: 1 })
      .connect({});
    await expect(connection.wait(SESSION_ID, controller.signal)).rejects.toBeInstanceOf(ApiError);
  });

  test("prompt content carries files, agents and the internal system block", () => {
    expect(harnessPromptContent({
      sessionId: "s1",
      system: "context",
      parts: [
        { type: "text", text: "hi" },
        { type: "agent", name: "reviewer" },
        { type: "file", mime: "image/png", url: "data:image/png;base64,AAA", filename: "shot.png" },
        { type: "file", mime: "text/plain", url: "data:text/plain,hello", filename: "a.txt" },
      ],
    })).toEqual([
      { type: "text", text: "hi" },
      { type: "text", text: "@reviewer" },
      { type: "image", mediaType: "image/png", data: "AAA", name: "shot.png" },
      { type: "text", text: "[Attached file: a.txt]\nhello" },
      { type: "text", text: "<system>\n<!-- ipollowork-internal-context -->\ncontext\n</system>" },
    ]);
  });
});
