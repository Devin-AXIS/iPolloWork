/**
 * Small per-app record stores for plugins and published sites. Records live in a separate PostgreSQL database and are
 * read and written only through JSON statements; callers never see SQL. Personal apps belong to one user and organization
 * apps to their members. A public key admits anonymous reads or creates only on collections that opt in.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Actor } from "./auth.js";
import type { AppDataConfig } from "./config.js";
import type { Row, Store } from "./database.js";
import { ServiceError } from "./errors.js";

/** Format limits; capacity limits are deployment settings in `AppDataConfig`. */
const MAX_COLLECTIONS = 50;
const MAX_FIELDS = 100;
const MAX_INSERT = 100;
const MAX_BATCH = 20;
const MAX_PAGE = 100;
const MAX_CHANGES = 500;
const PURGE_CHUNK = 2000;
/** Largest request body: a full insert of maximum-size records plus statement overhead. */
export const appDataBodyLimit = (limits: AppDataConfig) =>
  limits.maxRecordBytes * MAX_INSERT + 65536;

const COLLECTION = /^[a-z][a-z0-9_]{0,39}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const SYSTEM = new Set(["id", "version", "createdAt", "updatedAt"]);

export type FieldType = "text" | "number" | "boolean" | "json";
export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value };
type Scalar = string | number | boolean;

const json: z.ZodType<Value> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);
const collection = z
  .string()
  .regex(COLLECTION, "集合名使用小写字母、数字和下划线，以字母开头，最长 40 个字符");
const fieldName = z
  .string()
  .regex(FIELD, "字段名使用字母、数字和下划线，最长 40 个字符");
const values = z.record(z.string(), json);
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
const condition = z.union([
  scalar,
  z.null(),
  z
    .object({
      "=": scalar.optional(),
      "!=": scalar.optional(),
      ">": scalar.optional(),
      ">=": scalar.optional(),
      "<": scalar.optional(),
      "<=": scalar.optional(),
      in: z.array(scalar).min(1).max(100).optional(),
      contains: z.string().min(1).max(200).optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, "条件不能为空"),
]);
const where = z
  .record(z.string(), condition)
  .refine((value) => Object.keys(value).length <= 10, "最多 10 个筛选字段");
const recordId = z.uuid();
const version = z.number().int().positive();
const fieldTypes = z.enum(["text", "number", "boolean", "json"]);
const statements = {
  insert: z
    .object({
      insert: collection,
      values: z.union([values, z.array(values).min(1).max(MAX_INSERT)]),
    })
    .strict(),
  get: z.object({ get: collection, id: recordId }).strict(),
  find: z
    .object({
      find: collection,
      where: where.optional(),
      sort: z
        .string()
        .regex(/^-?[A-Za-z_][A-Za-z0-9_]{0,39}$/)
        .optional(),
      limit: z.number().int().min(1).max(MAX_PAGE).optional(),
      after: z.string().max(4000).optional(),
    })
    .strict(),
  count: z.object({ count: collection, where: where.optional() }).strict(),
  update: z
    .object({ update: collection, id: recordId, set: values, version: version.optional() })
    .strict(),
  delete: z
    .object({ delete: collection, id: recordId, version: version.optional() })
    .strict(),
  define: z
    .object({
      define: collection,
      fields: z.record(fieldName, fieldTypes).optional(),
      public: z.array(z.enum(["read", "create"])).max(2).optional(),
      unique: z.array(fieldName).min(1).max(3).nullable().optional(),
    })
    .strict(),
  drop: z.object({ drop: collection }).strict(),
  info: z.object({ info: z.literal(true) }).strict(),
};
type Operation = keyof typeof statements;
/** One statement; exactly one operation key names the operation. */
export type Statement = {
  [K in Operation]: z.infer<(typeof statements)[K]>;
}[Operation];
const operations = Object.keys(statements) as Operation[];

/**
 * Validate a statement or `{batch: Statement[]}`.
 * @param input - the decoded request body.
 * @returns the validated statement or batch.
 */
export function parseStatement(input: unknown): Statement | { batch: Statement[] } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalid();
  if ("batch" in input) {
    const batch = z
      .object({ batch: z.array(z.unknown()).min(1).max(MAX_BATCH) })
      .strict()
      .parse(input).batch;
    return { batch: batch.map((item) => single(item)) };
  }
  return single(input);
}
function single(input: unknown): Statement {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalid();
  const found = operations.filter((key) => key in input);
  if (found.length !== 1) throw invalid();
  return statements[found[0]!].parse(input) as Statement;
}
const invalid = () =>
  new ServiceError(
    "DATA_STATEMENT_INVALID",
    400,
    "每条语句需要且只能有一个操作：insert、get、find、count、update、delete、define、drop、info；多条语句放在 batch 中",
  );

/** Who is calling: a signed-in account, or an anonymous visitor presenting an app's public key. */
export type DataCaller =
  | { kind: "member"; actor: Actor }
  | { kind: "anonymous"; key: string; ip: string };
type Level = "manage" | "write" | "anonymous";
type AppRow = Row & {
  id: string;
  owner_kind: "user" | "enterprise";
  owner_id: string;
  slug: string;
  name: string;
  workspace: string;
  public_key: string;
  created_by: string;
  records: number;
  bytes: number;
  created_at: number;
  updated_at: number;
};
type CollectionRow = Row & {
  id: string;
  name: string;
  fields: string;
  public_read: boolean;
  public_create: boolean;
  unique_fields: string | null;
  records: number;
  bytes: number;
};
interface Collection {
  id: string;
  name: string;
  fields: [string, FieldType][];
  publicRead: boolean;
  publicCreate: boolean;
  unique: string[] | null;
  records: number;
  bytes: number;
  /** Set when a write added first-seen fields that must be stored with the statement. */
  dirty?: boolean;
}
type RecordRow = Row & {
  id: string;
  data: string;
  version: number;
  created_at: number;
  updated_at: number;
};
/** A stored record: its own fields plus `id`, `version`, `createdAt` and `updatedAt`. */
export type DataRecord = { [key: string]: Value } & {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};
/** App listing entry; `public` reports whether any collection admits anonymous access. */
export interface AppSummary {
  id: string;
  name: string;
  slug: string;
  workspace: string;
  owner: { kind: "user" | "enterprise"; id: string; name: string };
  public: boolean;
  collections: number;
  records: number;
  bytes: number;
  canManage: boolean;
  createdAt: number;
  updatedAt: number;
}
/** App detail for members, including the endpoint and public key used by published code. */
export interface AppDetail extends AppSummary {
  endpoint: string;
  publicKey: string;
  limits: { records: number; bytes: number; recordBytes: number };
  collectionList: CollectionInfo[];
}
/** A collection's declared fields, public access and size. */
export interface CollectionInfo {
  name: string;
  fields: Record<string, FieldType>;
  public: ("read" | "create")[];
  unique: string[] | null;
  records: number;
  bytes: number;
}
interface Access {
  app: AppRow;
  level: Level;
  caller: DataCaller;
  ownerName: string;
}

const label: Record<FieldType, string> = {
  text: "文本",
  number: "数字",
  boolean: "是/否",
  json: "JSON",
};
const typeOf = (value: Value): FieldType | undefined =>
  value === null
    ? undefined
    : typeof value === "string"
      ? "text"
      : typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "json";
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
const collectionOf = (row: CollectionRow): Collection => ({
  id: row.id,
  name: row.name,
  fields: JSON.parse(row.fields) as [string, FieldType][],
  publicRead: row.public_read,
  publicCreate: row.public_create,
  unique: row.unique_fields ? (JSON.parse(row.unique_fields) as string[]) : null,
  records: row.records,
  bytes: row.bytes,
});
const infoOf = (c: Collection): CollectionInfo => ({
  name: c.name,
  fields: Object.fromEntries(c.fields),
  public: [
    ...(c.publicRead ? (["read"] as const) : []),
    ...(c.publicCreate ? (["create"] as const) : []),
  ],
  unique: c.unique,
  records: c.records,
  bytes: c.bytes,
});
const recordOf = (row: RecordRow): DataRecord => ({
  id: row.id,
  ...(JSON.parse(row.data) as Record<string, Value>),
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Create or upgrade the app data schema. Versions increase monotonically in `app_data_schema`.
 * @param store - the app data database.
 */
export async function migrateAppData(store: Store): Promise<void> {
  await store.transaction(async () => {
    await store.run("SELECT pg_advisory_xact_lock(474317851)");
    await store.run(
      "CREATE TABLE IF NOT EXISTS app_data_schema(version BIGINT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const current = Number(
      (await store.one("SELECT COALESCE(MAX(version),0) AS version FROM app_data_schema"))
        ?.version,
    );
    if (current > 1)
      throw new Error("This app data database requires a newer iPolloWork service");
    if (current < 1) {
      await store.run(
        await readFile(new URL("./app-data-schema.sql", import.meta.url), "utf8"),
      );
      await store.run("INSERT INTO app_data_schema(version) VALUES(1)");
    }
  });
}

/** App data owner: permissions come from the account database, records from the app data database. */
export class AppData {
  private purging: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(
    readonly data: Store,
    private readonly accounts: Store,
    private readonly limits: AppDataConfig,
    private readonly origin: string,
  ) {}

  /** Resume purges interrupted by a restart. */
  start(): void {
    this.schedulePurge();
  }
  /** Stop purging after the current chunk and close the app data pool. */
  async close(): Promise<void> {
    this.closed = true;
    await this.purging;
    await this.data.close();
  }

  /**
   * List personal apps and apps of the caller's organizations.
   * @param actor - the signed-in account.
   * @returns apps, most recently changed first.
   */
  async apps(actor: Actor): Promise<AppSummary[]> {
    const orgs = await this.organizations(actor);
    const rows = await this.data.all<
      AppRow & { collections: number; is_public: boolean }
    >(
      `SELECT a.*,
        (SELECT COUNT(*) FROM data_collections c WHERE c.app_id=a.id AND c.dropped_at IS NULL) AS collections,
        EXISTS(SELECT 1 FROM data_collections c WHERE c.app_id=a.id AND c.dropped_at IS NULL AND (c.public_read OR c.public_create)) AS is_public
       FROM data_apps a
       WHERE a.deleted_at IS NULL AND ((a.owner_kind='user' AND a.owner_id=?) OR (a.owner_kind='enterprise' AND a.owner_id IN (SELECT jsonb_array_elements_text(?::jsonb))))
       ORDER BY a.updated_at DESC LIMIT 2000`,
      actor.id,
      JSON.stringify([...orgs.keys()]),
    );
    return rows.map((row) => {
      const org = orgs.get(row.owner_id);
      return this.summary(
        row,
        row.owner_kind === "user" ? actor.name : (org?.name ?? ""),
        row.owner_kind === "user" ||
          org?.manager === true ||
          row.created_by === actor.id,
        Number(row.collections),
        row.is_public,
      );
    });
  }

  /**
   * Return the app with `slug` in the owner's scope, creating it when absent.
   * @param actor - the signed-in creator; organization apps require membership.
   * @param input - display name, optional slug, organization and workspace label.
   * @returns the app detail and whether it was created.
   */
  async ensure(
    actor: Actor,
    input: { name: string; slug?: string | undefined; enterpriseId?: string | undefined; workspace?: string | undefined },
  ): Promise<{ app: AppDetail; created: boolean }> {
    const owner = input.enterpriseId
      ? { kind: "enterprise" as const, id: input.enterpriseId }
      : { kind: "user" as const, id: actor.id };
    if (owner.kind === "enterprise" && !(await this.membership(actor, owner.id)))
      throw new ServiceError("ENTERPRISE_FORBIDDEN", 403, "没有组织访问权限");
    // Names without ASCII letters map to a stable hash, so the same name always reopens the same app.
    const slug =
      input.slug ??
      (slugify(input.name) ||
        "app-" + createHash("sha256").update(input.name).digest("hex").slice(0, 12));
    const result = await this.data.transaction(async () => {
      await this.data.run(
        "SELECT pg_advisory_xact_lock(hashtext(?))",
        owner.kind + ":" + owner.id,
      );
      const existing = await this.data.one<AppRow>(
        "SELECT * FROM data_apps WHERE owner_kind=? AND owner_id=? AND slug=? AND deleted_at IS NULL",
        owner.kind,
        owner.id,
        slug,
      );
      if (existing) return { id: existing.id, created: false };
      const count = Number(
        (
          await this.data.one(
            "SELECT COUNT(*) AS n FROM data_apps WHERE owner_kind=? AND owner_id=? AND deleted_at IS NULL",
            owner.kind,
            owner.id,
          )
        )?.n,
      );
      if (count >= this.limits.maxAppsPerOwner)
        throw new ServiceError(
          "DATA_APP_LIMIT",
          409,
          `最多 ${this.limits.maxAppsPerOwner} 个应用，请先删除不用的应用`,
        );
      const id = randomUUID(),
        at = Date.now();
      await this.data.run(
        "INSERT INTO data_apps(id,owner_kind,owner_id,slug,name,workspace,public_key,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        id,
        owner.kind,
        owner.id,
        slug,
        input.name,
        input.workspace ?? "",
        "pk_" + randomBytes(18).toString("base64url"),
        actor.id,
        at,
        at,
      );
      return { id, created: true };
    });
    return {
      app: await this.detail({ kind: "member", actor }, result.id),
      created: result.created,
    };
  }

  /**
   * Describe one app to a member.
   * @param caller - a signed-in caller.
   * @param id - the app id.
   * @returns the app detail with its collections.
   */
  async detail(caller: DataCaller, id: string): Promise<AppDetail> {
    const access = await this.access(caller, id);
    if (access.level === "anonymous")
      throw new ServiceError("SIGN_IN_REQUIRED", 401, "请先登录");
    return this.describe(access);
  }

  /**
   * Rename an app, change its workspace label or replace its public key.
   * @param caller - a signed-in manager.
   * @param id - the app id.
   * @param input - fields to change.
   * @returns the updated detail.
   */
  async update(
    caller: DataCaller,
    id: string,
    input: { name?: string | undefined; workspace?: string | undefined; rotateKey?: boolean | undefined },
  ): Promise<AppDetail> {
    const access = await this.manage(caller, id);
    await this.data.run(
      "UPDATE data_apps SET name=COALESCE(?,name),workspace=COALESCE(?,workspace),public_key=COALESCE(?,public_key),updated_at=? WHERE id=?",
      input.name ?? null,
      input.workspace ?? null,
      input.rotateKey ? "pk_" + randomBytes(18).toString("base64url") : null,
      Date.now(),
      access.app.id,
    );
    return this.detail(caller, id);
  }

  /**
   * Delete an app. Access stops at once; its records are purged in the background.
   * @param caller - a signed-in manager.
   * @param id - the app id.
   */
  async remove(caller: DataCaller, id: string): Promise<void> {
    const access = await this.manage(caller, id);
    await this.data.run(
      "UPDATE data_apps SET deleted_at=? WHERE id=? AND deleted_at IS NULL",
      Date.now(),
      access.app.id,
    );
    this.schedulePurge();
  }

  /**
   * Run one statement, or a batch atomically. Anonymous callers run single statements within their rate limit.
   * @param caller - the signed-in member or anonymous key holder.
   * @param id - the app id.
   * @param input - the decoded statement.
   * @returns the statement result, or `{results}` for a batch.
   */
  async run(caller: DataCaller, id: string, input: unknown): Promise<unknown> {
    const statement = parseStatement(input);
    const access = await this.access(caller, id);
    if (caller.kind === "anonymous") {
      await this.rate(access.app.id, caller.ip);
      if ("batch" in statement || ("insert" in statement && Array.isArray(statement.values)))
        throw new ServiceError("DATA_FORBIDDEN", 403, "公开 key 每次只能写入一条记录");
    }
    const list = "batch" in statement ? statement.batch : [statement];
    const result =
      "batch" in statement
        ? {
            results: await this.data.transaction(async () => {
              const results: unknown[] = [];
              for (const item of statement.batch) results.push(await this.execute(access, item));
              return results;
            }),
          }
        : await this.execute(access, statement);
    // A dropped collection is purged only after its transaction commits.
    if (list.some((item) => "drop" in item)) this.schedulePurge();
    return result;
  }

  /**
   * Records changed after `after`, in commit order, for synchronizing another device.
   * @param caller - a signed-in member.
   * @param id - the app id.
   * @param after - the `next` value of the previous call, 0 at first.
   * @param limit - maximum changes; one commit is never split.
   * @returns changes, the next cursor, whether more remain and the current collection names.
   */
  async changes(caller: DataCaller, id: string, after: number, limit = MAX_CHANGES) {
    const access = await this.access(caller, id);
    if (access.level === "anonymous")
      throw new ServiceError("SIGN_IN_REQUIRED", 401, "同步需要登录");
    const appId = access.app.id;
    const size = Math.min(Math.max(1, limit), MAX_CHANGES);
    const boundary = (
      await this.data.one<{ seq: number }>(
        "SELECT seq FROM data_records WHERE app_id=? AND seq>? ORDER BY seq OFFSET ? LIMIT 1",
        appId,
        after,
        size - 1,
      )
    )?.seq;
    const rows = await this.data.all<RecordRow & { seq: number; deleted_at: number | null; collection: string }>(
      `SELECT r.id,r.data::text AS data,r.version,r.seq,r.created_at,r.updated_at,r.deleted_at,c.name AS collection
       FROM data_records r JOIN data_collections c ON c.id=r.collection_id AND c.dropped_at IS NULL
       WHERE r.app_id=? AND r.seq>?` + (boundary === undefined ? "" : " AND r.seq<=?") + " ORDER BY r.seq,r.id",
      ...(boundary === undefined ? [appId, after] : [appId, after, boundary]),
    );
    const more =
      boundary !== undefined &&
      !!(await this.data.one("SELECT 1 FROM data_records WHERE app_id=? AND seq>? LIMIT 1", appId, boundary));
    const collections = await this.data.all<{ name: string }>(
      "SELECT name FROM data_collections WHERE app_id=? AND dropped_at IS NULL ORDER BY name",
      appId,
    );
    return {
      items: rows.map((row) =>
        row.deleted_at === null
          ? { collection: row.collection, record: recordOf(row) }
          : { collection: row.collection, id: row.id, deleted: true },
      ),
      next: rows.length ? rows[rows.length - 1]!.seq : after,
      more,
      collections: collections.map((c) => c.name),
    };
  }

  private async execute(access: Access, statement: Statement): Promise<unknown> {
    if ("info" in statement) {
      if (access.level === "anonymous") throw forbidden();
      return { app: await this.describe(access) };
    }
    if ("get" in statement) {
      const c = await this.readable(access, statement.get);
      if (!c) throw notFound();
      const row = await this.data.one<RecordRow>(
        "SELECT id,data::text AS data,version,created_at,updated_at FROM data_records WHERE collection_id=? AND id=? AND deleted_at IS NULL",
        c.id,
        statement.id,
      );
      if (!row) throw notFound();
      return { item: recordOf(row) };
    }
    if ("find" in statement) {
      const c = await this.readable(access, statement.find);
      if (!c) return { items: [], next: null };
      return this.find(c, statement);
    }
    if ("count" in statement) {
      const c = await this.readable(access, statement.count);
      if (!c) return { count: 0 };
      const params: Parameter[] = [c.id];
      const filters = conditions(c, statement.where, params);
      const row = await this.data.one(
        "SELECT COUNT(*) AS n FROM data_records WHERE collection_id=? AND deleted_at IS NULL" +
          filters.map((f) => " AND " + f).join(""),
        ...params,
      );
      return { count: Number(row?.n ?? 0) };
    }
    if (access.level === "anonymous" && !("insert" in statement)) throw forbidden();
    if (("define" in statement || "drop" in statement) && access.level !== "manage")
      throw new ServiceError("DATA_FORBIDDEN", 403, "只有应用管理者可以定义或删除集合");
    return this.data.transaction(async () => {
      const app = await this.data.one<{ seq: number }>(
        "UPDATE data_apps SET seq=seq+1,updated_at=? WHERE id=? AND deleted_at IS NULL RETURNING seq",
        Date.now(),
        access.app.id,
      );
      if (!app) throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
      if ("insert" in statement) return this.insert(access, statement, app.seq);
      if ("update" in statement) return this.change(access, statement, app.seq);
      if ("delete" in statement) return this.erase(access, statement, app.seq);
      if ("define" in statement) return this.define(access, statement);
      return this.drop(access, statement.drop);
    });
  }

  private async find(c: Collection, s: Extract<Statement, { find: string }>) {
    const types = new Map(c.fields);
    const raw = s.sort ?? "-createdAt";
    const desc = raw.startsWith("-");
    const field = desc ? raw.slice(1) : raw;
    const key = sortKey(field, types);
    const params: Parameter[] = [c.id];
    const filters = conditions(c, s.where, params);
    if (s.after) {
      let cursor: [Scalar | null, string];
      try {
        cursor = JSON.parse(Buffer.from(s.after, "base64url").toString()) as [Scalar | null, string];
      } catch (error) {
        throw new ServiceError("DATA_CURSOR_INVALID", 400, "after 不是有效的翻页游标", { cause: error });
      }
      if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[1] !== "string")
        throw new ServiceError("DATA_CURSOR_INVALID", 400, "after 不是有效的翻页游标");
      const [value, id] = cursor;
      const cmp = desc ? "<" : ">";
      if (value === null) {
        filters.push(`(${key.sql} IS NULL AND id ${cmp} ?)`);
        params.push(id);
      } else {
        filters.push(
          `(${key.sql} ${cmp} ?::${key.cast} OR (${key.sql} = ?::${key.cast} AND id ${cmp} ?) OR ${key.sql} IS NULL)`,
        );
        params.push(value, value, id);
      }
    }
    const limit = s.limit ?? 20;
    params.push(limit + 1);
    const rows = await this.data.all<RecordRow>(
      "SELECT id,data::text AS data,version,created_at,updated_at FROM data_records WHERE collection_id=? AND deleted_at IS NULL" +
        filters.map((f) => " AND " + f).join("") +
        ` ORDER BY ${key.sql} ${desc ? "DESC" : "ASC"} NULLS LAST, id ${desc ? "DESC" : "ASC"} LIMIT ?`,
      ...params,
    );
    const items = rows.slice(0, limit).map(recordOf);
    const last = items[items.length - 1];
    return {
      items,
      next:
        rows.length > limit && last
          ? encode([key.value(last), last.id])
          : null,
    };
  }

  private async insert(access: Access, s: Extract<Statement, { insert: string }>, seq: number) {
    const many = Array.isArray(s.values);
    const list = Array.isArray(s.values) ? s.values : [s.values];
    const c = await this.writable(access, s.insert);
    const at = Date.now();
    const items: DataRecord[] = [];
    let bytes = 0;
    for (const input of list) {
      const { id: given, ...rest } = input;
      if (given !== undefined && !recordId.safeParse(given).success)
        throw new ServiceError("DATA_RECORD_ID_INVALID", 400, "id 必须是 UUID，或者不填由服务生成");
      const fields = this.accept(access, c, rest);
      const size = this.size(fields);
      const id = (given as string | undefined) ?? randomUUID();
      try {
        await this.data.run(
          "INSERT INTO data_records(collection_id,app_id,id,data,version,seq,bytes,unique_key,created_by,created_at,updated_at) VALUES(?,?,?,?::jsonb,1,?,?,?,?,?,?)",
          c.id,
          access.app.id,
          id,
          JSON.stringify(fields),
          seq,
          size,
          uniqueKey(c.unique, fields),
          access.caller.kind === "member" ? access.caller.actor.id : null,
          at,
          at,
        );
      } catch (error) {
        throw duplicate(error, c);
      }
      bytes += size;
      items.push({ id, ...fields, version: 1, createdAt: at, updatedAt: at });
    }
    await this.account(access, c, list.length, bytes);
    return many ? { items } : { item: items[0] };
  }

  private async change(access: Access, s: Extract<Statement, { update: string }>, seq: number) {
    const c = await this.collection(access.app.id, s.update);
    if (!c) throw notFound();
    const row = await this.data.one<RecordRow & { bytes: number }>(
      "SELECT id,data::text AS data,version,bytes,created_at,updated_at FROM data_records WHERE collection_id=? AND id=? AND deleted_at IS NULL",
      c.id,
      s.id,
    );
    if (!row) throw notFound();
    if (s.version !== undefined && s.version !== row.version) throw conflict();
    const merged = { ...(JSON.parse(row.data) as Record<string, Value>), ...s.set };
    for (const [k, v] of Object.entries(s.set)) if (v === null) delete merged[k];
    const fields = this.accept(access, c, merged);
    const size = this.size(fields);
    const at = Date.now();
    try {
      await this.data.run(
        "UPDATE data_records SET data=?::jsonb,version=version+1,seq=?,bytes=?,unique_key=?,updated_at=? WHERE collection_id=? AND id=?",
        JSON.stringify(fields),
        seq,
        size,
        uniqueKey(c.unique, fields),
        at,
        c.id,
        s.id,
      );
    } catch (error) {
      throw duplicate(error, c);
    }
    await this.account(access, c, 0, size - row.bytes);
    return {
      item: { id: row.id, ...fields, version: row.version + 1, createdAt: row.created_at, updatedAt: at },
    };
  }

  private async erase(access: Access, s: Extract<Statement, { delete: string }>, seq: number) {
    const c = await this.collection(access.app.id, s.delete);
    if (!c) throw notFound();
    const row = await this.data.one<{ version: number; bytes: number }>(
      "SELECT version,bytes FROM data_records WHERE collection_id=? AND id=? AND deleted_at IS NULL",
      c.id,
      s.id,
    );
    if (!row) throw notFound();
    if (s.version !== undefined && s.version !== row.version) throw conflict();
    const at = Date.now();
    await this.data.run(
      "UPDATE data_records SET data='{}'::jsonb,bytes=0,unique_key=NULL,version=version+1,seq=?,deleted_at=?,updated_at=? WHERE collection_id=? AND id=?",
      seq,
      at,
      at,
      c.id,
      s.id,
    );
    await this.account(access, c, -1, -row.bytes);
    return { deleted: true };
  }

  private async define(access: Access, s: Extract<Statement, { define: string }>) {
    const c = (await this.collection(access.app.id, s.define)) ?? (await this.create(access.app.id, s.define));
    const fields = [...c.fields];
    for (const [name, type] of Object.entries(s.fields ?? {})) {
      if (SYSTEM.has(name)) throw reserved(name);
      const current = fields.find(([f]) => f === name);
      if (current && current[1] !== type)
        throw new ServiceError(
          "DATA_FIELD_TYPE",
          400,
          `字段 ${name} 已是${label[current[1]]}，不能改成${label[type]}`,
        );
      if (!current) fields.push([name, type]);
    }
    if (fields.length > MAX_FIELDS) throw tooManyFields();
    let unique = c.unique;
    if (s.unique !== undefined) {
      if (s.unique === null) {
        unique = null;
        await this.data.run("UPDATE data_records SET unique_key=NULL WHERE collection_id=?", c.id);
      } else if (JSON.stringify(s.unique) !== JSON.stringify(c.unique)) {
        if (c.records > 0)
          throw new ServiceError("DATA_UNIQUE_REQUIRES_EMPTY", 409, "集合已有记录，只能在空集合上设置唯一字段");
        unique = s.unique;
      }
    }
    await this.data.run(
      "UPDATE data_collections SET fields=?,public_read=?,public_create=?,unique_fields=? WHERE id=?",
      JSON.stringify(fields),
      s.public ? s.public.includes("read") : c.publicRead,
      s.public ? s.public.includes("create") : c.publicCreate,
      unique ? JSON.stringify(unique) : null,
      c.id,
    );
    return { collection: infoOf((await this.collection(access.app.id, s.define))!) };
  }

  private async drop(access: Access, name: string) {
    const c = await this.collection(access.app.id, name);
    if (!c) throw notFound();
    await this.data.run("UPDATE data_collections SET dropped_at=? WHERE id=?", Date.now(), c.id);
    await this.data.run(
      "UPDATE data_apps SET records=records-?,bytes=bytes-? WHERE id=?",
      c.records,
      c.bytes,
      access.app.id,
    );
    return { dropped: true };
  }

  /** Validate fields against the collection, adding first-seen fields for members. */
  private accept(access: Access, c: Collection, input: Record<string, Value>): Record<string, Value> {
    const fields: Record<string, Value> = {};
    let added = false;
    for (const [name, value] of Object.entries(input)) {
      if (SYSTEM.has(name)) throw reserved(name);
      if (!FIELD.test(name))
        throw new ServiceError("DATA_FIELD_INVALID", 400, `字段名 ${name} 无效：使用字母、数字和下划线，最长 40 个字符`);
      const type = typeOf(value);
      if (!type) continue;
      const current = c.fields.find(([f]) => f === name);
      if (current && current[1] !== type)
        throw new ServiceError("DATA_FIELD_TYPE", 400, `字段 ${name} 是${label[current[1]]}，不能写入${label[type]}`);
      if (!current) {
        if (access.level === "anonymous")
          throw new ServiceError("DATA_FIELD_UNKNOWN", 400, `集合 ${c.name} 没有字段 ${name}`);
        c.fields.push([name, type]);
        added = true;
      }
      fields[name] = value;
    }
    if (c.fields.length > MAX_FIELDS) throw tooManyFields();
    if (added) c.dirty = true;
    return fields;
  }

  private size(fields: Record<string, Value>): number {
    const size = Buffer.byteLength(JSON.stringify(fields));
    if (size > this.limits.maxRecordBytes)
      throw new ServiceError(
        "DATA_RECORD_TOO_LARGE",
        413,
        `单条记录不能超过 ${Math.floor(this.limits.maxRecordBytes / 1024)} KB；大文件请上传后保存链接`,
      );
    return size;
  }

  /** Persist first-seen fields and size counters; exceeding the app quota rolls the statement back. */
  private async account(access: Access, c: Collection, records: number, bytes: number) {
    if (c.dirty)
      await this.data.run("UPDATE data_collections SET fields=? WHERE id=?", JSON.stringify(c.fields), c.id);
    await this.data.run(
      "UPDATE data_collections SET records=records+?,bytes=bytes+? WHERE id=?",
      records,
      bytes,
      c.id,
    );
    const app = await this.data.one<{ records: number; bytes: number }>(
      "UPDATE data_apps SET records=records+?,bytes=bytes+? WHERE id=? RETURNING records,bytes",
      records,
      bytes,
      access.app.id,
    );
    if (app && (app.records > this.limits.maxRecordsPerApp || app.bytes > this.limits.maxBytesPerApp))
      throw new ServiceError(
        "DATA_QUOTA_EXCEEDED",
        413,
        `应用最多 ${this.limits.maxRecordsPerApp} 条记录、${Math.floor(this.limits.maxBytesPerApp / 1048576)} MB 数据`,
      );
  }

  private async collection(appId: string, name: string): Promise<Collection | undefined> {
    const row = await this.data.one<CollectionRow>(
      "SELECT * FROM data_collections WHERE app_id=? AND name=? AND dropped_at IS NULL",
      appId,
      name,
    );
    return row ? collectionOf(row) : undefined;
  }
  private async create(appId: string, name: string): Promise<Collection> {
    const count = Number(
      (await this.data.one("SELECT COUNT(*) AS n FROM data_collections WHERE app_id=? AND dropped_at IS NULL", appId))?.n,
    );
    if (count >= MAX_COLLECTIONS)
      throw new ServiceError("DATA_COLLECTION_LIMIT", 409, `每个应用最多 ${MAX_COLLECTIONS} 个集合`);
    await this.data.run(
      "INSERT INTO data_collections(id,app_id,name,created_at) VALUES(?,?,?,?)",
      randomUUID(),
      appId,
      name,
      Date.now(),
    );
    return (await this.collection(appId, name))!;
  }
  private async readable(access: Access, name: string): Promise<Collection | undefined> {
    const c = await this.collection(access.app.id, name);
    if (access.level === "anonymous" && !c?.publicRead) throw forbidden();
    return c;
  }
  private async writable(access: Access, name: string): Promise<Collection> {
    const c = await this.collection(access.app.id, name);
    if (access.level === "anonymous") {
      if (!c?.publicCreate) throw forbidden();
      return c;
    }
    return c ?? this.create(access.app.id, name);
  }

  private async access(caller: DataCaller, id: string): Promise<Access> {
    const app = recordId.safeParse(id).success
      ? await this.data.one<AppRow>("SELECT * FROM data_apps WHERE id=? AND deleted_at IS NULL", id)
      : undefined;
    if (!app) throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
    if (caller.kind === "anonymous") {
      if (caller.key !== app.public_key)
        throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
      return { app, level: "anonymous", caller, ownerName: "" };
    }
    const actor = caller.actor;
    if (app.owner_kind === "user") {
      if (app.owner_id !== actor.id)
        throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
      return { app, level: "manage", caller, ownerName: actor.name };
    }
    const member = await this.membership(actor, app.owner_id);
    if (!member) throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
    return {
      app,
      level: member.manager || app.created_by === actor.id ? "manage" : "write",
      caller,
      ownerName: member.name,
    };
  }
  private async manage(caller: DataCaller, id: string): Promise<Access> {
    const access = await this.access(caller, id);
    if (access.level !== "manage")
      throw new ServiceError("DATA_FORBIDDEN", 403, "只有应用创建者或组织管理员可以管理应用");
    return access;
  }
  private async membership(actor: Actor, enterpriseId: string) {
    const row = await this.accounts.one<{ role: string; name: string }>(
      "SELECT m.role,e.name FROM members m JOIN enterprises e ON e.id=m.enterprise_id WHERE m.enterprise_id=? AND m.user_id=?",
      enterpriseId,
      actor.id,
    );
    if (!row && actor.role !== "admin") return undefined;
    return {
      name: row?.name ?? "",
      manager: actor.role === "admin" || row?.role === "owner" || row?.role === "admin",
    };
  }
  private async organizations(actor: Actor) {
    const rows = await this.accounts.all<{ id: string; name: string; role: string }>(
      "SELECT e.id,e.name,m.role FROM enterprises e JOIN members m ON m.enterprise_id=e.id WHERE m.user_id=? LIMIT 200",
      actor.id,
    );
    return new Map(rows.map((r) => [r.id, { name: r.name, manager: r.role === "owner" || r.role === "admin" }]));
  }

  private async describe(access: Access): Promise<AppDetail> {
    const rows = await this.data.all<CollectionRow>(
      "SELECT * FROM data_collections WHERE app_id=? AND dropped_at IS NULL ORDER BY created_at,name",
      access.app.id,
    );
    const collections = rows.map(collectionOf);
    const fresh = (await this.data.one<AppRow>("SELECT * FROM data_apps WHERE id=?", access.app.id)) ?? access.app;
    return {
      ...this.summary(
        fresh,
        access.ownerName,
        access.level === "manage",
        collections.length,
        collections.some((c) => c.publicRead || c.publicCreate),
      ),
      endpoint: `${this.origin}/api/data/v1/apps/${fresh.id}/run`,
      publicKey: fresh.public_key,
      limits: {
        records: this.limits.maxRecordsPerApp,
        bytes: this.limits.maxBytesPerApp,
        recordBytes: this.limits.maxRecordBytes,
      },
      collectionList: collections.map(infoOf),
    };
  }
  private summary(row: AppRow, ownerName: string, canManage: boolean, collections: number, isPublic: boolean): AppSummary {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      workspace: row.workspace,
      owner: { kind: row.owner_kind, id: row.owner_id, name: ownerName },
      public: isPublic,
      collections,
      records: row.records,
      bytes: row.bytes,
      canManage,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async rate(appId: string, ip: string) {
    const minute = Math.floor(Date.now() / 60000);
    const row = await this.data.one<{ count: number }>(
      "INSERT INTO data_rate(app_id,ip,minute,count) VALUES(?,?,?,1) ON CONFLICT(app_id,ip,minute) DO UPDATE SET count=data_rate.count+1 RETURNING count",
      appId,
      ip,
      minute,
    );
    if (row?.count === 1)
      await this.data.run("DELETE FROM data_rate WHERE app_id=? AND minute<?", appId, minute - 1);
    if ((row?.count ?? 0) > this.limits.anonymousPerMinute)
      throw new ServiceError("DATA_RATE_LIMITED", 429, "请求太频繁，请稍后再试");
  }

  private schedulePurge() {
    if (this.closed) return;
    this.purging = this.purging
      .then(() => this.purge())
      .catch((error: unknown) => {
        console.error("app data purge failed", error instanceof Error ? error.message : String(error));
      });
  }
  private async purge() {
    while (!this.closed) {
      const app = await this.data.one<{ id: string }>(
        "SELECT id FROM data_apps WHERE deleted_at IS NOT NULL ORDER BY deleted_at LIMIT 1",
      );
      if (app) {
        if (await this.chunk("app_id", app.id)) continue;
        await this.data.run("DELETE FROM data_apps WHERE id=?", app.id);
        continue;
      }
      const c = await this.data.one<{ id: string }>(
        "SELECT id FROM data_collections WHERE dropped_at IS NOT NULL ORDER BY dropped_at LIMIT 1",
      );
      if (!c) return;
      if (await this.chunk("collection_id", c.id)) continue;
      await this.data.run("DELETE FROM data_collections WHERE id=?", c.id);
    }
  }
  /** Delete one bounded chunk; returns whether rows were deleted. */
  private async chunk(column: "app_id" | "collection_id", id: string): Promise<boolean> {
    const result = await this.data.run(
      `DELETE FROM data_records WHERE ctid = ANY(ARRAY(SELECT ctid FROM data_records WHERE ${column}=? LIMIT ?))`,
      id,
      PURGE_CHUNK,
    );
    return result.changes > 0;
  }
  /** Wait for scheduled purges; tests and operators use it to observe completion. */
  async settled(): Promise<void> {
    await this.purging;
  }
}

type Parameter = string | number | boolean | null;
interface Key {
  sql: string;
  cast: string;
  value: (record: DataRecord) => Scalar | null;
}
const systemKeys: Record<string, Key> = {
  createdAt: { sql: "created_at", cast: "bigint", value: (r) => r.createdAt },
  updatedAt: { sql: "updated_at", cast: "bigint", value: (r) => r.updatedAt },
  id: { sql: "id", cast: "text", value: (r) => r.id },
};
function fieldSql(field: string, type: FieldType): { sql: string; cast: string } {
  if (type === "number") return { sql: `(data->>'${field}')::numeric`, cast: "numeric" };
  if (type === "boolean") return { sql: `(data->>'${field}')::boolean`, cast: "boolean" };
  return { sql: `(data->>'${field}') COLLATE "C"`, cast: "text" };
}
function sortKey(field: string, types: Map<string, FieldType>): Key {
  const system = systemKeys[field];
  if (system) return system;
  const type = types.get(field);
  if (!type) throw new ServiceError("DATA_FIELD_UNKNOWN", 400, `不能按未知字段 ${field} 排序`);
  if (type === "json") throw new ServiceError("DATA_SORT_UNSUPPORTED", 400, `JSON 字段 ${field} 不能排序`);
  const { sql, cast } = fieldSql(field, type);
  return {
    sql,
    cast,
    value: (r) => {
      const v = r[field];
      return v === undefined || v === null || typeof v === "object" ? null : v;
    },
  };
}
/** Translate a `where` object into SQL predicates, appending their parameters. */
function conditions(c: Collection, filter: Record<string, z.infer<typeof condition>> | undefined, params: Parameter[]): string[] {
  const types = new Map(c.fields);
  const out: string[] = [];
  for (const [field, raw] of Object.entries(filter ?? {})) {
    const system = field === "createdAt" || field === "updatedAt" || field === "id" ? systemKeys[field]! : undefined;
    const type: FieldType | undefined = system ? (field === "id" ? "text" : "number") : types.get(field);
    if (!type) throw new ServiceError("DATA_FIELD_UNKNOWN", 400, `集合 ${c.name} 没有字段 ${field}`);
    if (type === "json") throw new ServiceError("DATA_FILTER_UNSUPPORTED", 400, `JSON 字段 ${field} 不能筛选`);
    if (raw === null) {
      if (system) throw new ServiceError("DATA_FILTER_UNSUPPORTED", 400, `${field} 总是有值`);
      out.push("NOT jsonb_exists(data, ?)");
      params.push(field);
      continue;
    }
    const ops = typeof raw === "object" ? raw : { "=": raw };
    const expr = system ? { sql: system.sql, cast: system.cast } : fieldSql(field, type);
    const check = (value: Scalar) => {
      if (typeOf(value) !== type)
        throw new ServiceError("DATA_FILTER_TYPE", 400, `字段 ${field} 是${label[type]}，条件值类型不符`);
    };
    for (const [op, value] of Object.entries(ops) as [string, Scalar | Scalar[]][]) {
      if (op === "in") {
        const list = value as Scalar[];
        list.forEach(check);
        if (system) {
          out.push(`${expr.sql} IN (SELECT jsonb_array_elements_text(?::jsonb)::${expr.cast})`);
        } else {
          out.push(`data->'${field}' IN (SELECT jsonb_array_elements(?::jsonb))`);
        }
        params.push(JSON.stringify(list));
        continue;
      }
      if (op === "contains") {
        if (type !== "text")
          throw new ServiceError("DATA_FILTER_UNSUPPORTED", 400, `contains 只能用于文本字段`);
        out.push(`strpos(lower(${expr.sql}), lower(?)) > 0`);
        params.push(value as string);
        continue;
      }
      check(value as Scalar);
      if ((op === "=" || op === "!=") && !system) {
        out.push(op === "=" ? "data @> ?::jsonb" : "NOT (data @> ?::jsonb)");
        params.push(JSON.stringify({ [field]: value }));
        continue;
      }
      if (type === "boolean" && op !== "=" && op !== "!=")
        throw new ServiceError("DATA_FILTER_UNSUPPORTED", 400, `是/否字段 ${field} 只能比较相等`);
      const sqlOp = op === "=" ? "=" : op === "!=" ? "<>" : op;
      out.push(`${expr.sql} ${sqlOp} ?::${expr.cast}`);
      params.push(value as Scalar);
    }
  }
  return out;
}
function uniqueKey(unique: string[] | null, fields: Record<string, Value>): string | null {
  if (!unique) return null;
  const values = unique.map((f) => fields[f]);
  return values.some((v) => v === undefined || v === null) ? null : JSON.stringify(values);
}
function duplicate(error: unknown, c: Collection): unknown {
  if (error && typeof error === "object" && "code" in error && error.code === "23505") {
    const constraint = "constraint" in error ? error.constraint : undefined;
    return constraint === "data_records_unique"
      ? new ServiceError("DATA_DUPLICATE", 409, `已存在相同 ${(c.unique ?? []).join("、")} 的记录`)
      : new ServiceError("DATA_DUPLICATE", 409, "记录 id 已存在");
  }
  return error;
}
const notFound = () => new ServiceError("DATA_NOT_FOUND", 404, "记录不存在");
const conflict = () => new ServiceError("DATA_VERSION_CONFLICT", 409, "记录已被修改，请重新读取后再改");
const forbidden = () => new ServiceError("DATA_FORBIDDEN", 403, "公开 key 不能执行这个操作");
const reserved = (name: string) =>
  new ServiceError("DATA_FIELD_RESERVED", 400, `${name} 是系统字段，不能写入`);
const tooManyFields = () =>
  new ServiceError("DATA_FIELD_LIMIT", 400, `每个集合最多 ${MAX_FIELDS} 个字段`);
