import type { UIMessage } from "ai";

import { getReactQueryClient } from "../../../infra/query-client";
import { captureAnalyticsEvent, takeTaskRunStart } from "@/app/lib/analytics";
import { trackTaskCompleted, trackTaskFailed } from "@/app/lib/den-telemetry";
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "@/app/types";
import { applyRevertCursor, reconcileTranscriptMessages } from "./transcript-reconcile";
import {
  useSessionActivityStore,
} from "../status/session-activity-store";
import { notifyDesktopEvent } from "../../../shell/desktop-notifications";
import type {
  ConversationEvent,
  ConversationEngineConnection,
  ConversationPermission,
  ConversationQuestion,
  ConversationSession,
  ConversationSnapshot,
  ConversationStatus,
} from "../engine/conversation-engine";
import { completeConversationMessage, conversationMessageMetadata } from "../engine/conversation-engine";
import { describeConversationSessionError } from "../engine/opencode-message-adapter";

type SyncScope = {
  workspaceId: string;
  connectionKey: string;
};

type SyncOptions = SyncScope & {
  connection: ConversationEngineConnection;
  onSessionUpdated?: (update: { sessionId: string; info: Record<string, unknown> }) => void;
  onSessionStatus?: (update: { sessionId: string; status: ConversationStatus }) => void;
  onSessionError?: (update: { sessionId: string; errorText: string }) => void;
};

type PendingDelta = {
  sessionId: string;
  messageId: string;
  partId: string;
  reasoning: boolean;
  delta: string;
};

type SyncEntry = {
  input: SyncScope;
  refs: number;
  dispose: () => void;
  disposeTimer: ReturnType<typeof setTimeout> | null;
  trackedSessionRefs: Map<string, number>;
  retainedSessionTimers: Map<string, ReturnType<typeof setTimeout>>;
  sessionUpdatedListeners: Set<NonNullable<SyncOptions["onSessionUpdated"]>>;
  sessionStatusListeners: Set<NonNullable<SyncOptions["onSessionStatus"]>>;
  sessionErrorListeners: Set<NonNullable<SyncOptions["onSessionError"]>>;
  pendingDeltas: Map<string, { messageId: string; reasoning: boolean; text: string }>;
  // Coalesce rapid-fire delta events from the SSE stream into one cache
  // commit per animation frame. Without this, a long response produces a
  // setQueryData per token; each triggers a full transcript re-render
  // (~27ms on large sessions) which starves the main thread and looks to
  // the user like the app "freezes after 2 words."
  deltaFlushBuffer: PendingDelta[];
  deltaFlushScheduled: boolean;
};

const idleStatus: ConversationStatus = { type: "idle" };
const syncs = new Map<string, SyncEntry>();
const retainedSessionTtlMs = 10 * 60_000;
const idleRetainedSessionTtlMs = 10_000;

export const snapshotKey = (workspaceId: string, sessionId: string) =>
  ["react-session-snapshot", workspaceId, sessionId] as const;
export const transcriptKey = (workspaceId: string, sessionId: string) =>
  ["react-session-transcript", workspaceId, sessionId] as const;
export const statusKey = (workspaceId: string, sessionId: string) =>
  ["react-session-status", workspaceId, sessionId] as const;
export const todoKey = (workspaceId: string, sessionId: string) =>
  ["react-session-todos", workspaceId, sessionId] as const;
export const permissionKey = (workspaceId: string, sessionId: string) =>
  ["react-session-permissions", workspaceId, sessionId] as const;
export const questionKey = (workspaceId: string, sessionId: string) =>
  ["react-session-questions", workspaceId, sessionId] as const;

function syncKey(input: SyncScope) {
  return `${input.workspaceId}:${input.connectionKey}`;
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as {
    status?: unknown;
    response?: { status?: unknown };
    cause?: { status?: unknown };
  };
  const status = record.status ?? record.response?.status ?? record.cause?.status;
  return typeof status === "number" ? status : null;
}

function shouldRetrySyncSubscribe(error: unknown) {
  const status = getErrorStatus(error);
  return status !== 401 && status !== 403 && status !== 404;
}

function isTrackedSession(entry: SyncEntry, sessionId: string) {
  return (entry.trackedSessionRefs.get(sessionId) ?? 0) > 0 || entry.retainedSessionTimers.has(sessionId);
}

function isLiveStatus(status: ConversationStatus | null | undefined) {
  return status?.type === "busy" || status?.type === "retry";
}

function messageHasVisibleAssistantOutput(message: UIMessage) {
  if (message.role !== "assistant") return false;
  return message.parts.some((part) => {
    if ("text" in part && typeof part.text === "string") return part.text.trim().length > 0;
    return part.type === "dynamic-tool" || part.type === "file";
  });
}

function assistantOutputAfterLatestUser(messages: UIMessage[]) {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return messages.slice(lastUserIndex + 1).some(messageHasVisibleAssistantOutput);
}

function permissionNotificationDetail(permission: ConversationPermission) {
  return `A session is waiting for ${permission.kind.replace(/[._-]/g, " ")} permission.`;
}

function questionNotificationText(question: ConversationQuestion) {
  const prompt = question.questions.find((item) => item.question.trim())?.question.trim();
  return prompt ? `Question: ${prompt}` : undefined;
}

function latestAssistantMessageId(messages: UIMessage[]) {
  // The snapshot keys each error to its errored assistant message id, so the
  // live event must resolve to that same id to dedupe on reload. Skipping
  // synthetic error messages ensures a follow-up error keys off the real
  // assistant turn rather than overwriting the previous error message.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    if (message.id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX)) continue;
    return message.id;
  }
  return null;
}

function createSessionErrorUIMessage(turnKey: string, text: string): UIMessage {
  const id = `${SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX}${turnKey}`;
  return {
    id,
    role: "assistant",
    parts: [{
      type: "text",
      text,
      state: "done",
      providerMetadata: { ipollowork: { partId: `${id}:text` } },
    }],
  };
}

function clearTrackedSession(input: SyncScope, entry: SyncEntry, sessionId: string) {
  entry.trackedSessionRefs.delete(sessionId);
  const retainedTimer = entry.retainedSessionTimers.get(sessionId);
  if (retainedTimer) clearTimeout(retainedTimer);
  entry.retainedSessionTimers.delete(sessionId);
  entry.deltaFlushBuffer = entry.deltaFlushBuffer.filter(
    (item) => item.sessionId !== sessionId,
  );
  const queryClient = getReactQueryClient();
  queryClient.removeQueries({ queryKey: permissionKey(input.workspaceId, sessionId), exact: true });
  if (entry.refs <= 0 && entry.retainedSessionTimers.size === 0) {
    disposeWorkspaceSync(syncKey(input), entry);
  }
}

export function destroyWorkspaceSessionResources(input: SyncScope, sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return;

  const entry = syncs.get(syncKey(input));
  if (entry) clearTrackedSession(input, entry, normalizedSessionId);

  const queryClient = getReactQueryClient();
  for (const queryKey of [
    snapshotKey(input.workspaceId, normalizedSessionId),
    transcriptKey(input.workspaceId, normalizedSessionId),
    statusKey(input.workspaceId, normalizedSessionId),
    todoKey(input.workspaceId, normalizedSessionId),
    permissionKey(input.workspaceId, normalizedSessionId),
    questionKey(input.workspaceId, normalizedSessionId),
  ]) {
    queryClient.removeQueries({ queryKey, exact: true });
  }
}

function retainSession(input: SyncScope, entry: SyncEntry, sessionId: string, ttlMs = retainedSessionTtlMs) {
  const existing = entry.retainedSessionTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  entry.retainedSessionTimers.set(sessionId, setTimeout(() => {
    clearTrackedSession(input, entry, sessionId);
  }, ttlMs));
}

function disposeWorkspaceSync(key: string, entry: SyncEntry) {
  if (entry.refs > 0) return;
  if (entry.disposeTimer) {
    clearTimeout(entry.disposeTimer);
    entry.disposeTimer = null;
  }
  for (const timer of entry.retainedSessionTimers.values()) clearTimeout(timer);
  entry.retainedSessionTimers.clear();
  entry.dispose();
  if (syncs.get(key) === entry) syncs.delete(key);
}

function releaseRetainedSessionSoon(input: SyncScope, entry: SyncEntry, sessionId: string) {
  if (!entry.retainedSessionTimers.has(sessionId)) return;
  retainSession(input, entry, sessionId, idleRetainedSessionTtlMs);
}

function sortPermissions(a: ConversationPermission, b: ConversationPermission) {
  return a.receivedAt - b.receivedAt || a.id.localeCompare(b.id);
}

function sortQuestions(a: ConversationQuestion, b: ConversationQuestion) {
  return a.receivedAt - b.receivedAt || a.id.localeCompare(b.id);
}

export function seedPermissionState(
  workspaceId: string,
  sessionId: string,
  permissions: ConversationPermission[],
  options: { snapshotStartedAt?: number } = {},
) {
  useSessionActivityStore.getState().replaceWaitingRequests(
    workspaceId,
    sessionId,
    "permission",
    permissions.flatMap((permission) => permission.sessionId === sessionId ? [permission.id] : []),
  );
  const queryClient = getReactQueryClient();
  const now = Date.now();
  queryClient.setQueryData<ConversationPermission[]>(permissionKey(workspaceId, sessionId), (current = []) => {
    const receivedAtById = new Map(current.map((permission) => [permission.id, permission.receivedAt]));
    const seeded = permissions.flatMap((permission) =>
      permission.sessionId === sessionId
        ? [{ ...permission, receivedAt: receivedAtById.get(permission.id) ?? now }]
        : [],
    );
    const seededIds = new Set(seeded.map((permission) => permission.id));
    const snapshotStartedAt = options.snapshotStartedAt;
    const liveAfterSnapshot =
      typeof snapshotStartedAt === "number"
        ? current.filter(
            (permission) =>
              permission.sessionId === sessionId &&
              permission.receivedAt > snapshotStartedAt &&
              !seededIds.has(permission.id),
          )
        : [];
    return [...seeded, ...liveAfterSnapshot].sort(sortPermissions);
  });
}

export function seedQuestionState(
  workspaceId: string,
  sessionId: string,
  questions: ConversationQuestion[],
  options: { snapshotStartedAt?: number } = {},
) {
  useSessionActivityStore.getState().replaceWaitingRequests(
    workspaceId,
    sessionId,
    "question",
    questions.flatMap((question) => question.sessionId === sessionId ? [question.id] : []),
  );
  const queryClient = getReactQueryClient();
  const now = Date.now();
  queryClient.setQueryData<ConversationQuestion[]>(questionKey(workspaceId, sessionId), (current = []) => {
    const receivedAtById = new Map(current.map((question) => [question.id, question.receivedAt]));
    const seeded = questions.flatMap((question) =>
      question.sessionId === sessionId
        ? [{ ...question, receivedAt: receivedAtById.get(question.id) ?? now }]
        : [],
    );
    const seededIds = new Set(seeded.map((question) => question.id));
    const snapshotStartedAt = options.snapshotStartedAt;
    const liveAfterSnapshot =
      typeof snapshotStartedAt === "number"
        ? current.filter(
            (question) =>
              question.sessionId === sessionId &&
              question.receivedAt > snapshotStartedAt &&
              !seededIds.has(question.id),
          )
        : [];
    return [...seeded, ...liveAfterSnapshot].sort(sortQuestions);
  });
}

function getPartMetadataId(part: UIMessage["parts"][number]) {
  if (part.type === "data-design-selection" || part.type === "data-animation-references" || part.type === "data-voice-reference" || part.type === "data-illustration-reference") {
    const partId = part.data && typeof part.data === "object" && "partId" in part.data
      ? (part.data as { partId?: unknown }).partId
      : null;
    return typeof partId === "string" ? partId : null;
  }
  if (part.type === "dynamic-tool") {
    const metadata = part.callProviderMetadata?.ipollowork;
    if (!metadata || typeof metadata !== "object") return null;
    return "partId" in metadata ? (metadata as { partId?: string }).partId ?? null : null;
  }
  if (part.type !== "text" && part.type !== "reasoning" && part.type !== "file" && part.type !== "source-url" && part.type !== "source-document") return null;
  const metadata = part.providerMetadata?.ipollowork;
  if (!metadata || typeof metadata !== "object") return null;
  return "partId" in metadata ? (metadata as { partId?: string }).partId ?? null : null;
}

function upsertMessage(messages: UIMessage[], next: UIMessage) {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index === -1) return [...messages, next];
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? {
          ...message,
          ...next,
          parts: next.parts.length > 0 ? next.parts : message.parts,
        }
      : message,
  );
}

function isOptimisticUserMessage(message: UIMessage | undefined) {
  if (message?.role !== "user" || !message.metadata || typeof message.metadata !== "object") return false;
  const metadata = "ipollowork" in message.metadata ? message.metadata.ipollowork : null;
  return Boolean(metadata && typeof metadata === "object" && "optimistic" in metadata && metadata.optimistic === true);
}

function createClientUserMessageId() {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return `ipollowork-user-${randomUUID ? randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

/**
 * Publish the user's accepted prompt before engine preflight/runtime work.
 * Codex echoes this id as `userMessage.clientId`, allowing the authoritative
 * event or snapshot to replace the optimistic row without a duplicate.
 */
export function beginOptimisticSessionPrompt(
  workspaceId: string,
  sessionId: string,
  visibleText: string,
  clientUserMessageId = createClientUserMessageId(),
) {
  const workspace = workspaceId.trim();
  const session = sessionId.trim();
  if (!workspace || !session) return clientUserMessageId;

  const queryClient = getReactQueryClient();
  const text = visibleText.trim();
  queryClient.setQueryData<UIMessage[]>(transcriptKey(workspace, session), (current = []) => upsertMessage(current, {
    id: clientUserMessageId,
    role: "user",
    metadata: conversationMessageMetadata({ created: Date.now() }, { optimistic: true }),
    parts: text ? [{ type: "text", text, state: "done" }] : [],
  }));
  queryClient.setQueryData(statusKey(workspace, session), { type: "busy" } satisfies ConversationStatus);
  const activity = useSessionActivityStore.getState();
  activity.markMessageRole(workspace, session, clientUserMessageId, "user");
  activity.setRunStatus(workspace, session, { type: "busy" });
  return clientUserMessageId;
}

/** Remove only a still-optimistic prompt; an acknowledged Codex item wins. */
export function rollbackOptimisticSessionPrompt(
  workspaceId: string,
  sessionId: string,
  clientUserMessageId: string | null | undefined,
) {
  const workspace = workspaceId.trim();
  const session = sessionId.trim();
  const messageId = clientUserMessageId?.trim() ?? "";
  if (!workspace || !session || !messageId) return false;

  const queryClient = getReactQueryClient();
  let removed = false;
  queryClient.setQueryData<UIMessage[]>(transcriptKey(workspace, session), (current = []) => {
    const message = current.find((item) => item.id === messageId);
    if (!isOptimisticUserMessage(message)) return current;
    removed = true;
    return current.filter((item) => item.id !== messageId);
  });
  if (!removed) return false;
  const idle = { type: "idle" } satisfies ConversationStatus;
  queryClient.setQueryData(statusKey(workspace, session), idle);
  useSessionActivityStore.getState().setRunStatus(workspace, session, idle);
  return true;
}

/**
 * When a message.part.updated or message.part.delta event arrives for a
 * messageID we haven't seen a message.updated for yet, we have to stub the
 * message so the part has somewhere to live. The stub's role used to be
 * hard-coded to "assistant", which meant that if part events beat the
 * message.updated event for a *user* turn (a common race during
 * promptAsync), that user message flashed as an assistant-styled block
 * until the real role arrived a tick later.
 *
 * Infer the stub role from the conversation instead. Chat sessions
 * alternate, so the new message is almost always the opposite role of the
 * most recent known message. If the transcript is empty the first message
 * is always the user's.
 */
function inferStubRole(messages: UIMessage[]): UIMessage["role"] {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return "user";
  if (lastMessage.role === "user") return "assistant";
  if (lastMessage.role === "assistant") return "user";
  return "assistant";
}

function upsertPart(messages: UIMessage[], messageId: string, partId: string, next: UIMessage["parts"][number]) {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const index = message.parts.findIndex((part) =>
      ("toolCallId" in part && part.toolCallId === partId) || getPartMetadataId(part) === partId,
    );
    if (index === -1) {
      return { ...message, parts: [...message.parts, next] };
    }
    const parts = message.parts.slice();
    parts[index] = next;
    return { ...message, parts };
  });
}

function appendDelta(messages: UIMessage[], messageId: string, partId: string, delta: string, reasoning: boolean) {
  // Fast path: locate the target message by index, only clone that message
  // and its parts array. The previous implementation ran messages.map AND
  // message.parts.map on every delta event, which is O(N * P) per token.
  // For an old session with hundreds of prior messages/parts that allocated
  // thousands of objects per token and crushed the main thread after a
  // handful of tokens.
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex === -1) return messages;

  const target = messages[messageIndex]!;
  const lastPart = target.parts[target.parts.length - 1];

  let partIndex = -1;
  for (let i = 0; i < target.parts.length; i++) {
    const part = target.parts[i]!;
    const id = getPartMetadataId(part);
    if (reasoning && part.type === "reasoning") {
      if (id === partId || (!id && part === lastPart)) {
        partIndex = i;
        break;
      }
    } else if (!reasoning && part.type === "text") {
      if (id === partId || (!id && part === lastPart)) {
        partIndex = i;
        break;
      }
    }
  }

  let nextParts: UIMessage["parts"];
  if (partIndex === -1) {
    // No existing matching part — append a fresh one so the delta is not lost.
    const newPart: UIMessage["parts"][number] = reasoning
      ? {
          type: "reasoning",
          text: delta,
          state: "streaming" as const,
          providerMetadata: { ipollowork: { partId } },
        }
      : {
          type: "text",
          text: delta,
          state: "streaming" as const,
          providerMetadata: { ipollowork: { partId } },
        };
    nextParts = target.parts.slice();
    nextParts.push(newPart);
  } else {
    const existing = target.parts[partIndex]!;
    nextParts = target.parts.slice();
    if (existing.type === "text") {
      nextParts[partIndex] = {
        ...existing,
        text: `${existing.text}${delta}`,
        state: "streaming",
      };
    } else if (existing.type === "reasoning") {
      nextParts[partIndex] = {
        ...existing,
        text: `${existing.text}${delta}`,
        state: "streaming",
      };
    }
  }

  const nextMessages = messages.slice();
  nextMessages[messageIndex] = { ...target, parts: nextParts };
  return nextMessages;
}

export function coalescePendingDeltas(items: PendingDelta[]) {
  if (items.length < 2) return items;

  const ordered: PendingDelta[] = [];
  const byKey = new Map<string, PendingDelta>();
  for (const item of items) {
    const key = `${item.sessionId}\u0000${item.messageId}\u0000${item.partId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.delta += item.delta;
      existing.reasoning = existing.reasoning || item.reasoning;
      continue;
    }

    const next = { ...item };
    byKey.set(key, next);
    ordered.push(next);
  }
  return ordered;
}

function applyEvent(entry: SyncEntry, workspaceId: string, event: ConversationEvent) {
  const queryClient = getReactQueryClient();
  const input = entry.input;

  if (event.type === "session.updated") {
    if (!isTrackedSession(entry, event.sessionId)) return;
    queryClient.setQueryData<ConversationSnapshot>(
      snapshotKey(workspaceId, event.sessionId),
      (current) => current
        ? { ...current, session: { ...current.session, revertMessageId: event.info.revertMessageId } }
        : current,
    );
    for (const listener of entry.sessionUpdatedListeners) listener({ sessionId: event.sessionId, info: event.info });
    return;
  }

  if (event.type === "session.deleted") {
    useSessionActivityStore.getState().removeSession(workspaceId, event.sessionId);
    return;
  }

  if (event.type === "session.error") {
    const errorText = describeConversationSessionError(event.errorText);
    const runStartedAt = takeTaskRunStart(event.sessionId);
    if (runStartedAt !== null) {
      captureAnalyticsEvent("task_run_errored", { duration_ms: Date.now() - runStartedAt });
      trackTaskFailed(event.sessionId, Date.now() - runStartedAt);
    }
    notifyDesktopEvent({ type: "task.failed", sessionId: event.sessionId, errorText });
    useSessionActivityStore.getState().setError(workspaceId, event.sessionId, errorText);
    if (isTrackedSession(entry, event.sessionId)) {
      queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, event.sessionId), (current = []) => {
        const turnKey = latestAssistantMessageId(current) ?? event.sessionId;
        return upsertMessage(current, createSessionErrorUIMessage(turnKey, errorText));
      });
    }
    for (const listener of entry.sessionErrorListeners) listener({ sessionId: event.sessionId, errorText });
    return;
  }

  if (event.type === "session.compaction") {
    useSessionActivityStore.getState().setCompacting(workspaceId, event.sessionId, event.running);
    return;
  }

  if (event.type === "session.status") {
    useSessionActivityStore.getState().setRunStatus(workspaceId, event.sessionId, event.status);
    const tracked = isTrackedSession(entry, event.sessionId);
    if (tracked) queryClient.setQueryData(statusKey(workspaceId, event.sessionId), event.status);
    for (const listener of entry.sessionStatusListeners) listener({ sessionId: event.sessionId, status: event.status });
    if (tracked && !isLiveStatus(event.status)) releaseRetainedSessionSoon(input, entry, event.sessionId);
    return;
  }

  if (event.type === "todo.updated") {
    if (isTrackedSession(entry, event.sessionId)) {
      queryClient.setQueryData(todoKey(workspaceId, event.sessionId), event.todos);
    }
    return;
  }

  if (event.type === "permission.asked") {
    const permission = event.permission;
    notifyDesktopEvent({
      type: "permission.asked",
      sessionId: permission.sessionId,
      detail: permissionNotificationDetail(permission),
    });
    useSessionActivityStore.getState().setWaitingRequest(workspaceId, permission.sessionId, "permission", permission.id, true);
    if (!isTrackedSession(entry, permission.sessionId)) return;
    queryClient.setQueryData<ConversationPermission[]>(permissionKey(workspaceId, permission.sessionId), (current = []) => {
      const existing = current.find((item) => item.id === permission.id);
      const next = { ...permission, receivedAt: existing?.receivedAt ?? permission.receivedAt };
      return existing
        ? current.map((item) => item.id === permission.id ? next : item).sort(sortPermissions)
        : [...current, next].sort(sortPermissions);
    });
    return;
  }

  if (event.type === "permission.replied") {
    useSessionActivityStore.getState().setWaitingRequest(workspaceId, event.sessionId, "permission", event.requestId, false);
    if (!isTrackedSession(entry, event.sessionId)) return;
    queryClient.setQueryData<ConversationPermission[]>(permissionKey(workspaceId, event.sessionId), (current = []) =>
      current.filter((permission) => permission.id !== event.requestId),
    );
    return;
  }

  if (event.type === "question.asked") {
    const question = event.question;
    notifyDesktopEvent({
      type: "question.asked",
      sessionId: question.sessionId,
      question: questionNotificationText(question),
    });
    useSessionActivityStore.getState().setWaitingRequest(workspaceId, question.sessionId, "question", question.id, true);
    if (!isTrackedSession(entry, question.sessionId)) return;
    queryClient.setQueryData<ConversationQuestion[]>(questionKey(workspaceId, question.sessionId), (current = []) => {
      const existing = current.find((item) => item.id === question.id);
      const next = { ...question, receivedAt: existing?.receivedAt ?? question.receivedAt };
      return existing
        ? current.map((item) => item.id === question.id ? next : item).sort(sortQuestions)
        : [...current, next].sort(sortQuestions);
    });
    return;
  }

  if (event.type === "question.replied") {
    useSessionActivityStore.getState().setWaitingRequest(workspaceId, event.sessionId, "question", event.requestId, false);
    if (!isTrackedSession(entry, event.sessionId)) return;
    queryClient.setQueryData<ConversationQuestion[]>(questionKey(workspaceId, event.sessionId), (current = []) =>
      current.filter((question) => question.id !== event.requestId),
    );
    return;
  }

  if (event.type === "message.upsert") {
    useSessionActivityStore.getState().markMessageRole(workspaceId, event.sessionId, event.message.id, event.message.role);
    if (!isTrackedSession(entry, event.sessionId)) return;
    // Some engines publish their authoritative assistant message immediately
    // after the last streamed chunks. Flush those queued deltas first so the
    // final message replaces the stream instead of receiving it a second time.
    if (entry.deltaFlushBuffer.length > 0) flushDeltas(entry, workspaceId);
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, event.sessionId), (current = []) =>
      upsertMessage(current, event.message),
    );
    return;
  }

  if (event.type === "message.completed") {
    if (!isTrackedSession(entry, event.sessionId)) return;
    if (entry.deltaFlushBuffer.length > 0) flushDeltas(entry, workspaceId);
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, event.sessionId), (current = []) =>
      current.map((message) =>
        message.id === event.messageId
          ? completeConversationMessage(message, event.completedAt)
          : message,
      ),
    );
    return;
  }

  if (event.type === "message.removed") {
    if (!isTrackedSession(entry, event.sessionId)) return;
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, event.sessionId), (current = []) =>
      current.filter((message) => message.id !== event.messageId),
    );
    queryClient.setQueryData<ConversationSnapshot>(
      snapshotKey(workspaceId, event.sessionId),
      (current) => current
        ? { ...current, messages: current.messages.filter((message) => message.id !== event.messageId) }
        : current,
    );
    return;
  }

  if (event.type === "message.parts") {
    if (event.visibleAssistantOutput) {
      useSessionActivityStore.getState().markAssistantOutput(workspaceId, event.sessionId, event.messageId);
    }
    if (!isTrackedSession(entry, event.sessionId)) return;
    const [mapped, ...attachments] = event.parts;
    if (!mapped) return;
    const pending = entry.pendingDeltas.get(event.partId);
    const seededPart = pending && (mapped.type === "text" || mapped.type === "reasoning")
      ? {
          ...mapped,
          text: pending.text.length > mapped.text.length ? pending.text : mapped.text,
          state: "streaming" as const,
        }
      : mapped;
    if (entry.deltaFlushBuffer.length > 0) {
      entry.deltaFlushBuffer = entry.deltaFlushBuffer.filter((item) => item.partId !== event.partId);
    }
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, event.sessionId), (current = []) => {
      const existing = current.find((message) => message.id === event.messageId);
      const role = event.messageRole ?? existing?.role ?? inferStubRole(current);
      const withMessage = upsertMessage(current, { id: event.messageId, role, parts: [] });
      const seededPartId = getPartMetadataId(seededPart) ?? event.partId;
      let next = upsertPart(withMessage, event.messageId, seededPartId, seededPart);
      for (const attachment of attachments) {
        const attachmentId = getPartMetadataId(attachment);
        if (attachmentId) next = upsertPart(next, event.messageId, attachmentId, attachment);
      }
      return next;
    });
    if (pending) entry.pendingDeltas.delete(event.partId);
    return;
  }

  if (event.type === "message.chunk") {
    useSessionActivityStore.getState().markAssistantOutput(
      workspaceId,
      event.sessionId,
      event.messageId,
      { allowUnknownMessageRole: true },
    );
    if (!isTrackedSession(entry, event.sessionId)) return;
    entry.deltaFlushBuffer.push({
      sessionId: event.sessionId,
      messageId: event.messageId,
      partId: event.chunk.id,
      reasoning: event.chunk.type === "reasoning-delta",
      delta: event.chunk.delta,
    });
    scheduleDeltaFlush(entry, workspaceId);
    return;
  }

  if (event.type === "session.idle") {
    const runStartedAt = takeTaskRunStart(event.sessionId);
    if (runStartedAt !== null) {
      captureAnalyticsEvent("task_run_completed", { duration_ms: Date.now() - runStartedAt });
      trackTaskCompleted(event.sessionId, Date.now() - runStartedAt);
      notifyDesktopEvent({ type: "task.completed", sessionId: event.sessionId });
    }
    useSessionActivityStore.getState().setRunStatus(workspaceId, event.sessionId, idleStatus);
    const tracked = isTrackedSession(entry, event.sessionId);
    if (tracked) queryClient.setQueryData(statusKey(workspaceId, event.sessionId), idleStatus);
    for (const listener of entry.sessionStatusListeners) listener({ sessionId: event.sessionId, status: idleStatus });
    if (tracked) releaseRetainedSessionSoon(input, entry, event.sessionId);
  }
}

function scheduleDeltaFlush(entry: SyncEntry, workspaceId: string) {
  if (entry.deltaFlushScheduled) return;
  entry.deltaFlushScheduled = true;
  const run = () => {
    entry.deltaFlushScheduled = false;
    if (entry.deltaFlushBuffer.length === 0) return;
    flushDeltas(entry, workspaceId);
  };
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function" &&
    (typeof document === "undefined" || document.visibilityState === "visible")
  ) {
    window.requestAnimationFrame(run);
  } else if (typeof window !== "undefined") {
    window.setTimeout(run, 50);
  } else {
    queueMicrotask(run);
  }
}

function flushDeltas(entry: SyncEntry, workspaceId: string) {
  const queryClient = getReactQueryClient();
  const pending = coalescePendingDeltas(entry.deltaFlushBuffer);
  entry.deltaFlushBuffer = [];

  // Group by session id so each transcript cache is touched at most once
  // per flush.
  const bySession = new Map<string, PendingDelta[]>();
  for (const item of pending) {
    const bucket = bySession.get(item.sessionId);
    if (bucket) bucket.push(item);
    else bySession.set(item.sessionId, [item]);
  }

  for (const [sessionId, items] of bySession) {
    queryClient.setQueryData<UIMessage[]>(
      transcriptKey(workspaceId, sessionId),
      (current = []) => {
        let next = current;
        const nextById = new Map(next.map((message) => [message.id, message]));
        // Track which message shells we've ensured exist this flush so we
        // don't call upsertMessage for the same message on every delta.
        const ensuredMessageIds = new Set<string>();
        for (const item of items) {
          if (!ensuredMessageIds.has(item.messageId)) {
            // Preserve the existing role if the message is already in
            // state; otherwise infer it from the alternation pattern
            // so the brief "stub before message.updated" window doesn't
            // mislabel the message's bubble style.
            const existing = nextById.get(item.messageId);
            const role = existing?.role ?? inferStubRole(next);
            const ensuredMessage = { id: item.messageId, role, parts: existing?.parts ?? [] };
            next = upsertMessage(next, ensuredMessage);
            nextById.set(item.messageId, ensuredMessage);
            ensuredMessageIds.add(item.messageId);
          }
          // Resolve the final part kind from the declared transcript part.
          // Engines may stream a chunk before its part declaration, so hold
          // early chunks until the matching part exists.
          const ownerMessage = nextById.get(item.messageId);
          const ownerPartsById = new Map(
            (ownerMessage?.parts ?? []).flatMap((part) => {
              const id = part.type === "dynamic-tool" ? part.toolCallId : getPartMetadataId(part);
              return id ? [[id, part] as const] : [];
            }),
          );
          const ownerPart = ownerPartsById.get(item.partId);

          if (!ownerPart) {
            const existing = entry.pendingDeltas.get(item.partId) ?? {
              messageId: item.messageId,
              reasoning: item.reasoning,
              text: "",
            };
            existing.text += item.delta;
            entry.pendingDeltas.set(item.partId, existing);
            continue;
          }

          const reasoning = ownerPart.type === "reasoning";
          next = appendDelta(next, item.messageId, item.partId, item.delta, reasoning);
        }
        return next;
      },
    );
  }
}

function startSync(input: SyncOptions) {
  const controller = new AbortController();
  const entry = syncs.get(syncKey(input));
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let activeConnectionController: AbortController | null = null;
  let lastEventAt = Date.now();
  let retryDelayMs = 1_000;
  const staleStreamMs = 30_000;

  const scheduleRetry = () => {
    if (disposed || controller.signal.aborted || retryTimer) return;
    activeConnectionController = null;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, 10_000);
  };

  const connect = async () => {
    const connectionController = new AbortController();
    activeConnectionController = connectionController;
    try {
      retryDelayMs = 1_000;
      lastEventAt = Date.now();
      await input.connection.subscribe({
        signal: connectionController.signal,
        onEvent: (event) => {
          if (controller.signal.aborted || connectionController.signal.aborted || !entry) return;
          lastEventAt = Date.now();
          applyEvent(entry, input.workspaceId, event);
        },
      });
      if (!controller.signal.aborted && activeConnectionController === connectionController) scheduleRetry();
    } catch (error) {
      if (
        !controller.signal.aborted &&
        (connectionController.signal.aborted || shouldRetrySyncSubscribe(error))
      ) {
        scheduleRetry();
      }
    } finally {
      if (activeConnectionController === connectionController) activeConnectionController = null;
    }
  };

  void connect();
  watchdogTimer = setInterval(() => {
    if (disposed || controller.signal.aborted || retryTimer) return;
    const active = activeConnectionController;
    if (!active || active.signal.aborted) return;
    if (Date.now() - lastEventAt < staleStreamMs) return;
    active.abort();
    scheduleRetry();
  }, 10_000);

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    activeConnectionController?.abort();
    controller.abort();
  };
}

export function ensureWorkspaceSessionSync(input: SyncOptions) {
  const key = syncKey(input);
  const existing = syncs.get(key);
  if (existing) {
    if (existing.disposeTimer) {
      clearTimeout(existing.disposeTimer);
      existing.disposeTimer = null;
    }
    if (input.onSessionUpdated) existing.sessionUpdatedListeners.add(input.onSessionUpdated);
    if (input.onSessionStatus) existing.sessionStatusListeners.add(input.onSessionStatus);
    if (input.onSessionError) existing.sessionErrorListeners.add(input.onSessionError);
    existing.refs += 1;
    return () => releaseWorkspaceSessionSync(input);
  }

  syncs.set(key, {
    input,
    refs: 1,
    dispose: () => {},
    disposeTimer: null,
    trackedSessionRefs: new Map(),
    retainedSessionTimers: new Map(),
    sessionUpdatedListeners: new Set(input.onSessionUpdated ? [input.onSessionUpdated] : []),
    sessionStatusListeners: new Set(input.onSessionStatus ? [input.onSessionStatus] : []),
    sessionErrorListeners: new Set(input.onSessionError ? [input.onSessionError] : []),
    pendingDeltas: new Map(),
    deltaFlushBuffer: [],
    deltaFlushScheduled: false,
  });

  const created = syncs.get(key)!;
  created.dispose = startSync(input);

  return () => releaseWorkspaceSessionSync(input);
}

function releaseWorkspaceSessionSync(input: SyncScope & Pick<SyncOptions, "onSessionUpdated" | "onSessionStatus" | "onSessionError">) {
  const key = syncKey(input);
  const existing = syncs.get(key);
  if (!existing) return;
  if (input.onSessionUpdated) existing.sessionUpdatedListeners.delete(input.onSessionUpdated);
  if (input.onSessionStatus) existing.sessionStatusListeners.delete(input.onSessionStatus);
  if (input.onSessionError) existing.sessionErrorListeners.delete(input.onSessionError);
  existing.refs -= 1;
  if (existing.refs > 0) return;
  if (existing.retainedSessionTimers.size === 0) {
    disposeWorkspaceSync(key, existing);
  }
}

export function seedSessionState(workspaceId: string, snapshot: ConversationSnapshot) {
  const queryClient = getReactQueryClient();
  const key = transcriptKey(workspaceId, snapshot.session.id);
  const incoming = snapshot.messages;
  const existing = queryClient.getQueryData<UIMessage[]>(key);
  const preserveOptimisticBusy = snapshot.status.type === "idle"
    && existing?.some(isOptimisticUserMessage) === true;

  if (!preserveOptimisticBusy) {
    useSessionActivityStore.getState().seedSessionRun(
      workspaceId,
      snapshot.session.id,
      snapshot.status,
      assistantOutputAfterLatestUser(incoming),
    );
  }

  // The snapshot's revert cursor is authoritative: messages at/after it are
  // reverted server-side, so the cache must not keep them alive (a later
  // merge would resurrect them once the server deletes them on next prompt).
  queryClient.setQueryData(key, applyRevertCursor(
    reconcileTranscriptMessages({
      currentMessages: existing ?? [],
      snapshotMessages: incoming,
      reason: "snapshot",
    }),
    snapshot.session.revertMessageId ?? null,
  ));

  if (!preserveOptimisticBusy) {
    queryClient.setQueryData(statusKey(workspaceId, snapshot.session.id), snapshot.status);
  }
  queryClient.setQueryData(todoKey(workspaceId, snapshot.session.id), snapshot.todos);
}

/**
 * Apply a server-confirmed revert to the local session caches.
 *
 * The revert cursor only reaches the renderer through the snapshot cache, so
 * after a successful revert this stamps the returned cursor
 * cursor into the cached snapshot, truncates the live transcript cache, and
 * refetches the snapshot to pick up the server's post-revert truth. Without
 * this the UI keeps rendering the old transcript until a full reload.
 */
export function applySessionRevert(workspaceId: string, session: ConversationSession) {
  const queryClient = getReactQueryClient();
  const revertMessageId = session.revertMessageId ?? null;

  queryClient.setQueryData<ConversationSnapshot>(
    snapshotKey(workspaceId, session.id),
    (current) => (current
      ? { ...current, session: { ...current.session, revertMessageId: session.revertMessageId } }
      : current),
  );
  queryClient.setQueryData<UIMessage[]>(
    transcriptKey(workspaceId, session.id),
    (current = []) => applyRevertCursor(current, revertMessageId),
  );
  void queryClient.invalidateQueries({ queryKey: snapshotKey(workspaceId, session.id) });
}

export function trackWorkspaceSessionSync(input: SyncScope, sessionId: string | null | undefined) {
  const normalizedSessionId = sessionId?.trim() ?? "";
  if (!normalizedSessionId) return () => {};

  const entry = syncs.get(syncKey(input));
  if (!entry) return () => {};

  const retainedTimer = entry.retainedSessionTimers.get(normalizedSessionId);
  if (retainedTimer) {
    clearTimeout(retainedTimer);
    entry.retainedSessionTimers.delete(normalizedSessionId);
  }

  entry.trackedSessionRefs.set(
    normalizedSessionId,
    (entry.trackedSessionRefs.get(normalizedSessionId) ?? 0) + 1,
  );

  return () => {
    const current = entry.trackedSessionRefs.get(normalizedSessionId) ?? 0;
    if (current <= 1) {
      entry.trackedSessionRefs.delete(normalizedSessionId);
      retainSession(input, entry, normalizedSessionId);
      return;
    }
    entry.trackedSessionRefs.set(normalizedSessionId, current - 1);
  };
}

export function trackWorkspaceSessionsSync(input: SyncScope, sessionIds: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const releases = sessionIds.flatMap((sessionId) => {
    const id = sessionId?.trim() ?? "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [trackWorkspaceSessionSync(input, id)];
  });
  return () => {
    for (const release of releases) release();
  };
}

export function __createWorkspaceSessionSyncForTest(input: SyncScope) {
  const key = syncKey(input);
  syncs.set(key, {
    input,
    refs: 1,
    dispose: () => {},
    disposeTimer: null,
    trackedSessionRefs: new Map(),
    retainedSessionTimers: new Map(),
    sessionUpdatedListeners: new Set(),
    sessionStatusListeners: new Set(),
    sessionErrorListeners: new Set(),
    pendingDeltas: new Map(),
    deltaFlushBuffer: [],
    deltaFlushScheduled: false,
  });
  return () => {
    const entry = syncs.get(key);
    if (entry) {
      for (const timer of entry.retainedSessionTimers.values()) clearTimeout(timer);
    }
    syncs.delete(key);
  };
}

export function __hasWorkspaceSessionSyncForTest(input: SyncScope) {
  return syncs.has(syncKey(input));
}

export function __disposeWorkspaceSessionSyncForTest(input: SyncScope) {
  const key = syncKey(input);
  const entry = syncs.get(key);
  if (!entry) return;
  entry.refs = 0;
  disposeWorkspaceSync(key, entry);
}

export function __applySessionSyncEventForTest(input: SyncScope, event: ConversationEvent) {
  const entry = syncs.get(syncKey(input));
  if (!entry) return;
  applyEvent(entry, input.workspaceId, event);
}
