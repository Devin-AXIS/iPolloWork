/**
 * Task runner.
 *
 * Drives one task to a terminal state over an `EngineConnection`: create a session,
 * send the goal as a prompt, follow the event stream, and translate what happens
 * there into task state. Everything engine-specific already lives behind
 * `EngineConnection`, so this file is engine-agnostic and a stub connection is enough
 * to test it.
 *
 * Three things decide the shape of it:
 *
 * - **Approvals.** An agent that stops to ask for permission is the normal case, not
 *   an error. Under `approvalPolicy: "auto"` the runner answers `once` and the task
 *   stays `running`; under `"manual"` it parks the task in `awaiting_approval` and
 *   records the session id and permission id, because replying is the sessions
 *   module's job and duplicating a permission-reply endpoint here would give the same
 *   pending permission two owners.
 * - **Finishing.** `session.idle` is the completion signal, but only when no manual
 *   approval is outstanding — the engine also goes idle while it waits for an answer,
 *   and treating that as success would report a half-done task as `done`.
 * - **Stopping.** Timeout, client cancellation, and engine error all converge on one
 *   `AbortController`, so there is a single teardown path that ends the subscription
 *   and interrupts the session rather than three that can each leak it.
 */

import type {
  EngineConnection,
  EngineEvent,
  EnginePermission,
} from "../../engine/types.js";
import { ApiError } from "../../../errors.js";
import type {
  TaskArtifact,
  TaskError,
  TaskPendingPermission,
  TaskRecord,
  TaskStore,
} from "./store.js";

/** Bound on the retained assistant text. The tail is kept: it holds the conclusion. */
export const MAX_TASK_SUMMARY_CHARS = 16_000;

const TRUNCATION_MARKER = "[…truncated]\n";

/** Tools whose successful completion is recorded as a file artifact. */
const FILE_TOOLS = new Set(["write", "edit", "multiedit", "patch", "apply_patch", "apply-patch"]);

const FILE_INPUT_KEYS = ["filePath", "file_path", "path", "filename"] as const;

export interface TaskTextAccumulator {
  append(chunk: string): void;
  value(): string;
}

/**
 * Bounded text buffer.
 *
 * A long-running task can stream megabytes of assistant text; keeping all of it in a
 * process-resident record is how an in-memory store turns into a leak. Trimming from
 * the front preserves the end of the run, which is where the answer is.
 */
export function createTaskTextAccumulator(limit = MAX_TASK_SUMMARY_CHARS): TaskTextAccumulator {
  const max = Math.max(1, limit);
  let buffer = "";
  let truncated = false;
  return {
    append(chunk) {
      if (!chunk) return;
      buffer += chunk;
      if (buffer.length > max) {
        buffer = buffer.slice(buffer.length - max);
        truncated = true;
      }
    },
    value() {
      return truncated ? `${TRUNCATION_MARKER}${buffer}` : buffer;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recognises an artifact in a completed tool call.
 *
 * `tool.completed` carries no input, so the path comes from the matching
 * `tool.called` the runner remembered — the same pairing the Harness adapter keeps
 * for exactly this reason. Pure and exported so the tool-name and input-shape
 * heuristics can be tested directly; a failed tool call produces nothing, since a
 * task's artifacts are what it actually produced.
 */
export function extractTaskArtifact(
  event: EngineEvent,
  at: number,
  input?: unknown,
): TaskArtifact | null {
  if (event.type !== "tool.completed" || event.status !== "success") return null;
  const tool = event.tool.toLowerCase();
  if (!FILE_TOOLS.has(tool)) return null;
  const sources = [input, event.output].filter(isRecord);
  let path: string | undefined;
  outer: for (const source of sources) {
    for (const key of FILE_INPUT_KEYS) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        path = value.trim();
        break outer;
      }
    }
  }
  return {
    id: event.callId,
    kind: path ? "file" : "output",
    tool: event.tool,
    ...(path ? { path } : {}),
    createdAt: at,
  };
}

function toPendingPermission(permission: EnginePermission): TaskPendingPermission {
  return {
    permissionId: permission.id,
    sessionId: permission.sessionId,
    kind: permission.kind,
    resources: [...permission.resources],
    askedAt: permission.receivedAt,
  };
}

function toTaskError(error: unknown, fallbackCode: string): TaskError {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: fallbackCode, message: error.message };
  return { code: fallbackCode, message: String(error ?? "Task failed") };
}

/** How a run stopped, before it is written back to the store. */
type RunOutcome =
  | { kind: "done" }
  | { kind: "failed"; error: TaskError }
  | { kind: "aborted" };

interface ActiveRun {
  controller: AbortController;
  connection: EngineConnection;
  sessionId: string | null;
}

export interface TaskRunnerOptions {
  store: TaskStore;
  now?: () => number;
  summaryLimit?: number;
}

export interface TaskRunInput {
  task: TaskRecord;
  connection: EngineConnection;
}

export interface TaskRunner {
  /** Runs to completion. Never rejects: a failure is recorded on the task instead. */
  run(input: TaskRunInput): Promise<TaskRecord>;
  /** Starts a run in the background and returns immediately. */
  start(input: TaskRunInput): void;
  /**
   * Cancels a task. Marks it `cancelled` first (throwing `409` when it already
   * finished), then aborts the run and interrupts the session best-effort.
   */
  cancel(taskId: string, reason?: string): Promise<TaskRecord>;
  /** Number of runs currently in flight. */
  readonly active: number;
  /** Aborts every in-flight run, for shutdown. */
  shutdown(): void;
}

export function createTaskRunner(options: TaskRunnerOptions): TaskRunner {
  const { store } = options;
  const now = options.now ?? (() => Date.now());
  const runs = new Map<string, ActiveRun>();

  const runner: TaskRunner = {
    async run({ task, connection }) {
      const taskId = task.id;
      const controller = new AbortController();
      const active: ActiveRun = { controller, connection, sessionId: null };
      runs.set(taskId, active);

      const text = createTaskTextAccumulator(options.summaryLimit);
      const artifacts = new Map<string, TaskArtifact>();
      const pending = new Map<string, TaskPendingPermission>();
      const toolInputs = new Map<string, unknown>();

      let settled = false;
      let settle: (outcome: RunOutcome) => void = () => {};
      const finished = new Promise<RunOutcome>((resolve) => {
        settle = (outcome) => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        };
      });

      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => settle({ kind: "aborted" });
      controller.signal.addEventListener("abort", onAbort, { once: true });

      /** Writes the terminal state, unless something already finished the task. */
      const finalize = async (): Promise<TaskRecord> => {
        controller.signal.removeEventListener("abort", onAbort);
        if (timer !== undefined) clearTimeout(timer);
        if (!controller.signal.aborted) controller.abort();
        runs.delete(taskId);
        return store.get(taskId) ?? task;
      };

      const failNow = async (error: unknown, code: string): Promise<TaskRecord> => {
        const current = store.get(taskId);
        if (current && !isFinished(current)) {
          store.update(taskId, {
            state: "failed",
            error: toTaskError(error, code),
            summary: text.value(),
            artifacts: [...artifacts.values()],
            pendingPermissions: [],
          });
        }
        return finalize();
      };

      // ---- start ------------------------------------------------------------
      try {
        store.update(taskId, { state: "running", startedAt: now() });
      } catch {
        // The task was cancelled between `add` and `run`, so `queued -> running` is no
        // longer legal. The terminal state already recorded is the right answer.
        return finalize();
      }

      let sessionId: string;
      try {
        const session = await connection.createSession({
          title: taskTitle(task.goal),
          ...(task.agent ? { agent: task.agent } : {}),
          ...(task.model ? { model: task.model } : {}),
        });
        sessionId = session.id;
      } catch (error) {
        return failNow(error, "task_session_failed");
      }
      active.sessionId = sessionId;
      store.update(taskId, { sessionId, engineId: connection.engineId });

      // ---- events -----------------------------------------------------------
      const syncPermissions = (): void => {
        const list = [...pending.values()];
        const current = store.get(taskId);
        if (!current || isFinished(current)) return;
        if (list.length > 0 && current.state === "running") {
          store.update(taskId, { state: "awaiting_approval", pendingPermissions: list });
          return;
        }
        if (list.length === 0 && current.state === "awaiting_approval") {
          store.update(taskId, { state: "running", pendingPermissions: [] });
          return;
        }
        store.update(taskId, { pendingPermissions: list });
      };

      const onEvent = (event: EngineEvent): void => {
        if (settled) return;
        if (event.type === "message.delta" && event.kind === "text") {
          text.append(event.delta);
          return;
        }
        if (event.type === "tool.called") {
          toolInputs.set(event.callId, event.input);
          return;
        }
        if (event.type === "tool.completed") {
          const artifact = extractTaskArtifact(event, now(), toolInputs.get(event.callId));
          toolInputs.delete(event.callId);
          if (artifact) artifacts.set(artifact.id, artifact);
          return;
        }
        if (event.type === "permission.asked") {
          if (task.approvalPolicy === "auto") {
            void connection
              .replyPermission({
                sessionId: event.permission.sessionId,
                permissionId: event.permission.id,
                reply: "once",
              })
              .catch((error: unknown) => {
                settle({ kind: "failed", error: toTaskError(error, "task_permission_failed") });
              });
            return;
          }
          pending.set(event.permission.id, toPendingPermission(event.permission));
          syncPermissions();
          return;
        }
        if (event.type === "permission.replied") {
          if (pending.delete(event.requestId)) syncPermissions();
          return;
        }
        if (event.type === "session.error") {
          settle({
            kind: "failed",
            error: {
              code: event.error.code ?? "task_engine_error",
              message: event.error.message,
            },
          });
          return;
        }
        if (event.type === "session.idle") {
          // The engine also idles while a manual approval is outstanding; that is a
          // pause, not a result.
          if (pending.size === 0) settle({ kind: "done" });
          return;
        }
      };

      let subscription: Promise<void> = Promise.resolve();
      if (connection.capabilities.streaming) {
        subscription = connection
          .subscribe({ sessionId, signal: controller.signal, onEvent })
          .catch((error: unknown) => {
            if (controller.signal.aborted || settled) return;
            settle({ kind: "failed", error: toTaskError(error, "task_stream_failed") });
          });
      }

      // ---- prompt -----------------------------------------------------------
      try {
        await connection.prompt({
          sessionId,
          parts: [{ type: "text", text: task.goal }],
          ...(task.agent ? { agent: task.agent } : {}),
          ...(task.model ? { model: task.model } : {}),
        });
      } catch (error) {
        controller.abort();
        await subscription;
        return failNow(error, "task_prompt_failed");
      }

      if (task.timeoutMs !== null && task.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, task.timeoutMs);
        (timer as unknown as { unref?: () => void }).unref?.();
      }

      // An engine with no stream cannot report idleness through `onEvent`; fall back
      // to the blocking primitive when it has one, and say so plainly when it does not.
      if (!connection.capabilities.streaming) {
        if (!connection.capabilities.wait) {
          return failNow(
            new ApiError(
              501,
              "engine_capability_unsupported",
              `Engine ${connection.engineId} supports neither event streaming nor wait(), so a task cannot be observed to completion`,
              { engineId: connection.engineId },
            ),
            "engine_capability_unsupported",
          );
        }
        void connection
          .wait(sessionId, controller.signal)
          .then(() => settle({ kind: "done" }))
          .catch((error: unknown) => {
            if (controller.signal.aborted || settled) return;
            settle({ kind: "failed", error: toTaskError(error, "task_wait_failed") });
          });
      }

      const outcome = await finished;
      controller.abort();
      await subscription;

      const current = store.get(taskId);
      if (!current || isFinished(current)) {
        // Something outside the run already wrote the terminal state — `cancel()` is
        // the only such path, and it has already interrupted the session. The partial
        // summary and artifacts are still worth keeping.
        if (current) {
          store.update(taskId, { summary: text.value(), artifacts: [...artifacts.values()] });
        }
        return finalize();
      }

      if (timedOut) {
        if (connection.capabilities.interrupt) await interruptQuietly(connection, sessionId);
        store.update(taskId, {
          state: "failed",
          error: {
            code: "task_timeout",
            message: `Task exceeded its ${task.timeoutMs}ms timeout`,
          },
          summary: text.value(),
          artifacts: [...artifacts.values()],
          pendingPermissions: [],
        });
        return finalize();
      }

      if (outcome.kind === "failed") {
        store.update(taskId, {
          state: "failed",
          error: outcome.error,
          summary: text.value(),
          artifacts: [...artifacts.values()],
          pendingPermissions: [],
        });
        return finalize();
      }

      if (outcome.kind === "aborted") {
        if (connection.capabilities.interrupt) await interruptQuietly(connection, sessionId);
        store.update(taskId, {
          state: "cancelled",
          cancelReason: "Run aborted",
          summary: text.value(),
          artifacts: [...artifacts.values()],
          pendingPermissions: [],
        });
        return finalize();
      }

      // `done` is only reachable from `running`; a task parked on an approval is
      // moved back before the idle event is accepted.
      if (store.get(taskId)?.state === "awaiting_approval") {
        store.update(taskId, { state: "running", pendingPermissions: [] });
      }
      store.update(taskId, {
        state: "done",
        summary: text.value(),
        artifacts: [...artifacts.values()],
        pendingPermissions: [],
      });
      return finalize();
    },

    start(input) {
      void runner.run(input);
    },

    async cancel(taskId, reason) {
      // Marking first makes the store the single arbiter: `cancel` throws 409 for an
      // already-finished task, and the run's own finalizer then sees a terminal state
      // and does not try to transition again.
      const record = store.cancel(taskId, reason);
      const active = runs.get(taskId);
      if (active) {
        active.controller.abort();
        if (active.sessionId && active.connection.capabilities.interrupt) {
          await interruptQuietly(active.connection, active.sessionId);
        }
      }
      return record;
    },

    get active() {
      return runs.size;
    },

    shutdown() {
      for (const run of runs.values()) run.controller.abort();
      runs.clear();
    },
  };

  return runner;
}

function isFinished(task: TaskRecord): boolean {
  return task.state === "done" || task.state === "failed" || task.state === "cancelled";
}

async function interruptQuietly(connection: EngineConnection, sessionId: string): Promise<void> {
  try {
    await connection.interrupt(sessionId);
  } catch {
    // The session may already be gone; the task's state is what matters here.
  }
}

/** Session titles are a one-line handle, not the whole goal. */
export function taskTitle(goal: string, limit = 80): string {
  const line = goal.trim().split("\n")[0]?.trim() ?? "";
  const title = line || goal.trim();
  return title.length > limit ? `${title.slice(0, limit - 1)}…` : title;
}
