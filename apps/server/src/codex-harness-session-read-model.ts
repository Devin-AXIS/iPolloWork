import { CODEX_HARNESS_ENGINE_ID, codexNativePlanTodos, type SessionTokenMetering } from "@ipollowork/types/workspace";

import {
  isCodexUnmaterializedThreadError,
  type CodexHarnessRuntime,
} from "./codex-harness-runtime.js";
import { ApiError } from "./errors.js";
import { workspacePathMatches } from "./deepseek-harness-session-read-model.js";
import type { WorkspaceInfo } from "./types.js";

type CodexThreadItem = {
  type: string;
  id: string;
  clientId?: string | null;
  text?: string;
  phase?: "commentary" | "final_answer";
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
  senderThreadId?: string;
  receiverThreadIds?: string[];
  prompt?: string | null;
  agentsStates?: Record<string, { status: string; message?: string | null } | undefined>;
  kind?: "started" | "interacted" | "interrupted" | "completed";
  agentThreadId?: string;
  agentPath?: string;
};

type CodexTurn = {
  id: string;
  status: string;
  itemsView?: "notLoaded" | "summary" | "full";
  startedAt?: number | null;
  completedAt?: number | null;
  error?: { message?: string } | null;
  items: CodexThreadItem[];
};

export type CodexThread = SessionTokenMetering & {
  id: string;
  parentThreadId?: string | null;
  preview?: string;
  name?: string | null;
  source?: unknown;
  agentNickname?: string | null;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: { type?: string; activeFlags?: string[] };
  nativePlan?: { turnId: string; plan: unknown[] };
  historyMode?: "legacy" | "paginated";
  turns?: CodexTurn[];
};

type CodexThreadList = { data?: CodexThread[]; nextCursor?: string | null };

const TERMINAL_CODEX_TURN_STATUSES = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "canceled",
]);

const CODEX_NO_OUTPUT_ERROR = "Codex 已结束处理，但没有返回最终结果。请重试这条需求。";

function timestamp(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return Date.now();
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function threadTitle(thread: CodexThread): string {
  const source = isRecord(thread.source) ? thread.source : {};
  const agent = isRecord(source.subAgent) ? source.subAgent : {};
  const spawn = isRecord(agent.thread_spawn) ? agent.thread_spawn : {};
  return thread.name?.trim() || thread.preview?.trim().split(/\r?\n/u)[0]?.slice(0, 120)
    || nonEmptyString(spawn.agent_path)?.trim() || thread.agentNickname?.trim() || "New conversation";
}

function codexThreadRunStatus(thread: CodexThread) {
  if (thread.status?.type === "active") return { type: "busy" } as const;
  const latestTurn = thread.turns?.at(-1);
  if (latestTurn && (!TERMINAL_CODEX_TURN_STATUSES.has(latestTurn.status)
    || (latestTurn.completedAt === null && thread.status?.type !== "notLoaded"))) {
    return { type: "busy" } as const;
  }
  return { type: "idle" } as const;
}

export function mapCodexThread(thread: CodexThread, archived = false) {
  const created = timestamp(thread.createdAt);
  const updated = timestamp(thread.updatedAt ?? thread.createdAt);
  const source = isRecord(thread.source) && isRecord(thread.source.subAgent) ? thread.source.subAgent : null;
  const nativeRole = source && isRecord(source.thread_spawn) ? nonEmptyString(source.thread_spawn.agent_role) : undefined;
  return {
    id: thread.id,
    engineId: CODEX_HARNESS_ENGINE_ID,
    ...(thread.totalTokens !== undefined ? { totalTokens: thread.totalTokens } : {}),
    title: threadTitle(thread),
    status: codexThreadRunStatus(thread),
    slug: thread.id,
    ...(thread.parentThreadId ? { parentID: thread.parentThreadId } : {}),
    ...(thread.cwd ? { directory: thread.cwd } : {}),
    time: { created, updated, ...(archived ? { archived: updated } : {}) },
    codex: { status: thread.status?.type ?? "notLoaded", activeFlags: thread.status?.activeFlags ?? [], ...(thread.parentThreadId && source ? { subagent: true, ...(nativeRole ? { agentRole: nativeRole } : {}) } : {}) },
  };
}

function contentText(content: CodexThreadItem["content"]): string {
  return (content ?? []).flatMap((entry) => (
    typeof entry !== "string" && entry.type === "text" && typeof entry.text === "string" ? [entry.text] : []
  )).join("\n");
}

function dataUrlMediaType(url: string): string | undefined {
  return /^data:([^;,]+)[;,]/u.exec(url)?.[1];
}

function explicitMediaTypeFromContentEntry(entry: Record<string, unknown>): string | undefined {
  const source = isRecord(entry.source) ? entry.source : {};
  return nonEmptyString(entry.mediaType)
    ?? nonEmptyString(entry.media_type)
    ?? nonEmptyString(entry.mimeType)
    ?? nonEmptyString(entry.mime_type)
    ?? nonEmptyString(source.mediaType)
    ?? nonEmptyString(source.media_type);
}

function urlLooksLikeImage(url: string): boolean {
  const dataMediaType = dataUrlMediaType(url);
  if (dataMediaType) return dataMediaType.startsWith("image/");

  const path = url.split(/[?#]/u)[0]?.toLowerCase() ?? "";
  return path.endsWith(".jpg")
    || path.endsWith(".jpeg")
    || path.endsWith(".png")
    || path.endsWith(".gif")
    || path.endsWith(".webp");
}

function contentEntryLooksImage(entry: Record<string, unknown>, url: string): boolean {
  const type = nonEmptyString(entry.type);
  const mediaType = explicitMediaTypeFromContentEntry(entry);
  return type === "image"
    || type === "image_url"
    || type === "input_image"
    || mediaType?.startsWith("image/") === true
    || urlLooksLikeImage(url);
}

function sourceImageUrl(source: unknown): string | undefined {
  if (!isRecord(source) || source.type !== "base64") return undefined;
  const data = nonEmptyString(source.data);
  const mediaType = nonEmptyString(source.media_type) ?? nonEmptyString(source.mediaType);
  return data && mediaType?.startsWith("image/") === true ? `data:${mediaType};base64,${data}` : undefined;
}

function imageUrlFromContentEntry(entry: Record<string, unknown>): string | undefined {
  const directImageUrl = nonEmptyString(entry.image_url);
  if (directImageUrl) return directImageUrl;

  if (isRecord(entry.image_url)) {
    const nestedImageUrl = nonEmptyString(entry.image_url.url);
    if (nestedImageUrl) return nestedImageUrl;
  }

  const directUrl = nonEmptyString(entry.url);
  if (directUrl && contentEntryLooksImage(entry, directUrl)) return directUrl;

  return sourceImageUrl(entry.source);
}

function mediaTypeFromContentEntry(entry: Record<string, unknown>, url: string): string {
  const explicit = explicitMediaTypeFromContentEntry(entry);
  if (explicit) return explicit;

  const dataMediaType = dataUrlMediaType(url);
  if (dataMediaType) return dataMediaType;

  const path = url.split(/[?#]/u)[0]?.toLowerCase() ?? "";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/*";
}

function imageFileParts(content: CodexThreadItem["content"]) {
  return (content ?? []).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = imageUrlFromContentEntry(entry);
    if (!url) return [];
    const filename = nonEmptyString(entry.filename) ?? nonEmptyString(entry.name);
    return [{
      type: "file",
      url,
      mediaType: mediaTypeFromContentEntry(entry, url),
      ...(filename ? { filename } : {}),
    }];
  });
}

function messagePart(item: CodexThreadItem, parentSessionId: string) {
  if (item.type === "userMessage" || item.type === "agentMessage" || item.type === "plan") {
    const text = item.text ?? contentText(item.content);
    const textParts = text ? [{ type: "text", text }] : [];
    return item.type === "userMessage" ? [...textParts, ...imageFileParts(item.content)] : textParts;
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
  if (item.type === "subAgentActivity" && item.agentThreadId) {
    const delegationStatus = item.kind === "completed" ? "completed" : item.kind === "interrupted" ? "failed" : "running";
    return [{
      type: "tool",
      tool: "task",
      callID: item.id,
      state: {
        status: item.kind === "completed" ? "completed" : item.kind === "interrupted" ? "error" : "running",
        input: { description: item.agentPath ?? "", task_id: item.agentThreadId },
        output: `<task id="${item.agentThreadId}" state="${delegationStatus}"></task>`,
        metadata: { sessionId: item.agentThreadId, parentSessionId, nativeTool: "subAgentActivity", nativeKind: item.kind, delegationStatus },
        ...(item.kind === "interrupted" ? { error: "Codex interrupted this agent" } : {}),
      },
    }];
  }
  if (item.type === "collabAgentToolCall") {
    return (item.receiverThreadIds ?? []).map((childSessionId) => {
      const agent = item.agentsStates?.[childSessionId];
      const delegationStatus = agent?.status === "completed"
        ? "completed"
        : agent?.status === "running"
          ? "running"
          : agent?.status === "errored" || agent?.status === "interrupted"
            ? "failed"
            : "unknown";
      return {
        type: "tool",
        tool: "task",
        callID: `${item.id}:${childSessionId}`,
        state: {
          status: item.status === "completed" ? "completed" : item.status === "failed" || item.status === "interrupted" ? "error" : "running",
          input: { prompt: item.prompt ?? "" },
          output: `<task id="${childSessionId}" state="${delegationStatus}">${agent?.message ?? ""}</task>`,
          metadata: {
            sessionId: childSessionId,
            nativeTool: item.tool,
            delegationStatus,
            ...(item.tool === "spawnAgent" && item.senderThreadId
              ? { parentSessionId: item.senderThreadId }
              : {}),
          },
          ...(item.status === "failed" || item.status === "interrupted" ? { error: "Codex collaboration call did not complete" } : {}),
        },
      };
    });
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
  return (thread.turns ?? []).flatMap((turn) => {
    const userItem = turn.items.find((item) => item.type === "userMessage");
    const parentUserMessageId = userItem
      ? userItem.clientId?.trim() || userItem.id
      : undefined;
    const hasVisibleResult = turn.items.some((item) => (
      (item.type === "plan" || (item.type === "agentMessage" && item.phase !== "commentary"))
      && Boolean((item.text ?? contentText(item.content)).trim())
    ));
    const settled = TERMINAL_CODEX_TURN_STATUSES.has(turn.status) && turn.completedAt !== null;
    const outcomeError = settled && turn.status === "failed"
      ? turn.error?.message || "Codex turn failed"
      : settled && turn.status === "completed" && turn.itemsView !== "notLoaded" && turn.itemsView !== "summary" && !hasVisibleResult
        ? CODEX_NO_OUTPUT_ERROR
        : null;
    const mapped = turn.items.flatMap((item) => {
      const role = item.type === "userMessage" ? "user" : "assistant";
      const parts = messagePart(item, thread.id);
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
          ...(item.type === "agentMessage" && item.phase ? { codexPhase: item.phase } : {}),
          ...(role === "assistant" && parentUserMessageId ? { parentID: parentUserMessageId } : {}),
          time: { created, ...(settled ? { completed } : {}) },
          ...(role === "assistant" && outcomeError
            ? { error: { name: "CodexError", data: { message: outcomeError } } }
            : {}),
        },
        parts: parts.map((part, index) => ({
          ...part,
          // Snapshots and live Codex deltas describe the same assistant part.
          id: role === "assistant" && (part.type === "text" || part.type === "reasoning")
            ? `${messageId}:${part.type}`
            : `${messageId}:${index}`,
          messageID: messageId,
          sessionID: thread.id,
        })),
      }];
    });
    if (!outcomeError || mapped.some((message) => message.info.role === "assistant")) return mapped;
    const completed = timestamp(turn.completedAt ?? turn.startedAt ?? thread.updatedAt);
    return [...mapped, {
      info: {
        id: `codex-turn-outcome:${turn.id}`,
        sessionID: thread.id,
        role: "assistant",
        ...(parentUserMessageId ? { parentID: parentUserMessageId } : {}),
        time: { created: completed, completed },
        error: { name: "CodexError", data: { message: outcomeError } },
      },
      parts: [],
    }];
  });
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
      sourceKinds: ["cli", "vscode", "appServer", "subAgent", "subAgentThreadSpawn"],
      ...(search?.trim() ? { searchTerm: search.trim() } : {}),
    });
    items.push(...(response.data ?? []));
    cursor = response.nextCursor ?? null;
  } while (cursor && items.length < 500);
  return items;
}

type CodexThreadEntry = { thread: CodexThread; archived: boolean };

function uniqueThreads(entries: CodexThreadEntry[]): CodexThreadEntry[] {
  const unique = new Map<string, CodexThreadEntry>();
  for (const entry of entries) if (!unique.has(entry.thread.id)) unique.set(entry.thread.id, entry);
  return Array.from(unique.values());
}

async function listNativeDescendants(
  runtime: CodexHarnessRuntime,
  workspace: WorkspaceInfo,
  roots: CodexThreadEntry[],
): Promise<CodexThreadEntry[]> {
  // Current native listings require an ancestor filter to include spawned
  // threads. Keep broad overview discovery bounded; direct child reads use
  // their verified native parent chain independently of this recent window.
  const queue = roots.filter(({ thread }) => !thread.parentThreadId && workspacePathMatches(thread.cwd, workspace.path))
    .slice(0, 32).flatMap(({ thread }) => [false, true].map((archived) => ({ rootId: thread.id, archived, cursor: null as string | null, cursors: new Set<string>() })));
  const candidates: Array<CodexThreadEntry & { rootId: string }> = [];
  let remaining = 500;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (queue.length && remaining > 0) {
      const query = queue.shift();
      if (!query) return;
      const limit = Math.min(100, remaining);
      remaining -= limit;
      try {
        const response = await runtime.call<CodexThreadList>("thread/list", {
          ancestorThreadId: query.rootId, archived: query.archived, cursor: query.cursor, limit,
          modelProviders: [], sourceKinds: ["subAgent", "subAgentThreadSpawn"],
        });
        const page = (response.data ?? []).slice(0, limit);
        remaining += limit - page.length;
        candidates.push(...page.map((thread) => ({ thread, archived: query.archived, rootId: query.rootId })));
        if (response.nextCursor && !query.cursors.has(response.nextCursor)) {
          query.cursors.add(response.nextCursor);
          queue.unshift({ ...query, cursor: response.nextCursor });
        }
      } catch {
        remaining += limit;
        // A root can disappear while listing; keep healthy roots available.
      }
    }
  }));
  const threads = new Map([...roots, ...candidates].map(({ thread }) => [thread.id, thread]));
  return candidates.filter(({ thread, rootId }) => {
    const visited = new Set<string>();
    let current = thread;
    while (current && visited.size < 16 && !visited.has(current.id)) {
      if (!workspacePathMatches(current.cwd, workspace.path)) return false;
      if (current.id === rootId) return thread.id !== rootId;
      visited.add(current.id);
      if (!current.parentThreadId) return false;
      current = threads.get(current.parentThreadId)!;
    }
    return false;
  }).map(({ thread, archived }) => ({ thread, archived }));
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
  let entries: CodexThreadEntry[] = uniqueThreads([
    ...active.map((thread) => ({ thread, archived: false })),
    ...archived.map((thread) => ({ thread, archived: true })),
  ]);
  entries.sort((left, right) => timestamp(right.thread.updatedAt) - timestamp(left.thread.updatedAt));
  if (input.roots) entries = entries.filter(({ thread }) => !thread.parentThreadId);
  else entries.push(...await listNativeDescendants(runtime, workspace, entries));
  entries = uniqueThreads(entries);
  entries.sort((left, right) => timestamp(right.thread.updatedAt) - timestamp(left.thread.updatedAt));
  entries = entries.slice(0, 500);
  const start = input.start ?? 0;
  const end = input.limit ? start + input.limit : undefined;
  return entries.slice(start, end).map(({ thread, archived: isArchived }) => mapCodexThread({
    ...thread,
    cwd: thread.cwd ?? workspace.path,
  }, isArchived));
}

async function readPaginatedCodexTurns(runtime: CodexHarnessRuntime, threadId: string): Promise<CodexTurn[]> {
  const turns = new Map<string, CodexTurn>();
  let cursor: string | null = null;
  for (let page = 0; page < 2; page++) {
    const response: { data: CodexTurn[]; nextCursor?: string | null } = await runtime.call("thread/turns/list", {
      threadId, cursor, limit: 50, sortDirection: "desc", itemsView: "notLoaded",
    });
    if (!Array.isArray(response.data)) throw new ApiError(502, "codex_harness_invalid_response", "Codex returned invalid turn history");
    for (const turn of response.data) turns.set(turn.id, { ...turn, items: [], itemsView: "notLoaded" });
    if (!response.nextCursor) break;
    if (response.nextCursor === cursor) throw new ApiError(502, "codex_harness_invalid_response", "Codex repeated a history cursor");
    cursor = response.nextCursor;
  }
  if (!turns.size) return [];
  cursor = null;
  let oldestLoadedTurn: string | null = null;
  let complete = false;
  for (let page = 0; page < 10; page++) {
    const response: { data: Array<{ turnId: string; item: CodexThreadItem }>; nextCursor?: string | null } = await runtime.call("thread/items/list", {
      threadId, cursor, limit: 200, sortDirection: "desc",
    });
    if (!Array.isArray(response.data)) throw new ApiError(502, "codex_harness_invalid_response", "Codex returned invalid item history");
    for (const entry of response.data) {
      const turn = turns.get(entry.turnId);
      if (!turn) continue;
      turn.items.push(entry.item);
      turn.itemsView = "full";
      oldestLoadedTurn = turn.id;
    }
    if (!response.nextCursor) { complete = true; break; }
    if (response.nextCursor === cursor) throw new ApiError(502, "codex_harness_invalid_response", "Codex repeated a history cursor");
    cursor = response.nextCursor;
  }
  for (const turn of turns.values()) {
    turn.items.reverse();
    if (complete) turn.itemsView = "full";
    else if (turn.id === oldestLoadedTurn) turn.itemsView = "summary";
  }
  return [...turns.values()].reverse();
}

export async function readCodexHarnessThread(runtime: CodexHarnessRuntime, threadId: string): Promise<CodexThread> {
  const knownUnstarted = runtime.isAwaitingFirstTurn(threadId);
  const metadata = await runtime.call<{ thread?: CodexThread }>("thread/read", { threadId, includeTurns: false });
  if (!metadata.thread?.id) throw new ApiError(404, "session_not_found", "Session not found");
  // First input can arrive while this metadata read is in flight.
  if (knownUnstarted && runtime.isAwaitingFirstTurn(threadId)) return metadata.thread;
  try {
    if (metadata.thread.historyMode === "paginated") {
      return { ...metadata.thread, turns: await readPaginatedCodexTurns(runtime, threadId) };
    }
    const response = await runtime.call<{ thread?: CodexThread }>("thread/read", { threadId, includeTurns: true });
    if (!response.thread?.id) throw new ApiError(404, "session_not_found", "Session not found");
    return response.thread;
  } catch (error) {
    // The native missing-rollout response is authoritative for an unmaterialized
    // thread. Other history failures must never erase existing output.
    if (!isCodexUnmaterializedThreadError(error)) throw error;
    return metadata.thread;
  }
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
    todos: thread.nativePlan && thread.nativePlan.turnId === thread.turns?.at(-1)?.id
      ? codexNativePlanTodos(threadId, thread.nativePlan.turnId, thread.nativePlan.plan) : [],
    status: codexThreadRunStatus(thread),
  };
}
