/**
 * `tasks` API module — the one-shot automation surface.
 *
 * The sessions module is the conversational surface: open a session, send turns, read
 * the stream. A task is the other shape of the same engine: submit a goal, walk away,
 * come back to a terminal state, a summary, and the files the run touched. Automation
 * callers (CI, cron, a webhook consumer) want that shape, and building it out of the
 * session primitives means every caller re-implements the same prompt / stream /
 * approve / timeout loop.
 *
 * A task is therefore a thin, honest wrapper over exactly one session:
 *
 *   queued -> running -> (awaiting_approval <-> running) -> done | failed | cancelled
 *
 * The task never becomes a second permission system. Under `approvalPolicy: "manual"`
 * it parks in `awaiting_approval` and publishes the `sessionId` + `permissionId`, and
 * the caller answers through the sessions module's permission endpoint — one pending
 * permission, one owner.
 *
 * ## Tasks are in-memory and are lost on restart
 *
 * This is the module's most important caveat, so it is stated in the module
 * description, in the `createTask` summary, in the `createTask` response schema, and
 * in `store.ts`. Records live in the server process: a restart, a crash, or a second
 * server instance loses them, and `getTask` will answer `404` for an id that was
 * valid a moment earlier. A caller that needs durability must record the returned
 * `sessionId` — the session itself is engine-persisted — and reconcile from there.
 */

import { ApiError } from "../../../errors.js";
import type { EngineConnection } from "../../engine/types.js";
import type {
  ApiModule,
  ApiModuleContext,
  ApiModuleServices,
  ApiOperation,
  JsonSchema,
} from "../../module.js";
import { createSseResponse } from "../../sse.js";
import type { RequestContext } from "../../../routes/registry.js";
import { createTaskRunner, type TaskRunner } from "./runner.js";
import {
  createTaskStore,
  isTerminalTaskState,
  TASK_STATES,
  type TaskApprovalPolicy,
  type TaskEvent,
  type TaskModelRef,
  type TaskRecord,
  type TaskState,
  type TaskStore,
} from "./store.js";

/* -------------------------------------------------------------------------- */
/* Services                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Structural view of `EngineAdapterRegistry` (`../../engine/types.ts`).
 *
 * Declared structurally rather than imported as a class so a test can hand in a stub
 * registry, and so the module depends on the lookup it uses rather than on the
 * concrete registry implementation.
 */
export interface TasksEngineRegistryLike {
  get(engineId?: string | null): { connect(workspace: unknown): EngineConnection };
}

/** What `tasks` reads out of `ApiModuleContext.services`. */
export interface TasksModuleServices extends ApiModuleServices {
  /** Required. The server injects its `EngineAdapterRegistry` here. */
  engines?: TasksEngineRegistryLike;
  /** Optional overrides, used by tests and by a future durable implementation. */
  taskStore?: TaskStore;
  taskRunner?: TaskRunner;
}

const MAX_GOAL_CHARS = 100_000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Request parsing                                                             */
/* -------------------------------------------------------------------------- */

export interface TaskCreateRequest {
  goal: string;
  agent: string | null;
  model: TaskModelRef | null;
  approvalPolicy: TaskApprovalPolicy;
  timeoutMs: number | null;
  metadata: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string, field: string): ApiError {
  return new ApiError(400, "invalid_request", message, { field });
}

/**
 * Validates a `createTask` body.
 *
 * Pure and exported so the contract can be tested without a request, and so the
 * failure mode is a `400` with the offending field rather than a task that runs with
 * a silently coerced goal.
 */
/**
 * The strongest approval posture the caller may ask for.
 *
 * A server started with `IPOLLOWORK_APPROVAL_MODE=manual` is stating that a human sees
 * every write. The task runner answers permission requests itself, so an unconstrained
 * `approvalPolicy: "auto"` in the request body would quietly opt out of that — one POST
 * and the operator's setting is gone. The server's mode is a floor, not a default.
 */
export function resolveTaskApprovalPolicy(
  requested: TaskApprovalPolicy,
  serverMode: string | undefined,
): TaskApprovalPolicy {
  return serverMode === "manual" ? "manual" : requested;
}

export function parseCreateTaskBody(body: Record<string, unknown>): TaskCreateRequest {
  const rawGoal = body.goal;
  if (typeof rawGoal !== "string" || !rawGoal.trim()) {
    throw invalid("goal is required and must be a non-empty string", "goal");
  }
  if (rawGoal.length > MAX_GOAL_CHARS) {
    throw invalid(`goal must be at most ${MAX_GOAL_CHARS} characters`, "goal");
  }

  let agent: string | null = null;
  if (body.agent !== undefined && body.agent !== null) {
    if (typeof body.agent !== "string" || !body.agent.trim()) {
      throw invalid("agent must be a non-empty string", "agent");
    }
    agent = body.agent.trim();
  }

  let model: TaskModelRef | null = null;
  if (body.model !== undefined && body.model !== null) {
    if (!isRecord(body.model)) throw invalid("model must be an object", "model");
    const providerID = body.model.providerID;
    const modelID = body.model.modelID;
    if (typeof providerID !== "string" || !providerID.trim()) {
      throw invalid("model.providerID is required", "model.providerID");
    }
    if (typeof modelID !== "string" || !modelID.trim()) {
      throw invalid("model.modelID is required", "model.modelID");
    }
    model = { providerID: providerID.trim(), modelID: modelID.trim() };
  }

  let approvalPolicy: TaskApprovalPolicy = "auto";
  if (body.approvalPolicy !== undefined && body.approvalPolicy !== null) {
    if (body.approvalPolicy !== "auto" && body.approvalPolicy !== "manual") {
      throw invalid('approvalPolicy must be "auto" or "manual"', "approvalPolicy");
    }
    approvalPolicy = body.approvalPolicy;
  }

  let timeoutMs: number | null = null;
  if (body.timeoutMs !== undefined && body.timeoutMs !== null) {
    const value = body.timeoutMs;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw invalid("timeoutMs must be a positive integer", "timeoutMs");
    }
    if (value > MAX_TIMEOUT_MS) {
      throw invalid(`timeoutMs must be at most ${MAX_TIMEOUT_MS}`, "timeoutMs");
    }
    timeoutMs = value;
  }

  let metadata: Record<string, unknown> = {};
  if (body.metadata !== undefined && body.metadata !== null) {
    if (!isRecord(body.metadata)) throw invalid("metadata must be an object", "metadata");
    metadata = body.metadata;
  }

  return { goal: rawGoal.trim(), agent, model, approvalPolicy, timeoutMs, metadata };
}

/** Parses `?state=` / `?limit=`, rejecting an unknown state rather than ignoring it. */
export function parseTaskListQuery(params: URLSearchParams): { state?: TaskState[]; limit?: number } {
  const result: { state?: TaskState[]; limit?: number } = {};

  const stateValues = params
    .getAll("state")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (stateValues.length > 0) {
    for (const value of stateValues) {
      if (!(TASK_STATES as readonly string[]).includes(value)) {
        throw new ApiError(400, "invalid_request", `Unknown task state: ${value}`, {
          field: "state",
          allowed: TASK_STATES,
        });
      }
    }
    result.state = stateValues as TaskState[];
  }

  const limitValue = params.get("limit");
  if (limitValue !== null && limitValue.trim() !== "") {
    const limit = Number(limitValue);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ApiError(400, "invalid_request", "limit must be a positive integer", { field: "limit" });
    }
    result.limit = limit;
  }

  return result;
}

export function parseAfterCursor(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const seq = Number(value);
  if (!Number.isInteger(seq) || seq < 0) {
    throw new ApiError(400, "invalid_request", "after must be a non-negative integer sequence", {
      field: "after",
    });
  }
  return seq;
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                               */
/* -------------------------------------------------------------------------- */

/** Explicit wire shape, so an internal field added to `TaskRecord` cannot leak. */
export function serializeTask(task: TaskRecord): Record<string, unknown> {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    state: task.state,
    goal: task.goal,
    agent: task.agent,
    model: task.model,
    approvalPolicy: task.approvalPolicy,
    timeoutMs: task.timeoutMs,
    metadata: task.metadata,
    sessionId: task.sessionId,
    engineId: task.engineId,
    summary: task.summary,
    artifacts: task.artifacts,
    pendingPermissions: task.pendingPermissions,
    error: task.error,
    cancelReason: task.cancelReason,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  };
}

export function serializeTaskEvent(event: TaskEvent): Record<string, unknown> {
  return {
    seq: event.seq,
    at: event.at,
    taskId: event.taskId,
    type: event.type,
    ...(event.from !== undefined ? { from: event.from } : {}),
    ...(event.to !== undefined ? { to: event.to } : {}),
    task: serializeTask(event.task),
  };
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                     */
/* -------------------------------------------------------------------------- */

const MODEL_SCHEMA: JsonSchema = {
  type: "object",
  description: "Engine model reference. Defaults to the workspace's configured model.",
  properties: {
    providerID: { type: "string", minLength: 1 },
    modelID: { type: "string", minLength: 1 },
  },
  required: ["providerID", "modelID"],
  additionalProperties: false,
};

const ARTIFACT_SCHEMA: JsonSchema = {
  type: "object",
  description: "Something the run produced, derived from a successful file-writing tool call.",
  properties: {
    id: { type: "string", description: "The engine tool call id." },
    kind: { type: "string", enum: ["file", "output"] },
    tool: { type: "string" },
    path: { type: "string", description: "Absent when the tool call reported no path." },
    createdAt: { type: "integer" },
  },
  required: ["id", "kind", "tool", "createdAt"],
  additionalProperties: false,
};

const PENDING_PERMISSION_SCHEMA: JsonSchema = {
  type: "object",
  description:
    "A permission the engine is waiting on. Answer it through the sessions module's "
    + "permission endpoint using `sessionId` and `permissionId`; tasks deliberately do "
    + "not expose a second way to reply to the same permission.",
  properties: {
    permissionId: { type: "string" },
    sessionId: { type: "string" },
    kind: { type: "string", description: "Engine-specific permission kind, normally the tool name." },
    resources: { type: "array", items: { type: "string" } },
    askedAt: { type: "integer" },
  },
  required: ["permissionId", "sessionId", "kind", "resources", "askedAt"],
  additionalProperties: false,
};

const TASK_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    state: {
      type: "string",
      enum: [...TASK_STATES],
      description:
        "queued -> running -> (awaiting_approval <-> running) -> done | failed | cancelled. "
        + "`done`, `failed` and `cancelled` are terminal.",
    },
    goal: { type: "string" },
    agent: { type: ["string", "null"] },
    model: { oneOf: [MODEL_SCHEMA, { type: "null" }] },
    approvalPolicy: { type: "string", enum: ["auto", "manual"] },
    timeoutMs: { type: ["integer", "null"] },
    metadata: { type: "object", additionalProperties: true },
    sessionId: {
      type: ["string", "null"],
      description:
        "The session the task runs in. Null until the runner has created it. This is the "
        + "only durable handle a task exposes — the session outlives the task record.",
    },
    engineId: { type: ["string", "null"] },
    summary: {
      type: "string",
      description: "Assistant text collected from the run, truncated from the front when long.",
    },
    artifacts: { type: "array", items: ARTIFACT_SCHEMA },
    pendingPermissions: { type: "array", items: PENDING_PERMISSION_SCHEMA },
    error: {
      oneOf: [
        {
          type: "object",
          properties: { code: { type: "string" }, message: { type: "string" } },
          required: ["code", "message"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    cancelReason: { type: ["string", "null"] },
    createdAt: { type: "integer" },
    updatedAt: { type: "integer" },
    startedAt: { type: ["integer", "null"] },
    completedAt: { type: ["integer", "null"] },
  },
  required: [
    "id",
    "workspaceId",
    "state",
    "goal",
    "approvalPolicy",
    "metadata",
    "summary",
    "artifacts",
    "pendingPermissions",
    "createdAt",
    "updatedAt",
  ],
  additionalProperties: false,
};

const CREATED_TASK_SCHEMA: JsonSchema = {
  ...TASK_SCHEMA,
  description:
    "The accepted task, in state `queued` or `running`. **Tasks are held in server "
    + "memory and are lost on restart**: this id is not durable, and `getTask` will "
    + "answer 404 for it after the server restarts, crashes, or fails over to another "
    + "instance. Record `sessionId` if you need a handle that survives — the underlying "
    + "session is persisted by the engine.",
};

const WORKSPACE_PATH_PARAMS: JsonSchema = {
  type: "object",
  properties: { workspaceId: { type: "string" } },
  required: ["workspaceId"],
};

const TASK_PATH_PARAMS: JsonSchema = {
  type: "object",
  properties: { workspaceId: { type: "string" }, taskId: { type: "string" } },
  required: ["workspaceId", "taskId"],
};

const CREATE_TASK_BODY: JsonSchema = {
  type: "object",
  properties: {
    goal: {
      type: "string",
      minLength: 1,
      maxLength: MAX_GOAL_CHARS,
      description: "What the agent should accomplish. Sent verbatim as the first prompt.",
    },
    agent: { type: "string", minLength: 1, description: "Agent / mode id understood by the engine." },
    model: MODEL_SCHEMA,
    approvalPolicy: {
      type: "string",
      enum: ["auto", "manual"],
      default: "auto",
      description:
        "`auto` answers every permission request with `once` and keeps running. `manual` "
        + "moves the task to `awaiting_approval` and publishes the pending permission, which "
        + "the caller answers through the sessions module. A server running with "
        + "`IPOLLOWORK_APPROVAL_MODE=manual` forces `manual` regardless of what is requested: "
        + "the operator's posture is a floor, not a default. The task's effective policy is "
        + "reported back on the created task.",
    },
    timeoutMs: {
      type: "integer",
      minimum: 1,
      maximum: MAX_TIMEOUT_MS,
      description: "Wall-clock budget. On expiry the session is interrupted and the task fails with `task_timeout`.",
    },
    metadata: { type: "object", additionalProperties: true, description: "Opaque caller data, echoed back." },
  },
  required: ["goal"],
  additionalProperties: false,
};

const CANCEL_TASK_BODY: JsonSchema = {
  type: "object",
  properties: { reason: { type: "string", description: "Recorded on the task as `cancelReason`." } },
  additionalProperties: false,
};

const TASK_EVENT_SCHEMA: JsonSchema = {
  type: "object",
  description: "One SSE frame payload. Every event carries the full task snapshot.",
  properties: {
    seq: { type: "integer", description: "Monotonic cursor. Pass the last one back as `?after=`." },
    at: { type: "integer" },
    taskId: { type: "string" },
    type: { type: "string", enum: ["task.created", "task.state", "task.updated"] },
    from: { type: "string", enum: [...TASK_STATES], description: "Present on `task.state`." },
    to: { type: "string", enum: [...TASK_STATES], description: "Present on `task.state`." },
    task: TASK_SCHEMA,
  },
  required: ["seq", "at", "taskId", "type", "task"],
};

const ERROR_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    details: {},
  },
  required: ["code", "message"],
};

function errorResponse(description: string) {
  return { description, schema: ERROR_SCHEMA };
}

/* -------------------------------------------------------------------------- */
/* Module                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Reads an optional JSON body.
 *
 * `cancelTask` takes no required input, and a `POST` with no body at all is the
 * normal way to call it; `readJsonBody` rejects that as invalid JSON.
 */
async function readOptionalJsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid JSON body");
  }
}

export const tasksModule: ApiModule = {
  id: "tasks",
  title: "Tasks",
  description:
    "One-shot automation over a session: submit a goal, poll or stream until the task "
    + "reaches done / failed / cancelled, then read its summary and artifacts. "
    + "Tasks are held in server memory only and are LOST ON RESTART — the task id is not "
    + "durable, while the `sessionId` a task reports is. Manual approvals are answered "
    + "through the sessions module, not here.",
  version: "1.0.0",
  stability: "preview",
  dependsOn: ["sessions"],

  register(context: ApiModuleContext): ApiOperation[] {
    const services = context.services as TasksModuleServices;
    const store = services.taskStore ?? createTaskStore();
    const runner = services.taskRunner ?? createTaskRunner({ store });

    const engines = (): TasksEngineRegistryLike => {
      if (!services.engines) {
        throw new ApiError(
          500,
          "api_service_missing",
          "The tasks module requires an engine registry in ApiModuleContext.services.engines",
          { service: "engines" },
        );
      }
      return services.engines;
    };

    const connect = async (ctx: RequestContext): Promise<EngineConnection> => {
      const workspace = await context.resolveWorkspace(ctx.config, ctx.params.workspaceId ?? "");
      const engineId = isRecord(workspace) && typeof workspace.engineId === "string"
        ? workspace.engineId
        : null;
      return engines().get(engineId).connect(workspace);
    };

    return [
      {
        operationId: "createTask",
        method: "POST",
        path: "/api/v1/workspaces/:workspaceId/tasks",
        summary: "Submit a goal as a background task (in-memory; lost on restart)",
        description:
          "Creates a session, sends `goal` as its first prompt, and drives it to a terminal "
          + "state. Returns immediately with the queued task; follow it with `getTask` or "
          + "`streamTaskEvents`. The task record lives in server memory and does not survive a "
          + "restart — persist the returned `sessionId` if you need a durable handle.",
        effect: "write",
        pathParams: WORKSPACE_PATH_PARAMS,
        requestBody: CREATE_TASK_BODY,
        responses: {
          202: { description: "Task accepted and queued.", schema: CREATED_TASK_SCHEMA },
          400: errorResponse("The body failed validation."),
          403: errorResponse("The server is read-only or the token scope is insufficient."),
          404: errorResponse("Unknown workspace."),
          409: errorResponse("The workspace's engine is not registered."),
        },
        handler: async (ctx) => {
          const workspaceId = ctx.params.workspaceId ?? "";
          const body = await context.readJsonBody(ctx.request);
          const request = parseCreateTaskBody(body);
          // Resolved before the task is recorded, so an unknown workspace or an
          // unregistered engine is a 404/409 rather than a task that fails a beat later.
          const connection = await connect(ctx);

          const task = store.add({
            workspaceId,
            goal: request.goal,
            agent: request.agent,
            model: request.model,
            approvalPolicy: resolveTaskApprovalPolicy(request.approvalPolicy, ctx.config.approval?.mode),
            timeoutMs: request.timeoutMs,
            metadata: request.metadata,
          });
          runner.start({ task, connection });
          return context.jsonResponse(serializeTask(store.get(task.id) ?? task), 202);
        },
      },

      {
        operationId: "listTasks",
        method: "GET",
        path: "/api/v1/workspaces/:workspaceId/tasks",
        summary: "List the tasks this server instance is holding",
        description:
          "Newest first. Only tasks created since the current server process started are "
          + "visible; there is no historical archive.",
        effect: "read",
        pathParams: WORKSPACE_PATH_PARAMS,
        query: {
          type: "object",
          properties: {
            state: {
              type: "string",
              description: "Repeatable, or comma-separated. Filters by task state.",
              enum: [...TASK_STATES],
            },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          },
        },
        responses: {
          200: {
            description: "The matching tasks.",
            schema: {
              type: "object",
              properties: {
                items: { type: "array", items: TASK_SCHEMA },
                count: { type: "integer" },
                durable: {
                  type: "boolean",
                  description: "Always false. Tasks are in-memory and are lost on restart.",
                },
              },
              required: ["items", "count", "durable"],
            },
          },
          400: errorResponse("An unknown state or a malformed limit."),
          404: errorResponse("Unknown workspace."),
        },
        handler: async (ctx) => {
          const workspaceId = ctx.params.workspaceId ?? "";
          await context.resolveWorkspace(ctx.config, workspaceId);
          const query = parseTaskListQuery(ctx.url.searchParams);
          const items = store.list({ workspaceId, ...query });
          return context.jsonResponse({
            items: items.map(serializeTask),
            count: items.length,
            durable: false,
          });
        },
      },

      {
        operationId: "getTask",
        method: "GET",
        path: "/api/v1/workspaces/:workspaceId/tasks/:taskId",
        summary: "Read one task",
        description:
          "Answers 404 for a task from another workspace, and for any task created before "
          + "the current server process started.",
        effect: "read",
        pathParams: TASK_PATH_PARAMS,
        responses: {
          200: { description: "The task.", schema: TASK_SCHEMA },
          404: errorResponse("Unknown workspace, or unknown task in that workspace."),
        },
        handler: async (ctx) => {
          const workspaceId = ctx.params.workspaceId ?? "";
          await context.resolveWorkspace(ctx.config, workspaceId);
          const task = store.require(ctx.params.taskId ?? "", workspaceId);
          return context.jsonResponse(serializeTask(task));
        },
      },

      {
        operationId: "cancelTask",
        method: "POST",
        path: "/api/v1/workspaces/:workspaceId/tasks/:taskId/cancel",
        summary: "Cancel a running or queued task",
        description:
          "Moves the task to `cancelled`, aborts the run, and interrupts the underlying "
          + "session when the engine supports interruption. Already-terminal tasks answer 409; "
          + "cancellation is not idempotent on purpose, so a caller can tell whether it was the "
          + "one that stopped the task.",
        effect: "write",
        pathParams: TASK_PATH_PARAMS,
        requestBody: CANCEL_TASK_BODY,
        responses: {
          200: { description: "The cancelled task.", schema: TASK_SCHEMA },
          404: errorResponse("Unknown workspace, or unknown task in that workspace."),
          409: errorResponse("The task already reached a terminal state."),
        },
        handler: async (ctx) => {
          const workspaceId = ctx.params.workspaceId ?? "";
          await context.resolveWorkspace(ctx.config, workspaceId);
          const taskId = ctx.params.taskId ?? "";
          store.require(taskId, workspaceId);
          const body = await readOptionalJsonBody(ctx.request);
          const reason = typeof body.reason === "string" ? body.reason : undefined;
          const task = await runner.cancel(taskId, reason);
          return context.jsonResponse(serializeTask(task));
        },
      },

      {
        operationId: "streamTaskEvents",
        method: "GET",
        path: "/api/v1/workspaces/:workspaceId/tasks/:taskId/events",
        summary: "Stream a task's state changes as SSE",
        description:
          "Frames use the shared SSE format: `id:` is the event `seq`, `event:` is the event "
          + "type, `data:` is a JSON `TaskEvent` carrying the full task snapshot. The buffered "
          + "log is replayed first (pass `?after=<seq>` to resume from a cursor), and the stream "
          + "closes on its own once the task reaches a terminal state. This is a coarse "
          + "state-change stream — for token-level output subscribe to the task's `sessionId` "
          + "through the sessions module.",
        effect: "read",
        streaming: "sse",
        pathParams: TASK_PATH_PARAMS,
        query: {
          type: "object",
          properties: {
            after: {
              type: "integer",
              minimum: 0,
              description: "Replay only events with a greater `seq`. Omit to replay the whole buffer.",
            },
          },
        },
        responses: {
          200: {
            description: "An event stream of `TaskEvent` frames.",
            contentType: "text/event-stream",
            schema: TASK_EVENT_SCHEMA,
          },
          400: errorResponse("A malformed `after` cursor."),
          404: errorResponse("Unknown workspace, or unknown task in that workspace."),
        },
        handler: async (ctx) => {
          const workspaceId = ctx.params.workspaceId ?? "";
          await context.resolveWorkspace(ctx.config, workspaceId);
          const taskId = ctx.params.taskId ?? "";
          const task = store.require(taskId, workspaceId);
          const after = parseAfterCursor(ctx.url.searchParams.get("after"));

          return createSseResponse({
            signal: ctx.request.signal,
            hello: {
              event: "stream.open",
              data: { taskId, state: task.state, after: after ?? null },
            },
            start: (emit, signal) =>
              new Promise<void>((resolve) => {
                let done = false;
                let unsubscribe: (() => void) | null = null;
                const finish = (): void => {
                  if (done) return;
                  done = true;
                  unsubscribe?.();
                  signal.removeEventListener("abort", finish);
                  resolve();
                };

                if (signal.aborted) {
                  finish();
                  return;
                }
                signal.addEventListener("abort", finish, { once: true });

                // `after ?? 0` replays the whole retained log for a fresh subscriber,
                // which is also what closes the stream immediately for a task that
                // already finished before anyone attached.
                const off = store.subscribe({
                  taskId,
                  after: after ?? 0,
                  onEvent: (event) => {
                    if (done) return;
                    emit({
                      id: String(event.seq),
                      event: event.type,
                      data: serializeTaskEvent(event),
                    });
                    if (isTerminalTaskState(event.task.state)) finish();
                  },
                });
                if (done) off();
                else unsubscribe = off;

                // Safety net for a task that reached its terminal state with an empty
                // retained log (evicted, or resumed past the final seq).
                const current = store.get(taskId);
                if (current && isTerminalTaskState(current.state)) finish();
              }),
          });
        },
      },
    ];
  },
};

export default tasksModule;
