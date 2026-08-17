/**
 * DeepSeek Harness engine adapter.
 *
 * Harness speaks a JSON-RPC dialect over `DeepSeekHarnessRuntime` plus two
 * multiplexed SSE streams (`mux` / `host`). It has no per-session, resumable
 * event stream and no durable cursor, so `EngineEvent.seq` stays undefined and
 * `capabilities.resumableStreaming` is false.
 *
 * The payload shapes and the frame vocabulary mirror the browser engine in
 * `apps/app/src/react-app/domains/session/engine/deepseek-harness-conversation-mapper.ts`,
 * which is the reference implementation for this mapping.
 */

import { resolve } from "node:path";

import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  DeepSeekHarnessRpcError,
  DeepSeekHarnessUnavailableError,
} from "../../deepseek-harness-runtime.js";
import { ApiError } from "../../errors.js";
import type {
  EngineAdapter,
  EngineCapabilities,
  EngineConnection,
  EngineEvent,
  EngineMessage,
  EngineMessagePart,
  EnginePermission,
  EnginePromptInput,
  EngineQuestion,
  EngineSession,
  EngineSubscribeInput,
} from "./types.js";

/**
 * Structural view of `DeepSeekHarnessRuntime`, so a test can hand in a stub
 * without spawning the `dsh` process.
 */
export interface HarnessRuntimeLike {
  call<T>(method: string, payload: unknown): Promise<T>;
  respond(input: { rpcId: string; result: unknown }): Promise<void>;
  events(stream: "mux" | "host", signal: AbortSignal): Promise<Response>;
}

export interface HarnessEngineAdapterDeps {
  runtime: HarnessRuntimeLike;
  /** Upper bound for the polled `wait()` fallback. Defaults to 10 minutes. */
  waitTimeoutMs?: number;
  /** First poll interval for `wait()`; it backs off to 2s. Defaults to 250ms. */
  waitPollIntervalMs?: number;
}

export const HARNESS_INTERNAL_SYSTEM_PREFIX = "<system>\n<!-- ipollowork-internal-context -->\n";

const LEGACY_SYSTEM_BLOCK = /^<system>\n[\s\S]*\n<\/system>$/u;
const INTERNAL_SESSION_TITLE = /^<system(?:>|\s)/iu;
const MISSING_CREDENTIAL = /no api key for provider route|missing[_ -]?credential/iu;
const DEFAULT_SESSION_TITLE = "New conversation";

/**
 * Harness reports a tool's name only on `tool/call`; `tool/result` carries just
 * the call id. The stream keeps the pairing so `tool.completed` can name its tool.
 */
export interface HarnessStreamState {
  tools: Map<string, { messageId: string; tool: string; input: unknown }>;
}

export function createHarnessStreamState(): HarnessStreamState {
  return { tools: new Map() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Shared error translation, identical to `routes/deepseek-harness.ts` so both
 * the RPC passthrough and the engine adapter report the same status and code.
 * Returns the original error untouched when it is not a Harness error.
 */
export function mapHarnessError(error: unknown): unknown {
  if (error instanceof DeepSeekHarnessUnavailableError) {
    return new ApiError(503, error.code, error.message);
  }
  if (error instanceof DeepSeekHarnessRpcError) {
    const status = error.code === "not-found" || error.code === "session-not-found" ? 404 : 502;
    return new ApiError(status, `deepseek_harness_${error.code}`, error.message, error.details);
  }
  return error;
}

export function throwHarnessError(error: unknown): never {
  throw mapHarnessError(error);
}

function unsupported(operation: string, detail: string): ApiError {
  return new ApiError(
    501,
    "engine_capability_unsupported",
    `DeepSeek Harness does not support ${operation}: ${detail}`,
    { engineId: DEEPSEEK_HARNESS_ENGINE_ID, operation },
  );
}

export function normalizeHarnessErrorText(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (MISSING_CREDENTIAL.test(message)) {
    return "DeepSeek Harness has no API key for this model provider. Connect the provider credential first.";
  }
  return message || "DeepSeek Harness failed to run this turn";
}

/* -------------------------------------------------------------------------- */
/* Pure event mapping                                                          */
/* -------------------------------------------------------------------------- */

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

function numberField(data: Record<string, unknown> | null, key: string): number {
  const value = data?.[key];
  return typeof value === "number" ? value : 0;
}

function visibleUserContent(message: Record<string, unknown>): unknown {
  const content = message.content;
  if (!Array.isArray(content)) return content;
  return content.flatMap((block, index) => {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return [block];
    if (index === 0 && content.length > 1 && LEGACY_SYSTEM_BLOCK.test(block.text.trim())) return [];
    let text = block.text;
    let start = text.indexOf(HARNESS_INTERNAL_SYSTEM_PREFIX);
    while (start !== -1) {
      const end = text.indexOf("</system>", start + HARNESS_INTERNAL_SYSTEM_PREFIX.length);
      text = end === -1
        ? text.slice(0, start)
        : `${text.slice(0, start)}${text.slice(end + "</system>".length)}`;
      start = text.indexOf(HARNESS_INTERNAL_SYSTEM_PREFIX);
    }
    return text.trim() ? [{ ...block, text }] : [];
  });
}

function messageParts(messageId: string, content: unknown): EngineMessagePart[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block, index): EngineMessagePart[] => {
    if (!isRecord(block)) return [];
    const id = partId(messageId, index);
    if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") {
      return [{ id, type: block.type, text: block.text }];
    }
    if (block.type === "tool-call" && typeof block.id === "string" && typeof block.name === "string") {
      return [{
        id: block.id,
        type: "tool",
        callId: block.id,
        tool: block.name,
        input: normalizeToolInput(block.name, block.arguments),
      }];
    }
    if (block.type === "image") {
      // The raw base64 payload is deliberately dropped: the public API streams
      // conversation structure, not attachment bytes.
      return [{
        id,
        type: "file",
        mime: typeof block.mediaType === "string" ? block.mediaType : "application/octet-stream",
        ...(typeof block.name === "string" ? { filename: block.name } : {}),
      }];
    }
    return [];
  });
}

function engineMessage(sessionId: string, event: Record<string, unknown>): EngineMessage | null {
  const data = isRecord(event.data) ? event.data : null;
  const message = data && isRecord(data.message)
    ? data.message
    : event.type === "user/message" && data
      ? data
      : null;
  if (!message || typeof message.id !== "string") return null;
  if (event.type === "user/message") {
    const source = isRecord(message.source) ? message.source : null;
    // Plugin-injected turns are runtime context, not conversation content.
    if (source && source.kind !== "user") return null;
  }
  const declaredRole = message.role === "assistant"
    ? "assistant"
    : message.role === "system"
      ? "system"
      : "user";
  const createdAt = typeof event.time === "number" ? event.time : null;
  if (event.type === "assistant/message" || declaredRole === "assistant") {
    const id = event.type === "assistant/message"
      ? assistantMessageId(sessionId, numberField(data, "turn"), numberField(data, "step"))
      : message.id;
    return {
      id,
      role: "assistant",
      parts: messageParts(id, event.type === "user/message" ? visibleUserContent(message) : message.content),
      createdAt,
    };
  }
  return {
    id: message.id,
    role: declaredRole,
    parts: messageParts(message.id, visibleUserContent(message)),
    createdAt,
  };
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

function toolResult(data: Record<string, unknown>) {
  if (!isRecord(data.message) || !Array.isArray(data.message.content)) return null;
  const block = data.message.content.find((item) => isRecord(item) && item.type === "tool-result");
  if (!isRecord(block) || typeof block.toolCallId !== "string") return null;
  return {
    callId: block.toolCallId,
    output: textOutput(block.content),
    isError: block.isError === true || isRecord(data.error),
    errorText: isRecord(data.error) && typeof data.error.name === "string" ? data.error.name : undefined,
  };
}

function harnessTodos(sessionId: string, data: Record<string, unknown>): unknown[] {
  if (!Array.isArray(data.todos)) return [];
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

function harnessPermission(
  sessionId: string,
  rpcId: string,
  frame: Record<string, unknown>,
): EnginePermission {
  return {
    id: String(frame.approvalId),
    sessionId,
    kind: typeof frame.toolName === "string" ? frame.toolName : "tool",
    resources: typeof frame.reason === "string" ? [frame.reason] : [],
    // Harness answers one approval at a time; it has no persistent grant scope.
    remember: [],
    metadata: {
      rpcId,
      ...(typeof frame.toolName === "string" ? { toolName: frame.toolName } : {}),
      ...(typeof frame.callId === "string" ? { callId: frame.callId } : {}),
      ...(typeof frame.reason === "string" ? { reason: frame.reason } : {}),
    },
    receivedAt: Date.now(),
  };
}

function harnessQuestion(
  sessionId: string,
  rpcId: string,
  frame: Record<string, unknown>,
): EngineQuestion | null {
  if (!Array.isArray(frame.questions)) return null;
  return {
    // The RPC id is the reply address, so it is also the question id.
    id: rpcId,
    sessionId,
    questions: frame.questions.flatMap((item) => {
      if (!isRecord(item) || typeof item.question !== "string") return [];
      return [{
        ...(typeof item.header === "string" ? { header: item.header } : {}),
        question: item.question,
        options: Array.isArray(item.options)
          ? item.options.flatMap((option) => isRecord(option) && typeof option.label === "string"
            ? [{
                label: option.label,
                ...(typeof option.description === "string" ? { description: option.description } : {}),
              }]
            : [])
          : [],
        multiple: item.multiSelect === true,
        custom: true,
      }];
    }),
    receivedAt: Date.now(),
  };
}

/**
 * Maps one Harness SSE envelope to the normalized engine events.
 *
 * A single Harness frame can carry more than one engine-level fact (`turn/end`
 * both fails and idles a session), so the full-fidelity mapping is the plural
 * form; `mapHarnessEvent` is the single-event view required by the adapter
 * contract. Both are pure: `state` is supplied by the caller and only records
 * the tool-call pairing that Harness itself omits from `tool/result`.
 */
export function mapHarnessEvents(
  event: unknown,
  sessionId: string,
  state?: HarnessStreamState,
): EngineEvent[] {
  const envelope = isRecord(event) ? event : null;
  const frame = envelope && isRecord(envelope.payload) ? envelope.payload : null;
  if (!frame) return [];
  const rpcId = envelope && typeof envelope.rpcId === "string" ? envelope.rpcId : "";
  const type = typeof frame.type === "string" ? frame.type : "";
  const frameSessionId = typeof frame.sessionId === "string" ? frame.sessionId : "";
  if (!frameSessionId || frameSessionId !== sessionId) return [];

  // `host/session-status` races ahead of assistant chunks on the other stream;
  // turn/start and turn/end are the ordered, authoritative lifecycle boundary.
  if (type === "host/session-status") return [];
  if (type === "host/session-removed") return [{ type: "session.deleted", sessionId }];
  if (type === "host/agent-error") {
    return [{
      type: "session.error",
      sessionId,
      error: { message: normalizeHarnessErrorText(frame.message) },
    }];
  }
  if (type === "approval/requested" && typeof frame.approvalId === "string") {
    return [{ type: "permission.asked", permission: harnessPermission(sessionId, rpcId, frame) }];
  }
  if (type === "approval/resolved" && typeof frame.approvalId === "string") {
    return [{ type: "permission.replied", sessionId, requestId: frame.approvalId }];
  }
  if (type === "question/requested") {
    const question = harnessQuestion(sessionId, rpcId, frame);
    return question ? [{ type: "question.asked", question }] : [];
  }
  if (type === "question/resolved" && typeof frame.questionRpcId === "string") {
    return [{ type: "question.replied", sessionId, requestId: frame.questionRpcId }];
  }
  if (type === "session/projection" && frame.key === "title" && typeof frame.value === "string") {
    return [{ type: "session.updated", sessionId, session: { id: sessionId, title: frame.value } }];
  }
  if (type !== "session/event" || !isRecord(frame.event)) return [];

  const inner = frame.event;
  const innerType = typeof inner.type === "string" ? inner.type : "";
  if (innerType === "user/message" || innerType === "assistant/message") {
    const message = engineMessage(sessionId, inner);
    return message ? [{ type: "message.upsert", sessionId, message }] : [];
  }
  const data = isRecord(inner.data) ? inner.data : null;
  if (!data) return [];
  const messageId = assistantMessageId(sessionId, numberField(data, "turn"), numberField(data, "step"));

  if (innerType === "assistant/chunk" && isRecord(data.chunk)) {
    const chunk = data.chunk;
    if ((chunk.type !== "text-delta" && chunk.type !== "reasoning-delta") || typeof chunk.text !== "string") {
      return [];
    }
    return [{
      type: "message.delta",
      sessionId,
      messageId,
      partId: partId(messageId, typeof chunk.index === "number" ? chunk.index : 0),
      kind: chunk.type === "reasoning-delta" ? "reasoning" : "text",
      delta: chunk.text,
    }];
  }
  if (innerType === "tool/call" && typeof data.callId === "string" && typeof data.name === "string") {
    const input = normalizeToolInput(data.name, data.arguments);
    state?.tools.set(data.callId, { messageId, tool: data.name, input });
    return [{ type: "tool.called", sessionId, messageId, callId: data.callId, tool: data.name, input }];
  }
  if (innerType === "tool/result") {
    const result = toolResult(data);
    if (!result) return [];
    const pending = state?.tools.get(result.callId);
    state?.tools.delete(result.callId);
    return [{
      type: "tool.completed",
      sessionId,
      messageId: pending?.messageId ?? messageId,
      callId: result.callId,
      tool: pending?.tool ?? (typeof data.name === "string" ? data.name : "unknown"),
      status: result.isError ? "failed" : "success",
      output: result.output,
      ...(result.isError ? { error: result.errorText ?? "Tool failed" } : {}),
    }];
  }
  if (innerType === "todo/write") {
    return [{ type: "todo.updated", sessionId, todos: harnessTodos(sessionId, data) }];
  }
  if (innerType === "session/title" && typeof data.title === "string") {
    return [{ type: "session.updated", sessionId, session: { id: sessionId, title: data.title } }];
  }
  if (innerType === "turn/start") {
    return [{ type: "session.status", sessionId, status: { type: "busy" } }];
  }
  if (innerType === "turn/end") {
    const reason = isRecord(data.reason) ? data.reason : null;
    const error = reason?.kind === "error" && isRecord(reason.error) ? reason.error : null;
    return [
      ...(reason?.kind === "error"
        ? [{
            type: "session.error" as const,
            sessionId,
            error: { message: normalizeHarnessErrorText(error?.message) },
          }]
        : []),
      { type: "session.status", sessionId, status: { type: "idle" } },
      { type: "session.idle", sessionId },
    ];
  }
  if (innerType === "compaction/start") return [{ type: "session.compaction", sessionId, running: true }];
  if (innerType === "compaction/end") return [{ type: "session.compaction", sessionId, running: false }];
  return [];
}

/**
 * Single-event view of {@link mapHarnessEvents}: the first engine event a
 * Harness envelope produces, or `null` when the envelope is unknown, internal,
 * or belongs to another session. `seq` is never set — Harness exposes no
 * durable cursor on its live streams.
 */
export function mapHarnessEvent(event: unknown, sessionId: string): EngineEvent | null {
  return mapHarnessEvents(event, sessionId)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Session read model                                                          */
/* -------------------------------------------------------------------------- */

type HarnessSummary = {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  cwd?: string;
  agentPreset?: string;
  projections?: { asOfSeq: number; values: Record<string, unknown> };
};

function summaryTitle(summary: HarnessSummary): string {
  const projected = summary.projections?.values.title;
  if (typeof projected !== "string" || !projected.trim()) return DEFAULT_SESSION_TITLE;
  const title = projected.trim();
  return INTERNAL_SESSION_TITLE.test(title) ? DEFAULT_SESSION_TITLE : title;
}

function engineSession(summary: HarnessSummary, archived: boolean): EngineSession {
  return {
    id: summary.sessionId,
    title: summaryTitle(summary),
    parentId: summary.parentSessionId ?? null,
    directory: summary.cwd ?? null,
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
    archivedAt: archived ? summary.updatedAt : null,
  };
}

function pathMatches(left: string | undefined, right: string): boolean {
  if (!left?.trim()) return false;
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function workspacePath(workspace: unknown): string | undefined {
  if (!isRecord(workspace)) return undefined;
  const path = typeof workspace.path === "string" ? workspace.path : undefined;
  return path?.trim() ? path : undefined;
}

/* -------------------------------------------------------------------------- */
/* Prompt payload                                                              */
/* -------------------------------------------------------------------------- */

function internalPromptText(text: string): string {
  if (text.startsWith(HARNESS_INTERNAL_SYSTEM_PREFIX)) return text;
  return `${HARNESS_INTERNAL_SYSTEM_PREFIX}${text}\n</system>`;
}

function textDataUrl(url: string): string | null {
  const match = /^data:(text\/[^;,]+)(;base64)?,([\s\S]*)$/u.exec(url);
  if (!match?.[1] || match[3] === undefined) return null;
  if (!match[2]) return decodeURIComponent(match[3]);
  return Buffer.from(match[3], "base64").toString("utf8");
}

export function harnessPromptContent(input: EnginePromptInput): unknown[] {
  const content: Array<Record<string, unknown>> = [];
  for (const part of input.parts) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "agent") {
      content.push({ type: "text", text: `@${part.name}` });
      continue;
    }
    const image = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/u.exec(part.url);
    if (image?.[1] && image[2]) {
      content.push({
        type: "image",
        mediaType: image[1],
        data: image[2],
        ...(part.filename ? { name: part.filename } : {}),
      });
      continue;
    }
    const text = part.url.startsWith("data:") ? textDataUrl(part.url) : part.url;
    if (text === null) {
      throw unsupported(
        "this attachment type",
        "only raster images and text attachments can be sent in a conversation",
      );
    }
    content.push({ type: "text", text: `[Attached file: ${part.filename || "file"}]\n${text}` });
  }
  if (input.system?.trim()) {
    content.push({ type: "text", text: internalPromptText(input.system.trim()) });
  }
  return content;
}

/* -------------------------------------------------------------------------- */
/* SSE                                                                         */
/* -------------------------------------------------------------------------- */

type HarnessEnvelope = { type: string; rpcId: string; method?: string; payload: Record<string, unknown> };

/**
 * Parses the Harness SSE body. There is no SDK helper for this stream, and the
 * runtime also bridges a WebSocket transport into the same `data: <json>` frame
 * shape, so one parser covers both.
 */
export async function* readHarnessEnvelopes(response: Response): AsyncGenerator<HarnessEnvelope> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("");
        if (data) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }
          if (isRecord(parsed) && parsed.type === "server-request" && typeof parsed.rpcId === "string") {
            yield {
              type: "server-request",
              rpcId: parsed.rpcId,
              ...(typeof parsed.method === "string" ? { method: parsed.method } : {}),
              payload: isRecord(parsed.payload) ? parsed.payload : {},
            };
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, rejectSleep) => {
    if (signal?.aborted) {
      rejectSleep(new ApiError(499, "client_closed_request", "Wait was aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveSleep();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      rejectSleep(new ApiError(499, "client_closed_request", "Wait was aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Honest capability report.
 *
 * - `resumableStreaming`: `runtime.events()` accepts only a stream name and an
 *   abort signal — there is no cursor parameter and no durable sequence on live
 *   frames, so `?after=` cannot be honoured.
 * - `wait`: no RPC in the Harness allowlist blocks until idle, so `wait()` is a
 *   polled fallback over `session.list`'s `running` flag.
 * - `shell` / `commands`: Harness exposes neither direct shell execution nor a
 *   command catalogue through its conversation RPC surface.
 */
export const HARNESS_CAPABILITIES: EngineCapabilities = {
  streaming: true,
  resumableStreaming: false,
  permissions: true,
  questions: true,
  interrupt: true,
  wait: false,
  // A system prompt is carried as an internal `<system>` content block on the prompt
  // itself, and the reasoning-effort hint rides on `session.selectModel` alongside the
  // variant, so all three are genuinely applied here.
  promptOptions: { system: true, reasoningEffort: true, variant: true },
};

export function createHarnessEngineAdapter(deps: HarnessEngineAdapterDeps): EngineAdapter {
  const { runtime } = deps;
  const waitTimeoutMs = deps.waitTimeoutMs ?? 600_000;
  const pollIntervalMs = deps.waitPollIntervalMs ?? 250;

  return {
    id: DEEPSEEK_HARNESS_ENGINE_ID,
    connect(workspace: unknown): EngineConnection {
      return createHarnessConnection({ runtime, waitTimeoutMs, pollIntervalMs, workspace });
    },
  };
}

function createHarnessConnection(input: {
  runtime: HarnessRuntimeLike;
  waitTimeoutMs: number;
  pollIntervalMs: number;
  workspace: unknown;
}): EngineConnection {
  const { runtime } = input;
  const directory = workspacePath(input.workspace);
  const permissions = new Map<string, EnginePermission>();
  const questions = new Map<string, { question: EngineQuestion; frame: Record<string, unknown> }>();
  const state = createHarnessStreamState();

  const call = async <T>(method: string, payload: unknown): Promise<T> => {
    try {
      return await runtime.call<T>(method, payload);
    } catch (error) {
      throw mapHarnessError(error);
    }
  };

  const respond = async (rpcId: string, result: unknown): Promise<void> => {
    try {
      await runtime.respond({ rpcId, result });
    } catch (error) {
      throw mapHarnessError(error);
    }
  };

  const readSummary = async (sessionId: string): Promise<{ summary: HarnessSummary; archived: boolean }> => {
    const [sessions, workspaces] = await Promise.all([
      call<{ items: HarnessSummary[] }>("session.list", {}),
      call<{ archivedSessionIds: string[] }>("workspace.list", {}),
    ]);
    // A runtime that answers without an `items` array means "no sessions", not a crash:
    // a TypeError here would surface as a 500 on what is really a plain lookup miss.
    const items = Array.isArray(sessions?.items) ? sessions.items : [];
    const summary = items.find((item) => item.sessionId === sessionId);
    // A workspace-scoped connection must not leak sessions from another cwd.
    if (!summary || (directory && !pathMatches(summary.cwd, directory))) {
      throw new ApiError(404, "session_not_found", "Session not found");
    }
    const archivedIds = Array.isArray(workspaces?.archivedSessionIds) ? workspaces.archivedSessionIds : [];
    return { summary, archived: archivedIds.includes(sessionId) };
  };

  /**
   * Confirms a session belongs to this connection's workspace before acting on it.
   *
   * The Harness runtime is one process shared by every workspace, and `session.list`
   * returns all of them, so a session id is not self-scoping the way it is with OpenCode's
   * per-directory client. Without this check, `POST /workspaces/wA/sessions/{id_from_wB}/prompt`
   * would run in workspace B — against B's files, with B's agent — while the caller only ever
   * proved access to A. Reads already went through `readSummary`; writes have to as well.
   */
  const assertSessionInWorkspace = async (sessionId: string): Promise<void> => {
    if (!directory) return;
    await readSummary(sessionId);
  };

  return {
    engineId: DEEPSEEK_HARNESS_ENGINE_ID,
    capabilities: HARNESS_CAPABILITIES,

    async createSession(request) {
      const created = await call<{ sessionId: string; agentPreset?: string }>("session.create", {
        ...(directory ? { cwd: directory } : {}),
      });
      if (request.agent) {
        await call("agentPreset.select", { sessionId: created.sessionId, agentPreset: request.agent });
      }
      if (request.model) {
        await call("session.selectModel", {
          sessionId: created.sessionId,
          provider: request.model.providerID,
          model: request.model.modelID,
        });
      }
      if (request.title?.trim()) {
        await call("session.rename", { sessionId: created.sessionId, title: request.title.trim() });
      }
      const now = Date.now();
      return {
        id: created.sessionId,
        title: request.title?.trim() || DEFAULT_SESSION_TITLE,
        parentId: null,
        directory: directory ?? null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
    },

    async getSession(sessionId) {
      const { summary, archived } = await readSummary(sessionId);
      return engineSession(summary, archived);
    },

    async deleteSession(sessionId) {
      void sessionId;
      throw unsupported(
        "deleteSession",
        "its RPC surface offers only workspace.archiveSession, which hides a session without deleting it",
      );
    },

    async renameSession(sessionId, title) {
      await assertSessionInWorkspace(sessionId);
      await call("session.rename", { sessionId, title });
    },

    async prompt(request) {
      await assertSessionInWorkspace(request.sessionId);
      if (request.delivery === "steer") {
        throw unsupported("steering an in-flight turn", "session.prompt only accepts queued delivery");
      }
      if (request.agent) {
        await call("agentPreset.select", { sessionId: request.sessionId, agentPreset: request.agent });
      }
      if (request.model) {
        const reasoningEffort = request.reasoningEffort || request.variant;
        await call("session.selectModel", {
          sessionId: request.sessionId,
          provider: request.model.providerID,
          model: request.model.modelID,
          ...(reasoningEffort ? { reasoningEffort } : {}),
        });
      }
      await call("session.prompt", {
        sessionId: request.sessionId,
        mode: "queue",
        content: harnessPromptContent(request),
      });
      // Harness assigns the assistant message id itself and reports it only on
      // the event stream, so there is no id to return here.
      return {};
    },

    async interrupt(sessionId) {
      await assertSessionInWorkspace(sessionId);
      await call("session.cancel", { sessionId });
      return true;
    },

    /**
     * Polled fallback: Harness has no blocking "run until idle" RPC, so this
     * watches the `running` flag `session.list` reports, backing off to 2s.
     */
    async wait(sessionId, signal) {
      const deadline = Date.now() + input.waitTimeoutMs;
      let delay = input.pollIntervalMs;
      for (;;) {
        await sleep(delay, signal);
        const { summary } = await readSummary(sessionId);
        if (!summary.running) return;
        if (Date.now() >= deadline) {
          throw new ApiError(504, "engine_wait_timeout", "DeepSeek Harness session is still running", {
            engineId: DEEPSEEK_HARNESS_ENGINE_ID,
            sessionId,
          });
        }
        delay = Math.min(delay * 2, 2_000);
      }
    },

    /**
     * Only permissions seen on this connection's live stream are listed:
     * Harness has no "list pending approvals" RPC.
     */
    async listPermissions(sessionId) {
      return [...permissions.values()].filter((permission) => permission.sessionId === sessionId);
    },

    async replyPermission(request) {
      if (request.reply === "always") {
        throw unsupported(
          "remembering a permission answer",
          "an approval is answered once and never persisted, so reply must be \"once\" or \"reject\"",
        );
      }
      const permission = permissions.get(request.permissionId);
      const rpcId = permission && typeof permission.metadata.rpcId === "string" ? permission.metadata.rpcId : null;
      if (!permission || !rpcId) {
        throw new ApiError(404, "engine_permission_not_found", "DeepSeek Harness approval is no longer pending", {
          engineId: DEEPSEEK_HARNESS_ENGINE_ID,
          permissionId: request.permissionId,
        });
      }
      await respond(rpcId, {
        ok: true,
        value: {
          sessionId: permission.sessionId,
          approvalId: permission.id,
          outcome: request.reply === "reject" ? "rejected" : "allowed-once",
        },
      });
      permissions.delete(request.permissionId);
    },

    async listQuestions(sessionId) {
      return [...questions.values()]
        .map((entry) => entry.question)
        .filter((question) => question.sessionId === sessionId);
    },

    async replyQuestion(request) {
      const pending = questions.get(request.questionId);
      if (!pending || !Array.isArray(pending.frame.questions)) {
        throw new ApiError(404, "engine_question_not_found", "DeepSeek Harness question is no longer pending", {
          engineId: DEEPSEEK_HARNESS_ENGINE_ID,
          questionId: request.questionId,
        });
      }
      const answers = pending.frame.questions.flatMap((question, index) => {
        if (!isRecord(question) || typeof question.id !== "string") return [];
        const selected = request.answers[index] ?? [];
        const optionLabels = new Set(
          Array.isArray(question.options)
            ? question.options.flatMap((option) => isRecord(option) && typeof option.label === "string"
              ? [option.label]
              : [])
            : [],
        );
        const custom = selected.find((value) => !optionLabels.has(value));
        return [{
          id: question.id,
          selected: selected.filter((value) => optionLabels.has(value)),
          ...(custom ? { custom } : {}),
        }];
      });
      await respond(request.questionId, {
        ok: true,
        value: { sessionId: pending.question.sessionId, answer: { answers } },
      });
      questions.delete(request.questionId);
    },

    /**
     * Harness multiplexes every session onto `mux` (conversation frames,
     * approvals, questions) and `host` (session lifecycle and agent errors), so
     * both are consumed and filtered down to one session id.
     */
    async subscribe(subscription: EngineSubscribeInput) {
      if (subscription.after) {
        throw unsupported(
          "resuming an event stream",
          "its live streams carry no durable cursor, so `after` cannot be replayed",
        );
      }
      const consume = async (stream: "mux" | "host") => {
        let response: Response;
        try {
          response = await runtime.events(stream, subscription.signal);
        } catch (error) {
          if (subscription.signal.aborted || isAbortError(error)) return;
          throw mapHarnessError(error);
        }
        try {
          for await (const envelope of readHarnessEnvelopes(response)) {
            for (const event of mapHarnessEvents(envelope, subscription.sessionId, state)) {
              if (event.type === "permission.asked") permissions.set(event.permission.id, event.permission);
              if (event.type === "permission.replied") permissions.delete(event.requestId);
              if (event.type === "question.asked") {
                questions.set(event.question.id, { question: event.question, frame: envelope.payload });
              }
              if (event.type === "question.replied") questions.delete(event.requestId);
              subscription.onEvent(event);
            }
          }
        } catch (error) {
          if (subscription.signal.aborted || isAbortError(error)) return;
          throw mapHarnessError(error);
        }
      };
      await Promise.all([consume("mux"), consume("host")]);
    },
  };
}
