import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { isApiError } from "../../../errors.js";
import { addRoute, type RequestContext, type Route } from "../../../routes/registry.js";
import type { ServerConfig } from "../../../types.js";
import { registerApiModules, type ApiModuleContext } from "../../module.js";
import {
  buildLegacyPath,
  COMPAT_ALIASES,
  COMPAT_EXCLUDED_LEGACY_ROUTES,
  COMPAT_READ_ONLY_STRICTER,
  COMPAT_RESERVED_V1_PREFIXES,
  compatModule,
  createCompatHandler,
  extractPathParams,
  toV1Path,
  type CompatAlias,
} from "./module.js";

const SERVER_SRC = join(import.meta.dir, "..", "..", "..");

const LEGACY_ROUTE_FILES = [
  "server.ts",
  "routes/core.ts",
  "routes/files.ts",
  "routes/sessions.ts",
  "routes/workspaces.ts",
  "routes/operations.ts",
  "routes/deepseek-harness.ts",
];

interface LegacyRouteFact {
  method: string;
  path: string;
  auth: string;
  /** Calls `ensureWritable(config)` unconditionally, as its own statement. */
  ensuresWritable: boolean;
  /** Scope demanded unconditionally by the handler itself, if any. */
  handlerScope: string | null;
}

/**
 * Re-derives the legacy route table straight from the source files.
 *
 * The alias table hard-codes each legacy route's auth mode, write gate and scope; without
 * this the two could silently drift, which is exactly the failure mode a compatibility
 * layer must not have.
 */
function readLegacyRouteFacts(): LegacyRouteFact[] {
  const facts: LegacyRouteFact[] = [];
  for (const file of LEGACY_ROUTE_FILES) {
    const text = readFileSync(join(SERVER_SRC, file), "utf8");
    const pattern = /addRoute\(\s*routes\s*,\s*(?:"(\w+)"|(\w+))\s*,\s*"([^"]+)"\s*,\s*"([a-z-]+)"/g;
    const hits: { index: number; method: string | null; path: string; auth: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      hits.push({ index: match.index, method: match[1] ?? null, path: match[3], auth: match[4] });
    }
    hits.forEach((hit, position) => {
      const end = position + 1 < hits.length ? hits[position + 1].index : text.length;
      // Four spaces is the top level of a handler body: `addRoute(` is always indented by
      // two. Anchoring on it keeps a gate that only runs on some branches - such as the
      // `if (persist) ensureWritable(config);` in `POST /workspaces/:id/activate` - from
      // being read as an unconditional one.
      const lines = text.slice(hit.index, end).split("\n");
      const ensuresWritable = lines.some((line) => /^ {4}ensureWritable\(config\);$/.test(line));
      let handlerScope: string | null = null;
      for (const line of lines) {
        const scopeMatch = line.match(/^ {4}requireClientScope\(ctx,\s*"(\w+)"\);$/);
        if (scopeMatch) {
          handlerScope = scopeMatch[1];
          break;
        }
      }
      // A single `addRoute` inside a `for (const method of [...])` loop registers one
      // route per method; the only such loop is the MCP proxy.
      const methods = hit.method ? [hit.method] : ["GET", "POST", "DELETE"];
      for (const method of methods) {
        facts.push({ method, path: hit.path, auth: hit.auth, ensuresWritable, handlerScope });
      }
    });
  }
  return facts;
}

const legacyFacts = readLegacyRouteFacts();
const legacyKey = (method: string, path: string) => `${method} ${path}`;
const legacyByKey = new Map(legacyFacts.map((fact) => [legacyKey(fact.method, fact.path), fact]));

const config = { workspaces: [], readOnly: false } as unknown as ServerConfig;

function moduleContext(legacyRoutes: () => Route[], overrides: Partial<ApiModuleContext> = {}): ApiModuleContext {
  return {
    config,
    ensureWritable: () => {},
    requireClientScope: () => {},
    jsonResponse: (data, status = 200) => Response.json(data as never, { status }),
    readJsonBody: async (request) => (await request.json()) as Record<string, unknown>,
    resolveWorkspace: async () => ({ id: "w1" }),
    services: { legacyRoutes },
    ...overrides,
  };
}

function requestContext(method: string, path: string, params: Record<string, string>, body?: string): RequestContext {
  const url = new URL(`http://127.0.0.1:8787${path}`);
  return {
    request: new Request(url, body === undefined ? { method } : { method, body }),
    url,
    params,
    config,
    approvals: {} as RequestContext["approvals"],
    reloadEvents: {} as RequestContext["reloadEvents"],
    tokens: {} as RequestContext["tokens"],
    actor: { type: "remote", scope: "collaborator" } as RequestContext["actor"],
  };
}

function aliasFor(method: string, legacyPath: string): CompatAlias {
  const alias = COMPAT_ALIASES.find((entry) => entry.method === method && entry.legacyPath === legacyPath);
  if (!alias) throw new Error(`No alias for ${method} ${legacyPath}`);
  return alias;
}

describe("compat alias table", () => {
  test("every alias path follows the documented mapping rules", () => {
    const wrong = COMPAT_ALIASES.filter((alias) => alias.path !== toV1Path(alias.legacyPath));
    expect(wrong).toEqual([]);
  });

  test("maps a representative sample of legacy paths", () => {
    const samples: [string, string, string][] = [
      ["GET", "/workspaces", "/api/v1/workspaces"],
      ["POST", "/workspaces/local", "/api/v1/workspaces/local"],
      ["DELETE", "/workspaces/:id", "/api/v1/workspaces/:workspaceId"],
      ["PATCH", "/workspaces/:id/display-name", "/api/v1/workspaces/:workspaceId/display-name"],
      ["GET", "/workspace/:id/config", "/api/v1/workspaces/:workspaceId/config"],
      ["DELETE", "/workspace/:id/mcp/:name", "/api/v1/workspaces/:workspaceId/mcp/:name"],
      ["GET", "/health", "/api/v1/health"],
      ["GET", "/status", "/api/v1/status"],
      ["GET", "/capabilities", "/api/v1/capabilities"],
      ["GET", "/tokens", "/api/v1/tokens"],
      ["DELETE", "/tokens/:id", "/api/v1/tokens/:id"],
      ["GET", "/approvals", "/api/v1/approvals"],
      ["POST", "/approvals/:id", "/api/v1/approvals/:id"],
      ["POST", "/files/sessions/:sessionId/read-batch", "/api/v1/files/sessions/:sessionId/read-batch"],
      ["GET", "/files/sessions/:sessionId/catalog/snapshot", "/api/v1/files/sessions/:sessionId/catalog/snapshot"],
    ];
    for (const [method, legacyPath, expected] of samples) {
      expect({ method, legacyPath, path: aliasFor(method, legacyPath).path }).toEqual({
        method,
        legacyPath,
        path: expected,
      });
    }
  });

  test("route keys and operation ids are unique", () => {
    const routeKeys = COMPAT_ALIASES.map((alias) => `${alias.method} ${alias.path}`);
    const operationIds = COMPAT_ALIASES.map((alias) => alias.operationId);
    expect(new Set(routeKeys).size).toBe(routeKeys.length);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds.every((id) => id.startsWith("compat"))).toBe(true);
  });

  test("alias and legacy templates carry the same parameters in the same order", () => {
    for (const alias of COMPAT_ALIASES) {
      const aliasParams = extractPathParams(alias.path);
      const legacyParams = extractPathParams(alias.legacyPath);
      expect({ path: alias.path, count: aliasParams.length }).toEqual({
        path: alias.path,
        count: legacyParams.length,
      });
    }
  });

  test("no alias falls inside a prefix owned by another module", () => {
    const colliding = COMPAT_ALIASES.filter((alias) =>
      COMPAT_RESERVED_V1_PREFIXES.some((prefix) => alias.path === prefix || alias.path.startsWith(`${prefix}/`)),
    );
    expect(colliding).toEqual([]);
  });

  test("template-sessions and blueprint routes are not mistaken for reserved session routes", () => {
    expect(aliasFor("GET", "/workspace/:id/template-sessions").path).toBe(
      "/api/v1/workspaces/:workspaceId/template-sessions",
    );
    expect(aliasFor("POST", "/workspace/:id/blueprint/sessions/materialize").path).toBe(
      "/api/v1/workspaces/:workspaceId/blueprint/sessions/materialize",
    );
  });
});

describe("compat coverage of the legacy route table", () => {
  test("every legacy route is either aliased or explicitly excluded", () => {
    const aliased = new Set(COMPAT_ALIASES.map((alias) => legacyKey(alias.method, alias.legacyPath)));
    const excluded = new Set(COMPAT_EXCLUDED_LEGACY_ROUTES.map((entry) => legacyKey(entry.method, entry.path)));
    const unaccounted = legacyFacts
      .map((fact) => legacyKey(fact.method, fact.path))
      .filter((key) => !aliased.has(key) && !excluded.has(key));
    expect(unaccounted).toEqual([]);
    expect(aliased.size + excluded.size).toBe(legacyFacts.length);
  });

  test("every aliased and excluded entry refers to a real legacy route", () => {
    const missing = [
      ...COMPAT_ALIASES.map((alias) => legacyKey(alias.method, alias.legacyPath)),
      ...COMPAT_EXCLUDED_LEGACY_ROUTES.map((entry) => legacyKey(entry.method, entry.path)),
    ].filter((key) => !legacyByKey.has(key));
    expect(missing).toEqual([]);
  });

  test("excluded routes really are excluded", () => {
    const aliased = new Set(COMPAT_ALIASES.map((alias) => legacyKey(alias.method, alias.legacyPath)));
    for (const excluded of COMPAT_EXCLUDED_LEGACY_ROUTES) {
      const key = legacyKey(excluded.method, excluded.path);
      expect({ key, aliased: aliased.has(key) }).toEqual({ key, aliased: false });
    }
    const excludedPaths = COMPAT_EXCLUDED_LEGACY_ROUTES.map((entry) => entry.path);
    expect(excludedPaths).toContain("/ui");
    expect(excludedPaths).toContain("/w/:id/ui");
    expect(excludedPaths).toContain("/ui/assets/toy.js");
    expect(excludedPaths).toContain("/mcp-proxy/:workspaceId/:name");
    expect(excludedPaths).toContain("/whoami");
    expect(excludedPaths).toContain("/workspace/:id/sessions");
    // The `/opencode/*` proxy never reaches the route table at all.
    expect(legacyFacts.some((fact) => fact.path.startsWith("/opencode"))).toBe(false);
  });
});

describe("compat gating parity", () => {
  test("auth mode is copied verbatim from the legacy route", () => {
    const mismatches = COMPAT_ALIASES.filter(
      (alias) => legacyByKey.get(legacyKey(alias.method, alias.legacyPath))?.auth !== alias.auth,
    ).map((alias) => `${alias.method} ${alias.legacyPath}`);
    expect(mismatches).toEqual([]);
  });

  test("declared scope is never stricter than the legacy handler's own check", () => {
    const rank: Record<string, number> = { viewer: 1, collaborator: 2, owner: 3 };
    const stricter = COMPAT_ALIASES.filter((alias) => {
      const fact = legacyByKey.get(legacyKey(alias.method, alias.legacyPath));
      if (!fact) return true;
      if (fact.auth !== "client") return alias.scope !== "owner";
      const legacyRequirement = fact.handlerScope ?? "viewer";
      return rank[alias.scope] > rank[legacyRequirement];
    }).map((alias) => `${alias.method} ${alias.legacyPath}`);
    expect(stricter).toEqual([]);
  });

  test("the write gate is stricter than legacy only for the documented read-only cases", () => {
    const stricter = COMPAT_ALIASES.filter((alias) => {
      if (alias.effect === "read") return false;
      return legacyByKey.get(legacyKey(alias.method, alias.legacyPath))?.ensuresWritable !== true;
    }).map((alias) => `${alias.method} ${alias.legacyPath}`);
    expect(stricter.sort()).toEqual([...COMPAT_READ_ONLY_STRICTER].sort());
  });

  test("every alias whose legacy handler gates writes declares a non-read effect", () => {
    const understated = COMPAT_ALIASES.filter(
      (alias) =>
        alias.effect === "read" && legacyByKey.get(legacyKey(alias.method, alias.legacyPath))?.ensuresWritable === true,
    ).map((alias) => `${alias.method} ${alias.legacyPath}`);
    expect(understated).toEqual([]);
  });

  test("effect follows the HTTP method unless the alias is a documented read-shaped POST", () => {
    for (const alias of COMPAT_ALIASES) {
      if (alias.method === "GET") expect(alias.effect).toBe("read");
      if (alias.method === "DELETE") expect(["destructive", "read"]).toContain(alias.effect);
    }
    expect(aliasFor("POST", "/workspace/:id/import/preview").effect).toBe("read");
    expect(aliasFor("POST", "/workspace/:id/plugin-packages/validate").effect).toBe("read");
    expect(aliasFor("POST", "/files/sessions/:sessionId/read-batch").effect).toBe("read");
    expect(aliasFor("POST", "/workspace/:id/engine/deepseek-harness/rpc").effect).toBe("read");
    expect(aliasFor("POST", "/files/sessions/:sessionId/write-batch").effect).toBe("write");
    expect(aliasFor("POST", "/workspace/:id/skills").effect).toBe("write");
    expect(aliasFor("DELETE", "/workspace/:id/skills/:name").effect).toBe("destructive");
  });
});

describe("buildLegacyPath", () => {
  test("renames :workspaceId back to the legacy :id", () => {
    const alias = aliasFor("GET", "/workspace/:id/config");
    expect(buildLegacyPath(alias, { workspaceId: "w1" })).toBe("/workspace/w1/config");
  });

  test("substitutes multiple parameters positionally and percent-encodes them", () => {
    const alias = aliasFor("POST", "/workspace/:id/plugin-packages/:pluginId/authorization/:methodId/start");
    expect(buildLegacyPath(alias, { workspaceId: "w 1", pluginId: "a/b", methodId: "oauth" })).toBe(
      "/workspace/w%201/plugin-packages/a%2Fb/authorization/oauth/start",
    );
  });

  test("throws 400 when a path parameter is missing", () => {
    const alias = aliasFor("GET", "/workspace/:id/config");
    try {
      buildLegacyPath(alias, {});
      throw new Error("expected buildLegacyPath to throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect((error as { status: number }).status).toBe(400);
      expect((error as { code: string }).code).toBe("compat_missing_path_param");
    }
  });
});

describe("compat re-dispatch", () => {
  function stubLegacyRoutes() {
    const seen: { path: string; params: Record<string, string>; query: string; body: string; method: string }[] = [];
    const routes: Route[] = [];
    addRoute(routes, "GET", "/workspace/:id/config", "client", async (ctx) => {
      seen.push({
        path: ctx.url.pathname,
        params: ctx.params,
        query: ctx.url.search,
        body: "",
        method: ctx.request.method,
      });
      return Response.json({ route: "config", workspace: ctx.params.id });
    });
    addRoute(routes, "POST", "/workspace/:id/skills", "client", async (ctx) => {
      seen.push({
        path: ctx.url.pathname,
        params: ctx.params,
        query: ctx.url.search,
        body: await ctx.request.text(),
        method: ctx.request.method,
      });
      return Response.json({ route: "skills" }, { status: 201 });
    });
    addRoute(routes, "GET", "/workspace/:id/skills/:name", "client", async (ctx) =>
      Response.json({ route: "skill", name: ctx.params.name }),
    );
    return { routes, seen };
  }

  test("re-dispatches to the matching legacy handler with params preserved", async () => {
    const { routes, seen } = stubLegacyRoutes();
    const handler = createCompatHandler(aliasFor("GET", "/workspace/:id/config"), () => routes);
    const response = await handler(
      requestContext("GET", "/api/v1/workspaces/w1/config?deep=true", { workspaceId: "w1" }),
    );

    expect(await response.json()).toEqual({ route: "config", workspace: "w1" });
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe("/workspace/w1/config");
    expect(seen[0].params).toEqual({ id: "w1" });
    expect(seen[0].query).toBe("?deep=true");
  });

  test("preserves method, status and request body", async () => {
    const { routes, seen } = stubLegacyRoutes();
    const handler = createCompatHandler(aliasFor("POST", "/workspace/:id/skills"), () => routes);
    const response = await handler(
      requestContext("POST", "/api/v1/workspaces/w1/skills", { workspaceId: "w1" }, JSON.stringify({ name: "demo" })),
    );

    expect(response.status).toBe(201);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].body).toBe(JSON.stringify({ name: "demo" }));
  });

  test("picks the legacy route that matches the alias, not a sibling", async () => {
    const { routes } = stubLegacyRoutes();
    const handler = createCompatHandler(aliasFor("GET", "/workspace/:id/skills/:name"), () => routes);
    const response = await handler(
      requestContext("GET", "/api/v1/workspaces/w1/skills/demo", { workspaceId: "w1", name: "demo" }),
    );
    expect(await response.json()).toEqual({ route: "skill", name: "demo" });
  });

  test("decodes an encoded path parameter exactly as the legacy dispatcher would", async () => {
    const { routes } = stubLegacyRoutes();
    const handler = createCompatHandler(aliasFor("GET", "/workspace/:id/skills/:name"), () => routes);
    const response = await handler(
      requestContext("GET", "/api/v1/workspaces/w1/skills/a%2Fb", { workspaceId: "w1", name: "a/b" }),
    );
    expect(await response.json()).toEqual({ route: "skill", name: "a/b" });
  });

  test("fails loudly when the legacy route is gone", async () => {
    const handler = createCompatHandler(aliasFor("GET", "/workspace/:id/config"), () => []);
    try {
      await handler(requestContext("GET", "/api/v1/workspaces/w1/config", { workspaceId: "w1" }));
      throw new Error("expected the handler to throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("compat_legacy_route_missing");
      expect((error as { status: number }).status).toBe(500);
    }
  });

  test("reads the legacy route table lazily, so it may be populated after registration", async () => {
    const routes: Route[] = [];
    const handler = createCompatHandler(aliasFor("GET", "/workspace/:id/config"), () => routes);
    addRoute(routes, "GET", "/workspace/:id/config", "client", async (ctx) =>
      Response.json({ late: true, workspace: ctx.params.id }),
    );
    const response = await handler(requestContext("GET", "/api/v1/workspaces/w1/config", { workspaceId: "w1" }));
    expect(await response.json()).toEqual({ late: true, workspace: "w1" });
  });
});

describe("compat module registration", () => {
  test("registers one route per alias with the declared auth mode", () => {
    const routes: Route[] = [];
    const result = registerApiModules(routes, [compatModule], moduleContext(() => []));
    expect(result.operations).toHaveLength(COMPAT_ALIASES.length);
    expect(routes).toHaveLength(COMPAT_ALIASES.length);
    const healthOperation = result.operations.find((operation) => operation.path === "/api/v1/health");
    expect(healthOperation?.auth).toBe("none");
    expect(healthOperation?.summary).toBe("Alias of GET /health");
    const hostOperation = result.operations.find((operation) => operation.path === "/api/v1/tokens" && operation.method === "POST");
    expect(hostOperation?.auth).toBe("host");
  });

  test("refuses to register without the legacy route table", () => {
    try {
      registerApiModules([], [compatModule], moduleContext(() => [], { services: {} }));
      throw new Error("expected registration to throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("compat_legacy_routes_unavailable");
    }
  });

  test("the registry gates apply the declared scope and skip the write gate for read aliases", async () => {
    const calls: string[] = [];
    const legacy: Route[] = [];
    addRoute(legacy, "POST", "/files/sessions/:sessionId/read-batch", "client", async () => Response.json({ ok: true }));
    addRoute(legacy, "POST", "/files/sessions/:sessionId/write-batch", "client", async () => Response.json({ ok: true }));

    const routes: Route[] = [];
    registerApiModules(
      routes,
      [compatModule],
      moduleContext(() => legacy, {
        ensureWritable: () => {
          calls.push("ensureWritable");
        },
        requireClientScope: (_ctx, required) => {
          calls.push(`scope:${required}`);
        },
      }),
    );

    const readRoute = routes.find((route) => route.method === "POST" && route.regex.test("/api/v1/files/sessions/s1/read-batch"));
    await readRoute?.handler(requestContext("POST", "/api/v1/files/sessions/s1/read-batch", { sessionId: "s1" }, "{}"));
    expect(calls).toEqual(["scope:viewer"]);

    calls.length = 0;
    const writeRoute = routes.find((route) => route.method === "POST" && route.regex.test("/api/v1/files/sessions/s1/write-batch"));
    await writeRoute?.handler(requestContext("POST", "/api/v1/files/sessions/s1/write-batch", { sessionId: "s1" }, "{}"));
    expect(calls).toEqual(["ensureWritable", "scope:collaborator"]);
  });
});
