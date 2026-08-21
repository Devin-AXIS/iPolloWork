import type { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { CODEX_HARNESS_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";
import {
  codexHarnessRuntimeProviderId,
  CodexHarnessUnavailableError,
  type CodexHarnessRuntimePool,
} from "../codex-harness-runtime.js";
import {
  listCodexHarnessSessions,
  mapCodexThread,
  readCodexHarnessMessages,
  readCodexHarnessSession,
  readCodexHarnessSnapshot,
  type CodexThread,
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
import { buildSession, buildSessionList, buildSessionMessages, buildSessionSnapshot } from "../session-read-model.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
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
  } = options;
  const freshCodexThreadLimit = 500;
  const freshCodexThreads = new Map<string, { providerID: string; modelID: string }>();
  const codexThreadKey = (workspaceId: string, threadId: string) => `${workspaceId}\u0000${threadId}`;
  const rememberFreshCodexThread = (
    key: string,
    model: { providerID: string; modelID: string },
  ) => {
    freshCodexThreads.set(key, model);
    while (freshCodexThreads.size > freshCodexThreadLimit) {
      const oldest = freshCodexThreads.keys().next().value;
      if (typeof oldest !== "string") break;
      freshCodexThreads.delete(oldest);
    }
  };

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
      return buildSessionList(
        unwrapOpencodeResult(
          await opencode.session.list({
            roots: input.roots,
            start: input.start,
            search: input.search,
            limit: input.limit,
          }),
          "/session",
        ),
      );
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

  async function createWorkspaceSession(
    workspace: WorkspaceInfo,
    title?: string,
    model?: { providerID: string; modelID: string },
  ) {
    try {
      if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
        const runtime = deepseekHarness.forWorkspace(workspace);
        const result = await runtime.call<{ sessionId: string; agentPreset?: string }>("session.create", {
          cwd: workspace.path,
        });
        const sessionId = result.sessionId?.trim();
        if (!sessionId) {
          throw new ApiError(502, "deepseek_harness_invalid_response", "DeepSeek Harness returned an invalid session");
        }
        if (title) await runtime.call("session.rename", { sessionId, title });
        const now = Date.now();
        return {
          id: sessionId,
          title: title || "New conversation",
          slug: sessionId,
          directory: workspace.path,
          time: { created: now, updated: now },
          dsh: {
            running: false,
            blank: true,
            ...(result.agentPreset ? { agentPreset: result.agentPreset } : {}),
          },
        };
      }
      if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
        const runtime = codexHarness.forWorkspace(workspace);
        const result = await runtime.startThread<{
          thread?: CodexThread;
          model?: string;
          modelProvider?: string;
        }>({
          cwd: workspace.path,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          ...(model ? {
            modelProvider: codexHarnessRuntimeProviderId(model.providerID),
            model: model.modelID,
            allowProviderModelFallback: false,
          } : {}),
        });
        if (!result.thread?.id) {
          throw new ApiError(502, "codex_harness_invalid_response", "Codex Harness returned an invalid thread");
        }
        rememberFreshCodexThread(codexThreadKey(workspace.id, result.thread.id), {
          providerID: model?.providerID || result.modelProvider?.trim() || "",
          modelID: result.model?.trim() || model?.modelID || "",
        });
        if (title) await runtime.call("thread/name/set", { threadId: result.thread.id, name: title });
        return mapCodexThread({ ...result.thread, ...(title ? { name: title } : {}) });
      }
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      return buildSession(
        unwrapOpencodeResult(
          await opencode.session.create({ directory: workspace.path, title }),
          "/session",
        ),
      );
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  async function promptWorkspaceSession(
    workspace: WorkspaceInfo,
    sessionId: string,
    input: ReturnType<typeof sessionPromptInput>,
  ) {
    try {
      if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
        const runtime = deepseekHarness.forWorkspace(workspace);
        if (input.mode) {
          await runtime.call("agentPreset.select", {
            sessionId,
            agentPreset: input.mode,
          });
        }
        if (input.model) {
          await runtime.call("session.selectModel", {
            sessionId,
            provider: input.model.providerID,
            model: input.model.modelID,
            ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
          });
        }
        await runtime.call("session.prompt", {
          sessionId,
          mode: "queue",
          content: [{ type: "text", text: input.text }],
          clientTimeZone: input.clientTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        return sessionId;
      }
      if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
        const runtime = codexHarness.forWorkspace(workspace);
        const freshKey = codexThreadKey(workspace.id, sessionId);
        const fresh = freshCodexThreads.get(freshKey);
        const freshMatchesSelection = Boolean(
          fresh
          && (!input.model || (
            fresh.providerID === input.model.providerID
            && fresh.modelID === input.model.modelID
          )),
        );
        let effectiveSessionId = sessionId;
        if (!freshMatchesSelection) {
          const resumed = await runtime.resumeThread({
            threadId: sessionId,
            cwd: workspace.path,
            ...(input.model ? {
              modelProvider: codexHarnessRuntimeProviderId(input.model.providerID),
              model: input.model.modelID,
            } : {}),
          });
          const resumedThread = resumed && isRecord(resumed.thread) ? resumed.thread : null;
          if (typeof resumedThread?.id === "string" && resumedThread.id.trim()) {
            effectiveSessionId = resumedThread.id.trim();
          }
        }
        await runtime.call("turn/start", {
          threadId: effectiveSessionId,
          input: [{ type: "text", text: input.text, text_elements: [] }],
          ...(input.model ? { model: input.model.modelID } : {}),
          ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
        });
        freshCodexThreads.delete(freshKey);
        return effectiveSessionId;
      }
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      unwrapOpencodeResult(
        await opencode.session.promptAsync({
          sessionID: sessionId,
          parts: [{ type: "text", text: input.text }],
          model: input.model,
          agent: input.mode,
          variant: input.reasoningEffort,
        }),
        `/session/${encodeURIComponent(sessionId)}/prompt_async`,
      );
      return sessionId;
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  addRoute(routes, "POST", "/workspace/:id/sessions", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const item = await createWorkspaceSession(
      workspace,
      optionalString(body, "title", 500),
      sessionModelInput(body),
    );
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
    const effectiveSessionId = await promptWorkspaceSession(
      workspace,
      sessionId,
      sessionPromptInput(await readJsonBody(ctx.request)),
    );
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

    if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
      throw new ApiError(
        501,
        "session_delete_unsupported",
        "DeepSeek Harness supports session archiving but not permanent deletion",
      );
    }

    if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
      freshCodexThreads.delete(codexThreadKey(workspace.id, sessionId));
      await codexHarness.forWorkspace(workspace).call("thread/delete", { threadId: sessionId });
      return jsonResponse({ ok: true });
    }

    const opencode = createWorkspaceOpencodeClient(config, workspace);
    unwrapOpencodeResult(
      await opencode.session.delete({ sessionID: sessionId }),
      `/session/${encodeURIComponent(sessionId)}`,
    );

    return jsonResponse({ ok: true });
  });
}
