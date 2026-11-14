/**
 * App data in DSH. The account service keeps the records; this module exposes them as the `ipolloData` service for
 * plugins, the `app_data` tool and `app-data` skill for the model, and the routes behind the Data page. Every call uses
 * the signed-in account, so plugins and the model never hold a token or a database connection.
 */
import { z } from 'zod'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AccountService } from './account.ts'
import { AppDataRejection, SuiteError } from './errors.ts'
import type {
  DataApp, DataAppDetail, DataAppList, DataCollection, DataRecord, DataStatement, IpolloData,
} from '../shared/app-data.ts'

const BASE = '/api/data/v1/apps'
const owner = z.object({ kind: z.enum(['user', 'enterprise']), id: z.string(), name: z.string() })
const summary = z.object({
  id: z.uuid(), name: z.string(), slug: z.string(), workspace: z.string(), owner, public: z.boolean(),
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
const record = z.looseObject({ id: z.string(), version: z.number(), createdAt: z.number(), updatedAt: z.number() })
const asRecord = (value: unknown) => record.parse(value) as DataRecord

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
   * @param input - app name, optional organization name or id, and the creating workspace's title.
   * @returns the app detail.
   */
  async ensure(input: { name: string; organization?: string | undefined; workspace?: string | undefined }): Promise<DataAppDetail> {
    const enterpriseId = input.organization ? await this.organization(input.organization) : undefined
    const body = { name: input.name, ...(enterpriseId ? { enterpriseId } : {}), ...(input.workspace ? { workspace: input.workspace } : {}) }
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
  async open(name: string, options: { organization?: string } = {}): Promise<DataApp> {
    const app = await this.ensure({ name, organization: options.organization })
    const run = (statement: DataStatement | { batch: DataStatement[] }) => this.run(app.id, statement)
    const collection = (collectionName: string): DataCollection => ({
      insert: async values => asRecord((await run({ insert: collectionName, values })).item),
      get: async id => asRecord((await run({ get: collectionName, id })).item),
      find: async (query = {}) => {
        const value = z.object({ items: z.array(record), next: z.string().nullable() }).parse(await run({ find: collectionName, ...query }))
        return { items: value.items as DataRecord[], next: value.next }
      },
      count: async where => z.object({ count: z.number() }).parse(await run({ count: collectionName, ...(where ? { where } : {}) })).count,
      update: async (id, set, version) =>
        asRecord((await run({ update: collectionName, id, set, ...(version === undefined ? {} : { version }) })).item),
      delete: async (id, version) => { await run({ delete: collectionName, id, ...(version === undefined ? {} : { version }) }) },
    })
    return { id: app.id, run, collection }
  }
  private async organization(value: string): Promise<string> {
    const items = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) })
      .parse(await this.account.request('/api/v1/me/orgs')).items
    const found = items.find(item => item.id === value) ?? items.find(item => item.name.toLowerCase() === value.toLowerCase())
    if (!found) throw new AppDataRejection('IPW_ORGANIZATION_NOT_FOUND', 404, `你不在名为「${value}」的组织中`)
    return found.id
  }
}

/**
 * Handle a Data page request below `/data/apps`.
 * @param service - the app data service.
 * @param method - the HTTP method.
 * @param path - the path after `/data/apps`.
 * @param read - reads the JSON request body.
 * @returns the JSON response body.
 */
export async function appDataRoute(service: AppDataService, method: string, path: string, read: () => Promise<unknown>): Promise<unknown> {
  if (path === '' && method === 'GET') return service.apps()
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

const READS = new Set(['get', 'find', 'count', 'info'])
/**
 * The model's app data tool. A new app records the title of the workspace it was created from.
 * @param service - the app data service.
 * @param workspaceOf - resolves a session's working directory to its workspace title.
 * @returns the tool definition.
 */
export function appDataTool(service: AppDataService, workspaceOf: (cwd: string | undefined) => string | undefined): ToolDefinition {
  return defineTool({
    name: 'app_data',
    description: [
      'Keep records for a website, app, mini program or plugin without running a database.',
      'An app is created on first use and holds collections of JSON records; each field\'s type (text, number, boolean or json) is fixed by its first value.',
      'Statements:',
      '{"insert":"bookings","values":{"name":"Ann","slot":10}} (values may be an array of up to 100 records);',
      '{"find":"bookings","where":{"slot":{">=":9},"status":"open"},"sort":"-createdAt","limit":20,"after":"<next from the previous page>"};',
      '{"get":"bookings","id":"…"}; {"count":"bookings","where":{…}};',
      '{"update":"bookings","id":"…","set":{"status":"done"},"version":2} (null removes a field; version rejects a stale write);',
      '{"delete":"bookings","id":"…"};',
      '{"define":"bookings","fields":{"name":"text","slot":"number"},"public":["create"],"unique":["date","slot"]} ("read" lets anyone holding the public key read, "create" lets them submit one record at a time; visitors write only declared fields; unique needs an empty collection);',
      '{"drop":"bookings"}; {"info":true} returns the endpoint and public key for page code;',
      '{"batch":[…]} runs up to 20 statements atomically.',
      'Where operators: =, !=, >, >=, <, <=, in, contains (text); null matches a missing field. Records also carry id, version, createdAt and updatedAt.',
    ].join(' '),
    parameters: {
      app: { type: 'string', required: true, description: 'App name, usually the website, app or plugin name. The same name reopens the same app.' },
      organization: { type: 'string', description: 'Organization name or id when the records belong to an organization. Omit for a personal app.' },
      statement: { type: 'object', additionalProperties: true, required: true, description: 'One statement, or {"batch":[…]}.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const app = await service.ensure({ name: args.app, organization: args.organization, workspace: workspaceOf(exec.agent?.session.header.cwd) })
      return service.run(app.id, args.statement)
    },
    presentCall: args => ({
      card: 'generic',
      title: `App data · ${args.app}`,
      kind: Object.keys(args.statement).some(key => READS.has(key)) ? 'read' : 'edit',
    }),
  })
}

/** The `app-data` skill: how page code and plugins use app data. */
export const APP_DATA_SKILL = {
  name: 'app-data',
  description: 'Save and query records for a website, app, mini program or DSH plugin without a database: set up collections with the app_data tool, then call them from page code or a plugin.',
  content: `# App data

Use app data when a website, app, mini program or DSH plugin needs to keep records and the user has not supplied a database. Larger systems with their own back end should use their own database.

## Set up

1. Pick one app name, usually the project or plugin name, and keep using it. Pass \`organization\` when the records belong to an organization.
2. With \`app_data\`, run \`define\` for every collection that page code writes. Declare its fields and only the public access visitors need: \`"public":["create"]\` for forms such as bookings or sign-ups, \`"public":["read"]\` for content the page lists. Collections without \`public\` stay private to the owner.
3. Run \`{"info":true}\` and copy \`endpoint\` and \`publicKey\` into the page code.

## Page code

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

Every visitor can see the public key. It reads or creates only in collections whose \`public\` allows it, writes one record per request and is rate-limited per visitor. Visitors cannot update or delete records, so keep private data out of publicly readable collections. The owner reviews and changes records with \`app_data\` or the Data page. A \`unique\` collection rejects a second record with the same values, which suits booked time slots.

## DSH plugins

A plugin injects the \`ipolloData\` service and opens its app when it needs data:

\`\`\`ts
export const name = 'reading-list'
export const inject = ['ipolloData']
export function apply(ctx) {
  async function unread() {
    const books = (await ctx.ipolloData.open('Reading list')).collection('books')
    return (await books.find({ where: { read: false }, sort: '-createdAt' })).items
  }
}
\`\`\`

Calls use the signed-in account, so no key is needed; they fail with \`IPW_SIGN_IN_REQUIRED\` while signed out. \`open(name, { organization })\` stores records for an organization's members. A collection handle provides \`insert\`, \`get\`, \`find\`, \`count\`, \`update\` and \`delete\`; \`app.run(statement)\` accepts any statement shown by \`app_data\`.
`,
} as const
