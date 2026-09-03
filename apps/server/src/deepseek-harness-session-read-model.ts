import { resolve } from "node:path";

import {
  DEEPSEEK_HARNESS_ENGINE_ID,
  stripDeepSeekHarnessInternalContext,
} from "@ipollowork/types/workspace";

import type { DeepSeekHarnessRuntime } from "./deepseek-harness-runtime.js";
import { ApiError } from "./errors.js";
import type { WorkspaceInfo } from "./types.js";

export type DeepSeekHarnessEvent = {
  type: string;
  seq: number;
  time: number;
  data: unknown;
  [key: string]: unknown;
};

export type DeepSeekHarnessHistory = {
  events: Array<{ event: DeepSeekHarnessEvent; view?: unknown }>;
  hasMore: boolean;
  projections?: { asOfSeq: number; values: Record<string, unknown> };
};

export type DeepSeekHarnessSummary = {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  origin?: "subagent";
  cwd?: string;
  agentPreset?: string;
  projections?: { asOfSeq: number; values: Record<string, unknown> };
};

type SessionListValue = { items: DeepSeekHarnessSummary[] };
type WorkspaceListValue = { archivedSessionIds: string[] };

const INTERNAL_SESSION_TITLE = /^<system(?:>|\s)/iu;

export type DeepSeekHarnessSessionInfo = {
  id: string;
  title: string;
  status: { type: "busy" | "idle" };
  slug: string;
  agent?: string;
  parentID?: string;
  directory?: string;
  time: { created: number; updated: number; archived?: number };
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  dsh: { running: boolean; agentPreset?: string; blank: boolean };
};

type DeepSeekHarnessMessage = {
  info: {
    id: string;
    sessionID: string;
    role: string;
    time: { created: number; completed: number };
  };
  parts: Array<{
    id: string;
    messageID: string;
    sessionID: string;
    type: string;
    [key: string]: unknown;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workspacePathMatches(left: string | undefined, right: string): boolean {
  if (!left?.trim()) return false;
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function summaryTitle(summary: DeepSeekHarnessSummary): string {
  const projected = summary.projections?.values.title;
  if (typeof projected !== "string" || !projected.trim()) return "New conversation";
  const title = projected.trim();
  return INTERNAL_SESSION_TITLE.test(title) ? "New conversation" : title;
}

function summaryTokens(summary: DeepSeekHarnessSummary): DeepSeekHarnessSessionInfo["tokens"] {
  const usage = summary.projections?.values.tokenUsage;
  if (!isRecord(usage)) return undefined;
  const readNumber = (key: string) => {
    const value = usage[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  };
  return {
    input: readNumber("uncachedInputTokens"),
    output: readNumber("outputTokens"),
    reasoning: 0,
    cache: {
      read: readNumber("cacheReadTokens"),
      write: readNumber("cacheWriteTokens"),
    },
  };
}

function mapSummary(summary: DeepSeekHarnessSummary, archived: boolean): DeepSeekHarnessSessionInfo {
  const tokens = summaryTokens(summary);
  return {
    id: summary.sessionId,
    title: summaryTitle(summary),
    status: summary.running ? { type: "busy" } : { type: "idle" },
    slug: summary.sessionId,
    ...(summary.agentPreset ? { agent: summary.agentPreset } : {}),
    ...(summary.parentSessionId ? { parentID: summary.parentSessionId } : {}),
    ...(summary.cwd ? { directory: summary.cwd } : {}),
    ...(tokens ? { tokens } : {}),
    time: {
      created: summary.updatedAt,
      updated: summary.updatedAt,
      ...(archived ? { archived: summary.updatedAt } : {}),
    },
    dsh: {
      running: summary.running,
      blank: summary.blank,
      ...(summary.agentPreset ? { agentPreset: summary.agentPreset } : {}),
    },
  };
}

async function readWorkspaceSummaries(runtime: DeepSeekHarnessRuntime, workspace: WorkspaceInfo) {
  const [sessions, workspaces] = await Promise.all([
    runtime.call<SessionListValue>("session.list", {}),
    runtime.call<WorkspaceListValue>("workspace.list", {}),
  ]);
  const archived = new Set(workspaces.archivedSessionIds);
  return sessions.items
    .filter((summary) => workspacePathMatches(summary.cwd, workspace.path))
    .map((summary) => ({ summary, archived: archived.has(summary.sessionId) }));
}

export async function listDeepSeekHarnessSessions(
  runtime: DeepSeekHarnessRuntime,
  workspace: WorkspaceInfo,
  input: { roots?: boolean; start?: number; search?: string; limit?: number },
): Promise<DeepSeekHarnessSessionInfo[]> {
  let entries = await readWorkspaceSummaries(runtime, workspace);
  if (input.roots) entries = entries.filter(({ summary }) => !summary.parentSessionId);
  if (input.search?.trim()) {
    const result = await runtime.call<{ items: Array<{ sessionId: string }> }>("session.search", {
      query: input.search.trim(),
    });
    const matches = new Set(result.items.map((item) => item.sessionId));
    entries = entries.filter(({ summary }) => matches.has(summary.sessionId));
  }
  entries.sort((left, right) => right.summary.updatedAt - left.summary.updatedAt);
  const start = input.start ?? 0;
  const end = input.limit ? start + input.limit : undefined;
  return entries.slice(start, end).map(({ summary, archived }) => mapSummary(summary, archived));
}

export async function readDeepSeekHarnessSession(
  runtime: DeepSeekHarnessRuntime,
  workspace: WorkspaceInfo,
  sessionId: string,
): Promise<DeepSeekHarnessSessionInfo> {
  const entry = (await readWorkspaceSummaries(runtime, workspace))
    .find(({ summary }) => summary.sessionId === sessionId);
  if (!entry) throw new ApiError(404, "session_not_found", "Session not found");
  return mapSummary(entry.summary, entry.archived);
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => {
    if (!isRecord(block)) return [];
    if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") {
      return [block.text];
    }
    return [];
  }).join("\n");
}

function visibleUserContent(message: Record<string, unknown>): unknown {
  const content = message.content;
  if (!Array.isArray(content)) return content;
  return content.flatMap((block) => {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return [block];
    const text = stripDeepSeekHarnessInternalContext(block.text);
    return text.trim() ? [{ ...block, text }] : [];
  });
}

function messageFromEvent(sessionId: string, event: DeepSeekHarnessEvent): DeepSeekHarnessMessage | null {
  const data = isRecord(event.data) ? event.data : null;
  const message = data && isRecord(data.message)
    ? data.message
    : event.type === "user/message" && data
      ? data
      : null;
  if (!message || typeof message.id !== "string") return null;
  if (event.type === "user/message") {
    const source = isRecord(message.source) ? message.source : null;
    if (source && source.kind !== "user") return null;
  }
  const role = message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user";
  const text = textFromContent(event.type === "user/message" ? visibleUserContent(message) : message.content);
  return {
    info: {
      id: message.id,
      sessionID: sessionId,
      role,
      time: { created: event.time, completed: event.time },
    },
    parts: text
      ? [{
          id: `${message.id}:text`,
          messageID: message.id,
          sessionID: sessionId,
          type: "text",
          text,
        }]
      : [],
  };
}

function parsedObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function subagentLabel(summary: DeepSeekHarnessSummary): string | null {
  const projected = summary.projections?.values.subagent;
  if (!isRecord(projected)) return null;
  const identity = isRecord(projected.identity) ? projected.identity : projected;
  return typeof identity.label === "string" && identity.label.trim()
    ? identity.label.trim()
    : null;
}

function toolResultErrors(history: DeepSeekHarnessHistory): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const { event } of history.events) {
    if (event.type !== "tool/result" || !isRecord(event.data)) continue;
    const message = isRecord(event.data.message) ? event.data.message : null;
    const source = message && isRecord(message.source) ? message.source : null;
    const callId = source && typeof source.callId === "string" ? source.callId : null;
    if (!callId) continue;
    const content = message?.content;
    const failed = Array.isArray(content) && content.some((block) => (
      isRecord(block) && block.type === "tool-result" && block.isError === true
    ));
    result.set(callId, failed);
  }
  return result;
}

function subagentTaskMessages(
  sessionId: string,
  history: DeepSeekHarnessHistory,
  summaries: DeepSeekHarnessSummary[],
): DeepSeekHarnessMessage[] {
  const childrenByLabel = new Map<string, DeepSeekHarnessSummary[]>();
  for (const summary of summaries) {
    if (summary.parentSessionId !== sessionId || summary.origin !== "subagent") continue;
    const label = subagentLabel(summary);
    if (!label) continue;
    const children = childrenByLabel.get(label) ?? [];
    children.push(summary);
    childrenByLabel.set(label, children);
  }
  for (const children of childrenByLabel.values()) {
    children.sort((left, right) => left.updatedAt - right.updatedAt);
  }

  const resultErrors = toolResultErrors(history);
  return history.events.flatMap(({ event }) => {
    if (event.type !== "tool/call" || !isRecord(event.data) || event.data.name !== "subagent") return [];
    const callId = typeof event.data.callId === "string" ? event.data.callId : null;
    const input = parsedObject(event.data.arguments);
    const description = input && typeof input.description === "string" ? input.description.trim() : "";
    const prompt = input && typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!callId || !description) return [];
    const child = childrenByLabel.get(description)?.shift();
    if (!child) return [];

    const status = resultErrors.get(callId) === true
      ? "error"
      : child.running
        ? "running"
        : resultErrors.has(callId)
          ? "completed"
          : "pending";
    const messageId = `dsh-subagent:${callId}`;
    return [{
      info: {
        id: messageId,
        sessionID: sessionId,
        role: "assistant",
        time: { created: event.time, completed: child.updatedAt },
      },
      parts: [{
        id: `${messageId}:task`,
        messageID: messageId,
        sessionID: sessionId,
        type: "tool",
        tool: "task",
        state: {
          status,
          input: { description, prompt },
          output: `<task id="${child.sessionId}" state="${status}">`,
        },
      }],
    }];
  });
}

export function mapDeepSeekHarnessMessages(
  sessionId: string,
  history: DeepSeekHarnessHistory,
  summaries: DeepSeekHarnessSummary[] = [],
) {
  const taskMessages = new Map(
    subagentTaskMessages(sessionId, history, summaries).map((message) => [message.info.id, message]),
  );
  const messages: DeepSeekHarnessMessage[] = [];
  for (const { event } of history.events) {
    if (event.type === "tool/call" && isRecord(event.data) && typeof event.data.callId === "string") {
      const message = taskMessages.get(`dsh-subagent:${event.data.callId}`);
      if (message) messages.push(message);
      continue;
    }
    if (event.type === "user/message" || event.type === "assistant/message") {
      const message = messageFromEvent(sessionId, event);
      if (message) messages.push(message);
    }
  }
  return messages;
}

export function mapDeepSeekHarnessTodos(sessionId: string, history: DeepSeekHarnessHistory) {
  const event = [...history.events].reverse().find((entry) => entry.event.type === "todo/write")?.event;
  const data = event && isRecord(event.data) ? event.data : null;
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

export async function readDeepSeekHarnessHistory(
  runtime: DeepSeekHarnessRuntime,
  workspace: WorkspaceInfo,
  sessionId: string,
  limit?: number,
): Promise<DeepSeekHarnessHistory> {
  await readDeepSeekHarnessSession(runtime, workspace, sessionId);
  return readHistory(runtime, sessionId, limit);
}

export async function readDeepSeekHarnessMessages(
  runtime: DeepSeekHarnessRuntime,
  workspace: WorkspaceInfo,
  sessionId: string,
  limit?: number,
) {
  const entries = await readWorkspaceSummaries(runtime, workspace);
  if (!entries.some(({ summary }) => summary.sessionId === sessionId)) {
    throw new ApiError(404, "session_not_found", "Session not found");
  }
  const history = await readHistory(runtime, sessionId, limit);
  return mapDeepSeekHarnessMessages(sessionId, history, entries.map(({ summary }) => summary));
}

function readHistory(
  runtime: DeepSeekHarnessRuntime,
  sessionId: string,
  limit?: number,
): Promise<DeepSeekHarnessHistory> {
  return runtime.call<DeepSeekHarnessHistory>("session.history", {
    sessionId,
    ...(limit ? { maxMessages: limit } : {}),
  });
}

export async function readDeepSeekHarnessSnapshot(
  runtime: DeepSeekHarnessRuntime,
  workspace: WorkspaceInfo,
  sessionId: string,
  limit?: number,
) {
  const entries = await readWorkspaceSummaries(runtime, workspace);
  const entry = entries.find(({ summary }) => summary.sessionId === sessionId);
  if (!entry) throw new ApiError(404, "session_not_found", "Session not found");
  const session = mapSummary(entry.summary, entry.archived);
  const history = await readHistory(runtime, sessionId, limit);
  return {
    engineId: DEEPSEEK_HARNESS_ENGINE_ID,
    session,
    messages: mapDeepSeekHarnessMessages(sessionId, history, entries.map(({ summary }) => summary)),
    todos: mapDeepSeekHarnessTodos(sessionId, history),
    status: session.dsh.running ? { type: "busy" as const } : { type: "idle" as const },
    history,
  };
}
