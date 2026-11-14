/** Official chat services mount through DSH's existing pi-ai adapter. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveRetryPolicy, ACCOUNT_QUOTA_EXCEEDED_CODE, type GenerateOptions, type StreamChunk, type PreparedAdapterCall } from "@deepseek-ai/dsh-llm";
import { SuiteError } from "./errors.ts";
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
async function* officialModelStream(stream: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  for await (const chunk of stream) {
    if (chunk.type === "finish" && chunk.reason.kind === "error"
      && chunk.reason.failure.message.includes("INSUFFICIENT_POINTS")) {
      yield { ...chunk, reason: { kind: "error", failure: {
        code: ACCOUNT_QUOTA_EXCEEDED_CODE,
        message: "Insufficient iPolloWork points. Add points or switch to your own API key.",
      } } };
    } else yield chunk;
  }
}
class OfficialModelAdapter extends pi.PiAiAdapter {
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return officialModelStream(super.stream(options));
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await super.prepareCall(provider, model, signal);
    return { ...prepared, stream: options => officialModelStream(prepared.stream(options)) };
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
  let profiles = new Map<string, pi.ResolvedPiAiProviderProfile>(),
    facts = "",
    serial = Promise.resolve();
  const adapter = new OfficialModelAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => token,
    auth: {
      credentials: new InMemoryCredentialStore(),
      authContext: defaultProviderAuthContext(),
    },
  });
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
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 16 * 1024 * 1024) throw Error("request limit");
            chunks.push(Buffer.from(chunk));
          }
          const response = await account.execute(
            match[1]!,
            {
              requestId: randomUUID(),
              path: "/chat/completions",
              method: "POST",
              body: Buffer.concat(chunks).toString("base64"),
              contentType: "application/json",
            },
            AbortSignal.any([controller.signal, lifetime.signal]),
          );
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

  return () => {
    serial = serial
      .catch(() => {})
      .then(async () => {
        const generation = services.generation;
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
        const next = JSON.stringify(models.map((s) => [s.id, s.models]));
        if (next === facts) return;
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
              ...(known.thinkingLevelMap ? { thinkingLevelMap: known.thinkingLevelMap } : {}),
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
                input: ["text" as const],
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
            requestImagePixelBudget: 1000000,
            requestImageMaxBytes: 1000000,
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
        profiles = nextProfiles;
        if (registration) registration.replace([...profiles.keys()]);
        else if (profiles.size)
          registration = ctx.llm.registerAdapter([...profiles.keys()], adapter);
        facts = next;
        services.modelStatus = "ready";
        services.modelError = "";
        await initializeDefault?.([...profiles.keys()]);
      });
    return serial;
  };
}
