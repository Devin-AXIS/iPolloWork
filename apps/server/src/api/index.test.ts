import { describe, expect, test } from "bun:test";

import { ApiError, isApiError } from "../errors.js";
import { addRoute, matchRoute, type RequestContext, type Route } from "../routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import type { HarnessRuntimeLike } from "./engine/harness.js";
import type { OpencodeEngineClient, UnwrapOpencodeResult } from "./engine/opencode.js";
import {
  API_MODULES,
  bridgeTaskEventsToWebhooks,
  createEngineRegistry,
  createPolicyEnforcer,
  registerApiV1,
  taskWebhookEventType,
  type RegisterApiV1Input,
} from "./index.js";
import { defaultScopeForEffect } from "./module.js";
import { createTaskStore, type TaskEvent, type TaskRecord } from "./modules/tasks/store.js";
import { MemoryWebhookStore } from "./modules/webhooks/store.js";

/** Awaits a rejection and narrows it to an ApiError, so assertions stay typed. */
async function expectRejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (isApiError(error)) return error as ApiError;
    throw error;
  }
  throw new Error("expected the call to reject");
}

const config = { workspaces: [], readOnly: false, authorizedRoots: [] } as unknown as ServerConfig;

const workspace = { id: "w1", name: "w1", path: "/tmp/w1", preset: "starter" } as unknown as WorkspaceInfo;

const harnessRuntime: HarnessRuntimeLike = {
  async call<T>(): Promise<T> {
    throw new Error("not reached");
  },
  async respond() {},
  async events(): Promise<Response> {
    throw new Error("not reached");
  },
};

const unwrap: UnwrapOpencodeResult = (result, path) => {
  if (result.data == null) throw new Error(`empty ${path}`);
  return result.data as NonNullable<typeof result.data>;
};

const createClient = (): OpencodeEngineClient => ({}) as OpencodeEngineClient;

/** A legacy route table with one entry, so `compat` has something to delegate to. */
function legacyTable(): Route[] {
  const routes: Route[] = [];
  addRoute(routes, "GET", "/workspaces", "client", async () => new Response("legacy", { status: 200 }));
  return routes;
}

function baseInput(routes: Route[], overrides: Partial<RegisterApiV1Input> = {}): RegisterApiV1Input {
  return {
    routes,
    config,
    serverVersion: "9.9.9",
    ensureWritable: () => {},
    requireClientScope: () => {},
    jsonResponse: (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }),
    readJsonBody: async (request) => (await request.json()) as Record<string, unknown>,
    resolveWorkspace: async () => workspace,
    createWorkspaceOpencodeClient: createClient,
    unwrapOpencodeResult: unwrap,
    deepseekHarness: harnessRuntime,
    // Deliberately empty so the ambient IPOLLOWORK_API_MODULES* vars cannot change the
    // result of a test run.
    env: {},
    ...overrides,
  };
}

describe("createEngineRegistry", () => {
  test("registers both built-in engines and defaults to opencode", () => {
    const engines = createEngineRegistry({
      config,
      createWorkspaceOpencodeClient: createClient,
      unwrapOpencodeResult: unwrap,
      deepseekHarness: harnessRuntime,
    });

    expect(engines.ids().sort()).toEqual(["deepseek-harness", "opencode"]);
    expect(engines.get(null).id).toBe("opencode");
    expect(engines.get(undefined).id).toBe("opencode");
    expect(engines.get("deepseek-harness").id).toBe("deepseek-harness");
  });

  test("an unregistered engine id is a 409, not a silent fallback", () => {
    const engines = createEngineRegistry({
      config,
      createWorkspaceOpencodeClient: createClient,
      unwrapOpencodeResult: unwrap,
      deepseekHarness: harnessRuntime,
    });

    try {
      engines.get("codex");
      throw new Error("expected a throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.status).toBe(409);
        expect(error.code).toBe("engine_not_registered");
      }
    }
  });
});

describe("registerApiV1", () => {
  test("registers every module in the catalogue by default", () => {
    const routes = legacyTable();
    const result = registerApiV1(baseInput(routes));

    expect(result.modules.map((entry) => entry.module.id)).toEqual([
      "sessions",
      "tasks",
      "webhooks",
      "policy",
      "openapi",
      "compat",
    ]);
    expect(result.modules.map((entry) => entry.module.id)).toEqual(API_MODULES.map((module) => module.id));
    expect(result.operations.length).toBeGreaterThan(0);
  });

  test("appends routes without removing or reordering the legacy table", () => {
    const routes = legacyTable();
    const before = routes.length;
    const legacy = routes[0];

    const result = registerApiV1(baseInput(routes));

    expect(routes.length).toBe(before + result.operations.length);
    expect(routes[0]).toBe(legacy);
    // matchRoute returns the first match, so a legacy path still resolves to its own
    // handler after v1 is mounted.
    expect(matchRoute(routes, "GET", "/workspaces")?.handler).toBe(legacy.handler);
  });

  test("every v1 operation is reachable and lands under /api/v1", () => {
    const routes = legacyTable();
    const result = registerApiV1(baseInput(routes));

    for (const operation of result.operations) {
      expect(operation.path.startsWith("/api/v1/")).toBe(true);
      const concrete = operation.path.replace(/:([A-Za-z0-9_]+)/g, "x-$1");
      expect(matchRoute(routes, operation.method, concrete)).not.toBeNull();
    }
  });

  test("operation ids and method+path pairs are unique across modules", () => {
    const result = registerApiV1(baseInput(legacyTable()));

    const ids = result.operations.map((operation) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);

    const keys = result.operations.map((operation) => `${operation.method} ${operation.path}`);
    expect(new Set(keys).size).toBe(keys.length);

    // Two different patterns can still compile to the same regex (`:id` vs `:workspaceId`),
    // which the registry's string key cannot see but a router would shadow.
    const patterns = result.operations.map(
      (operation) => `${operation.method} ${operation.path.replace(/:[A-Za-z0-9_]+/g, ":p")}`,
    );
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  test("first-class modules never weaken the default scope for a write", () => {
    const result = registerApiV1(baseInput(legacyTable()));
    const rank = { viewer: 1, collaborator: 2, owner: 3 } as const;
    let checked = 0;

    for (const { module, operations } of result.modules) {
      // `compat` is the documented exception: an alias copies the legacy handler's own
      // check so the alias can never reject a request the legacy path would accept.
      if (module.id === "compat") continue;
      for (const operation of operations) {
        if (operation.effect === "read") continue;
        if ((operation.auth ?? "client") !== "client") continue;
        const scope = operation.scope ?? defaultScopeForEffect(operation.effect);
        expect(rank[scope]).toBeGreaterThanOrEqual(rank[defaultScopeForEffect(operation.effect)]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("every compat alias declares its scope explicitly", () => {
    // The alias scope is copied from the legacy handler's own check rather than derived
    // from the effect (`compat/module.test.ts` verifies that against the route sources),
    // so an alias that fell back to the effect default would be an unreviewed gate.
    const result = registerApiV1(baseInput(legacyTable()));
    const compat = result.modules.find((entry) => entry.module.id === "compat");
    expect(compat).toBeDefined();
    expect(compat!.operations.length).toBeGreaterThan(0);

    for (const operation of compat!.operations) {
      expect(operation.scope).toBeDefined();
    }
  });

  test("IPOLLOWORK_API_MODULES narrows the enabled set", () => {
    const routes = legacyTable();
    const result = registerApiV1(
      baseInput(routes, { env: { IPOLLOWORK_API_MODULES: "sessions,openapi" } }),
    );

    expect(result.modules.map((entry) => entry.module.id)).toEqual(["sessions", "openapi"]);
    expect(result.taskStore).toBeUndefined();
    expect(result.webhookStore).toBeUndefined();
  });

  test("IPOLLOWORK_API_MODULES_DISABLED removes a module", () => {
    const result = registerApiV1(
      baseInput(legacyTable(), { env: { IPOLLOWORK_API_MODULES_DISABLED: "compat,webhooks" } }),
    );

    const ids = result.modules.map((entry) => entry.module.id);
    expect(ids).not.toContain("compat");
    expect(ids).not.toContain("webhooks");
    expect(ids).toContain("sessions");
  });

  test("an unknown module id fails startup instead of being ignored", () => {
    try {
      registerApiV1(baseInput(legacyTable(), { env: { IPOLLOWORK_API_MODULES: "sessions,typo" } }));
      throw new Error("expected a throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.code).toBe("api_module_unknown");
    }
  });

  test("disabling a dependency of an enabled module fails startup", () => {
    try {
      registerApiV1(baseInput(legacyTable(), { env: { IPOLLOWORK_API_MODULES: "tasks" } }));
      throw new Error("expected a throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.code).toBe("api_module_dependency_missing");
    }
  });

  test("compat delegates to the legacy table through the injected getter", async () => {
    const routes = legacyTable();
    registerApiV1(baseInput(routes, { legacyRoutes: () => routes }));

    const matched = matchRoute(routes, "GET", "/api/v1/workspaces");
    expect(matched).not.toBeNull();
    const response = await matched!.handler({
      request: new Request("http://local/api/v1/workspaces"),
      url: new URL("http://local/api/v1/workspaces"),
      params: matched!.params,
      config,
    } as unknown as RequestContext);
    expect(await response.text()).toBe("legacy");
  });

  test("the openapi module sees the completed registry, including its own operations", async () => {
    const routes = legacyTable();
    const result = registerApiV1(baseInput(routes));

    const matched = matchRoute(routes, "GET", "/api/v1/openapi.json");
    expect(matched).not.toBeNull();
    const response = await matched!.handler({
      request: new Request("http://local/api/v1/openapi.json"),
      url: new URL("http://local/api/v1/openapi.json"),
      params: {},
      config,
    } as unknown as RequestContext);
    const document = (await response.json()) as { info: { version: string }; paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(document.info.version).toBe("9.9.9");
    expect(document.paths["/api/v1/openapi.json"]).toBeDefined();
    const documented = result.operations.filter((operation) => !operation.internal);
    expect(Object.keys(document.paths).length).toBeGreaterThan(0);
    expect(Object.keys(document.paths).length).toBeLessThanOrEqual(documented.length);
  });

  test("service overrides win over the ones the composition root builds", () => {
    const taskStore = createTaskStore();
    const webhookStore = new MemoryWebhookStore();
    const result = registerApiV1(baseInput(legacyTable(), { services: { taskStore, webhookStore } }));

    expect(result.taskStore).toBe(taskStore);
    expect(result.webhookStore).toBe(webhookStore);
  });
});

/* -------------------------------------------------------------------------- */
/* Task -> webhook bridge                                                      */
/* -------------------------------------------------------------------------- */

function taskEvent(overrides: Partial<TaskEvent> & { task?: Partial<TaskRecord> } = {}): TaskEvent {
  const task = { id: "t1", workspaceId: "w1", state: "queued", goal: "g", ...overrides.task } as TaskRecord;
  return { seq: 1, at: 0, taskId: task.id, type: "task.created", ...overrides, task } as TaskEvent;
}

describe("taskWebhookEventType", () => {
  test("maps the four subscribable task events", () => {
    expect(taskWebhookEventType(taskEvent())).toBe("task.created");
    expect(taskWebhookEventType(taskEvent({ type: "task.state", to: "done" }))).toBe("task.completed");
    expect(taskWebhookEventType(taskEvent({ type: "task.state", to: "failed" }))).toBe("task.failed");
    expect(taskWebhookEventType(taskEvent({ type: "task.state", to: "awaiting_approval" })))
      .toBe("task.awaiting_approval");
  });

  test("emits nothing for transitions with no webhook name", () => {
    expect(taskWebhookEventType(taskEvent({ type: "task.updated" }))).toBeNull();
    expect(taskWebhookEventType(taskEvent({ type: "task.state", to: "running" }))).toBeNull();
    expect(taskWebhookEventType(taskEvent({ type: "task.state", to: "cancelled" }))).toBeNull();
  });
});

describe("bridgeTaskEventsToWebhooks", () => {
  test("dispatches the mapped events and detaches on dispose", () => {
    const tasks = createTaskStore();
    const webhooks = new MemoryWebhookStore();
    const sent: Array<{ workspaceId: string; type: string }> = [];

    const detach = bridgeTaskEventsToWebhooks({
      tasks,
      webhooks,
      allowPrivate: () => true,
      dispatch: async (_store, event) => {
        sent.push({ workspaceId: event.workspaceId, type: event.type });
        return [];
      },
    });

    const task = tasks.add({ workspaceId: "w1", goal: "ship it" });
    tasks.update(task.id, { state: "running" });
    tasks.update(task.id, { state: "done" });

    expect(sent).toEqual([
      { workspaceId: "w1", type: "task.created" },
      { workspaceId: "w1", type: "task.completed" },
    ]);

    detach();
    const second = tasks.add({ workspaceId: "w1", goal: "again" });
    expect(second.id).not.toBe(task.id);
    expect(sent.length).toBe(2);
  });

  test("a failing delivery never escapes into the task store", () => {
    const tasks = createTaskStore();
    const webhooks = new MemoryWebhookStore();

    bridgeTaskEventsToWebhooks({
      tasks,
      webhooks,
      dispatch: async () => {
        throw new Error("endpoint is gone");
      },
    });

    expect(() => tasks.add({ workspaceId: "w1", goal: "ship it" })).not.toThrow();
  });
});

describe("createPolicyEnforcer", () => {
  function ctxWith(params: Record<string, string>, tokenHash?: string): RequestContext {
    return {
      request: new Request("http://localhost/api/v1/x"),
      url: new URL("http://localhost/api/v1/x"),
      params,
      config,
      approvals: {} as never,
      reloadEvents: {} as never,
      tokens: {
        async findByHash(hash: string) {
          return hash === "hash-ci" ? { id: "tok_ci", scope: "collaborator" as const, label: "ci" } : null;
        },
      } as never,
      ...(tokenHash ? { actor: { type: "remote" as const, tokenHash, scope: "collaborator" as const } } : {}),
    };
  }

  const store = {
    async get(tokenId: string) {
      if (tokenId === "tok_ci") return { workspaces: ["w1"], expiresAt: null };
      if (tokenId === "tok_expired") return { expiresAt: 1 };
      return {};
    },
  };

  test("allows a workspace the token is bound to", async () => {
    await expect(createPolicyEnforcer(store)(ctxWith({ workspaceId: "w1" }, "hash-ci"))).resolves.toBeUndefined();
  });

  test("rejects a workspace outside the binding", async () => {
    const error = await expectRejection(createPolicyEnforcer(store)(ctxWith({ workspaceId: "w2" }, "hash-ci")));

    expect(error.status).toBe(403);
    expect(error.code).toBe("workspace_forbidden");
    expect(error.details).toMatchObject({ workspaceId: "w2" });
  });

  test("reads the legacy `:id` param too, so compat aliases are covered", async () => {
    const error = await expectRejection(createPolicyEnforcer(store)(ctxWith({ id: "w2" }, "hash-ci")));
    expect(error.code).toBe("workspace_forbidden");
  });

  test("a route naming no workspace still passes for a bound token", async () => {
    await expect(createPolicyEnforcer(store)(ctxWith({}, "hash-ci"))).resolves.toBeUndefined();
  });

  test("an expired token is rejected even on a route naming no workspace", async () => {
    const expiredStore = { async get() { return { expiresAt: 1 }; } };
    const error = await expectRejection(createPolicyEnforcer(expiredStore)(ctxWith({}, "hash-ci")));

    expect(error.status).toBe(403);
    expect(error.code).toBe("token_expired");
  });

  test("the shared config token has no record and is left alone", async () => {
    await expect(createPolicyEnforcer(store)(ctxWith({ workspaceId: "w2" }))).resolves.toBeUndefined();
  });

  test("an unknown token hash is left to the auth layer, not silently bound", async () => {
    await expect(createPolicyEnforcer(store)(ctxWith({ workspaceId: "w2" }, "hash-unknown")))
      .resolves.toBeUndefined();
  });
});

describe("policy enforcement is applied by the registry", () => {
  test("a bound token cannot reach another workspace through a registered route", async () => {
    const routes: Route[] = [];
    let handlerRan = false;

    registerApiV1({
      ...baseInput(routes),
      services: {
        tokenPolicies: {
          async get(tokenId: string) {
            return tokenId === "tok_ci" ? { workspaces: ["w1"] } : {};
          },
        },
      },
    } as unknown as RegisterApiV1Input);

    const route = matchRoute(routes, "POST", "/api/v1/workspaces/w2/sessions");
    expect(route).not.toBeNull();

    const ctx: RequestContext = {
      request: new Request("http://localhost/api/v1/workspaces/w2/sessions", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
      url: new URL("http://localhost/api/v1/workspaces/w2/sessions"),
      params: route!.params,
      config,
      approvals: {} as never,
      reloadEvents: {} as never,
      tokens: {
        async findByHash() {
          return { id: "tok_ci", scope: "collaborator" as const, label: "ci" };
        },
      } as never,
      actor: { type: "remote", tokenHash: "hash-ci", scope: "collaborator" },
    };

    const error = await expectRejection(
      route!.handler(ctx).then(() => {
        handlerRan = true;
      }),
    );

    expect(handlerRan).toBe(false);
    expect(error.status).toBe(403);
    expect(error.code).toBe("workspace_forbidden");
  });
});
