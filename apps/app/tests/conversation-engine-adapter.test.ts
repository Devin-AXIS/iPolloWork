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
  createOpenCodeConversationLiveState,
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

  test("does not start any engine when prompt preflight was already stopped", async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      throw new Error("An aborted prompt must not reach the network");
    }) as typeof fetch;
    const signal = AbortSignal.abort();

    try {
      const connections = [
        conversationEngineAdapters.get(DEFAULT_ENGINE_ID).connect({ baseUrl: "http://opencode.test" }),
        conversationEngineAdapters.get(CODEX_HARNESS_ENGINE_ID).connect({
          baseUrl: "http://unused.test",
          serverBaseUrl: "http://ipollowork.test",
          workspaceId: "ws_codex",
        }),
        conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).connect({
          baseUrl: "http://unused.test",
          serverBaseUrl: "http://ipollowork.test",
          workspaceId: "ws_dsh",
        }),
      ];
      for (const connection of connections) {
        expect(await connection.sendPrompt({
          sessionId: "session-stopped-during-preflight",
          signal,
          parts: [{ type: "text", text: "123" }],
        })).toEqual({ sessionId: "session-stopped-during-preflight" });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestCount).toBe(0);
  });

  test("keeps plugin agents and the iPolloWork runtime agent out of OpenCode work modes", async () => {
    const originalFetch = globalThis.fetch;
    const promptBodies: unknown[] = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.includes("/agent")) {
        return Response.json([
          { name: "ipollowork", description: "iPolloWork default agent", mode: "primary" },
          { name: "build", description: "Execute", mode: "primary" },
          { name: "design-parity-review-agent", description: "Plugin review agent", mode: "all" },
          { name: "figma-implementation-agent", description: "Plugin implementation agent" },
          { name: "plan", description: "Plan mode", mode: "primary" },
        ]);
      }
      if (request.url.includes("/prompt_async")) {
        promptBodies.push(await request.clone().json());
        return new Response(null, { status: 204 });
      }
      if (request.url.includes("/command")) {
        promptBodies.push(await request.clone().json());
        return Response.json({ info: {}, parts: [] });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    try {
      const connection = openCodeConversationEngineAdapter.connect({
        baseUrl: "http://opencode.test",
      });
      expect((await connection.listModes()).map((mode) => mode.id)).toEqual(["build", "plan"]);
      await connection.sendPrompt({
        sessionId: "session-stale-plugin-mode",
        parts: [{ type: "text", text: "Continue" }],
        mode: "design-parity-review-agent",
      });
      await connection.runCommand({
        sessionId: "session-stale-plugin-mode",
        command: "review",
        arguments: "",
        mode: "plan",
      });
      expect(promptBodies).toEqual([
        expect.objectContaining({ agent: "build" }),
        expect.objectContaining({ agent: "plan", command: "review" }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("grounds OpenCode model identity in the selected model for each prompt", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push({
        url: request.url,
        body: await request.clone().json(),
      });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      const connection = openCodeConversationEngineAdapter.connect({
        baseUrl: "http://opencode.test",
      });
      await connection.sendPrompt({
        sessionId: "session-model-switch",
        parts: [{ type: "text", text: "Which model is running?" }],
        model: { providerID: "opencode", modelID: "big-pickle" },
        system: "Existing application instructions.",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/session/session-model-switch/prompt_async");
    expect(requests[0]?.body).toEqual(expect.objectContaining({
      system: "Existing application instructions.\n\n"
        + "Authoritative iPolloWork runtime model selection for this turn: {\"providerID\":\"opencode\",\"modelID\":\"big-pickle\"}. "
        + "When asked which model is running, report this selection exactly. Do not infer or claim a different model identity from earlier messages, training data, or generated self-description.",
    }));
  });

  test("keeps OpenCode application instructions out of the authored user message", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(await request.clone().json());
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      const connection = openCodeConversationEngineAdapter.connect({ baseUrl: "http://opencode.test" });
      await connection.sendPrompt({
        sessionId: "session-internal-context",
        parts: [
          { type: "text", text: "Internal template instructions", synthetic: true },
          { type: "text", text: "测试首条消息" },
        ],
        system: "Internal runtime instructions",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([expect.objectContaining({
      parts: [{ type: "text", text: "测试首条消息" }],
      system: "Internal runtime instructions\n\nInternal template instructions",
    })]);
  });

  test("updates OpenCode permission rules on the active session", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push({
        url: request.url,
        method: request.method,
        body: await request.clone().json() as Record<string, unknown>,
      });
      return Response.json({ id: "session-access", title: "Access", permission: [] });
    }) as typeof fetch;

    try {
      const connection = openCodeConversationEngineAdapter.connect({ baseUrl: "http://opencode.test" });
      expect((await connection.listAccessModes?.({ sessionId: "session-access" }))?.map((mode) => mode.id)).toEqual([
        "default",
        "read-only",
        "ask",
        "full-access",
      ]);
      await connection.setAccessMode?.({ sessionId: "session-access", accessMode: "ask" });
      expect(connection.accessModeState?.({ id: "session-access", title: "Access" })).toEqual({
        id: "ask",
        mutable: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/session/session-access");
    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.body.permission).toEqual(expect.arrayContaining([
      { permission: "edit", pattern: "*", action: "ask" },
      { permission: "bash", pattern: "*", action: "ask" },
    ]));
  });

  test("passes the selected Codex access mode into the next turn", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ ok: true, sessionId: "codex-access" });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(CODEX_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_codex",
        token: "token",
      });
      await connection.setAccessMode?.({ sessionId: "codex-access", accessMode: "full-access" });
      await connection.sendPrompt({
        sessionId: "codex-access",
        parts: [{ type: "text", text: "Run it" }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ accessMode: "full-access" }),
      }),
    ]);
  });

  test("lists and sends native Codex collaboration modes for prompts and commands", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (body.method === "collaborationMode/list") {
        return Response.json({ value: { data: [
          { name: "Plan", mode: "plan", model: null, reasoning_effort: "medium" },
          { name: "Default", mode: "default", model: null, reasoning_effort: null },
        ] } });
      }
      return Response.json({ ok: true, sessionId: "codex-mode" });
    }) as typeof fetch;

    try {
      const connection = conversationEngineAdapters.get(CODEX_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_codex",
        token: "token",
      });
      expect((await connection.listModes()).map((mode) => mode.id)).toEqual(["default", "plan"]);
      expect(connection.modeState?.({ id: "codex-mode", title: "Mode" })).toEqual({
        id: "default",
        mutable: true,
      });
      await connection.sendPrompt({
        sessionId: "codex-mode",
        parts: [{ type: "text", text: "Plan this" }],
        model: { providerID: "openai", modelID: "gpt-5.6" },
        mode: "plan",
      });
      await connection.runCommand({
        sessionId: "codex-mode",
        command: "review",
        arguments: "",
        model: { providerID: "openai", modelID: "gpt-5.6" },
        mode: "plan",
      });
      expect(connection.modeState?.({ id: "codex-mode", title: "Mode" })).toEqual({
        id: "plan",
        mutable: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests[0]).toEqual({ method: "collaborationMode/list", payload: {} });
    expect(requests[1]).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ mode: "plan" }),
    }));
    expect(requests[2]).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ mode: "plan" }),
      plugins: { command: { name: "review" } },
    }));
  });

  test("interrupts Codex with the prompt turn id and recovers it from the thread after reconnect", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Record<string, unknown>[] = [];
    const interruptedTurns = new Set<string>();
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (request.url.endsWith("/prompt")) {
        return Response.json({ ok: true, sessionId: "codex-live", turnId: "turn-from-start" });
      }
      if (body.method === "turn/interrupt") {
        const payload = body.payload as { turnId?: string };
        if (payload.turnId) interruptedTurns.add(payload.turnId);
      }
      if (body.method === "thread/read") {
        const payload = body.payload as { threadId?: string };
        const turnId = payload.threadId === "codex-live" ? "turn-from-start" : "turn-recovered";
        return Response.json({ value: {
          thread: {
            id: payload.threadId,
            turns: [
              { id: "turn-complete", status: "completed" },
              { id: turnId, status: interruptedTurns.has(turnId) ? "interrupted" : "inProgress" },
            ],
          },
        } });
      }
      return Response.json({ value: {} });
    }) as typeof fetch;

    try {
      const adapter = conversationEngineAdapters.get(CODEX_HARNESS_ENGINE_ID);
      const liveConnection = adapter.connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_codex",
      });
      await liveConnection.sendPrompt({
        sessionId: "codex-live",
        parts: [{ type: "text", text: "Run" }],
      });
      expect(await liveConnection.abort("codex-live")).toBe(true);

      const reconnectedConnection = adapter.connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_codex",
      });
      expect(await reconnectedConnection.abort("codex-reconnected")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toContainEqual({ method: "turn/interrupt", payload: { threadId: "codex-live", turnId: "turn-from-start" } });
    expect(requests).toContainEqual({ method: "thread/read", payload: { threadId: "codex-live", includeTurns: true } });
    expect(requests).toContainEqual({ method: "turn/interrupt", payload: { threadId: "codex-reconnected", turnId: "turn-recovered" } });
    expect(requests.filter((request) => request.method === "thread/read").length).toBeGreaterThanOrEqual(3);
  });

  test("routes OpenCode and DeepSeek Harness stop requests through their native engines", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: request.url, body });
      if (request.url.includes("/session/opencode-active/abort")) return Response.json(true);
      if (request.url.includes("/session/status")) {
        return Response.json({ "opencode-active": { type: "idle" } });
      }
      if ((body as { method?: string } | null)?.method === "session.list") {
        return Response.json({ value: { items: [{ sessionId: "dsh-active", running: false }] } });
      }
      return Response.json({ value: {} });
    }) as typeof fetch;

    try {
      const openCode = conversationEngineAdapters.get(DEFAULT_ENGINE_ID).connect({
        baseUrl: "http://opencode.test",
      });
      expect(await openCode.abort("opencode-active", "C:\\workspace\\project")).toBe(true);

      const deepSeek = conversationEngineAdapters.get(DEEPSEEK_HARNESS_ENGINE_ID).connect({
        baseUrl: "http://unused.test",
        serverBaseUrl: "http://ipollowork.test",
        workspaceId: "ws_dsh",
      });
      expect(await deepSeek.abort("dsh-active")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests[0]?.url).toContain("/session/opencode-active/abort");
    expect(requests[0]?.url).toContain("directory=C%3A%5Cworkspace%5Cproject");
    expect(requests).toContainEqual(expect.objectContaining({
      url: expect.stringContaining("/engine/deepseek-harness/rpc"),
      body: { method: "session.cancel", payload: { sessionId: "dsh-active" } },
    }));
    expect(requests).toContainEqual(expect.objectContaining({
      body: { method: "session.list", payload: {} },
    }));
  });

  test("maps Codex app-server turns, streaming output, and approvals into the shared protocol", () => {
    const state = createCodexLiveState();
    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "codex-thread",
        tokenUsage: {
          last: {
            inputTokens: 81_000,
            cachedInputTokens: 72_000,
            outputTokens: 1_200,
          },
          modelContextWindow: 100_000,
        },
      },
    }, state)).toEqual([{
      type: "context.updated",
      sessionId: "codex-thread",
      usage: {
        usedTokens: 81_000,
        inputTokens: 81_000,
        outputTokens: 1_200,
        cacheReadTokens: 72_000,
        contextWindow: 100_000,
      },
    }]);
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
      message: expect.objectContaining({
        id: "answer-1",
        role: "assistant",
        metadata: expect.objectContaining({
          ipollowork: expect.objectContaining({ parentUserMessageId: "ipollowork-user-1" }),
        }),
      }),
    })]);

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "item/agentMessage/delta",
      params: { threadId: "codex-thread", turnId: "turn-1", itemId: "answer-1", delta: "完成" },
    }, state)).toEqual([expect.objectContaining({
      type: "message.chunk",
      messageId: "answer-1",
      parentUserMessageId: "ipollowork-user-1",
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

  test("associates a Codex runtime error with its active user turn", () => {
    const state = createCodexLiveState();
    mapCodexHarnessEvent({
      type: "notification",
      method: "turn/started",
      params: { threadId: "codex-thread", turn: { id: "turn-error" } },
    }, state);
    mapCodexHarnessEvent({
      type: "notification",
      method: "item/started",
      params: {
        threadId: "codex-thread",
        turnId: "turn-error",
        item: { type: "userMessage", id: "codex-user-error", text: "continue" },
      },
    }, state);

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "error",
      params: { threadId: "codex-thread", error: { message: "provider failed" } },
    }, state)).toEqual([{
      type: "session.error",
      sessionId: "codex-thread",
      errorText: "provider failed",
      parentUserMessageId: "codex-user-error",
    }]);
  });

  test("maps Codex live user image content into visible file parts", () => {
    const state = createCodexLiveState();
    const events = mapCodexHarnessEvent({
      type: "notification",
      method: "item/started",
      params: {
        threadId: "codex-thread",
        turnId: "turn-with-image",
        startedAtMs: 9,
        item: {
          type: "userMessage",
          id: "codex-user-image",
          clientId: "ipollowork-user-image",
          content: [
            { type: "text", text: "看这张图" },
            {
              type: "image",
              url: "data:image/png;base64,abc123",
              filename: "shot.png",
            },
          ],
        },
      },
    }, state);

    expect(events).toEqual([expect.objectContaining({
      type: "message.upsert",
      message: expect.objectContaining({
        id: "ipollowork-user-image",
        role: "user",
        parts: [
          expect.objectContaining({ type: "text", text: "看这张图", state: "done" }),
          expect.objectContaining({
            type: "file",
            url: "data:image/png;base64,abc123",
            mediaType: "image/png",
            filename: "shot.png",
          }),
        ],
      }),
    })]);
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

  test("does not let an interrupted Codex turn settle a newer turn", () => {
    const state = createCodexLiveState();
    mapCodexHarnessEvent({
      type: "notification",
      method: "turn/started",
      params: { threadId: "codex-thread", turn: { id: "turn-interrupted" } },
    }, state);
    mapCodexHarnessEvent({
      type: "notification",
      method: "turn/started",
      params: { threadId: "codex-thread", turn: { id: "turn-new" } },
    }, state);

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "item/completed",
      params: {
        threadId: "codex-thread",
        turnId: "turn-interrupted",
        item: { type: "agentMessage", id: "late-old-answer", text: "late answer" },
      },
    }, state)).toEqual([]);
    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "item/agentMessage/delta",
      params: {
        threadId: "codex-thread",
        turnId: "turn-interrupted",
        itemId: "late-old-answer",
        delta: "late chunk",
      },
    }, state)).toEqual([]);

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "turn/completed",
      params: { threadId: "codex-thread", turn: { id: "turn-interrupted", status: "interrupted" } },
    }, state)).not.toContainEqual({ type: "session.idle", sessionId: "codex-thread" });

    expect(mapCodexHarnessEvent({
      type: "notification",
      method: "turn/completed",
      params: { threadId: "codex-thread", turn: { id: "turn-new", status: "interrupted" } },
    }, state)).toContainEqual({ type: "session.idle", sessionId: "codex-thread" });
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
        mode: "default",
        accessMode: "auto",
      },
    }]);
    expect(promptResult).toEqual({ sessionId: "codex-thread-rebound" });
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

  test("carries the OpenCode parent user message through live parts and chunks", () => {
    const state = createOpenCodeConversationLiveState();
    mapOpenCodeConversationEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "user-stopped",
          sessionID: "ses",
          role: "user",
        },
      },
    }, state);
    const message = mapOpenCodeConversationEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-old",
          sessionID: "ses",
          role: "assistant",
          parentID: "user-stopped",
        },
      },
    }, state);
    const parts = mapOpenCodeConversationEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-old",
          sessionID: "ses",
          messageID: "assistant-old",
          type: "text",
          text: "late",
        },
      },
    }, state);
    const chunk = mapOpenCodeConversationEvent({
      type: "message.part.delta",
      properties: {
        sessionID: "ses",
        messageID: "assistant-old",
        partID: "part-old",
        delta: " answer",
      },
    }, state);
    const error = mapOpenCodeConversationEvent({
      type: "session.error",
      properties: { sessionID: "ses", error: "provider failed" },
    }, state);

    expect(message).toMatchObject({
      type: "message.upsert",
      message: { metadata: { ipollowork: { parentUserMessageId: "user-stopped" } } },
    });
    expect(parts).toMatchObject({
      type: "message.parts",
      messageRole: "assistant",
      parentUserMessageId: "user-stopped",
    });
    expect(chunk).toMatchObject({
      type: "message.chunk",
      parentUserMessageId: "user-stopped",
    });
    expect(error).toMatchObject({
      type: "session.error",
      parentUserMessageId: "user-stopped",
    });
  });

  test("maps snapshots directly into AI SDK UI messages", () => {
    const snapshot = mapOpenCodeConversationSnapshot({
      session: { id: "ses", title: "Title", time: { created: 1, updated: 2 } },
      messages: [{
        info: {
          id: "msg",
          role: "assistant",
          sessionID: "ses",
          parentID: "user-msg",
          time: { created: 1 },
          tokens: { input: 5_000, output: 400, reasoning: 0, cache: { read: 1_000, write: 0 } },
        },
        parts: [{ id: "part", type: "text", text: "Hello", sessionID: "ses", messageID: "msg" }],
      }],
      todos: [{ content: "Ship", status: "pending", priority: "high" }],
      status: { type: "idle" },
    });

    expect(snapshot.messages).toEqual([expect.objectContaining({
      id: "msg",
      role: "assistant",
      metadata: expect.objectContaining({
        ipollowork: expect.objectContaining({ parentUserMessageId: "user-msg" }),
      }),
      parts: [expect.objectContaining({ type: "text", text: "Hello" })],
    })]);
    expect(snapshot.todos).toEqual([expect.objectContaining({ content: "Ship" })]);
    expect(snapshot.contextUsage).toEqual({
      usedTokens: 6_000,
      inputTokens: 5_000,
      outputTokens: 400,
      cacheReadTokens: 1_000,
    });
  });

  test("maps DeepSeek Harness history into the same conversation protocol", () => {
    const snapshot = mapDeepSeekHarnessSnapshot({
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      session: {
        id: "dsh-session",
        title: "<system> Long-running local process rule",
        tokens: { input: 7_000, output: 120, reasoning: 0, cache: { read: 2_000, write: 0 } },
        dsh: { running: false },
      },
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
                  { type: "text", text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}Internal runtime instructions\n</system>` },
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
        metadata: expect.objectContaining({
          ipollowork: expect.objectContaining({
            completed: 40,
            parentUserMessageId: "user-1",
          }),
        }),
        parts: [expect.objectContaining({ text: "Done", state: "done" })],
      }),
    ]);
    expect(snapshot.todos).toEqual([expect.objectContaining({ content: "Verify", status: "in_progress" })]);
    expect(snapshot.contextUsage).toEqual({
      usedTokens: 9_000,
      inputTokens: 7_000,
      outputTokens: 120,
      cacheReadTokens: 2_000,
    });
  });

  test("surfaces a DeepSeek Harness snapshot failure as an assistant reply", () => {
    const snapshot = mapDeepSeekHarnessSnapshot({
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      session: { id: "dsh-expired", title: "Scheduled task", dsh: { running: false } },
      history: {
        hasMore: false,
        events: [
          {
            event: {
              type: "user/message",
              seq: 1,
              time: 10,
              data: {
                id: "user-expired",
                role: "user",
                source: { kind: "user" },
                content: [{ type: "text", text: "Create the report" }],
              },
            },
          },
          {
            event: {
              type: "turn/end",
              seq: 2,
              time: 20,
              data: {
                turn: 1,
                reason: {
                  kind: "error",
                  error: { message: "Provided authentication token is expired." },
                },
              },
            },
          },
        ],
      },
    });

    expect(snapshot.messages).toEqual([
      expect.objectContaining({ id: "user-expired", role: "user" }),
      expect.objectContaining({
        role: "assistant",
        parts: [expect.objectContaining({
          type: "text",
          text: expect.stringContaining("sign-in"),
        })],
      }),
    ]);
  });

  test("maps DeepSeek Harness approvals without offering unsupported persistent grants", () => {
    expect(mapDeepSeekHarnessEnvelope({
      type: "server-notification",
      rpcId: "rpc-usage",
      payload: {
        type: "session/projection",
        sessionId: "dsh-session",
        key: "tokenUsage",
        value: {
          uncachedInputTokens: 10_000,
          cacheReadTokens: 70_000,
          outputTokens: 900,
        },
      },
    }, { parts: new Set(), tools: new Map() })).toEqual([{
      type: "context.updated",
      sessionId: "dsh-session",
      usage: {
        usedTokens: 80_000,
        inputTokens: 10_000,
        outputTokens: 900,
        cacheReadTokens: 70_000,
      },
    }]);

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

    const expired = normalizeDeepSeekHarnessErrorText("Provided authentication token is expired.");
    expect(expired.toLowerCase()).toContain("sign in");
    expect(expired).not.toContain("Provided authentication token");
  });

  test("associates a DeepSeek Harness runtime error with its active user turn", () => {
    const state = { parts: new Set<string>(), tools: new Map() };
    mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-turn",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: { type: "turn/start", seq: 1, time: 1, data: { turn: 4 } },
      },
    }, state);
    mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-user",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "user/message",
          seq: 2,
          time: 2,
          data: {
            id: "dsh-user-4",
            role: "user",
            source: { kind: "user" },
            content: [{ type: "text", text: "continue" }],
          },
        },
      },
    }, state);

    expect(mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-error",
      payload: { type: "host/agent-error", sessionId: "dsh-session", message: "failed" },
    }, state)).toEqual([expect.objectContaining({
      type: "session.error",
      sessionId: "dsh-session",
      parentUserMessageId: "dsh-user-4",
    })]);
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

  test("refreshes the DSH model directory and retries the concrete route after cold start", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ method: string; payload: Record<string, unknown> }> = [];
    let modelDirectoryCalls = 0;
    let modelSelectionCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        method?: string;
        payload?: Record<string, unknown>;
      };
      if (String(input).endsWith("/prompt")) {
        requests.push({ method: "session.prompt", payload: body.payload ?? {} });
        return Response.json({ ok: true });
      }
      const method = body.method ?? "";
      requests.push({ method, payload: body.payload ?? {} });
      if (method === "llm.models") {
        modelDirectoryCalls += 1;
        if (modelDirectoryCalls === 1) {
          return Response.json({ message: "runtime is starting" }, { status: 503 });
        }
        return Response.json({ value: {
          groups: [{ id: "openai-codex", models: [{ id: "gpt-5.5" }] }],
        } });
      }
      if (method === "session.selectModel") {
        modelSelectionCalls += 1;
        if (modelSelectionCalls === 1) {
          return Response.json({ message: "provider route is not ready" }, { status: 400 });
        }
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
        sessionId: "session-cold-start",
        parts: [{ type: "text", text: "Use GPT-5.5" }],
        model: { providerID: "openai", modelID: "gpt-5.5" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests.map((request) => request.method)).toEqual([
      "llm.models",
      "session.selectModel",
      "llm.models",
      "session.selectModel",
      "session.prompt",
    ]);
    expect(requests[1]?.payload).toMatchObject({ provider: "openai", model: "gpt-5.5" });
    expect(requests[3]?.payload).toMatchObject({ provider: "openai-codex", model: "gpt-5.5" });
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
      {
        type: "text",
        text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}Internal runtime instructions\n</system>`,
      },
      {
        type: "text",
        text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}Apply the private template checklist\n</system>`,
      },
      { type: "text", text: "Build it" },
    ]);
  });

  test("reads and switches the native DeepSeek Harness permission preset", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ method?: string; payload?: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; payload?: Record<string, unknown> };
      requests.push(body);
      if (body.method === "agentPreset.list") {
        return Response.json({ value: {
          presets: [
            { id: "standard", isDefault: true, name: "标准模式" },
            { id: "code", isDefault: false, name: "PTC 模式" },
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
      expect(connection.accessModeState?.({ id: "dsh-new", title: "New conversation" })).toEqual({
        id: "workspace-write",
        mutable: true,
      });
      expect((await connection.listAccessModes?.({ sessionId: "" }))?.map((mode) => mode.id)).toEqual([
        "read-only",
        "workspace-write",
        "danger-full-access",
      ]);
      const snapshot = connection.mapSnapshot({
        engineId: "deepseek-harness",
        session: { id: "dsh-access", title: "Access", dsh: { running: false, blank: true, agentPreset: "standard" } },
        history: {
          events: [],
          hasMore: false,
          projections: {
            asOfSeq: 1,
            values: {
              permissions: {
                currentValue: "workspace-write",
                options: [
                  { value: "read-only", name: "read-only" },
                  { value: "workspace-write", name: "workspace-write" },
                  { value: "danger-full-access", name: "danger-full-access" },
                ],
              },
            },
          },
        },
      });
      expect(connection.accessModeState?.(snapshot.session)).toEqual({ id: "workspace-write", mutable: true });
      expect((await connection.listAccessModes?.({ sessionId: "dsh-access" }))?.map((mode) => mode.id)).toEqual([
        "read-only",
        "workspace-write",
        "danger-full-access",
      ]);
      await connection.setAccessMode?.({ sessionId: "dsh-access", accessMode: "read-only" });
      expect(connection.accessModeState?.(snapshot.session)).toEqual({ id: "read-only", mutable: true });
      expect(requests).toEqual([]);
      await connection.sendPrompt({
        sessionId: "dsh-access",
        parts: [{ type: "text", text: "Start the task" }],
        mode: "code",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      { method: "agentPreset.list", payload: {} },
      { method: "agentPreset.select", payload: { sessionId: "dsh-access", agentPreset: "code" } },
      {
        method: "commands/execute",
        payload: {
          args: {
            agentId: "dsh-access",
            line: "/permission read-only",
          },
        },
      },
      {
        payload: {
          sessionId: "dsh-access",
          mode: "queue",
          content: [{ type: "text", text: "Start the task" }],
          clientTimeZone: expect.any(String),
        },
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

  test("preserves DeepSeek Harness image blocks as renderable file parts", () => {
    const events = mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-user-image",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "user/message",
          seq: 4,
          time: 40,
          data: {
            id: "user-image",
            role: "user",
            source: { kind: "user" },
            content: [
              { type: "text", text: "What is in this image?" },
              {
                type: "image",
                mediaType: "image/png",
                data: "aW1hZ2UtYnl0ZXM=",
                name: "reference.png",
              },
            ],
          },
        },
      },
    }, { parts: new Set(), tools: new Map() });

    expect(events).toEqual([expect.objectContaining({
      type: "message.upsert",
      message: expect.objectContaining({
        id: "user-image",
        role: "user",
        parts: [
          expect.objectContaining({ type: "text", text: "What is in this image?" }),
          expect.objectContaining({
            type: "file",
            mediaType: "image/png",
            filename: "reference.png",
            url: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
          }),
        ],
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
    mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-turn",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: { type: "turn/start", seq: 5, time: 8, data: { turn: 1 } },
      },
    }, state);
    mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-user",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "user/message",
          seq: 6,
          time: 9,
          data: {
            id: "ipollowork-user-1",
            role: "user",
            source: { kind: "user" },
            content: [{ type: "text", text: "123" }],
          },
        },
      },
    }, state);
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
        parentUserMessageId: "ipollowork-user-1",
        parts: [expect.objectContaining({ type: "text", text: "", state: "streaming" })],
      }),
      expect.objectContaining({
        type: "message.chunk",
        parentUserMessageId: "ipollowork-user-1",
        chunk: expect.objectContaining({ delta: "你" }),
      }),
    ]);
    expect(nextChunk).toEqual([
      { type: "session.status", sessionId: "dsh-session", status: { type: "busy" } },
      expect.objectContaining({
        type: "message.chunk",
        parentUserMessageId: "ipollowork-user-1",
        chunk: expect.objectContaining({ delta: "好" }),
      }),
    ]);
  });

  test("uses the ordered DeepSeek Harness turn boundary instead of the racing host status", () => {
    const state = { parts: new Set<string>(), tools: new Map() };

    expect(mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-host-idle",
      payload: { type: "host/session-status", sessionId: "dsh-session", running: false },
    }, state)).toEqual([]);

    expect(mapDeepSeekHarnessEnvelope({
      type: "server-request",
      rpcId: "rpc-turn-start",
      payload: {
        type: "session/event",
        sessionId: "dsh-session",
        event: {
          type: "turn/start",
          seq: 9,
          time: 10,
          data: { turn: 2 },
        },
      },
    }, state)).toEqual([
      {
        type: "session.updated",
        sessionId: "dsh-session",
        info: {
          id: "dsh-session",
          time: { updated: 10 },
          dsh: { blank: false, running: true },
        },
      },
      { type: "session.status", sessionId: "dsh-session", status: { type: "busy" } },
    ]);

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
      {
        type: "session.updated",
        sessionId: "dsh-session",
        info: {
          id: "dsh-session",
          time: { updated: 30 },
          dsh: { blank: false, running: false },
        },
      },
      { type: "session.status", sessionId: "dsh-session", status: { type: "idle" } },
      { type: "session.idle", sessionId: "dsh-session" },
    ]);
  });

  test("drops late DeepSeek Harness events from an interrupted turn after a new turn starts", () => {
    const state = { parts: new Set<string>(), tools: new Map() };
    const envelope = (rpcId: string, event: Record<string, unknown>) => ({
      type: "server-request" as const,
      rpcId,
      payload: { type: "session/event", sessionId: "dsh-session", event },
    });

    mapDeepSeekHarnessEnvelope(envelope("old-start", {
      type: "turn/start",
      seq: 1,
      time: 10,
      data: { turn: 1 },
    }), state);
    mapDeepSeekHarnessEnvelope(envelope("new-start", {
      type: "turn/start",
      seq: 2,
      time: 20,
      data: { turn: 2 },
    }), state);

    expect(mapDeepSeekHarnessEnvelope(envelope("old-chunk", {
      type: "assistant/chunk",
      seq: 3,
      time: 30,
      data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "late" } },
    }), state)).toEqual([]);
    expect(mapDeepSeekHarnessEnvelope(envelope("old-end", {
      type: "turn/end",
      seq: 4,
      time: 40,
      data: { turn: 1, reason: { kind: "cancelled" } },
    }), state)).toEqual([]);
    expect(mapDeepSeekHarnessEnvelope(envelope("new-chunk", {
      type: "assistant/chunk",
      seq: 5,
      time: 50,
      data: { turn: 2, step: 1, chunk: { type: "text-delta", index: 0, text: "new" } },
    }), state)).toContainEqual(expect.objectContaining({
      type: "message.chunk",
      chunk: expect.objectContaining({ delta: "new" }),
    }));
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
