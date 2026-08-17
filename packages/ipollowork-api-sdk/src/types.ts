/**
 * Wire types for the iPolloWork public API.
 *
 * These mirror the server's `apps/server/src/api/engine/types.ts`. They are duplicated
 * rather than imported so the SDK stays installable on its own, without pulling the
 * server workspace in as a dependency.
 */

export type TokenScope = "owner" | "collaborator" | "viewer";

/** Error body returned by every endpoint, matching the server's `formatError`. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

export interface Session {
  id: string;
  title: string;
  parentId?: string | null;
  directory?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  archivedAt?: number | null;
}

/**
 * What an engine can do for a workspace.
 *
 * Worth checking before assuming a feature works: the engines differ, and the API reports
 * the difference rather than papering over it.
 */
export interface EngineCapabilities {
  streaming: boolean;
  /** `?after=` resumption is honoured. */
  resumableStreaming: boolean;
  permissions: boolean;
  questions: boolean;
  interrupt: boolean;
  wait: boolean;
  /** Optional `prompt` fields this engine applies; the rest are rejected with 501. */
  promptOptions: {
    system: boolean;
    reasoningEffort: boolean;
    variant: boolean;
  };
}

/** Session responses carry the engine and its capabilities alongside the session. */
export interface SessionEnvelope {
  session: Session;
  engine: string;
  capabilities: EngineCapabilities;
}

export interface Permission {
  id: string;
  sessionId: string;
  kind: string;
  resources: string[];
  remember: string[];
  metadata: Record<string, unknown>;
  receivedAt: number;
}

export type PermissionReply = "once" | "always" | "reject";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionInfo {
  header?: string;
  question: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface Question {
  id: string;
  sessionId: string;
  questions: QuestionInfo[];
  receivedAt: number;
}

export type PromptPart =
  | { type: "text"; text: string }
  | { type: "file"; mime: string; url: string; filename?: string }
  | { type: "agent"; name: string };

export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface MessagePart {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  createdAt?: number | null;
  completedAt?: number | null;
}

/**
 * Normalized event stream, identical across engines.
 *
 * `seq` is the durable cursor: pass the last one you processed as `after` to resume a
 * stream without losing events.
 */
export type SessionEvent =
  | { type: "session.updated"; sessionId: string; session: Session; seq?: string }
  | { type: "session.deleted"; sessionId: string; seq?: string }
  | { type: "session.error"; sessionId: string; error: { code?: string; message: string }; seq?: string }
  | { type: "session.status"; sessionId: string; status: SessionStatus; seq?: string }
  | { type: "session.idle"; sessionId: string; seq?: string }
  | { type: "session.compaction"; sessionId: string; running: boolean; seq?: string }
  | { type: "todo.updated"; sessionId: string; todos: unknown[]; seq?: string }
  | { type: "permission.asked"; permission: Permission; seq?: string }
  | { type: "permission.replied"; sessionId: string; requestId: string; seq?: string }
  | { type: "question.asked"; question: Question; seq?: string }
  | { type: "question.replied"; sessionId: string; requestId: string; seq?: string }
  | { type: "message.upsert"; sessionId: string; message: Message; seq?: string }
  | { type: "message.completed"; sessionId: string; messageId: string; completedAt: number; seq?: string }
  | { type: "message.removed"; sessionId: string; messageId: string; seq?: string }
  | { type: "message.part"; sessionId: string; messageId: string; partId: string; part: MessagePart; seq?: string }
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

export type TaskState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "done"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;
  workspaceId: string;
  sessionId?: string | null;
  goal: string;
  state: TaskState;
  createdAt: number;
  updatedAt: number;
  summary?: string | null;
  error?: { code?: string; message: string } | null;
  pendingPermissions?: Permission[];
  metadata?: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  name?: string;
  path?: string;
  engineId?: string;
  [key: string]: unknown;
}

export interface Webhook {
  id: string;
  workspaceId: string;
  url: string;
  events: string[];
  /** The secret itself is never returned after creation. */
  hasSecret: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Identity {
  actor: { type: string; clientId: string | null; scope: TokenScope | null };
  token: { id: string; scope: TokenScope; label: string | null; createdAt: number } | null;
  policy: Record<string, unknown> | null;
  server: Record<string, unknown>;
  workspaces: Array<{ id: string; name?: string }>;
}

export interface ApiModuleDescriptor {
  id: string;
  title: string;
  description: string;
  version: string;
  stability: "stable" | "preview" | "experimental";
  dependsOn: string[];
  operations: Array<{
    operationId: string;
    method: string;
    path: string;
    effect: "read" | "write" | "destructive";
    scope: TokenScope;
    summary: string;
    streaming: "sse" | null;
    deprecated: boolean;
  }>;
}
