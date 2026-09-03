import type { UIMessage } from "ai";
import type {
  Part,
  PermissionRequest,
  PermissionV2Request,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client";

import type { iPolloWorkSessionSnapshot } from "@/app/lib/ipollowork-server";
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX, type TodoItem } from "@/app/types";
import { normalizeEvent } from "@/app/utils";
import type {
  ConversationEvent,
  ConversationPermission,
  ConversationQuestion,
  ConversationSession,
  ConversationSnapshot,
  ConversationStatus,
} from "./conversation-engine";
import {
  conversationContextUsageFromTokens,
  conversationMessageContextUsage,
  conversationMessageMetadata,
} from "./conversation-engine";
import {
  describeOpencodeSessionError,
  mapOpencodePartToUIParts,
  opencodePartHasVisibleAssistantOutput,
  snapshotToUIMessages,
} from "./opencode-message-adapter";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mapOpenCodeSession(session: Session): ConversationSession {
  return {
    ...session,
    id: session.id,
    title: session.title ?? "",
    slug: session.slug,
    parentID: session.parentID,
    directory: session.directory,
    time: session.time,
    revertMessageId: session.revert?.messageID ?? null,
  };
}

function mapStatus(status: SessionStatus): ConversationStatus {
  if (status.type === "retry") {
    return {
      type: "retry",
      attempt: status.attempt,
      message: status.message,
      next: status.next,
    };
  }
  return { type: status.type };
}

function mapTodos(sessionId: string, todos: Todo[]): TodoItem[] {
  return todos.map((todo, index) => ({
    id: `${sessionId}:${index}:${todo.content}`,
    content: todo.content,
    status: todo.status,
    priority: todo.priority,
  }));
}

function v2PermissionKind(action: string): string {
  if (action === "external_directory" || action.endsWith(".external_directory")) return "external_directory";
  if (action === "file.read") return "read";
  if (action === "file.edit" || action === "file.write") return "edit";
  return action;
}

export function mapOpenCodeLegacyPermission(
  permission: PermissionRequest,
  receivedAt: number,
): ConversationPermission {
  return {
    id: permission.id,
    sessionId: permission.sessionID,
    kind: permission.permission,
    resources: permission.patterns,
    remember: Array.isArray(permission.always)
      ? permission.always.filter((value): value is string => typeof value === "string")
      : [],
    metadata: permission.metadata ?? {},
    receivedAt,
    native: permission,
  };
}

export function mapOpenCodeV2Permission(
  permission: PermissionV2Request,
  receivedAt: number,
): ConversationPermission {
  const metadata: Record<string, unknown> = {
    ...(permission.metadata ?? {}),
    action: permission.action,
  };
  if (permission.save?.length) metadata.save = permission.save.join(", ");
  if (permission.source) metadata.tool = {
    messageID: permission.source.messageID,
    callID: permission.source.callID,
  };
  return {
    id: permission.id,
    sessionId: permission.sessionID,
    kind: v2PermissionKind(permission.action),
    resources: permission.resources,
    remember: permission.save ?? [],
    metadata,
    receivedAt,
    native: permission,
  };
}

export function isOpenCodeV2Permission(value: unknown): value is PermissionV2Request {
  return isRecord(value) && typeof value.action === "string" && Array.isArray(value.resources);
}

export function mapOpenCodeQuestion(
  question: QuestionRequest,
  receivedAt: number,
): ConversationQuestion {
  return {
    id: question.id,
    sessionId: question.sessionID,
    questions: question.questions.map((item) => ({
      header: item.header,
      question: item.question,
      options: item.options.map((option) => ({
        label: option.label,
        description: option.description,
      })),
      multiple: item.multiple,
      custom: item.custom,
    })),
    receivedAt,
    native: question,
  };
}

function messageFromInfo(info: {
  id: string;
  role: UIMessage["role"];
  time?: { created?: number; completed?: number };
  tokens?: unknown;
  parentUserMessageId?: string;
}): UIMessage {
  const created = info.time?.created;
  const completed = info.time?.completed;
  const contextUsage = info.role === "assistant"
    ? conversationContextUsageFromTokens(info.tokens)
    : undefined;
  const metadata = conversationMessageMetadata(
    { created, completed },
    {
      ...(contextUsage ? { contextUsage } : {}),
      ...(info.parentUserMessageId ? { parentUserMessageId: info.parentUserMessageId } : {}),
    },
  );
  return {
    id: info.id,
    role: info.role,
    ...(metadata ? { metadata } : {}),
    parts: [],
  };
}

export type OpenCodeConversationLiveState = {
  parentUserMessageIds: Map<string, string>;
  messageRoles: Map<string, UIMessage["role"]>;
  latestUserMessageIds: Map<string, string>;
};

export function createOpenCodeConversationLiveState(): OpenCodeConversationLiveState {
  return {
    parentUserMessageIds: new Map(),
    messageRoles: new Map(),
    latestUserMessageIds: new Map(),
  };
}

function sessionIdFromProperties(properties: unknown) {
  if (!isRecord(properties)) return "";
  return typeof properties.sessionID === "string" ? properties.sessionID : "";
}

export function mapOpenCodeConversationEvent(
  raw: unknown,
  state?: OpenCodeConversationLiveState,
): ConversationEvent | null {
  const event = normalizeEvent(raw);
  if (!event) return null;
  const properties = event.properties;

  if (event.type === "session.updated") {
    if (!isRecord(properties) || !isRecord(properties.info)) return null;
    const info = properties.info as unknown as Session;
    const sessionId = typeof properties.sessionID === "string" ? properties.sessionID : info.id;
    return sessionId ? { type: "session.updated", sessionId, info: mapOpenCodeSession(info) } : null;
  }

  if (event.type === "session.deleted") {
    if (!isRecord(properties)) return null;
    const info = isRecord(properties.info) ? properties.info : null;
    const sessionId = typeof properties.sessionID === "string"
      ? properties.sessionID
      : typeof info?.id === "string"
        ? info.id
        : "";
    return sessionId ? { type: "session.deleted", sessionId } : null;
  }

  if (event.type === "session.error") {
    const sessionId = sessionIdFromProperties(properties);
    if (!sessionId) return null;
    return {
      type: "session.error",
      sessionId,
      errorText: describeOpencodeSessionError(isRecord(properties) ? properties.error : undefined),
      ...(state?.latestUserMessageIds.get(sessionId)
        ? { parentUserMessageId: state.latestUserMessageIds.get(sessionId) }
        : {}),
    };
  }

  if (event.type === "session.next.compaction.started") {
    const sessionId = sessionIdFromProperties(properties);
    return sessionId ? { type: "session.compaction", sessionId, running: true } : null;
  }

  if (event.type === "session.next.compaction.ended" || event.type === "session.compacted") {
    const sessionId = sessionIdFromProperties(properties);
    return sessionId ? { type: "session.compaction", sessionId, running: false } : null;
  }

  if (event.type === "session.status") {
    if (!isRecord(properties) || typeof properties.sessionID !== "string" || !isRecord(properties.status)) return null;
    return {
      type: "session.status",
      sessionId: properties.sessionID,
      status: mapStatus(properties.status as SessionStatus),
    };
  }

  if (event.type === "session.idle") {
    const sessionId = sessionIdFromProperties(properties);
    return sessionId ? { type: "session.idle", sessionId } : null;
  }

  if (event.type === "todo.updated") {
    if (!isRecord(properties) || typeof properties.sessionID !== "string" || !Array.isArray(properties.todos)) return null;
    return {
      type: "todo.updated",
      sessionId: properties.sessionID,
      todos: mapTodos(properties.sessionID, properties.todos as Todo[]),
    };
  }

  if (event.type === "permission.asked") {
    const permission = properties as PermissionRequest;
    if (!permission?.id || !permission.sessionID) return null;
    return { type: "permission.asked", permission: mapOpenCodeLegacyPermission(permission, Date.now()) };
  }

  if (event.type === "permission.v2.asked") {
    const permission = properties as PermissionV2Request;
    if (!permission?.id || !permission.sessionID) return null;
    return { type: "permission.asked", permission: mapOpenCodeV2Permission(permission, Date.now()) };
  }

  if (event.type === "permission.replied" || event.type === "permission.v2.replied") {
    if (!isRecord(properties) || typeof properties.sessionID !== "string" || typeof properties.requestID !== "string") return null;
    return { type: "permission.replied", sessionId: properties.sessionID, requestId: properties.requestID };
  }

  if (event.type === "question.asked") {
    const question = properties as QuestionRequest;
    if (!question?.id || !question.sessionID) return null;
    return { type: "question.asked", question: mapOpenCodeQuestion(question, Date.now()) };
  }

  if (event.type === "question.replied" || event.type === "question.rejected") {
    if (!isRecord(properties) || typeof properties.sessionID !== "string" || typeof properties.requestID !== "string") return null;
    return { type: "question.replied", sessionId: properties.sessionID, requestId: properties.requestID };
  }

  if (event.type === "message.updated") {
    if (!isRecord(properties) || !isRecord(properties.info)) return null;
    const info = properties.info;
    if (
      typeof info.id !== "string" ||
      typeof info.sessionID !== "string" ||
      (info.role !== "user" && info.role !== "assistant" && info.role !== "system")
    ) return null;
    const parentUserMessageId = info.role === "assistant" && typeof info.parentID === "string"
      ? info.parentID.trim()
      : "";
    state?.messageRoles.set(info.id, info.role);
    if (info.role === "user") state?.latestUserMessageIds.set(info.sessionID, info.id);
    if (parentUserMessageId) state?.parentUserMessageIds.set(info.id, parentUserMessageId);
    return {
      type: "message.upsert",
      sessionId: info.sessionID,
      message: messageFromInfo({
        id: info.id,
        role: info.role,
        time: isRecord(info.time)
          ? {
              created: typeof info.time.created === "number" ? info.time.created : undefined,
              completed: typeof info.time.completed === "number" ? info.time.completed : undefined,
            }
          : undefined,
        tokens: info.tokens,
        ...(parentUserMessageId ? { parentUserMessageId } : {}),
      }),
    };
  }

  if (event.type === "message.removed") {
    if (!isRecord(properties) || typeof properties.sessionID !== "string" || typeof properties.messageID !== "string") return null;
    state?.parentUserMessageIds.delete(properties.messageID);
    state?.messageRoles.delete(properties.messageID);
    if (state?.latestUserMessageIds.get(properties.sessionID) === properties.messageID) {
      state.latestUserMessageIds.delete(properties.sessionID);
    }
    return { type: "message.removed", sessionId: properties.sessionID, messageId: properties.messageID };
  }

  if (event.type === "message.part.updated") {
    if (!isRecord(properties) || !isRecord(properties.part)) return null;
    const part = properties.part as unknown as Part;
    if (!part.id || !part.sessionID || !part.messageID) return null;
    return {
      type: "message.parts",
      sessionId: part.sessionID,
      messageId: part.messageID,
      partId: part.id,
      parts: mapOpencodePartToUIParts(part),
      ...(state?.messageRoles.get(part.messageID) ? { messageRole: state.messageRoles.get(part.messageID) } : {}),
      ...(state?.parentUserMessageIds.get(part.messageID)
        ? { parentUserMessageId: state.parentUserMessageIds.get(part.messageID) }
        : {}),
      visibleAssistantOutput: opencodePartHasVisibleAssistantOutput(part),
    };
  }

  if (event.type === "message.part.delta") {
    if (
      !isRecord(properties) ||
      typeof properties.sessionID !== "string" ||
      typeof properties.messageID !== "string" ||
      typeof properties.partID !== "string" ||
      typeof properties.delta !== "string" ||
      !properties.delta
    ) return null;
    return {
      type: "message.chunk",
      sessionId: properties.sessionID,
      messageId: properties.messageID,
      ...(state?.parentUserMessageIds.get(properties.messageID)
        ? { parentUserMessageId: state.parentUserMessageIds.get(properties.messageID) }
        : {}),
      chunk: { type: "text-delta", id: properties.partID, delta: properties.delta },
    };
  }

  return null;
}

export function mapOpenCodeConversationSnapshot(snapshot: unknown): ConversationSnapshot {
  const source = snapshot as iPolloWorkSessionSnapshot;
  if (!source?.session?.id || !Array.isArray(source.messages) || !Array.isArray(source.todos)) {
    throw new Error("OpenCode returned an invalid session snapshot");
  }
  const messages = snapshotToUIMessages(source);
  const contextUsage = [...messages].reverse().flatMap((message) => (
    message.role === "assistant" ? conversationMessageContextUsage(message) ?? [] : []
  ))[0];
  return {
    session: mapOpenCodeSession(source.session),
    messages,
    todos: mapTodos(source.session.id, source.todos),
    status: mapStatus(source.status),
    ...(contextUsage ? { contextUsage } : {}),
  };
}

export function resolveOpenCodeForkBoundaryId(
  messages: UIMessage[],
  messageId: string | null,
): string | null {
  if (!messageId) return null;
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return null;
  for (let candidateIndex = index + 1; candidateIndex < messages.length; candidateIndex += 1) {
    const candidate = messages[candidateIndex];
    if (candidate && !candidate.id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX)) return candidate.id;
  }
  return null;
}
