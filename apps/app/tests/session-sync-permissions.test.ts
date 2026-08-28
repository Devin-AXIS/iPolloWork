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
import { deriveRenderedSessionMessages } from "../src/react-app/domains/session/surface/session-render-state";
import {
  __applySessionSyncEventForTest,
  __createWorkspaceSessionSyncForTest,
  __disposeWorkspaceSessionSyncForTest,
  __hasWorkspaceSessionSyncForTest,
  beginOptimisticSessionPrompt,
  coalescePendingDeltas,
  destroyWorkspaceSessionResources,
  ensureWorkspaceSessionSync,
  permissionKey,
  questionKey,
  rollbackOptimisticSessionPrompt,
  sanitizeInterruptedSessionSnapshot,
  seedPermissionState,
  seedQuestionState,
  seedSessionState,
  settleInterruptedSessionRun,
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

function uiMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
  options: { created?: number; parentUserMessageId?: string } = {},
): UIMessage {
  const ipollowork = {
    ...(typeof options.created === "number" ? { created: options.created } : {}),
    ...(options.parentUserMessageId ? { parentUserMessageId: options.parentUserMessageId } : {}),
  };
  return {
    id,
    role,
    ...(Object.keys(ipollowork).length > 0 ? { metadata: { ipollowork } } : {}),
    parts: [{ type: "text", text, state: "done" }],
  };
}

function messageVisibleTextForTest(message: UIMessage) {
  return message.parts
    .flatMap((part) => part.type === "text" || part.type === "reasoning" ? [part.text] : [])
    .join("");
}

function snapshotWithMessages(
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    created?: number;
    parentUserMessageId?: string;
  }>,
  sessionId = "session-a",
): ConversationSnapshot {
  return {
    session: {
      id: sessionId,
      title: "Test session",
      time: { created: 1, updated: 2 },
    },
    messages: messages.map((message) => uiMessage(message.id, message.role, message.text, message)),
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
  destroyWorkspaceSessionResources(syncInput, "session-a");
  destroyWorkspaceSessionResources(syncInput, "session-b");
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
  test("shows an accepted prompt as busy before a stale Codex snapshot catches up", () => {
    const messageId = beginOptimisticSessionPrompt(
      "workspace-a",
      "session-a",
      "立即开始处理",
      "ipollowork-user-1",
    );

    seedSessionState("workspace-a", snapshotWithMessages([]));

    expect(messageId).toBe("ipollowork-user-1");
    expect(getReactQueryClient().getQueryData(statusKey("workspace-a", "session-a"))).toEqual({ type: "busy" });
    expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))).toEqual([
      expect.objectContaining({
        id: "ipollowork-user-1",
        role: "user",
        parts: [expect.objectContaining({ text: "立即开始处理" })],
      }),
    ]);
  });

  test("keeps a prompt submitted after interruption visible across a stale reverted snapshot", () => {
    const interruptedSnapshot = snapshotWithMessages([
      { id: "msg-user-old", role: "user", text: "123" },
      { id: "msg-assistant-interrupted", role: "assistant", text: "partial" },
    ]);
    interruptedSnapshot.session.revertMessageId = "msg-assistant-interrupted";
    seedSessionState("workspace-a", interruptedSnapshot);

    beginOptimisticSessionPrompt(
      "workspace-a",
      "session-a",
      "暂停后发送的新消息",
      "ipollowork-user-after-stop",
    );
    seedSessionState("workspace-a", interruptedSnapshot);

    const transcript = getReactQueryClient().getQueryData<UIMessage[]>(
      transcriptKey("workspace-a", "session-a"),
    ) ?? [];
    expect(transcript.map((message) => message.id)).toEqual([
      "msg-user-old",
      "ipollowork-user-after-stop",
    ]);
    expect(deriveRenderedSessionMessages({
      transcriptState: transcript,
      snapshot: interruptedSnapshot,
    }).map((message) => message.id)).toEqual([
      "msg-user-old",
      "ipollowork-user-after-stop",
    ]);
  });

  test("replaces an optimistic user prompt when an OpenCode event confirms the same text", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const releaseSession = trackWorkspaceSessionSync(syncInput, "session-a");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "立即开始处理", "ipollowork-user-1");

    try {
      applyOpenCodeEvent(syncInput, {
        type: "message.updated",
        properties: { info: { id: "msg-user", role: "user", sessionID: "session-a" } },
      } as any);
      applyOpenCodeEvent(syncInput, {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-user",
            type: "text",
            text: "立即开始处理",
            sessionID: "session-a",
            messageID: "msg-user",
          },
        },
      } as any);

      expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))).toEqual([
        expect.objectContaining({
          id: "msg-user",
          role: "user",
          parts: [expect.objectContaining({ text: "立即开始处理" })],
        }),
      ]);
    } finally {
      releaseSession();
      cleanup();
    }
  });

  test("replaces an optimistic prompt when the authoritative message also contains an image", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const releaseSession = trackWorkspaceSessionSync(syncInput, "session-a");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "Describe this image", "ipollowork-user-1");

    try {
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: {
          id: "dsh-user-1",
          role: "user",
          parts: [
            { type: "text", text: "Describe this image", state: "done" },
            {
              type: "file",
              mediaType: "image/png",
              filename: "reference.png",
              url: "data:image/png;base64,aW1hZ2U=",
            },
          ],
        },
      });

      expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))).toEqual([
        expect.objectContaining({
          id: "dsh-user-1",
          role: "user",
          parts: [
            expect.objectContaining({ type: "text", text: "Describe this image" }),
            expect.objectContaining({ type: "file", mediaType: "image/png" }),
          ],
        }),
      ]);
    } finally {
      releaseSession();
      cleanup();
    }
  });

  test("replaces an optimistic user prompt when a snapshot confirms the same text", () => {
    beginOptimisticSessionPrompt("workspace-a", "session-a", "snapshot prompt", "ipollowork-user-1");

    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "msg-user", role: "user", text: "snapshot prompt" },
    ]));

    expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))).toEqual([
      expect.objectContaining({
        id: "msg-user",
        role: "user",
        parts: [expect.objectContaining({ text: "snapshot prompt" })],
      }),
    ]);
  });

  test("keeps a repeated optimistic prompt until a new matching occurrence is confirmed", () => {
    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "msg-user-old", role: "user", text: "123" },
      { id: "msg-assistant-old", role: "assistant", text: "old answer" },
    ]));
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-repeat");

    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "msg-user-old", role: "user", text: "123" },
      { id: "msg-assistant-old", role: "assistant", text: "old answer" },
    ]));
    expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))?.map((message) => message.id))
      .toEqual(["msg-user-old", "msg-assistant-old", "ipollowork-user-repeat"]);

    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "msg-user-old", role: "user", text: "123" },
      { id: "msg-assistant-old", role: "assistant", text: "old answer" },
      { id: "msg-user-repeat", role: "user", text: "123" },
    ]));
    expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))?.map((message) => message.id))
      .toEqual(["msg-user-old", "msg-assistant-old", "msg-user-repeat"]);
  });

  test("keeps two identical prompts when both are still optimistic across an immediate stop", () => {
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-first");
    settleInterruptedSessionRun("workspace-a", "session-a");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-second");

    const transcript = getReactQueryClient().getQueryData<UIMessage[]>(
      transcriptKey("workspace-a", "session-a"),
    ) ?? [];
    expect(transcript.map((message) => message.id)).toEqual([
      "ipollowork-user-first",
      "ipollowork-user-second",
    ]);
    expect(transcript.map(messageVisibleTextForTest)).toEqual(["123", "123"]);
  });

  test("keeps the stopped duplicate when a snapshot confirms only the newer identical prompt", () => {
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-first");
    settleInterruptedSessionRun("workspace-a", "session-a");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-second");
    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "ipollowork-user-second", role: "user", text: "123" },
    ]));
    expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))?.map((message) => message.id))
      .toEqual(["ipollowork-user-first", "ipollowork-user-second"]);

    beginOptimisticSessionPrompt("workspace-a", "session-b", "123", "ipollowork-user-first-dsh");
    settleInterruptedSessionRun("workspace-a", "session-b");
    beginOptimisticSessionPrompt("workspace-a", "session-b", "123", "ipollowork-user-second-dsh");
    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "dsh-user-second", role: "user", text: "123", created: Date.now() + 1_000 },
    ], "session-b"));
    expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-b"))?.map((message) => message.id))
      .toEqual(["ipollowork-user-first-dsh", "dsh-user-second"]);
  });

  test("does not let live parts for the newer duplicate acknowledge the stopped optimistic row", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const releaseSession = trackWorkspaceSessionSync(syncInput, "session-a");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-first");
    settleInterruptedSessionRun("workspace-a", "session-a");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-second");

    try {
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: { id: "ipollowork-user-second", role: "user", parts: [] },
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "message.parts",
        sessionId: "session-a",
        messageId: "ipollowork-user-second",
        partId: "second-text",
        parts: [{ type: "text", text: "123", state: "done" }],
        messageRole: "user",
        visibleAssistantOutput: false,
      });
      expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))?.map((message) => message.id))
        .toEqual(["ipollowork-user-first", "ipollowork-user-second"]);
    } finally {
      releaseSession();
      cleanup();
    }
  });

  test("freezes an interrupted run and admits only the next acknowledged turn", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const releaseSession = trackWorkspaceSessionSync(syncInput, "session-a");
    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "msg-user-old", role: "user", text: "123" },
      { id: "msg-assistant-partial", role: "assistant", text: "partial" },
    ]));
    settleInterruptedSessionRun("workspace-a", "session-a");

    try {
      __applySessionSyncEventForTest(syncInput, {
        type: "session.status",
        sessionId: "session-a",
        status: { type: "busy" },
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("msg-assistant-late", "assistant", "late answer"),
      });
      expect(getReactQueryClient().getQueryData(statusKey("workspace-a", "session-a"))).toEqual({ type: "idle" });
      expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))?.map((message) => message.id))
        .toEqual(["msg-user-old", "msg-assistant-partial"]);

      beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-repeat");
      seedSessionState("workspace-a", snapshotWithMessages([
        { id: "msg-user-old", role: "user", text: "123" },
        { id: "msg-assistant-partial", role: "assistant", text: "late completed answer" },
      ]));
      expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))?.at(-1)?.id)
        .toBe("ipollowork-user-repeat");

      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("ipollowork-user-repeat", "user", "123"),
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "session.status",
        sessionId: "session-a",
        status: { type: "busy" },
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("msg-assistant-new", "assistant", "new answer"),
      });
      expect(getReactQueryClient().getQueryData(statusKey("workspace-a", "session-a"))).toEqual({ type: "busy" });
      expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))?.map((message) => message.id))
        .toEqual(["msg-user-old", "msg-assistant-partial", "ipollowork-user-repeat", "msg-assistant-new"]);
    } finally {
      releaseSession();
      cleanup();
    }
  });

  test("never resurrects a stopped turn after the next identical turn completes", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const releaseSession = trackWorkspaceSessionSync(syncInput, "session-a");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-first");
    settleInterruptedSessionRun("workspace-a", "session-a", "ipollowork-user-first");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-second");

    try {
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("ipollowork-user-second", "user", "123", { created: 200 }),
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("assistant-second", "assistant", "second answer", {
          created: 210,
          parentUserMessageId: "ipollowork-user-second",
        }),
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "message.parts",
        sessionId: "session-a",
        messageId: "assistant-first-late",
        partId: "late-text",
        parts: [{ type: "text", text: "late", state: "streaming" }],
        messageRole: "assistant",
        parentUserMessageId: "ipollowork-user-first",
        visibleAssistantOutput: true,
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "message.chunk",
        sessionId: "session-a",
        messageId: "assistant-first-late",
        parentUserMessageId: "ipollowork-user-first",
        chunk: { type: "text-delta", id: "late-text", delta: " first answer" },
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("assistant-first-late", "assistant", "late first answer", {
          created: 100,
          parentUserMessageId: "ipollowork-user-first",
        }),
      });

      expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a"))?.map((message) => message.id))
        .toEqual(["ipollowork-user-first", "ipollowork-user-second", "assistant-second"]);

      const replayedSnapshot = snapshotWithMessages([
        { id: "ipollowork-user-first", role: "user", text: "123", created: 90 },
        {
          id: "assistant-first-late",
          role: "assistant",
          text: "late first answer",
          created: 100,
          parentUserMessageId: "ipollowork-user-first",
        },
        { id: "ipollowork-user-second", role: "user", text: "123", created: 200 },
        {
          id: "assistant-second",
          role: "assistant",
          text: "second answer",
          created: 210,
          parentUserMessageId: "ipollowork-user-second",
        },
      ]);
      const sanitized = sanitizeInterruptedSessionSnapshot("workspace-a", replayedSnapshot);
      expect(sanitized.messages.map((message) => message.id)).toEqual([
        "ipollowork-user-first",
        "ipollowork-user-second",
        "assistant-second",
      ]);

      seedSessionState("workspace-a", replayedSnapshot);
      const transcript = getReactQueryClient().getQueryData<UIMessage[]>(
        transcriptKey("workspace-a", "session-a"),
      ) ?? [];
      expect(transcript.map((message) => message.id)).toEqual([
        "ipollowork-user-first",
        "ipollowork-user-second",
        "assistant-second",
      ]);
      expect(deriveRenderedSessionMessages({ transcriptState: transcript, snapshot: sanitized }).map((message) => message.id))
        .toEqual(["ipollowork-user-first", "ipollowork-user-second", "assistant-second"]);
    } finally {
      releaseSession();
      cleanup();
    }
  });

  test("binds a stop to the authoritative user id after the optimistic id is replaced", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const releaseSession = trackWorkspaceSessionSync(syncInput, "session-a");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-first");

    try {
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("engine-user-first", "user", "123", { created: 100 }),
      });
      settleInterruptedSessionRun("workspace-a", "session-a", "ipollowork-user-first");
      beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-second");
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("ipollowork-user-second", "user", "123", { created: 200 }),
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("assistant-second", "assistant", "second answer", {
          created: 210,
          parentUserMessageId: "ipollowork-user-second",
        }),
      });
      __applySessionSyncEventForTest(syncInput, {
        type: "message.upsert",
        sessionId: "session-a",
        message: uiMessage("assistant-first-late", "assistant", "late first answer", {
          created: 110,
          parentUserMessageId: "engine-user-first",
        }),
      });

      expect(getReactQueryClient().getQueryData<UIMessage[]>(
        transcriptKey("workspace-a", "session-a"),
      )?.map((message) => message.id)).toEqual([
        "engine-user-first",
        "ipollowork-user-second",
        "assistant-second",
      ]);
    } finally {
      releaseSession();
      cleanup();
    }
  });

  test("rolls back only a prompt that the engine has not acknowledged", () => {
    beginOptimisticSessionPrompt("workspace-a", "session-a", "will fail", "ipollowork-user-1");
    expect(rollbackOptimisticSessionPrompt("workspace-a", "session-a", "ipollowork-user-1")).toBe(true);
    expect(getReactQueryClient().getQueryData(transcriptKey("workspace-a", "session-a"))).toEqual([]);
    expect(getReactQueryClient().getQueryData(statusKey("workspace-a", "session-a"))).toEqual({ type: "idle" });

    getReactQueryClient().setQueryData(transcriptKey("workspace-a", "session-a"), [
      uiMessage("ipollowork-user-2", "user", "acknowledged"),
    ]);
    expect(rollbackOptimisticSessionPrompt("workspace-a", "session-a", "ipollowork-user-2")).toBe(false);
    expect(getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey("workspace-a", "session-a")))
      .toHaveLength(1);
  });

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

  test("keeps a stopped-run tombstone when leaving and re-entering a session", () => {
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-first");
    settleInterruptedSessionRun("workspace-a", "session-a", "ipollowork-user-first");
    beginOptimisticSessionPrompt("workspace-a", "session-a", "123", "ipollowork-user-second");
    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "ipollowork-user-first", role: "user", text: "123", created: 100 },
      { id: "ipollowork-user-second", role: "user", text: "123", created: Date.now() + 1_000 },
      {
        id: "assistant-second",
        role: "assistant",
        text: "second answer",
        created: Date.now() + 1_100,
        parentUserMessageId: "ipollowork-user-second",
      },
    ]));

    destroyWorkspaceSessionResources(syncInput, "session-a", {
      preserveInterruptedRun: true,
    });
    seedSessionState("workspace-a", snapshotWithMessages([
      { id: "ipollowork-user-first", role: "user", text: "123", created: 100 },
      {
        id: "assistant-first-late",
        role: "assistant",
        text: "late first answer",
        created: 110,
        parentUserMessageId: "ipollowork-user-first",
      },
      { id: "ipollowork-user-second", role: "user", text: "123", created: 200 },
      {
        id: "assistant-second",
        role: "assistant",
        text: "second answer",
        created: 210,
        parentUserMessageId: "ipollowork-user-second",
      },
    ]));

    expect(getReactQueryClient().getQueryData<UIMessage[]>(
      transcriptKey("workspace-a", "session-a"),
    )?.map((message) => message.id)).toEqual([
      "ipollowork-user-first",
      "ipollowork-user-second",
      "assistant-second",
    ]);
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
