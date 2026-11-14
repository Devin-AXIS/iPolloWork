/** Shared routing and local choices over the native credential store. */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { AccountService } from './account.ts'
import type { CredentialStore } from '../shared/types.ts'
import type {
  OfficialService,
  ServiceCatalog,
  ServiceChoice,
  ServiceCenter,
  ServiceBinding,
} from '../shared/services.ts'
import { SuiteError } from './errors.ts'
const KEY = 'ipollowork-suite/services'
const choiceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('own') }).strict(),
  z
    .object({
      source: z.literal('official'),
      serviceId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    })
    .strict(),
])
const serviceSchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string(),
  capabilities: z.array(z.string()),
  origin: z.string().url(),
  basePath: z.string(),
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      contextWindow: z.number(),
      maxTokens: z.number(),
    }),
  ),
  routes: z.array(
    z.object({ method: z.string(), path: z.string(), points: z.number() }),
  ),
  available: z.boolean(),
})
const catalogSchema = z.object({
  items: z.array(serviceSchema),
  points: z.number(),
})
export class Services implements ServiceCenter {
  get generation() {
    return this.account.generation
  }
  modelStatus = 'pending'
  modelError = ''
  constructor(
    private account: AccountService,
    private credentials: CredentialStore,
    private signal: AbortSignal,
    private enabled = true,
  ) {}
  async choices(): Promise<Record<string, ServiceChoice>> {
    const record = await this.credentials.readRecord(KEY)
    if (!record) return {}
    const value = record.payload
    if (record.kind !== 'grant' || !value || typeof value !== 'object')
      throw new SuiteError('IPW_INVALID_SERVICE_CHOICES', 500)
    return z.record(z.string(), choiceSchema).parse(value)
  }
  async choose(provider: string, raw: unknown) {
    const choice = choiceSchema.parse(raw)
    if (
      !/^[a-z][a-z0-9-]{0,79}$/.test(provider) ||
      !choice ||
      !['own', 'official'].includes(choice.source) ||
      (choice.source === 'official' &&
        !/^[a-z][a-z0-9-]{0,79}$/.test(choice.serviceId))
    )
      throw new SuiteError('IPW_INVALID_INPUT')
    if (
      choice.source === 'official' &&
      !(await this.catalog()).items.some(
        (s) =>
          s.provider === provider && s.id === choice.serviceId && s.available,
      )
    )
      throw new SuiteError('IPW_SERVICE_UNAVAILABLE', 409)
    await this.credentials.modifyRecord(KEY, async (current) => {
      const payload =
        current &&
        typeof current === 'object' &&
        'payload' in current &&
        current.payload &&
        typeof current.payload === 'object'
          ? current.payload
          : {}
      return { kind: 'grant', payload: { ...payload, [provider]: choice } }
    })
  }
  async catalog(): Promise<ServiceCatalog> {
    if (!this.enabled) return { items: [], points: 0 }
    try {
      return catalogSchema.parse(await this.account.request('/api/v1/services'))
    } catch (error) {
      if (
        error instanceof SuiteError &&
        (error.code === 'IPW_SIGN_IN_REQUIRED' || error.status === 404)
      )
        return { items: [], points: 0 }
      throw error
    }
  }
  async state() {
    return {
      catalog: await this.catalog(),
      choices: await this.choices(),
      models: { status: this.modelStatus, error: this.modelError },
    }
  }
  /** Freeze source selection for the complete caller operation. Never fall back after a routed failure. */
  async bind(signal?: AbortSignal): Promise<ServiceBinding> {
    const generation = this.account.generation
    const choices = await this.choices()
    let selected: Map<string, OfficialService> | undefined
    let loading: Promise<Map<string, OfficialService>> | undefined
    const resolve = () =>
      (loading ??= (async () => {
        const catalog = await this.catalog(),
          entries = new Map<string, OfficialService>()
        for (const service of catalog.items) {
          const choice = choices[service.provider]
          if (choice?.source === 'own') continue
          if (
            choice?.source === 'official'
              ? choice.serviceId === service.id
              : service.available && !entries.has(service.provider)
          )
            entries.set(service.provider, service)
        }
        selected = entries
        return entries
      })())
    const invoke = async (
      service: OfficialService,
      path: string,
      request: Request,
    ) => {
      if (!service.available)
        throw new SuiteError('IPW_SERVICE_UNAVAILABLE', 403)
      const body =
        request.method === 'GET'
          ? undefined
          : Buffer.from(await request.arrayBuffer()).toString('base64')
      if (generation !== this.account.generation)
        throw new SuiteError('IPW_ACCOUNT_CHANGED', 409)
      return this.account.execute(
        service.id,
        {
          requestId: randomUUID(),
          path,
          method: request.method,
          contentType: request.headers.get('content-type') ?? undefined,
          body,
        },
        AbortSignal.any([
          this.signal,
          ...(signal ? [signal] : []),
          request.signal,
        ]),
      )
    }
    return {
      official: async (provider, hasOwnKey = false) => {
        const choice = choices[provider]
        if (choice?.source === 'own') return false
        if (choice?.source !== 'official' && hasOwnKey) return false
        const service = (await resolve()).get(provider)
        if (choice?.source === 'official' && !service?.available)
          throw new SuiteError('IPW_SERVICE_UNAVAILABLE', 403)
        return Boolean(service?.available)
      },
      request: async (provider, path, init) => {
        if (!path.startsWith('/') || path.startsWith('//'))
          throw new SuiteError('IPW_INVALID_INPUT')
        const service = (await resolve()).get(provider)
        if (!service) throw new SuiteError('IPW_SERVICE_UNAVAILABLE', 403)
        return invoke(
          service,
          path,
          new Request(service.origin + service.basePath + path, init),
        )
      },
      fetch: async (input, init) => {
        if (generation !== this.account.generation)
          throw new SuiteError('IPW_ACCOUNT_CHANGED', 409)
        const headers = new Headers(
          init?.headers ??
            (input instanceof Request ? input.headers : undefined),
        )
        if (
          ![...headers.values()].some((value) =>
            value.includes('ipollo-managed'),
          )
        )
          return fetch(input, init)
        const entries = await resolve(),
          url = new URL(input instanceof Request ? input.url : String(input))
        const service = [...entries.values()].find(
          (s) =>
            s.origin === url.origin &&
            (url.pathname === s.basePath ||
              url.pathname.startsWith(s.basePath + '/')),
        )
        if (!service) throw new SuiteError('IPW_SERVICE_ENDPOINT_MISMATCH', 409)
        return invoke(
          service,
          url.pathname.slice(service.basePath.length) + url.search,
          new Request(input, init),
        )
      },
    }
  }
}
