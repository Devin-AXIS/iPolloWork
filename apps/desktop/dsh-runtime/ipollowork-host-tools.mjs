import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

export const OPENAI_CODEX_PRIORITY_PROVIDER_ID = "openai-codex-priority";
export const OPENAI_CODEX_PRIORITY_CREDENTIAL_REF = "OPENAI_CODEX_API_KEY";
const PRIORITY_SERVICE_TIER = "priority";

const OPENAI_CODEX_PRIORITY_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
]);

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required by the iPolloWork host tool bridge`);
  return value;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function priorityModelId(modelId) {
  return `${modelId}-fast`;
}

function basePriorityModelId(modelId) {
  return modelId.endsWith("-fast") ? modelId.slice(0, -"-fast".length) : modelId;
}

/**
 * Build the DSH provider route for OpenCode's `*-fast` aliases. The alias is
 * intentionally separate from the base Codex route: it carries the same OAuth
 * credential and model, while preserving the priority service tier as request
 * semantics instead of pretending Fast is another credential or wire model.
 */
export function createOpenAiCodexPriorityProvider(baseProvider = openaiCodexProvider()) {
  const baseModels = new Map(baseProvider.getModels().map((model) => [model.id, model]));
  const models = [...baseModels.values()]
    .filter((model) => OPENAI_CODEX_PRIORITY_MODEL_IDS.has(model.id))
    .map((model) => ({
      ...model,
      provider: OPENAI_CODEX_PRIORITY_PROVIDER_ID,
      id: priorityModelId(model.id),
      name: `${model.name} Fast`,
    }));

  const baseModel = (model) => {
    const resolved = baseModels.get(basePriorityModelId(model.id));
    if (!resolved) throw new Error(`Unknown OpenAI priority model: ${model.id}`);
    return resolved;
  };
  const priorityOptions = (options = {}) => {
    const reasoningEffort = options.reasoning === "off" ? undefined : options.reasoning;
    return {
      ...options,
      reasoningEffort,
      serviceTier: /** @type {"priority"} */ (PRIORITY_SERVICE_TIER),
    };
  };

  return {
    ...baseProvider,
    id: OPENAI_CODEX_PRIORITY_PROVIDER_ID,
    name: "OpenAI",
    getModels: () => models,
    stream: (model, context, options) => baseProvider.stream(
      baseModel(model),
      context,
      { ...options, serviceTier: /** @type {"priority"} */ (PRIORITY_SERVICE_TIER) },
    ),
    streamSimple: (model, context, options) => baseProvider.stream(
      baseModel(model),
      context,
      priorityOptions(options),
    ),
  };
}

class OpenAiCodexPriorityAdapter extends PiAiAdapter {
  async *stream(options) {
    for await (const chunk of super.stream(options)) {
      const replayState = chunk.type === "finish" && isRecord(chunk.replayState)
        ? chunk.replayState
        : null;
      if (replayState?.kind !== "pi-ai") {
        yield chunk;
        continue;
      }
      // The wrapped Codex transport reports the base route/model. Keep replay
      // identity aligned with the DSH alias selected by the conversation so a
      // later turn can safely restore the native response state.
      yield {
        ...chunk,
        replayState: {
          ...replayState,
          provider: OPENAI_CODEX_PRIORITY_PROVIDER_ID,
          model: options.model,
        },
      };
    }
  }
}

export function registerOpenAiCodexPriorityModels(ctx) {
  const provider = createOpenAiCodexPriorityProvider();
  const profile = {
    provider: OPENAI_CODEX_PRIORITY_PROVIDER_ID,
    displayName: "OpenAI",
    piProvider: provider,
    configuredMaxTokens: new Map(),
    streamIdleTimeoutMs: 120_000,
    retryPolicy: resolveRetryPolicy(undefined, "providers.openai-codex-priority.retryPolicy"),
  };
  const profiles = new Map([[OPENAI_CODEX_PRIORITY_PROVIDER_ID, profile]]);
  const adapter = new OpenAiCodexPriorityAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => {
      const credential = await ctx.credentials.resolve(OPENAI_CODEX_PRIORITY_CREDENTIAL_REF);
      if (credential?.value) return credential.value;
      throw new Error("OpenAI Codex credential is not configured");
    },
    resolveAttachments: () => ctx.get?.("attachments"),
  });
  return ctx.llm.registerAdapter([OPENAI_CODEX_PRIORITY_PROVIDER_ID], adapter);
}

function jsonValue(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

function errorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  }
  return fallback;
}

export const inject = ["tools", "llm", "credentials"];

export async function apply(ctx) {
  ctx.effect(
    () => registerOpenAiCodexPriorityModels(ctx),
    "ipollowork: OpenAI priority model aliases",
  );
  const serverUrl = requiredEnvironment("IPOLLOWORK_SERVER_URL").replace(/\/+$/, "");
  const token = requiredEnvironment("IPOLLOWORK_SERVER_TOKEN");
  const workspaceId = String(process.env.IPOLLOWORK_WORKSPACE_ID ?? "").trim();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(`${serverUrl}/engine-tools`, { headers });
  const catalog = await readJson(response);
  if (!response.ok || !catalog || !Array.isArray(catalog.tools)) {
    throw new Error(errorMessage(catalog, `iPolloWork host tool catalog failed (${response.status})`));
  }

  for (const descriptor of catalog.tools) {
    if (!descriptor || typeof descriptor.name !== "string" || typeof descriptor.description !== "string") continue;
    const definition = {
      name: descriptor.name,
      description: descriptor.description,
      parameters: descriptor.parameters && typeof descriptor.parameters === "object"
        ? descriptor.parameters
        : { type: "object", properties: {}, additionalProperties: false },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
      },
      timeoutMs: 120_000,
      async execute(args, exec) {
        const callResponse = await fetch(`${serverUrl}/engine-tools/call`, {
          method: "POST",
          headers,
          signal: exec.signal,
          body: JSON.stringify({
            name: descriptor.name,
            args: jsonValue(args),
            context: {
              ...(workspaceId ? { workspaceId } : {}),
              ...(exec.agent?.session?.meta?.cwd ? { directory: exec.agent.session.meta.cwd } : {}),
              ...(exec.agent?.id ? { sessionId: String(exec.agent.id) } : {}),
            },
          }),
        });
        const result = await readJson(callResponse);
        if (!callResponse.ok) {
          throw new Error(errorMessage(result, `iPolloWork host tool failed (${callResponse.status})`));
        }
        return jsonValue(result);
      },
    };
    ctx.effect(() => ctx.tools.register(definition), `ipollowork: ${descriptor.name}`);
  }
}
