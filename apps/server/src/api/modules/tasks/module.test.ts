import { describe, expect, test } from "bun:test";

import { ApiError, isApiError } from "../../../errors.js";
import type { RequestContext, Route } from "../../../routes/registry.js";
import { matchRoute } from "../../../routes/registry.js";
import type { ServerConfig } from "../../../types.js";
import type {
  EngineCapabilities,
  EngineConnection,
  EngineEvent,
  EnginePromptInput,
  EngineSession,
} from "../../engine/types.js";
import { registerApiModules, type ApiModule, type ApiModuleContext, type ApiOperation } from "../../module.js";
import { createTaskRunner, createTaskTextAccumulator, extractTaskArtifact, taskTitle } from "./runner.js";
import { createTaskStore, type TaskRecord, type TaskStore } from "./store.js";
import {
  parseAfterCursor,
  parseCreateTaskBody,
  parseTaskListQuery,
  resolveTaskApprovalPolicy,
  serializeTask,
  tasksModule,
  type TasksModuleServices,
} from "./module.js";

/* -------------------------------------------------------------------------- */
/* Stubs                                                                       */
/* -------------------------------------------------------------------------- */

const config = { workspaces: [], readOnly: false } as unknown as ServerConfig;

const STUB_CAPABILITIES: EngineCapabilities = {
  streaming: true,
  resumableStreaming: false,
  permissions: true,
  questions: false,
  interrupt: true,
  wait: false,
  promptOptions: { system: true, reasoningEffort: true, variant: true },
};

interface StubConnection extends EngineConnection {
  emit(event: EngineEvent): void;
  /** Resolves once `subscribe` has attached. */
  ready: Promise<void>;
  prompts: EnginePromptInput[];
  createdSessions: Array<{ title?: string; agent?: string }>;
  permissionReplies: Array<{ permissionId: string; reply: string }>;
  interrupts: string[];
}

function createStubConnection(overrides: {
  capabilities?: Partial<EngineCapabilities>;
  createSession?: () => Promise<EngineSession>;
  prompt?: () => Promise<{ messageId?: string }>;
  sessionId?: string;
} = {}): StubConnection {
  const sessionId = overrides.sessionId ?? "session-1";
  const prompts: EnginePromptInput[] = [];
  const createdSessions: Array<{ title?: string; agent?: string }> = [];
  const permissionReplies: Array<{ permissionId: string; reply: string }> = [];
  const interrupts: string[] = [];

  let listener: ((event: EngineEvent) => void) | null = null;
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const unsupported = async (): Promise<never> => {
    throw new ApiError(501, "not_implemented", "not used by these tests");
  };

  const connection: StubConnection = {
    engineId: "stub-engine",
    capabilities: { ...STUB_CAPABILITIES, ...overrides.capabilities },

    createSession: overrides.createSession
      ?? (async (input) => {
        createdSessions.push({ ...(input.title !== undefined ? { title: input.title } : {}), ...(input.agent !== undefined ? { agent: input.agent } : {}) });
        return { id: sessionId, title: input.title ?? "stub" };
      }),
    getSession: async () => ({ id: sessionId, title: "stub" }),
    deleteSession: unsupported,
    renameSession: unsupported,

    prompt: overrides.prompt
      ?? (async (input) => {
        prompts.push(input);
        return {};
      }),
    interrupt: async (id) => {
      interrupts.push(id);
      return true;
    },
    wait: async () => {},

    listPermissions: async () => [],
    replyPermission: async ({ permissionId, reply }) => {
      permissionReplies.push({ permissionId, reply });
    },
    listQuestions: async () => [],
    replyQuestion: unsupported,

    subscribe: async ({ onEvent, signal }) => {
      listener = onEvent;
      markReady();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      listener = null;
    },

    emit(event) {
      listener?.(event);
    },
    ready,
    prompts,
    createdSessions,
    permissionReplies,
    interrupts,
  };

  return connection;
}

/** Lets pending microtasks and a macrotask turn run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function textDelta(sessionId: string, delta: string): EngineEvent {
  return { type: "message.delta", sessionId, messageId: "m1", partId: "p1", kind: "text", delta };
}

function idle(sessionId: string): EngineEvent {
  return { type: "session.idle", sessionId };
}

/* -------------------------------------------------------------------------- */
/* Module context                                                              */
/* -------------------------------------------------------------------------- */

function createModuleContext(services: TasksModuleServices = {}): ApiModuleContext {
  return {
    config,
    ensureWritable: () => {},
    requireClientScope: () => {},
    jsonResponse: (data, status = 200) => Response.json(data as never, { status }),
    readJsonBody: async (request) => {
      try {
        return (await request.json()) as Record<string, unknown>;
      } catch {
        throw new ApiError(400, "invalid_json", "Invalid JSON body");
      }
    },
    resolveWorkspace: async (_config, id) => {
      if (id !== "w1") throw new ApiError(404, "workspace_not_found", `Unknown workspace: ${id}`);
      return { id, engineId: "stub-engine" };
    },
    services,
  };
}

function requestContext(
  request: Request,
  params: Record<string, string> = {},
): RequestContext {
  return {
    request,
    url: new URL(request.url),
    params,
    config,
    approvals: {} as never,
    reloadEvents: {} as never,
    tokens: {} as never,
  };
}

function operationsOf(services: TasksModuleServices): Map<string, ApiOperation> {
  const operations = tasksModule.register(createModuleContext(services));
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

function stubRegistry(connection: EngineConnection) {
  return {
    get: () => ({ connect: () => connection }),
  };
}

/* -------------------------------------------------------------------------- */
/* Declaration                                                                 */
/* -------------------------------------------------------------------------- */

describe("tasksModule declaration", () => {
  test("identifies itself and depends on sessions", () => {
    expect(tasksModule.id).toBe("tasks");
    expect(tasksModule.version).toBe("1.0.0");
    expect(tasksModule.stability).toBe("preview");
    expect(tasksModule.dependsOn).toEqual(["sessions"]);
  });

  test("says out loud that tasks do not survive a restart", () => {
    expect(tasksModule.description).toMatch(/LOST ON RESTART/);
  });

  test("declares exactly the five task operations", () => {
    const operations = tasksModule.register(createModuleContext());
    expect(operations.map((operation) => [operation.operationId, operation.method, operation.path, operation.effect]))
      .toEqual([
        ["createTask", "POST", "/api/v1/workspaces/:workspaceId/tasks", "write"],
        ["listTasks", "GET", "/api/v1/workspaces/:workspaceId/tasks", "read"],
        ["getTask", "GET", "/api/v1/workspaces/:workspaceId/tasks/:taskId", "read"],
        ["cancelTask", "POST", "/api/v1/workspaces/:workspaceId/tasks/:taskId/cancel", "write"],
        ["streamTaskEvents", "GET", "/api/v1/workspaces/:workspaceId/tasks/:taskId/events", "read"],
      ]);
  });

  test("every operation documents a schema and its failure responses", () => {
    for (const operation of tasksModule.register(createModuleContext())) {
      expect(operation.summary.length).toBeGreaterThan(0);
      expect(operation.pathParams).toBeDefined();
      expect(Object.keys(operation.responses ?? {}).length).toBeGreaterThan(1);
      const success = operation.responses?.[200] ?? operation.responses?.[202];
      expect(success?.schema).toBeDefined();
    }
  });

  test("only streamTaskEvents streams, and it streams SSE", () => {
    const operations = tasksModule.register(createModuleContext());
    for (const operation of operations) {
      expect(operation.streaming).toBe(operation.operationId === "streamTaskEvents" ? "sse" : undefined);
    }
    const stream = operations.find((operation) => operation.operationId === "streamTaskEvents");
    expect(stream?.responses?.[200]?.contentType).toBe("text/event-stream");
  });

  test("the createTask response schema repeats the durability caveat", () => {
    const create = tasksModule.register(createModuleContext())
      .find((operation) => operation.operationId === "createTask");
    const schema = create?.responses?.[202]?.schema as { description?: string } | undefined;
    expect(schema?.description).toMatch(/lost on restart/i);
  });

  test("registers onto the route table alongside a sessions module", () => {
    const routes: Route[] = [];
    const sessions: ApiModule = {
      id: "sessions",
      title: "Sessions",
      description: "stub",
      version: "1.0.0",
      stability: "stable",
      register: () => [],
    };
    const result = registerApiModules(routes, [sessions, tasksModule], createModuleContext());
    expect(result.operations).toHaveLength(5);
    expect(matchRoute(routes, "POST", "/api/v1/workspaces/w1/tasks")).not.toBeNull();
    expect(matchRoute(routes, "GET", "/api/v1/workspaces/w1/tasks/t1/events")?.params)
      .toEqual({ workspaceId: "w1", taskId: "t1" });
  });

  test("refuses to register without the sessions module", () => {
    expect(() => registerApiModules([], [tasksModule], createModuleContext()))
      .toThrow(/requires sessions/);
  });
});

/* -------------------------------------------------------------------------- */
/* Body and query validation                                                   */
/* -------------------------------------------------------------------------- */

describe("parseCreateTaskBody", () => {
  test("accepts a minimal body and fills the documented defaults", () => {
    expect(parseCreateTaskBody({ goal: "  do the thing  " })).toEqual({
      goal: "do the thing",
      agent: null,
      model: null,
      approvalPolicy: "auto",
      timeoutMs: null,
      metadata: {},
    });
  });

  test("accepts a full body", () => {
    expect(parseCreateTaskBody({
      goal: "refactor",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude" },
      approvalPolicy: "manual",
      timeoutMs: 5_000,
      metadata: { ticket: "ABC-1" },
    })).toEqual({
      goal: "refactor",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude" },
      approvalPolicy: "manual",
      timeoutMs: 5_000,
      metadata: { ticket: "ABC-1" },
    });
  });

  const rejected: Array<[string, Record<string, unknown>, string]> = [
    ["a missing goal", {}, "goal"],
    ["a blank goal", { goal: "   " }, "goal"],
    ["a non-string goal", { goal: 42 }, "goal"],
    ["an over-long goal", { goal: "x".repeat(100_001) }, "goal"],
    ["a blank agent", { goal: "g", agent: "  " }, "agent"],
    ["a non-object model", { goal: "g", model: "claude" }, "model"],
    ["a model without providerID", { goal: "g", model: { modelID: "m" } }, "model.providerID"],
    ["a model without modelID", { goal: "g", model: { providerID: "p" } }, "model.modelID"],
    ["an unknown approvalPolicy", { goal: "g", approvalPolicy: "sometimes" }, "approvalPolicy"],
    ["a zero timeout", { goal: "g", timeoutMs: 0 }, "timeoutMs"],
    ["a fractional timeout", { goal: "g", timeoutMs: 1.5 }, "timeoutMs"],
    ["a timeout beyond the cap", { goal: "g", timeoutMs: 86_400_001 }, "timeoutMs"],
    ["array metadata", { goal: "g", metadata: [1] }, "metadata"],
  ];

  for (const [label, body, field] of rejected) {
    test(`rejects ${label}`, () => {
      try {
        parseCreateTaskBody(body);
        throw new Error("expected a throw");
      } catch (error) {
        expect(isApiError(error)).toBe(true);
        expect((error as { status: number }).status).toBe(400);
        expect((error as { details: { field: string } }).details.field).toBe(field);
      }
    });
  }

  test("treats explicit nulls as absent", () => {
    expect(parseCreateTaskBody({ goal: "g", agent: null, model: null, timeoutMs: null, metadata: null }))
      .toMatchObject({ agent: null, model: null, timeoutMs: null, metadata: {} });
  });
});

describe("parseTaskListQuery", () => {
  test("parses repeated and comma-separated states", () => {
    expect(parseTaskListQuery(new URLSearchParams("state=running&state=done,failed")))
      .toEqual({ state: ["running", "done", "failed"] });
  });

  test("parses a limit and rejects a bad one", () => {
    expect(parseTaskListQuery(new URLSearchParams("limit=10"))).toEqual({ limit: 10 });
    expect(() => parseTaskListQuery(new URLSearchParams("limit=0"))).toThrow(/positive integer/);
    expect(() => parseTaskListQuery(new URLSearchParams("limit=abc"))).toThrow(/positive integer/);
  });

  test("rejects an unknown state instead of ignoring it", () => {
    expect(() => parseTaskListQuery(new URLSearchParams("state=pending"))).toThrow(/Unknown task state/);
  });

  test("an empty query filters nothing", () => {
    expect(parseTaskListQuery(new URLSearchParams(""))).toEqual({});
  });
});

describe("parseAfterCursor", () => {
  test("accepts a non-negative integer and rejects anything else", () => {
    expect(parseAfterCursor(null)).toBeUndefined();
    expect(parseAfterCursor("")).toBeUndefined();
    expect(parseAfterCursor("0")).toBe(0);
    expect(parseAfterCursor("7")).toBe(7);
    expect(() => parseAfterCursor("-1")).toThrow(/non-negative/);
    expect(() => parseAfterCursor("x")).toThrow(/non-negative/);
  });
});

/* -------------------------------------------------------------------------- */
/* Handlers                                                                    */
/* -------------------------------------------------------------------------- */

function createHandlerHarness() {
  const store = createTaskStore();
  const started: Array<{ task: TaskRecord; connection: EngineConnection }> = [];
  const cancelled: Array<{ taskId: string; reason?: string }> = [];
  const runner = {
    run: async ({ task }: { task: TaskRecord }) => task,
    start: (input: { task: TaskRecord; connection: EngineConnection }) => {
      started.push(input);
    },
    cancel: async (taskId: string, reason?: string) => {
      cancelled.push({ taskId, ...(reason !== undefined ? { reason } : {}) });
      return store.cancel(taskId, reason);
    },
    active: 0,
    shutdown: () => {},
  };
  const connection = createStubConnection();
  const operations = operationsOf({
    engines: stubRegistry(connection),
    taskStore: store,
    taskRunner: runner,
  });
  return { store, started, cancelled, operations, connection };
}

describe("createTask handler", () => {
  test("accepts the task with 202 and hands it to the runner", async () => {
    const harness = createHandlerHarness();
    const response = await harness.operations.get("createTask")!.handler(
      requestContext(
        new Request("http://localhost/api/v1/workspaces/w1/tasks", {
          method: "POST",
          body: JSON.stringify({ goal: "build it", metadata: { ticket: "A-1" } }),
        }),
        { workspaceId: "w1" },
      ),
    );

    expect(response.status).toBe(202);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      workspaceId: "w1",
      state: "queued",
      goal: "build it",
      approvalPolicy: "auto",
      metadata: { ticket: "A-1" },
      sessionId: null,
    });
    expect(harness.started).toHaveLength(1);
    expect(harness.started[0]?.connection).toBe(harness.connection);
    expect(harness.store.size).toBe(1);
  });

  test("rejects an invalid body without creating a task", async () => {
    const harness = createHandlerHarness();
    await expect(
      harness.operations.get("createTask")!.handler(
        requestContext(
          new Request("http://localhost/api/v1/workspaces/w1/tasks", {
            method: "POST",
            body: JSON.stringify({ goal: "" }),
          }),
          { workspaceId: "w1" },
        ),
      ),
    ).rejects.toThrow(/goal is required/);
    expect(harness.store.size).toBe(0);
    expect(harness.started).toHaveLength(0);
  });

  test("an unknown workspace fails before a task is recorded", async () => {
    const harness = createHandlerHarness();
    await expect(
      harness.operations.get("createTask")!.handler(
        requestContext(
          new Request("http://localhost/api/v1/workspaces/nope/tasks", {
            method: "POST",
            body: JSON.stringify({ goal: "build it" }),
          }),
          { workspaceId: "nope" },
        ),
      ),
    ).rejects.toThrow(/Unknown workspace/);
    expect(harness.store.size).toBe(0);
  });

  test("reports a missing engine registry as a server-side wiring error", async () => {
    const operations = operationsOf({ taskStore: createTaskStore() });
    try {
      await operations.get("createTask")!.handler(
        requestContext(
          new Request("http://localhost/api/v1/workspaces/w1/tasks", {
            method: "POST",
            body: JSON.stringify({ goal: "g" }),
          }),
          { workspaceId: "w1" },
        ),
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as { code: string; status: number }).code).toBe("api_service_missing");
      expect((error as { status: number }).status).toBe(500);
    }
  });
});

describe("listTasks and getTask handlers", () => {
  test("list is scoped to the workspace and reports durable: false", async () => {
    const harness = createHandlerHarness();
    harness.store.add({ workspaceId: "w1", goal: "a" });
    harness.store.add({ workspaceId: "other", goal: "b" });

    const response = await harness.operations.get("listTasks")!.handler(
      requestContext(new Request("http://localhost/api/v1/workspaces/w1/tasks"), { workspaceId: "w1" }),
    );
    const body = await response.json() as { items: Array<{ goal: string }>; count: number; durable: boolean };
    expect(body.count).toBe(1);
    expect(body.items[0]?.goal).toBe("a");
    expect(body.durable).toBe(false);
  });

  test("list honours the state filter", async () => {
    const harness = createHandlerHarness();
    const first = harness.store.add({ workspaceId: "w1", goal: "a" });
    harness.store.add({ workspaceId: "w1", goal: "b" });
    harness.store.update(first.id, { state: "running" });

    const response = await harness.operations.get("listTasks")!.handler(
      requestContext(new Request("http://localhost/api/v1/workspaces/w1/tasks?state=running"), { workspaceId: "w1" }),
    );
    const body = await response.json() as { count: number };
    expect(body.count).toBe(1);
  });

  test("get returns the task and 404s across workspaces", async () => {
    const harness = createHandlerHarness();
    const task = harness.store.add({ workspaceId: "w1", goal: "a" });

    const response = await harness.operations.get("getTask")!.handler(
      requestContext(new Request(`http://localhost/api/v1/workspaces/w1/tasks/${task.id}`), {
        workspaceId: "w1",
        taskId: task.id,
      }),
    );
    expect((await response.json() as { id: string }).id).toBe(task.id);

    await expect(
      harness.operations.get("getTask")!.handler(
        requestContext(new Request("http://localhost/api/v1/workspaces/w1/tasks/ghost"), {
          workspaceId: "w1",
          taskId: "ghost",
        }),
      ),
    ).rejects.toThrow(/Task not found/);
  });
});

describe("cancelTask handler", () => {
  test("cancels with an optional reason and tolerates an empty body", async () => {
    const harness = createHandlerHarness();
    const task = harness.store.add({ workspaceId: "w1", goal: "a" });

    const response = await harness.operations.get("cancelTask")!.handler(
      requestContext(
        new Request(`http://localhost/api/v1/workspaces/w1/tasks/${task.id}/cancel`, { method: "POST" }),
        { workspaceId: "w1", taskId: task.id },
      ),
    );
    const body = await response.json() as { state: string; cancelReason: string };
    expect(body.state).toBe("cancelled");
    expect(body.cancelReason).toBe("Cancelled by request");
    expect(harness.cancelled).toEqual([{ taskId: task.id }]);
  });

  test("passes a reason through", async () => {
    const harness = createHandlerHarness();
    const task = harness.store.add({ workspaceId: "w1", goal: "a" });
    const response = await harness.operations.get("cancelTask")!.handler(
      requestContext(
        new Request(`http://localhost/api/v1/workspaces/w1/tasks/${task.id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ reason: "superseded" }),
        }),
        { workspaceId: "w1", taskId: task.id },
      ),
    );
    expect((await response.json() as { cancelReason: string }).cancelReason).toBe("superseded");
  });

  test("409s on an already-finished task", async () => {
    const harness = createHandlerHarness();
    const task = harness.store.add({ workspaceId: "w1", goal: "a" });
    harness.store.update(task.id, { state: "running" });
    harness.store.update(task.id, { state: "done" });

    await expect(
      harness.operations.get("cancelTask")!.handler(
        requestContext(
          new Request(`http://localhost/api/v1/workspaces/w1/tasks/${task.id}/cancel`, { method: "POST" }),
          { workspaceId: "w1", taskId: task.id },
        ),
      ),
    ).rejects.toThrow(/already finished/);
  });
});

describe("streamTaskEvents handler", () => {
  test("replays the log as SSE frames and closes on a terminal state", async () => {
    const harness = createHandlerHarness();
    const task = harness.store.add({ workspaceId: "w1", goal: "a" });
    harness.store.update(task.id, { state: "running" });
    harness.store.update(task.id, { state: "done", summary: "all done" });

    const response = await harness.operations.get("streamTaskEvents")!.handler(
      requestContext(new Request(`http://localhost/api/v1/workspaces/w1/tasks/${task.id}/events`), {
        workspaceId: "w1",
        taskId: task.id,
      }),
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const text = await response.text();
    expect(text).toContain("event: stream.open");
    expect(text).toContain("event: task.created");
    expect(text).toContain("event: task.state");
    expect(text).toContain("id: 3");
    expect(text).toContain("all done");
    // Each frame is one `data:` line of JSON.
    const dataLines = text.split("\n").filter((line) => line.startsWith("data: "));
    expect(dataLines).toHaveLength(4);
    expect(JSON.parse(dataLines[3]!.slice(6))).toMatchObject({ seq: 3, type: "task.state", to: "done" });
  });

  test("after skips already-seen events", async () => {
    const harness = createHandlerHarness();
    const task = harness.store.add({ workspaceId: "w1", goal: "a" });
    harness.store.update(task.id, { state: "running" });
    harness.store.update(task.id, { state: "failed", error: { code: "boom", message: "boom" } });

    const response = await harness.operations.get("streamTaskEvents")!.handler(
      requestContext(new Request(`http://localhost/api/v1/workspaces/w1/tasks/${task.id}/events?after=2`), {
        workspaceId: "w1",
        taskId: task.id,
      }),
    );
    const text = await response.text();
    expect(text).not.toContain("event: task.created");
    expect(text).toContain("id: 3");
  });

  test("rejects a malformed cursor", async () => {
    const harness = createHandlerHarness();
    const task = harness.store.add({ workspaceId: "w1", goal: "a" });
    await expect(
      harness.operations.get("streamTaskEvents")!.handler(
        requestContext(new Request(`http://localhost/api/v1/workspaces/w1/tasks/${task.id}/events?after=nope`), {
          workspaceId: "w1",
          taskId: task.id,
        }),
      ),
    ).rejects.toThrow(/non-negative integer/);
  });
});

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

function runnerHarness(): { store: TaskStore; runner: ReturnType<typeof createTaskRunner> } {
  const store = createTaskStore();
  return { store, runner: createTaskRunner({ store }) };
}

describe("runner happy path", () => {
  test("creates a session, prompts with the goal, and finishes on idle", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection();
    const task = store.add({ workspaceId: "w1", goal: "Write the README\nand nothing else" });

    const running = runner.run({ task, connection });
    await connection.ready;
    await tick();

    expect(store.require(task.id).state).toBe("running");
    expect(store.require(task.id).sessionId).toBe("session-1");
    expect(store.require(task.id).engineId).toBe("stub-engine");
    expect(connection.prompts[0]?.parts).toEqual([{ type: "text", text: "Write the README\nand nothing else" }]);
    // The session title is the first line, not the whole goal.
    expect(connection.createdSessions[0]?.title).toBe("Write the README");

    connection.emit(textDelta("session-1", "Wrote "));
    connection.emit(textDelta("session-1", "README.md."));
    connection.emit({
      type: "tool.called",
      sessionId: "session-1",
      messageId: "m1",
      callId: "c1",
      tool: "write",
      input: { filePath: "/repo/README.md" },
    });
    connection.emit({
      type: "tool.completed",
      sessionId: "session-1",
      messageId: "m1",
      callId: "c1",
      tool: "write",
      status: "success",
    });
    connection.emit(idle("session-1"));

    const final = await running;
    expect(final.state).toBe("done");
    expect(final.summary).toBe("Wrote README.md.");
    expect(final.artifacts).toEqual([
      { id: "c1", kind: "file", tool: "write", path: "/repo/README.md", createdAt: expect.any(Number) },
    ]);
    expect(final.completedAt).toBeGreaterThan(0);
    expect(runner.active).toBe(0);
  });

  test("auto-approves permissions and stays running", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection();
    const task = store.add({ workspaceId: "w1", goal: "edit a file", approvalPolicy: "auto" });

    const running = runner.run({ task, connection });
    await connection.ready;
    await tick();

    connection.emit({
      type: "permission.asked",
      permission: {
        id: "perm-1",
        sessionId: "session-1",
        kind: "edit",
        resources: ["/repo/a.ts"],
        remember: [],
        metadata: {},
        receivedAt: 1,
      },
    });
    await tick();

    expect(connection.permissionReplies).toEqual([{ permissionId: "perm-1", reply: "once" }]);
    expect(store.require(task.id).state).toBe("running");

    connection.emit(idle("session-1"));
    expect((await running).state).toBe("done");
  });

  test("manual policy parks on awaiting_approval and resumes when the permission is answered", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection();
    const task = store.add({ workspaceId: "w1", goal: "edit a file", approvalPolicy: "manual" });

    const running = runner.run({ task, connection });
    await connection.ready;
    await tick();

    connection.emit({
      type: "permission.asked",
      permission: {
        id: "perm-1",
        sessionId: "session-1",
        kind: "edit",
        resources: ["/repo/a.ts"],
        remember: ["session"],
        metadata: {},
        receivedAt: 42,
      },
    });

    const parked = store.require(task.id);
    expect(parked.state).toBe("awaiting_approval");
    expect(parked.pendingPermissions).toEqual([
      { permissionId: "perm-1", sessionId: "session-1", kind: "edit", resources: ["/repo/a.ts"], askedAt: 42 },
    ]);
    // A manual permission is never auto-answered.
    expect(connection.permissionReplies).toEqual([]);

    // The engine idling while it waits is a pause, not a result.
    connection.emit(idle("session-1"));
    await tick();
    expect(store.require(task.id).state).toBe("awaiting_approval");

    connection.emit({ type: "permission.replied", sessionId: "session-1", requestId: "perm-1" });
    expect(store.require(task.id).state).toBe("running");
    expect(store.require(task.id).pendingPermissions).toEqual([]);

    connection.emit(idle("session-1"));
    const final = await running;
    expect(final.state).toBe("done");
  });

  test("an engine error fails the task with the engine's code", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection();
    const task = store.add({ workspaceId: "w1", goal: "break" });

    const running = runner.run({ task, connection });
    await connection.ready;
    await tick();
    connection.emit({
      type: "session.error",
      sessionId: "session-1",
      error: { code: "provider_error", message: "no credential" },
    });

    const final = await running;
    expect(final.state).toBe("failed");
    expect(final.error).toEqual({ code: "provider_error", message: "no credential" });
  });

  test("a failure to create the session fails the task instead of throwing", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection({
      createSession: async () => {
        throw new ApiError(502, "opencode_request_failed", "engine is down");
      },
    });
    const task = store.add({ workspaceId: "w1", goal: "start" });

    const final = await runner.run({ task, connection });
    expect(final.state).toBe("failed");
    expect(final.error).toEqual({ code: "opencode_request_failed", message: "engine is down" });
    expect(final.sessionId).toBeNull();
  });

  test("a failing prompt fails the task", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection({
      prompt: async () => {
        throw new ApiError(502, "opencode_request_failed", "prompt rejected");
      },
    });
    const task = store.add({ workspaceId: "w1", goal: "start" });

    const final = await runner.run({ task, connection });
    expect(final.state).toBe("failed");
    expect(final.error?.code).toBe("opencode_request_failed");
  });

  test("times out, interrupts the session, and reports task_timeout", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection();
    const task = store.add({ workspaceId: "w1", goal: "slow", timeoutMs: 5 });

    const final = await runner.run({ task, connection });
    expect(final.state).toBe("failed");
    expect(final.error?.code).toBe("task_timeout");
    expect(connection.interrupts).toEqual(["session-1"]);
  });

  test("refuses to run on an engine that can neither stream nor wait", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection({ capabilities: { streaming: false, wait: false } });
    const task = store.add({ workspaceId: "w1", goal: "blind" });

    const final = await runner.run({ task, connection });
    expect(final.state).toBe("failed");
    expect(final.error?.code).toBe("engine_capability_unsupported");
  });

  test("falls back to wait() when the engine cannot stream", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection({ capabilities: { streaming: false, wait: true } });
    const task = store.add({ workspaceId: "w1", goal: "blocking" });

    const final = await runner.run({ task, connection });
    expect(final.state).toBe("done");
  });
});

describe("runner cancellation", () => {
  test("cancel stops the run, interrupts the session, and keeps partial output", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection();
    const task = store.add({ workspaceId: "w1", goal: "long job" });

    const running = runner.run({ task, connection });
    await connection.ready;
    await tick();
    connection.emit(textDelta("session-1", "partial work"));

    const cancelled = await runner.cancel(task.id, "user changed their mind");
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("user changed their mind");

    const final = await running;
    expect(final.state).toBe("cancelled");
    expect(final.summary).toBe("partial work");
    expect(connection.interrupts).toEqual(["session-1"]);
    expect(runner.active).toBe(0);
  });

  test("a late idle event cannot resurrect a cancelled task", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection();
    const task = store.add({ workspaceId: "w1", goal: "long job" });

    const running = runner.run({ task, connection });
    await connection.ready;
    await tick();
    await runner.cancel(task.id);
    connection.emit(idle("session-1"));

    expect((await running).state).toBe("cancelled");
    expect(store.require(task.id).state).toBe("cancelled");
  });

  test("cancelling a queued task that was never started still works", async () => {
    const { store, runner } = runnerHarness();
    const task = store.add({ workspaceId: "w1", goal: "never ran" });
    expect((await runner.cancel(task.id)).state).toBe("cancelled");
  });

  test("cancelling a finished task is a 409", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection();
    const task = store.add({ workspaceId: "w1", goal: "quick" });
    const running = runner.run({ task, connection });
    await connection.ready;
    await tick();
    connection.emit(idle("session-1"));
    await running;

    await expect(runner.cancel(task.id)).rejects.toThrow(/already finished/);
  });

  test("shutdown aborts every in-flight run", async () => {
    const { store, runner } = runnerHarness();
    const connection = createStubConnection();
    const task = store.add({ workspaceId: "w1", goal: "long job" });
    const running = runner.run({ task, connection });
    await connection.ready;
    await tick();

    runner.shutdown();
    const final = await running;
    expect(final.state).toBe("cancelled");
    expect(final.cancelReason).toBe("Run aborted");
  });
});

/* -------------------------------------------------------------------------- */
/* Runner helpers                                                              */
/* -------------------------------------------------------------------------- */

describe("runner helpers", () => {
  test("the text accumulator keeps the tail and marks truncation", () => {
    const accumulator = createTaskTextAccumulator(10);
    accumulator.append("0123456789");
    expect(accumulator.value()).toBe("0123456789");
    accumulator.append("abcde");
    expect(accumulator.value()).toBe("[…truncated]\n56789abcde");
  });

  test("artifacts come only from successful file tools", () => {
    const success = {
      type: "tool.completed",
      sessionId: "s",
      messageId: "m",
      callId: "c",
      tool: "write",
      status: "success",
    } as const;
    expect(extractTaskArtifact(success, 5, { filePath: "/a.ts" }))
      .toEqual({ id: "c", kind: "file", tool: "write", path: "/a.ts", createdAt: 5 });
    expect(extractTaskArtifact({ ...success, status: "failed", error: "no" }, 5, { filePath: "/a.ts" })).toBeNull();
    expect(extractTaskArtifact({ ...success, tool: "bash" }, 5, { filePath: "/a.ts" })).toBeNull();
    expect(extractTaskArtifact({ type: "session.idle", sessionId: "s" }, 5)).toBeNull();
  });

  test("artifact paths are read from either the input or the output", () => {
    const event = {
      type: "tool.completed",
      sessionId: "s",
      messageId: "m",
      callId: "c",
      tool: "edit",
      status: "success",
      output: { path: "/from-output.ts" },
    } as const;
    expect(extractTaskArtifact(event, 1)?.path).toBe("/from-output.ts");
    expect(extractTaskArtifact({ ...event, output: {} }, 1)).toEqual({
      id: "c",
      kind: "output",
      tool: "edit",
      createdAt: 1,
    });
  });

  test("taskTitle takes the first line and truncates", () => {
    expect(taskTitle("Do the thing\nthen the other")).toBe("Do the thing");
    expect(taskTitle("x".repeat(200)).length).toBe(80);
  });
});

describe("serializeTask", () => {
  test("publishes a fixed field set", () => {
    const store = createTaskStore();
    const task = store.add({ workspaceId: "w1", goal: "a" });
    expect(Object.keys(serializeTask(task)).sort()).toEqual([
      "agent",
      "approvalPolicy",
      "artifacts",
      "cancelReason",
      "completedAt",
      "createdAt",
      "engineId",
      "error",
      "goal",
      "id",
      "metadata",
      "model",
      "pendingPermissions",
      "sessionId",
      "startedAt",
      "state",
      "summary",
      "timeoutMs",
      "updatedAt",
      "workspaceId",
    ]);
  });
});

describe("resolveTaskApprovalPolicy", () => {
  test("a manual server overrides an auto request", () => {
    // Otherwise one POST body silently opts the run out of the human-in-the-loop posture
    // the operator configured, and every tool call is self-approved.
    expect(resolveTaskApprovalPolicy("auto", "manual")).toBe("manual");
  });

  test("a manual server leaves an already-manual request alone", () => {
    expect(resolveTaskApprovalPolicy("manual", "manual")).toBe("manual");
  });

  test("an auto server honours what the caller asked for", () => {
    expect(resolveTaskApprovalPolicy("auto", "auto")).toBe("auto");
    expect(resolveTaskApprovalPolicy("manual", "auto")).toBe("manual");
  });

  test("an unset server mode is not treated as manual", () => {
    expect(resolveTaskApprovalPolicy("auto", undefined)).toBe("auto");
  });
});
