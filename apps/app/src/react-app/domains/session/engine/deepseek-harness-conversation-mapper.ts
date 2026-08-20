import type { DynamicToolUIPart, UIMessage } from "ai";
import { DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX } from "@ipollowork/types/workspace";

import type { TodoItem } from "@/app/types";
import { t } from "@/i18n";
import type {
  ConversationEvent,
  ConversationPermission,
  ConversationQuestion,
  ConversationSession,
  ConversationSnapshot,
} from "./conversation-engine";
import {
  completeConversationMessage,
  conversationMessageMetadata,
} from "./conversation-engine";
import type { DeepSeekHarnessServerRequest } from "@/app/lib/deepseek-harness-client";

type DshEvent = {
  type: string;
  seq: number;
  time: number;
  data: unknown;
};

type DshHistory = {
  events: Array<{ event: DshEvent; view?: unknown }>;
  hasMore: boolean;
  projections?: { asOfSeq: number; values: Record<string, unknown> };
};

type DshSnapshot = {
  engineId: "deepseek-harness";
  session: ConversationSession & { dsh?: { running?: boolean } };
  history: DshHistory;
};

type ToolState = {
  messageId: string;
  toolName: string;
  input: unknown;
};

const LEGACY_SYSTEM_BLOCK = /^<system>\n[\s\S]*\n<\/system>$/u;
const INTERNAL_SESSION_TITLE = /^<system(?:>|\s)/iu;

export type DeepSeekHarnessLiveState = {
  parts: Set<string>;
  tools: Map<string, ToolState>;
  assistantMessageIdsByTurn?: Map<string, Set<string>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeToolInput(toolName: string, value: unknown): unknown {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return parsed;
  const fieldMappings: Partial<Record<string, Record<string, string>>> = {
    apply_patch: { patch_text: "patchText" },
    edit: { file_path: "filePath", new_string: "newString", old_string: "oldString", replace_all: "replaceAll" },
    read: { file_path: "filePath" },
    write: { file_path: "filePath" },
  };
  const mappings = fieldMappings[toolName];
  if (!mappings) return parsed;
  const normalized = { ...parsed };
  for (const [source, target] of Object.entries(mappings)) {
    if (!(target in normalized) && source in normalized) normalized[target] = normalized[source];
    delete normalized[source];
  }
  return normalized;
}

function assistantMessageId(sessionId: string, turn: number, step: number): string {
  return `dsh:${sessionId}:assistant:${turn}:${step}`;
}

function partId(messageId: string, index: number): string {
  return `${messageId}:block:${index}`;
}

function streamingPart(id: string, reasoning: boolean): UIMessage["parts"][number] {
  const providerMetadata = { ipollowork: { partId: id } };
  return reasoning
    ? { type: "reasoning", text: "", state: "streaming", providerMetadata }
    : { type: "text", text: "", state: "streaming", providerMetadata };
}

function metadata(event: DshEvent, extra: Record<string, unknown> = {}) {
  return conversationMessageMetadata({ created: event.time }, { dshSeq: event.seq, ...extra });
}

function turnKey(sessionId: string, turn: number): string {
  return `${sessionId}:${turn}`;
}

function rememberAssistantMessage(
  state: DeepSeekHarnessLiveState,
  sessionId: string,
  turn: number,
  messageId: string,
): void {
  state.assistantMessageIdsByTurn ??= new Map();
  const key = turnKey(sessionId, turn);
  const messageIds = state.assistantMessageIdsByTurn.get(key) ?? new Set<string>();
  messageIds.add(messageId);
  state.assistantMessageIdsByTurn.set(key, messageIds);
}

function takeAssistantMessagesForTurn(
  state: DeepSeekHarnessLiveState,
  sessionId: string,
  turn: number,
): string[] {
  const key = turnKey(sessionId, turn);
  const messageIds = [...(state.assistantMessageIdsByTurn?.get(key) ?? [])];
  state.assistantMessageIdsByTurn?.delete(key);
  return messageIds;
}

function textOutput(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const text = content.flatMap((block) => {
    if (!isRecord(block)) return [];
    if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") return [block.text];
    return [];
  }).join("\n");
  return text || content;
}

function mapBlocks(messageId: string, content: unknown): UIMessage["parts"] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block, index): UIMessage["parts"] => {
    if (!isRecord(block)) return [];
    const id = partId(messageId, index);
    if (block.type === "text" && typeof block.text === "string") {
      return [{
        type: "text",
        text: block.text,
        state: "done",
        providerMetadata: { ipollowork: { partId: id } },
      }];
    }
    if (block.type === "reasoning" && typeof block.text === "string") {
      return [{
        type: "reasoning",
        text: block.text,
        state: "done",
        providerMetadata: { ipollowork: { partId: id } },
      }];
    }
    if (block.type === "tool-call" && typeof block.id === "string" && typeof block.name === "string") {
      return [toolPart({
        callId: block.id,
        toolName: block.name,
        input: normalizeToolInput(block.name, block.arguments),
        state: "input-streaming",
      })];
    }
    if (block.type === "image") {
      return [{
        type: "text",
        text: "[Image attachment]",
        state: "done",
        providerMetadata: { ipollowork: { partId: id } },
      }];
    }
    return [];
  });
}

function isVisibleUserMessage(message: Record<string, unknown>): boolean {
  const source = isRecord(message.source) ? message.source : null;
  return !source || source.kind === "user";
}

function visibleUserContent(message: Record<string, unknown>): unknown {
  const content = message.content;
  if (!Array.isArray(content)) return content;
  return content.flatMap((block, index) => {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return [block];
    if (index === 0 && content.length > 1 && LEGACY_SYSTEM_BLOCK.test(block.text.trim())) return [];
    let text = block.text;
    let start = text.indexOf(DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX);
    while (start !== -1) {
      const end = text.indexOf("</system>", start + DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX.length);
      text = end === -1
        ? text.slice(0, start)
        : `${text.slice(0, start)}${text.slice(end + "</system>".length)}`;
      start = text.indexOf(DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX);
    }
    return text.trim() ? [{ ...block, text }] : [];
  });
}

function toolPart(input: {
  callId: string;
  toolName: string;
  input: unknown;
  state: "input-streaming" | "output-available" | "output-error";
  output?: unknown;
  errorText?: string;
}): DynamicToolUIPart {
  const shared = {
    type: "dynamic-tool" as const,
    toolName: input.toolName,
    toolCallId: input.callId,
    input: input.input,
    callProviderMetadata: { ipollowork: { partId: input.callId } },
  };
  if (input.state === "output-error") {
    return { ...shared, state: input.state, errorText: input.errorText || "Tool failed" };
  }
  if (input.state === "output-available") {
    return { ...shared, state: input.state, output: input.output };
  }
  return { ...shared, state: input.state };
}

function mapMessageEvent(sessionId: string, event: DshEvent): UIMessage | null {
  const data = isRecord(event.data) ? event.data : null;
  const message = data && isRecord(data.message)
    ? data.message
    : event.type === "user/message" && data
      ? data
      : null;
  if (!message || typeof message.id !== "string") return null;
  if (event.type === "user/message" && !isVisibleUserMessage(message)) return null;
  const declaredRole = message.role === "assistant"
    ? "assistant"
    : message.role === "system"
      ? "system"
      : "user";
  if (event.type === "assistant/message" || declaredRole === "assistant") {
    const turn = typeof data?.turn === "number" ? data.turn : 0;
    const step = typeof data?.step === "number" ? data.step : 0;
    const id = event.type === "assistant/message"
      ? assistantMessageId(sessionId, turn, step)
      : message.id;
    return {
      id,
      role: "assistant",
      metadata: metadata(event, { dshMessageId: message.id, dshTurn: turn, dshStep: step }),
      parts: mapBlocks(id, event.type === "user/message" ? visibleUserContent(message) : message.content),
    };
  }
  return {
    id: message.id,
    role: declaredRole,
    metadata: metadata(event),
    parts: mapBlocks(message.id, visibleUserContent(message)),
  };
}

function upsertMessage(messages: UIMessage[], message: UIMessage): void {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) messages.push(message);
  else messages[index] = message;
}

function upsertToolPart(message: UIMessage, part: DynamicToolUIPart): void {
  const index = message.parts.findIndex((item) => item.type === "dynamic-tool" && item.toolCallId === part.toolCallId);
  if (index === -1) message.parts.push(part);
  else message.parts[index] = part;
}

function messageForStep(messages: UIMessage[], sessionId: string, event: DshEvent, data: Record<string, unknown>) {
  const turn = typeof data.turn === "number" ? data.turn : 0;
  const step = typeof data.step === "number" ? data.step : 0;
  const id = assistantMessageId(sessionId, turn, step);
  let message = messages.find((item) => item.id === id);
  if (!message) {
    message = { id, role: "assistant", metadata: metadata(event, { dshTurn: turn, dshStep: step }), parts: [] };
    messages.push(message);
  }
  return message;
}

function applyChunk(message: UIMessage, chunk: Record<string, unknown>): void {
  const index = typeof chunk.index === "number" ? chunk.index : 0;
  const id = partId(message.id, index);
  if ((chunk.type !== "text-delta" && chunk.type !== "reasoning-delta") || typeof chunk.text !== "string") return;
  const type = chunk.type === "reasoning-delta" ? "reasoning" : "text";
  const existing = message.parts.find((part) =>
    part.type === type && isRecord(part.providerMetadata?.ipollowork) && part.providerMetadata.ipollowork.partId === id,
  );
  if (existing && (existing.type === "text" || existing.type === "reasoning")) {
    existing.text += chunk.text;
    existing.state = "streaming";
    return;
  }
  message.parts.push({
    type,
    text: chunk.text,
    state: "streaming",
    providerMetadata: { ipollowork: { partId: id } },
  });
}

function mapTodos(sessionId: string, value: unknown): TodoItem[] {
  const data = isRecord(value) ? value : null;
  if (!data || !Array.isArray(data.todos)) return [];
  return data.todos.flatMap((todo, index) => {
    if (!isRecord(todo) || typeof todo.content !== "string" || typeof todo.status !== "string") return [];
    return [{
      id: `${sessionId}:${index}:${todo.content}`,
      content: todo.content,
      status: todo.status,
      priority: "medium",
    }];
  });
}

function toolResultData(value: unknown) {
  if (!isRecord(value) || !isRecord(value.message) || !Array.isArray(value.message.content)) return null;
  const block = value.message.content.find((item) => isRecord(item) && item.type === "tool-result");
  if (!isRecord(block) || typeof block.toolCallId !== "string") return null;
  return {
    callId: block.toolCallId,
    output: textOutput(block.content),
    isError: block.isError === true || isRecord(value.error),
    errorText: isRecord(value.error) && typeof value.error.name === "string" ? value.error.name : undefined,
  };
}

export function mapDeepSeekHarnessSession(value: unknown): ConversationSession {
  const session = isRecord(value) ? value : {};
  return {
    ...session,
    id: typeof session.id === "string" ? session.id : "",
    title: typeof session.title === "string" ? session.title : "",
  } as ConversationSession;
}

export function mapDeepSeekHarnessSnapshot(snapshot: unknown): ConversationSnapshot {
  const source = snapshot as DshSnapshot;
  if (source?.engineId !== "deepseek-harness" || !source.session?.id || !Array.isArray(source.history?.events)) {
    throw new Error("DeepSeek Harness returned an invalid session snapshot");
  }
  const messages: UIMessage[] = [];
  const tools = new Map<string, ToolState>();
  const completedTurns = new Map<number, number>();
  let todos: TodoItem[] = [];
  for (const { event } of source.history.events) {
    if (event.type === "user/message" || event.type === "assistant/message") {
      const message = mapMessageEvent(source.session.id, event);
      if (message) upsertMessage(messages, message);
      continue;
    }
    const data = isRecord(event.data) ? event.data : null;
    if (!data) continue;
    if (event.type === "assistant/chunk" && isRecord(data.chunk)) {
      applyChunk(messageForStep(messages, source.session.id, event, data), data.chunk);
      continue;
    }
    if (event.type === "tool/call" && typeof data.callId === "string" && typeof data.name === "string") {
      const message = messageForStep(messages, source.session.id, event, data);
      const state = { messageId: message.id, toolName: data.name, input: normalizeToolInput(data.name, data.arguments) };
      tools.set(data.callId, state);
      upsertToolPart(message, toolPart({ callId: data.callId, toolName: state.toolName, input: state.input, state: "input-streaming" }));
      continue;
    }
    if (event.type === "tool/result") {
      const result = toolResultData(data);
      if (!result) continue;
      const state = tools.get(result.callId);
      if (!state) continue;
      const message = messages.find((item) => item.id === state.messageId);
      if (!message) continue;
      upsertToolPart(message, toolPart({
        callId: result.callId,
        toolName: state.toolName,
        input: state.input,
        state: result.isError ? "output-error" : "output-available",
        output: result.output,
        errorText: result.errorText,
      }));
      continue;
    }
    if (event.type === "todo/write") todos = mapTodos(source.session.id, data);
    if (event.type === "turn/end" && typeof data.turn === "number") completedTurns.set(data.turn, event.time);
  }
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const ipollowork = isRecord(message.metadata) && isRecord(message.metadata.ipollowork)
      ? message.metadata.ipollowork
      : null;
    const turn = ipollowork && typeof ipollowork.dshTurn === "number" ? ipollowork.dshTurn : null;
    const completedAt = turn === null ? undefined : completedTurns.get(turn);
    if (typeof completedAt === "number") messages[index] = completeConversationMessage(message, completedAt);
  }
  const session = mapDeepSeekHarnessSession(source.session);
  if (INTERNAL_SESSION_TITLE.test(session.title)) {
    const firstUserText = messages
      .find((message) => message.role === "user")
      ?.parts.find((part) => part.type === "text")?.text.trim();
    session.title = firstUserText || "New conversation";
  }
  return {
    session,
    messages,
    todos,
    status: source.session.dsh?.running ? { type: "busy" } : { type: "idle" },
  };
}

export function normalizeDeepSeekHarnessErrorText(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (/no api key for provider route|missing[_ -]?credential/i.test(message)) {
    return t("session.deepseek_harness_missing_api_key");
  }
  return message || t("session.deepseek_harness_run_failed");
}

function turnErrorText(data: Record<string, unknown>): string | null {
  if (!isRecord(data.reason) || data.reason.kind !== "error") return null;
  const error = isRecord(data.reason.error) ? data.reason.error : null;
  return normalizeDeepSeekHarnessErrorText(error?.message);
}

export function mapDeepSeekHarnessEnvelope(
  envelope: DeepSeekHarnessServerRequest,
  state: DeepSeekHarnessLiveState,
): ConversationEvent[] {
  const frame = envelope.payload;
  const type = typeof frame.type === "string" ? frame.type : "";
  const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : "";
  if (type === "host/session-status" && sessionId) {
    // This status arrives on a different stream from session events and can
    // overtake assistant chunks. turn/start and turn/end are the ordered,
    // authoritative lifecycle boundary for a conversation run.
    return [];
  }
  if (type === "host/session-removed" && sessionId) return [{ type: "session.deleted", sessionId }];
  if (type === "host/agent-error" && sessionId) {
    return [{ type: "session.error", sessionId, errorText: normalizeDeepSeekHarnessErrorText(frame.message) }];
  }
  if (type === "approval/requested" && sessionId && typeof frame.approvalId === "string") {
    const permission: ConversationPermission = {
      id: frame.approvalId,
      sessionId,
      kind: typeof frame.toolName === "string" ? frame.toolName : "tool",
      resources: typeof frame.reason === "string" ? [frame.reason] : [],
      remember: [],
      metadata: {
        ...(typeof frame.toolName === "string" ? { toolName: frame.toolName } : {}),
        ...(typeof frame.callId === "string" ? { callId: frame.callId } : {}),
      },
      receivedAt: Date.now(),
      native: { rpcId: envelope.rpcId, frame },
    };
    return [{ type: "permission.asked", permission }];
  }
  if (type === "approval/resolved" && sessionId && typeof frame.approvalId === "string") {
    return [{ type: "permission.replied", sessionId, requestId: frame.approvalId }];
  }
  if (type === "question/requested" && sessionId && Array.isArray(frame.questions)) {
    const question: ConversationQuestion = {
      id: envelope.rpcId,
      sessionId,
      questions: frame.questions.flatMap((item) => {
        if (!isRecord(item) || typeof item.question !== "string") return [];
        return [{
          header: typeof item.header === "string" ? item.header : undefined,
          question: item.question,
          options: Array.isArray(item.options)
            ? item.options.flatMap((option) => isRecord(option) && typeof option.label === "string"
              ? [{ label: option.label, description: typeof option.description === "string" ? option.description : undefined }]
              : [])
            : [],
          multiple: item.multiSelect === true,
          custom: true,
        }];
      }),
      receivedAt: Date.now(),
      native: { rpcId: envelope.rpcId, frame },
    };
    return [{ type: "question.asked", question }];
  }
  if (type === "question/resolved" && sessionId && typeof frame.questionRpcId === "string") {
    return [{ type: "question.replied", sessionId, requestId: frame.questionRpcId }];
  }
  if (type === "session/projection" && sessionId && frame.key === "title" && typeof frame.value === "string") {
    return [{ type: "session.updated", sessionId, info: { id: sessionId, title: frame.value } }];
  }
  if (type !== "session/event" || !sessionId || !isRecord(frame.event)) return [];
  const event = frame.event as DshEvent;
  if (event.type === "user/message" || event.type === "assistant/message") {
    const message = mapMessageEvent(sessionId, event);
    if (message?.role === "assistant") {
      const data = isRecord(event.data) ? event.data : null;
      const turn = data && typeof data.turn === "number" ? data.turn : 0;
      rememberAssistantMessage(state, sessionId, turn, message.id);
    }
    return message ? [{ type: "message.upsert", sessionId, message }] : [];
  }
  const data = isRecord(event.data) ? event.data : null;
  if (!data) return [];
  if (event.type === "assistant/chunk" && isRecord(data.chunk)) {
    const turn = typeof data.turn === "number" ? data.turn : 0;
    const step = typeof data.step === "number" ? data.step : 0;
    const chunk = data.chunk;
    const index = typeof chunk.index === "number" ? chunk.index : 0;
    if ((chunk.type === "text-delta" || chunk.type === "reasoning-delta") && typeof chunk.text === "string") {
      const messageId = assistantMessageId(sessionId, turn, step);
      rememberAssistantMessage(state, sessionId, turn, messageId);
      const id = partId(messageId, index);
      const events: ConversationEvent[] = [];
      if (!state.parts.has(id)) {
        state.parts.add(id);
        events.push({
          type: "message.parts",
          sessionId,
          messageId,
          partId: id,
          parts: [streamingPart(id, chunk.type === "reasoning-delta")],
          messageRole: "assistant",
          visibleAssistantOutput: true,
        });
      }
      events.push({
        type: "message.chunk",
        sessionId,
        messageId,
        chunk: {
          type: chunk.type,
          id,
          delta: chunk.text,
        },
      });
      return events;
    }
    return [];
  }
  if (event.type === "tool/call" && typeof data.callId === "string" && typeof data.name === "string") {
    const turn = typeof data.turn === "number" ? data.turn : 0;
    const step = typeof data.step === "number" ? data.step : 0;
    const messageId = assistantMessageId(sessionId, turn, step);
    rememberAssistantMessage(state, sessionId, turn, messageId);
    const tool = { messageId, toolName: data.name, input: normalizeToolInput(data.name, data.arguments) };
    state.tools.set(data.callId, tool);
    return [{
      type: "message.parts",
      sessionId,
      messageId,
      partId: data.callId,
      parts: [toolPart({ callId: data.callId, toolName: tool.toolName, input: tool.input, state: "input-streaming" })],
      messageRole: "assistant",
      visibleAssistantOutput: true,
    }];
  }
  if (event.type === "tool/result") {
    const result = toolResultData(data);
    const tool = result ? state.tools.get(result.callId) : null;
    if (!result || !tool) return [];
    return [{
      type: "message.parts",
      sessionId,
      messageId: tool.messageId,
      partId: result.callId,
      parts: [toolPart({
        callId: result.callId,
        toolName: tool.toolName,
        input: tool.input,
        state: result.isError ? "output-error" : "output-available",
        output: result.output,
        errorText: result.errorText,
      })],
      messageRole: "assistant",
      visibleAssistantOutput: true,
    }];
  }
  if (event.type === "todo/write") return [{ type: "todo.updated", sessionId, todos: mapTodos(sessionId, data) }];
  if (event.type === "session/title" && typeof data.title === "string") {
    return [{ type: "session.updated", sessionId, info: { id: sessionId, title: data.title } }];
  }
  if (event.type === "turn/start") return [{ type: "session.status", sessionId, status: { type: "busy" } }];
  if (event.type === "turn/end") {
    const errorText = turnErrorText(data);
    const turn = typeof data.turn === "number" ? data.turn : 0;
    const completedMessages = takeAssistantMessagesForTurn(state, sessionId, turn).map((messageId) => ({
      type: "message.completed" as const,
      sessionId,
      messageId,
      completedAt: event.time,
    }));
    return [
      ...completedMessages,
      ...(errorText ? [{ type: "session.error" as const, sessionId, errorText }] : []),
      { type: "session.status", sessionId, status: { type: "idle" } },
      { type: "session.idle", sessionId },
    ];
  }
  if (event.type === "compaction/start") return [{ type: "session.compaction", sessionId, running: true }];
  if (event.type === "compaction/end") return [{ type: "session.compaction", sessionId, running: false }];
  return [];
}

export function deepSeekHarnessForkSeq(messages: UIMessage[], messageId: string | null): number | undefined {
  if (!messageId) return undefined;
  const message = messages.find((item) => item.id === messageId);
  const ipollowork = isRecord(message?.metadata) && isRecord(message.metadata.ipollowork)
    ? message.metadata.ipollowork
    : null;
  return ipollowork && typeof ipollowork.dshSeq === "number" ? ipollowork.dshSeq : undefined;
}

export function deepSeekHarnessNativeRpcId(value: unknown): string | null {
  return isRecord(value) && typeof value.rpcId === "string" ? value.rpcId : null;
}
