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
      'Hosted records for a website, app, mini program or DSH plugin, with no database to run. Load the app-data skill before writing page or plugin code that uses them.',
      'The first define, insert or upsert creates the app; reads never do. A field\'s type (text, number, boolean, json) is fixed by its first value; store dates as ISO text such as "2026-11-15".',
      'Statements, one per call, or {"batch":[…]} of up to 20 that commit together:',
      '{"insert":"c","values":{…} or [up to 100]}',
      '{"find":"c","where":{"f":"v","n":{">=":1}},"search":"text","fields":["f"],"sort":"-n","limit":20,"after":"<next>"} returns {items,next}; at most 100 per page.',
      '{"get":"c","id":"…"}; {"count":"c","where":{…}}',
      '{"aggregate":"c","where":{…},"group":"day","sum":["total"],"avg":[…],"min":[…],"max":[…],"sort":"-count"} returns {items:[{key,count,sum:{total}}]}; use it for totals and rankings instead of reading every record.',
      '{"update":"c","id":"…","set":{…},"inc":{"stock":-1},"version":2} (set merges, null removes a field); {"upsert":"c","id":"profile","values":{…}}; {"delete":"c","id":"…"}',
      '{"define":"c","fields":{"f":"text"},"public":["read","create"],"users":["read","create","own"],"unique":["date","slot"],"strict":true,"remove":["typo"]}: public is for anyone holding the page key, users for visitors signed in with iPollo, own for the records each visitor created; strict rejects undeclared fields. {"drop":"c"}',
      '{"info":true} returns collections, fields, endpoint, public key and sign-in address. Roles, sign-in and testing a signed-in page use grant, revoke, origins, me and preview, described in the skill.',
      'Where operators: =, !=, >, >=, <, <=, in, contains; null matches a missing field. Records carry id, version, createdAt and updatedAt. Errors name the existing collections and fields.',
    ].join(' '),
    parameters: {
      app: { type: 'string', required: true, description: 'The website, app or plugin name; the same name reopens the same app.' },
      kind: { type: 'string', enum: ['plugin', 'site'], required: true, description: '"plugin" for a DSH plugin; "site" for a page visitors open. Recorded when the app is created.' },
      organization: { type: 'string', description: 'Organization name or id for an organization app; omit for a personal one.' },
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

The signed-in iPolloWork account's hosted record store for websites, apps, mini programs and DSH plugins that need to save data and have no database. Systems needing joins, server logic or payments need their own back end. Statements are listed by the \`app_data\` tool; page code and plugins send the same ones.

- Name the app after the site or plugin and keep the name; \`kind\` is \`site\` or \`plugin\`.
- Create collections first with \`define\` and \`"strict":true\`, declaring every field, so a misspelled field is rejected. \`"remove":["typo"]\` deletes a field.
- Store dates as ISO text (\`2026-11-15\`). Use \`aggregate\` for totals and \`fields\` to keep reads small. \`find\` returns at most 100 records per page.
- Use \`upsert\` with a fixed id such as \`settings\` for single documents.

## DSH plugin

The suite provides \`ipolloData\` on the Host and in the browser with one contract. It is not listed by service inspection; use it as written here. In \`package.json\` add \`"@ipollo/dsh-suite"\` to \`dsh.client.inject\`.

\`\`\`js
// client.js (Host half: export const inject = ['ipolloData'] and the same calls)
return {
  inject: ['slots', 'ipolloData'],
  apply(ctx) {
    const books = async () => (await ctx.ipolloData.open('Reading notes')).collection('books')
    // in a handler:
    // await (await books()).insert({ title, rating: 4, finishedOn: '2026-11-15' })
    // const { items, next } = await (await books()).find({ sort: '-finishedOn', fields: ['title', 'rating'] })
  },
}
\`\`\`

A collection has \`insert\`, \`get\`, \`find({ where, search, fields, sort, limit, after })\`, \`all({ where, search, fields, sort })\` (every match up to 1,000), \`count(where)\`, \`aggregate({ where, group, sum, avg, min, max })\` returning rows like \`{ key, count, avg: { rating: 4.2 } }\`, \`update(id, set, version?)\`, \`increment(id, { stock: -1 })\`, \`upsert(id, values)\` and \`delete(id)\`. Open inside handlers, not at load. Signed out, calls reject with code \`IPW_SIGN_IN_REQUIRED\`: show a sign-in hint.

## Website, app or mini program

1. \`define\` each collection with the access visitors need: \`"public":["read"]\` for content the page lists, \`"public":["create"]\` for forms, nothing for private data.
2. Copy \`endpoint\`, \`publicKey\` and \`signin\` from \`{"info":true}\` into the page.

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
\`\`\`

Handle \`DATA_DUPLICATE\` (409, a \`unique\` value such as a booked slot is taken), \`DATA_RATE_LIMITED\` (429), \`DATA_SIGNIN_EXPIRED\` (401: remove the token, offer sign-in), \`DATA_FORBIDDEN\` (403) and \`DATA_APP_SUSPENDED\` (403). Any other code is a mistake in the statement; \`error\` says what to fix.

The public key is visible to everyone. It reads or creates only where \`public\` allows, one record per request, rate-limited, and never updates or deletes, so keep private data out of publicly readable collections.

### Visitors who sign in

Visitors sign in with their iPollo account; the page never handles passwords.

- \`"users"\` on \`define\`: \`read\` every record, \`create\` one, \`own\` to read, update and delete their own. \`"users":["create","own"]\` gives each visitor private records such as orders; comments are \`"public":["read"],"users":["create","own"]\`.
- Sign in: \`location.href = DATA.signin + '&return=' + encodeURIComponent(location.href)\`. On return:

\`\`\`js
const got = location.hash.match(/ipollo_token=([^&]+)/)
if (got) { localStorage.setItem('ipollo_token', got[1]); history.replaceState(null, '', location.pathname + location.search) }
const { user } = await data({ me: true }) // null or { id, name, role }
\`\`\`

- Signing out removes the token. Roles: \`role\` is \`user\` unless granted; \`{"grant":"admin","email":"a@b.c"}\` lets that account change every record from the page, \`{"revoke":"a@b.c"}\` removes it, and other role names are labels for the page's own logic. The owner is always \`admin\`.
- A page on its own domain needs \`{"origins":["https://example.com"]}\` once; iPollo-published pages and localhost need nothing.
- To test signed in, run \`{"preview":"user"}\` or \`{"preview":"admin"}\` and open the page with \`#ipollo_token=<token>\` (two hours).
`,
} as const
