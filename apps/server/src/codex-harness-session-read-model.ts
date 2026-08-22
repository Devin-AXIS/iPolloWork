import {
  isCodexUnmaterializedThreadError,
  type CodexHarnessRuntime,
} from "./codex-harness-runtime.js";
import { ApiError } from "./errors.js";
import type { WorkspaceInfo } from "./types.js";

type CodexThreadItem = {
  type: string;
  id: string;
  clientId?: string | null;
  text?: string;
  content?: Array<Record<string, unknown> | string>;
  summary?: string[];
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string | null;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  changes?: unknown;
};

type CodexTurn = {
  id: string;
  status: string;
  startedAt?: number | null;
  completedAt?: number | null;
  error?: { message?: string } | null;
  items: CodexThreadItem[];
};

export type CodexThread = {
  id: string;
  parentThreadId?: string | null;
  preview?: string;
  name?: string | null;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: { type?: string };
  turns?: CodexTurn[];
};

type CodexThreadList = { data?: CodexThread[]; nextCursor?: string | null };

function timestamp(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return Date.now();
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function threadTitle(thread: CodexThread): string {
  return thread.name?.trim() || thread.preview?.trim().split(/\r?\n/u)[0]?.slice(0, 120) || "New conversation";
}

export function mapCodexThread(thread: CodexThread, archived = false) {
  const created = timestamp(thread.createdAt);
  const updated = timestamp(thread.updatedAt ?? thread.createdAt);
  return {
    id: thread.id,
    title: threadTitle(thread),
    slug: thread.id,
    ...(thread.parentThreadId ? { parentID: thread.parentThreadId } : {}),
    ...(thread.cwd ? { directory: thread.cwd } : {}),
    time: { created, updated, ...(archived ? { archived: updated } : {}) },
    codex: { status: thread.status?.type ?? "notLoaded" },
  };
}

function contentText(content: CodexThreadItem["content"]): string {
  return (content ?? []).flatMap((entry) => (
    typeof entry !== "string" && entry.type === "text" && typeof entry.text === "string" ? [entry.text] : []
  )).join("\n");
}

function userContentText(content: CodexThreadItem["content"]): string {
  return (content ?? []).flatMap((entry) => (
    typeof entry !== "string" && entry.type === "text" && typeof entry.text === "string" ? [entry.text] : []
  )).join("\n");
}

function messagePart(item: CodexThreadItem) {
  if (item.type === "userMessage" || item.type === "agentMessage") {
    const text = item.text ?? (item.type === "userMessage" ? userContentText(item.content) : contentText(item.content));
    return text ? [{ type: "text", text }] : [];
  }
  if (item.type === "reasoning") {
    const text = [...(item.summary ?? []), ...(item.content?.flatMap((entry) => (
      typeof entry === "string" ? [entry] : typeof entry.text === "string" ? [entry.text] : []
    )) ?? [])].join("\n");
    return text ? [{ type: "reasoning", text }] : [];
  }
  if (item.type === "commandExecution") {
    return [{
      type: "tool",
      tool: "bash",
      callID: item.id,
      state: item.status === "completed"
        ? { status: "completed", input: { command: item.command ?? "" }, output: item.aggregatedOutput ?? "" }
        : item.status === "failed"
          ? { status: "error", input: { command: item.command ?? "" }, error: item.aggregatedOutput ?? "Command failed" }
          : { status: "running", input: { command: item.command ?? "" } },
    }];
  }
  if (item.type === "mcpToolCall") {
    return [{
      type: "tool",
      tool: `${item.server ?? "mcp"}.${item.tool ?? "tool"}`,
      callID: item.id,
      state: item.status === "completed"
        ? { status: "completed", input: item.arguments ?? {}, output: item.result ?? "" }
        : item.status === "failed"
          ? { status: "error", input: item.arguments ?? {}, error: item.error ?? "MCP call failed" }
          : { status: "running", input: item.arguments ?? {} },
    }];
  }
  if (item.type === "fileChange") {
    return [{
      type: "tool",
      tool: "apply_patch",
      callID: item.id,
      state: { status: "completed", input: {}, output: item.changes ?? "Files updated" },
    }];
  }
  return [];
}

export function mapCodexMessages(thread: CodexThread) {
  return (thread.turns ?? []).flatMap((turn) => turn.items.flatMap((item) => {
    const role = item.type === "userMessage" ? "user" : "assistant";
    const parts = messagePart(item);
    if (!parts.length) return [];
    const messageId = item.type === "userMessage" && item.clientId?.trim()
      ? item.clientId.trim()
      : item.id;
    const created = timestamp(turn.startedAt ?? thread.createdAt);
    const completed = timestamp(turn.completedAt ?? turn.startedAt ?? thread.updatedAt);
    return [{
      info: {
        id: messageId,
        sessionID: thread.id,
        role,
        time: { created, completed },
        ...(turn.status === "failed" ? { error: { name: "CodexError", data: { message: turn.error?.message } } } : {}),
      },
      parts: parts.map((part, index) => ({
        ...part,
        id: `${messageId}:${index}`,
        messageID: messageId,
        sessionID: thread.id,
      })),
    }];
  }));
}

async function listPages(
  runtime: CodexHarnessRuntime,
  archived: boolean,
  search?: string,
): Promise<CodexThread[]> {
  const items: CodexThread[] = [];
  let cursor: string | null = null;
  do {
    const response: CodexThreadList = await runtime.call<CodexThreadList>("thread/list", {
      cursor,
      limit: 100,
      archived,
      modelProviders: [],
      sourceKinds: ["cli", "vscode"],
      ...(search?.trim() ? { searchTerm: search.trim() } : {}),
    });
    items.push(...(response.data ?? []));
    cursor = response.nextCursor ?? null;
  } while (cursor && items.length < 500);
  return items;
}

export async function listCodexHarnessSessions(
  runtime: CodexHarnessRuntime,
  workspace: WorkspaceInfo,
  input: { roots?: boolean; start?: number; search?: string; limit?: number },
) {
  const [active, archived] = await Promise.all([
    listPages(runtime, false, input.search),
    listPages(runtime, true, input.search),
  ]);
  let entries = [
    ...active.map((thread) => ({ thread, archived: false })),
    ...archived.map((thread) => ({ thread, archived: true })),
  ];
  if (input.roots) entries = entries.filter(({ thread }) => !thread.parentThreadId);
  entries.sort((left, right) => timestamp(right.thread.updatedAt) - timestamp(left.thread.updatedAt));
  const start = input.start ?? 0;
  const end = input.limit ? start + input.limit : undefined;
  return entries.slice(start, end).map(({ thread, archived: isArchived }) => mapCodexThread({
    ...thread,
    cwd: thread.cwd ?? workspace.path,
  }, isArchived));
}

export async function readCodexHarnessThread(runtime: CodexHarnessRuntime, threadId: string): Promise<CodexThread> {
  let response: { thread?: CodexThread };
  try {
    response = await runtime.call<{ thread?: CodexThread }>("thread/read", {
      threadId,
      includeTurns: true,
    });
  } catch (error) {
    if (!isCodexUnmaterializedThreadError(error)) throw error;
    response = await runtime.call<{ thread?: CodexThread }>("thread/read", {
      threadId,
      includeTurns: false,
    });
  }
  if (!response.thread?.id) throw new ApiError(404, "session_not_found", "Session not found");
  return response.thread;
}

export async function readCodexHarnessSession(runtime: CodexHarnessRuntime, threadId: string) {
  return mapCodexThread(await readCodexHarnessThread(runtime, threadId));
}

export async function readCodexHarnessMessages(runtime: CodexHarnessRuntime, threadId: string, limit?: number) {
  const messages = mapCodexMessages(await readCodexHarnessThread(runtime, threadId));
  return typeof limit === "number" ? messages.slice(-limit) : messages;
}

export async function readCodexHarnessSnapshot(runtime: CodexHarnessRuntime, threadId: string, limit?: number) {
  const thread = await readCodexHarnessThread(runtime, threadId);
  const messages = mapCodexMessages(thread);
  return {
    session: mapCodexThread(thread),
    messages: typeof limit === "number" ? messages.slice(-limit) : messages,
    todos: [],
    status: thread.status?.type === "active" ? { type: "busy" } : { type: "idle" },
  };
}
