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
              projections: { asOfSeq: 1, values: { title: "<system> Long-running local process rule" } },
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
});
