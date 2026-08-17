import { describe, expect, test } from "bun:test";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  ConversationEngineAdapterRegistry,
  type ConversationEngineAdapter,
} from "../src/react-app/domains/session/engine/conversation-engine";
import {
  openCodeConversationEngineAdapter,
} from "../src/react-app/domains/session/engine/opencode-conversation-engine";
import { conversationEngineAdapters } from "../src/react-app/domains/session/engine/conversation-engines";
import {
  DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX,
  mapDeepSeekHarnessEnvelope,
  mapDeepSeekHarnessSnapshot,
  normalizeDeepSeekHarnessErrorText,
} from "../src/react-app/domains/session/engine/deepseek-harness-conversation-mapper";
import {
  mapOpenCodeConversationEvent,
  mapOpenCodeConversationSnapshot,
} from "../src/react-app/domains/session/engine/opencode-conversation-mapper";

describe("conversation engine adapters", () => {
  test("keeps OpenCode as default while registering DeepSeek Harness as a peer", () => {
    expect(conversationEngineAdapters.ids()).toEqual([DEFAULT_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID]);
    expect(conversationEngineAdapters.get()).toBe(openCodeConversationEngineAdapter);
    expect(conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).id).toBe(DEEPSEEK_HARNESS_ENGINE_ID);
    expect(() => conversationEngineAdapters.get("unknown")).toThrow(
      "Conversation engine is not registered: unknown",
    );
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
        ],
      },
    });

    expect(snapshot.session).toMatchObject({ id: "dsh-session", title: "Build it" });
    expect(snapshot.messages).toEqual([
      expect.objectContaining({ id: "user-1", role: "user", parts: [expect.objectContaining({ text: "Build it" })] }),
      expect.objectContaining({ id: "dsh:dsh-session:assistant:1:1", role: "assistant", parts: [expect.objectContaining({ text: "Done" })] }),
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
  });

  test("exposes native DeepSeek Harness modes and applies model selection before prompting", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ method: string; payload: Record<string, unknown> }> = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; payload: Record<string, unknown> };
      requests.push(body);
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
      return Response.json({ value: {} });
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
        parts: [{ type: "text", text: "Build it" }],
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
        text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}Internal runtime instructions\n</system>`,
      },
    ]);
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
      expect.objectContaining({
        type: "message.parts",
        parts: [expect.objectContaining({ type: "text", text: "", state: "streaming" })],
      }),
      expect.objectContaining({ type: "message.chunk", chunk: expect.objectContaining({ delta: "你" }) }),
    ]);
    expect(nextChunk).toEqual([
      expect.objectContaining({ type: "message.chunk", chunk: expect.objectContaining({ delta: "好" }) }),
    ]);
  });

  test("normalizes DeepSeek Harness tool arguments into the shared tool schema", () => {
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
    }, { parts: new Set(), tools: new Map() });

    expect(events).toEqual([expect.objectContaining({
      type: "message.parts",
      parts: [expect.objectContaining({
        toolName: "edit",
        input: {
          filePath: "design/session/entry.html",
          oldString: "Before",
          newString: "After",
        },
      })],
    })]);
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
      method: "session.prompt",
      payload: {
        sessionId: "session-1",
        content: [{ type: "text", text: "[Attached file: notes.txt]\nHello DSH" }],
      },
    });
  });
});
