import { describe, expect, test } from "bun:test";

import {
  buildOpencodePromptInput,
  createOpencodeEngineAdapter,
  describeOpencodeError,
  mapOpencodeEvent,
  mapOpencodePermission,
  mapOpencodeSession,
  opencodePermissionKind,
  OPENCODE_ENGINE_CAPABILITIES,
} from "./opencode.js";

function envelope(type: string, data: unknown, seq?: number) {
  return {
    id: `evt_${type}`,
    type,
    ...(seq === undefined ? {} : { durable: { aggregateID: "ses_1", seq, version: 1 } }),
    data,
  };
}

describe("mapOpencodeEvent", () => {
  test("maps session.next.text.delta to a text message delta", () => {
    const event = mapOpencodeEvent(envelope("session.next.text.delta", {
      timestamp: 1,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      textID: "prt_1",
      delta: "Hello",
    }));

    expect(event).toEqual({
      type: "message.delta",
      sessionId: "ses_1",
      messageId: "msg_1",
      partId: "prt_1",
      kind: "text",
      delta: "Hello",
    });
  });

  test("maps session.next.reasoning.delta to a reasoning message delta", () => {
    const event = mapOpencodeEvent(envelope("session.next.reasoning.delta", {
      timestamp: 1,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      reasoningID: "prt_r1",
      delta: "thinking",
    }));

    expect(event).toMatchObject({ type: "message.delta", kind: "reasoning", partId: "prt_r1", delta: "thinking" });
  });

  test("maps session.next.tool.called", () => {
    const event = mapOpencodeEvent(envelope("session.next.tool.called", {
      timestamp: 1,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      callID: "call_1",
      tool: "bash",
      input: { command: "ls" },
      provider: { executed: true },
    }));

    expect(event).toEqual({
      type: "tool.called",
      sessionId: "ses_1",
      messageId: "msg_1",
      callId: "call_1",
      tool: "bash",
      input: { command: "ls" },
    });
  });

  test("maps session.next.tool.success, leaving the tool name blank for the caller to fill", () => {
    const event = mapOpencodeEvent(envelope("session.next.tool.success", {
      timestamp: 2,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      callID: "call_1",
      structured: { exit: 0 },
      content: [],
      result: "README.md",
      provider: { executed: true },
    }));

    expect(event).toEqual({
      type: "tool.completed",
      sessionId: "ses_1",
      messageId: "msg_1",
      callId: "call_1",
      tool: "",
      status: "success",
      output: "README.md",
    });
  });

  test("falls back to the structured payload when a tool success carries no result", () => {
    const event = mapOpencodeEvent(envelope("session.next.tool.success", {
      timestamp: 2,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      callID: "call_2",
      structured: { exit: 0 },
      content: [],
      provider: { executed: true },
    }));

    expect(event).toMatchObject({ type: "tool.completed", status: "success", output: { exit: 0 } });
  });

  test("maps session.next.tool.failed with a flattened error message", () => {
    const event = mapOpencodeEvent(envelope("session.next.tool.failed", {
      timestamp: 3,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      callID: "call_1",
      error: { type: "unknown", message: "command not found" },
      provider: { executed: false },
    }));

    expect(event).toEqual({
      type: "tool.completed",
      sessionId: "ses_1",
      messageId: "msg_1",
      callId: "call_1",
      tool: "",
      status: "failed",
      error: "command not found",
    });
  });

  test("maps permission.v2.asked", () => {
    const event = mapOpencodeEvent(envelope("permission.v2.asked", {
      id: "per_1",
      sessionID: "ses_1",
      action: "file.edit",
      resources: ["/repo/src/index.ts"],
      save: ["session"],
      metadata: { reason: "write" },
      source: { type: "tool", messageID: "msg_1", callID: "call_1" },
    }));

    expect(event?.type).toBe("permission.asked");
    if (event?.type !== "permission.asked") throw new Error("unexpected event");
    expect(event.permission.id).toBe("per_1");
    expect(event.permission.sessionId).toBe("ses_1");
    expect(event.permission.kind).toBe("edit");
    expect(event.permission.resources).toEqual(["/repo/src/index.ts"]);
    expect(event.permission.remember).toEqual(["session"]);
    expect(event.permission.metadata).toMatchObject({
      reason: "write",
      action: "file.edit",
      save: "session",
      tool: { messageID: "msg_1", callID: "call_1" },
    });
    expect(typeof event.permission.receivedAt).toBe("number");
  });

  test("maps permission.v2.replied", () => {
    expect(mapOpencodeEvent(envelope("permission.v2.replied", {
      sessionID: "ses_1",
      requestID: "per_1",
      reply: "once",
    }))).toEqual({ type: "permission.replied", sessionId: "ses_1", requestId: "per_1" });
  });

  test("maps question.v2.asked", () => {
    const event = mapOpencodeEvent(envelope("question.v2.asked", {
      id: "qst_1",
      sessionID: "ses_1",
      questions: [
        {
          question: "Which branch should I target?",
          header: "Branch",
          options: [
            { label: "main", description: "the default branch" },
            { label: "develop", description: "the integration branch" },
          ],
          multiple: false,
          custom: true,
        },
      ],
      tool: { messageID: "msg_1", callID: "call_1" },
    }));

    expect(event).toEqual({
      type: "question.asked",
      question: {
        id: "qst_1",
        sessionId: "ses_1",
        questions: [
          {
            header: "Branch",
            question: "Which branch should I target?",
            options: [
              { label: "main", description: "the default branch" },
              { label: "develop", description: "the integration branch" },
            ],
            multiple: false,
            custom: true,
          },
        ],
        // receivedAt is wall-clock; asserted separately below.
        receivedAt: (event as { question: { receivedAt: number } }).question.receivedAt,
      },
    });
    if (event?.type !== "question.asked") throw new Error("unexpected event");
    expect(typeof event.question.receivedAt).toBe("number");
  });

  test("maps session.idle", () => {
    expect(mapOpencodeEvent(envelope("session.idle", { sessionID: "ses_1" })))
      .toEqual({ type: "session.idle", sessionId: "ses_1" });
  });

  test("maps session.error, flattening the named v2 error envelope", () => {
    expect(mapOpencodeEvent(envelope("session.error", {
      sessionID: "ses_1",
      error: { name: "ContextOverflowError", data: { message: "context window exceeded" } },
    }))).toEqual({
      type: "session.error",
      sessionId: "ses_1",
      error: { code: "ContextOverflowError", message: "context window exceeded" },
    });
  });

  test("maps message.part.updated, carrying the raw part through", () => {
    const part = {
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "text",
      text: "hello world",
    };
    expect(mapOpencodeEvent(envelope("message.part.updated", { sessionID: "ses_1", part, time: 5 })))
      .toEqual({
        type: "message.part",
        sessionId: "ses_1",
        messageId: "msg_1",
        partId: "prt_1",
        part,
      });
  });

  test("maps message.updated to a message upsert", () => {
    expect(mapOpencodeEvent(envelope("message.updated", {
      sessionID: "ses_1",
      info: { id: "msg_1", sessionID: "ses_1", role: "assistant", time: { created: 10, completed: 20 } },
    }))).toEqual({
      type: "message.upsert",
      sessionId: "ses_1",
      message: { id: "msg_1", role: "assistant", parts: [], createdAt: 10, completedAt: 20 },
    });
  });

  test("maps session.status, including the retry variant", () => {
    expect(mapOpencodeEvent(envelope("session.status", {
      sessionID: "ses_1",
      status: { type: "retry", attempt: 2, message: "rate limited", next: 1500 },
    }))).toEqual({
      type: "session.status",
      sessionId: "ses_1",
      status: { type: "retry", attempt: 2, message: "rate limited", next: 1500 },
    });
  });

  test("maps compaction start and end onto a single running flag", () => {
    expect(mapOpencodeEvent(envelope("session.next.compaction.started", { timestamp: 1, sessionID: "ses_1" })))
      .toEqual({ type: "session.compaction", sessionId: "ses_1", running: true });
    expect(mapOpencodeEvent(envelope("session.compacted", { sessionID: "ses_1" })))
      .toEqual({ type: "session.compaction", sessionId: "ses_1", running: false });
  });

  test("ignores unknown event types", () => {
    expect(mapOpencodeEvent(envelope("pty.created", { id: "pty_1" }))).toBeNull();
    expect(mapOpencodeEvent(envelope("session.next.tool.input.delta", { sessionID: "ses_1" }))).toBeNull();
    expect(mapOpencodeEvent({ type: "not.a.real.event" })).toBeNull();
    expect(mapOpencodeEvent(null)).toBeNull();
    expect(mapOpencodeEvent("session.idle")).toBeNull();
    expect(mapOpencodeEvent({ data: { sessionID: "ses_1" } })).toBeNull();
  });

  test("drops events whose required identifiers are missing", () => {
    expect(mapOpencodeEvent(envelope("session.idle", {}))).toBeNull();
    expect(mapOpencodeEvent(envelope("session.next.text.delta", {
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      textID: "prt_1",
      delta: "",
    }))).toBeNull();
    expect(mapOpencodeEvent(envelope("message.part.updated", { sessionID: "ses_1", part: { type: "text" } }))).toBeNull();
  });

  test("propagates durable.seq as a string cursor", () => {
    expect(mapOpencodeEvent(envelope("session.idle", { sessionID: "ses_1" }, 42)))
      .toEqual({ type: "session.idle", sessionId: "ses_1", seq: "42" });

    expect(mapOpencodeEvent(envelope("session.next.text.delta", {
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      textID: "prt_1",
      delta: "x",
    }, 0))).toMatchObject({ seq: "0" });

    // No durable block on transient events: no cursor is invented.
    expect(mapOpencodeEvent(envelope("session.idle", { sessionID: "ses_1" }))).not.toHaveProperty("seq");
    expect(mapOpencodeEvent({ type: "session.idle", durable: { aggregateID: "a" }, data: { sessionID: "ses_1" } }))
      .not.toHaveProperty("seq");
  });

  test("accepts the classic `properties` envelope as well as the v2 `data` envelope", () => {
    expect(mapOpencodeEvent({ id: "evt", type: "session.idle", properties: { sessionID: "ses_1" } }))
      .toEqual({ type: "session.idle", sessionId: "ses_1" });

    const legacy = mapOpencodeEvent({
      id: "evt",
      type: "permission.asked",
      properties: {
        id: "per_1",
        sessionID: "ses_1",
        permission: "bash",
        patterns: ["rm *"],
        metadata: {},
        always: ["session"],
      },
    });
    expect(legacy?.type).toBe("permission.asked");
    if (legacy?.type !== "permission.asked") throw new Error("unexpected event");
    expect(legacy.permission.kind).toBe("bash");
    expect(legacy.permission.resources).toEqual(["rm *"]);
    expect(legacy.permission.remember).toEqual(["session"]);
  });
});

describe("describeOpencodeError", () => {
  test("reads every error envelope shape OpenCode emits", () => {
    expect(describeOpencodeError({ type: "unknown", message: "boom" })).toEqual({ code: "unknown", message: "boom" });
    expect(describeOpencodeError({ _tag: "ConflictError", message: "conflict" }))
      .toEqual({ code: "ConflictError", message: "conflict" });
    expect(describeOpencodeError({ name: "APIError", data: { message: "429" } }))
      .toEqual({ code: "APIError", message: "429" });
    expect(describeOpencodeError("plain")).toEqual({ message: "plain" });
    expect(describeOpencodeError(undefined).message.length).toBeGreaterThan(0);
  });
});

describe("opencodePermissionKind", () => {
  test("normalizes the v2 action vocabulary", () => {
    expect(opencodePermissionKind("file.read")).toBe("read");
    expect(opencodePermissionKind("file.edit")).toBe("edit");
    expect(opencodePermissionKind("file.write")).toBe("edit");
    expect(opencodePermissionKind("workspace.external_directory")).toBe("external_directory");
    expect(opencodePermissionKind("bash")).toBe("bash");
  });
});

describe("mapOpencodeSession", () => {
  test("maps a v2 SessionV2Info", () => {
    expect(mapOpencodeSession({
      id: "ses_1",
      projectID: "prj_1",
      parentID: "ses_0",
      cost: 0,
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2, archived: 3 },
      title: "Fix the parser",
      location: { directory: "/repo" },
    })).toEqual({
      id: "ses_1",
      title: "Fix the parser",
      parentId: "ses_0",
      directory: "/repo",
      createdAt: 1,
      updatedAt: 2,
      archivedAt: 3,
    });
  });

  test("rejects a payload without an id", () => {
    expect(mapOpencodeSession({ title: "orphan" })).toBeNull();
    expect(mapOpencodeSession(null)).toBeNull();
  });
});

describe("mapOpencodePermission", () => {
  test("keeps the raw metadata alongside the action", () => {
    const permission = mapOpencodePermission({
      id: "per_1",
      sessionID: "ses_1",
      action: "file.read",
      resources: ["/repo/a.ts"],
    }, 1234);
    expect(permission).toEqual({
      id: "per_1",
      sessionId: "ses_1",
      kind: "read",
      resources: ["/repo/a.ts"],
      remember: [],
      metadata: { action: "file.read" },
      receivedAt: 1234,
    });
  });
});

describe("buildOpencodePromptInput", () => {
  test("splits engine prompt parts into text, files and agents", () => {
    expect(buildOpencodePromptInput([
      { type: "text", text: "first" },
      { type: "file", mime: "text/plain", url: "file:///repo/a.txt", filename: "a.txt" },
      { type: "agent", name: "reviewer" },
      { type: "text", text: "second" },
      { type: "file", mime: "image/png", url: "file:///repo/b.png" },
    ])).toEqual({
      text: "first\n\nsecond",
      files: [{ uri: "file:///repo/a.txt", name: "a.txt" }, { uri: "file:///repo/b.png" }],
      agents: [{ name: "reviewer" }],
    });
  });

  test("omits empty collections and empty text parts", () => {
    expect(buildOpencodePromptInput([{ type: "text", text: "" }, { type: "text", text: "only" }]))
      .toEqual({ text: "only" });
    expect(buildOpencodePromptInput([])).toEqual({ text: "" });
  });
});

describe("createOpencodeEngineAdapter", () => {
  function stubClient() {
    const calls: Array<{ method: string; params: unknown }> = [];
    const ok = (method: string, data: unknown) => (params: unknown) => {
      calls.push({ method, params });
      return Promise.resolve({ data, error: undefined, response: new Response(null) });
    };
    const client = {
      session: {
        delete: ok("session.delete", true),
        update: ok("session.update", { id: "ses_1", title: "renamed" }),
      },
      v2: {
        session: {
          create: ok("v2.session.create", { data: { id: "ses_1", title: "", time: { created: 1, updated: 1 } } }),
          get: ok("v2.session.get", { data: { id: "ses_1", title: "T", time: { created: 1, updated: 2 } } }),
          prompt: ok("v2.session.prompt", { data: { id: "inp_1", sessionID: "ses_1" } }),
          switchAgent: ok("v2.session.switchAgent", undefined),
          switchModel: ok("v2.session.switchModel", undefined),
          interrupt: ok("v2.session.interrupt", undefined),
          wait: ok("v2.session.wait", undefined),
          permission: {
            list: ok("v2.session.permission.list", {
              data: [{ id: "per_1", sessionID: "ses_1", action: "file.read", resources: ["/a"] }],
            }),
            reply: ok("v2.session.permission.reply", undefined),
          },
          question: {
            list: ok("v2.session.question.list", {
              data: [{ id: "qst_1", sessionID: "ses_1", questions: [{ question: "q?", header: "h", options: [] }] }],
            }),
            reply: ok("v2.session.question.reply", undefined),
          },
          events: (params: unknown) => {
            calls.push({ method: "v2.session.events", params });
            return Promise.resolve({
              stream: (async function* () {
                yield envelope("session.next.tool.called", {
                  timestamp: 1,
                  sessionID: "ses_1",
                  assistantMessageID: "msg_1",
                  callID: "call_1",
                  tool: "bash",
                  input: {},
                }, 1);
                yield envelope("pty.created", { id: "pty_1" }, 2);
                yield envelope("session.next.tool.success", {
                  timestamp: 2,
                  sessionID: "ses_1",
                  assistantMessageID: "msg_1",
                  callID: "call_1",
                  structured: {},
                  content: [],
                }, 3);
                yield envelope("session.idle", { sessionID: "ses_1" }, 4);
              })(),
            });
          },
        },
      },
    };
    return { client, calls };
  }

  function connect(stub: ReturnType<typeof stubClient>) {
    const adapter = createOpencodeEngineAdapter({
      createClient: () => stub.client as never,
      unwrap: ((result: { data?: unknown; error?: unknown }) => {
        if (result.error !== undefined) throw new Error("opencode_request_failed");
        return result.data;
      }) as never,
    });
    expect(adapter.id).toBe("opencode");
    return adapter.connect({ id: "ws_1" });
  }

  test("advertises the full OpenCode capability set", () => {
    const connection = connect(stubClient());
    expect(connection.engineId).toBe("opencode");
    expect(connection.capabilities).toEqual(OPENCODE_ENGINE_CAPABILITIES);
    expect(OPENCODE_ENGINE_CAPABILITIES).toEqual({
      streaming: true,
      resumableStreaming: true,
      permissions: true,
      questions: true,
      interrupt: true,
      wait: true,
      promptOptions: { system: false, reasoningEffort: false, variant: true },
    });
  });

  test("names a new session through the classic update endpoint", async () => {
    const stub = stubClient();
    const session = await connect(stub).createSession({ title: "renamed", agent: "build" });
    expect(session).toMatchObject({ id: "ses_1", title: "renamed" });
    expect(stub.calls.map((call) => call.method)).toEqual(["v2.session.create", "session.update"]);
    expect(stub.calls[1]?.params).toEqual({ sessionID: "ses_1", title: "renamed" });
  });

  test("switches agent and model before sending the prompt and returns the admitted id", async () => {
    const stub = stubClient();
    const result = await connect(stub).prompt({
      sessionId: "ses_1",
      parts: [{ type: "text", text: "hi" }],
      agent: "plan",
      model: { providerID: "anthropic", modelID: "claude-opus-5" },
      variant: "thinking",
      delivery: "queue",
    });

    expect(result).toEqual({ messageId: "inp_1" });
    expect(stub.calls.map((call) => call.method))
      .toEqual(["v2.session.switchAgent", "v2.session.switchModel", "v2.session.prompt"]);
    expect(stub.calls[1]?.params).toEqual({
      sessionID: "ses_1",
      model: { id: "claude-opus-5", providerID: "anthropic", variant: "thinking" },
    });
    expect(stub.calls[2]?.params).toEqual({
      sessionID: "ses_1",
      prompt: { text: "hi" },
      delivery: "queue",
    });
  });

  test("maps pending permissions and questions", async () => {
    const connection = connect(stubClient());
    const permissions = await connection.listPermissions("ses_1");
    expect(permissions).toHaveLength(1);
    expect(permissions[0]).toMatchObject({ id: "per_1", kind: "read", resources: ["/a"] });

    const questions = await connection.listQuestions("ses_1");
    expect(questions).toHaveLength(1);
    expect(questions[0]?.questions[0]).toMatchObject({ question: "q?", header: "h", options: [] });
  });

  test("sends question answers in the v2 body shape", async () => {
    const stub = stubClient();
    await connect(stub).replyQuestion({ sessionId: "ses_1", questionId: "qst_1", answers: [["main"]] });
    expect(stub.calls[0]).toEqual({
      method: "v2.session.question.reply",
      params: { sessionID: "ses_1", requestID: "qst_1", questionV2Reply: { answers: [["main"]] } },
    });
  });

  test("subscribes with the resume cursor and restores the tool name on completion", async () => {
    const stub = stubClient();
    const controller = new AbortController();
    const events: Array<{ type: string; seq?: string; tool?: string }> = [];

    await connect(stub).subscribe({
      sessionId: "ses_1",
      after: "7",
      signal: controller.signal,
      onEvent: (event) => {
        events.push({
          type: event.type,
          seq: event.seq,
          ...("tool" in event ? { tool: event.tool } : {}),
        });
      },
    });

    expect(stub.calls[0]?.params).toEqual({ sessionID: "ses_1", after: "7" });
    expect(events).toEqual([
      { type: "tool.called", seq: "1", tool: "bash" },
      { type: "tool.completed", seq: "3", tool: "bash" },
      { type: "session.idle", seq: "4" },
    ]);
  });

  test("stops delivering events once the signal aborts", async () => {
    const stub = stubClient();
    const controller = new AbortController();
    const seen: string[] = [];

    await connect(stub).subscribe({
      sessionId: "ses_1",
      signal: controller.signal,
      onEvent: (event) => {
        seen.push(event.type);
        controller.abort();
      },
    });

    expect(seen).toEqual(["tool.called"]);
  });

  test("surfaces a 204 interrupt as success", async () => {
    const stub = stubClient();
    expect(await connect(stub).interrupt("ses_1")).toBe(true);
    expect(stub.calls[0]?.method).toBe("v2.session.interrupt");
  });

  test("wraps SDK failures through the injected unwrap", async () => {
    const stub = stubClient();
    stub.client.v2.session.get = (() =>
      Promise.resolve({ data: undefined, error: { message: "nope" }, response: new Response(null) })) as never;
    await expect(connect(stub).getSession("ses_1")).rejects.toThrow("opencode_request_failed");
  });
});
