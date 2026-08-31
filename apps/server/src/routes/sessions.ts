import type { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { CODEX_HARNESS_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";
import {
  CodexHarnessUnavailableError,
  type CodexHarnessRuntimePool,
} from "../codex-harness-runtime.js";
import {
  listCodexHarnessSessions,
  readCodexHarnessMessages,
  readCodexHarnessSession,
  readCodexHarnessSnapshot,
} from "../codex-harness-session-read-model.js";
import {
  DeepSeekHarnessRpcError,
  type DeepSeekHarnessRuntimePool,
  DeepSeekHarnessUnavailableError,
} from "../deepseek-harness-runtime.js";
import {
  listDeepSeekHarnessSessions,
  readDeepSeekHarnessMessages,
  readDeepSeekHarnessSession,
  readDeepSeekHarnessSnapshot,
} from "../deepseek-harness-session-read-model.js";
import { ApiError } from "../errors.js";
import { StdioJsonRpcError } from "../stdio-json-rpc-runtime.js";
import { buildSession, buildSessionList, buildSessionMessages, buildSessionSnapshot, buildSessionStatuses } from "../session-read-model.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import type { WorkspaceSessionRuntime } from "../workspace-session-runtime.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;
type ParseOptionalBoolean = (value: string | null, name: string) => boolean | undefined;
type ParseOptionalPositiveInteger = (value: string | null, name: string) => number | undefined;
type ParseOptionalNonNegativeInteger = (value: string | null, name: string) => number | undefined;
type WorkspaceOpencodeClient = ReturnType<typeof createOpencodeClient>;
type OpencodeClientResult<T, E> =
  | { data: T | undefined; error: undefined; response: Response }
  | { data: undefined; error: E; response: Response };
type UnwrapOpencodeResult = <T, E>(result: OpencodeClientResult<T, E>, path: string) => NonNullable<T>;

interface RegisterSessionRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  parseOptionalBoolean: ParseOptionalBoolean;
  parseOptionalPositiveInteger: ParseOptionalPositiveInteger;
  parseOptionalNonNegativeInteger: ParseOptionalNonNegativeInteger;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  createWorkspaceOpencodeClient: (config: ServerConfig, workspace: WorkspaceInfo) => WorkspaceOpencodeClient;
  unwrapOpencodeResult: UnwrapOpencodeResult;
  deepseekHarness: DeepSeekHarnessRuntimePool;
  codexHarness: CodexHarnessRuntimePool;
  sessionRuntime: WorkspaceSessionRuntime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(body: Record<string, unknown>, key: string, maxLength: number): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_payload", `${key} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new ApiError(400, "invalid_payload", `${key} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function sessionModelInput(body: Record<string, unknown>) {
  let model: { providerID: string; modelID: string } | undefined;
  if (body.model !== undefined) {
    if (!isRecord(body.model)) {
      throw new ApiError(400, "invalid_payload", "model must be an object");
    }
    const providerID = optionalString(body.model, "providerID", 200);
    const modelID = optionalString(body.model, "modelID", 200);
    if (!providerID || !modelID) {
      throw new ApiError(400, "invalid_payload", "model.providerID and model.modelID are required");
    }
    model = { providerID, modelID };
  }
  return model;
}

function sessionPromptInput(body: Record<string, unknown>) {
  if (typeof body.text !== "string" || !body.text.trim()) {
    throw new ApiError(400, "invalid_payload", "text is required");
  }
  if (body.text.length > 1_000_000) {
    throw new ApiError(400, "invalid_payload", "text must be at most 1000000 characters");
  }
  return {
    text: body.text,
    model: sessionModelInput(body),
    mode: optionalString(body, "mode", 200),
    reasoningEffort: optionalString(body, "reasoningEffort", 100),
    clientTimeZone: optionalString(body, "clientTimeZone", 100),
  };
}

export function registerSessionRoutes(options: RegisterSessionRoutesOptions): void {
  const {
    routes,
    config,
    jsonResponse,
    readJsonBody,
    parseOptionalBoolean,
    parseOptionalPositiveInteger,
    parseOptionalNonNegativeInteger,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    createWorkspaceOpencodeClient,
    unwrapOpencodeResult,
    deepseekHarness,
    codexHarness,
    sessionRuntime,
  } = options;

  function remapSessionReadError(error: unknown): never {
    if (error instanceof DeepSeekHarnessUnavailableError) {
      throw new ApiError(503, error.code, error.message);
    }
    if (error instanceof DeepSeekHarnessRpcError) {
      const status = error.code === "not-found" || error.code === "session-not-found" ? 404 : 502;
      throw new ApiError(status, `deepseek_harness_${error.code}`, error.message, error.details);
    }
    if (error instanceof CodexHarnessUnavailableError) {
      throw new ApiError(503, error.code, error.message);
    }
    if (error instanceof StdioJsonRpcError) {
      const status = error.code === -32602 ? 400 : error.code === -32601 ? 501 : 502;
      throw new ApiError(status, "codex_harness_rpc_failed", error.message, error.data);
    }
    if (error instanceof ApiError && error.code === "opencode_request_failed") {
      const details = error.details;
      const upstreamStatus =
        isRecord(details) && "status" in details ? Number(details.status) : NaN;
      if (upstreamStatus === 400) {
        throw new ApiError(400, "invalid_query", "OpenCode rejected the session read request", details);
      }
      if (upstreamStatus === 404) {
        throw new ApiError(404, "session_not_found", "Session not found", details);
      }
    }
    throw error;
  }

  async function listWorkspaceSessions(
    workspace: WorkspaceInfo,
    input: { roots?: boolean; start?: number; search?: string; limit?: number },
  ) {
    try {
      if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
        return await listDeepSeekHarnessSessions(deepseekHarness.forWorkspace(workspace), workspace, input);
      }
      if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
        return await listCodexHarnessSessions(codexHarness.forWorkspace(workspace), workspace, input);
      }
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      const [sessionResult, statuses] = await Promise.all([
        opencode.session.list({
          roots: input.roots,
          start: input.start,
          search: input.search,
          limit: input.limit,
        }),
        opencode.session.status().then(
          (result) => {
            try {
              return buildSessionStatuses(unwrapOpencodeResult(result, "/session/status"));
            } catch {
              return null;
            }
          },
          () => null,
        ),
      ]);
      const sessions = buildSessionList(unwrapOpencodeResult(sessionResult, "/session"));
      if (!statuses) return sessions;
      return sessions.map((session) => ({
        ...session,
        status: statuses[session.id] ?? { type: "idle" },
      }));
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  async function readWorkspaceSession(workspace: WorkspaceInfo, sessionId: string) {
    try {
      if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
        return await readDeepSeekHarnessSession(deepseekHarness.forWorkspace(workspace), workspace, sessionId);
      }
      if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
        return await readCodexHarnessSession(codexHarness.forWorkspace(workspace), sessionId);
      }
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      return buildSession(
        unwrapOpencodeResult(
          await opencode.session.get({ sessionID: sessionId }),
          `/session/${encodeURIComponent(sessionId)}`,
        ),
      );
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  async function readWorkspaceSessionMessages(
    workspace: WorkspaceInfo,
    sessionId: string,
    input: { limit?: number },
  ) {
    try {
      if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
        return await readDeepSeekHarnessMessages(
          deepseekHarness.forWorkspace(workspace),
          workspace,
          sessionId,
          input.limit,
        );
      }
      if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
        return await readCodexHarnessMessages(codexHarness.forWorkspace(workspace), sessionId, input.limit);
      }
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      return buildSessionMessages(
        unwrapOpencodeResult(
          await opencode.session.messages({ sessionID: sessionId, limit: input.limit }),
          `/session/${encodeURIComponent(sessionId)}/message`,
        ),
      );
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  async function readWorkspaceSessionSnapshot(
    workspace: WorkspaceInfo,
    sessionId: string,
    input: { limit?: number },
  ) {
    try {
      if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
        return await readDeepSeekHarnessSnapshot(deepseekHarness.forWorkspace(workspace), workspace, sessionId, input.limit);
      }
      if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
        return await readCodexHarnessSnapshot(codexHarness.forWorkspace(workspace), sessionId, input.limit);
      }
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      const [session, messages, todos, statuses] = await Promise.all([
        opencode.session
          .get({ sessionID: sessionId })
          .then((result) => unwrapOpencodeResult(result, `/session/${encodeURIComponent(sessionId)}`)),
        opencode.session
          .messages({ sessionID: sessionId, limit: input.limit })
          .then((result) => unwrapOpencodeResult(result, `/session/${encodeURIComponent(sessionId)}/message`)),
        opencode.session
          .todo({ sessionID: sessionId })
          .then((result) => unwrapOpencodeResult(result, `/session/${encodeURIComponent(sessionId)}/todo`)),
        opencode.session.status().then((result) => unwrapOpencodeResult(result, "/session/status")),
      ]);
      return buildSessionSnapshot({ session, messages, todos, statuses });
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  addRoute(routes, "POST", "/workspace/:id/sessions", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    let item;
    try {
      item = await sessionRuntime.create(
        workspace,
        optionalString(body, "title", 500),
        sessionModelInput(body),
      );
    } catch (error) {
      remapSessionReadError(error);
    }
    return jsonResponse({ item }, 201);
  });

  addRoute(routes, "GET", "/workspace/:id/sessions", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const items = await listWorkspaceSessions(workspace, {
      roots: parseOptionalBoolean(ctx.url.searchParams.get("roots"), "roots"),
      start: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("start"), "start"),
      search: ctx.url.searchParams.get("search")?.trim() || undefined,
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    });
    return jsonResponse({ items });
  });

  addRoute(routes, "GET", "/workspace/:id/sessions/:sessionId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    const item = await readWorkspaceSession(workspace, sessionId);
    return jsonResponse({ item });
  });

  addRoute(routes, "GET", "/workspace/:id/sessions/:sessionId/messages", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    const items = await readWorkspaceSessionMessages(workspace, sessionId, {
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    });
    return jsonResponse({ items });
  });

  addRoute(routes, "GET", "/workspace/:id/sessions/:sessionId/snapshot", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    const item = await readWorkspaceSessionSnapshot(workspace, sessionId, {
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    });
    return jsonResponse({ item });
  });

  addRoute(routes, "POST", "/workspace/:id/sessions/:sessionId/prompt", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    let effectiveSessionId;
    try {
      effectiveSessionId = await sessionRuntime.prompt(
        workspace,
        sessionId,
        sessionPromptInput(await readJsonBody(ctx.request)),
      );
    } catch (error) {
      remapSessionReadError(error);
    }
    return jsonResponse({ ok: true, accepted: true, sessionId: effectiveSessionId }, 202);
  });

  addRoute(routes, "DELETE", "/workspace/:id/sessions/:sessionId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");

    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }

    await sessionRuntime.delete(workspace, sessionId);
    return jsonResponse({ ok: true });
  });
}
