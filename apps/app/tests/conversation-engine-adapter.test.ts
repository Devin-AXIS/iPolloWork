import { describe, expect, test } from "bun:test";
import {
  CODEX_HARNESS_ENGINE_ID,
  DEEPSEEK_HARNESS_ENGINE_ID,
  DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX,
  DEFAULT_ENGINE_ID,
} from "@ipollowork/types/workspace";

import {
  ConversationEngineAdapterRegistry,
  type ConversationEngineAdapter,
  type ConversationPermission,
} from "../src/react-app/domains/session/engine/conversation-engine";
import {
  openCodeConversationEngineAdapter,
} from "../src/react-app/domains/session/engine/opencode-conversation-engine";
import { conversationEngineAdapters } from "../src/react-app/domains/session/engine/conversation-engines";
import {
  mapDeepSeekHarnessEnvelope,
  mapDeepSeekHarnessSnapshot,
  normalizeDeepSeekHarnessErrorText,
} from "../src/react-app/domains/session/engine/deepseek-harness-conversation-mapper";
import {
  mapOpenCodeConversationEvent,
  mapOpenCodeConversationSnapshot,
} from "../src/react-app/domains/session/engine/opencode-conversation-mapper";
import {
  createCodexLiveState,
  mapCodexHarnessEvent,
} from "../src/react-app/domains/session/engine/codex-harness-conversation-mapper";

describe("conversation engine adapters", () => {
  test("keeps OpenCode as default while registering Harness engines as peers", () => {
    expect(conversationEngineAdapters.ids()).toEqual([
      DEFAULT_ENGINE_ID,
      DEEPSEEK_HARNESS_ENGINE_ID,
      CODEX_HARNESS_ENGINE_ID,
    ]);
    expect(conversationEngineAdapters.get()).toBe(openCodeConversationEngineAdapter);
    expect(conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).id).toBe(DEEPSEEK_HARNESS_ENGINE_ID);
    expect(conversationEngineAdapters.get(CODEX_HARNESS_ENGINE_ID).id).toBe(CODEX_HARNESS_ENGINE_ID);
    expect(() => conversationEngineAdapters.get("unknown")).toThrow(
      "Conversation engine is not registered: unknown",
    );
  });

  test("maps Codex app-server turns, streaming output, and approvals into the shared protocol", () => {
    const state = createCodexLiveState();
    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "turn/started",
      params: { threadId: "codex-thread", turn: { id: "turn-1" } },
    }, state)).toEqual([{ type: "session.status", sessionId: "codex-thread", status: { type: "busy" } }]);

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "item/started",
      params: {
        threadId: "codex-thread",
        turnId: "turn-1",
        startedAtMs: 9,
        item: {
          type: "userMessage",
          id: "codex-user-item",
          clientId: "ipollowork-user-1",
          content: [{ type: "text", text: "立即显示" }],
        },
      },
    }, state)).toEqual([expect.objectContaining({
      type: "message.upsert",
      message: expect.objectContaining({ id: "ipollowork-user-1", role: "user" }),
    })]);

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "item/started",
      params: {
        threadId: "codex-thread",
        turnId: "turn-1",
        startedAtMs: 10,
        item: { type: "agentMessage", id: "answer-1", text: "" },
      },
    }, state)).toEqual([expect.objectContaining({
      type: "message.upsert",
      message: expect.objectContaining({ id: "answer-1", role: "assistant" }),
    })]);

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "item/agentMessage/delta",
      params: { threadId: "codex-thread", turnId: "turn-1", itemId: "answer-1", delta: "完成" },
    }, state)).toEqual([expect.objectContaining({
      type: "message.chunk",
      messageId: "answer-1",
      chunk: expect.objectContaining({ type: "text-delta", delta: "完成" }),
    })]);

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "item/completed",
      params: {
        threadId: "codex-thread",
        turnId: "turn-1",
        completedAtMs: 12,
        item: {
          type: "agentMessage",
          id: "answer-1",
          content: [{ type: "text", text: "完成" }],
        },
      },
    }, state)).toEqual([expect.objectContaining({
      type: "message.upsert",
      message: expect.objectContaining({
        id: "answer-1",
        parts: [expect.objectContaining({ type: "text", text: "完成", state: "done" })],
      }),
    })]);

    const completedTurnEvents = mapCodexHarnessEvent({
      type: "notification",
      method: "turn/completed",
      params: { threadId: "codex-thread", turn: { id: "turn-1", status: "completed" } },
    }, state);
    expect(completedTurnEvents).toContainEqual({ type: "session.idle", sessionId: "codex-thread" });
    expect(completedTurnEvents.some((event) => event.type === "session.error")).toBe(false);

    expect(mapCodexHarnessEvent({
      type: "request",
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "codex-thread", turnId: "turn-1", itemId: "tool-1", command: "pnpm test" },
    }, state)).toEqual([expect.objectContaining({
      type: "permission.asked",
      permission: expect.objectContaining({ sessionId: "codex-thread", kind: "shell", resources: ["pnpm test"] }),
    })]);

    expect(mapCodexHarnessEvent({
      type: "request",
      id: "legacy-approval",
      method: "execCommandApproval",
      params: {
        conversationId: "codex-thread",
        command: ["powershell.exe", "-Command", "Get-ChildItem"],
        cwd: "C:\\workspace",
      },
    }, state)).toEqual([expect.objectContaining({
      type: "permission.asked",
      permission: expect.objectContaining({
        sessionId: "codex-thread",
        kind: "shell",
        resources: ["powershell.exe -Command Get-ChildItem", "C:\\workspace"],
      }),
    })]);
  });

  test("does not mark a Codex reasoning-only turn as successfully processed", () => {
    const state = createCodexLiveState();
    mapCodexHarnessEvent({
      type: "notification",
      method: "turn/started",
      params: { threadId: "codex-thread", turn: { id: "turn-without-result" } },
    }, state);
    mapCodexHarnessEvent({
      type: "notification",
      method: "item/completed",
      params: {
        threadId: "codex-thread",
        turnId: "turn-without-result",
        item: { type: "reasoning", id: "reasoning-only", summary: ["Still thinking"] },
      },
    }, state);

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "turn/completed",
      params: { threadId: "codex-thread", turn: { id: "turn-without-result", status: "completed" } },
    }, state)).toEqual(expect.arrayContaining([
      {
        type: "session.error",
        sessionId: "codex-thread",
        errorText: "Codex 已结束处理，但没有返回最终结果。请重试这条需求。",
      },
      { type: "session.idle", sessionId: "codex-thread" },
    ]));
  });

  test("keeps Codex completion state isolated to the matching user turn", () => {
    const state = createCodexLiveState();
    mapCodexHarnessEvent({
      type: "notification",
      method: "turn/started",
      params: { threadId: "codex-thread", turn: { id: "turn-with-result" } },
    }, state);
    mapCodexHarnessEvent({
      type: "notification",
      method: "item/completed",
      params: {
        threadId: "codex-thread",
        turnId: "turn-with-result",
        item: { type: "agentMessage", id: "answer-first", text: "第一轮结果" },
      },
    }, state);
    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "turn/completed",
      params: { threadId: "codex-thread", turn: { id: "turn-with-result", status: "completed" } },
    }, state).some((event) => event.type === "session.error")).toBe(false);

    mapCodexHarnessEvent({
      type: "notification",
      method: "turn/started",
      params: { threadId: "codex-thread", turn: { id: "turn-without-result" } },
    }, state);
    mapCodexHarnessEvent({
      type: "notification",
      method: "item/completed",
      params: {
        threadId: "codex-thread",
        turnId: "turn-without-result",
        item: { type: "reasoning", id: "reasoning-second", summary: ["第二轮仍在思考"] },
      },
    }, state);
    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "turn/completed",
      params: { threadId: "codex-thread", turn: { id: "turn-without-result", status: "completed" } },
    }, state)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "session.error", sessionId: "codex-thread" }),
      { type: "session.idle", sessionId: "codex-thread" },
    ]));
  });

  test("keeps Codex always-allow effective for later shell requests in the same task", async () => {
    const originalFetch = globalThis.fetch;
    const responses: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string }> = [];
    let eventController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let firstPermission: ConversationPermission | null = null;
    let resolveFirstPermission = () => {};
    const firstPermissionReady = new Promise<void>((resolve) => {
      resolveFirstPermission = resolve;
    });
    globalThis.fetch = (async (input, init) => {
      if (String(input).endsWith("/events")) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            eventController = controller;
          },
        }), { headers: { "content-type": "text/event-stream" } });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      responses.push(body);
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(CODEX_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_codex",
        token: "token",
      });
      const subscribe = connection.subscribe({
        signal: new AbortController().signal,
        onEvent(event) {
          events.push(event);
          if (event.type === "permission.asked" && !firstPermission) {
            firstPermission = event.permission;
            resolveFirstPermission();
          }
        },
      });
      await Promise.resolve();
      const encoder = new TextEncoder();
      eventController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: "request",
        id: 41,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "codex-thread",
          command: "powershell.exe -Command Get-ChildItem",
          cwd: "C:\\workspace",
          proposedExecpolicyAmendment: ["powershell.exe"],
          availableDecisions: [
            "accept",
            { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["powershell.exe"] } },
            "decline",
          ],
        },
      })}\n\n`));
      await firstPermissionReady;
      if (!firstPermission) throw new Error("Codex permission was not emitted");
      await connection.replyPermission({ permission: firstPermission, reply: "always" });

      eventController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: "request",
        id: 42,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "codex-thread",
          command: "powershell.exe -Command pnpm test",
          cwd: "C:\\workspace\\apps\\app",
        },
      })}\n\n`));
      eventController?.close();
      await subscribe;
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(events.filter((event) => event.type === "permission.asked")).toHaveLength(1);
    expect(responses).toEqual([
      {
        rpcId: 41,
        result: { decision: "acceptForSession" },
      },
      { rpcId: 42, result: { decision: "accept" } },
    ]);
  });

  test("uses the legacy Codex approval response vocabulary", async () => {
    const originalFetch = globalThis.fetch;
    const responses: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      responses.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(CODEX_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_codex",
        token: "token",
      });
      await connection.replyPermission({
        permission: {
          id: "legacy-approval",
          sessionId: "codex-thread",
          kind: "shell",
          resources: ["powershell.exe -Command Get-ChildItem"],
          remember: ["always"],
          metadata: {},
          receivedAt: Date.now(),
          native: {
            rpcId: "legacy-approval",
            method: "execCommandApproval",
            params: { conversationId: "codex-thread" },
          },
        },
        reply: "always",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(responses).toEqual([{
      rpcId: "legacy-approval",
      result: { decision: "approved_for_session" },
    }]);
  });

  test("keeps Codex application context out of the authored user message", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ ok: true, sessionId: "codex-thread-rebound" });
    }) as typeof fetch;

    let promptResult: { sessionId: string } | undefined;
    try {
      const connection = conversationEngineAdapters.get(CODEX_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_codex",
        token: "token",
      });
      promptResult = await connection.sendPrompt({
        sessionId: "codex-thread",
        clientUserMessageId: "ipollowork-user-1",
        parts: [
          { type: "text", text: "Internal template instructions", synthetic: true },
          { type: "text", text: "当前是什么模型和 agent" },
        ],
        system: "Long-running local process rule:\nInternal application context",
        model: { providerID: "deepseek-official", modelID: "deepseek-v4-flash" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([{
      payload: {
        threadId: "codex-thread",
        clientUserMessageId: "ipollowork-user-1",
        input: [{ type: "text", text: "当前是什么模型和 agent", text_elements: [] }],
        system: "Long-running local process rule:\nInternal application context\n\nInternal template instructions",
        model: { providerID: "deepseek-official", modelID: "deepseek-v4-flash" },
      },
    }]);
    expect(promptResult).toEqual({ sessionId: "codex-thread-rebound" });
  });

  test("hides application context embedded by legacy Codex turns", () => {
    const events = mapCodexHarnessEvent({
      type: "notification",
      method: "item/completed",
      params: {
        threadId: "codex-thread",
        turnId: "turn-legacy",
        item: {
          type: "userMessage",
          id: "user-legacy",
          content: [
            { type: "text", text: "Plugin instructions that were also hidden" },
            { type: "text", text: "Workspace contract\n\nLong-running local process rule:\nInternal application context" },
            { type: "text", text: "当前是什么模型和 agent" },
          ],
        },
      },
    }, createCodexLiveState());

    expect(events).toEqual([expect.objectContaining({
      type: "message.upsert",
      message: expect.objectContaining({
        role: "user",
        parts: [expect.objectContaining({ text: "当前是什么模型和 agent" })],
      }),
    })]);
  });

  test("rejects duplicate adapter registrations", () => {
    const duplicate = { ...openCodeConversationEngineAdapter } satisfies ConversationEngineAdapter;
    expect(() => new ConversationEngineAdapterRegistry(DEFAULT_ENGINE_ID, [
      openCodeConversationEngineAdapter,
      duplicate,
    ])).toThrow(`Duplicate conversation engine adapter: ${DEFAULT_ENGINE_ID}`);
  });

  test("maps every existing OpenCode session event into the shared protocol", () => {
    const rawEvents = [
      { type: "session.updated", properties: { info: { id: "ses", title: "Title", time: {} } } },
      { type: "session.deleted", properties: { info: { id: "ses" } } },
      { type: "session.error", properties: { sessionID: "ses", error: "failed" } },
      { type: "session.next.compaction.started", properties: { sessionID: "ses" } },
      { type: "session.next.compaction.ended", properties: { sessionID: "ses" } },
      { type: "session.compacted", properties: { sessionID: "ses" } },
      { type: "session.status", properties: { sessionID: "ses", status: { type: "busy" } } },
      { type: "session.idle", properties: { sessionID: "ses" } },
      {
        type: "todo.updated",
        properties: {
          sessionID: "ses",
          todos: [{ content: "Ship", status: "pending", priority: "high" }],
        },
      },
      {
        type: "permission.asked",
        properties: {
          id: "perm-legacy",
          sessionID: "ses",
          permission: "bash",
          patterns: ["echo ok"],
          metadata: {},
          always: ["echo *"],
        },
      },
      {
        type: "permission.v2.asked",
        properties: {
          id: "perm-v2",
          sessionID: "ses",
          action: "file.read",
          resources: ["/tmp/a"],
          metadata: {},
          save: ["/tmp/*"],
        },
      },
      { type: "permission.replied", properties: { sessionID: "ses", requestID: "perm-legacy" } },
      { type: "permission.v2.replied", properties: { sessionID: "ses", requestID: "perm-v2" } },
      {
        type: "question.asked",
        properties: {
          id: "question",
          sessionID: "ses",
          questions: [{ question: "Continue?", options: [{ label: "Yes" }] }],
        },
      },
      { type: "question.replied", properties: { sessionID: "ses", requestID: "question" } },
      { type: "question.rejected", properties: { sessionID: "ses", requestID: "question" } },
      {
        type: "message.updated",
        properties: { info: { id: "msg", sessionID: "ses", role: "assistant" } },
      },
      { type: "message.removed", properties: { sessionID: "ses", messageID: "msg" } },
      {
        type: "message.part.updated",
        properties: {
          part: { id: "part", sessionID: "ses", messageID: "msg", type: "text", text: "Hello" },
        },
      },
      {
        type: "message.part.delta",
        properties: { sessionID: "ses", messageID: "msg", partID: "part", delta: "Hello" },
      },
    ];

    expect(rawEvents.map((event) => mapOpenCodeConversationEvent(event)?.type)).toEqual([
      "session.updated",
      "session.deleted",
      "session.error",
      "session.compaction",
      "session.compaction",
      "session.compaction",
      "session.status",
      "session.idle",
      "todo.updated",
      "permission.asked",
      "permission.asked",
      "permission.replied",
      "permission.replied",
      "question.asked",
      "question.replied",
      "question.replied",
      "message.upsert",
      "message.removed",
      "message.parts",
      "message.chunk",
    ]);

    expect(mapOpenCodeConversationEvent(rawEvents[10])).toMatchObject({
      type: "permission.asked",
      permission: {
        kind: "read",
        resources: ["/tmp/a"],
        remember: ["/tmp/*"],
      },
    });
    expect(mapOpenCodeConversationEvent(rawEvents[19])).toMatchObject({
      type: "message.chunk",
      chunk: { type: "text-delta", id: "part", delta: "Hello" },
    });
  });

  test("maps snapshots directly into AI SDK UI messages", () => {
    const snapshot = mapOpenCodeConversationSnapshot({
      session: { id: "ses", title: "Title", time: { created: 1, updated: 2 } },
      messages: [{
        info: { id: "msg", role: "assistant", sessionID: "ses", time: { created: 1 } },
        parts: [{ id: "part", type: "text", text: "Hello", sessionID: "ses", messageID: "msg" }],
      }],
      todos: [{ content: "Ship", status: "pending", priority: "high" }],
      status: { type: "idle" },
    });

    expect(snapshot.messages).toEqual([expect.objectContaining({
      id: "msg",
      role: "assistant",
      parts: [expect.objectContaining({ type: "text", text: "Hello" })],
    })]);
    expect(snapshot.todos).toEqual([expect.objectContaining({ content: "Ship" })]);
  });

  test("maps DeepSeek Harness history into the same conversation protocol", () => {
    const snapshot = mapDeepSeekHarnessSnapshot({
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      session: { id: "dsh-session", title: "<system> Long-running local process rule", dsh: { running: false } },
      history: {
        hasMore: false,
        events: [
          {
            event: {
              type: "step/start",
              seq: 1,
              time: 9,
              data: { turn: 1, step: 1 },
            },
          },
          {
            event: {
              type: "user/message",
              seq: 2,
              time: 10,
              data: {
                id: "user-1",
                role: "user",
                source: { kind: "user" },
                content: [
                  { type: "text", text: "<system>\nInternal runtime instructions\n</system>" },
                  { type: "text", text: "Build it" },
                ],
              },
            },
          },
          {
            event: {
              type: "user/message",
              seq: 3,
              time: 15,
              data: {
                id: "runtime-context",
                role: "user",
                source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt" },
                content: [{ type: "text", text: "Current runtime context" }],
              },
            },
          },
          {
            event: {
              type: "assistant/message",
              seq: 4,
              time: 20,
              data: {
                turn: 1,
                step: 1,
                message: { id: "assistant-native", role: "assistant", content: [{ type: "text", text: "Done" }] },
              },
            },
          },
          {
            event: {
              type: "todo/write",
              seq: 5,
              time: 30,
              data: { todos: [{ content: "Verify", status: "in_progress" }] },
            },
          },
          {
            event: {
              type: "turn/end",
              seq: 6,
              time: 40,
              data: { turn: 1, reason: { kind: "completed" } },
            },
          },
        ],
      },
    });

    expect(snapshot.session).toMatchObject({ id: "dsh-session", title: "Build it" });
    expect(snapshot.messages).toEqual([
      expect.objectContaining({ id: "user-1", role: "user", parts: [expect.objectContaining({ text: "Build it" })] }),
      expect.objectContaining({
        id: "dsh:dsh-session:assistant:1:1",
        role: "assistant",
        metadata: expect.objectContaining({ ipollowork: expect.objectContaining({ completed: 40 }) }),
        parts: [expect.objectContaining({ text: "Done", state: "done" })],
      }),
    ]);
    expect(snapshot.todos).toEqual([expect.objectContaining({ content: "Verify", status: "in_progress" })]);
  });

  test("maps DeepSeek Harness approvals without offering unsupported persistent grants", () => {
    const events = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-approval",
      payload: {
        type: "approval/requested",
        sessionId: "dsh-session",
        approvalId: "approval-1",
        toolName: "bash",
        reason: "Run tests",
      },
    }, { parts: new Set(), tools: new Map() });

    expect(events).toEqual([expect.objectContaining({
      type: "permission.asked",
      permission: expect.objectContaining({
        id: "approval-1",
        sessionId: "dsh-session",
        kind: "bash",
        resources: ["Run tests"],
        remember: [],
      }),
    })]);
  });

  test("replaces DeepSeek Harness credential internals with an actionable message", () => {
    const raw = 'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service';
    const normalized = normalizeDeepSeekHarnessErrorText(raw);
    expect(normalized).toContain("API key");
    expect(normalized).not.toContain("credentials service");

    expect(mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-error",
      payload: { type: "host/agent-error", sessionId: "session-1", message: raw },
    }, { parts: new Set(), tools: new Map() })).toEqual([{
      type: "session.error",
      sessionId: "session-1",
      errorText: normalized,
    }]);

    expect(normalizeDeepSeekHarnessErrorText("错误")).not.toBe("错误");
  });

  test("explains when a selected model is absent from the DeepSeek Harness runtime", async () => {
    const originalFetch = globalThis.fetch;
    const methods: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      methods.push(body.method ?? "");
      if (body.method === "session.selectModel") {
        return Response.json({ message: "错误" }, { status: 400 });
      }
      if (body.method === "llm.models") {
        return Response.json({ value: {
          groups: [{ id: "opencode", models: [{ id: "deepseek-v4-flash-free" }] }],
        } });
      }
      return Response.json({ value: {} });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_dsh",
        token: "token",
      });
      await expect(connection.sendPrompt({
        sessionId: "session-1",
        parts: [{ type: "text", text: "Which model is active?" }],
        model: { providerID: "tokenstar", modelID: "gpt-5.6-sol" },
      })).rejects.toThrow("DeepSeek Harness");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(methods).toEqual(["session.selectModel", "llm.models"]);
  });

  test("routes the account OpenAI provider through DSH's Codex OAuth route", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ method: string; payload: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        method?: string;
        payload?: Record<string, unknown>;
      };
      if (String(input).endsWith("/prompt")) {
        requests.push({ method: "session.prompt", payload: body.payload ?? {} });
        return Response.json({ ok: true });
      }
      requests.push({ method: body.method ?? "", payload: body.payload ?? {} });
      if (body.method === "llm.models") {
        return Response.json({ value: {
          groups: [{ id: "openai-codex", models: [{ id: "gpt-5.4" }] }],
        } });
      }
      return Response.json({ value: {} });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_dsh",
        token: "token",
      });
      await connection.sendPrompt({
        sessionId: "session-codex",
        parts: [{ type: "text", text: "Use Codex" }],
        model: { providerID: "openai", modelID: "gpt-5.4" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests.map((request) => request.method)).toEqual([
      "llm.models",
      "session.selectModel",
      "session.prompt",
    ]);
    expect(requests[1]?.payload).toMatchObject({
      provider: "openai-codex",
      model: "gpt-5.4",
    });
  });

  test("routes OpenAI Fast aliases through DSH's priority Codex adapter", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ method: string; payload: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        method?: string;
        payload?: Record<string, unknown>;
      };
      if (String(input).endsWith("/prompt")) {
        requests.push({ method: "session.prompt", payload: body.payload ?? {} });
        return Response.json({ ok: true });
      }
      requests.push({ method: body.method ?? "", payload: body.payload ?? {} });
      if (body.method === "llm.models") {
        return Response.json({ value: {
          groups: [{ id: "openai-codex-priority", models: [{ id: "gpt-5.4-fast" }] }],
        } });
      }
      return Response.json({ value: {} });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_dsh",
        token: "token",
      });
      await connection.sendPrompt({
        sessionId: "session-codex-fast",
        parts: [{ type: "text", text: "Use priority Codex" }],
        model: { providerID: "openai", modelID: "gpt-5.4-fast" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests[1]?.payload).toMatchObject({
      provider: "openai-codex-priority",
      model: "gpt-5.4-fast",
    });
  });

  test("exposes native DeepSeek Harness modes and applies model selection before prompting", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ method: string; payload: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        method?: string;
        payload: Record<string, unknown>;
      };
      const request = String(input).endsWith("/prompt")
        ? { method: "session.prompt", payload: body.payload }
        : { method: body.method ?? "", payload: body.payload };
      requests.push(request);
      if (body.method === "agentPreset.list") {
        return Response.json({ value: {
          presets: [
            { id: "standard", isDefault: true, name: "标准模式" },
            { id: "code", isDefault: false, name: "PTC 模式" },
            { id: "minimal", isDefault: false, name: "极简模式" },
            { id: "cordis", isDefault: false, name: "创造模式" },
          ],
        } });
      }
      return Response.json(String(input).endsWith("/prompt") ? { ok: true } : { value: {} });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_dsh",
        token: "token",
      });
      expect((await connection.listModes()).map((mode) => [mode.id, mode.icon])).toEqual([
        ["standard", "execute"],
        ["code", "code"],
        ["minimal", "minimal"],
        ["cordis", "create"],
      ]);

      await connection.sendPrompt({
        sessionId: "session-1",
        parts: [
          { type: "text", text: "Build it" },
          { type: "text", text: "Apply the private template checklist", synthetic: true },
        ],
        system: "Internal runtime instructions",
        model: { providerID: "deepseek-official", modelID: "deepseek-v4-pro" },
        mode: "code",
        variant: "max",
      });
      expect(connection.modeState?.({
        id: "session-1",
        title: "Session",
        dsh: { agentPreset: "code", blank: true },
      })).toEqual({ id: "code", mutable: false });
      await connection.sendPrompt({
        sessionId: "session-1",
        parts: [{ type: "text", text: "Continue" }],
        model: { providerID: "deepseek-official", modelID: "deepseek-v4-pro" },
        mode: "minimal",
        variant: "max",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests.map((request) => request.method)).toEqual([
      "agentPreset.list",
      "agentPreset.select",
      "session.selectModel",
      "session.prompt",
      "session.prompt",
    ]);
    expect(requests[2]?.payload).toEqual({
      sessionId: "session-1",
      provider: "deepseek-official",
      model: "deepseek-v4-pro",
      reasoningEffort: "max",
    });
    expect(requests[3]?.payload.content).toEqual([
      { type: "text", text: "Build it" },
      {
        type: "text",
        text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}Apply the private template checklist\n</system>`,
      },
      {
        type: "text",
        text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}Internal runtime instructions\n</system>`,
      },
    ]);
  });

  test("maps installed plugin commands and agents into DeepSeek Harness prompts", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input, init) => {
      if (String(input).endsWith("/plugin-capabilities")) {
        return Response.json({
          items: [
            {
              pluginId: "school-tools",
              resourceId: "review-command",
              type: "command",
              name: "review-labels",
              description: "Review annotations",
            },
            {
              pluginId: "school-tools",
              resourceId: "review-agent",
              type: "agent",
              name: "annotation-reviewer",
              description: "Annotation reviewer",
            },
          ],
        });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_dsh",
        token: "token",
      });
      expect(await connection.listCommands()).toEqual([
        expect.objectContaining({ name: "review-labels", description: "Review annotations" }),
      ]);
      expect(await connection.listAgents()).toEqual([
        expect.objectContaining({ name: "annotation-reviewer", description: "Annotation reviewer" }),
      ]);

      await connection.runCommand({
        sessionId: "session-1",
        command: "review-labels",
        arguments: "project 12",
      });
      await connection.sendPrompt({
        sessionId: "session-1",
        parts: [
          { type: "agent", name: "annotation-reviewer" },
          { type: "text", text: "Review the current batch" },
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      {
        payload: {
          sessionId: "session-1",
          mode: "queue",
          content: [],
          clientTimeZone: expect.any(String),
        },
        plugins: { command: { name: "review-labels", arguments: "project 12" } },
      },
      {
        payload: {
          sessionId: "session-1",
          mode: "queue",
          content: [{ type: "text", text: "Review the current batch" }],
          clientTimeZone: expect.any(String),
        },
        plugins: { agents: ["annotation-reviewer"] },
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain("Check every annotation");
    expect(JSON.stringify(requests)).not.toContain("Act as a careful annotation quality reviewer");
  });

  test("hides DeepSeek Harness synthetic user events from the live conversation", () => {
    const synthetic = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-plugin",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "user/message",
          seq: 1,
          time: 10,
          data: {
            id: "skill-catalog",
            role: "user",
            source: { kind: "skill-catalog" },
            content: [{ type: "text", text: "<system-reminder>internal skills</system-reminder>" }],
          },
        },
      },
    }, { parts: new Set(), tools: new Map() });

    const authored = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-user",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "user/message",
          seq: 2,
          time: 20,
          data: {
            id: "user-1",
            role: "user",
            source: { kind: "user" },
            content: [
              { type: "text", text: "你好啊" },
              { type: "text", text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}internal\n</system>` },
            ],
          },
        },
      },
    }, { parts: new Set(), tools: new Map() });

    expect(synthetic).toEqual([]);
    expect(authored).toEqual([expect.objectContaining({
      type: "message.upsert",
      message: expect.objectContaining({
        role: "user",
        parts: [expect.objectContaining({ type: "text", text: "你好啊" })],
      }),
    })]);

    const mixed = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-mixed-user",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "user/message",
          seq: 3,
          time: 30,
          data: {
            id: "user-2",
            role: "user",
            source: { kind: "user" },
            content: [{
              type: "text",
              text: `Visible request\n${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}private checklist\n</system>\nVisible tail`,
            }],
          },
        },
      },
    }, { parts: new Set(), tools: new Map() });

    expect(mixed).toEqual([expect.objectContaining({
      type: "message.upsert",
      message: expect.objectContaining({
        parts: [expect.objectContaining({ text: "Visible request\n\nVisible tail" })],
      }),
    })]);
  });

  test("honors the declared assistant role on DeepSeek Harness user-message envelopes", () => {
    const events = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-assistant-in-user-envelope",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "user/message",
          seq: 4,
          time: 40,
          data: {
            id: "assistant-stage",
            role: "assistant",
            source: { kind: "user" },
            turn: 2,
            step: 1,
            content: [{ type: "text", text: "The brief is clear. I will inspect the template." }],
          },
        },
      },
    }, { parts: new Set(), tools: new Map() });

    expect(events).toEqual([expect.objectContaining({
      type: "message.upsert",
      message: expect.objectContaining({
        id: "assistant-stage",
        role: "assistant",
        parts: [expect.objectContaining({
          type: "text",
          text: "The brief is clear. I will inspect the template.",
        })],
      }),
    })]);
  });

  test("streams DeepSeek Harness output after the user message without waiting for completion", () => {
    const state = { parts: new Set<string>(), tools: new Map() };
    const stepStart = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-step",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: { type: "step/start", seq: 7, time: 10, data: { turn: 1, step: 1 } },
      },
    }, state);
    const firstChunk = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-chunk-1",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "assistant/chunk",
          seq: 9,
          time: 20,
          data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "你" } },
        },
      },
    }, state);
    const nextChunk = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-chunk-2",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "assistant/chunk",
          seq: 10,
          time: 21,
          data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "好" } },
        },
      },
    }, state);

    expect(stepStart).toEqual([]);
    expect(firstChunk).toEqual([
      { type: "session.status", sessionId: "dsh-session", status: { type: "busy" } },
      expect.objectContaining({
        type: "message.parts",
        messageRole: "assistant",
        parts: [expect.objectContaining({ type: "text", text: "", state: "streaming" })],
      }),
      expect.objectContaining({ type: "message.chunk", chunk: expect.objectContaining({ delta: "你" }) }),
    ]);
    expect(nextChunk).toEqual([
      { type: "session.status", sessionId: "dsh-session", status: { type: "busy" } },
      expect.objectContaining({ type: "message.chunk", chunk: expect.objectContaining({ delta: "好" }) }),
    ]);
  });

  test("uses the ordered DeepSeek Harness turn boundary instead of the racing host status", () => {
    const state = { parts: new Set<string>(), tools: new Map() };

    expect(mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-host-idle",
      payload: { type: "host/session-status", sessionId: "dsh-session", running: false },
    }, state)).toEqual([]);

    mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-chunk",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "assistant/chunk",
          seq: 10,
          time: 20,
          data: { turn: 2, step: 1, chunk: { type: "text-delta", index: 0, text: "Done" } },
        },
      },
    }, state);

    const completed = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-turn-end",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "turn/end",
          seq: 11,
          time: 30,
          data: { turn: 2, reason: { kind: "completed" } },
        },
      },
    }, state);

    expect(completed).toEqual([
      {
        type: "message.completed",
        sessionId: "dsh-session",
        messageId: "dsh:dsh-session:assistant:2:1",
        completedAt: 30,
      },
      { type: "session.status", sessionId: "dsh-session", status: { type: "idle" } },
      { type: "session.idle", sessionId: "dsh-session" },
    ]);
  });

  test("normalizes DeepSeek Harness tool arguments into the shared tool schema", () => {
    const state = { parts: new Set<string>(), tools: new Map() };
    const events = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-edit",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "tool/call",
          seq: 3,
          time: 30,
          data: {
            turn: 1,
            step: 1,
            callId: "edit-1",
            name: "edit",
            arguments: JSON.stringify({
              file_path: "design/session/entry.html",
              old_string: "Before",
              new_string: "After",
            }),
          },
        },
      },
    }, state);

    expect(events).toEqual([
      { type: "session.status", sessionId: "dsh-session", status: { type: "busy" } },
      expect.objectContaining({
        type: "message.parts",
        parts: [expect.objectContaining({
          toolName: "edit",
          input: {
            filePath: "design/session/entry.html",
            oldString: "Before",
            newString: "After",
          },
        })],
      }),
    ]);

    const resultEvents = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-edit-result",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "tool/result",
          seq: 4,
          time: 40,
          data: {
            message: {
              content: [{ type: "tool-result", toolCallId: "edit-1", content: "updated" }],
            },
          },
        },
      },
    }, state);

    expect(resultEvents).toEqual([
      { type: "session.status", sessionId: "dsh-session", status: { type: "busy" } },
      expect.objectContaining({
        type: "message.parts",
        parts: [expect.objectContaining({ state: "output-available", output: "updated" })],
      }),
    ]);
  });

  test("normalizes DeepSeek Harness text attachments without leaking data URLs", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ value: { accepted: true } });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_dsh",
        token: "token",
      });
      await connection.sendPrompt({
        sessionId: "session-1",
        parts: [{
          type: "file",
          mime: "text/plain",
          filename: "notes.txt",
          url: "data:text/plain;base64,SGVsbG8gRFNI",
        }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestBody).toMatchObject({
      payload: {
        sessionId: "session-1",
        mode: "queue",
        content: [{ type: "text", text: "[Attached file: notes.txt]\nHello DSH" }],
      },
    });
  });
});
