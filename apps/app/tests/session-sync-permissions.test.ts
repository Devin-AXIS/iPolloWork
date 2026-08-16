import { afterEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import type { PermissionV2Request, QuestionRequest } from "@opencode-ai/sdk/v2/client";

import { getReactQueryClient } from "../src/react-app/infra/query-client";
import type {
  ConversationEngineConnection,
  ConversationPermission,
  ConversationQuestion,
  ConversationSnapshot,
} from "../src/react-app/domains/session/engine/conversation-engine";
import { mapOpenCodeConversationEvent } from "../src/react-app/domains/session/engine/opencode-conversation-mapper";
import { persistentPermissionPatterns } from "../src/react-app/domains/session/sync/use-session-interactions";
import {
  __applySessionSyncEventForTest,
  __createWorkspaceSessionSyncForTest,
  __disposeWorkspaceSessionSyncForTest,
  __hasWorkspaceSessionSyncForTest,
  coalescePendingDeltas,
  destroyWorkspaceSessionResources,
  ensureWorkspaceSessionSync,
  permissionKey,
  questionKey,
  seedPermissionState,
  seedQuestionState,
  seedSessionState,
  snapshotKey,
  statusKey,
  todoKey,
  trackWorkspaceSessionSync,
  transcriptKey,
} from "../src/react-app/domains/session/sync/session-sync";

function nativeV2Permission(id: string, sessionID: string): PermissionV2Request {
  return {
    id,
    sessionID,
    action: "file.read",
    resources: ["/outside/project/secrets.txt"],
    metadata: { path: "/outside/project/secrets.txt" },
    save: ["/outside/project/*"],
  };
}

function nativeQuestion(id: string, sessionID: string): QuestionRequest {
  return {
    id,
    sessionID,
    questions: [
      {
        header: "Choice",
        question: "Pick one",
        options: [{ label: "Yes", description: "Proceed" }],
      },
    ],
  };
}

function permission(
  id: string,
  sessionId: string,
  overrides: Partial<ConversationPermission> = {},
): ConversationPermission {
  return {
    id,
    sessionId,
    kind: "bash",
    resources: ["echo ok"],
    remember: [],
    metadata: {},
    receivedAt: 1,
    native: null,
    ...overrides,
  };
}

function question(id: string, sessionId: string): ConversationQuestion {
  return {
    id,
    sessionId,
    questions: [{
      header: "Choice",
      question: "Pick one",
      options: [{ label: "Yes", description: "Proceed" }],
    }],
    receivedAt: 1,
    native: null,
  };
}

function uiMessage(id: string, role: "user" | "assistant", text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text, state: "done" }],
  };
}

function snapshotWithMessages(
  messages: Array<{ id: string; role: "user" | "assistant"; text: string }>,
  sessionId = "session-a",
): ConversationSnapshot {
  return {
    session: {
      id: sessionId,
      title: "Test session",
      time: { created: 1, updated: 2 },
    },
    messages: messages.map((message) => uiMessage(message.id, message.role, message.text)),
    todos: [],
    status: { type: "idle" },
  };
}

const syncInput = { workspaceId: "workspace-a", connectionKey: "test" };
const testConnection = {
  subscribe: ({ signal }: { signal: AbortSignal }) => new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  }),
} as ConversationEngineConnection;

function applyOpenCodeEvent(input: typeof syncInput, event: unknown) {
  const mapped = mapOpenCodeConversationEvent(event);
  if (mapped) __applySessionSyncEventForTest(input, mapped);
}

afterEach(() => {
  getReactQueryClient().clear();
});

describe("session permission sync", () => {
  test("persists the broader legacy always scope instead of the current resource", () => {
    expect(persistentPermissionPatterns({
      ...permission("perm-legacy", "session-a"),
      kind: "external_directory",
      resources: ["C:\\Users\\demo\\.agents\\skills\\hyperframes-core\\references\\*"],
      remember: ["C:\\Users\\demo\\.agents\\skills\\hyperframes-core\\*"],
    })).toEqual(["C:\\Users\\demo\\.agents\\skills\\hyperframes-core\\*"]);
  });

  test("persists the v2 save scope and falls back for older requests", () => {
    const normalized = permission("perm-v2", "session-a", {
      kind: "external_directory",
      resources: ["C:/Users/demo/outside/current.txt"],
      remember: ["C:/Users/demo/outside/*", "C:/Users/demo/outside/*"],
    });

    expect(persistentPermissionPatterns(normalized)).toEqual(["C:/Users/demo/outside/*"]);
    expect(persistentPermissionPatterns({
      ...normalized,
      remember: [],
    })).toEqual(["C:/Users/demo/outside/current.txt"]);
  });

  test("seeds only permissions for the selected session", () => {
    seedPermissionState("workspace-a", "session-a", [
      permission("perm-a", "session-a"),
      permission("perm-b", "session-b"),
    ]);

    expect(getReactQueryClient().getQueryData(permissionKey("workspace-a", "session-a"))).toMatchObject([
      { id: "perm-a", sessionId: "session-a", kind: "bash" },
    ]);
  });

  test("preserves received time when refreshing an existing permission", () => {
    seedPermissionState("workspace-a", "session-a", [permission("perm-a", "session-a")]);
    const first = getReactQueryClient().getQueryData<Array<{ id: string; receivedAt: number }>>(
      permissionKey("workspace-a", "session-a"),
    )!;

    seedPermissionState("workspace-a", "session-a", [permission("perm-a", "session-a")]);
    const second = getReactQueryClient().getQueryData<Array<{ id: string; receivedAt: number }>>(
      permissionKey("workspace-a", "session-a"),
    )!;

    expect(second[0]!.receivedAt).toBe(first[0]!.receivedAt);
  });

  test("keeps live permissions that arrive after a snapshot starts", () => {
    getReactQueryClient().setQueryData(permissionKey("workspace-a", "session-a"), [
      {
        ...permission("perm-live", "session-a"),
        receivedAt: 200,
      },
    ]);

    seedPermissionState("workspace-a", "session-a", [], { snapshotStartedAt: 100 });

    expect(getReactQueryClient().getQueryData(permissionKey("workspace-a", "session-a"))).toMatchObject([
      { id: "perm-live", sessionId: "session-a", kind: "bash" },
    ]);
  });

  test("drops stale permissions that predate a fresh snapshot", () => {
    getReactQueryClient().setQueryData(permissionKey("workspace-a", "session-a"), [
      {
        ...permission("perm-stale", "session-a"),
        receivedAt: 100,
      },
    ]);

    seedPermissionState("workspace-a", "session-a", [], { snapshotStartedAt: 200 });

    expect(getReactQueryClient().getQueryData(permissionKey("workspace-a", "session-a"))).toEqual([]);
  });

  test("seeds v2 permissions for the selected session", () => {
    seedPermissionState("workspace-a", "session-a", [
      permission("perm-v2-a", "session-a", {
        kind: "read",
        resources: ["/outside/project/secrets.txt"],
        remember: ["/outside/project/*"],
      }),
      permission("perm-v2-b", "session-b", {
        kind: "read",
        resources: ["/outside/project/secrets.txt"],
        remember: ["/outside/project/*"],
      }),
    ]);

    expect(getReactQueryClient().getQueryData(permissionKey("workspace-a", "session-a"))).toMatchObject([
      {
        id: "perm-v2-a",
        sessionId: "session-a",
        kind: "read",
        resources: ["/outside/project/secrets.txt"],
      },
    ]);
  });

  test("adds and removes live v2 permission events", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const releaseSession = trackWorkspaceSessionSync(syncInput, "session-a");

    try {
      applyOpenCodeEvent(syncInput, {
        type: "permission.v2.asked",
        properties: nativeV2Permission("perm-v2-live", "session-a"),
      });

      expect(getReactQueryClient().getQueryData(permissionKey("workspace-a", "session-a"))).toMatchObject([
        { id: "perm-v2-live", sessionId: "session-a", kind: "read" },
      ]);

      applyOpenCodeEvent(syncInput, {
        type: "permission.v2.replied",
        properties: { sessionID: "session-a", requestID: "perm-v2-live", reply: "once" },
      });

      expect(getReactQueryClient().getQueryData(permissionKey("workspace-a", "session-a"))).toEqual([]);
    } finally {
      releaseSession();
      cleanup();
    }
  });
});

describe("session question sync", () => {
  test("seeds only questions for the selected session", () => {
    seedQuestionState("workspace-a", "session-a", [
      question("question-a", "session-a"),
      question("question-b", "session-b"),
    ]);

    expect(getReactQueryClient().getQueryData(questionKey("workspace-a", "session-a"))).toMatchObject([
      { id: "question-a", sessionId: "session-a" },
    ]);
  });

  test("adds and removes live question events", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const releaseSession = trackWorkspaceSessionSync(syncInput, "session-a");

    try {
      applyOpenCodeEvent(syncInput, {
        type: "question.asked",
        properties: nativeQuestion("question-live", "session-a"),
      } as any);

      expect(getReactQueryClient().getQueryData(questionKey("workspace-a", "session-a"))).toMatchObject([
        { id: "question-live", sessionId: "session-a" },
      ]);

      applyOpenCodeEvent(syncInput, {
        type: "question.replied",
        properties: { sessionID: "session-a", requestID: "question-live", answers: [["Yes"]] },
      } as any);

      expect(getReactQueryClient().getQueryData(questionKey("workspace-a", "session-a"))).toEqual([]);
    } finally {
      releaseSession();
      cleanup();
    }
  });
});

describe("session transcript sync", () => {
  test("coalesces token-sized deltas by transcript part", () => {
    const deltas = coalescePendingDeltas([
      { sessionId: "session-a", messageId: "msg-a", partId: "part-a", reasoning: false, delta: "hel" },
      { sessionId: "session-a", messageId: "msg-a", partId: "part-a", reasoning: false, delta: "lo" },
      { sessionId: "session-a", messageId: "msg-a", partId: "part-b", reasoning: true, delta: "think" },
      { sessionId: "session-b", messageId: "msg-b", partId: "part-a", reasoning: false, delta: "other" },
    ]);

    expect(deltas).toEqual([
      { sessionId: "session-a", messageId: "msg-a", partId: "part-a", reasoning: false, delta: "hello" },
      { sessionId: "session-a", messageId: "msg-a", partId: "part-b", reasoning: true, delta: "think" },
      { sessionId: "session-b", messageId: "msg-b", partId: "part-a", reasoning: false, delta: "other" },
    ]);
  });

  test("keeps live-only messages when an idle snapshot is stale", () => {
    getReactQueryClient().setQueryData(transcriptKey("workspace-a", "session-a"), [
      uiMessage("msg-user", "user", "hello"),
      uiMessage("msg-assistant", "assistant", "finished answer"),
    ]);

    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "msg-user", role: "user", text: "hello" },
    ]));

    const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"));
    expect(transcript?.map((message) => message.id)).toEqual(["msg-user", "msg-assistant"]);
  });

  test("keeps longer live text when an idle snapshot lags the event stream", () => {
    getReactQueryClient().setQueryData(transcriptKey("workspace-a", "session-a"), [
      uiMessage("msg-user", "user", "hello"),
      uiMessage("msg-assistant", "assistant", "finished answer"),
    ]);

    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "msg-user", role: "user", text: "hello" },
      { id: "msg-assistant", role: "assistant", text: "finished" },
    ]));

    const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"));
    expect(transcript?.[1]?.parts[0]).toMatchObject({ text: "finished answer" });
  });

  test("continues accepting stream deltas for a recently unselected session", async () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);

    try {
      const releaseSessionA = trackWorkspaceSessionSync(syncInput, "session-a");
      releaseSessionA();
      const releaseSessionB = trackWorkspaceSessionSync(syncInput, "session-b");

      applyOpenCodeEvent(syncInput, {
        type: "message.updated",
        properties: { info: { id: "msg-assistant", role: "assistant", sessionID: "session-a" } },
      } as any);
      applyOpenCodeEvent(syncInput, {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-assistant",
            type: "text",
            text: "",
            sessionID: "session-a",
            messageID: "msg-assistant",
          },
        },
      } as any);
      applyOpenCodeEvent(syncInput, {
        type: "message.part.delta",
        properties: {
          sessionID: "session-a",
          messageID: "msg-assistant",
          partID: "part-assistant",
          delta: "still streaming after switch",
        },
      } as any);

      await Promise.resolve();

      const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"));
      expect(transcript?.[0]?.parts[0]).toMatchObject({ text: "still streaming after switch" });

      releaseSessionB();
    } finally {
      cleanup();
    }
  });

  test("destroys an explicitly switched-away session and ignores later events", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);

    try {
      const releaseSession = trackWorkspaceSessionSync(syncInput, "session-a");
      seedSessionState("workspace-a", snapshotWithMessages([
        { id: "msg-user", role: "user", text: "destroy me" },
      ]));
      releaseSession();

      destroyWorkspaceSessionResources(syncInput, "session-a");

      for (const queryKey of [
        snapshotKey("workspace-a", "session-a"),
        transcriptKey("workspace-a", "session-a"),
        statusKey("workspace-a", "session-a"),
        todoKey("workspace-a", "session-a"),
        permissionKey("workspace-a", "session-a"),
        questionKey("workspace-a", "session-a"),
      ]) {
        expect(getReactQueryClient().getQueryData(queryKey)).toBeUndefined();
      }

      applyOpenCodeEvent(syncInput, {
        type: "message.updated",
        properties: { info: { id: "msg-late", role: "assistant", sessionID: "session-a" } },
      } as any);
      expect(getReactQueryClient().getQueryData(transcriptKey("workspace-a", "session-a"))).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("keeps workspace stream alive while retained sessions remain after route unmount", async () => {
    const liveSyncInput = { ...syncInput, connection: testConnection };
    const releaseWorkspace = ensureWorkspaceSessionSync(liveSyncInput);
    const releaseSessionA = trackWorkspaceSessionSync(liveSyncInput, "session-a");

    releaseSessionA();
    releaseWorkspace();

    try {
      expect(__hasWorkspaceSessionSyncForTest(liveSyncInput)).toBe(true);

      applyOpenCodeEvent(liveSyncInput, {
        type: "message.updated",
        properties: { info: { id: "msg-route-leave", role: "assistant", sessionID: "session-a" } },
      } as any);
      applyOpenCodeEvent(liveSyncInput, {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-route-leave",
            type: "text",
            text: "",
            sessionID: "session-a",
            messageID: "msg-route-leave",
          },
        },
      } as any);
      applyOpenCodeEvent(liveSyncInput, {
        type: "message.part.delta",
        properties: {
          sessionID: "session-a",
          messageID: "msg-route-leave",
          partID: "part-route-leave",
          delta: "stream survived settings route",
        },
      } as any);

      await Promise.resolve();

      const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"));
      expect(transcript?.[0]?.parts[0]).toMatchObject({ text: "stream survived settings route" });
    } finally {
      __disposeWorkspaceSessionSyncForTest(liveSyncInput);
    }
  });
});
