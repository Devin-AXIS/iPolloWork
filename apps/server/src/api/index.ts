/**
 * Composition root for the public API component.
 *
 * Everything above this file is declarative: an engine adapter says how to talk to one
 * engine, a module says which operations it exposes. Nothing in either half knows how the
 * server is wired. This file is the one place that knows, so the component can be mounted
 * with a single call and, in a test, mounted against stubs without touching a real server.
 *
 * Mounting is additive. `matchRoute` (`../routes/registry.ts`) scans the route array in
 * order and returns the first match, so appending v1 routes after the legacy registrations
 * cannot shadow an existing route — the legacy table is matched first, unchanged.
 */

import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import type { RequestContext, Route } from "../routes/registry.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { createHarnessEngineAdapter, type HarnessRuntimeLike } from "./engine/harness.js";
import {
  createOpencodeEngineAdapter,
  type OpencodeEngineClient,
  type UnwrapOpencodeResult,
} from "./engine/opencode.js";
import { EngineAdapterRegistry } from "./engine/types.js";
import {
  registerApiModules,
  resolveEnabledModules,
  type ApiModule,
  type ApiModuleContext,
  type ApiModuleRegistryResult,
  type ApiModuleServices,
} from "./module.js";
import { compatModule } from "./modules/compat/module.js";
import { openApiModule } from "./modules/openapi/module.js";
import { assertPolicyAllowsWorkspace, policyModule, TokenPolicyStore } from "./modules/policy/module.js";
import { sessionsModule } from "./modules/sessions/module.js";
import { serializeTask, tasksModule } from "./modules/tasks/module.js";
import { createTaskRunner, type TaskRunner } from "./modules/tasks/runner.js";
import { createTaskStore, type TaskEvent, type TaskStore } from "./modules/tasks/store.js";
import { webhookPrivateNetworkAllowed } from "./modules/webhooks/delivery.js";
import { dispatchWebhookEvent, webhooksModule } from "./modules/webhooks/module.js";
import { WebhookStore, type WebhookStoreLike } from "./modules/webhooks/store.js";

/**
 * Registration order.
 *
 * `compat` is last on purpose: its aliases are the broadest patterns in the component, so
 * a first-class module always wins a path both could serve. `tasks` declares
 * `dependsOn: ["sessions"]`, which `registerApiModules` checks against the enabled set
 * rather than against order, so this list stays readable rather than topologically sorted.
 */
export const API_MODULES: readonly ApiModule[] = [
  sessionsModule,
  tasksModule,
  webhooksModule,
  policyModule,
  openApiModule,
  compatModule,
];

/** Env var narrowing the enabled set to an allowlist. */
export const API_MODULES_ENV = "IPOLLOWORK_API_MODULES";
/** Env var removing individual modules. */
export const API_MODULES_DISABLED_ENV = "IPOLLOWORK_API_MODULES_DISABLED";

export interface RegisterApiV1Input {
  /** The shared route table. v1 routes are appended to it. */
  routes: Route[];
  config: ServerConfig;
  /** Reported as the OpenAPI document's `info.version`. */
  serverVersion: string;

  /* The server's own gates and helpers, injected rather than imported: the server owns
     them, and a test needs to be able to substitute them. */
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;

  /** Per-workspace OpenCode client factory (`createWorkspaceOpencodeClient`). */
  createWorkspaceOpencodeClient: (config: ServerConfig, workspace: WorkspaceInfo) => OpencodeEngineClient;
  /** The server's `unwrapOpencodeResult`. */
  unwrapOpencodeResult: UnwrapOpencodeResult;
  /** The shared `DeepSeekHarnessRuntime`. */
  deepseekHarness: HarnessRuntimeLike;

  /**
   * Returns the full legacy route table, read at request time by `compat`.
   * Defaults to the same array v1 is being appended to, which is what makes the
   * delegation see every legacy route regardless of registration order.
   */
  legacyRoutes?: () => Route[];

  /** Environment used for the module toggles. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Overrides the module catalogue. Tests only. */
  modules?: readonly ApiModule[];
  /** Extra or overriding services merged into `ApiModuleContext.services`. Tests only. */
  services?: ApiModuleServices;
}

export interface RegisterApiV1Result extends ApiModuleRegistryResult {
  engines: EngineAdapterRegistry;
  /** Present when the `tasks` module is enabled. */
  taskStore?: TaskStore;
  /** Present when the `tasks` module is enabled. Call `shutdown()` to abort in-flight runs. */
  taskRunner?: TaskRunner;
  /** Present when the `webhooks` module is enabled. */
  webhookStore?: WebhookStoreLike;
  /** Detaches the task -> webhook bridge. No-op when the bridge was not installed. */
  dispose: () => void;
}

/**
 * Builds the engine registry.
 *
 * `DEFAULT_ENGINE_ID` ("opencode") is the default because `WorkspaceWire.engineId` is
 * optional and the legacy session routes treat every workspace that is not
 * `DEEPSEEK_HARNESS_ENGINE_ID` as an OpenCode workspace.
 */
export function createEngineRegistry(input: {
  config: ServerConfig;
  createWorkspaceOpencodeClient: (config: ServerConfig, workspace: WorkspaceInfo) => OpencodeEngineClient;
  unwrapOpencodeResult: UnwrapOpencodeResult;
  deepseekHarness: HarnessRuntimeLike;
}): EngineAdapterRegistry {
  return new EngineAdapterRegistry(DEFAULT_ENGINE_ID, [
    createOpencodeEngineAdapter({
      createClient: (workspace) => input.createWorkspaceOpencodeClient(input.config, workspace),
      unwrap: input.unwrapOpencodeResult,
    }),
    createHarnessEngineAdapter({ runtime: input.deepseekHarness }),
  ]);
}

/**
 * Builds the per-request token-policy gate.
 *
 * Enforcement lives at the registry level rather than in individual handlers because a
 * restriction that only some routes remember to apply is worse than none: `whoami` reports
 * the workspace binding as being in force, so a caller has every reason to believe a token
 * scoped to one workspace cannot touch another.
 *
 * Only the workspace binding and expiry are enforced here. The approval policy is consumed
 * where approvals happen, and a route with no `workspaceId` parameter has nothing to bind.
 */
export function createPolicyEnforcer(
  store: Pick<TokenPolicyStore, "get">,
): (ctx: RequestContext) => Promise<void> {
  return async (ctx) => {
    const tokenHash = ctx.actor?.tokenHash;
    // The shared config token has no stored record and therefore no policy — it is the
    // deployment-wide credential, and narrowing it is what `POST /tokens` is for.
    if (!tokenHash) return;

    const record = await ctx.tokens.findByHash(tokenHash);
    if (!record) return;

    const policy = await store.get(record.id);
    const workspaceId = ctx.params.workspaceId ?? ctx.params.id;
    assertPolicyAllowsWorkspace(policy, workspaceId ?? "", Date.now(), {
      // A route that names no workspace still has to honour expiry.
      skipWorkspaceCheck: workspaceId === undefined,
    });
  };
}

/**
 * Maps a task store event onto the webhook event name subscribers can name.
 *
 * Pure and exported so the mapping is testable without a store. `task.updated` and a
 * transition to `running` or `cancelled` deliberately produce nothing: neither is in
 * `WEBHOOK_TASK_EVENT_TYPES`, and inventing a name here would make a subscription filter
 * that cannot be expressed.
 */
export function taskWebhookEventType(event: TaskEvent): string | null {
  if (event.type === "task.created") return "task.created";
  if (event.type !== "task.state") return null;
  if (event.to === "done") return "task.completed";
  if (event.to === "failed") return "task.failed";
  if (event.to === "awaiting_approval") return "task.awaiting_approval";
  return null;
}

/**
 * Connects the task store's event log to webhook delivery.
 *
 * Without this the `task.*` events in `WEBHOOK_EVENT_TYPES` would be subscribable but
 * never sent. Delivery is fire-and-forget: a task run must not slow down or fail because a
 * subscriber's endpoint is slow or gone, so the promise is detached and every rejection is
 * swallowed here rather than escaping into the store's listener loop.
 */
export function bridgeTaskEventsToWebhooks(input: {
  tasks: TaskStore;
  webhooks: WebhookStoreLike;
  dispatch?: typeof dispatchWebhookEvent;
  allowPrivate?: () => boolean;
}): () => void {
  const dispatch = input.dispatch ?? dispatchWebhookEvent;
  const allowPrivate = input.allowPrivate ?? webhookPrivateNetworkAllowed;
  return input.tasks.subscribe({
    onEvent: (event) => {
      const type = taskWebhookEventType(event);
      if (!type) return;
      try {
        void dispatch(
          input.webhooks,
          { workspaceId: event.task.workspaceId, type, data: serializeTask(event.task) },
          { allowPrivate: allowPrivate() },
        ).catch(() => undefined);
      } catch {
        // A synchronous throw from a stubbed dispatcher must not break the task run.
      }
    },
  });
}

/**
 * Mounts the `/api/v1` surface onto an existing route table.
 *
 * Call it after the legacy `register*Routes` calls: nothing here depends on registration
 * order for matching (appended routes cannot shadow earlier ones), but `compat` re-dispatches
 * into the legacy table and must be able to see all of it.
 */
export function registerApiV1(input: RegisterApiV1Input): RegisterApiV1Result {
  const env = input.env ?? process.env;
  const available = input.modules ?? API_MODULES;
  const enabled = resolveEnabledModules(available, {
    enabled: env[API_MODULES_ENV] ?? null,
    disabled: env[API_MODULES_DISABLED_ENV] ?? null,
  });
  const enabledIds = new Set(enabled.map((module) => module.id));

  const engines = createEngineRegistry({
    config: input.config,
    createWorkspaceOpencodeClient: input.createWorkspaceOpencodeClient,
    unwrapOpencodeResult: input.unwrapOpencodeResult,
    deepseekHarness: input.deepseekHarness,
  });

  const overrides = input.services ?? {};

  // The stores are owned here rather than inside their modules so the task -> webhook
  // bridge can hold the same two instances the request handlers use.
  const taskStore = (overrides.taskStore as TaskStore | undefined)
    ?? (enabledIds.has("tasks") ? createTaskStore() : undefined);
  const taskRunner = (overrides.taskRunner as TaskRunner | undefined)
    ?? (taskStore ? createTaskRunner({ store: taskStore }) : undefined);
  const webhookStore = (overrides.webhookStore as WebhookStoreLike | undefined)
    ?? (enabledIds.has("webhooks") ? new WebhookStore(input.config) : undefined);
  const tokenPolicies = (overrides.tokenPolicies as TokenPolicyStore | undefined)
    ?? (enabledIds.has("policy") ? new TokenPolicyStore(input.config) : undefined);

  // Resolved after `registerApiModules` returns; the openapi module only reads it per
  // request, so a null here means "registration is still in flight" and surfaces as a 500
  // rather than as a document missing half the API.
  let registry: ApiModuleRegistryResult | null = null;

  const services: ApiModuleServices = {
    engines,
    legacyRoutes: input.legacyRoutes ?? (() => input.routes),
    getApiRegistry: () => registry,
    serverVersion: input.serverVersion,
    ...(taskStore ? { taskStore } : {}),
    ...(taskRunner ? { taskRunner } : {}),
    ...(webhookStore ? { webhookStore } : {}),
    ...(tokenPolicies ? { tokenPolicies } : {}),
    ...overrides,
  };

  const context: ApiModuleContext = {
    config: input.config,
    ensureWritable: input.ensureWritable,
    requireClientScope: input.requireClientScope,
    jsonResponse: input.jsonResponse,
    readJsonBody: input.readJsonBody,
    resolveWorkspace: input.resolveWorkspace,
    ...(tokenPolicies ? { enforcePolicy: createPolicyEnforcer(tokenPolicies) } : {}),
    services,
  };

  registry = registerApiModules(input.routes, enabled, context);

  const detach = taskStore && webhookStore
    ? bridgeTaskEventsToWebhooks({ tasks: taskStore, webhooks: webhookStore })
    : undefined;

  return {
    ...registry,
    engines,
    ...(taskStore ? { taskStore } : {}),
    ...(taskRunner ? { taskRunner } : {}),
    ...(webhookStore ? { webhookStore } : {}),
    dispose: () => detach?.(),
  };
}
