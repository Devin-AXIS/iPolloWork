import { errorFromResponse, IPolloWorkApiError } from "./errors.js";
import { readSseStream } from "./sse.js";
import type {
  ApiModuleDescriptor,
  Identity,
  ModelRef,
  Permission,
  PermissionReply,
  PromptPart,
  Question,
  Session,
  SessionEnvelope,
  SessionEvent,
  Task,
  TaskState,
  Webhook,
  Workspace,
} from "./types.js";

export interface IPolloWorkClientOptions {
  /** Server base URL, e.g. `http://127.0.0.1:8787`. */
  baseUrl: string;
  /** Bearer token issued by `POST /tokens`. */
  token?: string;
  /** Injectable for tests and for runtimes with a custom fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout. Streaming requests are exempt. Defaults to 30s. */
  timeoutMs?: number;
  headers?: Record<string, string>;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** Streaming requests skip the timeout and return the raw response. */
  stream?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class IPolloWorkClient {
  readonly #baseUrl: string;
  readonly #token?: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #headers: Record<string, string>;

  constructor(options: IPolloWorkClientOptions) {
    if (!options.baseUrl?.trim()) throw new Error("baseUrl is required");
    this.#baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    this.#token = options.token?.trim() || undefined;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#headers = options.headers ?? {};
  }

  // ---------------------------------------------------------------- transport

  async #request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.#raw(path, options);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async #raw(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: "application/json", ...this.#headers };
    if (this.#token) headers.authorization = `Bearer ${this.#token}`;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.stream) headers.accept = "text/event-stream";

    // A timeout must not silently swallow a caller's own cancellation, so the two
    // signals are combined rather than one replacing the other.
    const timeout = options.stream ? undefined : new AbortController();
    const timer = timeout ? setTimeout(() => timeout.abort(), this.#timeoutMs) : undefined;
    const signal = combineSignals([options.signal, timeout?.signal]);

    try {
      const response = await this.#fetch(url.toString(), {
        method: options.method ?? "GET",
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw await errorFromResponse(response, url.pathname);
      return response;
    } catch (error) {
      if (error instanceof IPolloWorkApiError) throw error;
      if (timeout?.signal.aborted && !options.signal?.aborted) {
        throw new IPolloWorkApiError({
          status: 408,
          code: "request_timeout",
          message: `Request timed out after ${this.#timeoutMs}ms`,
          requestPath: url.pathname,
        });
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ service

  health(): Promise<{ ok: boolean }> {
    return this.#request("/api/v1/health");
  }

  whoami(): Promise<Identity> {
    return this.#request("/api/v1/whoami");
  }

  /** Returns the module catalogue as a bare array, matching `GET /api/v1/modules`. */
  listModules(): Promise<ApiModuleDescriptor[]> {
    return this.#request("/api/v1/modules");
  }

  openapi(): Promise<Record<string, unknown>> {
    return this.#request("/api/v1/openapi.json");
  }

  listWorkspaces(): Promise<{ items: Workspace[] }> {
    return this.#request("/api/v1/workspaces");
  }

  // ----------------------------------------------------------------- sessions

  /**
   * Creates a session.
   *
   * Returns the full envelope, so the engine's `capabilities` are available at the point
   * you would decide whether to stream with `?after=` or pass a `system` prompt. Use
   * `.session` for the session itself.
   */
  createSession(
    workspaceId: string,
    input: { title?: string; agent?: string; model?: ModelRef } = {},
  ): Promise<SessionEnvelope> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/sessions`, { method: "POST", body: input });
  }

  getSession(workspaceId: string, sessionId: string): Promise<SessionEnvelope> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}`);
  }

  updateSession(workspaceId: string, sessionId: string, input: { title: string }): Promise<SessionEnvelope> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}`, {
      method: "PATCH",
      body: input,
    });
  }

  deleteSession(workspaceId: string, sessionId: string): Promise<{ deleted: boolean; sessionId: string }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}`, { method: "DELETE" });
  }

  /**
   * Sends a turn.
   *
   * `system` and `reasoningEffort` are engine-dependent: an engine that cannot apply them
   * answers `501 engine_prompt_option_unsupported` rather than accepting and ignoring
   * them. `getSession(...).capabilities.promptOptions` reports which are honoured.
   */
  prompt(
    workspaceId: string,
    sessionId: string,
    input: {
      parts: PromptPart[];
      model?: ModelRef;
      agent?: string;
      system?: string;
      reasoningEffort?: string;
      variant?: string;
      delivery?: "steer" | "queue";
    },
  ): Promise<{ accepted: boolean; sessionId: string; messageId: string | null }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}/prompt`, {
      method: "POST",
      body: input,
    });
  }

  /** Convenience wrapper for the common "send one text message" case. */
  promptText(
    workspaceId: string,
    sessionId: string,
    text: string,
    input: { model?: ModelRef; agent?: string } = {},
  ): Promise<{ accepted: boolean; sessionId: string; messageId: string | null }> {
    return this.prompt(workspaceId, sessionId, { parts: [{ type: "text", text }], ...input });
  }

  interrupt(workspaceId: string, sessionId: string): Promise<{ interrupted: boolean; sessionId: string }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}/interrupt`, {
      method: "POST",
    });
  }

  listPermissions(workspaceId: string, sessionId: string): Promise<{ permissions: Permission[] }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}/permissions`);
  }

  replyPermission(
    workspaceId: string,
    sessionId: string,
    permissionId: string,
    reply: PermissionReply,
  ): Promise<{ ok: boolean; permissionId: string; reply: PermissionReply }> {
    return this.#request(
      `/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}/permissions/${enc(permissionId)}`,
      { method: "POST", body: { reply } },
    );
  }

  listQuestions(workspaceId: string, sessionId: string): Promise<{ questions: Question[] }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}/questions`);
  }

  replyQuestion(
    workspaceId: string,
    sessionId: string,
    questionId: string,
    answers: string[][],
  ): Promise<{ ok: boolean; questionId: string }> {
    return this.#request(
      `/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}/questions/${enc(questionId)}`,
      { method: "POST", body: { answers } },
    );
  }

  /**
   * Streams session events.
   *
   * Pass the `seq` of the last event you handled as `after` to resume without gaps.
   */
  async *streamSession(
    workspaceId: string,
    sessionId: string,
    options: { after?: string; signal?: AbortSignal } = {},
  ): AsyncGenerator<SessionEvent, void, unknown> {
    const response = await this.#raw(
      `/api/v1/workspaces/${enc(workspaceId)}/sessions/${enc(sessionId)}/events`,
      { stream: true, query: { after: options.after }, signal: options.signal },
    );

    for await (const frame of readSseStream(response, options.signal)) {
      const event = parseEventFrame(frame.event, frame.data, frame.id);
      if (event) yield event;
    }
  }

  // -------------------------------------------------------------------- tasks

  createTask(
    workspaceId: string,
    input: {
      goal: string;
      agent?: string;
      model?: ModelRef;
      approvalPolicy?: "auto" | "manual";
      timeoutMs?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Task> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/tasks`, { method: "POST", body: input });
  }

  listTasks(
    workspaceId: string,
    query: { state?: TaskState } = {},
  ): Promise<{ items: Task[]; count: number; durable: boolean }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/tasks`, { query });
  }

  getTask(workspaceId: string, taskId: string): Promise<Task> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/${enc(taskId)}`);
  }

  cancelTask(workspaceId: string, taskId: string): Promise<Task> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/${enc(taskId)}/cancel`, { method: "POST" });
  }

  async *streamTask(
    workspaceId: string,
    taskId: string,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<{ event: string; data: unknown }, void, unknown> {
    const response = await this.#raw(`/api/v1/workspaces/${enc(workspaceId)}/tasks/${enc(taskId)}/events`, {
      stream: true,
      signal: options.signal,
    });

    for await (const frame of readSseStream(response, options.signal)) {
      yield { event: frame.event, data: safeParse(frame.data) };
    }
  }

  /**
   * Submits a task and resolves once it reaches a terminal state.
   *
   * Drives off the event stream rather than polling, and falls back to a final read so a
   * task that finished before the stream attached is still reported correctly.
   */
  async runTask(
    workspaceId: string,
    input: Parameters<IPolloWorkClient["createTask"]>[1],
    options: { signal?: AbortSignal; onEvent?: (event: string, data: unknown) => void } = {},
  ): Promise<Task> {
    const task = await this.createTask(workspaceId, input);
    const terminal: TaskState[] = ["done", "failed", "cancelled"];
    if (terminal.includes(task.state)) return task;

    for await (const event of this.streamTask(workspaceId, task.id, { signal: options.signal })) {
      options.onEvent?.(event.event, event.data);
      const state = readTaskState(event.data);
      if (state && terminal.includes(state)) break;
    }

    return this.getTask(workspaceId, task.id);
  }

  // ----------------------------------------------------------------- webhooks

  /**
   * Registers a webhook.
   *
   * `secret` comes back only when the server generated one — it is never readable
   * afterwards, so store it now if you need to verify signatures.
   */
  createWebhook(
    workspaceId: string,
    input: { url: string; events: string[]; secret?: string; active?: boolean },
  ): Promise<{ webhook: Webhook; secret?: string }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/webhooks`, { method: "POST", body: input });
  }

  listWebhooks(workspaceId: string): Promise<{ webhooks: Webhook[] }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/webhooks`);
  }

  getWebhook(workspaceId: string, webhookId: string): Promise<{ webhook: Webhook }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/webhooks/${enc(webhookId)}`);
  }

  deleteWebhook(workspaceId: string, webhookId: string): Promise<{ deleted: boolean; id: string }> {
    return this.#request(`/api/v1/workspaces/${enc(workspaceId)}/webhooks/${enc(webhookId)}`, { method: "DELETE" });
  }
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readTaskState(data: unknown): TaskState | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const state = typeof record.state === "string"
    ? record.state
    : typeof (record.task as Record<string, unknown> | undefined)?.state === "string"
      ? ((record.task as Record<string, unknown>).state as string)
      : null;
  return state as TaskState | null;
}

/** Reattaches the SSE `id:` line as the event's `seq`, so callers can resume from it. */
export function parseEventFrame(eventName: string, data: string, id?: string): SessionEvent | null {
  const parsed = safeParse(data);
  if (!parsed || typeof parsed !== "object") return null;
  const event = parsed as Record<string, unknown>;
  if (typeof event.type !== "string") {
    if (!eventName) return null;
    event.type = eventName;
  }
  if (id !== undefined && event.seq === undefined) event.seq = id;
  return event as unknown as SessionEvent;
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  // `AbortSignal.any` is Node 20+; the manual path keeps older runtimes working.
  const anyOf = (AbortSignal as unknown as { any?: (list: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyOf === "function") return anyOf(active);

  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
