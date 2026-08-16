import { describe, expect, test } from "bun:test";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  ConversationEngineAdapterRegistry,
  type ConversationEngineAdapter,
} from "../src/react-app/domains/session/engine/conversation-engine";
import {
  openCodeConversationEngineAdapter,
} from "../src/react-app/domains/session/engine/opencode-conversation-engine";
import {
  mapOpenCodeConversationEvent,
  mapOpenCodeConversationSnapshot,
} from "../src/react-app/domains/session/engine/opencode-conversation-mapper";

describe("conversation engine adapters", () => {
  test("keeps OpenCode as the default and rejects unknown engines", () => {
    const registry = new ConversationEngineAdapterRegistry(
      DEFAULT_ENGINE_ID,
      [openCodeConversationEngineAdapter],
    );

    expect(registry.ids()).toEqual([DEFAULT_ENGINE_ID]);
    expect(registry.get()).toBe(openCodeConversationEngineAdapter);
    expect(() => registry.get("deepseek-harness")).toThrow(
      "Conversation engine is not registered: deepseek-harness",
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
});
