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

export type ConversationSnapshot = {
  session: ConversationSession;
  messages: UIMessage[];
  todos: TodoItem[];
  status: ConversationStatus;
};

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
  | { type: "session.updated"; sessionId: string; info: ConversationSession }
  | { type: "session.deleted"; sessionId: string }
  | { type: "session.error"; sessionId: string; errorText: string }
  | { type: "session.compaction"; sessionId: string; running: boolean }
  | { type: "session.status"; sessionId: string; status: ConversationStatus }
  | { type: "session.idle"; sessionId: string }
  | { type: "todo.updated"; sessionId: string; todos: TodoItem[] }
  | { type: "permission.asked"; permission: ConversationPermission }
  | { type: "permission.replied"; sessionId: string; requestId: string }
  | { type: "question.asked"; question: ConversationQuestion }
  | { type: "question.replied"; sessionId: string; requestId: string }
  | { type: "message.upsert"; sessionId: string; message: UIMessage }
  | { type: "message.completed"; sessionId: string; messageId: string; completedAt: number }
  | { type: "message.removed"; sessionId: string; messageId: string }
  | {
      type: "message.parts";
      sessionId: string;
      messageId: string;
      partId: string;
      parts: UIMessage["parts"];
      messageRole?: UIMessage["role"];
      visibleAssistantOutput: boolean;
    }
  | {
      type: "message.chunk";
      sessionId: string;
      messageId: string;
      chunk: ConversationMessageChunk;
    };

export type ConversationSubscribeInput = {
  signal: AbortSignal;
  onEvent: (event: ConversationEvent) => void;
};

export type ConversationPromptInput = {
  sessionId: string;
  clientUserMessageId?: string;
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

export interface ConversationEngineConnection {
  mapSnapshot(snapshot: unknown): ConversationSnapshot;
  modeState?(session: ConversationSession): ConversationModeState;
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
    directory?: string;
    reasoningEffort?: string;
  }): Promise<void>;
  sendPrompt(input: ConversationPromptInput): Promise<ConversationPromptResult>;
  listCommands(directory?: string): Promise<SlashCommandOption[]>;
  listModes(): Promise<ConversationMode[]>;
  listAgents(): Promise<ConversationAgent[]>;
  searchFiles(query: string, directory?: string): Promise<string[]>;
}

export interface ConversationEngineAdapter {
  readonly id: string;
  connect(input: {
    baseUrl: string;
    token?: string;
    directory?: string;
    serverBaseUrl?: string;
    workspaceId?: string;
  }): ConversationEngineConnection;
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
