/** Official chat services mount through DSH's existing pi-ai adapter. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import {
  createProvider,
  envApiKeyAuth,
  InMemoryCredentialStore,
  defaultProviderAuthContext,
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { Context } from '@deepseek-ai/cordis'
import { randomBytes, randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import * as pi from '@deepseek-ai/dsh-llm-pi-ai'
import type { Services } from './services.ts'
import type { AccountService } from './account.ts'
export interface ModelWebServer {
  getOrigin(): string
  register(route: {
    kind: 'prefix'
    path: string
    handler(req: IncomingMessage, res: ServerResponse): Promise<void>
  }): () => void
}
export function mountServiceModels(
  ctx: Context,
  webServer: ModelWebServer,
  services: Services,
  account: AccountService,
): () => Promise<void> {
  const token = randomBytes(32).toString('hex'),
    lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())
  let profiles = new Map<string, pi.ResolvedPiAiProviderProfile>(),
    facts = '',
    serial = Promise.resolve()
  const adapter = new pi.PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => token,
    auth: {
      credentials: new InMemoryCredentialStore(),
      authContext: defaultProviderAuthContext(),
    },
  })
  let registration: ReturnType<Context['llm']['registerAdapter']> | undefined
  ctx.effect(() =>
    webServer.register({
      kind: 'prefix',
      path: '/ipollo-service-models',
      handler: async (req, res) => {
        if (req.headers.authorization !== 'Bearer ' + token) {
          res.writeHead(401)
          res.end()
          return
        }
        const controller = new AbortController()
        res.on('close', () => controller.abort())
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const match =
            /^\/ipollo-service-models\/([a-z0-9-]+)\/v1\/chat\/completions$/.exec(
              url.pathname,
            )
          if (!match || req.method !== 'POST') {
            res.writeHead(404)
            res.end()
            return
          }
          const chunks: Buffer[] = []
          let length = 0
          for await (const chunk of req) {
            length += chunk.length
            if (length > 16 * 1024 * 1024) throw Error('request limit')
            chunks.push(Buffer.from(chunk))
          }
          const response = await account.execute(
            match[1]!,
            {
              requestId: randomUUID(),
              path: '/chat/completions',
              method: 'POST',
              body: Buffer.concat(chunks).toString('base64'),
              contentType: 'application/json',
            },
            AbortSignal.any([controller.signal, lifetime.signal]),
          )
          res.writeHead(response.status, {
            'Content-Type':
              response.headers.get('content-type') ?? 'application/json',
            'Cache-Control': 'no-store',
          })
          if (response.body)
            await pipeline(
              Readable.from(
                (async function* () {
                  const reader = response.body!.getReader()
                  try {
                    while (true) {
                      const value = await reader.read()
                      if (value.done) return
                      yield value.value
                    }
                  } finally {
                    reader.releaseLock()
                  }
                })(),
              ),
              res,
            )
          else res.end()
        } catch {
          if (res.headersSent) res.destroy()
          else {
            res.writeHead(503)
            res.end(
              JSON.stringify({
                error: { message: 'Official model service unavailable' },
              }),
            )
          }
        }
      },
    }),
  )

  return () => {
    serial = serial
      .catch(() => {})
      .then(async () => {
        const generation = services.generation
        const catalog = await services.catalog()
        const choices = await services.choices()
        const models = catalog.items.filter(
          (s) =>
            s.available &&
            s.models.length &&
            choices[s.provider]?.source !== 'own',
        )
        if (lifetime.signal.aborted || generation !== services.generation)
          return
        const next = JSON.stringify(models.map((s) => [s.id, s.models]))
        if (next === facts) return
        const nextProfiles = new Map<string, pi.ResolvedPiAiProviderProfile>()
        for (const service of models) {
          const provider = 'ipollo-' + service.id,
            baseURL =
              webServer.getOrigin() +
              '/ipollo-service-models/' +
              service.id +
              '/v1'
          const modelList = service.models.map((model) => ({
            ...model,
            provider,
            baseUrl: baseURL,
            api: 'openai-completions' as const,
            input: ['text' as const],
            reasoning: false,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          }))
          nextProfiles.set(provider, {
            provider,
            displayName: 'iPolloWork · ' + service.title,
            api: 'openai-completions',
            baseURL,
            streamIdleTimeoutMs: 120000,
            maxRequestImageBytes: 16 * 1024 * 1024,
            maxRequestImages: 100,
            imageOffloadCountQuantum: 10,
            requestImagePixelBudget: 1000000,
            requestImageMaxBytes: 1000000,
            retryPolicy: resolveRetryPolicy(
              { mode: 'normal', maxRetries: 0 },
              'iPolloWork official service',
            ),
            modelErrors: new Map(),
            configuredMaxTokens: new Map(),
            piProvider: createProvider({
              id: provider,
              name: service.title,
              baseUrl: baseURL,
              auth: { apiKey: envApiKeyAuth('iPolloWork', []) },
              models: modelList,
              api: openAICompletionsApi(),
            }),
          })
        }
        profiles = nextProfiles
        if (registration) registration.replace([...profiles.keys()])
        else if (profiles.size)
          registration = ctx.llm.registerAdapter([...profiles.keys()], adapter)
        facts = next
        services.modelStatus = 'ready'
        services.modelError = ''
      })
    return serial
  }
}
