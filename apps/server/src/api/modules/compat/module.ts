import { ApiError } from "../../../errors.js";
import { matchRoute, type AuthMode, type RequestContext, type Route } from "../../../routes/registry.js";
import type { TokenScope } from "../../../types.js";
import type { ApiEffect, ApiModule, ApiModuleContext, ApiOperation, HttpMethod } from "../../module.js";

/**
 * The `compat` module republishes the pre-existing (legacy) route table under the
 * versioned `/api/v1` prefix, so an integrator has one coherent surface instead of a
 * mix of old and new paths. Nothing is reimplemented: every alias re-dispatches into
 * the very same legacy handler, so the two paths cannot drift.
 *
 * Path mapping rules
 * ------------------
 * - `/workspaces`            -> `/api/v1/workspaces`
 * - `/workspaces/:id/...`    -> `/api/v1/workspaces/:workspaceId/...`
 * - `/workspace/:id/...`     -> `/api/v1/workspaces/:workspaceId/...`  (singular becomes plural)
 * - everything else `/x/...` -> `/api/v1/x/...`                        (`/tokens`, `/approvals`,
 *   `/health`, `/status`, `/capabilities`, `/env`, `/files/sessions/...`, ...)
 *
 * Deliberately NOT aliased (see `COMPAT_EXCLUDED_LEGACY_ROUTES`)
 * -------------------------------------------------------------
 * - the toy UI (`/ui`, `/w/:id/ui`, `/ui/assets/*`) - a bundled demo page, not a contract;
 * - the raw OpenCode proxy (`/opencode/*`, `/w/:id/opencode/*`) - it forwards an upstream
 *   product's private surface verbatim and is intercepted in `server.ts` before the route
 *   table is consulted, so it is not even a `Route` this module could alias;
 * - the `/w/:id/...` mount aliases - a base-URL convenience that already duplicates the
 *   unprefixed routes; a versioned surface should have exactly one spelling per operation;
 * - browser redirect targets (`/mcp/oauth/callback`, the unauthenticated plugin
 *   authorization callback) and the raw `/mcp-proxy/*` passthrough - these URLs are handed
 *   to third parties or to an MCP transport, so a second spelling buys nothing;
 * - `/dev/log` - an unauthenticated local development log sink.
 *
 * Reserved paths (owned by other modules, see `COMPAT_RESERVED_V1_PREFIXES`)
 * -------------------------------------------------------------------------
 * `registerApiModules` throws on a duplicate route, so the legacy session routes and
 * `/whoami` are excluded here and re-published by the `sessions` / `policy` modules with
 * first-class schemas.
 *
 * Gating: how double-gating is avoided
 * ------------------------------------
 * `registerApiModules` wraps every operation with `ensureWritable` (when `effect !== "read"`)
 * and `requireClientScope(scope)` (when `auth === "client"`), while the legacy handlers run
 * their own copies of those checks. Double-gating is only a problem if the wrapper is
 * *stricter* than the legacy route, so each alias is declared to be at most as strict:
 *
 * - `auth` is copied verbatim from the legacy `addRoute` call, so the dispatcher performs
 *   exactly the same authentication (`none` / `client` / `host` / `host-token`).
 * - `scope` is the scope the legacy handler itself demands *unconditionally*
 *   (`requireClientScope(ctx, "collaborator")` as the first statement); where the legacy
 *   handler applies no check, or applies one only on some branches (e.g. the DeepSeek
 *   Harness RPC only demands `collaborator` for non-read methods), the alias declares
 *   `viewer` - the weakest scope any authenticated client token already has - and lets the
 *   legacy handler perform its own, finer-grained check. For `host` / `host-token` routes
 *   the wrapper skips the scope check entirely; `owner` is declared for documentation only.
 * - `effect` follows the HTTP method (GET -> read, DELETE -> destructive, else write),
 *   except for the non-GET legacy routes that never mutate anything (validate / preview /
 *   export / package / batch-read / connectivity probe) or that decide read-vs-write from
 *   the request payload inside the handler (`/experimental/extensions/call`, the DeepSeek
 *   Harness RPC envelope). Those declare `read` so the alias does not reject on a read-only
 *   server what the legacy path serves.
 *
 * `COMPAT_READ_ONLY_STRICTER` lists the 13 aliases that remain stricter than their legacy
 * twin, and only when the server runs read-only: their legacy handler mutates state but
 * forgot to call `ensureWritable`. The divergence is fail-closed (never fail-open) and is
 * documented rather than silently papered over.
 */

export interface CompatAlias {
  /** Unique across all modules; prefixed with `compat` so it cannot clash with a first-class module. */
  operationId: string;
  method: HttpMethod;
  /** Path in the legacy route table, in `addRoute` syntax. */
  legacyPath: string;
  /** Path published under `/api/v1`, in `addRoute` syntax. */
  path: string;
  /** Copied verbatim from the legacy `addRoute` call. */
  auth: AuthMode;
  effect: ApiEffect;
  /** Never stricter than the legacy handler's own unconditional check. */
  scope: TokenScope;
}

/** Returns the assembled legacy route table. Late-bound: the table is built after modules register. */
export type LegacyRoutesProvider = () => Route[];

export interface CompatModuleServices {
  legacyRoutes: LegacyRoutesProvider;
}

export const COMPAT_MODULE_ID = "compat";

/** Path prefixes owned by other API modules. No alias may fall inside one of these. */
export const COMPAT_RESERVED_V1_PREFIXES: readonly string[] = [
  "/api/v1/workspaces/:workspaceId/sessions",
  "/api/v1/tasks",
  "/api/v1/webhooks",
  "/api/v1/whoami",
  "/api/v1/tokens/:tokenId/policy",
];

export type CompatExclusionReason =
  | "toy-ui"
  | "mount-alias"
  | "dev-only"
  | "browser-callback"
  | "raw-proxy"
  | "reserved-sessions"
  | "reserved-policy";

export interface CompatExcludedRoute {
  method: string;
  path: string;
  reason: CompatExclusionReason;
}

/** Legacy routes intentionally left off `/api/v1`. */
export const COMPAT_EXCLUDED_LEGACY_ROUTES: readonly CompatExcludedRoute[] = [
  { method: "GET", path: "/workspace/:id/plugin-packages/:pluginId/authorization/callback", reason: "browser-callback" },
  { method: "GET", path: "/mcp/oauth/callback", reason: "browser-callback" },
  { method: "GET", path: "/mcp-proxy/:workspaceId/:name", reason: "raw-proxy" },
  { method: "POST", path: "/mcp-proxy/:workspaceId/:name", reason: "raw-proxy" },
  { method: "DELETE", path: "/mcp-proxy/:workspaceId/:name", reason: "raw-proxy" },
  { method: "GET", path: "/w/:id/health", reason: "mount-alias" },
  { method: "POST", path: "/dev/log", reason: "dev-only" },
  { method: "GET", path: "/dev/log", reason: "dev-only" },
  { method: "GET", path: "/ui", reason: "toy-ui" },
  { method: "GET", path: "/w/:id/ui", reason: "mount-alias" },
  { method: "GET", path: "/ui/assets/toy.css", reason: "toy-ui" },
  { method: "GET", path: "/ui/assets/toy.js", reason: "toy-ui" },
  { method: "GET", path: "/ui/assets/ipollowork-mark.svg", reason: "toy-ui" },
  { method: "GET", path: "/w/:id/status", reason: "mount-alias" },
  { method: "GET", path: "/w/:id/capabilities", reason: "mount-alias" },
  { method: "GET", path: "/w/:id/workspaces", reason: "mount-alias" },
  { method: "GET", path: "/w/:id/runtime/versions", reason: "mount-alias" },
  { method: "POST", path: "/w/:id/runtime/upgrade", reason: "mount-alias" },
  { method: "GET", path: "/whoami", reason: "reserved-policy" },
  { method: "GET", path: "/workspace/:id/sessions", reason: "reserved-sessions" },
  { method: "GET", path: "/workspace/:id/sessions/:sessionId", reason: "reserved-sessions" },
  { method: "GET", path: "/workspace/:id/sessions/:sessionId/messages", reason: "reserved-sessions" },
  { method: "GET", path: "/workspace/:id/sessions/:sessionId/snapshot", reason: "reserved-sessions" },
  { method: "DELETE", path: "/workspace/:id/sessions/:sessionId", reason: "reserved-sessions" },
];

/**
 * `"<METHOD> <legacyPath>"` for aliases whose write gate is stricter than the legacy route.
 * Every entry mutates state but its legacy handler never calls `ensureWritable`, so the
 * alias rejects with `403 read_only` on a read-only server where the legacy path succeeds.
 */
export const COMPAT_READ_ONLY_STRICTER: readonly string[] = [
  "POST /runtime/upgrade",
  "POST /experimental/google-workspace/connect/start",
  "POST /experimental/google-workspace/disconnect",
  "POST /experimental/google-workspace/active-account",
  "PUT /env/status",
  "POST /voice/realtime/session",
  "POST /workspace/:id/files/sessions",
  "POST /files/sessions/:sessionId/renew",
  "DELETE /files/sessions/:sessionId",
  "POST /workspaces/:id/activate",
  "POST /workspace/:id/engine/reload",
  "POST /approvals/:id",
  "POST /workspace/:id/engine/deepseek-harness/respond",
];

/** The full legacy -> v1 alias table. */
export const COMPAT_ALIASES: readonly CompatAlias[] = [
  { operationId: "compatGetWorkspacesByWorkspaceIdTemplates", method: "GET", legacyPath: "/workspace/:id/templates", path: "/api/v1/workspaces/:workspaceId/templates", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdHyperframesCatalog", method: "GET", legacyPath: "/workspace/:id/hyperframes-catalog", path: "/api/v1/workspaces/:workspaceId/hyperframes-catalog", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdTemplatesByTemplateIdCover", method: "GET", legacyPath: "/workspace/:id/templates/:templateId/cover", path: "/api/v1/workspaces/:workspaceId/templates/:templateId/cover", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdTemplatesByTemplateIdPackage", method: "GET", legacyPath: "/workspace/:id/templates/:templateId/package", path: "/api/v1/workspaces/:workspaceId/templates/:templateId/package", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdTemplatesImport", method: "POST", legacyPath: "/workspace/:id/templates/import", path: "/api/v1/workspaces/:workspaceId/templates/import", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdTemplatesFromSessionPackage", method: "POST", legacyPath: "/workspace/:id/templates/from-session/package", path: "/api/v1/workspaces/:workspaceId/templates/from-session/package", auth: "client", effect: "read", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdTemplatesFromSession", method: "POST", legacyPath: "/workspace/:id/templates/from-session", path: "/api/v1/workspaces/:workspaceId/templates/from-session", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdTemplatesAuthoringSessions", method: "POST", legacyPath: "/workspace/:id/templates/authoring-sessions", path: "/api/v1/workspaces/:workspaceId/templates/authoring-sessions", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdTemplatesFromSessionValidate", method: "POST", legacyPath: "/workspace/:id/templates/from-session/validate", path: "/api/v1/workspaces/:workspaceId/templates/from-session/validate", auth: "client", effect: "read", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdTemplatesByTemplateIdInstall", method: "POST", legacyPath: "/workspace/:id/templates/:templateId/install", path: "/api/v1/workspaces/:workspaceId/templates/:templateId/install", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdTemplatesByTemplateId", method: "DELETE", legacyPath: "/workspace/:id/templates/:templateId", path: "/api/v1/workspaces/:workspaceId/templates/:templateId", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdTemplatesByTemplateIdMaterialize", method: "POST", legacyPath: "/workspace/:id/templates/:templateId/materialize", path: "/api/v1/workspaces/:workspaceId/templates/:templateId/materialize", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdTemplateSessionsBySessionIdAdoptVideo", method: "POST", legacyPath: "/workspace/:id/template-sessions/:sessionId/adopt-video", path: "/api/v1/workspaces/:workspaceId/template-sessions/:sessionId/adopt-video", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdTemplateSessions", method: "GET", legacyPath: "/workspace/:id/template-sessions", path: "/api/v1/workspaces/:workspaceId/template-sessions", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdTemplateSessionsBySessionId", method: "GET", legacyPath: "/workspace/:id/template-sessions/:sessionId", path: "/api/v1/workspaces/:workspaceId/template-sessions/:sessionId", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdConfig", method: "GET", legacyPath: "/workspace/:id/config", path: "/api/v1/workspaces/:workspaceId/config", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdDesktopCloudSync", method: "GET", legacyPath: "/workspace/:id/desktop-cloud-sync", path: "/api/v1/workspaces/:workspaceId/desktop-cloud-sync", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdDesktopCloudSync", method: "POST", legacyPath: "/workspace/:id/desktop-cloud-sync", path: "/api/v1/workspaces/:workspaceId/desktop-cloud-sync", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdCloudPlugins", method: "GET", legacyPath: "/workspace/:id/cloud-plugins", path: "/api/v1/workspaces/:workspaceId/cloud-plugins", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdCloudPlugins", method: "POST", legacyPath: "/workspace/:id/cloud-plugins", path: "/api/v1/workspaces/:workspaceId/cloud-plugins", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdClaudePlugins", method: "POST", legacyPath: "/workspace/:id/claude-plugins", path: "/api/v1/workspaces/:workspaceId/claude-plugins", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdCloudPluginsByPluginId", method: "DELETE", legacyPath: "/workspace/:id/cloud-plugins/:pluginId", path: "/api/v1/workspaces/:workspaceId/cloud-plugins/:pluginId", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdPluginPackages", method: "GET", legacyPath: "/workspace/:id/plugin-packages", path: "/api/v1/workspaces/:workspaceId/plugin-packages", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdPluginPackagesCatalog", method: "GET", legacyPath: "/workspace/:id/plugin-packages/catalog", path: "/api/v1/workspaces/:workspaceId/plugin-packages/catalog", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesCatalogByPluginIdInstall", method: "POST", legacyPath: "/workspace/:id/plugin-packages/catalog/:pluginId/install", path: "/api/v1/workspaces/:workspaceId/plugin-packages/catalog/:pluginId/install", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesImportValidate", method: "POST", legacyPath: "/workspace/:id/plugin-packages/import/validate", path: "/api/v1/workspaces/:workspaceId/plugin-packages/import/validate", auth: "client", effect: "read", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesImport", method: "POST", legacyPath: "/workspace/:id/plugin-packages/import", path: "/api/v1/workspaces/:workspaceId/plugin-packages/import", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesValidate", method: "POST", legacyPath: "/workspace/:id/plugin-packages/validate", path: "/api/v1/workspaces/:workspaceId/plugin-packages/validate", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackages", method: "POST", legacyPath: "/workspace/:id/plugin-packages", path: "/api/v1/workspaces/:workspaceId/plugin-packages", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesByPluginIdUpdate", method: "POST", legacyPath: "/workspace/:id/plugin-packages/:pluginId/update", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/update", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesByPluginIdRollback", method: "POST", legacyPath: "/workspace/:id/plugin-packages/:pluginId/rollback", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/rollback", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPatchWorkspacesByWorkspaceIdPluginPackagesByPluginId", method: "PATCH", legacyPath: "/workspace/:id/plugin-packages/:pluginId", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPatchWorkspacesByWorkspaceIdPluginPackagesByPluginIdResourcesByResourceId", method: "PATCH", legacyPath: "/workspace/:id/plugin-packages/:pluginId/resources/:resourceId", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/resources/:resourceId", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdPluginPackagesByPluginId", method: "DELETE", legacyPath: "/workspace/:id/plugin-packages/:pluginId", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdPluginPackagesByPluginIdAuthorization", method: "GET", legacyPath: "/workspace/:id/plugin-packages/:pluginId/authorization", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/authorization", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesByPluginIdAuthorizationByMethodIdCredentials", method: "POST", legacyPath: "/workspace/:id/plugin-packages/:pluginId/authorization/:methodId/credentials", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/authorization/:methodId/credentials", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesByPluginIdAuthorizationByMethodIdStart", method: "POST", legacyPath: "/workspace/:id/plugin-packages/:pluginId/authorization/:methodId/start", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/authorization/:methodId/start", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesByPluginIdAuthorizationCallback", method: "POST", legacyPath: "/workspace/:id/plugin-packages/:pluginId/authorization/callback", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/authorization/callback", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPluginPackagesByPluginIdAuthorizationDeviceByFlowIdPoll", method: "POST", legacyPath: "/workspace/:id/plugin-packages/:pluginId/authorization/device/:flowId/poll", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/authorization/device/:flowId/poll", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdPluginPackagesByPluginIdAuthorizationFlowsByFlowId", method: "DELETE", legacyPath: "/workspace/:id/plugin-packages/:pluginId/authorization/flows/:flowId", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/authorization/flows/:flowId", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdPluginPackagesByPluginIdAuthorizationByAccountId", method: "DELETE", legacyPath: "/workspace/:id/plugin-packages/:pluginId/authorization/:accountId", path: "/api/v1/workspaces/:workspaceId/plugin-packages/:pluginId/authorization/:accountId", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdAuthorizedFolders", method: "GET", legacyPath: "/workspace/:id/authorized-folders", path: "/api/v1/workspaces/:workspaceId/authorized-folders", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPutWorkspacesByWorkspaceIdAuthorizedFolders", method: "PUT", legacyPath: "/workspace/:id/authorized-folders", path: "/api/v1/workspaces/:workspaceId/authorized-folders", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdRuntimeConfigMigrate", method: "POST", legacyPath: "/workspace/:id/runtime-config/migrate", path: "/api/v1/workspaces/:workspaceId/runtime-config/migrate", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdRuntimeConfig", method: "GET", legacyPath: "/workspace/:id/runtime-config", path: "/api/v1/workspaces/:workspaceId/runtime-config", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdOpencodeConfig", method: "GET", legacyPath: "/workspace/:id/opencode-config", path: "/api/v1/workspaces/:workspaceId/opencode-config", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdOpencodeConfig", method: "POST", legacyPath: "/workspace/:id/opencode-config", path: "/api/v1/workspaces/:workspaceId/opencode-config", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdAudit", method: "GET", legacyPath: "/workspace/:id/audit", path: "/api/v1/workspaces/:workspaceId/audit", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPatchWorkspacesByWorkspaceIdConfig", method: "PATCH", legacyPath: "/workspace/:id/config", path: "/api/v1/workspaces/:workspaceId/config", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdPlugins", method: "GET", legacyPath: "/workspace/:id/plugins", path: "/api/v1/workspaces/:workspaceId/plugins", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdPlugins", method: "POST", legacyPath: "/workspace/:id/plugins", path: "/api/v1/workspaces/:workspaceId/plugins", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdPluginsByName", method: "DELETE", legacyPath: "/workspace/:id/plugins/:name", path: "/api/v1/workspaces/:workspaceId/plugins/:name", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatGetHubSkills", method: "GET", legacyPath: "/hub/skills", path: "/api/v1/hub/skills", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdSkills", method: "GET", legacyPath: "/workspace/:id/skills", path: "/api/v1/workspaces/:workspaceId/skills", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdSkillsHubByName", method: "POST", legacyPath: "/workspace/:id/skills/hub/:name", path: "/api/v1/workspaces/:workspaceId/skills/hub/:name", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdSkillsByName", method: "GET", legacyPath: "/workspace/:id/skills/:name", path: "/api/v1/workspaces/:workspaceId/skills/:name", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdSkills", method: "POST", legacyPath: "/workspace/:id/skills", path: "/api/v1/workspaces/:workspaceId/skills", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdSkillsByName", method: "DELETE", legacyPath: "/workspace/:id/skills/:name", path: "/api/v1/workspaces/:workspaceId/skills/:name", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdMcp", method: "GET", legacyPath: "/workspace/:id/mcp", path: "/api/v1/workspaces/:workspaceId/mcp", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdExtensionsExport", method: "POST", legacyPath: "/workspace/:id/extensions/export", path: "/api/v1/workspaces/:workspaceId/extensions/export", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdMcp", method: "POST", legacyPath: "/workspace/:id/mcp", path: "/api/v1/workspaces/:workspaceId/mcp", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdMcpByName", method: "DELETE", legacyPath: "/workspace/:id/mcp/:name", path: "/api/v1/workspaces/:workspaceId/mcp/:name", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdMcpByNameEnabled", method: "POST", legacyPath: "/workspace/:id/mcp/:name/enabled", path: "/api/v1/workspaces/:workspaceId/mcp/:name/enabled", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdMcpByNameAuth", method: "DELETE", legacyPath: "/workspace/:id/mcp/:name/auth", path: "/api/v1/workspaces/:workspaceId/mcp/:name/auth", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdMcpByNameAuthStart", method: "POST", legacyPath: "/workspace/:id/mcp/:name/auth/start", path: "/api/v1/workspaces/:workspaceId/mcp/:name/auth/start", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdMcpByNameAuth", method: "GET", legacyPath: "/workspace/:id/mcp/:name/auth", path: "/api/v1/workspaces/:workspaceId/mcp/:name/auth", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdCommands", method: "GET", legacyPath: "/workspace/:id/commands", path: "/api/v1/workspaces/:workspaceId/commands", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdCommands", method: "POST", legacyPath: "/workspace/:id/commands", path: "/api/v1/workspaces/:workspaceId/commands", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatDeleteWorkspacesByWorkspaceIdCommandsByName", method: "DELETE", legacyPath: "/workspace/:id/commands/:name", path: "/api/v1/workspaces/:workspaceId/commands/:name", auth: "client", effect: "destructive", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdExport", method: "GET", legacyPath: "/workspace/:id/export", path: "/api/v1/workspaces/:workspaceId/export", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdImportPreview", method: "POST", legacyPath: "/workspace/:id/import/preview", path: "/api/v1/workspaces/:workspaceId/import/preview", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdImport", method: "POST", legacyPath: "/workspace/:id/import", path: "/api/v1/workspaces/:workspaceId/import", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdBlueprintSessionsMaterialize", method: "POST", legacyPath: "/workspace/:id/blueprint/sessions/materialize", path: "/api/v1/workspaces/:workspaceId/blueprint/sessions/materialize", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetHealth", method: "GET", legacyPath: "/health", path: "/api/v1/health", auth: "none", effect: "read", scope: "owner" },
  { operationId: "compatGetStatus", method: "GET", legacyPath: "/status", path: "/api/v1/status", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetRuntimeVersions", method: "GET", legacyPath: "/runtime/versions", path: "/api/v1/runtime/versions", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostRuntimeUpgrade", method: "POST", legacyPath: "/runtime/upgrade", path: "/api/v1/runtime/upgrade", auth: "host", effect: "write", scope: "owner" },
  { operationId: "compatGetCapabilities", method: "GET", legacyPath: "/capabilities", path: "/api/v1/capabilities", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetExperimentalConnectState", method: "GET", legacyPath: "/experimental/connect/state", path: "/api/v1/experimental/connect/state", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPutExperimentalConnectState", method: "PUT", legacyPath: "/experimental/connect/state", path: "/api/v1/experimental/connect/state", auth: "host", effect: "write", scope: "owner" },
  { operationId: "compatGetExperimentalExtensionsActions", method: "GET", legacyPath: "/experimental/extensions/actions", path: "/api/v1/experimental/extensions/actions", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostExperimentalExtensionsCall", method: "POST", legacyPath: "/experimental/extensions/call", path: "/api/v1/experimental/extensions/call", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetExperimentalGoogleWorkspaceStatus", method: "GET", legacyPath: "/experimental/google-workspace/status", path: "/api/v1/experimental/google-workspace/status", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostExperimentalGoogleWorkspaceConnectStart", method: "POST", legacyPath: "/experimental/google-workspace/connect/start", path: "/api/v1/experimental/google-workspace/connect/start", auth: "client", effect: "write", scope: "viewer" },
  { operationId: "compatGetExperimentalGoogleWorkspaceConnectStatusByFlowId", method: "GET", legacyPath: "/experimental/google-workspace/connect/status/:flowId", path: "/api/v1/experimental/google-workspace/connect/status/:flowId", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostExperimentalGoogleWorkspaceDisconnect", method: "POST", legacyPath: "/experimental/google-workspace/disconnect", path: "/api/v1/experimental/google-workspace/disconnect", auth: "client", effect: "write", scope: "viewer" },
  { operationId: "compatPostExperimentalGoogleWorkspaceActiveAccount", method: "POST", legacyPath: "/experimental/google-workspace/active-account", path: "/api/v1/experimental/google-workspace/active-account", auth: "client", effect: "write", scope: "viewer" },
  { operationId: "compatPostExperimentalGoogleWorkspaceTest", method: "POST", legacyPath: "/experimental/google-workspace/test", path: "/api/v1/experimental/google-workspace/test", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostExperimentalGoogleWorkspaceSmokeTest", method: "POST", legacyPath: "/experimental/google-workspace/smoke-test", path: "/api/v1/experimental/google-workspace/smoke-test", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspaces", method: "GET", legacyPath: "/workspaces", path: "/api/v1/workspaces", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetTokens", method: "GET", legacyPath: "/tokens", path: "/api/v1/tokens", auth: "host", effect: "read", scope: "owner" },
  { operationId: "compatPostTokens", method: "POST", legacyPath: "/tokens", path: "/api/v1/tokens", auth: "host", effect: "write", scope: "owner" },
  { operationId: "compatDeleteTokensById", method: "DELETE", legacyPath: "/tokens/:id", path: "/api/v1/tokens/:id", auth: "host", effect: "destructive", scope: "owner" },
  { operationId: "compatGetEnv", method: "GET", legacyPath: "/env", path: "/api/v1/env", auth: "host-token", effect: "read", scope: "owner" },
  { operationId: "compatGetEnvKeys", method: "GET", legacyPath: "/env/keys", path: "/api/v1/env/keys", auth: "host-token", effect: "read", scope: "owner" },
  { operationId: "compatGetEnvStatus", method: "GET", legacyPath: "/env/status", path: "/api/v1/env/status", auth: "host-token", effect: "read", scope: "owner" },
  { operationId: "compatPutEnvStatus", method: "PUT", legacyPath: "/env/status", path: "/api/v1/env/status", auth: "host-token", effect: "write", scope: "owner" },
  { operationId: "compatGetEnvByKey", method: "GET", legacyPath: "/env/:key", path: "/api/v1/env/:key", auth: "host-token", effect: "read", scope: "owner" },
  { operationId: "compatPutEnv", method: "PUT", legacyPath: "/env", path: "/api/v1/env", auth: "host-token", effect: "write", scope: "owner" },
  { operationId: "compatDeleteEnvByKey", method: "DELETE", legacyPath: "/env/:key", path: "/api/v1/env/:key", auth: "host-token", effect: "destructive", scope: "owner" },
  { operationId: "compatGetAuthorizationServices", method: "GET", legacyPath: "/authorization-services", path: "/api/v1/authorization-services", auth: "host-token", effect: "read", scope: "owner" },
  { operationId: "compatPutAuthorizationServicesByServiceIdCredentials", method: "PUT", legacyPath: "/authorization-services/:serviceId/credentials", path: "/api/v1/authorization-services/:serviceId/credentials", auth: "host-token", effect: "write", scope: "owner" },
  { operationId: "compatPostAuthorizationServicesByServiceIdTest", method: "POST", legacyPath: "/authorization-services/:serviceId/test", path: "/api/v1/authorization-services/:serviceId/test", auth: "host-token", effect: "read", scope: "owner" },
  { operationId: "compatPostVoiceRealtimeSession", method: "POST", legacyPath: "/voice/realtime/session", path: "/api/v1/voice/realtime/session", auth: "host", effect: "write", scope: "owner" },
  { operationId: "compatGetWorkspacesByWorkspaceIdInbox", method: "GET", legacyPath: "/workspace/:id/inbox", path: "/api/v1/workspaces/:workspaceId/inbox", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdInboxByInboxId", method: "GET", legacyPath: "/workspace/:id/inbox/:inboxId", path: "/api/v1/workspaces/:workspaceId/inbox/:inboxId", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdInbox", method: "POST", legacyPath: "/workspace/:id/inbox", path: "/api/v1/workspaces/:workspaceId/inbox", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdArtifacts", method: "GET", legacyPath: "/workspace/:id/artifacts", path: "/api/v1/workspaces/:workspaceId/artifacts", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdArtifactsByArtifactId", method: "GET", legacyPath: "/workspace/:id/artifacts/:artifactId", path: "/api/v1/workspaces/:workspaceId/artifacts/:artifactId", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdArtifactsResolve", method: "POST", legacyPath: "/workspace/:id/artifacts/resolve", path: "/api/v1/workspaces/:workspaceId/artifacts/resolve", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdFilesSessions", method: "POST", legacyPath: "/workspace/:id/files/sessions", path: "/api/v1/workspaces/:workspaceId/files/sessions", auth: "client", effect: "write", scope: "viewer" },
  { operationId: "compatPostFilesSessionsBySessionIdRenew", method: "POST", legacyPath: "/files/sessions/:sessionId/renew", path: "/api/v1/files/sessions/:sessionId/renew", auth: "client", effect: "write", scope: "viewer" },
  { operationId: "compatDeleteFilesSessionsBySessionId", method: "DELETE", legacyPath: "/files/sessions/:sessionId", path: "/api/v1/files/sessions/:sessionId", auth: "client", effect: "destructive", scope: "viewer" },
  { operationId: "compatGetFilesSessionsBySessionIdCatalogSnapshot", method: "GET", legacyPath: "/files/sessions/:sessionId/catalog/snapshot", path: "/api/v1/files/sessions/:sessionId/catalog/snapshot", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetFilesSessionsBySessionIdCatalogEvents", method: "GET", legacyPath: "/files/sessions/:sessionId/catalog/events", path: "/api/v1/files/sessions/:sessionId/catalog/events", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostFilesSessionsBySessionIdReadBatch", method: "POST", legacyPath: "/files/sessions/:sessionId/read-batch", path: "/api/v1/files/sessions/:sessionId/read-batch", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostFilesSessionsBySessionIdWriteBatch", method: "POST", legacyPath: "/files/sessions/:sessionId/write-batch", path: "/api/v1/files/sessions/:sessionId/write-batch", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostFilesSessionsBySessionIdOps", method: "POST", legacyPath: "/files/sessions/:sessionId/ops", path: "/api/v1/files/sessions/:sessionId/ops", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdFilesContent", method: "GET", legacyPath: "/workspace/:id/files/content", path: "/api/v1/workspaces/:workspaceId/files/content", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdFilesStat", method: "GET", legacyPath: "/workspace/:id/files/stat", path: "/api/v1/workspaces/:workspaceId/files/stat", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatGetWorkspacesByWorkspaceIdFilesRaw", method: "GET", legacyPath: "/workspace/:id/files/raw", path: "/api/v1/workspaces/:workspaceId/files/raw", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdFilesRaw", method: "POST", legacyPath: "/workspace/:id/files/raw", path: "/api/v1/workspaces/:workspaceId/files/raw", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesByWorkspaceIdFilesContent", method: "POST", legacyPath: "/workspace/:id/files/content", path: "/api/v1/workspaces/:workspaceId/files/content", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatPostWorkspacesLocal", method: "POST", legacyPath: "/workspaces/local", path: "/api/v1/workspaces/local", auth: "host", effect: "write", scope: "owner" },
  { operationId: "compatPostWorkspacesRemote", method: "POST", legacyPath: "/workspaces/remote", path: "/api/v1/workspaces/remote", auth: "host", effect: "write", scope: "owner" },
  { operationId: "compatPatchWorkspacesByWorkspaceIdDisplayName", method: "PATCH", legacyPath: "/workspaces/:id/display-name", path: "/api/v1/workspaces/:workspaceId/display-name", auth: "host", effect: "write", scope: "owner" },
  { operationId: "compatPostWorkspacesByWorkspaceIdActivate", method: "POST", legacyPath: "/workspaces/:id/activate", path: "/api/v1/workspaces/:workspaceId/activate", auth: "host", effect: "write", scope: "owner" },
  { operationId: "compatDeleteWorkspacesByWorkspaceId", method: "DELETE", legacyPath: "/workspaces/:id", path: "/api/v1/workspaces/:workspaceId", auth: "host", effect: "destructive", scope: "owner" },
  { operationId: "compatGetWorkspacesByWorkspaceIdEvents", method: "GET", legacyPath: "/workspace/:id/events", path: "/api/v1/workspaces/:workspaceId/events", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdEngineReload", method: "POST", legacyPath: "/workspace/:id/engine/reload", path: "/api/v1/workspaces/:workspaceId/engine/reload", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetApprovals", method: "GET", legacyPath: "/approvals", path: "/api/v1/approvals", auth: "host", effect: "read", scope: "owner" },
  { operationId: "compatPostApprovalsById", method: "POST", legacyPath: "/approvals/:id", path: "/api/v1/approvals/:id", auth: "host", effect: "write", scope: "owner" },
  { operationId: "compatPostWorkspacesByWorkspaceIdEngineDeepseekHarnessRpc", method: "POST", legacyPath: "/workspace/:id/engine/deepseek-harness/rpc", path: "/api/v1/workspaces/:workspaceId/engine/deepseek-harness/rpc", auth: "client", effect: "read", scope: "viewer" },
  { operationId: "compatPostWorkspacesByWorkspaceIdEngineDeepseekHarnessRespond", method: "POST", legacyPath: "/workspace/:id/engine/deepseek-harness/respond", path: "/api/v1/workspaces/:workspaceId/engine/deepseek-harness/respond", auth: "client", effect: "write", scope: "collaborator" },
  { operationId: "compatGetWorkspacesByWorkspaceIdEngineDeepseekHarnessEventsByStream", method: "GET", legacyPath: "/workspace/:id/engine/deepseek-harness/events/:stream", path: "/api/v1/workspaces/:workspaceId/engine/deepseek-harness/events/:stream", auth: "client", effect: "read", scope: "viewer" },
];

/**
 * Applies the path mapping rules to a legacy path. Exported so the alias table can be
 * checked against the rules rather than trusted.
 */
export function toV1Path(legacyPath: string): string {
  if (legacyPath === "/workspaces") return "/api/v1/workspaces";
  if (legacyPath.startsWith("/workspaces/")) {
    return `/api/v1/workspaces/${legacyPath.slice("/workspaces/".length).replace(/^:id\b/, ":workspaceId")}`;
  }
  if (legacyPath.startsWith("/workspace/:id")) {
    return `/api/v1/workspaces/:workspaceId${legacyPath.slice("/workspace/:id".length)}`;
  }
  return `/api/v1${legacyPath}`;
}

/** Ordered `:param` names of a route path. */
export function extractPathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

/**
 * Rebuilds the concrete legacy path for a request that arrived on the alias.
 *
 * The two templates always carry the same parameters in the same order (the v1 path is
 * derived from the legacy one), so parameters are substituted positionally; that keeps the
 * `:id` -> `:workspaceId` rename from needing a per-route lookup table.
 */
export function buildLegacyPath(alias: CompatAlias, params: Record<string, string>): string {
  const aliasParams = extractPathParams(alias.path);
  let index = 0;
  return alias.legacyPath.replace(/:([A-Za-z0-9_]+)/g, () => {
    const name = aliasParams[index];
    index += 1;
    const value = name === undefined ? undefined : params[name];
    if (value === undefined) {
      throw new ApiError(400, "compat_missing_path_param", `Missing path parameter: ${name ?? "?"}`, {
        operationId: alias.operationId,
        path: alias.path,
      });
    }
    return encodeURIComponent(value);
  });
}

/**
 * Re-dispatches a `/api/v1` request into the legacy route table.
 *
 * Method, headers and body travel on the original `Request` object, which is passed through
 * untouched (no clone, so a streamed body is not buffered). Only `url` and `params` are
 * rebuilt for the legacy path; the query string is preserved verbatim. Authentication has
 * already happened in the dispatcher against the alias' own `auth` mode, which is identical
 * to the legacy route's, so `ctx.actor` is exactly what the legacy handler would have seen.
 */
export function createCompatHandler(
  alias: CompatAlias,
  legacyRoutes: LegacyRoutesProvider,
): (ctx: RequestContext) => Promise<Response> {
  return async (ctx: RequestContext) => {
    const legacyPath = buildLegacyPath(alias, ctx.params);
    const matched = matchRoute(legacyRoutes(), alias.method, legacyPath);
    if (!matched) {
      throw new ApiError(500, "compat_legacy_route_missing", "Legacy route for this alias is not registered", {
        operationId: alias.operationId,
        method: alias.method,
        legacyPath,
      });
    }
    const legacyUrl = new URL(ctx.url.href);
    legacyUrl.pathname = legacyPath;
    return matched.handler({ ...ctx, url: legacyUrl, params: matched.params });
  };
}

function resolveLegacyRoutes(context: ApiModuleContext): LegacyRoutesProvider {
  const provider = (context.services as Partial<CompatModuleServices>).legacyRoutes;
  if (typeof provider !== "function") {
    throw new ApiError(
      500,
      "compat_legacy_routes_unavailable",
      "The compat module requires services.legacyRoutes: () => Route[]",
      { module: COMPAT_MODULE_ID },
    );
  }
  return provider;
}

export const compatModule: ApiModule = {
  id: COMPAT_MODULE_ID,
  title: "Legacy compatibility",
  description:
    "Republishes every legacy iPolloWork route under /api/v1 by re-dispatching into the legacy "
    + "route table. Mapping: /workspaces -> /api/v1/workspaces, /workspace/:id/... and "
    + "/workspaces/:id/... -> /api/v1/workspaces/:workspaceId/..., everything else keeps its path "
    + "under the /api/v1 prefix. The toy UI (/ui, /w/:id/ui, /ui/assets/*), the raw /opencode/* "
    + "proxy, the /w/:id/* mount aliases, browser OAuth callbacks, /mcp-proxy/* and /dev/log are "
    + "deliberately not aliased: they are not part of a stable public contract. Routes owned by the "
    + "sessions and policy modules are excluded to avoid duplicate registrations. Each alias copies "
    + "the legacy route's auth mode and declares a scope no stricter than the legacy handler's own "
    + "check, so the module gates never reject a request the legacy path would accept.",
  version: "1.0.0",
  stability: "stable",
  register(context: ApiModuleContext): ApiOperation[] {
    const legacyRoutes = resolveLegacyRoutes(context);
    return COMPAT_ALIASES.map((alias) => ({
      operationId: alias.operationId,
      method: alias.method,
      path: alias.path,
      summary: `Alias of ${alias.method} ${alias.legacyPath}`,
      description:
        `Compatibility alias. Re-dispatches to the legacy route ${alias.method} ${alias.legacyPath}, `
        + "which stays available at its original path.",
      effect: alias.effect,
      auth: alias.auth,
      scope: alias.scope,
      handler: createCompatHandler(alias, legacyRoutes),
    }));
  },
};
