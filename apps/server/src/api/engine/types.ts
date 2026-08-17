import { ApiError } from "../../errors.js";

/**
 * Server-side conversation engine abstraction.
 *
 * iPolloWork already unifies its engines behind a `ConversationEngineAdapter` in the
 * browser (`apps/app/src/react-app/domains/session/engine/conversation-engine.ts`).
 * That abstraction is what lets the UI drive OpenCode and DeepSeek Harness through one
 * set of calls. The public API needs the same thing on the server, so this module
 * mirrors that contract — same event names, same permission and question vocabulary —
 * rather than inventing a second, competing one.
 *
 * The engine-specific mapping lives in `opencode.ts` and `harness.ts`.
 */

export type EngineSessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

export interface EngineSession {
  id: string;
  title: string;
  parentId?: string | null;
  directory?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  archivedAt?: number | null;
}

export interface EnginePermission {
  id: string;
  sessionId: string;
  /** Engine-specific permission kind, e.g. a tool name or an action id. */
  kind: string;
  resources: string[];
  /** Scopes the caller may persist an answer for. */
  remember: string[];
  metadata: Record<string, unknown>;
  receivedAt: number;
}

export type EnginePermissionReply = "once" | "always" | "reject";

export interface EngineQuestionOption {
  label: string;
  description?: string;
}

export interface EngineQuestionInfo {
  header?: string;
  question: string;
  options: EngineQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface EngineQuestion {
  id: string;
  sessionId: string;
  questions: EngineQuestionInfo[];
  receivedAt: number;
}

export type EnginePromptPart =
  | { type: "text"; text: string }
  | { type: "file"; mime: string; url: string; filename?: string }
  | { type: "agent"; name: string };

export interface EngineModelRef {
  providerID: string;
  modelID: string;
}

export interface EnginePromptInput {
  sessionId: string;
  parts: EnginePromptPart[];
  model?: EngineModelRef;
  /** Agent / mode identifier. */
  agent?: string;
  system?: string;
  reasoningEffort?: string;
  variant?: string;
  /** OpenCode v2 delivery semantics: steer an in-flight turn or queue after it. */
  delivery?: "steer" | "queue";
}

export interface EngineMessagePart {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface EngineMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: EngineMessagePart[];
  createdAt?: number | null;
  completedAt?: number | null;
}

/**
 * Normalized event stream.
 *
 * Names follow the browser `ConversationEvent` union so a client that already speaks
 * iPolloWork's UI vocabulary needs no translation table. `seq` carries the engine's
 * durable cursor where one exists (OpenCode v2 exposes `durable.seq`), which is what
 * makes `?after=` resumption possible.
 */
export type EngineEvent =
  | { type: "session.updated"; sessionId: string; session: EngineSession; seq?: string }
  | { type: "session.deleted"; sessionId: string; seq?: string }
  | { type: "session.error"; sessionId: string; error: { code?: string; message: string }; seq?: string }
  | { type: "session.status"; sessionId: string; status: EngineSessionStatus; seq?: string }
  | { type: "session.idle"; sessionId: string; seq?: string }
  | { type: "session.compaction"; sessionId: string; running: boolean; seq?: string }
  | { type: "todo.updated"; sessionId: string; todos: unknown[]; seq?: string }
  | { type: "permission.asked"; permission: EnginePermission; seq?: string }
  | { type: "permission.replied"; sessionId: string; requestId: string; seq?: string }
  | { type: "question.asked"; question: EngineQuestion; seq?: string }
  | { type: "question.replied"; sessionId: string; requestId: string; seq?: string }
  | { type: "message.upsert"; sessionId: string; message: EngineMessage; seq?: string }
  | { type: "message.completed"; sessionId: string; messageId: string; completedAt: number; seq?: string }
  | { type: "message.removed"; sessionId: string; messageId: string; seq?: string }
  | {
      type: "message.part";
      sessionId: string;
      messageId: string;
      partId: string;
      part: EngineMessagePart;
      seq?: string;
    }
  | {
      type: "message.delta";
      sessionId: string;
      messageId: string;
      partId: string;
      kind: "text" | "reasoning";
      delta: string;
      seq?: string;
    }
  | {
      type: "tool.called";
      sessionId: string;
      messageId: string;
      callId: string;
      tool: string;
      input?: unknown;
      seq?: string;
    }
  | {
      type: "tool.completed";
      sessionId: string;
      messageId: string;
      callId: string;
      tool: string;
      status: "success" | "failed";
      output?: unknown;
      error?: string;
      seq?: string;
    };

export type EngineEventType = EngineEvent["type"];

export const ENGINE_EVENT_TYPES: readonly EngineEventType[] = [
  "session.updated",
  "session.deleted",
  "session.error",
  "session.status",
  "session.idle",
  "session.compaction",
  "todo.updated",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "message.upsert",
  "message.completed",
  "message.removed",
  "message.part",
  "message.delta",
  "tool.called",
  "tool.completed",
] as const;

export interface EngineSubscribeInput {
  sessionId: string;
  /** Durable cursor to resume from, as previously reported in `EngineEvent.seq`. */
  after?: string;
  signal: AbortSignal;
  onEvent: (event: EngineEvent) => void;
}

/**
 * What every engine must be able to do for the public API.
 *
 * Capability gaps are reported through `capabilities` rather than by throwing from a
 * missing method, so a caller can discover what an engine supports before trying it.
 */
export interface EngineCapabilities {
  /** Streaming session events are available. */
  streaming: boolean;
  /** `after` resumption is honoured by `subscribe`. */
  resumableStreaming: boolean;
  permissions: boolean;
  questions: boolean;
  interrupt: boolean;
  /** A blocking "run until idle" primitive exists. */
  wait: boolean;
  /**
   * Optional `prompt` fields the engine actually applies.
   *
   * The engines diverge here — OpenCode's v2 prompt endpoint has no field for a per-turn
   * system prompt, while DeepSeek Harness does — and an engine-agnostic API that quietly
   * ignored the difference would be lying: the caller would set a system prompt, get a
   * normal-looking 200, and never learn it had no effect. A field reported `false` is
   * rejected at the edge instead of dropped in the adapter.
   */
  promptOptions: EnginePromptOptionSupport;
}

export interface EnginePromptOptionSupport {
  /** A per-turn system prompt override. */
  system: boolean;
  /** A reasoning-effort hint. */
  reasoningEffort: boolean;
  /** A model variant selector. */
  variant: boolean;
}

export type EnginePromptOption = keyof EnginePromptOptionSupport;

export const ENGINE_PROMPT_OPTIONS: readonly EnginePromptOption[] = [
  "system",
  "reasoningEffort",
  "variant",
] as const;

export interface EngineConnection {
  readonly engineId: string;
  readonly capabilities: EngineCapabilities;

  createSession(input: { title?: string; agent?: string; model?: EngineModelRef }): Promise<EngineSession>;
  getSession(sessionId: string): Promise<EngineSession>;
  deleteSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;

  prompt(input: EnginePromptInput): Promise<{ messageId?: string }>;
  interrupt(sessionId: string): Promise<boolean>;
  /** Resolves once the session goes idle. Only valid when `capabilities.wait`. */
  wait(sessionId: string, signal?: AbortSignal): Promise<void>;

  listPermissions(sessionId: string): Promise<EnginePermission[]>;
  replyPermission(input: { sessionId: string; permissionId: string; reply: EnginePermissionReply }): Promise<void>;

  listQuestions(sessionId: string): Promise<EngineQuestion[]>;
  replyQuestion(input: { sessionId: string; questionId: string; answers: string[][] }): Promise<void>;

  subscribe(input: EngineSubscribeInput): Promise<void>;
}

export interface EngineAdapter {
  readonly id: string;
  /** Builds a connection for one workspace. */
  connect(workspace: unknown): EngineConnection;
}

/**
 * Adapter lookup by engine id.
 *
 * Follows the two registries this codebase already has — `PluginEngineAdapterRegistry`
 * (`../../plugin-engine-adapter.ts`) and the browser's `ConversationEngineAdapterRegistry`
 * — including their fail-fast construction: an empty or duplicate id is a programming
 * error and is rejected at startup rather than at the first request. A lookup miss is a
 * request-time condition, so it surfaces as an `ApiError` the same way the plugin engine
 * registry reports an unregistered engine.
 */
export class EngineAdapterRegistry {
  readonly #adapters: ReadonlyMap<string, EngineAdapter>;
  readonly #defaultEngineId: string;

  constructor(defaultEngineId: string, adapters: readonly EngineAdapter[]) {
    const entries = new Map<string, EngineAdapter>();
    for (const adapter of adapters) {
      const id = adapter.id.trim();
      if (!id) throw new Error("Engine adapter ID is required");
      if (entries.has(id)) throw new Error(`Duplicate engine adapter: ${id}`);
      entries.set(id, adapter);
    }
    if (!entries.has(defaultEngineId)) {
      throw new Error(`Default engine adapter is not registered: ${defaultEngineId}`);
    }
    this.#adapters = entries;
    this.#defaultEngineId = defaultEngineId;
  }

  get(id?: string | null): EngineAdapter {
    const resolved = id?.trim() || this.#defaultEngineId;
    const adapter = this.#adapters.get(resolved);
    if (!adapter) {
      throw new ApiError(409, "engine_not_registered", `Engine is not registered: ${resolved}`, {
        engine: resolved,
        registeredEngines: [...this.#adapters.keys()],
      });
    }
    return adapter;
  }

  has(id?: string | null): boolean {
    return this.#adapters.has(id?.trim() || this.#defaultEngineId);
  }

  ids(): string[] {
    return [...this.#adapters.keys()];
  }
}
