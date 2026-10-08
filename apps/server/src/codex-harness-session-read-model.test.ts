import { describe, expect, test } from "bun:test";

import {
  mapCodexMessages,
  mapCodexThread,
  listCodexHarnessSessions,
  readCodexHarnessThread,
  readCodexHarnessSnapshot,
  type CodexThread,
} from "./codex-harness-session-read-model.js";
import { isCodexUnmaterializedThreadError, type CodexHarnessRuntime } from "./codex-harness-runtime.js";
import { StdioJsonRpcError } from "./stdio-json-rpc-runtime.js";
import type { WorkspaceInfo } from "./types.js";

describe("Codex Harness session read model", () => {
  test("projects a native cumulative total without fabricating a token breakdown", async () => {
    const thread: CodexThread = { id: "metered", totalTokens: 1000, status: { type: "idle" }, turns: [] };
    const session = mapCodexThread(thread);
    expect(session.totalTokens).toBe(1000);
    expect("tokens" in session).toBe(false);
    expect(mapCodexThread({ id: "unmetered" }).totalTokens).toBeUndefined();
    const runtime = { isAwaitingFirstTurn: () => false, call: async () => ({ thread }) } as unknown as CodexHarnessRuntime;
    expect((await readCodexHarnessSnapshot(runtime, thread.id)).session.totalTokens).toBe(1000);
  });

  test("shows only the latest turn's native plan and preserves engine statuses", async () => {
    const thread: CodexThread = { id: "planned", status: { type: "active" }, nativePlan: { turnId: "native-turn", plan: [
      { step: "Produce source", status: "completed" }, { step: "Review output", status: "inProgress" },
    ] }, turns: [{ id: "native-turn", status: "inProgress", items: [] }] };
    const runtime = { isAwaitingFirstTurn: () => false, call: async () => ({ thread }) } as unknown as CodexHarnessRuntime;
    expect((await readCodexHarnessSnapshot(runtime, "planned")).todos).toMatchObject([
      { content: "Produce source", status: "completed" }, { content: "Review output", status: "in_progress" },
    ]);
    thread.turns = [{ id: "new-turn", status: "inProgress", items: [] }];
    expect((await readCodexHarnessSnapshot(runtime, "planned")).todos).toEqual([]);
  });

  test("does not complete or fail assistant output before the native turn has an end time", () => {
    for (const status of ["inProgress", "completed", "failed", "interrupted"]) {
      const thread: CodexThread = { id: "thread", status: { type: "idle" }, turns: [{ id: "turn", status, startedAt: 10, completedAt: null, items: [
        { type: "agentMessage", id: "note", phase: "commentary", text: "Working on the assigned file." },
      ] }] };
      expect(mapCodexThread(thread).status).toEqual({ type: "busy" });
      expect(mapCodexMessages(thread)[0]?.info.time.completed).toBeUndefined();
      expect(mapCodexMessages(thread)[0]?.info.error).toBeUndefined();
    }
    const settled: CodexThread = { id: "thread", status: { type: "idle" }, turns: [{ id: "turn", status: "completed", startedAt: 10, completedAt: 20, items: [
      { type: "agentMessage", id: "answer", phase: "final_answer", text: "Saved." },
    ] }] };
    expect(mapCodexThread(settled).status).toEqual({ type: "idle" });
    expect(mapCodexMessages(settled)[0]?.info.time.completed).toBe(20_000);
  });

  test("keeps assistant snapshot part identities consistent with live text and reasoning", () => {
    const messages = mapCodexMessages({ id: "thread", turns: [{ id: "turn", status: "completed", items: [
      { type: "agentMessage", id: "commentary", phase: "commentary", text: "检查手机布局。" },
      { type: "reasoning", id: "reasoning", summary: ["检查实际结果。"] },
      { type: "agentMessage", id: "answer", phase: "final_answer", text: "已完成。" },
    ] }] });
    expect(messages.flatMap((message) => message.parts).map((part) => part.id)).toEqual([
      "commentary:text", "reasoning:reasoning", "answer:text",
    ]);
    expect(messages.map((message) => message.parts)).toEqual([
      [expect.objectContaining({ type: "text", text: "检查手机布局。" })],
      [expect.objectContaining({ type: "reasoning", text: "检查实际结果。" })],
      [expect.objectContaining({ type: "text", text: "已完成。" })],
    ]);
  });

  test("uses authoritative native child path when its name and preview are empty", () => {
    const child = { id: "child", parentThreadId: "root", name: "", preview: "", agentNickname: "Descartes",
      source: { subAgent: { thread_spawn: { parent_thread_id: "root", depth: 1, agent_path: "/root/implementation_advice" } } },
    };
    expect(mapCodexThread(child)).toMatchObject({ title: "/root/implementation_advice", parentID: "root", engineId: "codex-harness" });
    expect(mapCodexThread({ ...child, name: "User title" }).title).toBe("User title");
    expect(mapCodexThread({ ...child, preview: "Native preview" }).title).toBe("Native preview");
    expect(mapCodexThread({ ...child, source: "subAgent" }).title).toBe("Descartes");
    expect(mapCodexThread({ id: "root", name: "", preview: "", source: "vscode" }).title).toBe("New conversation");
  });

  test("maps current native sub-agent activity without inventing role attribution or task results", () => {
    const messages = mapCodexMessages({ id: "root", turns: [{ id: "turn", status: "inProgress", items: [
      { type: "subAgentActivity", id: "spawn-call", kind: "started", agentThreadId: "child", agentPath: "/root/implementation_advice" },
      { type: "subAgentActivity", id: "interact", kind: "interacted", agentThreadId: "child", agentPath: "/root/implementation_advice" },
      { type: "subAgentActivity", id: "completed-event", kind: "completed", agentThreadId: "child", agentPath: "/root/implementation_advice" },
      { type: "subAgentActivity", id: "interrupted-event", kind: "interrupted", agentThreadId: "other-child", agentPath: "/root/review" },
    ] }] });
    expect(messages.flatMap((message) => message.parts).flatMap((part) => "state" in part ? [part.state] : [])).toEqual([
      expect.objectContaining({ status: "running", input: { description: "/root/implementation_advice", task_id: "child" }, metadata: { sessionId: "child", parentSessionId: "root", nativeTool: "subAgentActivity", nativeKind: "started", delegationStatus: "running" } }),
      expect.objectContaining({ metadata: expect.objectContaining({ nativeKind: "interacted", delegationStatus: "running" }) }),
      expect.objectContaining({ status: "completed", output: '<task id="child" state="completed"></task>', metadata: expect.objectContaining({ delegationStatus: "completed" }) }),
      expect.objectContaining({ status: "error", metadata: expect.objectContaining({ delegationStatus: "failed" }) }),
    ]);
  });

  test("discovers real nested native descendants through ancestor listing and checks every cwd and parent", async () => {
    const workspace = { id: "workspace", path: "/work/project", engineId: "codex-harness" } as WorkspaceInfo;
    const calls: Record<string, unknown>[] = [];
    const root = { id: "root", cwd: workspace.path, updatedAt: 1 };
    const runtime = { call: async (_method: string, params: Record<string, unknown>) => {
      calls.push(params);
      expect(params.modelProviders).toEqual([]);
      if (!params.ancestorThreadId) return { data: params.archived ? [] : [root], nextCursor: null };
      expect(params.sourceKinds).toEqual(["subAgent", "subAgentThreadSpawn"]);
      if (params.archived) return { data: [{ id: "archived-child", cwd: workspace.path, parentThreadId: "root", updatedAt: 2 }], nextCursor: null };
      return params.cursor ? { data: [
        { id: "nested", cwd: workspace.path, parentThreadId: "child", updatedAt: 5 },
        { id: "foreign-nested", cwd: workspace.path, parentThreadId: "foreign-parent", updatedAt: 6 },
        { id: "orphan", cwd: workspace.path, parentThreadId: "not-returned", updatedAt: 6 },
      ], nextCursor: null } : { data: [
        { id: "child", cwd: workspace.path, parentThreadId: "root", updatedAt: 4 },
        { id: "foreign-parent", cwd: "/work/other", parentThreadId: "root", updatedAt: 3 },
        root,
      ], nextCursor: "nested-page" };
    } } as unknown as CodexHarnessRuntime;
    const sessions = await listCodexHarnessSessions(runtime, workspace, { limit: 200 });
    expect(sessions.map((session) => session.id)).toEqual(["nested", "child", "archived-child", "root"]);
    expect(sessions.find((session) => session.id === "nested")?.parentID).toBe("child");
    expect(sessions.find((session) => session.id === "archived-child")?.time.archived).toBeDefined();
    calls.length = 0;
    expect((await listCodexHarnessSessions(runtime, workspace, { roots: true })).map((session) => session.id)).toEqual(["root"]);
    expect(calls.some((call) => call.ancestorThreadId)).toBe(false);
  });

  test("bounds native descendant discovery to two concurrent queries and 32 recent roots", async () => {
    const workspace = { id: "workspace", path: "/work/project", engineId: "codex-harness" } as WorkspaceInfo;
    let active = 0, maximumActive = 0, descendantCalls = 0;
    const roots = Array.from({ length: 40 }, (_, index) => ({ id: `root-${index}`, cwd: workspace.path, updatedAt: index }));
    const runtime = { call: async (_method: string, params: Record<string, unknown>) => {
      if (!params.ancestorThreadId) return { data: params.archived ? [] : roots, nextCursor: null };
      descendantCalls++; active++; maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1)); active--;
      return { data: [], nextCursor: null };
    } } as unknown as CodexHarnessRuntime;
    expect(await listCodexHarnessSessions(runtime, workspace, {})).toHaveLength(40);
    expect(descendantCalls).toBe(64);
    expect(maximumActive).toBe(2);
  });

  test("hydrates native paginated turns and items in chronological order with real outcome errors", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const runtime = {
      isAwaitingFirstTurn: () => false,
      call: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        if (method === "thread/read") return { thread: { id: "paged", historyMode: "paginated", turns: [] } };
        if (method === "thread/turns/list") return params.cursor
          ? { data: [{ id: "old", status: "completed", itemsView: "notLoaded", items: [] }], nextCursor: null }
          : { data: [
            { id: "failed", status: "failed", error: { message: "Actual upstream failure" }, itemsView: "notLoaded", items: [] },
            { id: "done", status: "completed", itemsView: "notLoaded", items: [] },
          ], nextCursor: "older-turns" };
        if (method === "thread/items/list") return params.cursor
          ? { data: [
            { turnId: "done", item: { type: "userMessage", id: "question", text: "Verify this." } },
            { turnId: "old", item: { type: "agentMessage", id: "old-answer", text: "Earlier answer" } },
          ], nextCursor: null }
          : { data: [
            { turnId: "failed", item: { type: "agentMessage", id: "failure-note", phase: "commentary", text: "Request failed." } },
            { turnId: "done", item: { type: "agentMessage", id: "answer", phase: "final_answer", text: "Verified answer" } },
          ], nextCursor: "older-items" };
        throw new Error(`Unexpected method ${method}`);
      },
    } as unknown as CodexHarnessRuntime;
    const thread = await readCodexHarnessThread(runtime, "paged");
    expect(thread.turns?.map((turn) => turn.id)).toEqual(["old", "done", "failed"]);
    expect(thread.turns?.[1]?.items.map((item) => item.id)).toEqual(["question", "answer"]);
    expect(mapCodexMessages(thread).at(-1)?.info.error?.data.message).toBe("Actual upstream failure");
    expect(calls.filter((call) => call.method === "thread/read")).toEqual([{ method: "thread/read", params: { threadId: "paged", includeTurns: false } }]);
    expect(calls.filter((call) => call.method === "thread/turns/list").every((call) => call.params.limit === 50 && call.params.itemsView === "notLoaded")).toBe(true);
  });

  test("reopens an unstarted native paginated thread after runtime restart and preserves other history failures", async () => {
    const unmaterialized = new StdioJsonRpcError("invalid paginated history lineage for blank: missing source rollout", { code: -32600 });
    const runtime = (failure: Error) => ({
      isAwaitingFirstTurn: () => false,
      call: async (method: string) => {
        if (method === "thread/read") return { thread: { id: "blank", historyMode: "paginated", name: "Research", turns: [] } };
        throw failure;
      },
    } as unknown as CodexHarnessRuntime);
    expect(isCodexUnmaterializedThreadError(unmaterialized)).toBe(true);
    expect(isCodexUnmaterializedThreadError(new Error(unmaterialized.message))).toBe(false);
    expect(await readCodexHarnessSnapshot(runtime(unmaterialized), "blank")).toMatchObject({
      session: { id: "blank", title: "Research" }, messages: [], status: { type: "idle" },
    });
    const unexpected = new StdioJsonRpcError("invalid paginated history lineage for blank: invalid source checksum", { code: -32600 });
    expect(isCodexUnmaterializedThreadError(unexpected)).toBe(false);
    await expect(readCodexHarnessSnapshot(runtime(unexpected), "blank")).rejects.toThrow("invalid source checksum");
  });

  test("bounds native paging and never reports incomplete item hydration as a no-output failure", async () => {
    let turnPages = 0;
    let itemPages = 0;
    const runtime = {
      isAwaitingFirstTurn: () => false,
      call: async (method: string) => {
        if (method === "thread/read") return { thread: { id: "long", historyMode: "paginated", turns: [] } };
        if (method === "thread/turns/list") {
          turnPages++;
          return { data: [{ id: "long-turn", status: "completed", items: [] }], nextCursor: `turn-page-${turnPages}` };
        }
        itemPages++;
        return { data: [{ turnId: "long-turn", item: { type: "commandExecution", id: `tool-${itemPages}`, status: "completed" } }], nextCursor: `item-page-${itemPages}` };
      },
    } as unknown as CodexHarnessRuntime;
    const thread = await readCodexHarnessThread(runtime, "long");
    expect(turnPages).toBe(2);
    expect(itemPages).toBe(10);
    expect(thread.turns?.[0]?.itemsView).toBe("summary");
    expect(mapCodexMessages(thread).every((message) => !message.info.error)).toBe(true);
  });

  test("maps real native collaboration recipients without mistaking call completion for child success", () => {
    const messages = mapCodexMessages({
      id: "root",
      turns: [{
        id: "turn-collab",
        status: "inProgress",
        items: [{
          type: "collabAgentToolCall",
          id: "spawn",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "root",
          receiverThreadIds: ["child-running", "child-pending"],
          prompt: "[project-agent:researcher] Research the launch.",
          agentsStates: {
            "child-running": { status: "running", message: null },
            "child-pending": { status: "pendingInit", message: null },
          },
        }, {
          type: "collabAgentToolCall",
          id: "wait",
          tool: "wait",
          status: "completed",
          senderThreadId: "root",
          receiverThreadIds: ["child-running", "child-error"],
          prompt: null,
          agentsStates: {
            "child-running": { status: "completed", message: "Verified the sources." },
            "child-error": { status: "errored", message: "Upstream request failed." },
          },
        }, {
          type: "collabAgentToolCall", id: "list", tool: "listAgents", status: "completed",
          senderThreadId: "root", receiverThreadIds: [], agentsStates: {},
        }],
      }],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.parts).toEqual([
      expect.objectContaining({
        tool: "task", callID: "spawn:child-running",
        state: expect.objectContaining({
          status: "completed",
          metadata: { sessionId: "child-running", nativeTool: "spawnAgent", delegationStatus: "running", parentSessionId: "root" },
        }),
      }),
      expect.objectContaining({ state: expect.objectContaining({ metadata: expect.objectContaining({ delegationStatus: "unknown" }) }) }),
    ]);
    expect(messages[1]?.parts).toEqual([
      expect.objectContaining({
        state: expect.objectContaining({
          output: '<task id="child-running" state="completed">Verified the sources.</task>',
          metadata: { sessionId: "child-running", nativeTool: "wait", delegationStatus: "completed" },
        }),
      }),
      expect.objectContaining({ state: expect.objectContaining({ metadata: expect.objectContaining({ delegationStatus: "failed" }) }) }),
    ]);
    expect(mapCodexThread({ id: "child-running", parentThreadId: "root" }).parentID).toBe("root");
  });

  test("identifies native agent threads without hiding user-created branches", () => {
    expect(mapCodexThread({ id: "worker", parentThreadId: "root", source: { subAgent: { thread_spawn: { agent_path: "/root/plan", agent_role: "ipw-video.plan" } } } }).codex)
      .toMatchObject({ subagent: true, agentRole: "ipw-video.plan" });
    expect(mapCodexThread({ id: "branch", parentThreadId: "root", source: "cli" }).codex)
      .not.toHaveProperty("subagent");
  });

  test("preserves native approval and input waiting flags in snapshots", () => {
    for (const flag of ["waitingOnApproval", "waitingOnUserInput"]) {
      const session = mapCodexThread({ id: "waiting", status: { type: "active", activeFlags: [flag] } });
      expect(session.status.type).toBe("busy");
      expect(session.codex).toEqual({ status: "active", activeFlags: [flag] });
    }
    expect(mapCodexThread({ id: "idle", status: { type: "idle" } }).codex.activeFlags).toEqual([]);
  });
  test("preserves Codex message phases when rebuilding the transcript", () => {
    const messages = mapCodexMessages({
      id: "thread-codex",
      turns: [{
        id: "turn-1", status: "completed",
        items: [
          { type: "agentMessage", id: "progress", phase: "commentary", text: "Checking" },
          { type: "agentMessage", id: "answer", phase: "final_answer", text: "Done" },
        ],
      }],
    });
    expect(messages.map((message) => message.info.codexPhase)).toEqual(["commentary", "final_answer"]);
  });
  test("preserves user image content as file parts", () => {
    const messages = mapCodexMessages({
      id: "thread-codex",
      createdAt: 1,
      turns: [{
        id: "turn-1",
        status: "completed",
        startedAt: 10,
        completedAt: 20,
        items: [{
          type: "userMessage",
          id: "native-user-1",
          clientId: "client-user-1",
          content: [
            { type: "text", text: "看这张图" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,abc123" },
            },
          ],
        }, {
          type: "agentMessage",
          id: "assistant-1",
          text: "已看见图片",
        }],
      }],
    } satisfies CodexThread);

    expect(messages).toEqual([
      expect.objectContaining({
        info: expect.objectContaining({ id: "client-user-1", role: "user" }),
        parts: [
          expect.objectContaining({
            id: "client-user-1:0",
            type: "text",
            text: "看这张图",
          }),
          expect.objectContaining({
            id: "client-user-1:1",
            type: "file",
            url: "data:image/png;base64,abc123",
            mediaType: "image/png",
          }),
        ],
      }),
      expect.objectContaining({
        info: expect.objectContaining({
          id: "assistant-1",
          role: "assistant",
          parentID: "client-user-1",
        }),
      }),
    ]);
  });

  test("preserves Codex base64 image source content as file parts", () => {
    const messages = mapCodexMessages({
      id: "thread-codex",
      createdAt: 1,
      turns: [{
        id: "turn-1",
        status: "inProgress",
        startedAt: 10,
        completedAt: 20,
        items: [{
          type: "userMessage",
          id: "native-user-1",
          content: [{
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "abc123",
            },
          }],
        }],
      }],
    } satisfies CodexThread);

    expect(messages).toEqual([expect.objectContaining({
      info: expect.objectContaining({ id: "native-user-1", role: "user" }),
      parts: [expect.objectContaining({
        id: "native-user-1:0",
        type: "file",
        url: "data:image/jpeg;base64,abc123",
        mediaType: "image/jpeg",
      })],
    })]);
  });
});
