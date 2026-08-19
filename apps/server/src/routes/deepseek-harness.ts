import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  DeepSeekHarnessRpcError,
  type DeepSeekHarnessRuntime,
  DeepSeekHarnessUnavailableError,
} from "../deepseek-harness-runtime.js";
import { ApiError } from "../errors.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
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
  "session.prompt",
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
  runtime: DeepSeekHarnessRuntime;
  readJsonBody: ReadJsonBody;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

function ensureDeepSeekHarnessWorkspace(workspace: WorkspaceInfo): void {
  if (workspace.engineId !== DEEPSEEK_HARNESS_ENGINE_ID) {
    throw new ApiError(409, "workspace_engine_mismatch", "This project does not use DeepSeek Harness");
  }
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
  const { routes, config, runtime, readJsonBody, requireClientScope, resolveWorkspace } = options;

  addRoute(routes, "POST", "/workspace/:id/engine/deepseek-harness/rpc", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureDeepSeekHarnessWorkspace(workspace);
    const body = await readJsonBody(ctx.request);
    const method = typeof body.method === "string" ? body.method.trim() : "";
    if (!ALLOWED_METHODS.has(method)) {
      throw new ApiError(400, "invalid_payload", `Unsupported DeepSeek Harness method: ${method || "missing"}`);
    }
    if (!READ_METHODS.has(method)) requireClientScope(ctx, "collaborator");
    try {
      return Response.json({ value: await runtime.call(method, body.payload ?? {}) });
    } catch (error) {
      remapDeepSeekHarnessError(error);
    }
  });

  addRoute(routes, "POST", "/workspace/:id/engine/deepseek-harness/respond", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureDeepSeekHarnessWorkspace(workspace);
    const body = await readJsonBody(ctx.request);
    const rpcId = typeof body.rpcId === "string" ? body.rpcId.trim() : "";
    if (!rpcId || !("result" in body)) {
      throw new ApiError(400, "invalid_payload", "rpcId and result are required");
    }
    try {
      await runtime.respond({ rpcId, result: body.result });
      return Response.json({ ok: true });
    } catch (error) {
      remapDeepSeekHarnessError(error);
    }
  });

  addRoute(routes, "GET", "/workspace/:id/engine/deepseek-harness/events/:stream", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureDeepSeekHarnessWorkspace(workspace);
    const stream = ctx.params.stream;
    if (stream !== "mux" && stream !== "host") {
      throw new ApiError(404, "not_found", "DeepSeek Harness event stream not found");
    }
    try {
      const upstream = await runtime.events(stream, ctx.request.signal);
      return new Response(upstream.body, {
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/event-stream",
        },
      });
    } catch (error) {
      remapDeepSeekHarnessError(error);
    }
  });
}
