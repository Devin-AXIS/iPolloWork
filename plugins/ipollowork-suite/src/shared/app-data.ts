/** App data: per-app record stores kept by the account service, shared by the data page, DSH plugins and the model. */

/** A field's type, fixed by its first written value or a `define` statement. */
export type DataFieldType = 'text' | 'number' | 'boolean' | 'json'
/** A JSON value stored in a record field. */
export type DataValue = string | number | boolean | null | DataValue[] | { [key: string]: DataValue }
/** A stored record: its fields plus `id`, `version`, `createdAt` and `updatedAt` in epoch milliseconds. */
export type DataRecord = { [key: string]: DataValue } & { id: string; version: number; createdAt: number; updatedAt: number }

/** What an app serves, declared when it is created: a DSH plugin, or a site, app or mini program that visitors open. */
export type DataAppKind = 'plugin' | 'site'
/** One app in the signed-in account's listing. */
export interface DataAppSummary {
  id: string
  kind: DataAppKind
  name: string
  slug: string
  /** The workspace that created the app; empty when created elsewhere. */
  workspace: string
  owner: { kind: 'user' | 'enterprise'; id: string; name: string }
  /** Whether any collection admits anonymous reads or creates through the public key. */
  public: boolean
  /** The platform operator stopped the app; statements are refused until it is resumed. */
  suspended: boolean
  collections: number
  records: number
  bytes: number
  canManage: boolean
  createdAt: number
  updatedAt: number
}
/** The Data page listing: apps plus every organization the account belongs to, including organizations without apps. */
export interface DataAppList {
  items: DataAppSummary[]
  organizations: { id: string; name: string }[]
}
/** A collection's declared fields, anonymous access and size. */
export interface DataCollectionInfo {
  name: string
  fields: Record<string, DataFieldType>
  public: ('read' | 'create')[]
  /** What visitors signed in with an iPollo account may do; `own` covers the records they created. */
  users: ('read' | 'create' | 'own')[]
  unique: string[] | null
  /** Writes may use only declared fields. */
  strict: boolean
  records: number
  bytes: number
}
/** App detail, including the endpoint and public key used by published code. */
export interface DataAppDetail extends DataAppSummary {
  endpoint: string
  publicKey: string
  limits: { records: number; bytes: number; recordBytes: number }
  /** Where a page sends visitors to sign in; the page appends `&return=<its URL>`. */
  signin: string
  /** Origins, besides iPollo-published pages and local development hosts, that sign-in may return to. */
  origins: string[]
  /** Visitors the app granted a role; `admin` may change every record. */
  roles: { id: string; name: string; email: string; role: string }[]
  collectionList: DataCollectionInfo[]
}

/** Filter condition: a literal means equality; `null` matches a missing field. */
export type DataCondition =
  | string | number | boolean | null
  | { '='?: string | number | boolean; '!='?: string | number | boolean; '>'?: string | number; '>='?: string | number; '<'?: string | number; '<='?: string | number; in?: (string | number | boolean)[]; contains?: string }
/** Query options for `find`; `sort` names a field, prefixed by `-` for descending order, and `search` keeps records whose id or any text or number field contains the term. */
export interface DataQuery {
  where?: Record<string, DataCondition>
  search?: string
  /** Return only these fields, besides `id`, `version`, `createdAt` and `updatedAt`. */
  fields?: string[]
  sort?: string
  limit?: number
  after?: string
}
/** Options for `aggregate`: counts and measures over the matching records, as one row or one row per value of `group`. */
export interface DataAggregate {
  where?: Record<string, DataCondition>
  search?: string
  /** A text, number or boolean field; each distinct value becomes one row with that value as `key`. */
  group?: string
  sum?: string[]
  avg?: string[]
  min?: string[]
  max?: string[]
  /** Row order when grouped: by `key` (default) or `count`, prefixed by `-` for descending. */
  sort?: 'key' | '-key' | 'count' | '-count'
  limit?: number
}
/** One aggregate row; a measure is `null` when no matching record has the field. */
export interface DataAggregateRow {
  key?: string | number | boolean | null
  count: number
  sum?: Record<string, number | null>
  avg?: Record<string, number | null>
  min?: Record<string, number | string | null>
  max?: Record<string, number | string | null>
}
/** One JSON statement. Exactly one operation key names the operation. */
export type DataStatement =
  | { insert: string; values: Record<string, DataValue> | Record<string, DataValue>[] }
  | { get: string; id: string; fields?: string[] }
  | ({ find: string } & DataQuery)
  | { count: string; where?: Record<string, DataCondition>; search?: string }
  | ({ aggregate: string } & DataAggregate)
  | { update: string; id: string; set?: Record<string, DataValue>; inc?: Record<string, number>; version?: number }
  | { upsert: string; id: string; values: Record<string, DataValue>; version?: number }
  | { delete: string; id: string; version?: number }
  | { define: string; fields?: Record<string, DataFieldType>; public?: ('read' | 'create')[]; users?: ('read' | 'create' | 'own')[]; unique?: string[] | null; strict?: boolean; remove?: string[] }
  | { drop: string }
  | { info: true }
  | { me: true }
  | { grant: string; email: string }
  | { revoke: string }
  | { origins: string[] }
  | { preview: 'admin' | 'user' }

/** Typed access to one collection of an opened app. */
export interface DataCollection {
  insert(values: Record<string, DataValue>): Promise<DataRecord>
  get(id: string): Promise<DataRecord>
  /** One page: 20 records unless `limit` says otherwise, at most 100; `next` opens the following page. */
  find(query?: DataQuery): Promise<{ items: DataRecord[]; next: string | null }>
  /** Every matching record, following the pages; stops at 1,000 records. */
  all(query?: Omit<DataQuery, 'limit' | 'after'>): Promise<DataRecord[]>
  count(where?: Record<string, DataCondition>): Promise<number>
  /** Totals, averages and counts computed by the service, so the caller does not read every record. */
  aggregate(query?: DataAggregate): Promise<DataAggregateRow[]>
  update(id: string, set: Record<string, DataValue>, version?: number): Promise<DataRecord>
  /** Add to number fields atomically; a negative amount subtracts and a missing field starts at 0. */
  increment(id: string, by: Record<string, number>): Promise<DataRecord>
  /** Create the record with this id, or replace all of its fields. */
  upsert(id: string, values: Record<string, DataValue>, version?: number): Promise<DataRecord>
  delete(id: string, version?: number): Promise<void>
}
/** An attachment saved outside the record database. */
export interface DataFile { id:string; name:string; mime:string; bytes:number; sha256:string }
/** An opened app. `run` accepts any statement or `{batch}`; `collection` wraps the common operations. */
export interface DataApp {
  readonly id: string
  files: {
    upload(name:string,bytes:Uint8Array,options?:{mime?:string;public?:boolean}):Promise<DataFile>
    download(id:string):Promise<{url:string}>
    remove(id:string):Promise<void>
  }
  run(statement: DataStatement | { batch: DataStatement[] }): Promise<unknown>
  collection(name: string): DataCollection
}
/**
 * The `ipolloData` service that DSH plugins inject. The suite provides the same contract on the Host and in the browser,
 * so a plugin's Host half and its Client module use identical calls.
 */
export interface IpolloData {
  /**
   * Open the signed-in account's plugin app named `name`, creating it on first use.
   * @param name - the app name; the same name reopens the same app.
   * @param options - `organization` (name or id) stores the app under an organization instead of the person.
   * @returns the opened app.
   */
  open(name: string, options?: { organization?: string }): Promise<DataApp>
}

/**
 * Wrap a statement runner as an opened app. Host and browser services share it, so both return the same handle.
 * @param id - the app id.
 * @param run - sends one statement or batch and resolves with the service's JSON result.
 * @returns the opened app.
 */
export function createDataApp(id: string, run: (statement: DataStatement | { batch: DataStatement[] }) => Promise<Record<string, unknown>>, files?:DataApp['files']): DataApp {
  const item = (value: Record<string, unknown>) => value.item as DataRecord
  const versioned = (version: number | undefined) => (version === undefined ? {} : { version })
  return {
    id,
    files: files??{upload:async()=>{throw new Error('Attachment transport is unavailable')},download:async()=>{throw new Error('Attachment transport is unavailable')},remove:async()=>{throw new Error('Attachment transport is unavailable')}},
    run,
    collection: name => ({
      insert: async values => item(await run({ insert: name, values })),
      get: async recordId => item(await run({ get: name, id: recordId })),
      find: async (query = {}) => {
        const value = await run({ find: name, ...query })
        return { items: value.items as DataRecord[], next: value.next as string | null }
      },
      all: async (query = {}) => {
        const items: DataRecord[] = []
        let after: string | null = null
        do {
          const value: Record<string, unknown> = await run({ find: name, ...query, limit: 100, ...(after ? { after } : {}) })
          items.push(...(value.items as DataRecord[]))
          after = value.next as string | null
        } while (after && items.length < 1000)
        return items
      },
      count: async where => (await run({ count: name, ...(where ? { where } : {}) })).count as number,
      aggregate: async (query = {}) => (await run({ aggregate: name, ...query })).items as DataAggregateRow[],
      increment: async (recordId, by) => item(await run({ update: name, id: recordId, inc: by })),
      update: async (recordId, set, version) => item(await run({ update: name, id: recordId, set, ...versioned(version) })),
      upsert: async (recordId, values, version) => item(await run({ upsert: name, id: recordId, values, ...versioned(version) })),
      delete: async (recordId, version) => { await run({ delete: name, id: recordId, ...versioned(version) }) },
    }),
  }
}
