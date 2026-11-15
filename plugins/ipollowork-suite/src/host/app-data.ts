/**
 * App data in DSH. The account service keeps the records; this module exposes them as the Host `ipolloData` service for
 * plugins, the `app_data` tool and `app-data` skill for the model, and the routes behind the Data page and the browser
 * `ipolloData` service. Every call uses the signed-in account, so plugins and the model never hold a token or a
 * database connection.
 */
import { z } from 'zod'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AccountService } from './account.ts'
import { AppDataRejection, SuiteError } from './errors.ts'
import { createDataApp, type DataApp, type DataAppDetail, type DataAppKind, type DataAppList, type IpolloData } from '../shared/app-data.ts'

const BASE = '/api/data/v1/apps'
const kinds = z.enum(['plugin', 'site'])
const owner = z.object({ kind: z.enum(['user', 'enterprise']), id: z.string(), name: z.string() })
const summary = z.object({
  id: z.uuid(), kind: kinds, name: z.string(), slug: z.string(), workspace: z.string(), owner, public: z.boolean(), suspended: z.boolean().default(false),
  collections: z.number(), records: z.number(), bytes: z.number(), canManage: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
})
const detail = summary.extend({
  endpoint: z.string(), publicKey: z.string(), signin: z.string().default(''), origins: z.array(z.string()).default([]),
  roles: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.string() })).default([]),
  limits: z.object({ records: z.number(), bytes: z.number(), recordBytes: z.number() }),
  collectionList: z.array(z.object({
    name: z.string(), fields: z.record(z.string(), z.enum(['text', 'number', 'boolean', 'json'])),
    public: z.array(z.enum(['read', 'create'])), users: z.array(z.enum(['read', 'create', 'own'])).default([]), unique: z.array(z.string()).nullable(), strict: z.boolean().default(false), records: z.number(), bytes: z.number(),
  })),
})
const result = z.record(z.string(), z.json())
type Result = z.infer<typeof result>
/** How long a name keeps pointing at the app it opened without asking the account service again. */
const REMEMBER_MS = 300_000
const openInput = z.object({ name: z.string().trim().min(1).max(80), organization: z.string().min(1).max(200).optional() }).strict()

/** Account-backed app data; one instance per suite Host. */
export class AppDataService implements IpolloData {
  /** Apps opened by name, valid for the signed-in account that opened them. */
  private readonly opened = new Map<string, { id: string; generation: number; at: number }>()
  constructor(private readonly account: AccountService) {}

  private static key(name: string, organization: string | undefined): string {
    return `${(organization ?? '').toLowerCase()}\n${name.trim().toLowerCase()}`
  }
  /**
   * @param name - the app name.
   * @param organization - organization name or id, or undefined for personal apps.
   * @returns the id this name recently opened for the current account, without a request.
   */
  remembered(name: string, organization?: string): string | undefined {
    const key = AppDataService.key(name, organization)
    const hit = this.opened.get(key)
    if (hit && hit.generation === this.account.generation && Date.now() - hit.at < REMEMBER_MS) return hit.id
    this.opened.delete(key)
    return undefined
  }
  private remember(name: string, organization: string | undefined, id: string): void {
    this.opened.set(AppDataService.key(name, organization), { id, generation: this.account.generation, at: Date.now() })
  }
  private forget(id: string): void {
    for (const [key, hit] of this.opened) if (hit.id === id) this.opened.delete(key)
  }
  /**
   * The id of the app with this name, creating the app on first use and remembering it afterwards.
   * @param input - app name, the kind recorded when it is created, an optional organization and the creating workspace's title.
   * @param signal - cancels the request.
   * @returns the app id.
   */
  async id(input: { name: string; kind: DataAppKind; organization?: string | undefined; workspace?: string | undefined }, signal?: AbortSignal): Promise<string> {
    return this.remembered(input.name, input.organization) ?? (await this.ensure(input, signal)).id
  }

  /**
   * @param signal - cancels the request.
   * @returns the signed-in account's personal and organization apps, and every organization it belongs to.
   */
  async apps(signal?: AbortSignal): Promise<DataAppList> {
    return z.object({ items: z.array(summary), organizations: z.array(z.object({ id: z.string(), name: z.string() })) })
      .parse(await this.account.request(BASE, undefined, undefined, signal))
  }
  /**
   * Return the app with this name, creating it on first use.
   * @param input - app name, the kind recorded when it is created, an optional organization name or id, and the creating workspace's title.
   * @param signal - cancels the request.
   * @returns the app detail.
   */
  async ensure(input: { name: string; kind: DataAppKind; organization?: string | undefined; workspace?: string | undefined }, signal?: AbortSignal): Promise<DataAppDetail> {
    const enterpriseId = input.organization ? await this.organization(input.organization, signal) : undefined
    const body = { name: input.name, kind: input.kind, ...(enterpriseId ? { enterpriseId } : {}), ...(input.workspace ? { workspace: input.workspace } : {}) }
    const app = z.object({ app: detail }).parse(await this.account.request(BASE, body, undefined, signal)).app
    this.remember(input.name, input.organization, app.id)
    return app
  }
  /**
   * @param id - the app id.
   * @returns the app detail with its collections.
   */
  async detail(id: string): Promise<DataAppDetail> {
    return z.object({ app: detail }).parse(await this.account.request(`${BASE}/${encodeURIComponent(id)}`)).app
  }
  /**
   * Delete an app; the account service purges its records.
   * @param id - the app id.
   */
  async remove(id: string): Promise<void> {
    await this.account.request(`${BASE}/${encodeURIComponent(id)}`, undefined, 'DELETE')
    this.forget(id)
  }
  /**
   * Run one statement or `{batch}` against an app.
   * @param id - the app id.
   * @param statement - the JSON statement.
   * @param signal - cancels the request; a write may still have committed.
   * @returns the statement result.
   */
  async run(id: string, statement: unknown, signal?: AbortSignal): Promise<Result> {
    try {
      return result.parse(await this.account.request(`${BASE}/${encodeURIComponent(id)}/run`, statement, undefined, signal))
    } catch (error) {
      // The app was deleted or left the account's reach; its name must be resolved again.
      if (error instanceof AppDataRejection && error.code === 'DATA_APP_NOT_FOUND') this.forget(id)
      throw error
    }
  }
  /**
   * Find an existing app by name without creating it.
   * @param name - the app name; letter case and surrounding spaces are ignored.
   * @param organization - organization name or id, or undefined for personal apps.
   * @param signal - cancels the requests.
   * @returns the app and the owner's other apps, so a miss can name what exists.
   */
  async find(name: string, organization?: string, signal?: AbortSignal): Promise<{ app: DataAppList['items'][number] | undefined; others: DataAppList['items'] }> {
    const enterpriseId = organization ? await this.organization(organization, signal) : undefined
    const owned = (await this.apps(signal)).items.filter(app => (enterpriseId ? app.owner.id === enterpriseId : app.owner.kind === 'user'))
    const wanted = name.trim().toLowerCase()
    const app = owned.find(item => item.name.trim().toLowerCase() === wanted)
    if (app) this.remember(name, organization, app.id)
    return { app, others: owned }
  }
  async open(name: string, options: { organization?: string } = {}): Promise<DataApp> {
    const input = { name, kind: 'plugin' as const, organization: options.organization }
    let id = await this.id(input)
    return createDataApp(id, async statement => {
      try {
        return await this.run(id, statement)
      } catch (error) {
        if (!(error instanceof AppDataRejection) || error.code !== 'DATA_APP_NOT_FOUND') throw error
        id = await this.id(input)
        return this.run(id, statement)
      }
    })
  }
  private async organization(value: string, signal?: AbortSignal): Promise<string> {
    const items = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) })
      .parse(await this.account.request('/api/v1/me/orgs', undefined, undefined, signal)).items
    const found = items.find(item => item.id === value) ?? items.find(item => item.name.toLowerCase() === value.toLowerCase())
    if (!found)
      throw new AppDataRejection('IPW_ORGANIZATION_NOT_FOUND', 404,
        `你不在名为「${value}」的组织中；可用组织：${items.map(item => item.name).join('、') || '无，请省略 organization 使用个人应用'}`)
    return found.id
  }
}

/**
 * Handle a Data page or browser `ipolloData` request below `/data/apps`.
 * @param service - the app data service.
 * @param method - the HTTP method.
 * @param path - the path after `/data/apps`.
 * @param read - reads the JSON request body.
 * @returns the JSON response body.
 */
export async function appDataRoute(service: AppDataService, method: string, path: string, read: () => Promise<unknown>): Promise<unknown> {
  if (path === '' && method === 'GET') return service.apps()
  if (path === '' && method === 'POST') {
    const input = openInput.parse(await read())
    return { app: { id: await service.id({ name: input.name, kind: 'plugin', organization: input.organization }) } }
  }
  const match = /^\/([0-9a-f-]{36})(\/run)?$/.exec(path)
  if (!match) throw new SuiteError('IPW_NOT_FOUND', 404)
  const id = match[1]!
  if (match[2] && method === 'POST') return service.run(id, await read())
  if (!match[2] && method === 'GET') return { app: await service.detail(id) }
  if (!match[2] && method === 'DELETE') {
    await service.remove(id)
    return { deleted: true }
  }
  throw new SuiteError('IPW_NOT_FOUND', 404)
}

/** Explain a signed-out account to the model instead of returning a bare code. */
async function signedIn<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof SuiteError && error.code === 'IPW_SIGN_IN_REQUIRED' && !(error instanceof AppDataRejection))
      throw new AppDataRejection(error.code, 401, 'The user is not signed in to iPolloWork. Ask them to sign in under Settings → iPolloWork account, then retry.')
    throw error
  }
}

const READS = new Set(['get', 'find', 'count', 'aggregate', 'info', 'me', 'preview'])
/** Whether a statement or batch only reads; reads never create an app. */
function reads(statement: Record<string, unknown>): boolean {
  const list = Array.isArray(statement.batch) ? (statement.batch as Record<string, unknown>[]) : [statement]
  return list.every(item => item !== null && typeof item === 'object' && Object.keys(item).some(key => READS.has(key)))
}
type Session = NonNullable<ToolRunContext['agent']>['session']
/**
 * The model's app data tool. A new app records its kind and the title of the workspace it was created from. Reads run
 * concurrently; writes run in call order and are refused in read-only sessions, because they change account data.
 * @param service - the app data service.
 * @param workspaceOf - resolves a session's working directory to its workspace title.
 * @param readOnly - whether the session's sandbox policy is read-only.
 * @returns the tool definition.
 */
export function appDataTool(
  service: AppDataService,
  workspaceOf: (cwd: string | undefined) => string | undefined,
  readOnly: (session: Session) => boolean,
): ToolDefinition {
  return defineTool({
    name: 'app_data',
    description: [
      'Keep records for a website, app, mini program or DSH plugin without running a database. Read the app-data skill before writing code that uses it.',
      'An app is created by its first write and holds collections of JSON records; reads of an unknown app list the existing apps instead; each field\'s type (text, number, boolean or json) is fixed by its first value. Store dates as ISO text such as "2026-11-15" so they sort, filter and group. Record ids are short keys such as "profile" or generated UUIDs.',
      'Statements:',
      '{"insert":"bookings","values":{"name":"Ann","slot":10}} (values may be an array of up to 100 records);',
      '{"find":"bookings","where":{"slot":{">=":9},"status":"open"},"search":"ann","sort":"-createdAt","limit":20,"after":"<next from the previous page>"} (search matches the id and any text or number field, ignoring case);',
      '"fields":["name","slot"] on find or get returns only those fields; use it to keep results small.',
      '{"get":"bookings","id":"…"}; {"count":"bookings","where":{…}};',
      '{"aggregate":"orders","where":{…},"group":"day","sum":["total"],"avg":["total"],"min":["total"],"max":["total"],"sort":"-count","limit":50} returns {"items":[{"key":"2026-11-15","count":3,"sum":{"total":96}}]}; without group it returns one row of totals. Use it for totals, rankings and charts instead of reading every record;',
      '{"update":"bookings","id":"…","set":{"status":"done"},"version":2} (merges fields; null removes one; version rejects a stale write); {"update":"items","id":"…","inc":{"stock":-1}} adds to a number atomically;',
      '{"upsert":"settings","id":"profile","values":{…}} (creates the record or replaces all of its fields);',
      '{"delete":"bookings","id":"…"};',
      '{"define":"bookings","fields":{"name":"text","slot":"number"},"public":["create"],"unique":["date","slot"]} ("read" lets anyone holding the public key read, "create" lets them submit one record at a time; visitors write only declared fields; unique needs an empty collection; "strict":true makes every write use only declared fields, so a misspelled field is rejected; "remove":["typo"] deletes a field and its values);',
      'define also takes "users":["read","create","own"] for visitors signed in with their iPollo account: read every record, create one, or read and change the records they created (see the skill for the sign-in code);',
      '{"grant":"admin","email":"a@b.c"} makes that account an administrator of the app, who may change every record from the page; other role names are labels the page reads with {"me":true}; {"revoke":"a@b.c"} removes the role; {"origins":["https://example.com"]} allows sign-in from a page on its own domain;',
      '{"drop":"bookings"}; {"info":true} lists collections, fields, roles, the endpoint, the public key and the sign-in address;',
      '{"preview":"user"} or {"preview":"admin"} returns a two-hour visitor token for testing the page signed in, as an ordinary visitor or as an administrator;',
      '{"batch":[…]} runs up to 20 statements atomically.',
      'Where operators: =, !=, >, >=, <, <=, in, contains (text); null matches a missing field. Records also carry id, version, createdAt and updatedAt.',
      'Errors name the existing collections and fields so the statement can be corrected.',
    ].join(' '),
    parameters: {
      app: { type: 'string', required: true, description: 'App name, usually the website, app or plugin name. The same name reopens the same app; a plugin\'s code opens it with this name.' },
      kind: { type: 'string', enum: ['plugin', 'site'], required: true, description: '"plugin" when a DSH plugin uses the records; "site" when a website, app or mini program that visitors open uses them. Recorded only when the app is created.' },
      organization: { type: 'string', description: 'Organization name or id when the records belong to an organization. Omit for a personal app.' },
      statement: { type: 'object', additionalProperties: true, required: true, description: 'One statement, or {"batch":[…]}.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: args => reads(args.statement),
    async execute(args, exec) {
      const signal = exec.signal
      return signedIn(async () => {
        const gone = (error: unknown) => error instanceof AppDataRejection && error.code === 'DATA_APP_NOT_FOUND'
        if (reads(args.statement)) {
          const known = service.remembered(args.app, args.organization)
          if (known) {
            try {
              return await service.run(known, args.statement, signal)
            } catch (error) {
              if (!gone(error)) throw error
            }
          }
          const { app, others } = await service.find(args.app, args.organization, signal)
          // Models look before they write; an app that does not exist yet is an answer, not a failure.
          if (!app && 'info' in args.statement)
            return {
              app: null,
              note: `No app is named "${args.app}" yet. The first define, insert or upsert creates it; reads never do.`,
              existing: others.map(item => ({ name: item.name, kind: item.kind })),
            }
          if (!app)
            throw new AppDataRejection('DATA_APP_NOT_FOUND', 404,
              `No app is named "${args.app}" yet; reads do not create apps, and the first write does. Existing apps: ${others.map(item => `${item.name} (${item.kind})`).join(', ') || 'none'}.`)
          return service.run(app.id, args.statement, signal)
        }
        const session = exec.agent?.session
        if (session && readOnly(session))
          throw new AppDataRejection('IPW_DATA_READ_ONLY', 403,
            'This session is read-only, so app data writes are refused; reads still work. Ask the user to switch the session to a writable mode before changing records.')
        const input = { name: args.app, kind: args.kind, organization: args.organization, workspace: workspaceOf(session?.header.cwd) }
        try {
          return await service.run(await service.id(input, signal), args.statement, signal)
        } catch (error) {
          if (!gone(error)) throw error
          return service.run(await service.id(input, signal), args.statement, signal)
        }
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: `App data · ${args.app}`,
      kind: reads(args.statement) ? 'read' : 'edit',
    }),
  })
}

/** The `app-data` skill: the complete contract for page code, plugin Host halves and plugin Client modules. */
export const APP_DATA_SKILL = {
  name: 'app-data',
  description: 'Save and query records for a website, app, mini program or DSH plugin without a database: the app_data tool, page code with a public key, and the ipolloData service in plugin Host and Client code.',
  content: `# App data

Use app data when a website, app, mini program or DSH plugin must keep records and the user supplied no database. It is the signed-in iPolloWork account's hosted store. Systems needing joins, server logic or payments need their own back end.

Every caller uses the same JSON statements listed by the \`app_data\` tool. Field types (text, number, boolean, json) are fixed by first use; store dates as ISO text (\`2026-11-15\`) so they sort and group. Ask the service for totals with \`aggregate\` and pass \`fields\` to \`find\` instead of loading whole collections. Once the collections are right, run \`define\` with \`"strict":true\` so a misspelled field is rejected; \`"remove":["typo"]\` deletes a mistaken field. Ids are short keys such as \`profile\` or generated UUIDs. Errors name the existing collections and fields.

## DSH plugin

Pick the plugin's display name as the app name and keep it. The suite provides the \`ipolloData\` service with the same contract on the Host and in the browser.

Client module (\`client.js\`): add \`"@ipollo/dsh-suite"\` to \`dsh.client.inject\` in \`package.json\` so the suite loads first, then inject the service:

\`\`\`js
return {
  inject: ['slots', 'ipolloData'],
  apply(ctx) {
    const workouts = async () => (await ctx.ipolloData.open('Fitness coach')).collection('workouts')
    // In a component or handler:
    // await (await workouts()).insert({ exercise: 'squat', reps: 12, day: '2026-11-15' })
    // const { items } = await (await workouts()).find({ where: { day: '2026-11-15' }, sort: '-createdAt' })
  },
}
\`\`\`

Host half (\`index.js\`): \`export const inject = ['ipolloData']\` and call \`ctx.ipolloData.open(name)\` the same way.

\`open(name, { organization })\` returns \`{ id, run(statement), collection(name) }\`. A collection has \`insert(values)\`, \`get(id)\`, \`find({ where, search, fields, sort, limit, after })\` returning \`{ items, next }\`, \`count(where)\`, \`aggregate({ where, group, sum, avg, min, max, sort, limit })\` returning rows like \`{ key, count, sum: { reps: 36 } }\`, \`update(id, set, version?)\`, \`increment(id, { stock: -1 })\`, \`upsert(id, values, version?)\` and \`delete(id, version?)\`. Use \`upsert\` with a fixed id for single documents such as settings or today's plan. \`ipolloData\` is not listed by service inspection, so do not look it up there; use it as written here. Calls use the signed-in account and need no key; signed out, they reject with \`IPW_SIGN_IN_REQUIRED\`, so show a sign-in hint instead of failing silently. Open inside handlers, not at load. Rejections carry \`code\` and a message that explains the fix.

Before writing plugin code you may create the collections with \`app_data\` (\`kind: "plugin"\`, the same app name) and inspect them with \`{"info":true}\`.

## Website, app or mini program

1. With \`app_data\` (\`kind: "site"\`), run \`define\` for every collection the page writes. Declare its fields and only the public access visitors need: \`"public":["create"]\` for forms such as bookings or sign-ups, \`"public":["read"]\` for content the page lists. Collections without \`public\` stay private to the owner.
2. Run \`{"info":true}\` and copy \`endpoint\`, \`publicKey\` and, when visitors sign in, \`signin\` into the page code.

\`\`\`js
const DATA = { endpoint: '<endpoint>', key: '<publicKey>', signin: '<signin>' }
const token = () => localStorage.getItem('ipollo_token')
async function data(statement) {
  const response = await fetch(DATA.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Data-Key': DATA.key, ...(token() ? { Authorization: 'Bearer ' + token() } : {}) },
    body: JSON.stringify(statement),
  })
  const body = await response.json()
  if (!response.ok) throw Object.assign(new Error(body.error), { code: body.code, status: response.status })
  return body
}
await data({ insert: 'bookings', values: { name, date, slot } })
const { items } = await data({ find: 'menu', sort: 'price' })
\`\`\`

### Visitors who sign in

A page can have members, personal data and staff: visitors sign in with their iPollo account, and the page never handles passwords.

- \`define\` takes \`"users"\`: \`"read"\` lets signed-in visitors read every record, \`"create"\` lets them add one, \`"own"\` lets them read, update and delete the records they created; with \`"own"\` and no \`"read"\` each visitor sees only their own. Comments: \`"public":["read"],"users":["create","own"]\`. Private per-user data such as orders or profiles: \`"users":["create","own"]\`.
- Sign in by sending the visitor to \`DATA.signin + '&return=' + encodeURIComponent(location.href)\`. They return with \`#ipollo_token=…\`:

\`\`\`js
const got = location.hash.match(/ipollo_token=([^&]+)/)
if (got) { localStorage.setItem('ipollo_token', got[1]); history.replaceState(null, '', location.pathname + location.search) }
const { user } = await data({ me: true }) // null, or { id, name, role }
\`\`\`

- On a 401 remove the token and offer sign-in again. Signing out is removing the token.
- Roles: \`role\` is \`user\` unless granted. With \`app_data\`, \`{"grant":"admin","email":"a@b.c"}\` makes an account an administrator, who reads and changes every record of the app from the page (not its collections); the app's owner always is one. Other names such as \`staff\` are labels for the page's own logic. The owner can also manage administrators on the Data page.
- A page on its own domain must be allowed once: \`{"origins":["https://example.com"]}\`. Pages published by iPollo and localhost need nothing.

- A record a signed-in visitor creates belongs to them, also in a collection that allows public create.
- To test the signed-in page yourself, run \`{"preview":"user"}\` or \`{"preview":"admin"}\` with \`app_data\` and open the page with \`#ipollo_token=<token>\`; the token is yours and lasts two hours.

A rejected call answers \`{ "error": "<explanation>", "code": "<CODE>" }\`. Handle these in page code: \`DATA_DUPLICATE\` (409, a \`unique\` value such as a booked slot is taken), \`DATA_RATE_LIMITED\` (429, try again shortly), \`DATA_SIGNIN_EXPIRED\` (401, sign in again), \`DATA_FORBIDDEN\` (403, this visitor may not do that), \`DATA_APP_SUSPENDED\` (403, the service is paused). Anything else is a mistake in the statement; its \`error\` text says what to fix.

Every visitor can see the public key. It reads or creates only in collections whose \`public\` allows it, writes one record per request and is rate-limited per visitor. Visitors cannot update or delete, so keep private data out of publicly readable collections. A \`unique\` collection rejects a second record with the same values, which suits booked time slots. The owner reviews records with \`app_data\` or the Data page.
`,
} as const
