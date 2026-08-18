/**
 * In-memory task store.
 *
 * A task is the one-shot automation wrapper over a session: submit a goal, get a
 * terminal state plus whatever artifacts the run produced. This file owns the task
 * *state* only — it never talks HTTP and never touches an engine, so the whole state
 * machine is unit-testable without a server or a live agent.
 *
 * ## Durability
 *
 * There is none. Records live in a `Map` inside the server process and are gone on
 * restart, on crash, and on a second server instance. That is deliberate for the
 * preview stability of the `tasks` module, but it is not hidden: `createTaskStore`
 * has no persistence hook to forget to wire up, the module description says so, and
 * the `createTask` response schema says so. A caller that needs a task to survive a
 * restart must poll and re-submit, or use the session APIs directly.
 *
 * ## State machine
 *
 *   queued -> running -> (awaiting_approval <-> running) -> done | failed | cancelled
 *
 * `failed` and `cancelled` are also reachable from `queued` and `awaiting_approval`,
 * because a task can die before it ever starts (engine unreachable) or while it is
 * parked on a manual approval. `done` is only reachable from `running`: a task that
 * finished must have been running when it finished. The three terminal states accept
 * no further transition, and an illegal one throws rather than being coerced — a
 * silent coercion here would make the reported state a lie.
 */

import { ApiError } from "../../../errors.js";

export const TASK_STATES = [
  "queued",
  "running",
  "awaiting_approval",
  "done",
  "failed",
  "cancelled",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_TASK_STATES: readonly TaskState[] = ["done", "failed", "cancelled"];

/** The single source of truth for the state machine. */
export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  queued: ["running", "failed", "cancelled"],
  running: ["awaiting_approval", "done", "failed", "cancelled"],
  awaiting_approval: ["running", "failed", "cancelled"],
  done: [],
  failed: [],
  cancelled: [],
};

export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export type TaskApprovalPolicy = "auto" | "manual";

export interface TaskModelRef {
  providerID: string;
  modelID: string;
}

export interface TaskError {
  code: string;
  message: string;
}

/**
 * A permission the engine asked for that nobody has answered yet.
 *
 * Only populated under `approvalPolicy: "manual"`. The task deliberately does not
 * expose its own approve endpoint: the permission is a *session* permission, and the
 * sessions module already owns replying to one. This record carries the session id
 * and permission id a caller needs to answer it there.
 */
export interface TaskPendingPermission {
  permissionId: string;
  sessionId: string;
  /** Engine-specific permission kind, normally the tool name. */
  kind: string;
  resources: string[];
  askedAt: number;
}

export interface TaskArtifact {
  id: string;
  /** `file` when the run wrote a path; `output` for any other recorded tool result. */
  kind: "file" | "output";
  tool: string;
  path?: string;
  createdAt: number;
}

export interface TaskRecord {
  id: string;
  workspaceId: string;
  state: TaskState;
  goal: string;
  agent: string | null;
  model: TaskModelRef | null;
  approvalPolicy: TaskApprovalPolicy;
  timeoutMs: number | null;
  metadata: Record<string, unknown>;
  /** The session the runner created for this task, once it exists. */
  sessionId: string | null;
  engineId: string | null;
  /** Assistant text collected from the run, truncated to a bounded length. */
  summary: string;
  artifacts: TaskArtifact[];
  pendingPermissions: TaskPendingPermission[];
  error: TaskError | null;
  cancelReason: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface TaskCreateInput {
  workspaceId: string;
  goal: string;
  agent?: string | null;
  model?: TaskModelRef | null;
  approvalPolicy?: TaskApprovalPolicy;
  timeoutMs?: number | null;
  metadata?: Record<string, unknown>;
  /** Explicit id, mostly for deterministic tests. */
  id?: string;
}

/**
 * A partial write. Only `state` is validated against the state machine; every other
 * field is a plain overwrite, so a finished run can still record the summary and
 * artifacts it produced before it was cancelled.
 */
export interface TaskUpdate {
  state?: TaskState;
  sessionId?: string | null;
  engineId?: string | null;
  summary?: string;
  artifacts?: TaskArtifact[];
  pendingPermissions?: TaskPendingPermission[];
  error?: TaskError | null;
  cancelReason?: string | null;
  metadata?: Record<string, unknown>;
  startedAt?: number | null;
  completedAt?: number | null;
}

export type TaskEventType = "task.created" | "task.state" | "task.updated";

/**
 * One entry on a task's event log.
 *
 * Every event carries the full task snapshot rather than a delta: a client that
 * reconnects mid-run gets the current truth from the next frame without a second
 * round trip, and a dropped frame cannot leave the client's copy skewed. `seq` is
 * store-global and monotonic, and is what `?after=` resumes from.
 */
export interface TaskEvent {
  seq: number;
  at: number;
  taskId: string;
  type: TaskEventType;
  task: TaskRecord;
  /** Present on `task.state`. */
  from?: TaskState;
  /** Present on `task.state`. */
  to?: TaskState;
}

export interface TaskListFilter {
  workspaceId?: string;
  state?: TaskState | readonly TaskState[];
  /** Defaults to 50, clamped to `maxListLimit` (200). */
  limit?: number;
}

export interface TaskSubscribeInput {
  /** Restricts the subscription to one task. Omit to receive every task's events. */
  taskId?: string;
  /** Replays buffered events with `seq > after` before attaching the listener. */
  after?: number;
  onEvent: (event: TaskEvent) => void;
}

export interface TaskStoreOptions {
  now?: () => number;
  newId?: () => string;
  /**
   * Upper bound on retained tasks. Once exceeded, the oldest *terminal* tasks are
   * dropped; a live task is never evicted. Defaults to 500.
   */
  maxTasks?: number;
  /** Retained events per task, oldest dropped first. Defaults to 500. */
  maxEventsPerTask?: number;
}

export interface TaskStore {
  add(input: TaskCreateInput): TaskRecord;
  get(taskId: string): TaskRecord | undefined;
  /** Like `get`, but throws `404 task_not_found`. */
  require(taskId: string, workspaceId?: string): TaskRecord;
  list(filter?: TaskListFilter): TaskRecord[];
  update(taskId: string, patch: TaskUpdate): TaskRecord;
  /** Terminal shortcut for `update({state: "cancelled"})`, with a friendlier error. */
  cancel(taskId: string, reason?: string): TaskRecord;
  /** Buffered events with `seq > after`, oldest first. */
  events(taskId: string, after?: number): TaskEvent[];
  subscribe(input: TaskSubscribeInput): () => void;
  /** Number of retained tasks. */
  readonly size: number;
  clear(): void;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export function createTaskStore(options: TaskStoreOptions = {}): TaskStore {
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? defaultTaskId;
  const maxTasks = Math.max(1, options.maxTasks ?? 500);
  const maxEventsPerTask = Math.max(1, options.maxEventsPerTask ?? 500);

  const tasks = new Map<string, TaskRecord>();
  const log = new Map<string, TaskEvent[]>();
  const listeners = new Set<TaskSubscribeInput>();
  let seq = 0;

  const publish = (
    task: TaskRecord,
    type: TaskEventType,
    transition?: { from: TaskState; to: TaskState },
  ): TaskEvent => {
    seq += 1;
    const event: TaskEvent = {
      seq,
      at: task.updatedAt,
      taskId: task.id,
      type,
      task,
      ...(transition ?? {}),
    };
    const buffer = log.get(task.id);
    if (buffer) {
      buffer.push(event);
      if (buffer.length > maxEventsPerTask) buffer.splice(0, buffer.length - maxEventsPerTask);
    }
    for (const listener of [...listeners]) {
      if (listener.taskId && listener.taskId !== task.id) continue;
      // One misbehaving subscriber must not abort the state change for everyone
      // else, and must not leave the store half-updated.
      try {
        listener.onEvent(event);
      } catch {
        // Ignored on purpose.
      }
    }
    return event;
  };

  /** Drops the oldest terminal tasks once the retention bound is exceeded. */
  const evict = (): void => {
    if (tasks.size <= maxTasks) return;
    const evictable = [...tasks.values()]
      .filter((task) => isTerminalTaskState(task.state))
      .sort((left, right) => left.updatedAt - right.updatedAt);
    let overflow = tasks.size - maxTasks;
    for (const task of evictable) {
      if (overflow <= 0) break;
      tasks.delete(task.id);
      log.delete(task.id);
      overflow -= 1;
    }
  };

  return {
    add(input) {
      const goal = input.goal.trim();
      if (!goal) {
        throw new ApiError(400, "task_goal_required", "Task goal must not be empty");
      }
      const id = input.id?.trim() || newId();
      if (tasks.has(id)) {
        throw new ApiError(409, "task_duplicate", `Task already exists: ${id}`, { taskId: id });
      }
      const at = now();
      const task: TaskRecord = Object.freeze({
        id,
        workspaceId: input.workspaceId,
        state: "queued",
        goal,
        agent: input.agent?.trim() || null,
        model: input.model ?? null,
        approvalPolicy: input.approvalPolicy ?? "auto",
        timeoutMs: input.timeoutMs ?? null,
        metadata: { ...(input.metadata ?? {}) },
        sessionId: null,
        engineId: null,
        summary: "",
        artifacts: [],
        pendingPermissions: [],
        error: null,
        cancelReason: null,
        createdAt: at,
        updatedAt: at,
        startedAt: null,
        completedAt: null,
      });
      tasks.set(id, task);
      log.set(id, []);
      evict();
      publish(task, "task.created");
      return task;
    },

    get(taskId) {
      return tasks.get(taskId);
    },

    require(taskId, workspaceId) {
      const task = tasks.get(taskId);
      // A task from another workspace is reported as missing rather than as
      // forbidden, so the endpoint cannot be used to probe for task ids.
      if (!task || (workspaceId !== undefined && task.workspaceId !== workspaceId)) {
        throw new ApiError(404, "task_not_found", `Task not found: ${taskId}`, { taskId });
      }
      return task;
    },

    list(filter = {}) {
      const states = filter.state === undefined
        ? null
        : new Set(Array.isArray(filter.state) ? filter.state : [filter.state as TaskState]);
      const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT);
      return [...tasks.values()]
        .filter((task) => filter.workspaceId === undefined || task.workspaceId === filter.workspaceId)
        .filter((task) => states === null || states.has(task.state))
        .sort((left, right) => right.createdAt - left.createdAt || right.updatedAt - left.updatedAt)
        .slice(0, limit);
    },

    update(taskId, patch) {
      const current = this.require(taskId);
      const at = now();
      const nextState = patch.state ?? current.state;

      if (patch.state !== undefined && patch.state !== current.state) {
        if (!canTransitionTask(current.state, patch.state)) {
          throw new ApiError(
            409,
            "task_invalid_transition",
            `Task ${taskId} cannot move from ${current.state} to ${patch.state}`,
            {
              taskId,
              from: current.state,
              to: patch.state,
              allowed: TASK_TRANSITIONS[current.state],
            },
          );
        }
      }

      const becameTerminal = nextState !== current.state && isTerminalTaskState(nextState);
      const next: TaskRecord = Object.freeze({
        ...current,
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.sessionId !== undefined ? { sessionId: patch.sessionId } : {}),
        ...(patch.engineId !== undefined ? { engineId: patch.engineId } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.artifacts !== undefined ? { artifacts: [...patch.artifacts] } : {}),
        ...(patch.pendingPermissions !== undefined
          ? { pendingPermissions: [...patch.pendingPermissions] }
          : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.cancelReason !== undefined ? { cancelReason: patch.cancelReason } : {}),
        ...(patch.metadata !== undefined ? { metadata: { ...patch.metadata } } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        completedAt: patch.completedAt !== undefined
          ? patch.completedAt
          : becameTerminal
            ? at
            : current.completedAt,
        updatedAt: at,
      });

      tasks.set(taskId, next);
      publish(
        next,
        patch.state !== undefined && patch.state !== current.state ? "task.state" : "task.updated",
        patch.state !== undefined && patch.state !== current.state
          ? { from: current.state, to: patch.state }
          : undefined,
      );
      if (becameTerminal) evict();
      return next;
    },

    cancel(taskId, reason) {
      const current = this.require(taskId);
      if (isTerminalTaskState(current.state)) {
        throw new ApiError(
          409,
          "task_not_cancellable",
          `Task ${taskId} already finished in state ${current.state}`,
          { taskId, state: current.state },
        );
      }
      return this.update(taskId, {
        state: "cancelled",
        cancelReason: reason?.trim() || "Cancelled by request",
        pendingPermissions: [],
      });
    },

    events(taskId, after) {
      const buffer = log.get(taskId) ?? [];
      if (after === undefined) return [...buffer];
      return buffer.filter((event) => event.seq > after);
    },

    subscribe(input) {
      if (input.after !== undefined) {
        const replay = input.taskId
          ? this.events(input.taskId, input.after)
          : [...log.values()].flat().filter((event) => event.seq > (input.after ?? 0)).sort((a, b) => a.seq - b.seq);
        for (const event of replay) input.onEvent(event);
      }
      listeners.add(input);
      return () => {
        listeners.delete(input);
      };
    },

    get size() {
      return tasks.size;
    },

    clear() {
      tasks.clear();
      log.clear();
    },
  };
}

function defaultTaskId(): string {
  return `task_${crypto.randomUUID().replace(/-/g, "")}`;
}
