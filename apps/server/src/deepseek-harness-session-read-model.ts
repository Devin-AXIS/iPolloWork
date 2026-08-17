import { resolve } from "node:path";

import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

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

type DeepSeekHarnessSummary = {
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
const LEGACY_SYSTEM_BLOCK = /^<system>\n[\s\S]*\n<\/system>$/u;

export type DeepSeekHarnessSessionInfo = {
  id: string;
  title: string;
  slug: string;
  parentID?: string;
  directory?: string;
  time: { created: number; updated: number; archived?: number };
  dsh: { running: boolean; agentPreset?: string; blank: boolean };
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

function mapSummary(summary: DeepSeekHarnessSummary, archived: boolean): DeepSeekHarnessSessionInfo {
  return {
    id: summary.sessionId,
    title: summaryTitle(summary),
    slug: summary.sessionId,
    ...(summary.parentSessionId ? { parentID: summary.parentSessionId } : {}),
    ...(summary.cwd ? { directory: summary.cwd } : {}),
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
  return content.filter((block, index) => {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return true;
    return index !== 0 || content.length === 1 || !LEGACY_SYSTEM_BLOCK.test(block.text.trim());
  });
}

function messageFromEvent(sessionId: string, event: DeepSeekHarnessEvent) {
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

export function mapDeepSeekHarnessMessages(sessionId: string, history: DeepSeekHarnessHistory) {
  return history.events.flatMap(({ event }) => {
    if (event.type !== "user/message" && event.type !== "assistant/message") return [];
    const message = messageFromEvent(sessionId, event);
    return message ? [message] : [];
  });
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
  const session = await readDeepSeekHarnessSession(runtime, workspace, sessionId);
  const history = await readHistory(runtime, sessionId, limit);
  return {
    engineId: DEEPSEEK_HARNESS_ENGINE_ID,
    session,
    messages: mapDeepSeekHarnessMessages(sessionId, history),
    todos: mapDeepSeekHarnessTodos(sessionId, history),
    status: session.dsh.running ? { type: "busy" as const } : { type: "idle" as const },
    history,
  };
}
