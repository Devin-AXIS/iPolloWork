import {
  DEEPSEEK_HARNESS_ENGINE_ID,
  DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX,
} from "@ipollowork/types/workspace";

import {
  DeepSeekHarnessRpcError,
  type DeepSeekHarnessRuntimePool,
  DeepSeekHarnessUnavailableError,
} from "../deepseek-harness-runtime.js";
import { ApiError } from "../errors.js";
import {
  parseEnginePluginPromptSelection,
  resolveEnginePluginPrompt,
} from "../plugin-prompt-adapter.js";
import { listPortablePluginPromptCapabilities } from "../plugin-package-lifecycle.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { resolveWorkspaceSession } from "../workspace-session-runtime.js";
import { bindConversationSession } from "../work-items.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

const ALLOWED_METHODS = new Set([
  "session.list",
  "session.search",
  "session.create",
  "session.history",
  "session.models",
  "session.selectModel",
  "session.rename",
  "session.fork",
  "session.cancel",
  "llm.providers",
  "llm.models",
  "credentials.describe",
  "credentials.set",
  "credentials.unset",
  "settings.describe",
  "settings.mutate",
  "workspace.list",
  "workspace.archiveSession",
  "agentPreset.list",
  "agentPreset.select",
  "commands/execute",
]);

const READ_METHODS = new Set([
  "session.list",
  "session.search",
  "session.history",
  "session.models",
  "llm.providers",
  "llm.models",
  "credentials.describe",
  "settings.describe",
  "workspace.list",
  "agentPreset.list",
]);

interface RegisterDeepSeekHarnessRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  runtime: DeepSeekHarnessRuntimePool;
  readJsonBody: ReadJsonBody;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  rememberSessionContext: (workspaceId: string, sessionId: string) => void;
  preparePlugins: (workspace: WorkspaceInfo) => Promise<void>;
  monitorSessionExecution?: (workspace: WorkspaceInfo, sessionId: string, turnId?: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internalPromptText(text: string): string {
  return `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}${text}\n</system>`;
}

async function withPluginPromptInstructions(
  config: ServerConfig,
  payload: Record<string, unknown>,
  selection: ReturnType<typeof parseEnginePluginPromptSelection>,
): Promise<Record<string, unknown>> {
  const content = Array.isArray(payload.content) ? [...payload.content] : [];
  const resolved = await resolveEnginePluginPrompt({
    config,
    engineId: DEEPSEEK_HARNESS_ENGINE_ID,
    selection,
  });
  return {
    ...payload,
    content: [
      ...resolved.systemInstructions.map((text) => ({ type: "text", text: internalPromptText(text) })),
      ...content,
      ...resolved.userInstructions.map((text) => ({ type: "text", text })),
    ],
  };
}

function remapDeepSeekHarnessError(error: unknown): never {
  if (error instanceof DeepSeekHarnessUnavailableError) {
    throw new ApiError(503, error.code, error.message);
  }
  if (error instanceof DeepSeekHarnessRpcError) {
    const status = error.code === "not-found" || error.code === "session-not-found" ? 404 : 502;
    throw new ApiError(status, `deepseek_harness_${error.code}`, error.message, error.details);
  }
  throw error;
}

export function registerDeepSeekHarnessRoutes(options: RegisterDeepSeekHarnessRoutesOptions): void {
  const { routes, config, runtime, readJsonBody, requireClientScope, resolveWorkspace, rememberSessionContext } = options;

  addRoute(routes, "GET", "/workspace/:id/engine/deepseek-harness/plugin-capabilities", "client", async (ctx) => {
    await resolveWorkspace(config, ctx.params.id);
    return Response.json({
      items: (await listPortablePluginPromptCapabilities({
        serverConfig: config,
        engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      })).map(({ content: _content, ...summary }) => summary),
    });
  });

  addRoute(routes, "POST", "/workspace/:id/engine/deepseek-harness/prompt", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    let workspace: WorkspaceInfo = { ...await resolveWorkspace(config, ctx.params.id), engineId: DEEPSEEK_HARNESS_ENGINE_ID };
    const body = await readJsonBody(ctx.request);
    if (!isRecord(body.payload) || typeof body.payload.sessionId !== "string" || !body.payload.sessionId.trim()) {
      throw new ApiError(400, "invalid_payload", "A DeepSeek Harness sessionId is required");
    }
    workspace = await resolveWorkspaceSession(config, await resolveWorkspace(config, ctx.params.id), body.payload.sessionId.trim(), { deepseekHarness: runtime });
    if (workspace.engineId !== DEEPSEEK_HARNESS_ENGINE_ID) {
      throw new ApiError(409, "session_engine_mismatch", "This conversation is bound to a different engine");
    }
    const promptPayload = await withPluginPromptInstructions(
      config,
      body.payload,
      parseEnginePluginPromptSelection(body.plugins),
    );
    rememberSessionContext(workspace.id, body.payload.sessionId.trim());
    await options.preparePlugins(workspace);
    try {
      await runtime.forWorkspace(workspace).call("session.prompt", promptPayload);
      options.monitorSessionExecution?.(workspace, body.payload.sessionId.trim());
      return Response.json({ ok: true });
    } catch (error) {
      remapDeepSeekHarnessError(error);
    }
  });

  addRoute(routes, "POST", "/workspace/:id/engine/deepseek-harness/rpc", "client", async (ctx) => {
    let workspace: WorkspaceInfo = { ...await resolveWorkspace(config, ctx.params.id), engineId: DEEPSEEK_HARNESS_ENGINE_ID };
    const body = await readJsonBody(ctx.request);
    const method = typeof body.method === "string" ? body.method.trim() : "";
    if (!ALLOWED_METHODS.has(method)) {
      throw new ApiError(400, "invalid_payload", `Unsupported DeepSeek Harness method: ${method || "missing"}`);
    }
    if (!READ_METHODS.has(method)) requireClientScope(ctx, "collaborator");
    const sessionId = isRecord(body.payload) && typeof body.payload.sessionId === "string"
      ? body.payload.sessionId.trim()
      : "";
    if (sessionId) {
      workspace = await resolveWorkspaceSession(config, await resolveWorkspace(config, ctx.params.id), sessionId, { deepseekHarness: runtime });
      if (workspace.engineId !== DEEPSEEK_HARNESS_ENGINE_ID) {
        throw new ApiError(409, "session_engine_mismatch", "This conversation is bound to a different engine");
      }
    }
    if (["session.create", "session.fork", "commands/execute"].includes(method)) await options.preparePlugins(workspace);
    try {
      const value = await runtime.forWorkspace(workspace).call(method, body.payload ?? {});
      if (method === "commands/execute" && sessionId) options.monitorSessionExecution?.(workspace, sessionId);
      if ((method === "session.create" || method === "session.fork") && isRecord(value) && typeof value.sessionId === "string") {
        await bindConversationSession(config, workspace, value.sessionId, {
          title: "New conversation",
          engineId: DEEPSEEK_HARNESS_ENGINE_ID,
          ...(method === "session.fork" && sessionId ? { parentSessionId: sessionId } : {}),
        });
      }
      return Response.json({ value });
    } catch (error) {
      remapDeepSeekHarnessError(error);
    }
  });

  addRoute(routes, "POST", "/workspace/:id/engine/deepseek-harness/respond", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace: WorkspaceInfo = { ...await resolveWorkspace(config, ctx.params.id), engineId: DEEPSEEK_HARNESS_ENGINE_ID };
    const workspaceRuntime = runtime.forWorkspace(workspace);
    const body = await readJsonBody(ctx.request);
    const rpcId = typeof body.rpcId === "string" ? body.rpcId.trim() : "";
    if (!rpcId || !("result" in body)) {
      throw new ApiError(400, "invalid_payload", "rpcId and result are required");
    }
    try {
      await workspaceRuntime.respond({ rpcId, result: body.result });
      return Response.json({ ok: true });
    } catch (error) {
      remapDeepSeekHarnessError(error);
    }
  });

  addRoute(routes, "GET", "/workspace/:id/engine/deepseek-harness/events/:stream", "client", async (ctx) => {
    const workspace: WorkspaceInfo = { ...await resolveWorkspace(config, ctx.params.id), engineId: DEEPSEEK_HARNESS_ENGINE_ID };
    const workspaceRuntime = runtime.forWorkspace(workspace);
    const stream = ctx.params.stream;
    if (stream !== "mux" && stream !== "host") {
      throw new ApiError(404, "not_found", "DeepSeek Harness event stream not found");
    }
    try {
      const upstream = await workspaceRuntime.events(stream, ctx.request.signal);
      return new Response(upstream.body, {
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/event-stream",
        },
      });
    } catch (error) {
      if (ctx.request.signal.aborted) return new Response(null, { status: 204 });
      remapDeepSeekHarnessError(error);
    }
  });
}
