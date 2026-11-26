/** Official chat services mount through DSH's existing pi-ai adapter. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { LlmError, resolveImageAttachmentAccess, resolveRetryPolicy, ACCOUNT_QUOTA_EXCEEDED_CODE, type GenerateOptions, type StreamChunk, type PreparedAdapterCall } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-workspace";
import { ModelServiceError, SuiteError } from "./errors.ts";
import { isModelTransportError, readModelResponse, recoverModelRequest } from "./model-request-recovery.ts";
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
type ModelDiagnostic = { code: string; requestId: string; status: number | undefined; upstreamStatus: number | undefined };
type ModelAttempt = { id: string; failure?: ModelDiagnostic };
type ModelStream = () => AsyncIterable<StreamChunk>;

function modelDiagnostic(error: unknown, phase: "request" | "gateway" | "response", requestId: string): ModelDiagnostic {
  if (error instanceof SuiteError && /^[A-Z][A-Z0-9_/-]{0,63}$/.test(error.code)) {
    const code = phase === "response" && ["INVALID_INPUT", "SERVICE_CALL_NOT_FOUND", "SERVICE_REPLAY_UNSUPPORTED"].includes(error.code)
      ? "IPW_MODEL_STREAM_INTERRUPTED" : error.code;
    return { code, requestId, status: phase === "response" ? undefined : error.status,
      upstreamStatus: error instanceof ModelServiceError ? error.upstreamStatus : undefined };
  }
  const code = phase === "response" ? "IPW_MODEL_STREAM_INTERRUPTED"
    : phase === "gateway" && isModelTransportError(error) ? "IPW_MODEL_GATEWAY_CONNECTION_FAILED"
    : phase === "gateway" && error instanceof Error && error.name === "TimeoutError" ? "IPW_MODEL_GATEWAY_TIMEOUT"
    : "IPW_MODEL_PROXY_FAILED";
  return { code, requestId, status: phase === "response" ? undefined : 503, upstreamStatus: undefined };
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
  constructor(config: ConstructorParameters<typeof pi.PiAiAdapter>[0],
    private readonly track: (open: ModelStream) => AsyncIterable<StreamChunk>) { super(config); }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.track(() => officialModelStream(super.stream(options), this.cloudOnly));
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await super.prepareCall(provider, model, signal);
    return { ...prepared, stream: options => this.track(() => officialModelStream(prepared.stream(options), this.cloudOnly)) };
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
  // pi-ai flattens HTTP and stream errors. Correlate only this invocation's safe facts
  // through the public header hook, and release them when its adapter stream closes.
  const attempts = new Map<string, ModelAttempt>();
  const current = new AsyncLocalStorage<ModelAttempt>();
  async function* track(open: ModelStream): AsyncIterable<StreamChunk> {
    const attempt: ModelAttempt = { id: randomUUID() };
    attempts.set(attempt.id, attempt);
    let iterator: AsyncIterator<StreamChunk> | undefined;
    try {
      iterator = open()[Symbol.asyncIterator]();
      const source = iterator;
      for (;;) {
        const next = await current.run(attempt, () => source.next());
        if (next.done) return;
        const chunk = next.value;
        const failure = attempt.failure;
        if (failure && chunk.type === "finish" && chunk.reason.kind === "error"
          && chunk.reason.failure.code !== ACCOUNT_QUOTA_EXCEEDED_CODE) {
          yield { ...chunk, reason: { ...chunk.reason, failure: {
            code: failure.code, ...(failure.status === undefined ? {} : { status: failure.status }),
            message: JSON.stringify(failure),
          } } };
        } else yield chunk;
      }
    } finally {
      attempts.delete(attempt.id);
      await iterator?.return?.();
    }
  }
  const adapter = new OfficialModelAdapter({
    profiles: () => profiles,
    prepareHeaders: (request, headers) => {
      if (request.sessionId) headers.set("X-iPollo-Session", request.sessionId);
      const attempt = current.getStore();
      if (attempt) headers.set("X-iPollo-Model-Call", attempt.id);
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
  }, track);
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
        const signal = AbortSignal.any([controller.signal, lifetime.signal]);
        const call = req.headers["x-ipollo-model-call"];
        const attempt = typeof call === "string" ? attempts.get(call) : undefined;
        const requestId = attempt?.id ?? randomUUID();
        let phase: "request" | "gateway" | "response" = "request";
        const report = (error: unknown) => {
          const failure = modelDiagnostic(error, phase, requestId);
          if (attempt) attempt.failure = failure;
          const cause = error instanceof Error ? error.cause : undefined;
          const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
          const reason = typeof code === "string" && /^(?:E|UND_ERR_)[A-Z0-9_]{1,48}$/.test(code) ? code : failure.code;
          if (phase === "response" || (failure.status ?? 0) >= 500)
            ctx.logger.warn("Official model proxy failed: request %s, phase %s, reason %s", requestId, phase, reason);
          return failure;
        };
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
          const body = Buffer.concat(chunks).toString("base64");
          const invoke = async (replayOnly?: true) => {
            if (generation !== account.generation) throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
            const response = await account.execute(
              match[1]!,
              {
                requestId,
                path: "/chat/completions",
                method: "POST",
                body,
                contentType: "application/json",
                ...(replayOnly ? { replayOnly } : {}),
              },
              signal,
              projectId,
            );
            if (generation !== account.generation) {
              await response.body?.cancel();
              throw new SuiteError("IPW_ACCOUNT_CHANGED", 409);
            }
            return response;
          };
          const response = await recoverModelRequest(invoke, signal);
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
                  try {
                    yield* readModelResponse(response, requestId, () => invoke(true), signal);
                  } catch (error) {
                    if (!signal.aborted) report(error);
                    throw error;
                  }
                })(),
              ),
              res,
            );
          else res.end();
        } catch (error) {
          if (res.headersSent || signal.aborted) res.destroy();
          else {
            const failure = report(error);
            res.writeHead(failure.status ?? 503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { ...failure, message: failure.code } }));
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
