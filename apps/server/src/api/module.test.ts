import { describe, expect, test } from "bun:test";

import { isApiError } from "../errors.js";
import type { RequestContext, Route } from "../routes/registry.js";
import { matchRoute } from "../routes/registry.js";
import type { ServerConfig, TokenScope } from "../types.js";
import {
  defaultScopeForEffect,
  describeModules,
  registerApiModules,
  resolveEnabledModules,
  type ApiModule,
  type ApiModuleContext,
  type ApiOperation,
} from "./module.js";

const config = { workspaces: [], readOnly: false } as unknown as ServerConfig;

function createContext(overrides: Partial<ApiModuleContext> = {}): ApiModuleContext {
  return {
    config,
    ensureWritable: () => {},
    requireClientScope: () => {},
    jsonResponse: (data, status = 200) => Response.json(data as never, { status }),
    readJsonBody: async (request) => (await request.json()) as Record<string, unknown>,
    resolveWorkspace: async () => ({ id: "w1" }),
    services: {},
    ...overrides,
  };
}

function createContextRecordingGates() {
  const calls: string[] = [];
  const context = createContext({
    ensureWritable: () => {
      calls.push("ensureWritable");
    },
    requireClientScope: (_ctx, required) => {
      calls.push(`requireClientScope:${required}`);
    },
  });
  return { context, calls };
}

function operation(overrides: Partial<ApiOperation> = {}): ApiOperation {
  return {
    operationId: "getThing",
    method: "GET",
    path: "/api/v1/thing",
    summary: "Get a thing",
    effect: "read",
    handler: async () => Response.json({ ok: true }),
    ...overrides,
  };
}

function moduleWith(id: string, operations: ApiOperation[], extra: Partial<ApiModule> = {}): ApiModule {
  return {
    id,
    title: id,
    description: `${id} module`,
    version: "1.0.0",
    stability: "stable",
    register: () => operations,
    ...extra,
  };
}

function requestContext(request: Request, params: Record<string, string> = {}): RequestContext {
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

describe("defaultScopeForEffect", () => {
  test("reads require viewer and writes require collaborator", () => {
    expect(defaultScopeForEffect("read")).toBe("viewer");
    expect(defaultScopeForEffect("write")).toBe("collaborator");
    expect(defaultScopeForEffect("destructive")).toBe("collaborator");
  });
});

describe("resolveEnabledModules", () => {
  const available = [moduleWith("sessions", []), moduleWith("tasks", []), moduleWith("webhooks", [])];

  test("enables everything by default", () => {
    expect(resolveEnabledModules(available).map((m) => m.id)).toEqual(["sessions", "tasks", "webhooks"]);
  });

  test("an allowlist narrows the set", () => {
    expect(resolveEnabledModules(available, { enabled: "sessions,webhooks" }).map((m) => m.id))
      .toEqual(["sessions", "webhooks"]);
  });

  test("a denylist removes modules", () => {
    expect(resolveEnabledModules(available, { disabled: "tasks" }).map((m) => m.id))
      .toEqual(["sessions", "webhooks"]);
  });

  test("the denylist wins over the allowlist", () => {
    expect(resolveEnabledModules(available, { enabled: "sessions,tasks", disabled: "tasks" }).map((m) => m.id))
      .toEqual(["sessions"]);
  });

  test("whitespace and empty entries are ignored", () => {
    expect(resolveEnabledModules(available, { enabled: " sessions , , tasks " }).map((m) => m.id))
      .toEqual(["sessions", "tasks"]);
  });

  test("an unknown id fails loudly instead of silently dropping a surface", () => {
    expect(() => resolveEnabledModules(available, { enabled: "sessions,nope" })).toThrow(/Unknown API module/);
    expect(() => resolveEnabledModules(available, { disabled: "nope" })).toThrow(/Unknown API module/);
  });
});

describe("registerApiModules", () => {
  test("adds one route per operation and reports them", () => {
    const routes: Route[] = [];
    const result = registerApiModules(
      routes,
      [moduleWith("thing", [operation(), operation({ operationId: "createThing", method: "POST", effect: "write" })])],
      createContext(),
    );

    expect(routes).toHaveLength(2);
    expect(result.operations.map((op) => op.operationId)).toEqual(["getThing", "createThing"]);
    expect(matchRoute(routes, "GET", "/api/v1/thing")).not.toBeNull();
    expect(matchRoute(routes, "POST", "/api/v1/thing")).not.toBeNull();
  });

  test("rejects duplicate module ids", () => {
    expect(() => registerApiModules([], [moduleWith("dup", []), moduleWith("dup", [])], createContext()))
      .toThrow(/Duplicate API module/);
  });

  test("rejects duplicate operation ids across modules", () => {
    expect(() =>
      registerApiModules(
        [],
        [moduleWith("a", [operation()]), moduleWith("b", [operation({ path: "/api/v1/other" })])],
        createContext(),
      ),
    ).toThrow(/Duplicate API operationId/);
  });

  test("rejects two operations claiming the same method and path", () => {
    expect(() =>
      registerApiModules(
        [],
        [moduleWith("a", [operation()]), moduleWith("b", [operation({ operationId: "otherId" })])],
        createContext(),
      ),
    ).toThrow(/Duplicate API route/);
  });

  test("rejects an unauthenticated write", () => {
    expect(() =>
      registerApiModules(
        [],
        [moduleWith("thing", [operation({ auth: "none", effect: "write", method: "POST" })])],
        createContext(),
      ),
    ).toThrow(/auth "none" with a write effect/);
  });

  test("allows an unauthenticated read", () => {
    expect(() =>
      registerApiModules([], [moduleWith("thing", [operation({ auth: "none" })])], createContext()),
    ).not.toThrow();
  });

  test("rejects a module whose dependency is not enabled", () => {
    expect(() =>
      registerApiModules([], [moduleWith("tasks", [], { dependsOn: ["sessions"] })], createContext()),
    ).toThrow(/requires sessions/);
  });

  test("accepts a dependency that is enabled", () => {
    expect(() =>
      registerApiModules(
        [],
        [moduleWith("sessions", []), moduleWith("tasks", [], { dependsOn: ["sessions"] })],
        createContext(),
      ),
    ).not.toThrow();
  });
});

describe("operation gating", () => {
  test("read operations skip the write gate and require viewer", async () => {
    const routes: Route[] = [];
    const { context, calls } = createContextRecordingGates();
    registerApiModules(routes, [moduleWith("thing", [operation()])], context);

    const matched = matchRoute(routes, "GET", "/api/v1/thing");
    await matched!.handler(requestContext(new Request("http://localhost/api/v1/thing")));

    expect(calls).toEqual(["requireClientScope:viewer"]);
  });

  test("write operations run the write gate before the handler", async () => {
    const routes: Route[] = [];
    const { context, calls } = createContextRecordingGates();
    registerApiModules(
      routes,
      [moduleWith("thing", [operation({ operationId: "createThing", method: "POST", effect: "write" })])],
      context,
    );

    const matched = matchRoute(routes, "POST", "/api/v1/thing");
    await matched!.handler(requestContext(new Request("http://localhost/api/v1/thing", { method: "POST" })));

    expect(calls).toEqual(["ensureWritable", "requireClientScope:collaborator"]);
  });

  test("an explicit scope overrides the effect default", async () => {
    const routes: Route[] = [];
    const { context, calls } = createContextRecordingGates();
    registerApiModules(
      routes,
      [moduleWith("thing", [operation({ effect: "write", scope: "owner" as TokenScope, method: "POST" })])],
      context,
    );

    await matchRoute(routes, "POST", "/api/v1/thing")!
      .handler(requestContext(new Request("http://localhost/api/v1/thing", { method: "POST" })));

    expect(calls).toEqual(["ensureWritable", "requireClientScope:owner"]);
  });

  test("host-authenticated operations skip the client scope check", async () => {
    const routes: Route[] = [];
    const { context, calls } = createContextRecordingGates();
    registerApiModules(
      routes,
      [moduleWith("thing", [operation({ auth: "host", effect: "write", method: "POST" })])],
      context,
    );

    await matchRoute(routes, "POST", "/api/v1/thing")!
      .handler(requestContext(new Request("http://localhost/api/v1/thing", { method: "POST" })));

    // The write gate still applies; only the client-token scope check is skipped.
    expect(calls).toEqual(["ensureWritable"]);
  });

  test("a failing gate prevents the handler from running", async () => {
    const routes: Route[] = [];
    let handlerRan = false;
    const context = createContext({
      requireClientScope: () => {
        throw new Error("insufficient scope");
      },
    });
    registerApiModules(
      routes,
      [moduleWith("thing", [operation({ handler: async () => {
        handlerRan = true;
        return Response.json({});
      } })])],
      context,
    );

    await expect(
      matchRoute(routes, "GET", "/api/v1/thing")!.handler(requestContext(new Request("http://localhost/api/v1/thing"))),
    ).rejects.toThrow(/insufficient scope/);
    expect(handlerRan).toBe(false);
  });

  test("the route is registered with the declared auth mode", () => {
    const routes: Route[] = [];
    registerApiModules(routes, [moduleWith("thing", [operation({ auth: "host" })])], createContext());
    expect(routes[0]?.auth).toBe("host");
  });

  test("client is the default auth mode", () => {
    const routes: Route[] = [];
    registerApiModules(routes, [moduleWith("thing", [operation()])], createContext());
    expect(routes[0]?.auth).toBe("client");
  });
});

describe("registration errors", () => {
  test("are ApiErrors so the server reports them with a code", () => {
    try {
      registerApiModules([], [moduleWith("dup", []), moduleWith("dup", [])], createContext());
      throw new Error("expected a throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("api_module_duplicate");
    }
  });
});

describe("describeModules", () => {
  test("publishes the module and operation catalogue", () => {
    const routes: Route[] = [];
    const result = registerApiModules(
      routes,
      [
        moduleWith("sessions", [operation({ operationId: "listSessions", summary: "List sessions" })]),
        moduleWith("tasks", [operation({
          operationId: "createTask",
          method: "POST",
          path: "/api/v1/tasks",
          effect: "write",
          summary: "Create a task",
          streaming: "sse",
          deprecated: true,
        })], { dependsOn: ["sessions"], stability: "preview" }),
      ],
      createContext(),
    );

    expect(describeModules(result)).toEqual([
      {
        id: "sessions",
        title: "sessions",
        description: "sessions module",
        version: "1.0.0",
        stability: "stable",
        dependsOn: [],
        operations: [{
          operationId: "listSessions",
          method: "GET",
          path: "/api/v1/thing",
          effect: "read",
          scope: "viewer",
          summary: "List sessions",
          streaming: null,
          deprecated: false,
        }],
      },
      {
        id: "tasks",
        title: "tasks",
        description: "tasks module",
        version: "1.0.0",
        stability: "preview",
        dependsOn: ["sessions"],
        operations: [{
          operationId: "createTask",
          method: "POST",
          path: "/api/v1/tasks",
          effect: "write",
          scope: "collaborator",
          summary: "Create a task",
          streaming: "sse",
          deprecated: true,
        }],
      },
    ]);
  });
});
