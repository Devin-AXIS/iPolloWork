/** App data: per-app record stores kept by the account service, shared by the data page, DSH plugins and the model. */

/** A field's type, fixed by its first written value or a `define` statement. */
export type DataFieldType = 'text' | 'number' | 'boolean' | 'json'
/** A JSON value stored in a record field. */
export type DataValue = string | number | boolean | null | DataValue[] | { [key: string]: DataValue }
/** A stored record: its fields plus `id`, `version`, `createdAt` and `updatedAt` in epoch milliseconds. */
export type DataRecord = { [key: string]: DataValue } & { id: string; version: number; createdAt: number; updatedAt: number }

/** One app in the signed-in account's listing. */
export interface DataAppSummary {
  id: string
  name: string
  slug: string
  /** The workspace that created the app; empty when created elsewhere. */
  workspace: string
  owner: { kind: 'user' | 'enterprise'; id: string; name: string }
  /** Whether any collection admits anonymous reads or creates through the public key. */
  public: boolean
  collections: number
  records: number
  bytes: number
  canManage: boolean
  createdAt: number
  updatedAt: number
}
/** A collection's declared fields, anonymous access and size. */
export interface DataCollectionInfo {
  name: string
  fields: Record<string, DataFieldType>
  public: ('read' | 'create')[]
  unique: string[] | null
  records: number
  bytes: number
}
/** App detail, including the endpoint and public key used by published code. */
export interface DataAppDetail extends DataAppSummary {
  endpoint: string
  publicKey: string
  limits: { records: number; bytes: number; recordBytes: number }
  collectionList: DataCollectionInfo[]
}

/** Filter condition: a literal means equality; `null` matches a missing field. */
export type DataCondition =
  | string | number | boolean | null
  | { '='?: string | number | boolean; '!='?: string | number | boolean; '>'?: string | number; '>='?: string | number; '<'?: string | number; '<='?: string | number; in?: (string | number | boolean)[]; contains?: string }
/** Query options for `find`; `sort` names a field, prefixed by `-` for descending order. */
export interface DataQuery {
  where?: Record<string, DataCondition>
  sort?: string
  limit?: number
  after?: string
}
/** One JSON statement. Exactly one operation key names the operation. */
export type DataStatement =
  | { insert: string; values: Record<string, DataValue> | Record<string, DataValue>[] }
  | { get: string; id: string }
  | ({ find: string } & DataQuery)
  | { count: string; where?: Record<string, DataCondition> }
  | { update: string; id: string; set: Record<string, DataValue>; version?: number }
  | { delete: string; id: string; version?: number }
  | { define: string; fields?: Record<string, DataFieldType>; public?: ('read' | 'create')[]; unique?: string[] | null }
  | { drop: string }
  | { info: true }

/** Typed access to one collection of an opened app. */
export interface DataCollection {
  insert(values: Record<string, DataValue>): Promise<DataRecord>
  get(id: string): Promise<DataRecord>
  find(query?: DataQuery): Promise<{ items: DataRecord[]; next: string | null }>
  count(where?: Record<string, DataCondition>): Promise<number>
  update(id: string, set: Record<string, DataValue>, version?: number): Promise<DataRecord>
  delete(id: string, version?: number): Promise<void>
}
/** An opened app. `run` accepts any statement or `{batch}`; `collection` wraps the common operations. */
export interface DataApp {
  readonly id: string
  run(statement: DataStatement | { batch: DataStatement[] }): Promise<unknown>
  collection(name: string): DataCollection
}
/** The `ipolloData` native service that DSH plugins inject. */
export interface IpolloData {
  /**
   * Open the signed-in account's app named `name`, creating it on first use.
   * @param name - the app name; the same name reopens the same app.
   * @param options - `organization` (name or id) stores the app under an organization instead of the person.
   * @returns the opened app.
   */
  open(name: string, options?: { organization?: string }): Promise<DataApp>
}
