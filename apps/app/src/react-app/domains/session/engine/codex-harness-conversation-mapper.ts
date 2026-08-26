import type { DynamicToolUIPart, UIMessage } from "ai";

import type { WorkspaceEngineEvent } from "@/app/lib/workspace-engine-rpc-client";
import type {
  ConversationEvent,
  ConversationPermission,
  ConversationQuestion,
  ConversationSnapshot,
} from "./conversation-engine";
import { conversationMessageMetadata } from "./conversation-engine";
import { mapOpenCodeConversationSnapshot } from "./opencode-conversation-mapper";

type CodexLiveState = {
  itemsByTurn: Map<string, Set<string>>;
  itemKinds: Map<string, string>;
  itemTurnKeys: Map<string, string>;
  visibleResultTurns: Set<string>;
};

export function createCodexLiveState(): CodexLiveState {
  return {
    itemsByTurn: new Map(),
    itemKinds: new Map(),
    itemTurnKeys: new Map(),
    visibleResultTurns: new Set(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function commandValue(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (!Array.isArray(value)) return null;
  const command = value.filter((entry): entry is string => typeof entry === "string").join(" ");
  return command || null;
}

function timestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function itemContentText(item: Record<string, unknown>): string {
  const direct = stringValue(item.text);
  if (direct !== null) return direct;
  if (!Array.isArray(item.content)) return "";
  return item.content.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    return isRecord(entry) && typeof entry.text === "string" ? [entry.text] : [];
  }).join("\n");
}

function dataUrlMediaType(url: string): string | null {
  return /^data:([^;,]+)[;,]/u.exec(url)?.[1] ?? null;
}

function explicitMediaType(entry: Record<string, unknown>): string | null {
  const source = isRecord(entry.source) ? entry.source : {};
  return stringValue(entry.mediaType)
    ?? stringValue(entry.media_type)
    ?? stringValue(entry.mimeType)
    ?? stringValue(entry.mime_type)
    ?? stringValue(source.mediaType)
    ?? stringValue(source.media_type);
}

function urlLooksLikeImage(url: string): boolean {
  const dataMedia = dataUrlMediaType(url);
  if (dataMedia) return dataMedia.startsWith("image/");
  const path = url.split(/[?#]/u)[0]?.toLowerCase() ?? "";
  return path.endsWith(".jpg")
    || path.endsWith(".jpeg")
    || path.endsWith(".png")
    || path.endsWith(".gif")
    || path.endsWith(".webp");
}

function contentEntryLooksImage(entry: Record<string, unknown>, url: string): boolean {
  const type = stringValue(entry.type);
  return type === "image"
    || type === "image_url"
    || type === "input_image"
    || explicitMediaType(entry)?.startsWith("image/") === true
    || urlLooksLikeImage(url);
}

function sourceImageUrl(source: unknown): string | null {
  if (!isRecord(source) || source.type !== "base64") return null;
  const data = stringValue(source.data);
  const mediaType = stringValue(source.media_type) ?? stringValue(source.mediaType);
  return data && mediaType?.startsWith("image/") === true ? `data:${mediaType};base64,${data}` : null;
}

function imageUrl(entry: Record<string, unknown>): string | null {
  const directImageUrl = stringValue(entry.image_url);
  if (directImageUrl) return directImageUrl;
  if (isRecord(entry.image_url)) {
    const nested = stringValue(entry.image_url.url);
    if (nested) return nested;
  }
  const directUrl = stringValue(entry.url);
  if (directUrl && contentEntryLooksImage(entry, directUrl)) return directUrl;
  return sourceImageUrl(entry.source);
}

function imageMediaType(entry: Record<string, unknown>, url: string): string {
  const explicit = explicitMediaType(entry);
  if (explicit) return explicit;
  const dataMedia = dataUrlMediaType(url);
  if (dataMedia) return dataMedia;
  const path = url.split(/[?#]/u)[0]?.toLowerCase() ?? "";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/*";
}

function userMessageParts(item: Record<string, unknown>): UIMessage["parts"] {
  const content = Array.isArray(item.content) ? item.content : [];
  const text = content
    .flatMap((entry) => isRecord(entry) && entry.type === "text" && typeof entry.text === "string" ? [entry.text] : [])
    .join("\n");
  const textParts: UIMessage["parts"] = text ? [{ type: "text", text, state: "done" }] : [];
  const fileParts = content.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = imageUrl(entry);
    if (!url) return [];
    const filename = stringValue(entry.filename) ?? stringValue(entry.name);
    return [{
      type: "file" as const,
      url,
      mediaType: imageMediaType(entry, url),
      ...(filename ? { filename } : {}),
    }];
  });
  return [...textParts, ...fileParts];
}

function toolPart(item: Record<string, unknown>, completed: boolean): DynamicToolUIPart | null {
  const id = stringValue(item.id);
  if (!id) return null;
  const type = stringValue(item.type);
  const toolName = type === "commandExecution"
    ? "bash"
    : type === "fileChange"
      ? "apply_patch"
      : type === "mcpToolCall" || type === "dynamicToolCall"
        ? `${stringValue(item.server) ?? stringValue(item.namespace) ?? "tool"}.${stringValue(item.tool) ?? "call"}`
        : null;
  if (!toolName) return null;
  const input = type === "commandExecution"
    ? { command: stringValue(item.command) ?? "", cwd: stringValue(item.cwd) ?? undefined }
    : type === "fileChange"
      ? { changes: item.changes ?? [] }
      : item.arguments ?? {};
  const shared = {
    type: "dynamic-tool" as const,
    toolName,
    toolCallId: id,
    input,
    callProviderMetadata: { ipollowork: { partId: id } },
  };
  if (!completed) return { ...shared, state: "input-streaming" };
  const failed = item.status === "failed" || Boolean(item.error);
  return failed
    ? { ...shared, state: "output-error", errorText: String(item.error ?? item.aggregatedOutput ?? "Tool failed") }
    : { ...shared, state: "output-available", output: item.result ?? item.aggregatedOutput ?? item.contentItems ?? item.changes ?? "Completed" };
}

function messageForItem(
  threadId: string,
  item: Record<string, unknown>,
  completed: boolean,
  at: number,
): UIMessage | null {
  const id = stringValue(item.id);
  const type = stringValue(item.type);
  if (!id || !type) return null;
  const messageId = type === "userMessage" ? stringValue(item.clientId) ?? id : id;
  const metadata = conversationMessageMetadata(
    completed ? { created: at, completed: at } : { created: at },
    { codexItemType: type },
  );
  if (type === "userMessage") {
    return { id: messageId, role: "user", metadata, parts: userMessageParts(item) };
  }
  if (type === "agentMessage" || type === "plan") {
    return {
      id,
      role: "assistant",
      metadata,
      parts: [{
        type: "text",
        text: itemContentText(item),
        state: completed ? "done" : "streaming",
        providerMetadata: { ipollowork: { partId: `${id}:text` } },
      }],
    };
  }
  if (type === "reasoning") {
    const text = [
      ...(Array.isArray(item.summary) ? item.summary.filter((part): part is string => typeof part === "string") : []),
      ...(Array.isArray(item.content) ? item.content.flatMap((part) => (
        typeof part === "string" ? [part] : isRecord(part) && typeof part.text === "string" ? [part.text] : []
      )) : []),
    ].join("\n");
    return {
      id,
      role: "assistant",
      metadata,
      parts: [{
        type: "reasoning",
        text,
        state: completed ? "done" : "streaming",
        providerMetadata: { ipollowork: { partId: `${id}:reasoning` } },
      }],
    };
  }
  const tool = toolPart(item, completed);
  return tool ? { id, role: "assistant", metadata, parts: [tool] } : null;
}

function requestEvent(event: WorkspaceEngineEvent): ConversationEvent | null {
  if (event.type !== "request" || (typeof event.id !== "string" && typeof event.id !== "number")) return null;
  const method = stringValue(event.method);
  const params = isRecord(event.params) ? event.params : null;
  const threadId = params && (stringValue(params.threadId) ?? stringValue(params.conversationId));
  if (!method || !params || !threadId) return null;
  const id = String(event.id);
  const native = { rpcId: event.id, method, params };
  if (method === "item/tool/requestUserInput" && Array.isArray(params.questions)) {
    const question: ConversationQuestion = {
      id,
      sessionId: threadId,
      receivedAt: Date.now(),
      native,
      questions: params.questions.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.question !== "string") return [];
        return [{
          header: stringValue(entry.header) ?? undefined,
          question: entry.question,
          options: Array.isArray(entry.options)
            ? entry.options.flatMap((option) => isRecord(option) && typeof option.label === "string"
              ? [{ label: option.label, description: stringValue(option.description) ?? undefined }]
              : [])
            : [],
          multiple: false,
          custom: entry.isOther === true,
        }];
      }),
    };
    return { type: "question.asked", question };
  }
  if (!method.endsWith("requestApproval") && method !== "applyPatchApproval" && method !== "execCommandApproval") return null;
  const command = commandValue(params.command);
  const kind = method.includes("fileChange") || method === "applyPatchApproval"
    ? "edit"
    : method === "item/permissions/requestApproval"
      ? "permissions"
      : "shell";
  const permission: ConversationPermission = {
    id,
    sessionId: threadId,
    kind,
    resources: [command, stringValue(params.cwd), stringValue(params.grantRoot)].filter((value): value is string => Boolean(value)),
    remember: ["always"],
    metadata: {
      ...(command ? { command } : {}),
      ...(stringValue(params.cwd) ? { cwd: stringValue(params.cwd) } : {}),
      ...(stringValue(params.reason) ? { reason: stringValue(params.reason) } : {}),
    },
    receivedAt: timestamp(params.startedAtMs),
    native,
  };
  return { type: "permission.asked", permission };
}

export function mapCodexHarnessEvent(
  event: WorkspaceEngineEvent,
  state: CodexLiveState,
): ConversationEvent[] {
  const request = requestEvent(event);
  if (request) return [request];
  if (event.type !== "notification") return [];
  const method = stringValue(event.method);
  const params = isRecord(event.params) ? event.params : null;
  if (!method || !params) return [];
  const threadId = stringValue(params.threadId);
  if (method === "thread/started" && isRecord(params.thread) && typeof params.thread.id === "string") {
    const thread = params.thread;
    const startedThreadId = thread.id as string;
    return [{
      type: "session.updated",
      sessionId: startedThreadId,
      info: {
        id: startedThreadId,
        title: stringValue(thread.name) ?? stringValue(thread.preview) ?? "New conversation",
        directory: stringValue(thread.cwd),
      },
    }];
  }
  if (method === "thread/name/updated" && threadId) {
    return [{
      type: "session.updated",
      sessionId: threadId,
      info: { id: threadId, title: stringValue(params.threadName) ?? "New conversation" },
    }];
  }
  if ((method === "thread/deleted" || method === "thread/archived") && threadId) {
    return [{ type: "session.deleted", sessionId: threadId }];
  }
  if (method === "turn/started" && threadId && isRecord(params.turn)) {
    const turnId = stringValue(params.turn.id);
    if (turnId) {
      const turnKey = `${threadId}:${turnId}`;
      state.itemsByTurn.set(turnKey, new Set());
      state.visibleResultTurns.delete(turnKey);
    }
    return [{ type: "session.status", sessionId: threadId, status: { type: "busy" } }];
  }
  if (method === "turn/completed" && threadId && isRecord(params.turn)) {
    const turn = params.turn;
    const turnId = stringValue(turn.id);
    const turnKey = turnId ? `${threadId}:${turnId}` : null;
    const hasVisibleResult = turnKey ? state.visibleResultTurns.has(turnKey) : false;
    const completedAt = typeof turn.completedAt === "number" ? turn.completedAt * 1_000 : Date.now();
    const completed = turnId
      ? [...(state.itemsByTurn.get(`${threadId}:${turnId}`) ?? [])].map((messageId): ConversationEvent => ({
          type: "message.completed",
          sessionId: threadId,
          messageId,
          completedAt,
        }))
      : [];
    if (turnKey) {
      for (const messageId of state.itemsByTurn.get(turnKey) ?? []) state.itemTurnKeys.delete(messageId);
      state.itemsByTurn.delete(turnKey);
      state.visibleResultTurns.delete(turnKey);
    }
    if (turn.status === "failed") {
      const error = isRecord(turn.error) ? stringValue(turn.error.message) : null;
      completed.push({ type: "session.error", sessionId: threadId, errorText: error ?? "Codex turn failed" });
    } else if (turn.status === "completed" && !hasVisibleResult) {
      completed.push({
        type: "session.error",
        sessionId: threadId,
        errorText: "Codex 已结束处理，但没有返回最终结果。请重试这条需求。",
      });
    }
    completed.push({ type: "session.idle", sessionId: threadId });
    return completed;
  }
  if ((method === "item/started" || method === "item/completed") && threadId && isRecord(params.item)) {
    const item = params.item;
    const id = stringValue(item.id);
    const turnId = stringValue(params.turnId);
    const turnKey = turnId ? `${threadId}:${turnId}` : null;
    const at = timestamp(method === "item/completed" ? params.completedAtMs : params.startedAtMs);
    const message = messageForItem(threadId, item, method === "item/completed", at);
    if (!id) return [];
    state.itemKinds.set(id, stringValue(item.type) ?? "");
    if (turnKey) state.itemTurnKeys.set(id, turnKey);
    if (turnKey && (item.type === "agentMessage" || item.type === "plan") && itemContentText(item).trim()) {
      state.visibleResultTurns.add(turnKey);
    }
    if (turnKey && item.type !== "userMessage") {
      const items = state.itemsByTurn.get(turnKey) ?? new Set<string>();
      items.add(id);
      state.itemsByTurn.set(turnKey, items);
    }
    if (!message) return [];
    if (
      method === "item/completed"
      && (item.type === "agentMessage" || item.type === "plan")
      && !itemContentText(item).trim()
      && turnKey
      && state.visibleResultTurns.has(turnKey)
    ) return [];
    return [{ type: "message.upsert", sessionId: threadId, message }];
  }
  if (threadId && typeof params.itemId === "string" && typeof params.delta === "string") {
    const reasoning = method.includes("reasoning");
    if (method === "item/agentMessage/delta" || reasoning) {
      if (method === "item/agentMessage/delta" && params.delta.trim()) {
        const turnKey = typeof params.turnId === "string"
          ? `${threadId}:${params.turnId}`
          : state.itemTurnKeys.get(params.itemId);
        if (turnKey) state.visibleResultTurns.add(turnKey);
      }
      return [{
        type: "message.chunk",
        sessionId: threadId,
        messageId: params.itemId,
        chunk: {
          type: reasoning ? "reasoning-delta" : "text-delta",
          id: `${params.itemId}:${reasoning ? "reasoning" : "text"}`,
          delta: params.delta,
        },
      }];
    }
  }
  if (method === "error" && threadId) {
    const error = isRecord(params.error) ? params.error : null;
    return [{
      type: "session.error",
      sessionId: threadId,
      errorText: stringValue(error?.message) ?? stringValue(params.message) ?? "Codex runtime error",
    }];
  }
  return [];
}

export function mapCodexHarnessSnapshot(snapshot: unknown): ConversationSnapshot {
  return mapOpenCodeConversationSnapshot(snapshot);
}

export function codexNativeRequest(native: unknown): { rpcId: string | number; method: string; params: Record<string, unknown> } | null {
  if (!isRecord(native) || (typeof native.rpcId !== "string" && typeof native.rpcId !== "number")) return null;
  if (typeof native.method !== "string" || !isRecord(native.params)) return null;
  return { rpcId: native.rpcId, method: native.method, params: native.params };
}
