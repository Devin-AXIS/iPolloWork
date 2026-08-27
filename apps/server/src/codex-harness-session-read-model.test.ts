import { describe, expect, test } from "bun:test";

import {
  mapCodexMessages,
  type CodexThread,
} from "./codex-harness-session-read-model.js";

describe("Codex Harness session read model", () => {
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
        status: "completed",
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
