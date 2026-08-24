import { CODEX_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import {
  codexHarnessRuntimeProviderId,
  CodexHarnessModelSelectionError,
  CodexHarnessRuntimePool,
  CodexHarnessUnavailableError,
  type CodexHarnessProvider,
} from "../codex-harness-runtime.js";
import { ApiError } from "../errors.js";
import {
  parseEnginePluginPromptSelection,
  resolveEnginePluginPrompt,
} from "../plugin-prompt-adapter.js";
import { listPortablePluginPromptCapabilities } from "../plugin-package-lifecycle.js";
import { StdioJsonRpcError } from "../stdio-json-rpc-runtime.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { buildCodexHarnessAdditionalContext } from "../workspace-session-runtime.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

const READ_METHODS = new Set([
  "thread/list",
  "thread/read",
  "thread/loaded/list",
  "model/list",
  "skills/list",
  "mcpServerStatus/list",
]);

const WRITE_METHODS = new Set([
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/archive",
  "thread/delete",
  "thread/unarchive",
  "thread/name/set",
  "thread/rollback",
  "thread/shellCommand",
  "turn/start",
  "turn/interrupt",
]);

interface RegisterCodexHarnessRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  runtime: CodexHarnessRuntimePool;
  readJsonBody: ReadJsonBody;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureCodexWorkspace(workspace: WorkspaceInfo): void {
  if (workspace.engineId !== CODEX_HARNESS_ENGINE_ID) {
    throw new ApiError(409, "workspace_engine_mismatch", "This project does not use Codex Harness");
  }
}

function remapCodexError(error: unknown): never {
  if (error instanceof CodexHarnessModelSelectionError) {
    throw new ApiError(409, error.code, error.message);
  }
  if (error instanceof CodexHarnessUnavailableError) {
    throw new ApiError(503, error.code, error.message);
  }
  if (error instanceof StdioJsonRpcError) {
    const status = error.code === -32602 ? 400 : error.code === -32601 ? 501 : 502;
    throw new ApiError(status, "codex_harness_rpc_failed", error.message, {
      code: error.code,
      data: error.data,
    });
  }
  throw error;
}

type CodexNativeModel = {
  id?: string;
  model?: string;
  displayName?: string;
  inputModalities?: string[];
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
};

export function projectCodexHarnessProviderList(
  providers: readonly CodexHarnessProvider[],
  nativeModels: readonly CodexNativeModel[],
) {
  const nativeModelsById = new Map(nativeModels.flatMap((model) => {
    const modelId = model.model || model.id || "";
    return modelId ? [[modelId, model] as const] : [];
  }));
  const all = providers.map((provider) => {
    // The shared account directory owns which models the user configured.
    // Codex's native directory may enrich a matching model, but it must never
    // hide a configured model or add an unconfigured one.
    const models = provider.models;
    return {
      id: provider.id,
      name: provider.name,
      source: "config" as const,
      env: [],
      models: Object.fromEntries(models.map((model) => {
        const native = nativeModelsById.get(model.id);
        const efforts = native?.supportedReasoningEfforts?.flatMap((entry) => (
          entry.reasoningEffort ? [[entry.reasoningEffort, { name: entry.reasoningEffort }] as const] : []
        )) ?? [];
        return [model.id, {
          id: model.id,
          name: model.name || native?.displayName || model.id,
          capabilities: {
            attachment: native?.inputModalities?.includes("image") === true,
            reasoning: efforts.length > 0,
            input: { image: native?.inputModalities?.includes("image") === true },
            output: { text: true },
            toolcall: true,
          },
          ...(efforts.length ? { variants: Object.fromEntries(efforts) } : {}),
        }] as const;
      })),
    };
  });
  return {
    all,
    connected: providers.map((provider) => provider.id),
    default: Object.fromEntries(all.flatMap((provider) => {
      const firstModelId = Object.keys(provider.models)[0];
      return firstModelId ? [[provider.id, firstModelId]] : [];
    })),
  };
}

async function providerList(runtime: ReturnType<CodexHarnessRuntimePool["forWorkspace"]>) {
  const providers = await runtime.providers();
  // Provider browsing is configuration I/O, not an Agent operation. Starting
  // Codex here makes the picker slow and can surface a console window on
  // Windows. Runtime validation happens when the user actually sends a turn.
  return projectCodexHarnessProviderList(providers, []);
}

export function registerCodexHarnessRoutes(options: RegisterCodexHarnessRoutesOptions): void {
  const { routes, config, runtime, readJsonBody, requireClientScope, resolveWorkspace } = options;

  addRoute(routes, "GET", "/workspace/:id/engine/codex-harness/plugin-capabilities", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureCodexWorkspace(workspace);
    return Response.json({
      items: (await listPortablePluginPromptCapabilities({
        serverConfig: config,
        engineId: CODEX_HARNESS_ENGINE_ID,
      })).map(({ content: _content, ...summary }) => summary),
    });
  });

  addRoute(routes, "POST", "/workspace/:id/engine/codex-harness/prompt", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureCodexWorkspace(workspace);
    const body = await readJsonBody(ctx.request);
    if (!isRecord(body.payload) || typeof body.payload.threadId !== "string" || !body.payload.threadId.trim()) {
      throw new ApiError(400, "invalid_payload", "A Codex Harness threadId is required");
    }
    const selection = parseEnginePluginPromptSelection(body.plugins);
    const instructions = await resolveEnginePluginPrompt({
      config,
      engineId: CODEX_HARNESS_ENGINE_ID,
      selection,
    });
    const input = Array.isArray(body.payload.input) ? [...body.payload.input] : [];
    const additionalContext = buildCodexHarnessAdditionalContext(
      body.payload.system,
      [...instructions.systemInstructions, ...instructions.userInstructions],
    );
    const model = isRecord(body.payload.model) ? body.payload.model : null;
    const providerID = typeof model?.providerID === "string" ? model.providerID.trim() : "";
    const modelID = typeof model?.modelID === "string" ? model.modelID.trim() : "";
    const workspaceRuntime = runtime.forWorkspace(workspace);
    try {
      const resumed = await workspaceRuntime.resumeThread({
        threadId: body.payload.threadId,
        cwd: workspace.path,
        ...(providerID ? { modelProvider: codexHarnessRuntimeProviderId(providerID) } : {}),
        ...(modelID ? { model: modelID } : {}),
      });
      const resumedThread = resumed && isRecord(resumed.thread) ? resumed.thread : null;
      const effectiveThreadId = typeof resumedThread?.id === "string" && resumedThread.id.trim()
        ? resumedThread.id.trim()
        : body.payload.threadId;
      await workspaceRuntime.call("turn/start", {
        threadId: effectiveThreadId,
        ...(typeof body.payload.clientUserMessageId === "string" && body.payload.clientUserMessageId.trim()
          ? { clientUserMessageId: body.payload.clientUserMessageId.trim() }
          : {}),
        input,
        ...(additionalContext ? { additionalContext } : {}),
        cwd: workspace.path,
        ...(modelID ? { model: modelID } : {}),
        ...(typeof body.payload.reasoningEffort === "string"
          ? { effort: body.payload.reasoningEffort }
          : typeof body.payload.variant === "string"
            ? { effort: body.payload.variant }
            : {}),
      });
      return Response.json({ ok: true, sessionId: effectiveThreadId });
    } catch (error) {
      remapCodexError(error);
    }
  });

  addRoute(routes, "POST", "/workspace/:id/engine/codex-harness/rpc", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureCodexWorkspace(workspace);
    const body = await readJsonBody(ctx.request);
    const method = typeof body.method === "string" ? body.method.trim() : "";
    if (method === "ipollowork/providerList") {
      return Response.json({ value: await providerList(runtime.forWorkspace(workspace)) });
    }
    if (!READ_METHODS.has(method) && !WRITE_METHODS.has(method)) {
      throw new ApiError(400, "invalid_payload", `Unsupported Codex Harness method: ${method || "missing"}`);
    }
    if (WRITE_METHODS.has(method)) requireClientScope(ctx, "collaborator");
    try {
      const workspaceRuntime = runtime.forWorkspace(workspace);
      if (method === "thread/start") {
        if (!isRecord(body.payload)) {
          throw new ApiError(400, "invalid_payload", "Codex Harness thread/start payload must be an object");
        }
        return Response.json({ value: await workspaceRuntime.startThread(body.payload) });
      }
      if (method === "thread/resume") {
        if (!isRecord(body.payload) || typeof body.payload.threadId !== "string" || !body.payload.threadId.trim()) {
          throw new ApiError(400, "invalid_payload", "Codex Harness thread/resume requires a threadId");
        }
        const value = await workspaceRuntime.resumeThread({
          threadId: body.payload.threadId,
          ...(typeof body.payload.cwd === "string" ? { cwd: body.payload.cwd } : {}),
          ...(typeof body.payload.modelProvider === "string" ? { modelProvider: body.payload.modelProvider } : {}),
          ...(typeof body.payload.model === "string" ? { model: body.payload.model } : {}),
        }, { force: true });
        return Response.json({ value });
      }
      return Response.json({ value: await workspaceRuntime.call(method, body.payload ?? {}) });
    } catch (error) {
      remapCodexError(error);
    }
  });

  addRoute(routes, "POST", "/workspace/:id/engine/codex-harness/respond", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureCodexWorkspace(workspace);
    const body = await readJsonBody(ctx.request);
    const rpcId = typeof body.rpcId === "string" || typeof body.rpcId === "number" ? body.rpcId : null;
    if (rpcId === null || !("result" in body)) {
      throw new ApiError(400, "invalid_payload", "rpcId and result are required");
    }
    try {
      await runtime.forWorkspace(workspace).respond(rpcId, body.result);
      return Response.json({ ok: true });
    } catch (error) {
      remapCodexError(error);
    }
  });

  addRoute(routes, "GET", "/workspace/:id/engine/codex-harness/events", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureCodexWorkspace(workspace);
    try {
      return await runtime.forWorkspace(workspace).events(ctx.request.signal);
    } catch (error) {
      remapCodexError(error);
    }
  });
}
