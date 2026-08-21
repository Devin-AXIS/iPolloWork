import { describe, expect, test } from "bun:test";

import type { DeepSeekHarnessRuntime } from "./deepseek-harness-runtime.js";
import {
  listDeepSeekHarnessSessions,
  mapDeepSeekHarnessMessages,
  readDeepSeekHarnessHistory,
} from "./deepseek-harness-session-read-model.js";
import type { WorkspaceInfo } from "./types.js";

const workspace = {
  id: "ws_dsh",
  name: "Harness",
  path: "/projects/harness",
  preset: "starter",
  workspaceType: "local",
  engineId: "deepseek-harness",
} satisfies WorkspaceInfo;

function runtimeWithSessions(calls: string[]) {
  return {
    async call(method: string) {
      calls.push(method);
      if (method === "session.list") {
        return {
          items: [
            {
              sessionId: "owned",
              updatedAt: 2,
              running: false,
              blank: false,
              cwd: workspace.path,
              agentPreset: "editor",
              projections: {
                asOfSeq: 1,
                values: {
                  title: "<system> Long-running local process rule",
                  tokenUsage: {
                    uncachedInputTokens: 40,
                    outputTokens: 20,
                    cacheReadTokens: 10,
                    cacheWriteTokens: 5,
                  },
                },
              },
            },
            { sessionId: "foreign", updatedAt: 1, running: false, blank: false, cwd: "/projects/other" },
          ],
        };
      }
      if (method === "workspace.list") return { archivedSessionIds: [] };
      if (method === "session.history") return { events: [], hasMore: false };
      throw new Error(`Unexpected method: ${method}`);
    },
  } as unknown as DeepSeekHarnessRuntime;
}

describe("DeepSeek Harness session read model", () => {
  test("keeps session lists scoped to the selected project", async () => {
    const calls: string[] = [];
    const sessions = await listDeepSeekHarnessSessions(runtimeWithSessions(calls), workspace, {});
    expect(sessions.map((session) => session.id)).toEqual(["owned"]);
    expect(sessions[0]?.title).toBe("New conversation");
    expect(sessions[0]?.agent).toBe("editor");
    expect(sessions[0]?.tokens).toEqual({
      input: 40,
      output: 20,
      reasoning: 0,
      cache: { read: 10, write: 5 },
    });
  });

  test("rejects history reads for a session owned by another project", async () => {
    const calls: string[] = [];
    await expect(readDeepSeekHarnessHistory(runtimeWithSessions(calls), workspace, "foreign"))
      .rejects.toThrow("Session not found");
    expect(calls).not.toContain("session.history");
  });

  test("keeps runtime context out of user-visible messages", () => {
    const messages = mapDeepSeekHarnessMessages("owned", {
      hasMore: false,
      events: [
        {
          event: {
            type: "user/message",
            seq: 1,
            time: 1,
            data: {
              id: "user-1",
              role: "user",
              source: { kind: "user" },
              content: [
                { type: "text", text: "<system>\nInternal runtime instructions\n</system>" },
                { type: "text", text: "你好啊" },
              ],
            },
          },
        },
        {
          event: {
            type: "user/message",
            seq: 2,
            time: 2,
            data: {
              id: "skills",
              role: "user",
              source: { kind: "skill-catalog" },
              content: [{ type: "text", text: "Internal skills" }],
            },
          },
        },
      ],
    });

    expect(messages).toEqual([expect.objectContaining({
      info: expect.objectContaining({ id: "user-1", role: "user" }),
      parts: [expect.objectContaining({ text: "你好啊" })],
    })]);
  });

  test("normalizes native subagent runs into engine-neutral task parts", () => {
    const messages = mapDeepSeekHarnessMessages("root", {
      hasMore: false,
      events: [
        {
          event: {
            type: "tool/call",
            seq: 1,
            time: 10,
            data: {
              callId: "call-subagent-1",
              name: "subagent",
              arguments: JSON.stringify({
                description: "阶段一：生成模拟数据集",
                prompt: "你是新媒体分析工作台的数据采集专员。",
              }),
            },
          },
        },
        {
          event: {
            type: "tool/result",
            seq: 2,
            time: 20,
            data: {
              message: {
                source: { kind: "tool", callId: "call-subagent-1" },
                content: [{ type: "tool-result", isError: false }],
              },
            },
          },
        },
      ],
    }, [
      {
        sessionId: "child-data-collector",
        parentSessionId: "root",
        origin: "subagent",
        updatedAt: 20,
        running: false,
        blank: false,
        projections: {
          asOfSeq: 2,
          values: {
            subagent: {
              identity: { mode: "one-shot", label: "阶段一：生成模拟数据集" },
            },
          },
        },
      },
    ]);

    expect(messages).toEqual([{
      info: {
        id: "dsh-subagent:call-subagent-1",
        sessionID: "root",
        role: "assistant",
        time: { created: 10, completed: 20 },
      },
      parts: [{
        id: "dsh-subagent:call-subagent-1:task",
        messageID: "dsh-subagent:call-subagent-1",
        sessionID: "root",
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: {
            description: "阶段一：生成模拟数据集",
            prompt: "你是新媒体分析工作台的数据采集专员。",
          },
          output: '<task id="child-data-collector" state="completed">',
        },
      }],
    }]);
  });

  test("does not invent task records when a subagent call cannot be matched to a child session", () => {
    const messages = mapDeepSeekHarnessMessages("root", {
      hasMore: false,
      events: [{
        event: {
          type: "tool/call",
          seq: 1,
          time: 10,
          data: {
            callId: "call-unmatched",
            name: "subagent",
            arguments: JSON.stringify({ description: "不存在的阶段", prompt: "执行任务" }),
          },
        },
      }],
    }, []);

    expect(messages).toEqual([]);
  });
});
