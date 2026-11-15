/**
 * Small per-app record stores for plugins and published sites. Records live in a separate PostgreSQL database and are
 * read and written only through JSON statements; callers never see SQL. Personal apps belong to one user and organization
 * apps to their members. A public key admits anonymous reads or creates only on collections that opt in.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
const MAX_DEPTH = 16;
const MAX_WAITING = 100;
const MAX_ROLES = 200;
/** A visitor's sign-in lasts this long; replacing the app's public key ends every sign-in at once. */
const VISITOR_MS = 30 * 86_400_000;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const PRUNE_INTERVAL_MS = 3_600_000;
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
/** `__proto__` is refused because assigning it would change an object's prototype instead of storing a field. */
const validField = (name: string) => FIELD.test(name) && name !== "__proto__";
const fieldName = z
  .string()
  .refine(validField, "字段名使用字母、数字和下划线，最长 40 个字符");
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
  .record(fieldName, condition)
  .refine((value) => Object.keys(value).length <= 10, "最多 10 个筛选字段");
const recordId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "id 使用字母、数字、下划线或短横线，最长 64 个字符");
const search = z.string().trim().min(1).max(200);
const appId = z.uuid();
const version = z.number().int().positive();
const fieldTypes = z.enum(["text", "number", "boolean", "json"]);
const selected = z.array(z.string().regex(FIELD)).min(1).max(30);
const measured = z.array(fieldName).min(1).max(5);
const statements = {
  insert: z
    .object({
      insert: collection,
      values: z.union([values, z.array(values).min(1).max(MAX_INSERT)]),
    })
    .strict(),
  get: z.object({ get: collection, id: recordId, fields: selected.optional() }).strict(),
  find: z
    .object({
      find: collection,
      where: where.optional(),
      search: search.optional(),
      fields: selected.optional(),
      sort: z
        .string()
        .regex(/^-?[A-Za-z_][A-Za-z0-9_]{0,39}$/)
        .optional(),
      limit: z.number().int().min(1).max(MAX_PAGE).optional(),
      after: z.string().max(4000).optional(),
    })
    .strict(),
  count: z.object({ count: collection, where: where.optional(), search: search.optional() }).strict(),
  aggregate: z
    .object({
      aggregate: collection,
      where: where.optional(),
      search: search.optional(),
      group: fieldName.optional(),
      sum: measured.optional(),
      avg: measured.optional(),
      min: measured.optional(),
      max: measured.optional(),
      sort: z.enum(["key", "-key", "count", "-count"]).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    })
    .strict(),
  update: z
    .object({
      update: collection,
      id: recordId,
      set: values.optional(),
      inc: z.record(fieldName, z.number().finite()).optional(),
      version: version.optional(),
    })
    .strict()
    .refine((value) => value.set !== undefined || value.inc !== undefined, "update 需要 set 或 inc"),
  upsert: z
    .object({ upsert: collection, id: recordId, values, version: version.optional() })
    .strict(),
  delete: z
    .object({ delete: collection, id: recordId, version: version.optional() })
    .strict(),
  define: z
    .object({
      define: collection,
      fields: z.record(fieldName, fieldTypes).optional(),
      public: z.array(z.enum(["read", "create"])).max(2).optional(),
      users: z.array(z.enum(["read", "create", "own"])).max(3).optional(),
      unique: z.array(fieldName).min(1).max(3).nullable().optional(),
      strict: z.boolean().optional(),
      remove: z.array(fieldName).min(1).max(20).optional(),
    })
    .strict(),
  drop: z.object({ drop: collection }).strict(),
  info: z.object({ info: z.literal(true) }).strict(),
  me: z.object({ me: z.literal(true) }).strict(),
  grant: z
    .object({ grant: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/, "角色名使用小写字母、数字和下划线"), email: z.email().max(200) })
    .strict(),
  revoke: z.object({ revoke: z.email().max(200) }).strict(),
  origins: z.object({ origins: z.array(z.url().max(200)).max(10) }).strict(),
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
/** Refuse text PostgreSQL cannot store and nesting deep enough to exhaust the stack, before validation walks the value. */
function storable(input: unknown): void {
  const pending: [unknown, number][] = [[input, 0]];
  const refuse = () =>
    new ServiceError(
      "DATA_VALUE_INVALID",
      400,
      `文本不能包含空字符或不完整的 Unicode 字符，JSON 最多嵌套 ${MAX_DEPTH} 层`,
    );
  const text = (value: string) => {
    if (value.includes("\u0000") || LONE_SURROGATE.test(value)) throw refuse();
  };
  while (pending.length) {
    const [value, depth] = pending.pop()!;
    if (typeof value === "string") text(value);
    if (!value || typeof value !== "object") continue;
    if (depth >= MAX_DEPTH) throw refuse();
    for (const [key, child] of Object.entries(value)) {
      text(key);
      pending.push([child, depth + 1]);
    }
  }
}
function single(input: unknown): Statement {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalid();
  storable(input);
  const found = operations.filter((key) => key in input);
  if (found.length !== 1) throw invalid();
  return statements[found[0]!].parse(input) as Statement;
}
const invalid = () =>
  new ServiceError(
    "DATA_STATEMENT_INVALID",
    400,
    "每条语句需要且只能有一个操作：insert、get、find、count、aggregate、update、upsert、delete、define、drop、info、me、grant、revoke、origins；多条语句放在 batch 中",
  );

/** Who is calling: a signed-in account, or an anonymous visitor presenting an app's public key. */
export type DataCaller =
  | { kind: "member"; actor: Actor }
  | { kind: "anonymous"; key: string; ip: string; token?: string | undefined };
/**
 * Account callers manage or write. Key callers are anonymous, a signed-in visitor (`user`), or a visitor the app
 * made an administrator (`admin`), who may change every record but not the collections.
 */
type Level = "manage" | "write" | "admin" | "user" | "anonymous";
/** A signed-in visitor; `role` is "user" unless the app granted another one. */
export interface AppUser {
  id: string;
  name: string;
  role: string;
}
/** What an app serves: a DSH plugin, or a site, app or mini program that visitors open. */
export type AppKind = "plugin" | "site";
type AppRow = Row & {
  id: string;
  kind: AppKind;
  owner_kind: "user" | "enterprise";
  owner_id: string;
  slug: string;
  name: string;
  workspace: string;
  public_key: string;
  created_by: string;
  suspended_at: number | null;
  origins: string;
  pruned_seq: number;
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
  user_read: boolean;
  user_create: boolean;
  user_own: boolean;
  unique_fields: string | null;
  strict: boolean;
  records: number;
  bytes: number;
};
interface Collection {
  id: string;
  name: string;
  fields: [string, FieldType][];
  publicRead: boolean;
  publicCreate: boolean;
  userRead: boolean;
  userCreate: boolean;
  userOwn: boolean;
  /** Set when the caller may read only the records this user created. */
  author?: string;
  unique: string[] | null;
  /** Writes may use only declared fields. */
  strict: boolean;
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
  kind: AppKind;
  name: string;
  slug: string;
  workspace: string;
  owner: { kind: "user" | "enterprise"; id: string; name: string };
  public: boolean;
  /** The platform operator stopped the app; statements are refused until it is resumed. */
  suspended: boolean;
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
  /** Where a page sends visitors to sign in with their iPollo account; the page appends `&return=<its URL>`. */
  signin: string;
  /** Origins, besides the service's own and local development hosts, that sign-in may return to. */
  origins: string[];
  /** Visitors the app granted a role. */
  roles: { id: string; name: string; email: string; role: string }[];
  collectionList: CollectionInfo[];
}
/** A collection's declared fields, public access and size. */
export interface CollectionInfo {
  name: string;
  fields: Record<string, FieldType>;
  public: ("read" | "create")[];
  /** What signed-in visitors may do: read every record, create, or read and change the records they created. */
  users: ("read" | "create" | "own")[];
  unique: string[] | null;
  strict: boolean;
  records: number;
  bytes: number;
}
/** One write transaction; its statements share the sequence number allocated by the first write. */
interface Commit {
  seq?: number;
}
interface Access {
  app: AppRow;
  level: Level;
  caller: DataCaller;
  ownerName: string;
  user?: AppUser;
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
  userRead: row.user_read,
  userCreate: row.user_create,
  userOwn: row.user_own,
  unique: row.unique_fields ? (JSON.parse(row.unique_fields) as string[]) : null,
  strict: row.strict,
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
  users: [
    ...(c.userRead ? (["read"] as const) : []),
    ...(c.userCreate ? (["create"] as const) : []),
    ...(c.userOwn ? (["own"] as const) : []),
  ],
  unique: c.unique,
  strict: c.strict,
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
    if (current > 5)
      throw new Error("This app data database requires a newer iPolloWork service");
    if (current < 1) {
      await store.run(
        await readFile(new URL("./app-data-schema.sql", import.meta.url), "utf8"),
      );
      await store.run("INSERT INTO app_data_schema(version) VALUES(1)");
    }
    if (current < 2) {
      await store.run(
        await readFile(new URL("./app-data-migration-002.sql", import.meta.url), "utf8"),
      );
      await store.run("INSERT INTO app_data_schema(version) VALUES(2)");
    }
    if (current < 3) {
      await store.run(
        await readFile(new URL("./app-data-migration-003.sql", import.meta.url), "utf8"),
      );
      await store.run("INSERT INTO app_data_schema(version) VALUES(3)");
    }
    if (current < 4) {
      await store.run("ALTER TABLE data_collections ADD COLUMN strict BOOLEAN NOT NULL DEFAULT false");
      await store.run("INSERT INTO app_data_schema(version) VALUES(4)");
    }
    if (current < 5) {
      for (const sql of [
        "ALTER TABLE data_apps ADD COLUMN suspended_at BIGINT",
        "ALTER TABLE data_apps ADD COLUMN origins TEXT NOT NULL DEFAULT '[]'",
        "ALTER TABLE data_collections ADD COLUMN user_read BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE data_collections ADD COLUMN user_create BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE data_collections ADD COLUMN user_own BOOLEAN NOT NULL DEFAULT false",
        "CREATE TABLE data_app_roles(app_id TEXT NOT NULL REFERENCES data_apps(id) ON DELETE CASCADE,user_id TEXT NOT NULL,role TEXT NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(app_id,user_id))",
        "CREATE INDEX data_records_author ON data_records(collection_id,created_by) WHERE deleted_at IS NULL AND created_by IS NOT NULL",
      ])
        await store.run(sql);
      await store.run("INSERT INTO app_data_schema(version) VALUES(5)");
    }
  });
}

/** App data owner: permissions come from the account database, records from the app data database. */
export class AppData {
  private purging: Promise<void> = Promise.resolve();
  private closed = false;
  private pruneTimer: NodeJS.Timeout | undefined;
  /** In-flight anonymous statements per app; visitors of one public app cannot take all of its owner's slots. */
  private readonly anonymous = new Map<string, number>();
  /** Running and waiting statements per owner; one owner cannot occupy the pool every owner shares. */
  private readonly owners = new Map<string, { running: number; waiting: (() => void)[] }>();
  constructor(
    readonly data: Store,
    private readonly accounts: Store,
    private readonly limits: AppDataConfig,
    private readonly origin: string,
    /** Signs visitor sign-ins, and the publication origin that sign-in may always return to. */
    private readonly identity: { secret: string; publicationOrigin?: string | undefined },
  ) {}

  /** Resume purges interrupted by a restart, and remove expired tombstones every hour. */
  start(): void {
    this.schedulePurge();
    this.pruneTimer = setInterval(() => this.schedulePurge(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }
  /** Stop purging after the current chunk and close the app data pool. */
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.pruneTimer);
    await this.purging;
    await this.data.close();
  }

  /**
   * List personal apps and apps of the caller's organizations.
   * @param actor - the signed-in account.
   * @returns apps, most recently changed first, and every organization the caller belongs to, including those without apps.
   */
  async apps(actor: Actor): Promise<{ items: AppSummary[]; organizations: { id: string; name: string }[] }> {
    const orgs = await this.organizations(actor);
    const rows = await this.data.all<
      AppRow & { collections: number; is_public: boolean }
    >(
      `SELECT a.*,
        (SELECT COUNT(*) FROM data_collections c WHERE c.app_id=a.id AND c.dropped_at IS NULL) AS collections,
        EXISTS(SELECT 1 FROM data_collections c WHERE c.app_id=a.id AND c.dropped_at IS NULL AND (c.public_read OR c.public_create OR c.user_read OR c.user_create OR c.user_own)) AS is_public
       FROM data_apps a
       WHERE a.deleted_at IS NULL AND ((a.owner_kind='user' AND a.owner_id=?) OR (a.owner_kind='enterprise' AND a.owner_id IN (SELECT jsonb_array_elements_text(?::jsonb))))
       ORDER BY a.updated_at DESC LIMIT 2000`,
      actor.id,
      JSON.stringify([...orgs.keys()]),
    );
    const items = rows.map((row) => {
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
    return { items, organizations: [...orgs].map(([id, org]) => ({ id, name: org.name })) };
  }

  /**
   * Return the app with `slug` in the owner's scope, creating it when absent.
   * @param actor - the signed-in creator; organization apps require membership.
   * @param input - display name, kind used only when creating, optional slug, organization and workspace label.
   * @returns the app detail and whether it was created.
   */
  async ensure(
    actor: Actor,
    input: { name: string; kind: AppKind; slug?: string | undefined; enterpriseId?: string | undefined; workspace?: string | undefined },
  ): Promise<{ app: AppDetail; created: boolean }> {
    const owner = input.enterpriseId
      ? { kind: "enterprise" as const, id: input.enterpriseId }
      : { kind: "user" as const, id: actor.id };
    if (owner.kind === "enterprise" && !(await this.membership(actor.id, actor.role === "admin", owner.id)))
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
        "INSERT INTO data_apps(id,kind,owner_kind,owner_id,slug,name,workspace,public_key,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        id,
        input.kind,
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
    if (caller.kind !== "member") throw new ServiceError("SIGN_IN_REQUIRED", 401, "请先登录");
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

  /** Run `work` in one of the owner's slots, waiting for a free one; a full queue is refused instead of growing. */
  private async slot<T>(app: AppRow, work: () => Promise<T>): Promise<T> {
    const key = app.owner_kind + ":" + app.owner_id;
    const state = this.owners.get(key) ?? { running: 0, waiting: [] };
    this.owners.set(key, state);
    if (state.running >= this.limits.ownerConcurrency) {
      if (state.waiting.length >= MAX_WAITING)
        throw new ServiceError("DATA_RATE_LIMITED", 429, "同时进行的请求太多，请稍后再试");
      // The finishing statement hands its slot over, so `running` already counts this one.
      await new Promise<void>((resolve) => state.waiting.push(resolve));
    } else state.running++;
    try {
      return await work();
    } finally {
      const next = state.waiting.shift();
      if (next) next();
      else if (--state.running === 0) this.owners.delete(key);
    }
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
    if (access.app.suspended_at) throw suspended();
    if (caller.kind === "anonymous") {
      if ("batch" in statement || ("insert" in statement && Array.isArray(statement.values)))
        throw new ServiceError("DATA_FORBIDDEN", 403, "公开 key 每次只能写入一条记录");
      const writing = ["insert", "update", "upsert", "delete"].some((op) => op in statement);
      await this.rate(
        access.app.id,
        (writing ? "create:" : "read:") + (access.user ? "user:" + access.user.id : visitor(caller.ip)),
        writing ? this.limits.anonymousCreatesPerMinute : this.limits.anonymousPerMinute,
      );
      const running = this.anonymous.get(access.app.id) ?? 0;
      if (running >= this.limits.anonymousConcurrency)
        throw new ServiceError("DATA_RATE_LIMITED", 429, "访问人数较多，请稍后再试");
      this.anonymous.set(access.app.id, running + 1);
      try {
        return await this.slot(access.app, () => this.execute(access, statement, {}));
      } finally {
        const left = (this.anonymous.get(access.app.id) ?? 1) - 1;
        if (left > 0) this.anonymous.set(access.app.id, left);
        else this.anonymous.delete(access.app.id);
      }
    }
    const list = "batch" in statement ? statement.batch : [statement];
    // A batch is one commit: its writes share one sequence number, so the change feed never splits it.
    const commit: Commit = {};
    const result = await this.slot(access.app, async () =>
      "batch" in statement
        ? {
            results: await this.data.transaction(async () => {
              const results: unknown[] = [];
              for (const item of statement.batch) results.push(await this.execute(access, item, commit));
              return results;
            }),
          }
        : this.execute(access, statement, commit),
    );
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
   * @returns changes, the next cursor, whether more remain, the current collection names, and `reset` when deletions
   * older than the cursor were already removed, so the caller must reload every record.
   */
  async changes(caller: DataCaller, id: string, after: number, limit = MAX_CHANGES) {
    const access = await this.access(caller, id);
    if (caller.kind !== "member") throw new ServiceError("SIGN_IN_REQUIRED", 401, "同步需要登录");
    if (access.app.suspended_at) throw suspended();
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
      next: boundary ?? (rows.length ? rows[rows.length - 1]!.seq : after),
      more,
      reset: after > 0 && after < access.app.pruned_seq,
      collections: collections.map((c) => c.name),
    };
  }

  private async execute(access: Access, statement: Statement, commit: Commit): Promise<unknown> {
    const keyed = access.caller.kind !== "member";
    if ("info" in statement) {
      if (keyed) throw forbidden();
      return { app: await this.describe(access) };
    }
    if ("me" in statement) {
      const actor = access.caller.kind === "member" ? access.caller.actor : undefined;
      return { user: access.user ?? (actor ? { id: actor.id, name: actor.name, role: "admin" } : null) };
    }
    if ("grant" in statement || "revoke" in statement || "origins" in statement) {
      if (access.level !== "manage")
        throw new ServiceError("DATA_FORBIDDEN", 403, "只有应用管理者可以设置角色和登录来源");
      if ("origins" in statement) {
        const origins = [...new Set(statement.origins.map((url) => new URL(url).origin))];
        await this.data.run("UPDATE data_apps SET origins=?,updated_at=? WHERE id=?", JSON.stringify(origins), Date.now(), access.app.id);
        return { origins };
      }
      const email = "grant" in statement ? statement.email : statement.revoke;
      const user = await this.accounts.one<{ id: string }>('SELECT id FROM "user" WHERE lower(email)=lower(?)', email);
      if (!user)
        throw new ServiceError("DATA_USER_NOT_FOUND", 404, `没有使用 ${email} 的 iPollo 账号，请对方先注册`);
      if ("grant" in statement) {
        const count = Number((await this.data.one("SELECT COUNT(*) AS n FROM data_app_roles WHERE app_id=?", access.app.id))?.n);
        if (count >= MAX_ROLES) throw new ServiceError("DATA_ROLE_LIMIT", 409, `每个应用最多给 ${MAX_ROLES} 位用户设置角色`);
        await this.data.run(
          "INSERT INTO data_app_roles(app_id,user_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(app_id,user_id) DO UPDATE SET role=excluded.role",
          access.app.id,
          user.id,
          statement.grant,
          Date.now(),
        );
      } else await this.data.run("DELETE FROM data_app_roles WHERE app_id=? AND user_id=?", access.app.id, user.id);
      return { roles: await this.roles(access.app.id) };
    }
    if ("get" in statement) {
      const c = await this.readable(access, statement.get);
      if (!c) throw await this.missing(access.app.id, statement.get);
      const row = await this.data.one<RecordRow & { created_by: string | null }>(
        "SELECT id,data::text AS data,version,created_by,created_at,updated_at FROM data_records WHERE collection_id=? AND id=? AND deleted_at IS NULL",
        c.id,
        statement.id,
      );
      if (!row || (c.author && row.created_by !== c.author)) throw notFound(c.name, statement.id);
      const item = recordOf(row);
      if (!statement.fields) return { item };
      const keep = new Set([...SYSTEM, ...chosen(c, statement.fields)]);
      return { item: Object.fromEntries(Object.entries(item).filter(([name]) => keep.has(name))) };
    }
    if ("aggregate" in statement) {
      const c = await this.readable(access, statement.aggregate);
      if (!c) return { items: statement.group ? [] : [{ count: 0 }] };
      return this.aggregate(c, statement);
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
      if (statement.search) filters.push(searching(c, statement.search, params));
      const row = await this.data.one(
        "SELECT COUNT(*) AS n FROM data_records WHERE collection_id=? AND deleted_at IS NULL" +
          filters.map((f) => " AND " + f).join(""),
        ...params,
      );
      return { count: Number(row?.n ?? 0) };
    }
    if (keyed) {
      if ("define" in statement || "drop" in statement) throw forbidden();
      if ("upsert" in statement && access.level !== "admin") throw forbidden();
      if (("update" in statement || "delete" in statement) && access.level === "anonymous") throw forbidden();
    }
    if (("define" in statement || "drop" in statement) && access.level !== "manage")
      throw new ServiceError("DATA_FORBIDDEN", 403, "只有应用管理者可以定义或删除集合");
    return this.data.transaction(async () => {
      if (commit.seq === undefined) {
        const app = await this.data.one<{ seq: number }>(
          "UPDATE data_apps SET seq=seq+1,updated_at=? WHERE id=? AND deleted_at IS NULL RETURNING seq",
          Date.now(),
          access.app.id,
        );
        if (!app) throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
        commit.seq = app.seq;
      }
      const seq = commit.seq;
      if ("insert" in statement) return this.insert(access, statement, seq);
      if ("update" in statement) return this.change(access, statement, seq);
      if ("upsert" in statement) return this.upsert(access, statement, seq);
      if ("delete" in statement) return this.erase(access, statement, seq);
      if ("define" in statement) return this.define(access, statement, seq);
      return this.drop(access, statement.drop);
    });
  }

  private async find(c: Collection, s: Extract<Statement, { find: string }>) {
    const raw = s.sort ?? "-createdAt";
    const desc = raw.startsWith("-");
    const field = desc ? raw.slice(1) : raw;
    const key = sortKey(field, c);
    const params: Parameter[] = [c.id];
    const filters = conditions(c, s.where, params);
    if (s.search) filters.push(searching(c, s.search, params));
    if (s.after) {
      let cursor: [Scalar | null, string];
      try {
        cursor = JSON.parse(Buffer.from(s.after, "base64url").toString()) as [Scalar | null, string];
      } catch (error) {
        throw new ServiceError("DATA_CURSOR_INVALID", 400, "after 不是有效的翻页游标", { cause: error });
      }
      const [value, id] = Array.isArray(cursor) && cursor.length === 2 ? cursor : [undefined, undefined];
      const expected = key.cast === "text" ? "string" : key.cast === "boolean" ? "boolean" : "number";
      if (
        typeof id !== "string" ||
        id.length > 64 ||
        (value !== null && typeof value !== expected) ||
        (key.cast === "bigint" && !Number.isSafeInteger(value))
      )
        throw new ServiceError("DATA_CURSOR_INVALID", 400, "after 不是有效的翻页游标，请使用上一页返回的 next，并保持相同的 sort");
      const cmp = desc ? "<" : ">";
      if (value === null) {
        filters.push(`(${key.sql} IS NULL AND id ${cmp} ?)`);
        params.push(id);
      } else if (key.system) {
        filters.push(`(${key.sql},id) ${cmp} (?::${key.cast},?)`);
        params.push(value, id);
      } else {
        filters.push(
          `(${key.sql} ${cmp} ?::${key.cast} OR (${key.sql} = ?::${key.cast} AND id ${cmp} ?) OR ${key.sql} IS NULL)`,
        );
        params.push(value, value, id);
      }
    }
    const limit = s.limit ?? 20;
    params.push(limit + 1);
    // The sort field travels with a narrowed row so the cursor can be built, and is dropped before returning.
    const wanted = s.fields ? chosen(c, s.fields) : undefined;
    const carried = wanted && !key.system && !wanted.includes(field) ? field : undefined;
    const rows = await this.data.all<RecordRow>(
      "SELECT id," +
        (wanted
          ? "COALESCE((SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(data) e WHERE e.key IN (SELECT jsonb_array_elements_text(?::jsonb))),'{}'::jsonb)::text"
          : "data::text") +
        " AS data,version,created_at,updated_at FROM data_records WHERE collection_id=? AND deleted_at IS NULL" +
        filters.map((f) => " AND " + f).join("") +
        // System columns are never null; without NULLS LAST the default listing reads `data_records_created` in order.
        ` ORDER BY ${key.sql} ${desc ? "DESC" : "ASC"}${key.system ? "" : " NULLS LAST"}, id ${desc ? "DESC" : "ASC"} LIMIT ?`,
      ...(wanted ? [JSON.stringify(carried ? [...wanted, carried] : wanted)] : []),
      ...params,
    );
    const items = rows.slice(0, limit).map(recordOf);
    const last = items[items.length - 1];
    const next = rows.length > limit && last ? encode([key.value(last), last.id]) : null;
    if (carried) for (const item of items) delete item[carried];
    return { items, next };
  }

  /** Count and measure records, as one row or one row per value of `group`. */
  private async aggregate(c: Collection, s: Extract<Statement, { aggregate: string }>) {
    const types = new Map(c.fields);
    const typed = (field: string, use: string, allowed: FieldType[]): FieldType => {
      const type = types.get(field);
      if (!type) throw new ServiceError("DATA_FIELD_UNKNOWN", 400, `集合 ${c.name} 没有字段 ${field}；${fieldList(c)}`);
      if (!allowed.includes(type))
        throw new ServiceError("DATA_AGGREGATE_UNSUPPORTED", 400, `${use} 不能用于${label[type]}字段 ${field}`);
      return type;
    };
    const columns = ["COUNT(*) AS n"];
    const measures: { op: "sum" | "avg" | "min" | "max"; field: string; alias: string }[] = [];
    for (const op of ["sum", "avg", "min", "max"] as const)
      for (const field of s[op] ?? []) {
        const type = typed(field, op, op === "sum" || op === "avg" ? ["number"] : ["number", "text"]);
        const alias = `${op}_${measures.length}`;
        columns.push(
          type === "number"
            ? `${op.toUpperCase()}((data->>'${field}')::numeric)::float8 AS ${alias}`
            : `${op.toUpperCase()}(data->>'${field}' COLLATE "C") AS ${alias}`,
        );
        measures.push({ op, field, alias });
      }
    const group = s.group === undefined ? undefined : typed(s.group, "group", ["text", "number", "boolean"]);
    if (group)
      columns.unshift(
        (group === "number"
          ? `(data->>'${s.group}')::numeric::float8`
          : group === "boolean"
            ? `(data->>'${s.group}')::boolean`
            : `data->>'${s.group}'`) + " AS key",
      );
    const params: Parameter[] = [c.id];
    const filters = conditions(c, s.where, params);
    if (s.search) filters.push(searching(c, s.search, params));
    const limit = s.limit ?? 100;
    const sort = s.sort ?? "key";
    const direction = sort.startsWith("-") ? "DESC" : "ASC";
    let tail = "";
    if (group) {
      tail = ` GROUP BY 1 ORDER BY ${sort.endsWith("count") ? `n ${direction}, ` : ""}1 ${sort.endsWith("count") ? "ASC" : direction} NULLS LAST LIMIT ?`;
      params.push(limit + 1);
    }
    const rows = await this.data.all(
      `SELECT ${columns.join(",")} FROM data_records WHERE collection_id=? AND deleted_at IS NULL` +
        filters.map((f) => " AND " + f).join("") +
        tail,
      ...params,
    );
    const items = rows.slice(0, group ? limit : 1).map((row) => {
      const item: Record<string, unknown> = { ...(group ? { key: row.key } : {}), count: Number(row.n) };
      for (const { op, field, alias } of measures)
        ((item[op] ??= {}) as Record<string, unknown>)[field] = row[alias] ?? null;
      return item;
    });
    return group ? { items, more: rows.length > limit } : { items };
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
      if (given !== undefined && (access.level === "anonymous" || access.level === "user"))
        throw new ServiceError("DATA_FORBIDDEN", 403, "公开 key 不能指定记录 id，id 由服务生成");
      if (given !== undefined && !recordId.safeParse(given).success)
        throw new ServiceError("DATA_RECORD_ID_INVALID", 400, "id 使用字母、数字、下划线或短横线，最长 64 个字符；不填由服务生成");
      const fields = this.accept(access, c, rest);
      const size = this.size(fields);
      const id = (given as string | undefined) ?? randomUUID();
      // A deleted record keeps its id as a tombstone; a new record with that id replaces it.
      if (given !== undefined)
        await this.data.run(
          "DELETE FROM data_records WHERE collection_id=? AND id=? AND deleted_at IS NOT NULL",
          c.id,
          id,
        );
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
          author(access),
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
    const c = await this.changeable(access, s.update);
    const row = await this.data.one<RecordRow & { bytes: number; created_by: string | null }>(
      "SELECT id,data::text AS data,version,bytes,created_by,created_at,updated_at FROM data_records WHERE collection_id=? AND id=? AND deleted_at IS NULL",
      c.id,
      s.id,
    );
    if (!row) throw notFound(c.name, s.id);
    owns(access, c, row.created_by);
    if (s.version !== undefined && s.version !== row.version) throw conflict();
    const merged = { ...(JSON.parse(row.data) as Record<string, Value>), ...s.set };
    for (const [k, v] of Object.entries(s.set ?? {})) if (v === null) delete merged[k];
    // The app row lock serializes writers, so adding to the stored number cannot lose a concurrent change.
    for (const [k, by] of Object.entries(s.inc ?? {})) {
      const now = merged[k];
      if (now !== undefined && typeof now !== "number")
        throw new ServiceError("DATA_FIELD_TYPE", 400, `字段 ${k} 不是数字，不能用 inc 增减`);
      merged[k] = (now ?? 0) + by;
    }
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

  /** Create the record with this id, or replace all of its fields; a deleted record is created again. */
  private async upsert(access: Access, s: Extract<Statement, { upsert: string }>, seq: number) {
    const c = await this.writable(access, s.upsert);
    const fields = this.accept(access, c, s.values);
    const size = this.size(fields);
    const row = await this.data.one<{ version: number; bytes: number; deleted_at: number | null; created_at: number }>(
      "SELECT version,bytes,deleted_at,created_at FROM data_records WHERE collection_id=? AND id=?",
      c.id,
      s.id,
    );
    const live = row !== undefined && row.deleted_at === null;
    if (s.version !== undefined && (!live || s.version !== row.version)) throw conflict();
    const at = Date.now();
    const version = row ? row.version + 1 : 1;
    const createdAt = live ? row.created_at : at;
    try {
      if (row)
        await this.data.run(
          "UPDATE data_records SET data=?::jsonb,version=?,seq=?,bytes=?,unique_key=?,deleted_at=NULL,created_at=?,updated_at=? WHERE collection_id=? AND id=?",
          JSON.stringify(fields), version, seq, size, uniqueKey(c.unique, fields), createdAt, at, c.id, s.id,
        );
      else
        await this.data.run(
          "INSERT INTO data_records(collection_id,app_id,id,data,version,seq,bytes,unique_key,created_by,created_at,updated_at) VALUES(?,?,?,?::jsonb,1,?,?,?,?,?,?)",
          c.id, access.app.id, s.id, JSON.stringify(fields), seq, size, uniqueKey(c.unique, fields),
          author(access), at, at,
        );
    } catch (error) {
      throw duplicate(error, c);
    }
    await this.account(access, c, live ? 0 : 1, size - (live ? row.bytes : 0));
    return { item: { id: s.id, ...fields, version, createdAt, updatedAt: at }, created: !live };
  }

  private async erase(access: Access, s: Extract<Statement, { delete: string }>, seq: number) {
    const c = await this.changeable(access, s.delete);
    const row = await this.data.one<{ version: number; bytes: number; created_by: string | null }>(
      "SELECT version,bytes,created_by FROM data_records WHERE collection_id=? AND id=? AND deleted_at IS NULL",
      c.id,
      s.id,
    );
    if (!row) throw notFound(c.name, s.id);
    owns(access, c, row.created_by);
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

  private async define(access: Access, s: Extract<Statement, { define: string }>, seq: number) {
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
    const kept = fields.filter(([name]) => !s.remove?.includes(name));
    for (const name of s.remove ?? []) {
      if (unique?.includes(name))
        throw new ServiceError("DATA_FIELD_IN_USE", 409, `字段 ${name} 是唯一字段，先用 "unique":null 取消唯一再移除`);
      if (!fields.some(([f]) => f === name))
        throw new ServiceError("DATA_FIELD_UNKNOWN", 400, `集合 ${c.name} 没有字段 ${name}；${fieldList(c)}`);
      // Records keep their recorded size, which only overstates the app's usage until they are next written.
      await this.data.run(
        "UPDATE data_records SET data=data - ?,version=version+1,seq=?,updated_at=? WHERE collection_id=? AND deleted_at IS NULL AND jsonb_exists(data, ?)",
        name,
        seq,
        Date.now(),
        c.id,
        name,
      );
    }
    await this.data.run(
      "UPDATE data_collections SET fields=?,public_read=?,public_create=?,user_read=?,user_create=?,user_own=?,unique_fields=?,strict=? WHERE id=?",
      JSON.stringify(kept),
      s.public ? s.public.includes("read") : c.publicRead,
      s.public ? s.public.includes("create") : c.publicCreate,
      s.users ? s.users.includes("read") : c.userRead,
      s.users ? s.users.includes("create") : c.userCreate,
      s.users ? s.users.includes("own") : c.userOwn,
      unique ? JSON.stringify(unique) : null,
      s.strict ?? c.strict,
      c.id,
    );
    return { collection: infoOf((await this.collection(access.app.id, s.define))!) };
  }

  private async drop(access: Access, name: string) {
    const c = await this.collection(access.app.id, name);
    if (!c) throw await this.missing(access.app.id, name);
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
      if (!validField(name))
        throw new ServiceError("DATA_FIELD_INVALID", 400, `字段名 ${name} 无效：使用字母、数字和下划线，最长 40 个字符`);
      const type = typeOf(value);
      if (!type) continue;
      const current = c.fields.find(([f]) => f === name);
      if (current && current[1] !== type)
        throw new ServiceError("DATA_FIELD_TYPE", 400, `字段 ${name} 是${label[current[1]]}，不能写入${label[type]}`);
      if (!current) {
        if (access.caller.kind !== "member")
          throw new ServiceError("DATA_FIELD_UNKNOWN", 400, `集合 ${c.name} 不接受字段 ${name}`);
        if (c.strict)
          throw new ServiceError(
            "DATA_FIELD_UNKNOWN",
            400,
            `集合 ${c.name} 只接受已声明的字段，没有 ${name}；${fieldList(c)}；需要新字段时先用 define 声明`,
          );
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
    // Only growth is refused, so an app over a lowered limit can still delete and shrink.
    if (records <= 0 && bytes <= 0) return;
    if (app && (app.records > this.limits.maxRecordsPerApp || app.bytes > this.limits.maxBytesPerApp))
      throw new ServiceError(
        "DATA_QUOTA_EXCEEDED",
        413,
        `应用最多 ${this.limits.maxRecordsPerApp} 条记录、${Math.floor(this.limits.maxBytesPerApp / 1048576)} MB 数据`,
      );
    // Other apps of the owner commit concurrently, so the total may overshoot by their in-flight writes.
    const total = await this.data.one<{ bytes: number }>(
      "SELECT COALESCE(SUM(bytes),0) AS bytes FROM data_apps WHERE owner_kind=? AND owner_id=? AND deleted_at IS NULL",
      access.app.owner_kind,
      access.app.owner_id,
    );
    if (Number(total?.bytes ?? 0) > this.limits.maxBytesPerOwner)
      throw new ServiceError(
        "DATA_QUOTA_EXCEEDED",
        413,
        `所有应用合计最多 ${Math.floor(this.limits.maxBytesPerOwner / 1048576)} MB 数据，请删除不用的应用或记录`,
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
  /** A missing collection error that names the app's collections, so the caller can correct the statement. */
  private async missing(appId: string, name: string): Promise<ServiceError> {
    const rows = await this.data.all<{ name: string }>(
      "SELECT name FROM data_collections WHERE app_id=? AND dropped_at IS NULL ORDER BY name LIMIT 50",
      appId,
    );
    return new ServiceError(
      "DATA_COLLECTION_NOT_FOUND",
      404,
      `集合 ${name} 不存在；${rows.length ? "已有集合：" + rows.map((r) => r.name).join("、") : "这个应用还没有集合，insert 或 upsert 会自动创建"}`,
    );
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
  /** The collection a caller may read. Key callers learn nothing about collections they cannot read. */
  private async readable(access: Access, name: string): Promise<Collection | undefined> {
    const c = await this.collection(access.app.id, name);
    const level = access.level;
    if (level === "manage" || level === "write") return c;
    if (!c) throw forbidden();
    if (level === "admin" || c.publicRead || (level === "user" && c.userRead)) return c;
    if (level === "user" && c.userOwn) {
      c.author = access.user!.id;
      return c;
    }
    throw forbidden();
  }
  /** The collection a caller may create records in; only account callers create collections. */
  private async writable(access: Access, name: string): Promise<Collection> {
    const c = await this.collection(access.app.id, name);
    const level = access.level;
    if (level === "manage" || level === "write") return c ?? this.create(access.app.id, name);
    if (c && (level === "admin" || c.publicCreate || (level === "user" && c.userCreate))) return c;
    throw forbidden();
  }
  /** The collection whose existing records a caller may try to change; `owns` then checks the record. */
  private async changeable(access: Access, name: string): Promise<Collection> {
    const c = await this.collection(access.app.id, name);
    if (access.caller.kind === "member") {
      if (!c) throw await this.missing(access.app.id, name);
      return c;
    }
    if (c && (access.level === "admin" || (access.level === "user" && c.userOwn))) return c;
    throw forbidden();
  }

  private async access(caller: DataCaller, id: string): Promise<Access> {
    const app = appId.safeParse(id).success
      ? await this.data.one<AppRow>("SELECT * FROM data_apps WHERE id=? AND deleted_at IS NULL", id)
      : undefined;
    if (!app) throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
    if (caller.kind === "anonymous") {
      if (caller.key !== app.public_key)
        throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
      // A banned or removed owner's published pages stop reading and collecting records.
      if (
        app.owner_kind === "user" &&
        !(await this.accounts.one('SELECT 1 FROM "user" WHERE id=? AND banned IS NOT TRUE', app.owner_id))
      )
        throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
      if (!caller.token) return { app, level: "anonymous", caller, ownerName: "" };
      const userId = this.verify(app, caller.token);
      const user = await this.accounts.one<{ name: string }>('SELECT name FROM "user" WHERE id=? AND banned IS NOT TRUE', userId);
      if (!user) throw expired();
      // The app's own managers are its administrators without a grant.
      const manages =
        app.owner_kind === "user" ? app.owner_id === userId : (await this.membership(userId, false, app.owner_id))?.manager === true;
      const role = manages
        ? "admin"
        : ((await this.data.one<{ role: string }>("SELECT role FROM data_app_roles WHERE app_id=? AND user_id=?", app.id, userId))?.role ?? "user");
      return { app, level: role === "admin" ? "admin" : "user", caller, ownerName: "", user: { id: userId, name: user.name, role } };
    }
    const actor = caller.actor;
    if (app.owner_kind === "user") {
      if (app.owner_id !== actor.id)
        throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在或没有访问权限");
      return { app, level: "manage", caller, ownerName: actor.name };
    }
    const member = await this.membership(actor.id, actor.role === "admin", app.owner_id);
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
  private async membership(userId: string, operator: boolean, enterpriseId: string) {
    const row = await this.accounts.one<{ role: string; name: string }>(
      "SELECT m.role,e.name FROM members m JOIN enterprises e ON e.id=m.enterprise_id WHERE m.enterprise_id=? AND m.user_id=?",
      enterpriseId,
      userId,
    );
    if (!row && !operator) return undefined;
    return {
      name: row?.name ?? "",
      manager: operator || row?.role === "owner" || row?.role === "admin",
    };
  }

  private sign(app: AppRow, body: string): Buffer {
    return createHmac("sha256", this.identity.secret).update(`${app.id}\n${app.public_key}\n${body}`).digest();
  }
  /** @returns the user id a visitor token was issued to for this app; expired or foreign tokens are refused. */
  private verify(app: AppRow, token: string): string {
    const match = /^ipd_([A-Za-z0-9_-]{1,400})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match) throw expired();
    const given = Buffer.from(match[2]!, "base64url");
    const wanted = this.sign(app, match[1]!);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw expired();
    const claim = z
      .object({ u: z.string().min(1), e: z.number() })
      .safeParse(JSON.parse(Buffer.from(match[1]!, "base64url").toString()));
    if (!claim.success || claim.data.e < Date.now()) throw expired();
    return claim.data.u;
  }
  /**
   * Describe, and on `confirm` complete, a visitor's sign-in to an app with their iPollo account.
   * @param actor - the account signed in to the service.
   * @param input - the app id, its public key and the page URL to return to.
   * @param confirm - whether the account agreed; without it nothing is issued.
   * @returns the app name and return origin to show, and after confirmation the return URL carrying the token.
   */
  async signin(actor: Actor, input: { app: string; key: string; return: string }, confirm: boolean) {
    const access = await this.access({ kind: "anonymous", key: input.key, ip: "" }, input.app);
    if (access.app.suspended_at) throw suspended();
    const target = new URL(input.return);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
    const allowed = [this.origin, this.identity.publicationOrigin, ...(JSON.parse(access.app.origins) as string[])];
    if (!/^https?:$/.test(target.protocol) || !(local || allowed.includes(target.origin)))
      throw new ServiceError(
        "DATA_ORIGIN_NOT_ALLOWED",
        403,
        `「${access.app.name}」还没有允许从 ${target.origin} 登录；应用管理者需要先把这个网址加入登录来源`,
      );
    if (!confirm) return { name: access.app.name, origin: target.origin };
    const body = Buffer.from(JSON.stringify({ u: actor.id, e: Date.now() + VISITOR_MS })).toString("base64url");
    target.hash = "ipollo_token=ipd_" + body + "." + this.sign(access.app, body).toString("base64url");
    return { name: access.app.name, origin: target.origin, url: target.toString() };
  }
  private async roles(appId: string) {
    const rows = await this.data.all<{ user_id: string; role: string }>(
      "SELECT user_id,role FROM data_app_roles WHERE app_id=? ORDER BY created_at",
      appId,
    );
    const users = new Map(
      (
        await this.accounts.all<{ id: string; name: string; email: string }>(
          'SELECT id,name,email FROM "user" WHERE id IN (SELECT jsonb_array_elements_text(?::jsonb))',
          JSON.stringify(rows.map((row) => row.user_id)),
        )
      ).map((user) => [user.id, user]),
    );
    return rows.map((row) => ({
      id: row.user_id,
      name: users.get(row.user_id)?.name ?? "",
      email: users.get(row.user_id)?.email ?? "",
      role: row.role,
    }));
  }

  /**
   * Every app of the deployment for the platform operator, with owners resolved from the account database.
   * @param input - a name or owner search, the order, and the page.
   * @returns one page of apps and the deployment's totals; `stored` is what the records table occupies on disk.
   */
  async overview(input: { q: string; sort: "bytes" | "updated"; offset: number; limit: number }) {
    const params: Parameter[] = [];
    let filter = "";
    if (input.q) {
      const owners = [
        ...(await this.accounts.all<{ id: string }>(
          'SELECT id FROM "user" WHERE strpos(lower(name),lower(?))>0 OR strpos(lower(email),lower(?))>0 LIMIT 200',
          input.q,
          input.q,
        )),
        ...(await this.accounts.all<{ id: string }>("SELECT id FROM enterprises WHERE strpos(lower(name),lower(?))>0 LIMIT 200", input.q)),
      ].map((row) => row.id);
      filter = " AND (strpos(lower(a.name),lower(?))>0 OR a.owner_id IN (SELECT jsonb_array_elements_text(?::jsonb)))";
      params.push(input.q, JSON.stringify(owners));
    }
    const rows = await this.data.all<AppRow & { collections: number; is_public: boolean }>(
      `SELECT a.*,
        (SELECT COUNT(*) FROM data_collections c WHERE c.app_id=a.id AND c.dropped_at IS NULL) AS collections,
        EXISTS(SELECT 1 FROM data_collections c WHERE c.app_id=a.id AND c.dropped_at IS NULL AND (c.public_read OR c.public_create OR c.user_read OR c.user_create OR c.user_own)) AS is_public
       FROM data_apps a WHERE a.deleted_at IS NULL${filter}
       ORDER BY ${input.sort === "bytes" ? "a.bytes DESC" : "a.updated_at DESC"},a.id LIMIT ? OFFSET ?`,
      ...params,
      input.limit,
      input.offset,
    );
    const ids = (kind: string) => JSON.stringify(rows.filter((row) => row.owner_kind === kind).map((row) => row.owner_id));
    const owners = new Map<string, string>();
    for (const user of await this.accounts.all<{ id: string; name: string; email: string }>(
      'SELECT id,name,email FROM "user" WHERE id IN (SELECT jsonb_array_elements_text(?::jsonb))',
      ids("user"),
    ))
      owners.set(user.id, `${user.name} · ${user.email}`);
    for (const org of await this.accounts.all<{ id: string; name: string }>(
      "SELECT id,name FROM enterprises WHERE id IN (SELECT jsonb_array_elements_text(?::jsonb))",
      ids("enterprise"),
    ))
      owners.set(org.id, org.name);
    const totals = await this.data.one<{ apps: number; records: number; bytes: number; stored: number }>(
      `SELECT COUNT(*) AS apps,COALESCE(SUM(records),0) AS records,COALESCE(SUM(bytes),0) AS bytes,
        pg_total_relation_size('data_records')::bigint AS stored FROM data_apps WHERE deleted_at IS NULL`,
    );
    return {
      items: rows.map((row) => this.summary(row, owners.get(row.owner_id) ?? "", true, Number(row.collections), row.is_public)),
      totals: { apps: Number(totals?.apps), records: Number(totals?.records), bytes: Number(totals?.bytes), stored: Number(totals?.stored) },
    };
  }
  /**
   * Stop or resume an app on the operator's decision; a suspended app refuses every statement but stays listed.
   * @param id - the app id.
   * @param suspended - whether the app is stopped.
   */
  async suspend(id: string, suspended: boolean): Promise<void> {
    const result = await this.data.run(
      "UPDATE data_apps SET suspended_at=? WHERE id=? AND deleted_at IS NULL",
      suspended ? Date.now() : null,
      id,
    );
    if (!result.changes) throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在");
  }
  /**
   * Delete any app on the operator's decision; its records are purged in the background.
   * @param id - the app id.
   */
  async discard(id: string): Promise<void> {
    const result = await this.data.run("UPDATE data_apps SET deleted_at=? WHERE id=? AND deleted_at IS NULL", Date.now(), id);
    if (!result.changes) throw new ServiceError("DATA_APP_NOT_FOUND", 404, "应用不存在");
    this.schedulePurge();
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
        collections.some((c) => c.publicRead || c.publicCreate || c.userRead || c.userCreate || c.userOwn),
      ),
      endpoint: `${this.origin}/api/data/v1/apps/${fresh.id}/run`,
      publicKey: fresh.public_key,
      signin: `${this.origin}/connect?app=${fresh.id}&key=${fresh.public_key}`,
      origins: JSON.parse(fresh.origins) as string[],
      roles: await this.roles(fresh.id),
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
      kind: row.kind,
      name: row.name,
      slug: row.slug,
      workspace: row.workspace,
      owner: { kind: row.owner_kind, id: row.owner_id, name: ownerName },
      public: isPublic,
      suspended: row.suspended_at !== null,
      collections,
      records: row.records,
      bytes: row.bytes,
      canManage,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async rate(appId: string, bucket: string, limit: number) {
    const minute = Math.floor(Date.now() / 60000);
    const row = await this.data.one<{ count: number }>(
      "INSERT INTO data_rate(app_id,bucket,minute,count) VALUES(?,?,?,1) ON CONFLICT(app_id,bucket,minute) DO UPDATE SET count=data_rate.count+1 RETURNING count",
      appId,
      bucket,
      minute,
    );
    if (row?.count === 1)
      await this.data.run("DELETE FROM data_rate WHERE app_id=? AND minute<?", appId, minute - 1);
    if ((row?.count ?? 0) > limit)
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
      if (c) {
        if (await this.chunk("collection_id", c.id)) continue;
        await this.data.run("DELETE FROM data_collections WHERE id=?", c.id);
        continue;
      }
      if (await this.prune()) continue;
      await this.data.run("DELETE FROM data_rate WHERE minute<?", Math.floor(Date.now() / 60000) - 1);
      return;
    }
  }
  /**
   * Remove one chunk of tombstones older than the retention period. The app row is locked first, as writers do, and
   * records the newest removed sequence so `changes` can tell a stale cursor to reload.
   */
  private async prune(): Promise<boolean> {
    const before = Date.now() - this.limits.tombstoneDays * 86_400_000;
    const old = await this.data.one<{ app_id: string }>(
      "SELECT app_id FROM data_records WHERE deleted_at IS NOT NULL AND deleted_at<? LIMIT 1",
      before,
    );
    if (!old) return false;
    await this.data.transaction(async () => {
      await this.data.run("SELECT 1 FROM data_apps WHERE id=? FOR UPDATE", old.app_id);
      const gone = await this.data.one<{ seq: number | null }>(
        `WITH gone AS (DELETE FROM data_records WHERE ctid = ANY(ARRAY(
           SELECT ctid FROM data_records WHERE app_id=? AND deleted_at IS NOT NULL AND deleted_at<? LIMIT ?)) RETURNING seq)
         SELECT MAX(seq) AS seq FROM gone`,
        old.app_id,
        before,
        PURGE_CHUNK,
      );
      if (gone?.seq != null)
        await this.data.run("UPDATE data_apps SET pruned_seq=GREATEST(pruned_seq,?) WHERE id=?", gone.seq, old.app_id);
    });
    return true;
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

/** A visitor's rate bucket: the IPv4 address, or the /64 network of an IPv6 address, which one visitor can rotate within. */
function visitor(ip: string): string {
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip;
}
type Parameter = string | number | boolean | null;
interface Key {
  sql: string;
  cast: string;
  /** A record column that always has a value, as opposed to a field inside `data`. */
  system?: true;
  value: (record: DataRecord) => Scalar | null;
}
const systemKeys: Record<string, Key> = {
  createdAt: { sql: "created_at", cast: "bigint", system: true, value: (r) => r.createdAt },
  updatedAt: { sql: "updated_at", cast: "bigint", system: true, value: (r) => r.updatedAt },
  id: { sql: "id", cast: "text", system: true, value: (r) => r.id },
};
function fieldSql(field: string, type: FieldType): { sql: string; cast: string } {
  if (type === "number") return { sql: `(data->>'${field}')::numeric`, cast: "numeric" };
  if (type === "boolean") return { sql: `(data->>'${field}')::boolean`, cast: "boolean" };
  return { sql: `(data->>'${field}') COLLATE "C"`, cast: "text" };
}
function sortKey(field: string, c: Collection): Key {
  const system = Object.hasOwn(systemKeys, field) ? systemKeys[field] : undefined;
  if (system) return system;
  const type = new Map(c.fields).get(field);
  if (!type) throw new ServiceError("DATA_FIELD_UNKNOWN", 400, `不能按未知字段 ${field} 排序；${fieldList(c)}`);
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
  if (c.author) {
    out.push("created_by=?");
    params.push(c.author);
  }
  for (const [field, raw] of Object.entries(filter ?? {})) {
    const system = field === "createdAt" || field === "updatedAt" || field === "id" ? systemKeys[field]! : undefined;
    const type: FieldType | undefined = system ? (field === "id" ? "text" : "number") : types.get(field);
    if (!type) throw new ServiceError("DATA_FIELD_UNKNOWN", 400, `集合 ${c.name} 没有字段 ${field}；${fieldList(c)}`);
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
      if (system?.cast === "bigint" && !Number.isSafeInteger(value))
        throw new ServiceError("DATA_FILTER_TYPE", 400, `${field} 是毫秒时间戳，条件值需要是整数`);
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
/** Validate a `fields` selection and return the record fields it names; system fields are always returned. */
function chosen(c: Collection, names: string[]): string[] {
  const known = new Set(c.fields.map(([name]) => name));
  for (const name of names)
    if (!known.has(name) && !SYSTEM.has(name))
      throw new ServiceError("DATA_FIELD_UNKNOWN", 400, `集合 ${c.name} 没有字段 ${name}；${fieldList(c)}`);
  return names.filter((name) => known.has(name));
}
/** One predicate matching records whose id, or any text or number field, contains `term` without regard to letter case. */
function searching(c: Collection, term: string, params: Parameter[]): string {
  const parts = ["strpos(lower(id), lower(?)) > 0"];
  params.push(term);
  for (const [field, type] of c.fields) {
    if (type !== "text" && type !== "number") continue;
    parts.push(`strpos(lower(data->>'${field}'), lower(?)) > 0`);
    params.push(term);
  }
  return "(" + parts.join(" OR ") + ")";
}
function uniqueKey(unique: string[] | null, fields: Record<string, Value>): string | null {
  if (!unique) return null;
  const values = unique.map((f) => fields[f]);
  if (values.some((v) => v === undefined || v === null)) return null;
  const key = JSON.stringify(values);
  // Long values are hashed to stay inside the index row limit; a JSON array never starts with "sha256:".
  return key.length > 512 ? "sha256:" + createHash("sha256").update(key).digest("hex") : key;
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
const notFound = (collection: string, id: string) =>
  new ServiceError("DATA_NOT_FOUND", 404, `集合 ${collection} 中没有 id 为 ${id} 的记录`);
const fieldList = (c: Collection) =>
  (c.fields.length
    ? "已有字段：" + c.fields.map(([name, type]) => `${name}（${label[type]}）`).join("、")
    : "还没有字段") + "；系统字段 id、createdAt、updatedAt 也可使用";
const conflict = () => new ServiceError("DATA_VERSION_CONFLICT", 409, "记录已被修改，请重新读取后再改");
const forbidden = () => new ServiceError("DATA_FORBIDDEN", 403, "当前访问身份不能执行这个操作");
const suspended = () => new ServiceError("DATA_APP_SUSPENDED", 403, "应用已被平台暂停，请联系平台管理员");
const expired = () => new ServiceError("DATA_SIGNIN_EXPIRED", 401, "登录已失效，请重新登录");
/** Who a new record belongs to: the account, the signed-in visitor, or nobody for an anonymous visitor. */
const author = (access: Access): string | null =>
  access.caller.kind === "member" ? access.caller.actor.id : (access.user?.id ?? null);
/** A signed-in visitor changes only records they created; administrators and account callers change any. */
function owns(access: Access, c: Collection, createdBy: string | null): void {
  if (access.level === "user" && !(c.userOwn && createdBy === access.user?.id)) throw forbidden();
}
const reserved = (name: string) =>
  new ServiceError("DATA_FIELD_RESERVED", 400, `${name} 是系统字段，不能写入`);
const tooManyFields = () =>
  new ServiceError("DATA_FIELD_LIMIT", 400, `每个集合最多 ${MAX_FIELDS} 个字段`);
