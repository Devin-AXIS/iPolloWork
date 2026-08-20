import {
  projectSessionExecutionFinishSchema,
  projectSessionExecutionStartSchema,
  workBoardConfigValueSchema,
  workItemCreateSchema,
  workItemUpdateSchema,
} from "@ipollowork/types/work-items";
import {
  createDefaultProjectWorkspaceConfig,
  projectWorkspaceConfigSchema,
} from "@ipollowork/types/project-workspace";
import {
  DEEPSEEK_HARNESS_ENGINE_ID,
  DEFAULT_ENGINE_ID,
} from "@ipollowork/types/workspace";

import { recordAudit } from "../audit.js";
import { ApiError } from "../errors.js";
import { readiPolloWorkWorkspaceConfig } from "../ipollowork-workspace-config-store.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { shortId } from "../utils.js";
import {
  WorkItemConflictError,
  createWorkItem,
  deleteWorkItem,
  finishProjectSessionExecution,
  listWorkItems,
  readWorkBoardConfig,
  readProjectSessionWorkItem,
  startProjectSessionExecution,
  updateWorkItem,
  writeWorkBoardConfig,
} from "../work-items.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

type RegisterWorkItemRoutesOptions = {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
};

function parseOptionalInteger(value: string | null, name: string): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ApiError(400, "invalid_query", `${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseStatus(value: string | null): string | undefined {
  const status = value?.trim();
  if (!status) return undefined;
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(status)) {
    throw new ApiError(400, "invalid_query", "status is invalid");
  }
  return status;
}

function schemaError(message: string, issues: Array<{ path: PropertyKey[]; message: string }>): ApiError {
  return new ApiError(400, "invalid_payload", message, {
    issues: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

async function withConflictHandling<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkItemConflictError) {
      throw new ApiError(409, "work_item_conflict", error.message);
    }
    throw error;
  }
}

export function registerWorkItemRoutes(options: RegisterWorkItemRoutesOptions): void {
  const {
    routes,
    config,
    jsonResponse,
    readJsonBody,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
  } = options;

  addRoute(routes, "GET", "/work-items", "client", async (ctx) => {
    const requested = [
      ...ctx.url.searchParams.getAll("workspaceId"),
      ...(ctx.url.searchParams.get("workspaceIds")?.split(",") ?? []),
    ].map((id) => id.trim()).filter(Boolean);
    const workspaceIds = Array.from(new Set(requested));
    if (!workspaceIds.length) {
      throw new ApiError(400, "invalid_query", "At least one workspaceId is required");
    }
    if (workspaceIds.length > 50) {
      throw new ApiError(400, "invalid_query", "At most 50 workspaces can be queried at once");
    }
    await Promise.all(workspaceIds.map((id) => resolveWorkspace(config, id)));
    const from = parseOptionalInteger(ctx.url.searchParams.get("from"), "from");
    const to = parseOptionalInteger(ctx.url.searchParams.get("to"), "to");
    if (from !== undefined && to !== undefined && from > to) {
      throw new ApiError(400, "invalid_query", "from must be earlier than or equal to to");
    }
    return jsonResponse(await listWorkItems(config, {
      workspaceIds,
      from,
      to,
      status: parseStatus(ctx.url.searchParams.get("status")),
      cursor: ctx.url.searchParams.get("cursor")?.trim() || undefined,
      limit: parseOptionalInteger(ctx.url.searchParams.get("limit"), "limit"),
    }));
  });

  addRoute(routes, "POST", "/workspace/:id/work-items", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const parsed = workItemCreateSchema.safeParse(body);
    if (!parsed.success) throw schemaError("Work item is invalid", parsed.error.issues);
    const item = await createWorkItem(config, workspace.id, parsed.data);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "work_item.create",
      target: item.id,
      summary: item.title,
      timestamp: Date.now(),
    });
    return jsonResponse(item, 201);
  });

  addRoute(routes, "PUT", "/workspace/:id/project-sessions/:sessionId/execution", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = ctx.params.sessionId.trim();
    if (!sessionId) throw new ApiError(400, "invalid_session", "Project session id is required");
    const parsed = projectSessionExecutionStartSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw schemaError("Project session execution is invalid", parsed.error.issues);

    const projectEngineId = workspace.engineId?.trim() || DEFAULT_ENGINE_ID;
    const existing = await readProjectSessionWorkItem(config, workspace.id, sessionId);
    if (existing?.execution) {
      if (
        existing.execution.runtime.engineId !== projectEngineId
        || parsed.data.runtime.engineId !== existing.execution.runtime.engineId
      ) {
        throw new ApiError(
          409,
          "project_session_engine_changed",
          "This task is bound to its original engine. Start a new conversation to use the project's current engine.",
        );
      }
      return jsonResponse(await startProjectSessionExecution(
        config,
        workspace.id,
        parsed.data.title,
        existing.execution,
      ));
    }

    const stored = await readiPolloWorkWorkspaceConfig(config, workspace.id);
    const configured = projectWorkspaceConfigSchema.safeParse(stored.project);
    const project = configured.success
      ? configured.data
      : createDefaultProjectWorkspaceConfig({ engineId: workspace.engineId });
    const agentId = parsed.data.agentId ?? project.orchestration.entryAgentId;
    const agent = project.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new ApiError(409, "project_agent_missing", "The selected project Agent no longer exists");

    const agentEngineId = agent.runtime.engineId?.trim() || projectEngineId;
    if (agentEngineId !== projectEngineId || parsed.data.runtime.engineId !== projectEngineId) {
      throw new ApiError(
        409,
        "project_agent_engine_mismatch",
        "Project tasks must use the project's engine. Change the project engine before starting a new task.",
      );
    }
    const runtimeMode = agent.runtime.mode === "auto" || agentEngineId === DEEPSEEK_HARNESS_ENGINE_ID
      ? parsed.data.runtime.mode
      : agent.runtime.mode === "plan"
        ? "plan"
        : "build";
    const now = Date.now();
    const item = await startProjectSessionExecution(config, workspace.id, parsed.data.title, {
      sessionId,
      projectRevision: project.revision,
      projectGoal: project.goal,
      agent,
      runtime: {
        engineId: projectEngineId,
        model: agent.runtime.model ?? parsed.data.runtime.model,
        mode: runtimeMode,
        modelVariant: agent.runtime.model ? agent.runtime.modelVariant : parsed.data.runtime.modelVariant,
      },
      boundAt: now,
    });
    return jsonResponse(item);
  });

  addRoute(routes, "PATCH", "/workspace/:id/project-sessions/:sessionId/execution", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = ctx.params.sessionId.trim();
    if (!sessionId) throw new ApiError(400, "invalid_session", "Project session id is required");
    const parsed = projectSessionExecutionFinishSchema.safeParse(await readJsonBody(ctx.request));
    if (!parsed.success) throw schemaError("Project session result is invalid", parsed.error.issues);
    const item = await finishProjectSessionExecution(config, workspace.id, sessionId, parsed.data);
    if (!item) throw new ApiError(404, "project_session_execution_not_found", "Project session execution was not found");
    return jsonResponse(item);
  });

  addRoute(routes, "PATCH", "/workspace/:id/work-items/:workItemId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const parsed = workItemUpdateSchema.safeParse(body);
    if (!parsed.success) throw schemaError("Work item update is invalid", parsed.error.issues);
    const item = await withConflictHandling(() => updateWorkItem(
      config,
      workspace.id,
      ctx.params.workItemId,
      parsed.data,
    ));
    if (!item) throw new ApiError(404, "work_item_not_found", "Work item not found");
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "work_item.update",
      target: item.id,
      summary: item.title,
      timestamp: Date.now(),
    });
    return jsonResponse(item);
  });

  addRoute(routes, "DELETE", "/workspace/:id/work-items/:workItemId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const version = parseOptionalInteger(ctx.url.searchParams.get("version"), "version");
    if (version === undefined) throw new ApiError(400, "invalid_query", "version is required");
    const deleted = await withConflictHandling(() => deleteWorkItem(
      config,
      workspace.id,
      ctx.params.workItemId,
      version,
    ));
    if (!deleted) throw new ApiError(404, "work_item_not_found", "Work item not found");
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "work_item.delete",
      target: ctx.params.workItemId,
      summary: "Deleted work item",
      timestamp: Date.now(),
    });
    return jsonResponse({ ok: true });
  });

  addRoute(routes, "GET", "/workspace/:id/work-board", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse(await readWorkBoardConfig(config, workspace.id));
  });

  addRoute(routes, "PATCH", "/workspace/:id/work-board", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const expectedVersion = body.expectedVersion;
    const value = workBoardConfigValueSchema.safeParse({
      columns: body.columns,
      fields: body.fields,
    });
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 0) {
      throw new ApiError(400, "invalid_payload", "expectedVersion must be a non-negative integer");
    }
    if (!value.success) throw schemaError("Board configuration is invalid", value.error.issues);
    const board = await withConflictHandling(() => writeWorkBoardConfig(
      config,
      workspace.id,
      value.data,
      Number(expectedVersion),
    ));
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "work_board.update",
      target: "work-board",
      summary: "Updated project board configuration",
      timestamp: Date.now(),
    });
    return jsonResponse(board);
  });
}
