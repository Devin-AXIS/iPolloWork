import { describe, expect, test } from "bun:test";

import {
  mapCodexMessages,
  mapCodexThread,
  type CodexThread,
} from "./codex-harness-session-read-model.js";

describe("Codex Harness session read model", () => {
  test("omits successful manual compaction turns without masking a user turn missing its answer", () => {
    expect(mapCodexMessages({ id: "thread", turns: [{ id: "compact", status: "completed", items: [
      { id: "compact-item", type: "contextCompaction" },
    ] }] })).toEqual([]);
    const userTurn = mapCodexMessages({ id: "thread", turns: [{ id: "user-turn", status: "completed", items: [
      { id: "user", type: "userMessage", text: "Finish the task" },
      { id: "compact-item", type: "contextCompaction" },
    ] }] });
    expect(userTurn).toContainEqual(expect.objectContaining({ info: expect.objectContaining({ role: "assistant", error: expect.any(Object) }) }));
    const failed = mapCodexMessages({ id: "thread", turns: [{ id: "compact", status: "failed", error: { message: "Compaction failed" }, items: [
      { id: "compact-item", type: "contextCompaction" },
    ] }] });
    expect(failed).toContainEqual(expect.objectContaining({ info: expect.objectContaining({ role: "assistant", error: expect.any(Object) }) }));
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
