/** Official chat services mount through DSH's existing pi-ai adapter. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { LlmError, resolveImageAttachmentAccess, resolveRetryPolicy, ACCOUNT_QUOTA_EXCEEDED_CODE, type GenerateOptions, type StreamChunk, type PreparedAdapterCall } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-workspace";
import { SuiteError } from "./errors.ts";
import { recoverModelRequest } from "./model-request-recovery.ts";
import {
  createProvider,
  envApiKeyAuth,
  InMemoryCredentialStore,
  defaultProviderAuthContext,
} from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { Context } from "@deepseek-ai/cordis";
import { randomBytes, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import * as pi from "@deepseek-ai/dsh-llm-pi-ai";
import type { Services } from "./services.ts";
import type { AccountService } from "./account.ts";
export interface ModelWebServer {
  getOrigin(): string;
  register(route: {
    kind: "prefix";
    path: string;
    auth?: "anonymous";
    handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
  }): () => void;
}
async function* officialModelStream(stream: AsyncIterable<StreamChunk>, cloudOnly=false): AsyncIterable<StreamChunk> {
  for await (const chunk of stream) {
    if (chunk.type === "finish" && chunk.reason.kind === "error"
      && chunk.reason.failure.message.includes("INSUFFICIENT_POINTS")) {
      yield { ...chunk, reason: { kind: "error", failure: {
        code: ACCOUNT_QUOTA_EXCEEDED_CODE,
        message: cloudOnly ? "Insufficient iPolloWork points. Add points or select an authorized enterprise model." : "Insufficient iPolloWork points. Add points or switch to your own API key.",
      } } };
    } else yield chunk;
  }
}
class OfficialModelAdapter extends pi.PiAiAdapter {
  cloudOnly=false;
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return officialModelStream(super.stream(options),this.cloudOnly);
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await super.prepareCall(provider, model, signal);
    return { ...prepared, stream: options => officialModelStream(prepared.stream(options),this.cloudOnly) };
  }
}
/** Mount account channels without exposing the upstream key.
 * @param ctx - Runtime owning the adapter.
 * @param webServer - Local HTTP listener for authenticated model calls.
 * @param services - Account channels and source choices.
 * @param account - Account session used by the gateway.
 * @param initializeDefault - Select an account channel after registration, while retaining personal keys.
 * @returns Serialized channel refresh.
 */
export function mountServiceModels(
  ctx: Context,
  webServer: ModelWebServer,
  services: Services,
  account: AccountService,
  initializeDefault?: (providers: readonly string[]) => Promise<void>,
): () => Promise<void> {
  const token = randomBytes(32).toString("hex"),
    lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  let registeredServices = new Map<string, Awaited<ReturnType<Services["catalog"]>>["items"][number]>();
  let profiles = new Map<string, pi.ResolvedPiAiProviderProfile>(),
    facts = "",
    serial = Promise.resolve();
  let personalSourceProviders = new Set<string>();
  let pendingRefresh: Promise<void> | undefined;
  const adapter = new OfficialModelAdapter({
    profiles: () => profiles,
    prepareHeaders: (request, headers) => {
      if (request.sessionId) headers.set("X-iPollo-Session", request.sessionId);
      return headers;
    },
    resolveApiKey: async () => token,
    resolveAttachments: () => ctx.get("attachments"),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get("fs")?.processPathFromHostPath(hostPath),
      ref,
    ),
    auth: {
      credentials: new InMemoryCredentialStore(),
      authContext: defaultProviderAuthContext(),
    },
  });
  adapter.cloudOnly=account.cloudOnly;
  let registration: ReturnType<Context["llm"]["registerAdapter"]> | undefined;
  ctx.effect(() =>
    webServer.register({
      kind: "prefix",
      path: "/ipollo-service-models",
      auth: "anonymous",
      handler: async (req, res) => {
        if (req.headers.authorization !== "Bearer " + token) {
          res.writeHead(401);
          res.end();
          return;
        }
        const controller = new AbortController();
        res.on("close", () => controller.abort());
        const requestId = randomUUID();
        let phase = "request";
        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          const match =
            /^\/ipollo-service-models\/([a-z0-9-]+)\/v1\/chat\/completions$/.exec(
              url.pathname,
            );
          if (!match || req.method !== "POST") {
            res.writeHead(404);
            res.end();
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            length += chunk.length;
            if (length > 16 * 1024 * 1024) {
              res.setHeader("Connection", "close");
              throw new SuiteError("IPW_MODEL_REQUEST_TOO_LARGE", 413);
            }
            chunks.push(Buffer.from(chunk));
          }
          phase = "gateway";
          const service = registeredServices.get(match[1]!);
          let projectId: string | undefined;
          if (service?.credentialMode === "member") {
            const sessionId = req.headers["x-ipollo-session"];
            const workspace = typeof sessionId === "string" ? ctx.get("workspaceRegistry")?.list().find(item => item.sessionIds.includes(sessionId as never)) : undefined;
            const data = await account.request("/api/v1/projects") as { items: { id: string; native_id: string | null; enterprise_id: string | null }[] };
            projectId = workspace && data.items.find(item => item.native_id === workspace.id && item.enterprise_id === service.enterprise?.id)?.id;
            if (!projectId) throw new SuiteError("SERVICE_ORGANIZATION_CONTEXT_REQUIRED", 403);
          }
          const generation = account.generation;
          const signal = AbortSignal.any([controller.signal, lifetime.signal]);
          const response = await recoverModelRequest(async () => {
            if (generation !== account.generation) throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
            const response = await account.execute(
              match[1]!,
              {
                requestId,
                path: "/chat/completions",
                method: "POST",
                body: Buffer.concat(chunks).toString("base64"),
                contentType: "application/json",
              },
              signal,
              projectId,
            );
            if (generation !== account.generation) {
              await response.body?.cancel();
              throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
            }
            return response;
          }, signal);
          phase = "response";
          res.writeHead(response.status, {
            "Content-Type":
              response.headers.get("content-type") ?? "application/json",
            "Cache-Control": "no-store",
          });
          if (response.body)
            await pipeline(
              Readable.from(
                (async function* () {
                  const reader = response.body!.getReader();
                  try {
                    while (true) {
                      const value = await reader.read();
                      if (value.done) return;
                      yield value.value;
                    }
                  } finally {
                    reader.releaseLock();
                  }
                })(),
              ),
              res,
            );
          else res.end();
        } catch (error) {
          if (!controller.signal.aborted && !lifetime.signal.aborted && !(error instanceof SuiteError)) {
            const cause = error instanceof Error ? error.cause : undefined;
            const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
            const reason = typeof code === "string" && /^(?:E|UND_ERR_)[A-Z0-9_]{1,48}$/.test(code) ? code : "unknown";
            ctx.logger.warn("Official model proxy failed: request %s, phase %s, reason %s", requestId, phase, reason);
          }
          if (res.headersSent) res.destroy();
          else {
            res.writeHead(error instanceof SuiteError ? error.status : 503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: {
              code: error instanceof SuiteError ? error.code : "IPW_SERVICE_UNAVAILABLE",
              message: error instanceof SuiteError ? error.code : "Official model service unavailable",
            } }));
          }
        }
      },
    }),
  );

  const refreshModels = () => {
    const refresh = async () => {
      const generation = services.generation;
      try {
        const catalog = await services.catalog();
        const choices = await services.choices();
        const models = catalog.items.filter(
          (s) =>
            s.available &&
            (s.category ?? "language") === "language" &&
            s.capabilities.includes("chat") &&
            s.models.length &&
            choices[s.provider]?.source !== "own",
        );
        if (lifetime.signal.aborted || generation !== services.generation)
          return;
        personalSourceProviders = new Set(
          catalog.items
            .filter(service => choices[service.provider]?.source === "own")
            .map(service => "ipollo-" + service.id),
        );
        const next = JSON.stringify(models.map((s) => [s.id, s.models, s.credentialMode, s.enterprise]));
        const changed = next !== facts;
        if (!changed && services.modelStatus === "ready") return;
        if (changed) {
          const nextProfiles = new Map<string, pi.ResolvedPiAiProviderProfile>();
          for (const service of models) {
            const provider = "ipollo-" + service.id,
              baseURL =
                webServer.getOrigin() +
                "/ipollo-service-models/" +
                service.id +
                "/v1";
            const modelList = service.models.flatMap((model) => {
              if (
                (model.category ?? "language") !== "language" ||
                model.contextWindow === undefined ||
                model.maxTokens === undefined
              )
                return [];
              const catalogProvider = service.provider === "deepseek" ? "deepseek"
                : service.provider === "aliyun-bailian" ? "qwen-token-plan-cn" : undefined;
              const known = catalogProvider && getBuiltinModels(catalogProvider).find(entry =>
                entry.id === model.id && entry.api === "openai-completions");
              const capabilities = known && known.api === "openai-completions" ? {
                reasoning: known.reasoning,
                ...(known.thinkingLevelMap ? { thinkingLevelMap: known.thinkingLevelMap }
                  : known.reasoning && known.compat?.supportsReasoningEffort === false
                    ? { thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null } } : {}),
                ...(known.compat ? { compat: known.compat } : {}),
              } : { reasoning: false };
              return [
                {
                  ...model,
                  contextWindow: model.contextWindow,
                  maxTokens: model.maxTokens,
                  provider,
                  baseUrl: baseURL,
                  api: "openai-completions" as const,
                  input: ["text" as const, ...(model.inputModalities?.includes("image") || model.capabilities?.includes("input:image") || known?.input.includes("image") ? ["image" as const] : [])],
                  ...capabilities,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ];
            });
            if (!modelList.length) continue;
            nextProfiles.set(provider, {
              provider,
              displayName:
                (service.enterprise ? service.enterprise.name : "iPolloWork") +
                " · " +
                service.title,
              api: "openai-completions",
              baseURL,
              streamIdleTimeoutMs: 120000,
              maxRequestImageBytes: 16 * 1024 * 1024,
              maxRequestImages: 100,
              imageOffloadCountQuantum: 10,
              requestImageBudgetCount: 20,
              requestImagePixelBudget: 1000000,
              maxImageBytes: 1000000,
              retryPolicy: resolveRetryPolicy(
                { mode: "normal", maxRetries: 0 },
                service.enterprise
                  ? "iPolloWork enterprise model"
                  : "iPolloWork official service",
              ),
              modelErrors: new Map(),
              configuredMaxTokens: new Map(),
              piProvider: createProvider({
                id: provider,
                name: service.title,
                baseUrl: baseURL,
                auth: { apiKey: envApiKeyAuth("iPolloWork", []) },
                models: modelList,
                api: openAICompletionsApi(),
              }),
            });
          }
          registeredServices = new Map(models.map(service => [service.id, service]));
          profiles = nextProfiles;
          if (registration) registration.replace([...profiles.keys()]);
          else if (profiles.size)
            registration = ctx.llm.registerAdapter([...profiles.keys()], adapter);
          facts = next;
        }
        await initializeDefault?.([...profiles.keys()]);
        if (lifetime.signal.aborted || generation !== services.generation) return;
        services.modelStatus = "ready";
        services.modelError = "";
      } catch (error) {
        if (!lifetime.signal.aborted && generation === services.generation) {
          services.modelStatus = "error";
          services.modelError = error instanceof SuiteError ? error.code : "IPW_MODEL_REGISTRATION_FAILED";
        }
        throw error;
      }
    };
    const running = serial = serial.then(refresh, refresh);
    pendingRefresh = running;
    const clear = () => {
      if (pendingRefresh === running) pendingRefresh = undefined;
    };
    void running.then(clear, clear);
    return running;
  };

  const hasModel = (provider: string, model: string) => {
    if (!ctx.llm.listProviders().some(item => item.id === provider)) return false;
    const profile = profiles.get(provider);
    return !profile || profile.piProvider?.getModels().some(item => item.id === model) === true;
  };
  ctx.on("agent/pre-step", async ({ agent, modelSelection: { provider, model }, signal }, next) => {
    // The built-in fallback can exist without a usable credential or any
    // conversation selection, while the composer still shows "Choose model".
    if (provider === "deepseek-official"
      && !agent.session.snapshotEvents().some(event => event.type === "model/selection")
      && !(await ctx.llm.listModels(provider)).some(item => item.id === model)) {
      signal.throwIfAborted();
      throw LlmError.fromFailure({
        code: "MODEL_NOT_SELECTED",
        message: "Choose a model in the composer before sending a message.",
      });
    }
    if (!provider.startsWith("ipollo-")) return next();
    if (hasModel(provider, model)) return next();
    signal.throwIfAborted();
    // A saved route may predate startup, a source change, or a catalog update.
    await (pendingRefresh ?? refreshModels()).catch(() => { /* The refresh records its failure in Services. */ });
    signal.throwIfAborted();
    if (hasModel(provider, model)) return next();
    if (personalSourceProviders.has(provider)) throw LlmError.fromFailure({
      code: "IPW_OFFICIAL_MODEL_SOURCE_CHANGED",
      message: "This conversation still uses an official model. Its service now uses your own key. Select a model configured with your key, or switch the service back to Official in Service connections.",
    });
    throw LlmError.fromFailure({
      code: services.modelError || "IPW_OFFICIAL_MODEL_UNAVAILABLE",
      message: "The selected iPolloWork model is unavailable. Check service connections or select an available model.",
    });
  });

  return refreshModels;
}
