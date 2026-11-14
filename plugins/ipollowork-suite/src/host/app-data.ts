/**
 * App data in DSH. The account service keeps the records; this module exposes them as the Host `ipolloData` service for
 * plugins, the `app_data` tool and `app-data` skill for the model, and the routes behind the Data page and the browser
 * `ipolloData` service. Every call uses the signed-in account, so plugins and the model never hold a token or a
 * database connection.
 */
import { z } from 'zod'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AccountService } from './account.ts'
import { AppDataRejection, SuiteError } from './errors.ts'
import { createDataApp, type DataApp, type DataAppDetail, type DataAppKind, type DataAppList, type IpolloData } from '../shared/app-data.ts'

const BASE = '/api/data/v1/apps'
const kinds = z.enum(['plugin', 'site'])
const owner = z.object({ kind: z.enum(['user', 'enterprise']), id: z.string(), name: z.string() })
const summary = z.object({
  id: z.uuid(), kind: kinds, name: z.string(), slug: z.string(), workspace: z.string(), owner, public: z.boolean(),
  collections: z.number(), records: z.number(), bytes: z.number(), canManage: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
})
const detail = summary.extend({
  endpoint: z.string(), publicKey: z.string(),
  limits: z.object({ records: z.number(), bytes: z.number(), recordBytes: z.number() }),
  collectionList: z.array(z.object({
    name: z.string(), fields: z.record(z.string(), z.enum(['text', 'number', 'boolean', 'json'])),
    public: z.array(z.enum(['read', 'create'])), unique: z.array(z.string()).nullable(), records: z.number(), bytes: z.number(),
  })),
})
const result = z.record(z.string(), z.json())
type Result = z.infer<typeof result>
const openInput = z.object({ name: z.string().trim().min(1).max(80), organization: z.string().min(1).max(200).optional() }).strict()

/** Account-backed app data; one instance per suite Host. */
export class AppDataService implements IpolloData {
  constructor(private readonly account: AccountService) {}

  /** @returns the signed-in account's personal and organization apps, and every organization it belongs to. */
  async apps(): Promise<DataAppList> {
    return z.object({ items: z.array(summary), organizations: z.array(z.object({ id: z.string(), name: z.string() })) })
      .parse(await this.account.request(BASE))
  }
  /**
   * Return the app with this name, creating it on first use.
   * @param input - app name, the kind recorded when it is created, an optional organization name or id, and the creating workspace's title.
   * @returns the app detail.
   */
  async ensure(input: { name: string; kind: DataAppKind; organization?: string | undefined; workspace?: string | undefined }): Promise<DataAppDetail> {
    const enterpriseId = input.organization ? await this.organization(input.organization) : undefined
    const body = { name: input.name, kind: input.kind, ...(enterpriseId ? { enterpriseId } : {}), ...(input.workspace ? { workspace: input.workspace } : {}) }
    return z.object({ app: detail }).parse(await this.account.request(BASE, body)).app
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
  }
  /**
   * Run one statement or `{batch}` against an app.
   * @param id - the app id.
   * @param statement - the JSON statement.
   * @returns the statement result.
   */
  async run(id: string, statement: unknown): Promise<Result> {
    return result.parse(await this.account.request(`${BASE}/${encodeURIComponent(id)}/run`, statement))
  }
  /**
   * Find an existing app by name without creating it.
   * @param name - the app name; letter case and surrounding spaces are ignored.
   * @param organization - organization name or id, or undefined for personal apps.
   * @returns the app and the owner's other apps, so a miss can name what exists.
   */
  async find(name: string, organization?: string): Promise<{ app: DataAppList['items'][number] | undefined; others: DataAppList['items'] }> {
    const enterpriseId = organization ? await this.organization(organization) : undefined
    const owned = (await this.apps()).items.filter(app => (enterpriseId ? app.owner.id === enterpriseId : app.owner.kind === 'user'))
    const wanted = name.trim().toLowerCase()
    return { app: owned.find(app => app.name.trim().toLowerCase() === wanted), others: owned }
  }
  async open(name: string, options: { organization?: string } = {}): Promise<DataApp> {
    const app = await this.ensure({ name, kind: 'plugin', organization: options.organization })
    return createDataApp(app.id, statement => this.run(app.id, statement))
  }
  private async organization(value: string): Promise<string> {
    const items = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) })
      .parse(await this.account.request('/api/v1/me/orgs')).items
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
    return { app: await service.ensure({ name: input.name, kind: 'plugin', organization: input.organization }) }
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

const READS = new Set(['get', 'find', 'count', 'info'])
/** Whether a statement or batch only reads; reads never create an app. */
function reads(statement: Record<string, unknown>): boolean {
  const list = Array.isArray(statement.batch) ? (statement.batch as Record<string, unknown>[]) : [statement]
  return list.every(item => item !== null && typeof item === 'object' && Object.keys(item).some(key => READS.has(key)))
}
/**
 * The model's app data tool. A new app records its kind and the title of the workspace it was created from.
 * @param service - the app data service.
 * @param workspaceOf - resolves a session's working directory to its workspace title.
 * @returns the tool definition.
 */
export function appDataTool(service: AppDataService, workspaceOf: (cwd: string | undefined) => string | undefined): ToolDefinition {
  return defineTool({
    name: 'app_data',
    description: [
      'Keep records for a website, app, mini program or DSH plugin without running a database. Read the app-data skill before writing code that uses it.',
      'An app is created by its first write and holds collections of JSON records; reads of an unknown app list the existing apps instead; each field\'s type (text, number, boolean or json) is fixed by its first value. Record ids are short keys such as "profile" or generated UUIDs.',
      'Statements:',
      '{"insert":"bookings","values":{"name":"Ann","slot":10}} (values may be an array of up to 100 records);',
      '{"find":"bookings","where":{"slot":{">=":9},"status":"open"},"sort":"-createdAt","limit":20,"after":"<next from the previous page>"};',
      '{"get":"bookings","id":"…"}; {"count":"bookings","where":{…}};',
      '{"update":"bookings","id":"…","set":{"status":"done"},"version":2} (merges fields; null removes one; version rejects a stale write);',
      '{"upsert":"settings","id":"profile","values":{…}} (creates the record or replaces all of its fields);',
      '{"delete":"bookings","id":"…"};',
      '{"define":"bookings","fields":{"name":"text","slot":"number"},"public":["create"],"unique":["date","slot"]} ("read" lets anyone holding the public key read, "create" lets them submit one record at a time; visitors write only declared fields; unique needs an empty collection);',
      '{"drop":"bookings"}; {"info":true} lists collections, fields, the endpoint and the public key;',
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
    async execute(args, exec) {
      return signedIn(async () => {
        if (reads(args.statement)) {
          const { app, others } = await service.find(args.app, args.organization)
          if (!app)
            throw new AppDataRejection('DATA_APP_NOT_FOUND', 404,
              `No app is named "${args.app}" yet; reads do not create apps, and the first write does. Existing apps: ${others.map(item => `${item.name} (${item.kind})`).join(', ') || 'none'}.`)
          return service.run(app.id, args.statement)
        }
        const app = await service.ensure({ name: args.app, kind: args.kind, organization: args.organization, workspace: workspaceOf(exec.agent?.session.header.cwd) })
        return service.run(app.id, args.statement)
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

Every caller uses the same JSON statements listed by the \`app_data\` tool. Field types (text, number, boolean, json) are fixed by first use. Ids are short keys such as \`profile\` or generated UUIDs. Errors name the existing collections and fields.

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

\`open(name, { organization })\` returns \`{ id, run(statement), collection(name) }\`. A collection has \`insert(values)\`, \`get(id)\`, \`find({ where, sort, limit, after })\` returning \`{ items, next }\`, \`count(where)\`, \`update(id, set, version?)\`, \`upsert(id, values, version?)\` and \`delete(id, version?)\`. Use \`upsert\` with a fixed id for single documents such as settings or today's plan. Calls use the signed-in account and need no key; signed out, they reject with \`IPW_SIGN_IN_REQUIRED\`, so show a sign-in hint instead of failing silently. Open inside handlers, not at load. Rejections carry \`code\` and a message that explains the fix.

Before writing plugin code you may create the collections with \`app_data\` (\`kind: "plugin"\`, the same app name) and inspect them with \`{"info":true}\`.

## Website, app or mini program

1. With \`app_data\` (\`kind: "site"\`), run \`define\` for every collection the page writes. Declare its fields and only the public access visitors need: \`"public":["create"]\` for forms such as bookings or sign-ups, \`"public":["read"]\` for content the page lists. Collections without \`public\` stay private to the owner.
2. Run \`{"info":true}\` and copy \`endpoint\` and \`publicKey\` into the page code.

\`\`\`js
const DATA = { endpoint: '<endpoint>', key: '<publicKey>' }
async function data(statement) {
  const response = await fetch(DATA.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Data-Key': DATA.key },
    body: JSON.stringify(statement),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error)
  return body
}
await data({ insert: 'bookings', values: { name, date, slot } })
const { items } = await data({ find: 'menu', sort: 'price' })
\`\`\`

Every visitor can see the public key. It reads or creates only in collections whose \`public\` allows it, writes one record per request and is rate-limited per visitor. Visitors cannot update or delete, so keep private data out of publicly readable collections. A \`unique\` collection rejects a second record with the same values, which suits booked time slots. The owner reviews records with \`app_data\` or the Data page.
`,
} as const
