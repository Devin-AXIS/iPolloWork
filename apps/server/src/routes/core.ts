import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createDefaultProjectWorkspaceConfig,
  projectWorkspaceConfigSchema,
  type ProjectWorkspaceConfig,
} from "@ipollowork/types/project-workspace";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import { recordAudit } from "../audit.js";
import {
  getConnectSnapshot,
  googleWorkspaceStatusConnectExtra,
  writeConnectState,
} from "../connect-state.js";
import {
  isAuthorizationServiceId,
  listAuthorizationServices,
  saveAuthorizationService,
  testAuthorizationService,
} from "../authorization-center.js";
import { EnvStoreReadError, InvalidEnvKeyError, isValidEnvKey, type EnvService } from "../env-file.js";
import {
  ENGINE_HOST_TOOLS,
  ENGINE_HOST_TOOL_NAMES,
  consequentialBrowserControlNames,
  engineHostTool,
  type EngineHostToolName,
} from "../engine-host-tools.js";
import { ApiError } from "../errors.js";
import {
  createGoogleWorkspaceConnectFlowManager,
  googleWorkspaceDisconnect,
  googleWorkspaceRunScopeSmokeTest,
  googleWorkspaceSetActiveAccount,
  googleWorkspaceStatus,
  googleWorkspaceTestConnection,
} from "../extensions/google-workspace.js";
import { callExperimentalExtensionAction, listExperimentalExtensionActions } from "../extensions/index.js";
import { workspaceIdForPluginContext } from "../plugin-service-runtime.js";
import { listOpencodeOAuthProviderIds } from "../opencode-db.js";
import {
  readiPolloWorkWorkspaceConfig,
  writeiPolloWorkWorkspaceConfig,
} from "../ipollowork-workspace-config-store.js";
import { uiControlRequest } from "../ui-control-client.js";
import type { TokenService } from "../tokens.js";
import {
  TOY_UI_CSS,
  TOY_UI_FAVICON_SVG,
  TOY_UI_HTML,
  TOY_UI_JS,
  cssResponse,
  htmlResponse,
  jsResponse,
  svgResponse,
} from "../toy-ui.js";
import type { Capabilities, ServerConfig, WorkspaceInfo } from "../types.js";
import { shortId } from "../utils.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;
type ParseOptionalBoolean = (value: string | null, name: string) => boolean | undefined;
type FetchRuntimeControl = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;

interface RegisterCoreRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  tokens: TokenService;
  env: EnvService;
  serverVersion: string;
  opencodeVersion: string;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  readOptionalJsonBody: ReadJsonBody;
  parseOptionalBoolean: ParseOptionalBoolean;
  ensureWritable: (config: ServerConfig) => void;
  buildCapabilities: (config: ServerConfig, workspace?: WorkspaceInfo) => Capabilities;
  fetchRuntimeControl: FetchRuntimeControl;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  serializeWorkspace: (workspace: ServerConfig["workspaces"][number]) => unknown;
  resolveToyUiEnabled: () => boolean;
  resolveDevLogPath: () => string | null;
  createOpenAiRealtimeVoiceSession: (env: EnvService, input: unknown) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function browserActionRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function browserRequesterLabel(context: Record<string, unknown>): string {
  for (const [key, label] of [["extensionId", "plugin"], ["sessionId", "session"], ["agent", "agent"]] as const) {
    const value = typeof context[key] === "string" ? context[key].trim() : "";
    if (value) return `${label} ${value.slice(0, 80)}`;
  }
  return "current engine session";
}

async function executeUiControlAction(actionId: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await uiControlRequest("/execute", {
    method: "POST",
    body: { actionId, args },
  });
  if (isRecord(response) && response.ok === false) {
    throw new ApiError(
      503,
      "desktop_browser_unavailable",
      typeof response.error === "string" ? response.error : "iPolloWork Desktop browser runtime is unavailable",
    );
  }
  return isRecord(response) && response.ok === true && "result" in response
    ? response.result
    : response;
}

function defaultProjectConfig(workspace: WorkspaceInfo): ProjectWorkspaceConfig {
  return createDefaultProjectWorkspaceConfig({ engineId: workspace.engineId });
}

export function registerCoreRoutes(options: RegisterCoreRoutesOptions): void {
  const {
    routes,
    config,
    tokens,
    env,
    serverVersion,
    opencodeVersion,
    jsonResponse,
    readJsonBody,
    readOptionalJsonBody,
    parseOptionalBoolean,
    ensureWritable,
    buildCapabilities,
    fetchRuntimeControl,
    resolveWorkspace,
    serializeWorkspace,
    resolveToyUiEnabled,
    resolveDevLogPath,
    createOpenAiRealtimeVoiceSession,
  } = options;
  const googleWorkspaceConnectFlows = createGoogleWorkspaceConnectFlowManager(config);
  const envPendingChangesByRuntime = new Map<string, boolean>();
  const projectBuilderSessions = new Set<string>();
  const projectBuilderSessionKey = (workspaceId: string, sessionId: string) => `${workspaceId}:${sessionId}`;

  const callExtensionAction = async (ctx: RequestContext, body: Record<string, unknown>) => {
    if (ctx.actor?.scope === "viewer") {
      throw new ApiError(403, "forbidden", "Viewer tokens cannot call extension actions");
    }
    const extensionId = typeof body.extensionId === "string" ? body.extensionId.trim() : "";
    const actionId = typeof body.action === "string" ? body.action.trim() : "";
    const context = isRecord(body.context) ? body.context : {};
    const connectSnapshot = await getConnectSnapshot(config);
    const declared = (await listExperimentalExtensionActions(config, extensionId, context, connectSnapshot))
      .find((action) => action.extensionId === extensionId && action.action === actionId);
    const effect = declared && "effect" in declared ? declared.effect : "read";
    const requiresConfirmation = effect === "write" || effect === "destructive";
    let approvedWorkspace: WorkspaceInfo | null = null;
    if (requiresConfirmation && declared) {
      ensureWritable(config);
      const workspaceId = workspaceIdForPluginContext(config, context);
      approvedWorkspace = await resolveWorkspace(config, workspaceId);
      const approval = await ctx.approvals.requestApproval({
        workspaceId,
        action: `plugin_service.${extensionId}.${actionId}`,
        summary: `${declared.title} (${extensionId})`,
        paths: [],
        actor: ctx.actor ?? { type: "remote" },
      });
      if (!approval.allowed) {
        throw new ApiError(403, "write_denied", "Plugin write action denied", {
          requestId: approval.id,
          reason: approval.reason,
        });
      }
    }
    const result = await callExperimentalExtensionAction(config, env, body, connectSnapshot);
    if (approvedWorkspace && declared) {
      await recordAudit(approvedWorkspace.path, {
        id: shortId(),
        workspaceId: approvedWorkspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: `plugin_service.${extensionId}.${actionId}`,
        target: `${extensionId}:${actionId}`,
        summary: declared.title,
        timestamp: Date.now(),
      });
    }
    return result;
  };

  const resolveEngineToolWorkspace = async (context: Record<string, unknown>): Promise<WorkspaceInfo> => {
    const workspaceId = typeof context.workspaceId === "string" ? context.workspaceId.trim() : "";
    if (workspaceId) return resolveWorkspace(config, workspaceId);
    const directories = [context.directory, context.worktree]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .map((value) => value.trim());
    const workspace = config.workspaces.find((candidate) => {
      const candidatePath = candidate.path?.trim();
      if (!candidatePath) return false;
      return directories.some((directory) => (
        directory === candidatePath || resolve(directory) === resolve(candidatePath)
      ));
    });
    if (!workspace) {
      throw new ApiError(400, "project_workspace_context_missing", "Project Builder could not resolve the current iPolloWork workspace");
    }
    return resolveWorkspace(config, workspace.id);
  };

  const requireProjectBuilderSession = (workspace: WorkspaceInfo, context: Record<string, unknown>): void => {
    const sessionId = typeof context.sessionId === "string" ? context.sessionId.trim() : "";
    if (!sessionId || !projectBuilderSessions.has(projectBuilderSessionKey(workspace.id, sessionId))) {
      throw new ApiError(403, "project_builder_not_active", "Open Project Builder from the project menu before using project configuration tools");
    }
  };

  type EngineHostToolHandler = (
    ctx: RequestContext,
    args: Record<string, unknown>,
    context: Record<string, unknown>,
  ) => Promise<unknown>;
  const engineHostToolHandlers = {
    [ENGINE_HOST_TOOL_NAMES.extensionListActions]: async (_ctx, args, context) => {
      const extensionId = typeof args.extensionId === "string" ? args.extensionId.trim() : "";
      const connectSnapshot = await getConnectSnapshot(config);
      return {
        ok: true,
        actions: await listExperimentalExtensionActions(config, extensionId, context, connectSnapshot),
      };
    },
    [ENGINE_HOST_TOOL_NAMES.extensionCall]: async (ctx, args, context) => callExtensionAction(ctx, {
      extensionId: args.extensionId,
      action: args.action,
      args: isRecord(args.args) ? args.args : {},
      context,
    }),
    [ENGINE_HOST_TOOL_NAMES.projectRead]: async (_ctx, _args, context) => {
      const workspace = await resolveEngineToolWorkspace(context);
      requireProjectBuilderSession(workspace, context);
      const stored = await readiPolloWorkWorkspaceConfig(config, workspace.id);
      const parsed = projectWorkspaceConfigSchema.safeParse(stored.project);
      return {
        ok: true,
        workspaceId: workspace.id,
        source: parsed.success ? "saved" : "default",
        project: parsed.success ? parsed.data : defaultProjectConfig(workspace),
      };
    },
    [ENGINE_HOST_TOOL_NAMES.projectApply]: async (ctx, args, context) => {
      if (ctx.actor?.scope === "viewer") {
        throw new ApiError(403, "forbidden", "Viewer tokens cannot change a project configuration");
      }
      ensureWritable(config);
      const workspace = await resolveEngineToolWorkspace(context);
      requireProjectBuilderSession(workspace, context);
      const parsed = projectWorkspaceConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new ApiError(400, "invalid_project_config", "Project Builder produced an invalid project configuration", {
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        });
      }
      const projectEngineId = workspace.engineId?.trim() || DEFAULT_ENGINE_ID;
      const incompatibleAgent = parsed.data.agents.find((agent) => (
        agent.runtime.engineId !== null && agent.runtime.engineId !== projectEngineId
      ));
      if (incompatibleAgent) {
        throw new ApiError(
          409,
          "project_agent_engine_mismatch",
          `Agent '${incompatibleAgent.name}' must use the project's engine until cross-engine project sessions are supported`,
        );
      }
      const summary = typeof args.summary === "string" && args.summary.trim()
        ? args.summary.trim().slice(0, 240)
        : "Apply Project Builder changes";
      const approval = await ctx.approvals.requestApproval({
        workspaceId: workspace.id,
        action: "project.builder.apply",
        summary,
        paths: [],
        actor: ctx.actor ?? { type: "remote" },
      });
      if (!approval.allowed) {
        throw new ApiError(403, "write_denied", "Project Builder change was not approved", {
          requestId: approval.id,
          reason: approval.reason,
        });
      }
      const currentConfig = await readiPolloWorkWorkspaceConfig(config, workspace.id);
      const currentProject = projectWorkspaceConfigSchema.safeParse(currentConfig.project);
      const project = projectWorkspaceConfigSchema.parse({
        ...parsed.data,
        revision: (currentProject.success ? currentProject.data.revision : 0) + 1,
      });
      await writeiPolloWorkWorkspaceConfig(config, workspace.id, (current) => ({ ...current, project }));
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "project.builder.apply",
        target: "project",
        summary,
        timestamp: Date.now(),
      });
      return { ok: true, workspaceId: workspace.id, project, updatedAt: Date.now() };
    },
    [ENGINE_HOST_TOOL_NAMES.workspaceAppListTools]: async () => uiControlRequest("/execute", {
      method: "POST",
      body: { actionId: "workspace_app.list_tools", args: {} },
    }),
    [ENGINE_HOST_TOOL_NAMES.workspaceAppCallTool]: async (_ctx, args) => uiControlRequest("/execute", {
      method: "POST",
      body: {
        actionId: "workspace_app.call_tool",
        args: {
          name: typeof args.name === "string" ? args.name : "",
          arguments: isRecord(args.arguments) ? args.arguments : {},
        },
      },
    }),
    [ENGINE_HOST_TOOL_NAMES.browserOpenUrl]: async (_ctx, args) => executeUiControlAction(
      "browser.open_url",
      { url: typeof args.url === "string" ? args.url : "" },
    ),
    [ENGINE_HOST_TOOL_NAMES.browserSnapshot]: async (_ctx, args) => executeUiControlAction(
      "browser.snapshot",
      { tabId: typeof args.tabId === "string" ? args.tabId : "" },
    ),
    [ENGINE_HOST_TOOL_NAMES.browserAct]: async (ctx, args, context) => {
      if (ctx.actor?.scope === "viewer") {
        throw new ApiError(403, "forbidden", "Viewer tokens cannot act on external websites");
      }
      const actions = browserActionRecords(args.actions);
      const workspace = await resolveEngineToolWorkspace(context);
      const consequentialNames = consequentialBrowserControlNames(actions);
      const requester = browserRequesterLabel(context);
      if (consequentialNames.length > 0) {
        const summary = `${requester} requests browser action: ${consequentialNames.slice(0, 3).join(", ")}`.slice(0, 240);
        const approval = await ctx.approvals.requestApproval({
          workspaceId: workspace.id,
          action: "browser.external.consequential",
          summary,
          paths: [],
          actor: ctx.actor ?? { type: "remote" },
        });
        if (!approval.allowed) {
          throw new ApiError(403, "browser_action_denied", "Consequential browser action was not approved", {
            requestId: approval.id,
            reason: approval.reason,
          });
        }
      }
      const result = await executeUiControlAction("browser.act", {
        tabId: typeof args.tabId === "string" ? args.tabId : "",
        snapshotId: typeof args.snapshotId === "string" ? args.snapshotId : "",
        actions,
        workspaceRoot: workspace.path,
      });
      if (isRecord(result) && result.ok !== false) {
        await recordAudit(workspace.path, {
          id: shortId(),
          workspaceId: workspace.id,
          actor: ctx.actor ?? { type: "remote" },
          action: "browser.external.act",
          target: typeof args.tabId === "string" ? args.tabId : "browser",
          summary: `${requester}: ${actions.length} browser action${actions.length === 1 ? "" : "s"}`,
          timestamp: Date.now(),
        });
      }
      return result;
    },
    [ENGINE_HOST_TOOL_NAMES.browserSetProxy]: async (ctx, args, context) => {
      if (ctx.actor?.scope === "viewer") {
        throw new ApiError(403, "forbidden", "Viewer tokens cannot change the browser proxy");
      }
      const workspace = await resolveEngineToolWorkspace(context);
      const result = await executeUiControlAction("browser.set_proxy", {
        proxy: typeof args.proxy === "string" ? args.proxy : "",
      });
      if (isRecord(result) && result.ok !== false) {
        await recordAudit(workspace.path, {
          id: shortId(),
          workspaceId: workspace.id,
          actor: ctx.actor ?? { type: "remote" },
          action: "browser.proxy.set",
          target: "browser",
          summary: typeof args.proxy === "string" && args.proxy.trim() ? "Set browser proxy" : "Clear browser proxy",
          timestamp: Date.now(),
        });
      }
      return result;
    },
  } satisfies Record<EngineHostToolName, EngineHostToolHandler>;

  const handleEngineHostMcpRequest = async (ctx: RequestContext): Promise<Response> => {
    const workspaceId = ctx.url.searchParams.get("workspaceId")?.trim() ?? "";
    if (!workspaceId) {
      throw new ApiError(400, "engine_host_workspace_required", "The engine host MCP requires a workspaceId");
    }
    await resolveWorkspace(config, workspaceId);
    const server = new McpServer(
      { name: "ipollowork-host", version: serverVersion },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: ENGINE_HOST_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const descriptor = engineHostTool(request.params.name);
      if (!descriptor) {
        throw new ApiError(
          404,
          "engine_host_tool_not_found",
          `Engine host tool is not registered: ${request.params.name || "missing"}`,
        );
      }
      const args = isRecord(request.params.arguments) ? request.params.arguments : {};
      const value = await engineHostToolHandlers[descriptor.name](ctx, args, { workspaceId });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(value ?? null),
        }],
        ...(isRecord(value) ? { structuredContent: value } : {}),
      };
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(ctx.request);
  };

  const healthResponse = () => jsonResponse({
    ok: true,
    version: serverVersion,
    opencodeVersion,
    uptimeMs: Date.now() - config.startedAt,
  });

  addRoute(routes, "GET", "/health", "none", async () => healthResponse());

  addRoute(routes, "GET", "/w/:id/health", "none", async () => healthResponse());

  // Dev log sink: append browser console + error events to a file that an
  // operator (or an AI driver) can tail. Unauth on purpose because this is
  // scoped to the dev host and needs to work before clients finish wiring
  // tokens; it is also a no-op when IPOLLOWORK_DEV_LOG_FILE is unset.
  addRoute(routes, "POST", "/dev/log", "none", async (ctx) => {
    const target = resolveDevLogPath();
    if (!target) {
      return jsonResponse({ ok: false, reason: "dev_log_disabled" }, 404);
    }
    let payload: unknown = null;
    try {
      payload = await ctx.request.json();
    } catch {
      return jsonResponse({ ok: false, reason: "invalid_json" }, 400);
    }
    const entries = Array.isArray(payload) ? payload : [payload];
    try {
      await mkdir(dirname(target), { recursive: true });
      const lines = entries
        .map((entry) => {
          const at = new Date().toISOString();
          try {
            return JSON.stringify(isRecord(entry) ? { at, ...entry } : { at, raw: String(entry) });
          } catch {
            return JSON.stringify({ at, raw: String(entry) });
          }
        })
        .join("\n");
      await appendFile(target, `${lines}\n`, "utf8");
    } catch (error) {
      return jsonResponse({ ok: false, reason: error instanceof Error ? error.message : String(error) }, 500);
    }
    return jsonResponse({ ok: true, count: entries.length });
  });

  addRoute(routes, "GET", "/dev/log", "none", async () => {
    // Probe response: always 200 so the client's capability probe doesn't
    // log a noisy "Failed to load resource: 404" in the browser console
    // when the sink is simply disabled. Clients should key on `ok` + `reason`
    // in the body, not on HTTP status.
    const target = resolveDevLogPath();
    if (!target) {
      return jsonResponse({ ok: false, reason: "dev_log_disabled" });
    }
    return jsonResponse({ ok: true, path: target });
  });

  addRoute(routes, "GET", "/ui", "none", async () => {
    if (!resolveToyUiEnabled()) {
      throw new ApiError(404, "ui_disabled", "Toy UI is disabled");
    }
    return htmlResponse(TOY_UI_HTML);
  });

  addRoute(routes, "GET", "/w/:id/ui", "none", async () => {
    if (!resolveToyUiEnabled()) {
      throw new ApiError(404, "ui_disabled", "Toy UI is disabled");
    }
    return htmlResponse(TOY_UI_HTML);
  });

  addRoute(routes, "GET", "/ui/assets/toy.css", "none", async () => {
    if (!resolveToyUiEnabled()) {
      throw new ApiError(404, "ui_disabled", "Toy UI is disabled");
    }
    return cssResponse(TOY_UI_CSS);
  });

  addRoute(routes, "GET", "/ui/assets/toy.js", "none", async () => {
    if (!resolveToyUiEnabled()) {
      throw new ApiError(404, "ui_disabled", "Toy UI is disabled");
    }
    return jsResponse(TOY_UI_JS);
  });

  addRoute(routes, "GET", "/ui/assets/ipollowork-mark.svg", "none", async () => {
    if (!resolveToyUiEnabled()) {
      throw new ApiError(404, "ui_disabled", "Toy UI is disabled");
    }
    return svgResponse(TOY_UI_FAVICON_SVG);
  });

  addRoute(routes, "GET", "/w/:id/status", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({
      ok: true,
      version: serverVersion,
      opencodeVersion,
      uptimeMs: Date.now() - config.startedAt,
      readOnly: config.readOnly,
      approval: config.approval,
      corsOrigins: config.corsOrigins,
      workspaceCount: 1,
      activeWorkspaceId: workspace.id,
      workspace: serializeWorkspace(workspace),
      authorizedRoots: config.authorizedRoots,
      server: {
        host: config.host,
        port: config.port,
        configPath: config.configPath ?? null,
      },
      tokenSource: {
        client: config.tokenSource,
        host: config.hostTokenSource,
      },
    });
  });

  addRoute(routes, "GET", "/w/:id/capabilities", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse(buildCapabilities(config, workspace));
  });

  addRoute(routes, "GET", "/w/:id/workspaces", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({ items: [serializeWorkspace(workspace)], activeId: workspace.id });
  });

  addRoute(routes, "GET", "/status", "client", async () => {
    const active = config.workspaces[0];
    return jsonResponse({
      ok: true,
      version: serverVersion,
      opencodeVersion,
      uptimeMs: Date.now() - config.startedAt,
      readOnly: config.readOnly,
      approval: config.approval,
      corsOrigins: config.corsOrigins,
      workspaceCount: config.workspaces.length,
      activeWorkspaceId: active?.id ?? null,
      workspace: active ? serializeWorkspace(active) : null,
      authorizedRoots: config.authorizedRoots,
      server: {
        host: config.host,
        port: config.port,
        configPath: config.configPath ?? null,
      },
      tokenSource: {
        client: config.tokenSource,
        host: config.hostTokenSource,
      },
    });
  });

  addRoute(routes, "GET", "/runtime/versions", "client", async () => {
    const snapshot = await fetchRuntimeControl("/runtime/versions");
    return jsonResponse(snapshot);
  });

  addRoute(routes, "POST", "/runtime/upgrade", "host", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const result = await fetchRuntimeControl("/runtime/upgrade", { method: "POST", body });
    return jsonResponse(result, 202);
  });

  addRoute(routes, "GET", "/w/:id/runtime/versions", "client", async () => {
    const snapshot = await fetchRuntimeControl("/runtime/versions");
    return jsonResponse(snapshot);
  });

  addRoute(routes, "POST", "/w/:id/runtime/upgrade", "host", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const result = await fetchRuntimeControl("/runtime/upgrade", { method: "POST", body });
    return jsonResponse(result, 202);
  });

  addRoute(routes, "GET", "/whoami", "client", async (ctx) => {
    return jsonResponse({ ok: true, actor: ctx.actor ?? null });
  });

  addRoute(routes, "GET", "/capabilities", "client", async () => {
    return jsonResponse(buildCapabilities(config));
  });

  addRoute(routes, "GET", "/experimental/connect/state", "client", async () => {
    return jsonResponse({ ok: true, schemaVersion: 1, ...(await getConnectSnapshot(config)) });
  });

  addRoute(routes, "PUT", "/experimental/connect/state", "host", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    if (typeof body.connectEnabled !== "boolean" || Object.keys(body).some((key) => key !== "connectEnabled")) {
      throw new ApiError(400, "invalid_payload", "connectEnabled must be a boolean");
    }
    await writeConnectState(config, { connectEnabled: body.connectEnabled });
    return jsonResponse({ ok: true, schemaVersion: 1, ...(await getConnectSnapshot(config)) });
  });

  addRoute(routes, "GET", "/experimental/extensions/actions", "client", async (ctx) => {
    const extensionId = ctx.url.searchParams.get("extensionId") ?? "";
    const directory = ctx.url.searchParams.get("directory") ?? "";
    const connectSnapshot = await getConnectSnapshot(config);
    return jsonResponse({
      ok: true,
      schemaVersion: 1,
      actions: await listExperimentalExtensionActions(config, extensionId, { directory }, connectSnapshot),
    });
  });

  addRoute(routes, "POST", "/experimental/extensions/call", "client", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    return jsonResponse(await callExtensionAction(ctx, body));
  });

  addRoute(routes, "GET", "/engine-tools", "client", async () => {
    return jsonResponse({ ok: true, schemaVersion: 1, tools: ENGINE_HOST_TOOLS });
  });

  // Codex Harness consumes the same server-owned extension and Workspace App
  // actions as OpenCode and DSH through a standard, stateless MCP transport.
  // Keeping dispatch here prevents engine-specific copies of plugin behavior.
  addRoute(routes, "POST", "/engine-tools/mcp", "client", handleEngineHostMcpRequest);
  addRoute(routes, "GET", "/engine-tools/mcp", "client", handleEngineHostMcpRequest);
  addRoute(routes, "DELETE", "/engine-tools/mcp", "client", handleEngineHostMcpRequest);

  addRoute(routes, "POST", "/workspace/:id/project-builder-sessions/:sessionId", "client", async (ctx) => {
    if (ctx.actor?.scope === "viewer") {
      throw new ApiError(403, "forbidden", "Viewer tokens cannot activate Project Builder");
    }
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = ctx.params.sessionId.trim();
    if (!sessionId) throw new ApiError(400, "invalid_session", "Project Builder session id is required");
    projectBuilderSessions.add(projectBuilderSessionKey(workspace.id, sessionId));
    while (projectBuilderSessions.size > 500) {
      const oldest = projectBuilderSessions.values().next();
      if (oldest.done) break;
      projectBuilderSessions.delete(oldest.value);
    }
    return jsonResponse({ ok: true, workspaceId: workspace.id, sessionId });
  });

  addRoute(routes, "POST", "/engine-tools/call", "client", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const args = isRecord(body.args) ? body.args : {};
    const context = isRecord(body.context) ? body.context : {};
    const descriptor = engineHostTool(name);
    if (!descriptor) {
      throw new ApiError(404, "engine_host_tool_not_found", `Engine host tool is not registered: ${name || "missing"}`);
    }
    return jsonResponse(await engineHostToolHandlers[descriptor.name](ctx, args, context));
  });

  addRoute(routes, "GET", "/experimental/google-workspace/status", "client", async () => {
    const connectSnapshot = await getConnectSnapshot(config);
    return jsonResponse(await googleWorkspaceStatus(config, googleWorkspaceStatusConnectExtra(connectSnapshot)));
  });

  addRoute(routes, "POST", "/experimental/google-workspace/connect/start", "client", async (ctx) => {
    if (ctx.actor?.scope === "viewer") throw new ApiError(403, "forbidden", "Viewer tokens cannot connect Google Workspace");
    const body = await readOptionalJsonBody(ctx.request);
    const featuresValue = body.features;
    const features = Array.isArray(featuresValue) ? featuresValue.filter((item): item is string => typeof item === "string") : [];
    return jsonResponse(await googleWorkspaceConnectFlows.start({ gmailRead: body.gmailRead === true, features }), 201);
  });

  addRoute(routes, "GET", "/experimental/google-workspace/connect/status/:flowId", "client", async (ctx) => {
    return jsonResponse(await googleWorkspaceConnectFlows.status(ctx.params.flowId));
  });

  addRoute(routes, "POST", "/experimental/google-workspace/disconnect", "client", async (ctx) => {
    if (ctx.actor?.scope === "viewer") throw new ApiError(403, "forbidden", "Viewer tokens cannot disconnect Google Workspace");
    const body = await readOptionalJsonBody(ctx.request);
    const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : null;
    return jsonResponse(await googleWorkspaceDisconnect(config, accountId));
  });

  addRoute(routes, "POST", "/experimental/google-workspace/active-account", "client", async (ctx) => {
    if (ctx.actor?.scope === "viewer") throw new ApiError(403, "forbidden", "Viewer tokens cannot update Google Workspace settings");
    const body = await readJsonBody(ctx.request);
    const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : "";
    if (!accountId) throw new ApiError(400, "invalid_payload", "accountId is required");
    return jsonResponse(await googleWorkspaceSetActiveAccount(config, accountId));
  });

  addRoute(routes, "POST", "/experimental/google-workspace/test", "client", async () => {
    return jsonResponse(await googleWorkspaceTestConnection(config));
  });

  addRoute(routes, "POST", "/experimental/google-workspace/smoke-test", "client", async () => {
    return jsonResponse(await googleWorkspaceRunScopeSmokeTest(config));
  });

  addRoute(routes, "GET", "/workspaces", "client", async () => {
    const active = config.workspaces[0] ?? null;
    const items = config.workspaces.map(serializeWorkspace);
    return jsonResponse({ items, workspaces: items, activeId: active?.id ?? null });
  });

  addRoute(routes, "GET", "/tokens", "host", async () => {
    const items = await tokens.list();
    return jsonResponse({ items });
  });

  addRoute(routes, "POST", "/tokens", "host", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const scopeRaw = typeof body.scope === "string" ? body.scope.trim() : "";
    const scope = scopeRaw === "owner" || scopeRaw === "collaborator" || scopeRaw === "viewer" ? scopeRaw : null;
    if (!scope) {
      throw new ApiError(400, "invalid_scope", "Token scope must be owner, collaborator, or viewer");
    }
    const label = typeof body.label === "string" ? body.label.trim() : undefined;
    const issued = await tokens.create(scope, { label });
    return jsonResponse(issued, 201);
  });

  addRoute(routes, "DELETE", "/tokens/:id", "host", async (ctx) => {
    ensureWritable(config);
    const ok = await tokens.revoke(ctx.params.id);
    if (!ok) {
      throw new ApiError(404, "token_not_found", "Token not found");
    }
    return jsonResponse({ ok: true });
  });

  function rethrowEnvStoreReadError(error: unknown): never {
    if (error instanceof EnvStoreReadError) {
      throw new ApiError(
        409,
        error.code,
        "Environment variable store is invalid. Fix or remove the local env file before editing.",
      );
    }
    throw error;
  }

  // User-level env vars (see apps/app/pr/environment-variables.md). All routes
  // require the desktop host token (not owner bearer tokens). List callers can
  // request metadata-only results so renderer settings panes do not receive
  // every raw secret value up front. Reload semantics are driven from the UI
  // after a write; this surface is user-scoped, not workspace-scoped, so no audit.
  addRoute(routes, "GET", "/env", "host-token", async (ctx) => {
    const includeValues = parseOptionalBoolean(ctx.url.searchParams.get("includeValues"), "includeValues") ?? true;
    const items = await env.list().catch(rethrowEnvStoreReadError);
    return jsonResponse({
      items: items.map((item) => ({
        key: item.key,
        updatedAt: item.updatedAt,
        hasValue: item.value.length > 0,
        ...(includeValues ? { value: item.value } : {}),
      })),
    });
  });

  addRoute(routes, "GET", "/env/keys", "host-token", async () => {
    const items = await env.list().catch(rethrowEnvStoreReadError);
    return jsonResponse({
      keys: items.map((item) => item.key),
      oauthProviderIds: listOpencodeOAuthProviderIds({ managedOnly: true }),
    });
  });

  function envRuntimeKeyFromUrl(url: URL): string {
    return url.searchParams.get("runtimeKey")?.trim() || "default";
  }

  addRoute(routes, "GET", "/env/status", "host-token", async (ctx) => {
    const runtimeKey = envRuntimeKeyFromUrl(ctx.url);
    return jsonResponse({ runtimeKey, pendingChanges: envPendingChangesByRuntime.get(runtimeKey) === true });
  });

  addRoute(routes, "PUT", "/env/status", "host-token", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const runtimeKey = typeof body.runtimeKey === "string" && body.runtimeKey.trim()
      ? body.runtimeKey.trim()
      : "default";
    const pendingChanges = body.pendingChanges === true;
    if (pendingChanges) {
      envPendingChangesByRuntime.set(runtimeKey, true);
    } else {
      envPendingChangesByRuntime.delete(runtimeKey);
    }
    return jsonResponse({ runtimeKey, pendingChanges });
  });

  addRoute(routes, "GET", "/env/:key", "host-token", async (ctx) => {
    const key = ctx.params.key;
    if (!isValidEnvKey(key)) {
      throw new ApiError(400, "invalid_env_key", "Invalid environment variable name");
    }
    const item = (await env.list().catch(rethrowEnvStoreReadError)).find((entry) => entry.key === key);
    if (!item) {
      throw new ApiError(404, "env_not_found", "Environment variable not found");
    }
    return jsonResponse({
      item: {
        key: item.key,
        updatedAt: item.updatedAt,
        hasValue: item.value.length > 0,
        value: item.value,
      },
    });
  });

  addRoute(routes, "PUT", "/env", "host-token", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const rawEntries = Array.isArray(body.entries)
      ? body.entries
      : [{ key: body.key, value: body.value }];
    const entries: Array<{ key: string; value: string }> = [];
    for (const raw of rawEntries) {
      if (!isRecord(raw)) {
        throw new ApiError(400, "invalid_entry", "Each entry must be an object");
      }
      const key = typeof raw.key === "string" ? raw.key.trim() : "";
      const value = typeof raw.value === "string" ? raw.value : "";
      if (!isValidEnvKey(key)) {
        throw new ApiError(400, "invalid_env_key", "Invalid environment variable name");
      }
      entries.push({ key, value });
    }
    if (entries.length === 0) {
      throw new ApiError(400, "no_entries", "No entries provided");
    }
    try {
      await env.upsertMany(entries);
    } catch (error) {
      if (error instanceof EnvStoreReadError) {
        rethrowEnvStoreReadError(error);
      }
      if (error instanceof InvalidEnvKeyError) {
        throw new ApiError(
          400,
          error.code,
          error.code === "reserved_env_key"
            ? "Environment variable name is reserved for iPolloWork internals"
            : "Invalid environment variable name",
        );
      }
      throw error;
    }
    return jsonResponse({ ok: true, count: entries.length });
  });

  addRoute(routes, "DELETE", "/env/:key", "host-token", async (ctx) => {
    ensureWritable(config);
    const key = ctx.params.key;
    if (!isValidEnvKey(key)) {
      throw new ApiError(400, "invalid_env_key", "Invalid environment variable name");
    }
    const removed = await env.delete(key).catch(rethrowEnvStoreReadError);
    if (!removed) {
      throw new ApiError(404, "env_not_found", "Environment variable not found");
    }
    return jsonResponse({ ok: true });
  });

  addRoute(routes, "GET", "/authorization-services", "host-token", async () => {
    return jsonResponse({ items: await listAuthorizationServices(config) });
  });

  addRoute(routes, "PUT", "/authorization-services/:serviceId/credentials", "host-token", async (ctx) => {
    ensureWritable(config);
    const serviceId = ctx.params.serviceId;
    if (!isAuthorizationServiceId(serviceId)) {
      throw new ApiError(404, "authorization_service_not_found", "Authorization service not found");
    }
    const body = await readJsonBody(ctx.request);
    try {
      return jsonResponse({ status: await saveAuthorizationService(config, serviceId, body.values) });
    } catch (error) {
      throw new ApiError(400, "authorization_values_invalid", error instanceof Error ? error.message : "Authorization values are invalid");
    }
  });

  addRoute(routes, "POST", "/authorization-services/:serviceId/test", "host-token", async (ctx) => {
    const serviceId = ctx.params.serviceId;
    if (!isAuthorizationServiceId(serviceId)) {
      throw new ApiError(404, "authorization_service_not_found", "Authorization service not found");
    }
    const result = await testAuthorizationService(config, serviceId);
    return jsonResponse(result);
  });

  addRoute(routes, "POST", "/voice/realtime/session", "host", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    return jsonResponse(await createOpenAiRealtimeVoiceSession(env, body));
  });
}
