import type { EnginePluginPromptSelection } from "@ipollowork/types/plugins";
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
import { listPortablePluginPromptCapabilities } from "../plugin-package-lifecycle.js";
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
  runtime: DeepSeekHarnessRuntimePool;
  readJsonBody: ReadJsonBody;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

function ensureDeepSeekHarnessWorkspace(workspace: WorkspaceInfo): void {
  if (workspace.engineId !== DEEPSEEK_HARNESS_ENGINE_ID) {
    throw new ApiError(409, "workspace_engine_mismatch", "This project does not use DeepSeek Harness");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internalPromptText(text: string): string {
  return `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}${text}\n</system>`;
}

function pluginPromptSelection(value: unknown): EnginePluginPromptSelection | undefined {
  if (!isRecord(value)) return undefined;
  const commandValue = isRecord(value.command) ? value.command : null;
  const commandName = typeof commandValue?.name === "string" ? commandValue.name.trim() : "";
  const commandArguments = typeof commandValue?.arguments === "string" ? commandValue.arguments.trim() : "";
  const agents = Array.isArray(value.agents)
    ? [...new Set(value.agents.flatMap((agent) => typeof agent === "string" && agent.trim() ? [agent.trim()] : []))]
    : [];
  if (!commandName && agents.length === 0) return undefined;
  return {
    ...(commandName ? { command: { name: commandName, ...(commandArguments ? { arguments: commandArguments } : {}) } } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  };
}

async function withPluginPromptInstructions(
  config: ServerConfig,
  payload: Record<string, unknown>,
  selection: EnginePluginPromptSelection | undefined,
): Promise<Record<string, unknown>> {
  const content = Array.isArray(payload.content) ? [...payload.content] : [];
  if (!selection) return { ...payload, content };
  const capabilities = await listPortablePluginPromptCapabilities({
    serverConfig: config,
    engineId: DEEPSEEK_HARNESS_ENGINE_ID,
  });
  const instructions: Array<{ type: "text"; text: string }> = [];
  const resolveCapability = (type: "command" | "agent", name: string) => {
    const matches = capabilities.filter((capability) => capability.type === type && capability.name === name);
    if (matches.length !== 1) {
      throw new ApiError(
        matches.length === 0 ? 404 : 409,
        matches.length === 0 ? "plugin_prompt_capability_not_found" : "plugin_prompt_capability_ambiguous",
        matches.length === 0
          ? `Installed plugin ${type} was not found: ${name}`
          : `More than one installed plugin exposes ${type}: ${name}`,
      );
    }
    return matches[0];
  };
  if (selection.command) {
    const command = resolveCapability("command", selection.command.name);
    instructions.push({
      type: "text",
      text: internalPromptText(`Execute the installed plugin command /${command.name}. Follow its instructions:\n\n${command.content}`),
    });
    content.push({
      type: "text",
      text: selection.command.arguments
        ? `Run /${command.name} with these arguments: ${selection.command.arguments}`
        : `Run /${command.name}.`,
    });
  }
  for (const agentName of selection.agents ?? []) {
    const agent = resolveCapability("agent", agentName);
    instructions.push({
      type: "text",
      text: internalPromptText(`The user selected the plugin agent "${agent.name}". Follow these agent instructions:\n\n${agent.content}`),
    });
  }
  return { ...payload, content: [...instructions, ...content] };
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

  addRoute(routes, "GET", "/workspace/:id/engine/deepseek-harness/plugin-capabilities", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureDeepSeekHarnessWorkspace(workspace);
    return Response.json({
      items: (await listPortablePluginPromptCapabilities({
        serverConfig: config,
        engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      })).map(({ content: _content, ...summary }) => summary),
    });
  });

  addRoute(routes, "POST", "/workspace/:id/engine/deepseek-harness/prompt", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureDeepSeekHarnessWorkspace(workspace);
    const body = await readJsonBody(ctx.request);
    if (!isRecord(body.payload) || typeof body.payload.sessionId !== "string" || !body.payload.sessionId.trim()) {
      throw new ApiError(400, "invalid_payload", "A DeepSeek Harness sessionId is required");
    }
    const promptPayload = await withPluginPromptInstructions(
      config,
      body.payload,
      pluginPromptSelection(body.plugins),
    );
    try {
      await runtime.forWorkspace(workspace).call("session.prompt", promptPayload);
      return Response.json({ ok: true });
    } catch (error) {
      remapDeepSeekHarnessError(error);
    }
  });

  addRoute(routes, "POST", "/workspace/:id/engine/deepseek-harness/rpc", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureDeepSeekHarnessWorkspace(workspace);
    const workspaceRuntime = runtime.forWorkspace(workspace);
    const body = await readJsonBody(ctx.request);
    const method = typeof body.method === "string" ? body.method.trim() : "";
    if (!ALLOWED_METHODS.has(method)) {
      throw new ApiError(400, "invalid_payload", `Unsupported DeepSeek Harness method: ${method || "missing"}`);
    }
    if (!READ_METHODS.has(method)) requireClientScope(ctx, "collaborator");
    try {
      return Response.json({ value: await workspaceRuntime.call(method, body.payload ?? {}) });
    } catch (error) {
      remapDeepSeekHarnessError(error);
    }
  });

  addRoute(routes, "POST", "/workspace/:id/engine/deepseek-harness/respond", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureDeepSeekHarnessWorkspace(workspace);
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
    const workspace = await resolveWorkspace(config, ctx.params.id);
    ensureDeepSeekHarnessWorkspace(workspace);
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
      remapDeepSeekHarnessError(error);
    }
  });
}
