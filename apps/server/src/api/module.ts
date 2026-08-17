import { ApiError } from "../errors.js";
import { addRoute, type AuthMode, type RequestContext, type Route } from "../routes/registry.js";
import type { ServerConfig, TokenScope } from "../types.js";

/**
 * API modules are the pluggable unit of the public API surface.
 *
 * A module owns a coherent slice of functionality (sessions, tasks, webhooks, ...),
 * declares every operation it exposes, and can be enabled or disabled independently.
 * The declaration is the single source of truth: the registry turns it into both the
 * live route table and the published OpenAPI document, so the two cannot drift.
 *
 * The vocabulary deliberately mirrors `ipollowork.plugin.json` resource actions
 * (`id` / `title` / `description` / `effect` / `inputSchema`) so a module reads as the
 * same species of component as an installable plugin package.
 */

export type JsonSchema = Record<string, unknown>;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Mirrors the plugin action effect vocabulary from `plugin-service-runtime.ts`.
 * `read` operations skip the write gates; `write` and `destructive` require a
 * writable server and a sufficient token scope.
 */
export type ApiEffect = "read" | "write" | "destructive";

export type ApiStability = "stable" | "preview" | "experimental";

export interface ApiResponseSpec {
  description: string;
  schema?: JsonSchema;
  /** Content type override. Defaults to `application/json`, or `text/event-stream` when streaming. */
  contentType?: string;
}

export interface ApiOperation {
  /** Unique across all modules. Becomes the OpenAPI `operationId` and the SDK method name. */
  operationId: string;
  method: HttpMethod;
  /** Route path in `addRoute` syntax, e.g. `/api/v1/workspaces/:id/sessions`. */
  path: string;
  summary: string;
  description?: string;
  effect: ApiEffect;
  /** Route-level auth mode handed to `addRoute`. Defaults to `client`. */
  auth?: AuthMode;
  /**
   * Minimum client token scope. Enforced before the handler runs.
   * Defaults to `viewer` for `read` and `collaborator` for `write` / `destructive`,
   * matching the convention in `routes/deepseek-harness.ts`.
   */
  scope?: TokenScope;
  /** Marks the response as an SSE stream for documentation and SDK generation. */
  streaming?: "sse";
  requestBody?: JsonSchema;
  query?: JsonSchema;
  pathParams?: JsonSchema;
  responses?: Record<number, ApiResponseSpec>;
  /** Excludes the operation from the published OpenAPI document (still routed). */
  internal?: boolean;
  /** Marks a compatibility alias of another operation. */
  deprecated?: boolean;
  handler: (ctx: RequestContext) => Promise<Response>;
}

export interface ApiModuleContext {
  config: ServerConfig;
  /** Throws `403 read_only` when the server runs read-only. */
  ensureWritable: (config: ServerConfig) => void;
  /** Throws `401` / `403` when the actor's token scope is insufficient. */
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  /** Resolves a workspace id from a route param, throwing `404` when unknown. */
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<unknown>;
  /**
   * Applies the caller's token policy — workspace binding and expiry — before the handler
   * runs. Supplied by the composition root when the `policy` module is enabled.
   *
   * It belongs here, next to the scope and writability gates, rather than in each handler:
   * a per-token restriction that only some routes remembered to check would be worse than
   * no restriction, because the API reports it as being in force.
   */
  enforcePolicy?: (ctx: RequestContext) => Promise<void>;
  /** Everything else a module needs is passed through here by `registerApiModules`. */
  services: ApiModuleServices;
}

/**
 * Late-bound services. Kept as a separate bag so adding a service does not force
 * every module signature to change.
 */
export interface ApiModuleServices {
  [key: string]: unknown;
}

export interface ApiModule {
  /** Stable identifier, e.g. `sessions`. Used in config toggles and the docs. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Module version, independent of the server version. */
  readonly version: string;
  readonly stability: ApiStability;
  /** Module ids that must also be enabled. Enforced at registration time. */
  readonly dependsOn?: readonly string[];
  /** Returns every operation the module exposes. */
  register(context: ApiModuleContext): ApiOperation[];
}

export interface RegisteredApiModule {
  module: ApiModule;
  operations: ApiOperation[];
}

export interface ApiModuleRegistryResult {
  modules: RegisteredApiModule[];
  operations: ApiOperation[];
}

const DEFAULT_SCOPE: Record<ApiEffect, TokenScope> = {
  read: "viewer",
  write: "collaborator",
  destructive: "collaborator",
};

export function defaultScopeForEffect(effect: ApiEffect): TokenScope {
  return DEFAULT_SCOPE[effect];
}

/**
 * Resolves which modules are enabled.
 *
 * Every module is enabled by default; `IPOLLOWORK_API_MODULES` narrows the set to a
 * comma-separated allowlist and `IPOLLOWORK_API_MODULES_DISABLED` removes individual
 * modules. An unknown id in either list is a startup error rather than a silent no-op,
 * so a typo cannot quietly drop an API surface.
 */
export function resolveEnabledModules(
  available: readonly ApiModule[],
  input: { enabled?: string | null; disabled?: string | null } = {},
): ApiModule[] {
  const ids = new Set(available.map((module) => module.id));
  const parse = (value: string | null | undefined, label: string): string[] => {
    const entries = (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const entry of entries) {
      if (!ids.has(entry)) {
        throw new ApiError(500, "api_module_unknown", `Unknown API module in ${label}: ${entry}`, {
          module: entry,
          available: [...ids],
        });
      }
    }
    return entries;
  };

  const allowlist = parse(input.enabled, "IPOLLOWORK_API_MODULES");
  const denylist = new Set(parse(input.disabled, "IPOLLOWORK_API_MODULES_DISABLED"));

  const selected = allowlist.length > 0
    ? available.filter((module) => allowlist.includes(module.id))
    : available.slice();

  return selected.filter((module) => !denylist.has(module.id));
}

/**
 * Registers modules onto the shared route table.
 *
 * Wraps every handler so that scope and writability are enforced from the operation
 * declaration rather than repeated in each handler, and so a module cannot accidentally
 * expose a write without a gate.
 */
export function registerApiModules(
  routes: Route[],
  modules: readonly ApiModule[],
  context: ApiModuleContext,
): ApiModuleRegistryResult {
  const enabledIds = new Set(modules.map((module) => module.id));
  const seenModuleIds = new Set<string>();
  const seenOperationIds = new Set<string>();
  const seenRouteKeys = new Set<string>();

  const registered: RegisteredApiModule[] = [];
  const allOperations: ApiOperation[] = [];

  for (const module of modules) {
    if (seenModuleIds.has(module.id)) {
      throw new ApiError(500, "api_module_duplicate", `Duplicate API module: ${module.id}`, { module: module.id });
    }
    seenModuleIds.add(module.id);

    for (const dependency of module.dependsOn ?? []) {
      if (!enabledIds.has(dependency)) {
        throw new ApiError(
          500,
          "api_module_dependency_missing",
          `API module ${module.id} requires ${dependency}, which is not enabled`,
          { module: module.id, dependency },
        );
      }
    }

    const operations = module.register(context);

    for (const operation of operations) {
      if (seenOperationIds.has(operation.operationId)) {
        throw new ApiError(
          500,
          "api_operation_duplicate",
          `Duplicate API operationId: ${operation.operationId}`,
          { operationId: operation.operationId, module: module.id },
        );
      }
      seenOperationIds.add(operation.operationId);

      // An unauthenticated mutation is never intended, and the mistake is invisible at
      // review time: `auth: "none"` reads as "public", `effect: "write"` reads as
      // "gated", and only together do they mean "anyone may change this".
      if ((operation.auth ?? "client") === "none" && operation.effect !== "read") {
        throw new ApiError(
          500,
          "api_operation_unauthenticated_write",
          `API operation ${operation.operationId} declares auth "none" with a ${operation.effect} effect`,
          { operationId: operation.operationId, module: module.id, effect: operation.effect },
        );
      }

      const routeKey = `${operation.method} ${operation.path}`;
      if (seenRouteKeys.has(routeKey)) {
        throw new ApiError(500, "api_route_duplicate", `Duplicate API route: ${routeKey}`, {
          route: routeKey,
          module: module.id,
        });
      }
      seenRouteKeys.add(routeKey);

      addRoute(routes, operation.method, operation.path, operation.auth ?? "client", createGuardedHandler(operation, context));
      allOperations.push(operation);
    }

    registered.push({ module, operations });
  }

  return { modules: registered, operations: allOperations };
}

function createGuardedHandler(operation: ApiOperation, context: ApiModuleContext): ApiOperation["handler"] {
  const scope = operation.scope ?? defaultScopeForEffect(operation.effect);
  const needsWriteGate = operation.effect !== "read";

  return async (ctx: RequestContext) => {
    if (needsWriteGate) {
      context.ensureWritable(context.config);
    }
    // `host` and `host-token` routes authenticate as the host rather than as a
    // scoped client token, so the client scope check does not apply to them.
    const auth = operation.auth ?? "client";
    if (auth === "client") {
      context.requireClientScope(ctx, scope);
      await context.enforcePolicy?.(ctx);
    }
    return operation.handler(ctx);
  };
}

/** Serializable module descriptor, published at `GET /api/v1/modules`. */
export function describeModules(result: ApiModuleRegistryResult) {
  return result.modules.map(({ module, operations }) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    version: module.version,
    stability: module.stability,
    dependsOn: module.dependsOn ?? [],
    operations: operations.map((operation) => ({
      operationId: operation.operationId,
      method: operation.method,
      path: operation.path,
      effect: operation.effect,
      scope: operation.scope ?? defaultScopeForEffect(operation.effect),
      summary: operation.summary,
      streaming: operation.streaming ?? null,
      deprecated: operation.deprecated ?? false,
    })),
  }));
}
