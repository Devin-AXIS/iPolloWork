import type { UIMessage, UIMessageChunk } from "ai";

import type { ModelRef, SlashCommandOption, TodoItem } from "@/app/types";

export type ConversationStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

export type ConversationSession = {
  [key: string]: unknown;
  id: string;
  title: string;
  slug?: string | null;
  parentID?: string | null;
  directory?: string | null;
  time?: {
    created?: number | null;
    updated?: number | null;
    archived?: number | null;
  };
  revertMessageId?: string | null;
};

export type ConversationSessionUpdate = Partial<ConversationSession> & Pick<ConversationSession, "id">;

/**
 * Apply a live engine update without discarding native session metadata that
 * was omitted from the event. Harness lifecycle events intentionally publish
 * small `dsh`/`codex` patches instead of repeating the full session snapshot.
 */
export function mergeConversationSessionUpdate<T extends ConversationSession>(
  current: T,
  update: ConversationSessionUpdate,
): T {
  const mergeRecord = (key: "dsh" | "codex") => {
    const previous = recordValue(current[key]);
    const next = recordValue(update[key]);
    return next ? { ...(previous ?? {}), ...next } : update[key];
  };
  return {
    ...current,
    ...update,
    ...(update.time ? { time: { ...(current.time ?? {}), ...update.time } } : {}),
    ...(update.dsh !== undefined ? { dsh: mergeRecord("dsh") } : {}),
    ...(update.codex !== undefined ? { codex: mergeRecord("codex") } : {}),
  } as T;
}

export type ConversationContextUsage = {
  usedTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  contextWindow?: number;
};

export const CONTEXT_COMPRESSION_WARNING_PERCENT = 80;

export function formatContextTokenCount(value: number): string {
  if (value >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 100 || Number.isInteger(scaled) ? scaled.toFixed(0) : scaled.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled >= 100 || Number.isInteger(scaled) ? scaled.toFixed(0) : scaled.toFixed(1)}K`;
  }
  return String(Math.max(0, Math.round(value)));
}

export function resolveConversationContextHealth(
  usage: ConversationContextUsage | null | undefined,
  modelContextWindow: number | null | undefined,
) {
  const usedTokens = Math.max(0, Math.round(usage?.usedTokens ?? 0));
  const contextWindowCandidate = usage?.contextWindow ?? modelContextWindow;
  const contextWindow = typeof contextWindowCandidate === "number"
    && Number.isFinite(contextWindowCandidate)
    && contextWindowCandidate > 0
    ? Math.round(contextWindowCandidate)
    : null;
  const percentage = contextWindow
    ? Math.max(0, Math.round((usedTokens / contextWindow) * 100))
    : null;
  return {
    usedTokens,
    contextWindow,
    percentage,
    compressionWarning: percentage !== null && percentage >= CONTEXT_COMPRESSION_WARNING_PERCENT,
  };
}

export type ConversationSnapshot = {
  session: ConversationSession;
  messages: UIMessage[];
  todos: TodoItem[];
  status: ConversationStatus;
  contextUsage?: ConversationContextUsage;
};

function finiteTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function conversationContextUsageFromTokens(
  value: unknown,
  options: { contextWindow?: unknown; cachedInputIncluded?: boolean } = {},
): ConversationContextUsage | undefined {
  const tokens = recordValue(value);
  if (!tokens) return undefined;
  const cache = recordValue(tokens.cache);
  const inputTokens = finiteTokenCount(tokens.input) ?? finiteTokenCount(tokens.inputTokens);
  const outputTokens = finiteTokenCount(tokens.output) ?? finiteTokenCount(tokens.outputTokens);
  const cacheReadTokens = finiteTokenCount(cache?.read) ?? finiteTokenCount(tokens.cachedInputTokens);
  const contextWindow = finiteTokenCount(options.contextWindow)
    ?? finiteTokenCount(tokens.contextWindow)
    ?? finiteTokenCount(tokens.modelContextWindow);
  const usedTokens = (inputTokens ?? 0)
    + (options.cachedInputIncluded ? 0 : cacheReadTokens ?? 0);
  if (usedTokens <= 0 && !contextWindow) return undefined;
  return {
    usedTokens,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(contextWindow ? { contextWindow } : {}),
  };
}

export function conversationMessageContextUsage(message: UIMessage): ConversationContextUsage | undefined {
  const metadata = recordValue(message.metadata);
  const ipollowork = recordValue(metadata?.ipollowork);
  const usage = recordValue(ipollowork?.contextUsage);
  const usedTokens = finiteTokenCount(usage?.usedTokens);
  if (usedTokens === undefined) return undefined;
  const inputTokens = finiteTokenCount(usage?.inputTokens);
  const outputTokens = finiteTokenCount(usage?.outputTokens);
  const cacheReadTokens = finiteTokenCount(usage?.cacheReadTokens);
  const contextWindow = finiteTokenCount(usage?.contextWindow);
  return {
    usedTokens,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(contextWindow ? { contextWindow } : {}),
  };
}

export function conversationMessageParentUserMessageId(message: UIMessage): string | null {
  const metadata = recordValue(message.metadata);
  const ipollowork = recordValue(metadata?.ipollowork);
  const parentUserMessageId = ipollowork?.parentUserMessageId;
  return typeof parentUserMessageId === "string" && parentUserMessageId.trim()
    ? parentUserMessageId.trim()
    : null;
}

export function conversationMessageCreatedAt(
  message: Pick<UIMessage, "metadata">,
): number | null {
  const metadata = recordValue(message.metadata);
  const ipollowork = recordValue(metadata?.ipollowork);
  const created = ipollowork?.created;
  return typeof created === "number" && Number.isFinite(created) ? created : null;
}

export type ConversationPermission = {
  id: string;
  sessionId: string;
  kind: string;
  resources: string[];
  remember: string[];
  metadata: Record<string, unknown>;
  receivedAt: number;
  native: unknown;
};

export type ConversationQuestionOption = {
  label: string;
  description?: string;
};

export type ConversationQuestionInfo = {
  header?: string;
  question: string;
  options: ConversationQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

export type ConversationQuestion = {
  id: string;
  sessionId: string;
  questions: ConversationQuestionInfo[];
  receivedAt: number;
  native: unknown;
};

export type ConversationAgent = {
  name: string;
  description?: string;
  hidden?: boolean;
  mode?: string;
};

export type ConversationModeIcon = "execute" | "plan" | "code" | "minimal" | "create";

export type ConversationMode = {
  id: string;
  label: string;
  description?: string;
  icon: ConversationModeIcon;
  isDefault?: boolean;
};

export type ConversationModeState = {
  id: string | null;
  mutable: boolean;
};

export type ConversationAccessModeIcon = "read-only" | "workspace" | "ask" | "full-access";

export type ConversationAccessMode = {
  id: string;
  label: string;
  description?: string;
  icon: ConversationAccessModeIcon;
  isDefault?: boolean;
  dangerous?: boolean;
  selectable?: boolean;
};

export type ConversationAccessModeState = {
  id: string | null;
  mutable: boolean;
};

export type ConversationPromptPart =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "file"; mime: string; url: string; filename?: string }
  | { type: "agent"; name: string };

export type ConversationMessageChunk = Extract<
  UIMessageChunk,
  { type: "text-delta" | "reasoning-delta" }
>;

export function conversationMessageMetadata(
  timing: { created?: number; completed?: number },
  extra: Record<string, unknown> = {},
): UIMessage["metadata"] | undefined {
  const ipollowork = {
    ...(typeof timing.created === "number" ? { created: timing.created } : {}),
    ...(typeof timing.completed === "number" ? { completed: timing.completed } : {}),
    ...extra,
  };
  return Object.keys(ipollowork).length > 0 ? { ipollowork } : undefined;
}

export function completeConversationMessage(message: UIMessage, completedAt: number): UIMessage {
  const metadata = message.metadata && typeof message.metadata === "object"
    ? message.metadata
    : {};
  const existing = "ipollowork" in metadata && metadata.ipollowork && typeof metadata.ipollowork === "object"
    ? metadata.ipollowork
    : {};
  return {
    ...message,
    metadata: {
      ...metadata,
      ipollowork: { ...existing, completed: completedAt },
    },
    parts: message.parts.map((part) =>
      part.type === "text" || part.type === "reasoning"
        ? { ...part, state: "done" as const }
        : part,
    ),
  };
}

export type ConversationEvent =
  | { type: "session.updated"; sessionId: string; info: ConversationSessionUpdate }
  | { type: "context.updated"; sessionId: string; usage: ConversationContextUsage }
  | { type: "session.deleted"; sessionId: string }
  | { type: "session.error"; sessionId: string; errorText: string; parentUserMessageId?: string }
  | { type: "session.compaction"; sessionId: string; running: boolean }
  | { type: "session.status"; sessionId: string; status: ConversationStatus }
  | { type: "session.idle"; sessionId: string }
  | { type: "todo.updated"; sessionId: string; todos: TodoItem[] }
  | { type: "permission.asked"; permission: ConversationPermission }
  | { type: "permission.replied"; sessionId: string; requestId: string }
  | { type: "question.asked"; question: ConversationQuestion }
  | { type: "question.replied"; sessionId: string; requestId: string }
  | { type: "message.upsert"; sessionId: string; message: UIMessage }
  | {
      type: "message.completed";
      sessionId: string;
      messageId: string;
      completedAt: number;
      parentUserMessageId?: string;
    }
  | { type: "message.removed"; sessionId: string; messageId: string }
  | {
      type: "message.parts";
      sessionId: string;
      messageId: string;
      partId: string;
      parts: UIMessage["parts"];
      messageRole?: UIMessage["role"];
      parentUserMessageId?: string;
      visibleAssistantOutput: boolean;
    }
  | {
      type: "message.chunk";
      sessionId: string;
      messageId: string;
      parentUserMessageId?: string;
      chunk: ConversationMessageChunk;
    };

export type ConversationSubscribeInput = {
  signal: AbortSignal;
  onEvent: (event: ConversationEvent) => void;
};

export type ConversationPromptInput = {
  sessionId: string;
  clientUserMessageId?: string;
  signal?: AbortSignal;
  parts: ConversationPromptPart[];
  model?: ModelRef;
  mode?: string;
  variant?: string;
  reasoningEffort?: string;
  system?: string;
};

export type ConversationPromptResult = {
  sessionId: string;
};

export async function waitForConversationIdle(
  readIdle: () => Promise<boolean>,
  timeoutMs = 12_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let delayMs = 100;
  while (true) {
    if (await readIdle()) return true;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)));
    delayMs = Math.min(delayMs * 2, 1_000);
  }
}

export interface ConversationEngineConnection {
  mapSnapshot(snapshot: unknown): ConversationSnapshot;
  modeState?(session: ConversationSession): ConversationModeState;
  accessModeState?(session: ConversationSession): ConversationAccessModeState;
  subscribe(input: ConversationSubscribeInput): Promise<void>;
  listPermissions(input: { sessionId: string; directory?: string }): Promise<ConversationPermission[]>;
  replyPermission(input: {
    permission: ConversationPermission;
    reply: "once" | "always" | "reject";
    directory?: string;
  }): Promise<void>;
  listQuestions(input: { sessionId: string; directory?: string }): Promise<ConversationQuestion[]>;
  replyQuestion(input: {
    question: ConversationQuestion;
    answers: string[][];
    directory?: string;
  }): Promise<void>;
  create(directory?: string): Promise<ConversationSession>;
  abort(sessionId: string, directory?: string): Promise<boolean>;
  revert(sessionId: string, messageId: string): Promise<ConversationSession>;
  fork(input: {
    sessionId: string;
    messageId: string | null;
    messages: UIMessage[];
  }): Promise<ConversationSession>;
  rename(sessionId: string, title: string, directory?: string): Promise<void>;
  setArchived(sessionId: string, archived: boolean, directory?: string): Promise<void>;
  shell(sessionId: string, command: string): Promise<void>;
  runCommand(input: {
    sessionId: string;
    command: string;
    arguments: string;
    model?: ModelRef;
    mode?: string;
    directory?: string;
    reasoningEffort?: string;
  }): Promise<void>;
  sendPrompt(input: ConversationPromptInput): Promise<ConversationPromptResult>;
  listCommands(directory?: string): Promise<SlashCommandOption[]>;
  listModes(): Promise<ConversationMode[]>;
  listAccessModes?(input: { sessionId: string; directory?: string }): Promise<ConversationAccessMode[]>;
  setAccessMode?(input: { sessionId: string; accessMode: string; directory?: string }): Promise<void>;
  listAgents(): Promise<ConversationAgent[]>;
  searchFiles(query: string, directory?: string): Promise<string[]>;
}

export interface ConversationEngineAdapter {
  readonly id: string;
  connect(input: ConversationEngineConnectInput): ConversationEngineConnection;
}

export type ConversationEngineConnectInput = {
  baseUrl: string;
  token?: string;
  directory?: string;
  serverBaseUrl?: string;
  workspaceId?: string;
};

function permissionMemoryScope(permission: ConversationPermission): string {
  return permission.kind.trim().toLowerCase();
}

type PermissionMemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const SESSION_PERMISSION_MEMORY_STORAGE_KEY = "ipollowork.session-permission-memory.v1";
const MAX_PERSISTED_PERMISSION_SESSIONS = 250;

function browserPermissionMemoryStorage(): PermissionMemoryStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readPersistedPermissionMemory(
  storage: PermissionMemoryStorage,
): Map<string, Set<string>> {
  const entries = new Map<string, Set<string>>();
  try {
    const raw = storage.getItem(SESSION_PERMISSION_MEMORY_STORAGE_KEY);
    if (!raw) return entries;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return entries;
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || !Array.isArray(value)) continue;
      const scopes = value.filter((scope): scope is string => (
        typeof scope === "string" && Boolean(scope.trim())
      ));
      if (scopes.length > 0) entries.set(key, new Set(scopes));
    }
  } catch {
    return entries;
  }
  return entries;
}

function writePersistedPermissionMemory(
  storage: PermissionMemoryStorage,
  entries: Map<string, Set<string>>,
): void {
  try {
    if (entries.size === 0) {
      storage.removeItem(SESSION_PERMISSION_MEMORY_STORAGE_KEY);
      return;
    }
    storage.setItem(
      SESSION_PERMISSION_MEMORY_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(
        [...entries].map(([key, scopes]) => [key, [...scopes]]),
      )),
    );
  } catch {
    // Keep the in-memory fallback working if storage is unavailable or full.
  }
}

function updatePersistedPermissionMemory(
  storage: PermissionMemoryStorage | null,
  key: string,
  scopes: Set<string> | null,
): void {
  if (!storage) return;
  const entries = readPersistedPermissionMemory(storage);
  entries.delete(key);
  if (scopes?.size) entries.set(key, new Set(scopes));
  while (entries.size > MAX_PERSISTED_PERMISSION_SESSIONS) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
  writePersistedPermissionMemory(storage, entries);
}

function permissionMemorySessionKey(
  adapterId: string,
  input: ConversationEngineConnectInput,
  sessionId: string,
): string {
  const workspaceScope = input.workspaceId?.trim()
    || input.directory?.trim()
    || input.baseUrl.trim();
  return JSON.stringify([adapterId.trim(), workspaceScope, sessionId.trim()]);
}

/**
 * Preserve an explicit "always" decision for the lifetime of its task even
 * when an engine only supports one-shot approvals or its client reconnects.
 * Native engines still receive the original decision first; this layer is the
 * shared compatibility fallback for subsequent requests of the same kind.
 */
export function withSessionPermissionMemory(
  adapter: ConversationEngineAdapter,
  storageOverride?: PermissionMemoryStorage,
): ConversationEngineAdapter {
  const scopesBySession = new Map<string, Set<string>>();

  return {
    id: adapter.id,
    connect(input) {
      const connection = adapter.connect(input);
      const storage = storageOverride ?? browserPermissionMemoryStorage();
      const automaticReplies = new Map<string, Promise<boolean>>();
      const sessionKey = (sessionId: string) => permissionMemorySessionKey(adapter.id, input, sessionId);
      const scopesForSession = (sessionId: string) => {
        const key = sessionKey(sessionId);
        const current = scopesBySession.get(key);
        if (current) return current;
        const persisted = storage ? readPersistedPermissionMemory(storage).get(key) : null;
        if (!persisted) return null;
        scopesBySession.set(key, persisted);
        return persisted;
      };
      const forgetSession = (sessionId: string) => {
        const key = sessionKey(sessionId);
        scopesBySession.delete(key);
        updatePersistedPermissionMemory(storage, key, null);
      };
      const isRemembered = (permission: ConversationPermission) => {
        const scope = permissionMemoryScope(permission);
        return Boolean(scope && scopesForSession(permission.sessionId)?.has(scope));
      };
      const remember = (permission: ConversationPermission) => {
        const scope = permissionMemoryScope(permission);
        if (!scope) return () => {};
        const key = sessionKey(permission.sessionId);
        const scopes = scopesForSession(permission.sessionId) ?? new Set<string>();
        const existed = scopes.has(scope);
        scopes.add(scope);
        scopesBySession.set(key, scopes);
        updatePersistedPermissionMemory(storage, key, scopes);
        return () => {
          if (existed) return;
          scopes.delete(scope);
          if (scopes.size === 0) scopesBySession.delete(key);
          updatePersistedPermissionMemory(storage, key, scopes.size > 0 ? scopes : null);
        };
      };
      const automaticallyReply = (permission: ConversationPermission, directory?: string) => {
        const key = `${permission.sessionId}\u0000${permission.id}`;
        const existing = automaticReplies.get(key);
        if (existing) return existing;
        const reply = (async () => {
          try {
            await connection.replyPermission({ permission, reply: "once", directory });
            return true;
          } catch {
            return false;
          } finally {
            automaticReplies.delete(key);
          }
        })();
        automaticReplies.set(key, reply);
        return reply;
      };

      return {
        ...connection,
        async subscribe(subscription) {
          await connection.subscribe({
            ...subscription,
            onEvent(event) {
              if (event.type === "session.deleted") {
                forgetSession(event.sessionId);
              }
              if (event.type !== "permission.asked" || !isRemembered(event.permission)) {
                subscription.onEvent(event);
                return;
              }
              void automaticallyReply(event.permission, input.directory).then((approved) => {
                if (!approved && !subscription.signal.aborted) subscription.onEvent(event);
              });
            },
          });
        },
        async listPermissions(request) {
          const pending = await connection.listPermissions(request);
          const visible = await Promise.all(pending.map(async (permission) => {
            if (!isRemembered(permission)) return permission;
            return await automaticallyReply(permission, request.directory) ? null : permission;
          }));
          return visible.filter((permission): permission is ConversationPermission => permission !== null);
        },
        async replyPermission(request) {
          const rollback = request.reply === "always" ? remember(request.permission) : null;
          try {
            await connection.replyPermission(request);
          } catch (error) {
            rollback?.();
            throw error;
          }
        },
        async setArchived(sessionId, archived, directory) {
          await connection.setArchived(sessionId, archived, directory);
          if (archived) forgetSession(sessionId);
        },
      };
    },
  };
}

export class ConversationEngineAdapterRegistry {
  readonly #adapters: ReadonlyMap<string, ConversationEngineAdapter>;
  readonly #defaultEngineId: string;

  constructor(defaultEngineId: string, adapters: readonly ConversationEngineAdapter[]) {
    this.#defaultEngineId = defaultEngineId;
    const entries = new Map<string, ConversationEngineAdapter>();
    for (const adapter of adapters) {
      const id = adapter.id.trim();
      if (!id) throw new Error("Conversation engine adapter ID is required");
      if (entries.has(id)) throw new Error(`Duplicate conversation engine adapter: ${id}`);
      entries.set(id, adapter);
    }
    this.#adapters = entries;
  }

  get(id?: string | null): ConversationEngineAdapter {
    const resolved = id?.trim() || this.#defaultEngineId;
    const adapter = this.#adapters.get(resolved);
    if (!adapter) throw new Error(`Conversation engine is not registered: ${resolved}`);
    return adapter;
  }

  ids(): string[] {
    return [...this.#adapters.keys()];
  }
}
