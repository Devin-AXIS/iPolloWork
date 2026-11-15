import OSS from 'ali-oss';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";
import { Store } from "../src/database.js";
import { migrateAppData } from "../src/app-data.js";
import { readFile } from "node:fs/promises";

type Result<T> = { status: number; data: T; headers: Headers };
type Json = Record<string, any>;

async function fixture(env: NodeJS.ProcessEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ipw-app-data-"));
  const config = await testConfig({ DATA_DIR: dir, SERVICE_ORIGIN: "http://localhost:4785", ...env });
  const service = await createService(config);
  let n = 0;
  const call = async <T = Json>(
    path: string,
    init: { method?: string; token?: string; key?: string; ip?: string; body?: unknown; origin?: string } = {},
  ): Promise<Result<T>> => {
    const response = await service.app.request(config.origin + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        "x-ipollo-peer-ip": init.ip ?? "198.51.100." + (++n % 250),
        ...(init.token ? { Authorization: "Bearer " + init.token } : {}),
        ...(init.key ? { "X-Data-Key": init.key } : {}),
        ...(init.origin ? { Origin: init.origin } : {}),
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const type = response.headers.get("content-type") ?? "";
    return {
      status: response.status,
      headers: response.headers,
      data: (type.includes("json") ? await response.json() : await response.text()) as T,
    };
  };
  const account = async (email: string) => {
    const signup = await call<{ user: { id: string } }>("/api/auth/sign-up/email", {
      body: { email, name: email.split("@")[0], password: "Valid-testing-password-2026" },
    });
    await service.store.run('UPDATE "user" SET "emailVerified"=true WHERE id=?', signup.data.user.id);
    const signed = await call<{ token: string }>("/api/auth/sign-in/email", {
      body: { email, password: "Valid-testing-password-2026" },
    });
    return { id: signup.data.user.id, token: signed.data.token };
  };
  const close = async () => {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  };
  return { service, call, account, close };
}

test("a personal app stores records through JSON statements and syncs changes", async () => {
  const { call, account, close } = await fixture();
  try {
    const owner = await account("owner@data.test");
    const other = await account("other@data.test");
    const created = await call<{ app: Json; created: boolean }>("/api/data/v1/apps", {
      token: owner.token,
      body: { name: "Reading list", kind: "plugin", workspace: "notes" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.app.slug, "reading-list");
    assert.match(created.data.app.publicKey, /^pk_/);
    const again = await call<{ app: Json; created: boolean }>("/api/data/v1/apps", {
      token: owner.token,
      body: { name: "Reading list", kind: "plugin" },
    });
    assert.equal(again.status, 200, "the same slug returns the existing app");
    assert.equal(again.data.app.id, created.data.app.id);
    const chinese = await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "预约", kind: "site" } });
    const chineseAgain = await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "预约", kind: "site" } });
    assert.equal(chineseAgain.data.app.id, chinese.data.app.id, "a name without ASCII letters reopens the same app");
    await call(`/api/data/v1/apps/${chinese.data.app.id}`, { method: "DELETE", token: owner.token });
    const app = created.data.app.id as string;
    const run = <T = Json>(body: unknown, token = owner.token) =>
      call<T>(`/api/data/v1/apps/${app}/run`, { token, body });

    const first = await run({ insert: "books", values: { title: "Dune", pages: 412, read: false } });
    assert.equal(first.status, 200);
    assert.equal(first.data.item.version, 1);
    const many = await run({
      insert: "books",
      values: [
        { title: "Emma", pages: 474, read: true, tags: ["classic"] },
        { title: "Ubik", pages: 202, read: true },
      ],
    });
    assert.equal(many.data.items.length, 2);
    assert.equal((await run({ insert: "books", values: { title: "Solaris", pages: "204" } })).data.code, "DATA_FIELD_TYPE");
    assert.equal((await run({ insert: "books", values: { version: 3 } })).data.code, "DATA_FIELD_RESERVED");

    const read = await run<{ items: Json[]; next: string | null }>({
      find: "books",
      where: { read: true, pages: { ">": 300 } },
    });
    assert.deepEqual(read.data.items.map((b) => b.title), ["Emma"]);
    const page1 = await run<{ items: Json[]; next: string }>({ find: "books", sort: "pages", limit: 2 });
    assert.deepEqual(page1.data.items.map((b) => b.title), ["Ubik", "Dune"]);
    const page2 = await run<{ items: Json[]; next: null }>({ find: "books", sort: "pages", limit: 2, after: page1.data.next });
    assert.deepEqual(page2.data.items.map((b) => b.title), ["Emma"]);
    assert.equal(page2.data.next, null);
    assert.equal((await run({ count: "books", where: { title: { contains: "BIK" } } })).data.count, 1);
    const unknown = await run({ find: "books", where: { colour: "red" } });
    assert.equal(unknown.data.code, "DATA_FIELD_UNKNOWN");
    assert.match(unknown.data.error, /已有字段：title（文本）、pages（数字）、read（是\/否）、tags（JSON）/, "errors name the fields that exist");
    const noCollection = await run({ update: "bookz", id: "x", set: {} });
    assert.equal(noCollection.data.code, "DATA_COLLECTION_NOT_FOUND");
    assert.match(noCollection.data.error, /已有集合：books/);
    assert.match((await run({ get: "books", id: "missing" })).data.error, /集合 books 中没有 id 为 missing 的记录/);
    const profile = await run({ upsert: "settings", id: "profile", values: { goal: "run 5k", weekly: 3 } });
    assert.deepEqual([profile.data.created, profile.data.item.version, profile.data.item.goal], [true, 1, "run 5k"]);
    const replaced = await run({ upsert: "settings", id: "profile", values: { goal: "run 10k" }, version: 1 });
    assert.deepEqual([replaced.data.created, replaced.data.item.version, "weekly" in replaced.data.item], [false, 2, false], "upsert replaces every field");
    assert.equal((await run({ upsert: "settings", id: "profile", values: { goal: "x" }, version: 1 })).data.code, "DATA_VERSION_CONFLICT");
    assert.equal((await run({ get: "settings", id: "profile" })).data.item.goal, "run 10k", "readable ids address records");
    await run({ delete: "settings", id: "profile" });
    assert.equal((await run({ upsert: "settings", id: "profile", values: { goal: "again" } })).data.created, true, "upsert recreates a deleted record");
    assert.equal((await run({ insert: "settings", values: { id: "bad id!", goal: "x" } })).data.code, "DATA_RECORD_ID_INVALID", "ids reject spaces");
    await run({ drop: "settings" });
    assert.deepEqual((await run({ find: "missing" })).data, { items: [], next: null });

    const id = first.data.item.id as string;
    const updated = await run({ update: "books", id, set: { read: true, pages: null }, version: 1 });
    assert.equal(updated.data.item.version, 2);
    assert.equal("pages" in updated.data.item, false, "null removes a field");
    assert.equal((await run({ update: "books", id, set: { read: false }, version: 1 })).data.code, "DATA_VERSION_CONFLICT");

    const sync = await call<{ items: Json[]; next: number; more: boolean; collections: string[] }>(
      `/api/data/v1/apps/${app}/changes?after=0&limit=2`,
      { token: owner.token },
    );
    assert.equal(sync.data.items.length, 2, "a page ends on a commit boundary");
    assert.equal(sync.data.more, true);
    assert.deepEqual(sync.data.collections, ["books"]);
    await run({ delete: "books", id });
    const rest = await call<{ items: Json[]; more: boolean }>(`/api/data/v1/apps/${app}/changes?after=${sync.data.next}`, {
      token: owner.token,
    });
    assert.deepEqual(rest.data.items.at(-1), { collection: "books", id, deleted: true });
    assert.equal(rest.data.more, false);
    assert.equal((await run({ get: "books", id })).status, 404);

    const info = await run<{ app: Json }>({ info: true });
    assert.deepEqual(info.data.app.collectionList[0].fields, { title: "text", pages: "number", read: "boolean", tags: "json" });
    assert.equal(info.data.app.records, 2);

    assert.equal((await run({ find: "books" }, other.token)).status, 404, "other accounts cannot see a personal app");
    assert.equal((await call(`/api/data/v1/apps`, { token: other.token })).data.items.length, 0);
    const listed = await call<{ items: Json[] }>(`/api/data/v1/apps`, { token: owner.token });
    assert.deepEqual(listed.data.items.map((a) => [a.name, a.kind, a.owner.kind, a.workspace, a.public]), [["Reading list", "plugin", "user", "notes", false]]);
  } finally {
    await close();
  }
});

test("a public key reads and creates only where a collection opts in, within the rate limit", async () => {
  const { service, call, account, close } = await fixture({ APP_DATA_ANONYMOUS_PER_MINUTE: "5", APP_DATA_ANONYMOUS_CREATES_PER_MINUTE: "3" });
  try {
    const owner = await account("site@data.test");
    const app = (await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "Studio site", kind: "site" } })).data.app;
    const run = (body: unknown, init: { token?: string; key?: string; ip?: string } = { token: owner.token }) =>
      call(`/api/data/v1/apps/${app.id}/run`, { ...init, body });
    assert.equal(
      (await run({
        batch: [
          { define: "bookings", fields: { name: "text", date: "text", slot: "number" }, public: ["create"], unique: ["date", "slot"] },
          { define: "menu", public: ["read"] },
          { insert: "menu", values: { dish: "Tea", price: 12 } },
        ],
      })).status,
      200,
    );
    const visitor = { key: app.publicKey as string, ip: "203.0.113.9" };
    const booked = await run({ insert: "bookings", values: { name: "Ann", date: "2026-12-01", slot: 10 } }, visitor);
    assert.equal(booked.status, 200);
    assert.equal(booked.headers.get("access-control-allow-origin"), "*");
    assert.equal((await run({ insert: "bookings", values: { name: "Bo", date: "2026-12-01", slot: 10 } }, visitor)).data.code, "DATA_DUPLICATE");
    assert.equal((await run({ find: "bookings" }, visitor)).status, 403, "bookings are not publicly readable");
    assert.equal((await run({ find: "menu" }, visitor)).data.items[0].dish, "Tea");
    assert.equal((await run({ insert: "menu", values: { dish: "Cake" } }, { key: visitor.key, ip: "203.0.113.10" })).status, 403);
    assert.equal(
      (await run({ insert: "bookings", values: { name: "Cy", note: "hi" } }, { key: visitor.key, ip: "203.0.113.11" })).data.code,
      "DATA_FIELD_UNKNOWN",
      "visitors cannot add fields",
    );
    for (let i = 0; i < 3; i++) assert.equal((await run({ find: "menu" }, visitor)).status, 200);
    assert.equal((await run({ find: "menu" }, visitor)).status, 429, "the sixth read in a minute is limited");
    assert.equal((await run({ insert: "bookings", values: { name: "Di", date: "2026-12-02", slot: 9 } }, visitor)).status, 200, "creates have their own limit");
    assert.equal((await run({ insert: "bookings", values: { name: "Ed", date: "2026-12-03", slot: 9 } }, visitor)).status, 429, "the fourth create in a minute is limited");
    const chosen = await run({ insert: "bookings", values: { id: "settings", name: "Fy" } }, { key: visitor.key, ip: "203.0.113.15" });
    assert.deepEqual([chosen.status, chosen.data.code], [403, "DATA_FORBIDDEN"], "visitors cannot choose record ids");
    assert.equal((await run({ find: "menu" }, { key: "pk_wrong", ip: "203.0.113.12" })).status, 404);
    assert.equal((await run({ info: true }, { key: visitor.key, ip: "203.0.113.13" })).status, 403);
    const preflight = await call(`/api/data/v1/apps/${app.id}/run`, { method: "OPTIONS", origin: "https://studio.example" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    const owned = await run({ find: "bookings" });
    assert.deepEqual(owned.data.items.map((b: Json) => b.name).sort(), ["Ann", "Di"], "the owner reads every booking");
    const rotated = await call<{ app: Json }>(`/api/data/v1/apps/${app.id}`, { method: "PATCH", token: owner.token, body: { rotateKey: true } });
    assert.notEqual(rotated.data.app.publicKey, app.publicKey);
    assert.equal((await run({ find: "menu" }, { key: visitor.key, ip: "203.0.113.14" })).status, 404, "a rotated key stops working");
    const current = { key: rotated.data.app.publicKey as string, ip: "203.0.113.16" };
    assert.equal((await run({ find: "menu" }, current)).status, 200);
    await service.store.run('UPDATE "user" SET banned=true WHERE id=?', owner.id);
    assert.equal((await run({ find: "menu" }, current)).status, 404, "a banned owner's public key stops working");
  } finally {
    await close();
  }
});

test("organization apps follow membership, quotas roll back and deletions purge records", async () => {
  const { service, call, account, close } = await fixture({ APP_DATA_MAX_RECORDS_PER_APP: "5" });
  try {
    const owner = await account("boss@data.test");
    const member = await account("staff@data.test");
    const outsider = await account("outsider@data.test");
    const enterprise = (await call<{ id: string }>("/api/v1/enterprises", { token: owner.token, origin: "http://localhost:4785", body: { name: "Acme" } })).data.id;
    await service.store.run("INSERT INTO members VALUES(?,?,?,?,?)", enterprise, member.id, "member", null, Date.now());
    const app = (await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "Team tasks", kind: "plugin", enterpriseId: enterprise } })).data.app;
    assert.equal((await call("/api/data/v1/apps", { token: outsider.token, body: { name: "x", kind: "plugin", enterpriseId: enterprise } })).status, 403);
    const run = (body: unknown, token: string) => call<Json>(`/api/data/v1/apps/${app.id}/run`, { token, body });

    assert.equal((await run({ insert: "tasks", values: { title: "Plan" } }, member.token)).status, 200);
    const listed = await call<{ items: Json[]; organizations: Json[] }>("/api/data/v1/apps", { token: member.token });
    assert.deepEqual(listed.data.items.map((a) => [a.owner.kind, a.owner.name, a.canManage]), [["enterprise", "Acme", false]]);
    assert.deepEqual(listed.data.organizations, [{ id: enterprise, name: "Acme" }]);
    assert.equal((await run({ define: "tasks", public: ["read"] }, member.token)).data.code, "DATA_FORBIDDEN");
    assert.equal((await call(`/api/data/v1/apps/${app.id}`, { method: "DELETE", token: member.token })).status, 403);
    assert.equal((await run({ find: "tasks" }, outsider.token)).status, 404);

    const tooMany = await run({ insert: "tasks", values: Array.from({ length: 5 }, (_, i) => ({ title: "T" + i })) }, member.token);
    assert.equal(tooMany.data.code, "DATA_QUOTA_EXCEEDED");
    assert.equal((await run({ count: "tasks" }, member.token)).data.count, 1, "a rejected statement writes nothing");
    const batch = await run({ batch: [{ insert: "tasks", values: { title: "Kept?" } }, { update: "tasks", id: randomUUID(), set: { title: "x" } }] }, member.token);
    assert.equal(batch.data.code, "DATA_NOT_FOUND");
    assert.equal((await run({ count: "tasks" }, member.token)).data.count, 1, "a failed batch rolls back");

    await run({ insert: "notes", values: { text: "old" } }, owner.token);
    assert.deepEqual((await run({ drop: "notes" }, owner.token)).data, { dropped: true });
    assert.equal((await run({ count: "notes" }, owner.token)).data.count, 0);
    await run({ insert: "notes", values: { text: "new" } }, owner.token);
    await service.appData!.settled();
    assert.deepEqual((await run({ find: "notes" }, owner.token)).data.items.map((n: Json) => n.text), ["new"]);

    assert.equal((await call(`/api/data/v1/apps/${app.id}`, { method: "DELETE", token: owner.token })).status, 200);
    assert.equal((await run({ find: "tasks" }, member.token)).status, 404);
    await service.appData!.settled();
    assert.equal((await service.appData!.data.one("SELECT COUNT(*) AS n FROM data_records WHERE app_id=?", app.id))?.n, 0);
    assert.equal((await service.appData!.data.one("SELECT COUNT(*) AS n FROM data_apps WHERE id=?", app.id))?.n, 0);
  } finally {
    await close();
  }
});

test("app data reports a missing database instead of falling back to the account database", async () => {
  const { call, account, close } = await fixture({ APP_DATA_DATABASE_URL: "" });
  try {
    const owner = await account("nodb@data.test");
    const response = await call("/api/data/v1/apps", { token: owner.token });
    assert.equal(response.status, 503);
    assert.equal(response.data.code, "APP_DATA_NOT_CONFIGURED");
  } finally {
    await close();
  }
});

test("refused input answers 400, storage stays bounded and a stale sync cursor is told to reload", async () => {
  const { service, call, account, close } = await fixture({ APP_DATA_MAX_BYTES_PER_OWNER: "2048", APP_DATA_OWNER_CONCURRENCY: "1" });
  try {
    const owner = await account("limits@data.test");
    const create = async (name: string) =>
      (await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name, kind: "plugin" } })).data.app.id as string;
    const app = await create("Limits");
    const run = (body: unknown, id = app) => call(`/api/data/v1/apps/${id}/run`, { token: owner.token, body });
    const changes = (after: number, limit = 500) =>
      call(`/api/data/v1/apps/${app}/changes?after=${after}&limit=${limit}`, { token: owner.token });
    let deep: unknown = 1;
    for (let i = 0; i < 20; i++) deep = [deep];
    for (const values of [{ text: "a\u0000b" }, { text: "\ud800" }, { deep }])
      assert.deepEqual(
        [(await run({ insert: "notes", values })).status, (await run({ insert: "notes", values })).data.code],
        [400, "DATA_VALUE_INVALID"],
      );
    assert.equal((await run({ insert: "notes", values: { id: "a", text: "one" } })).status, 200);
    assert.equal((await run({ find: "notes", sort: "constructor" })).data.code, "DATA_FIELD_UNKNOWN");
    const forged = Buffer.from(JSON.stringify(["abc", "x"])).toString("base64url");
    assert.equal((await run({ find: "notes", after: forged })).data.code, "DATA_CURSOR_INVALID");
    assert.equal((await run({ find: "notes", where: { createdAt: { ">": 1.5 } } })).data.code, "DATA_FILTER_TYPE");
    assert.equal((await run({ insert: "notes", values: { id: "b", text: "Green tea", cups: 12 } })).status, 200);
    assert.deepEqual((await run({ find: "notes", search: "TEA" })).data.items.map((n: Json) => n.id), ["b"], "search ignores letter case");
    assert.equal((await run({ count: "notes", search: "12" })).data.count, 1, "search reads number fields as text");
    assert.equal((await run({ count: "notes", search: "nothing" })).data.count, 0);
    assert.equal((await run({ delete: "notes", id: "b" })).status, 200);
    const paged = await run({ find: "notes", limit: 1 });
    assert.equal(paged.data.next, null, "the default listing pages by created time and id");

    const parallel = await Promise.all([1, 2, 3, 4, 5].map((n) => run({ insert: "notes", values: { text: "p" + n } })));
    assert.deepEqual(parallel.map((r) => r.status), [200, 200, 200, 200, 200], "statements beyond the owner's slots wait");
    const second = await run({ find: "notes", limit: 4, after: (await run({ find: "notes", limit: 4 })).data.next });
    assert.equal(second.data.items.length, 2, "the cursor continues the default listing");

    const stale = (await changes(0)).data.next as number;
    assert.equal((await run({ batch: [{ insert: "notes", values: { text: "x" } }, { insert: "notes", values: { text: "y" } }] })).status, 200);
    assert.equal((await changes(stale, 1)).data.items.length, 2, "a batch is one commit in the change feed");

    assert.equal((await run({ delete: "notes", id: "a" })).status, 200);
    const again = await run({ insert: "notes", values: { id: "a", text: "two" } });
    assert.deepEqual([again.status, again.data.item?.version], [200, 1], "a deleted id can be used again");
    assert.equal((await run({ delete: "notes", id: "a" })).status, 200);
    await service.appData!.data.run("UPDATE data_records SET deleted_at=1 WHERE deleted_at IS NOT NULL");
    await run({ define: "scratch" });
    await run({ drop: "scratch" });
    await service.appData!.settled();
    assert.equal(
      Number((await service.appData!.data.one("SELECT COUNT(*) AS n FROM data_records WHERE deleted_at IS NOT NULL"))?.n),
      0,
      "expired tombstones are removed",
    );
    assert.equal((await changes(stale)).data.reset, true, "a cursor older than removed deletions must reload");
    assert.equal((await changes(0)).data.reset, false);

    const other = await create("Second");
    assert.equal((await run({ insert: "blobs", values: { text: "z".repeat(1200) } }, other)).status, 200);
    const over = await run({ insert: "blobs", values: { text: "z".repeat(1200) } }, other);
    assert.deepEqual([over.status, over.data.code], [413, "DATA_QUOTA_EXCEEDED"], "all of an owner's apps share one byte limit");
    assert.equal((await run({ count: "blobs" }, other)).data.count, 1, "the refused write left nothing");
  } finally {
    await close();
  }
});

test("apps summarize, narrow and count records without reading them all, and keep declared fields clean", async () => {
  const { call, account, close } = await fixture();
  try {
    const owner = await account("shape@data.test");
    const app = (await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "Gym", kind: "plugin" } })).data.app;
    const run = (body: unknown, init: { token?: string; key?: string } = { token: owner.token }) =>
      call(`/api/data/v1/apps/${app.id}/run`, { ...init, body });
    assert.equal(
      (await run({
        insert: "sets",
        values: [
          { day: "2026-11-14", lift: "squat", reps: 5, kg: 100, note: "x".repeat(200) },
          { day: "2026-11-14", lift: "bench", reps: 8, kg: 62.5 },
          { day: "2026-11-15", lift: "squat", reps: 3, kg: 110 },
          { lift: "plank" },
        ],
      })).status,
      200,
    );
    const whole = await run({ aggregate: "sets", sum: ["reps"], avg: ["kg"], max: ["kg", "day"] });
    assert.deepEqual(whole.data.items, [{ count: 4, sum: { reps: 16 }, avg: { kg: 90.83333333333333 }, max: { kg: 110, day: "2026-11-15" } }]);
    const daily = await run({ aggregate: "sets", group: "day", sum: ["reps"] });
    assert.deepEqual(daily.data, {
      items: [
        { key: "2026-11-14", count: 2, sum: { reps: 13 } },
        { key: "2026-11-15", count: 1, sum: { reps: 3 } },
        { key: null, count: 1, sum: { reps: null } },
      ],
      more: false,
    });
    const top = await run({ aggregate: "sets", group: "lift", where: { reps: { ">": 0 } }, sort: "-count", limit: 1 });
    assert.deepEqual(top.data, { items: [{ key: "squat", count: 2 }], more: true });
    assert.equal((await run({ aggregate: "sets", sum: ["lift"] })).data.code, "DATA_AGGREGATE_UNSUPPORTED");
    assert.deepEqual((await run({ aggregate: "nothing", group: "day" })).data, { items: [] });

    const wide = await run({ find: "sets", limit: 500 });
    assert.deepEqual([wide.status, wide.data.items.length, wide.data.next], [200, 4, null], "a page larger than the maximum is cut, not refused");
    const narrow = await run({ find: "sets", fields: ["lift", "reps"], sort: "kg", limit: 2 });
    assert.deepEqual(
      narrow.data.items.map((item: Json) => Object.keys(item).sort()),
      [["createdAt", "id", "lift", "reps", "updatedAt", "version"], ["createdAt", "id", "lift", "reps", "updatedAt", "version"]],
      "only the chosen fields and the system fields return",
    );
    assert.deepEqual(narrow.data.items.map((item: Json) => item.lift), ["bench", "squat"]);
    const rest = await run({ find: "sets", fields: ["lift"], sort: "kg", limit: 2, after: narrow.data.next });
    assert.deepEqual(rest.data.items.map((item: Json) => item.lift), ["squat", "plank"], "the cursor works without returning the sort field");
    const one = await run({ get: "sets", id: narrow.data.items[0].id, fields: ["kg"] });
    assert.deepEqual([one.data.item.kg, one.data.item.lift], [62.5, undefined]);
    assert.equal((await run({ find: "sets", fields: ["nope"] })).data.code, "DATA_FIELD_UNKNOWN");

    const id = narrow.data.items[0].id as string;
    const bumped = await Promise.all([1, 2, 3, 4].map(() => run({ update: "sets", id, inc: { reps: 1, done: 1 } })));
    assert.deepEqual(bumped.map((r) => r.status), [200, 200, 200, 200]);
    const after = (await run({ get: "sets", id })).data.item;
    assert.deepEqual([after.reps, after.done], [12, 4], "concurrent increments all count");
    assert.equal((await run({ update: "sets", id, inc: { lift: 1 } })).data.code, "DATA_FIELD_TYPE");
    assert.equal((await run({ update: "sets", id })).status, 400, "an update needs set or inc");

    assert.equal((await run({ insert: "sets", values: { lift: "row", rpes: 7 } })).status, 200, "a misspelled field is accepted until the table is strict");
    const cleaned = await run({ define: "sets", strict: true, remove: ["rpes", "note"] });
    assert.deepEqual([cleaned.data.collection.strict, "rpes" in cleaned.data.collection.fields, "note" in cleaned.data.collection.fields], [true, false, false]);
    assert.equal((await run({ count: "sets", where: { lift: "row" } })).data.count, 1, "records stay, without the removed field");
    assert.equal((await run({ find: "sets", fields: ["note"] })).data.code, "DATA_FIELD_UNKNOWN");
    const typo = await run({ insert: "sets", values: { lift: "row", rpes: 7 } });
    assert.deepEqual([typo.status, typo.data.code], [400, "DATA_FIELD_UNKNOWN"]);
    assert.match(typo.data.error, /define/, "the rejection says how to add a field");
    assert.equal((await run({ batch: [{ define: "sets", fields: { rpe: "number" } }, { insert: "sets", values: { lift: "row", rpe: 7 } }] })).status, 200);
    assert.equal((await run({ define: "sets", unique: null, remove: ["nope"] })).data.code, "DATA_FIELD_UNKNOWN");

    await run({ define: "sets", public: ["read"] });
    const visitor = await run({ aggregate: "sets", group: "lift" }, { key: app.publicKey });
    assert.equal(visitor.status, 200, "a publicly readable table can be summarized with the public key");
  } finally {
    await close();
  }
});

test("visitors sign in with their iPollo account, keep their own records, and app administrators manage every record", async () => {
  const { service, call, account, close } = await fixture();
  const home = "http://localhost:4785";
  try {
    const owner = await account("owner@club.test");
    const ann = await account("ann@club.test");
    const bo = await account("bo@club.test");
    const app = (await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "Club", kind: "site" } })).data.app;
    const path = `/api/data/v1/apps/${app.id}/run`;
    const run = (body: unknown) => call(path, { token: owner.token, body });
    assert.equal(
      (await run({
        batch: [
          { define: "posts", fields: { title: "text" }, users: ["read", "create", "own"] },
          { define: "profiles", fields: { bio: "text" }, users: ["create", "own"] },
          { define: "staff_notes", fields: { note: "text" } },
        ],
      })).status,
      200,
    );
    assert.match((await run({ info: true })).data.app.signin, new RegExp(`^${home}/connect\\?app=${app.id}&key=pk_`));
    const enter = async (who: { token: string }, back = "http://localhost:3000/club?tab=1") => {
      const body = { app: app.id, key: app.publicKey, return: back };
      const shown = await call(`/api/v1/data-signin?app=${app.id}&key=${app.publicKey}&return=${encodeURIComponent(back)}`, { token: who.token });
      assert.deepEqual(shown.data, { name: "Club", origin: new URL(back).origin }, "the consent step issues nothing");
      const done = await call("/api/v1/data-signin", { token: who.token, origin: home, body });
      return new URL(done.data.url as string).hash.replace("#ipollo_token=", "");
    };
    const refused = await call("/api/v1/data-signin", { token: ann.token, origin: home, body: { app: app.id, key: app.publicKey, return: "https://elsewhere.example/" } });
    assert.deepEqual([refused.status, refused.data.code], [403, "DATA_ORIGIN_NOT_ALLOWED"]);
    assert.deepEqual((await run({ origins: ["https://club.example/any/path"] })).data, { origins: ["https://club.example"] });
    assert.match(await enter(ann, "https://club.example/welcome"), /^ipd_/);

    const as = (token: string) => (body: unknown) => call(path, { key: app.publicKey, token, body });
    const annDoes = as(await enter(ann));
    const boDoes = as(await enter(bo));
    const guest = (body: unknown) => call(path, { key: app.publicKey, body });
    assert.deepEqual((await annDoes({ me: true })).data, { user: { id: ann.id, name: "ann", role: "user" } });
    assert.deepEqual((await guest({ me: true })).data, { user: null });

    const post = (await annDoes({ insert: "posts", values: { title: "Hello" } })).data.item;
    const profile = (await annDoes({ insert: "profiles", values: { bio: "Runner" } })).data.item;
    await boDoes({ insert: "profiles", values: { bio: "Climber" } });
    assert.deepEqual((await annDoes({ find: "profiles" })).data.items.map((p: Json) => p.bio), ["Runner"], "own-only tables show each visitor their records");
    assert.deepEqual((await annDoes({ aggregate: "profiles" })).data.items, [{ count: 1 }]);
    assert.equal((await boDoes({ get: "profiles", id: profile.id })).status, 404);
    assert.equal((await boDoes({ find: "posts" })).data.items.length, 1, "signed-in visitors read the shared table");
    assert.equal((await guest({ find: "posts" })).status, 403, "the table is not public");
    assert.equal((await boDoes({ update: "posts", id: post.id, set: { title: "Mine now" } })).status, 403);
    assert.equal((await boDoes({ delete: "posts", id: post.id })).status, 403);
    assert.equal((await annDoes({ update: "posts", id: post.id, set: { title: "Hello again" } })).data.item.title, "Hello again");
    assert.equal((await annDoes({ find: "staff_notes" })).status, 403);
    assert.equal((await annDoes({ insert: "staff_notes", values: { note: "x" } })).status, 403);
    assert.equal((await annDoes({ insert: "posts", values: { title: "t", extra: 1 } })).data.code, "DATA_FIELD_UNKNOWN");
    assert.equal((await annDoes({ insert: "posts", values: { id: "fixed", title: "t" } })).status, 403);
    assert.equal((await annDoes({ upsert: "posts", id: "fixed", values: { title: "t" } })).status, 403);
    assert.equal((await annDoes({ define: "posts", users: [] })).status, 403);
    assert.equal((await annDoes({ grant: "admin", email: "ann@club.test" })).status, 403);

    const granted = await run({ grant: "admin", email: "BO@club.test" });
    assert.deepEqual(granted.data.roles, [{ id: bo.id, name: "bo", email: "bo@club.test", role: "admin" }]);
    assert.equal((await boDoes({ me: true })).data.user.role, "admin");
    assert.equal((await boDoes({ update: "posts", id: post.id, set: { title: "Edited by staff" } })).status, 200);
    assert.equal((await boDoes({ insert: "staff_notes", values: { note: "seen" } })).status, 200);
    assert.equal((await boDoes({ find: "profiles" })).data.items.length, 2, "an administrator reads every record");
    assert.equal((await boDoes({ define: "posts", users: [] })).status, 403, "administrators change records, not tables");
    assert.equal((await boDoes({ info: true })).status, 403);
    assert.equal((await run({ grant: "vip", email: "bo@club.test" })).data.roles[0].role, "vip");
    assert.equal((await boDoes({ me: true })).data.user.role, "vip");
    assert.equal((await boDoes({ find: "staff_notes" })).status, 403, "other roles are labels for the page's own logic");
    assert.deepEqual((await run({ revoke: "bo@club.test" })).data.roles, []);
    assert.equal((await run({ grant: "admin", email: "nobody@club.test" })).data.code, "DATA_USER_NOT_FOUND");
    assert.equal((await as(await enter(owner))({ me: true })).data.user.role, "admin", "the owner administers the app without a grant");

    const tryAs = async (role: string) => as((await run({ preview: role })).data.token as string);
    assert.equal((await (await tryAs("admin"))({ me: true })).data.user.role, "admin");
    const plain = await tryAs("user");
    assert.equal((await plain({ me: true })).data.user.role, "user", "a manager can try the page as an ordinary visitor");
    assert.equal((await plain({ find: "staff_notes" })).status, 403);
    assert.equal((await annDoes({ preview: "admin" })).status, 403);

    const annToken = await enter(ann);
    assert.equal((await as(annToken.slice(0, -2) + "xx")({ me: true })).data.code, "DATA_SIGNIN_EXPIRED");
    const other = (await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "Other", kind: "site" } })).data.app;
    assert.equal((await call(`/api/data/v1/apps/${other.id}/run`, { key: other.publicKey, token: annToken, body: { me: true } })).status, 401, "a sign-in is valid for one app");

    await service.store.run('UPDATE "user" SET role=? WHERE id=?', "admin", bo.id);
    assert.equal((await call("/api/v1/admin/data-apps", { token: ann.token })).status, 403);
    const listed = await call("/api/v1/admin/data-apps?q=owner%40club", { token: bo.token });
    assert.deepEqual(listed.data.items.map((item: Json) => [item.name, item.owner.name, item.suspended]).sort(), [["Club", "owner · owner@club.test", false], ["Other", "owner · owner@club.test", false]]);
    assert.equal(listed.data.totals.apps, 2);
    assert.ok(listed.data.totals.stored > 0);
    assert.equal((await call("/api/v1/admin/data-apps?q=zzz", { token: bo.token })).data.items.length, 0);
    assert.equal((await call(`/api/v1/admin/data-apps/${app.id}/suspend`, { token: bo.token, origin: home, body: { suspended: true } })).status, 200);
    assert.deepEqual([(await run({ count: "posts" })).data.code, (await annDoes({ find: "posts" })).data.code], ["DATA_APP_SUSPENDED", "DATA_APP_SUSPENDED"]);
    assert.equal((await call<{ items: Json[] }>("/api/data/v1/apps", { token: owner.token })).data.items.find((item) => item.id === app.id)?.suspended, true);
    await call(`/api/v1/admin/data-apps/${app.id}/suspend`, { token: bo.token, origin: home, body: { suspended: false } });
    assert.equal((await annDoes({ find: "posts" })).status, 200);

    const rotated = await call<{ app: Json }>(`/api/data/v1/apps/${app.id}`, { method: "PATCH", token: owner.token, body: { rotateKey: true } });
    assert.equal((await call(path, { key: rotated.data.app.publicKey, token: annToken, body: { me: true } })).status, 401, "replacing the key signs every visitor out");
    assert.equal((await call(`/api/v1/admin/data-apps/${app.id}`, { method: "DELETE", token: bo.token, origin: home })).status, 200);
    assert.equal((await run({ count: "posts" })).status, 404);
  } finally {
    await close();
  }
});

test("upgrading app data from schema 1 classifies public apps as sites and reaches schema 6", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://127.0.0.1:5432/ipollowork_test";
  const schema = "test_" + randomUUID().replace(/-/g, "");
  const admin = new Store({ databaseUrl, databasePoolSize: 1, databaseSchema: "public" });
  await admin.run(`CREATE SCHEMA ${schema}`);
  const store = new Store({ databaseUrl, databasePoolSize: 2, databaseSchema: schema });
  try {
    await store.run(await readFile(new URL("../src/app-data-schema.sql", import.meta.url), "utf8"));
    await store.run("CREATE TABLE app_data_schema(version BIGINT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    await store.run("INSERT INTO app_data_schema(version) VALUES(1)");
    for (const [id, open] of [[randomUUID(), true], [randomUUID(), false]] as const) {
      await store.run("INSERT INTO data_apps(id,owner_kind,owner_id,slug,name,public_key,created_by,created_at,updated_at) VALUES(?,'user','u',?,?,?,'u',1,1)", id, id, id, "pk_" + id);
      await store.run("INSERT INTO data_collections(id,app_id,name,public_create,created_at) VALUES(?,?,'c',?,1)", randomUUID(), id, open);
    }
    await migrateAppData(store);
    assert.deepEqual((await store.all("SELECT kind FROM data_apps ORDER BY kind")).map((r) => r.kind), ["plugin", "site"]);
    assert.equal((await store.one("SELECT MAX(version) AS v FROM app_data_schema"))?.v, 6);
    assert.equal((await store.one("SELECT suspended_at,origins FROM data_apps LIMIT 1"))?.origins, "[]");
    assert.equal((await store.one("SELECT strict FROM data_collections LIMIT 1"))?.strict, false);
    assert.equal((await store.one("SELECT pruned_seq FROM data_apps LIMIT 1"))?.pruned_seq, 0);
    assert.equal((await store.all("SELECT bucket FROM data_rate")).length, 0, "the rate key is a named bucket");
  } finally {
    await store.close();
    await admin.run(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  }
});


test("records reject inline binary content but preserve normal URLs and text",async()=>{
 const {call,account,close}=await fixture();
 try{
  const owner=await account('binary@data.test');
  const app=await call('/api/data/v1/apps',{token:owner.token,body:{name:'Media',kind:'site'}});
  const path='/api/data/v1/apps/'+app.data.app.id+'/run';
  for(const content of ['data:image/png;base64,AAAA','data:application/pdf;base64,AAAA','blob:https://example.test/file','iVBORw0KGgo'+'A'.repeat(64),{type:'Buffer',data:[1,2,3]}]){
   const result=await call(path,{token:owner.token,body:{insert:'pictures',values:{content}}});
   assert.equal(result.status,400);assert.equal(result.data.code,'DATA_BINARY_INLINE');
  }
  const result=await call(path,{token:owner.token,body:{insert:'pictures',values:{url:'https://bucket.oss-cn-hangzhou.aliyuncs.com/photo.png',text:'Normal metadata:value, text'}}});
  assert.equal(result.status,200);
 }finally{await close();}
});

test("app attachments use object storage, scope readers and retain no file bytes in PostgreSQL",async()=>{
 const {service,call,account,close}=await fixture();
 try{
  const owner=await account('files@data.test');const other=await account('other-files@data.test');
  const created=await call('/api/data/v1/apps',{token:owner.token,body:{name:'Files',kind:'site'}});
  const id=created.data.app.id;const prefix='/api/data/v1/apps/'+id;
  const payload=Buffer.from('file payload only in object storage');
  const uploaded=await service.app.request('http://localhost:4785'+prefix+'/files',{method:'POST',headers:{Authorization:'Bearer '+owner.token,'Content-Type':'image/png','Content-Length':String(payload.length),'X-Data-File':JSON.stringify({name:'photo.png'})},body:payload});
  assert.equal(uploaded.status,201);const file=await uploaded.json();
  const stored=await service.store.one('SELECT * FROM app_data_files WHERE id=?',file.id);
  assert(stored);assert(!JSON.stringify(stored).includes(payload.toString()));assert(String(stored.storage_key).startsWith('local/'));
  const downloaded=await service.app.request('http://localhost:4785'+prefix+'/files/'+file.id,{headers:{Authorization:'Bearer '+owner.token}});
  assert.equal(downloaded.status,200);assert.equal(await downloaded.text(),payload.toString());
  assert.equal((await call(prefix+'/files/'+file.id,{token:other.token})).status,404);
  const unknown=await call(prefix+'/files/'+file.id,{key:created.data.app.publicKey});assert.equal(unknown.status,403);
  const removed=await call(prefix+'/files/'+file.id,{token:owner.token,method:'DELETE'});assert.equal(removed.status,200);
  assert.equal((await call(prefix+'/files/'+file.id,{token:owner.token})).status,404);
  const response=await service.app.request('http://localhost:4785'+prefix+'/files',{method:'POST',headers:{Authorization:'Bearer '+owner.token,'Content-Type':'image/png','Content-Length':String(payload.length),'X-Data-File':JSON.stringify({name:'another.png'})},body:payload});
  const orphan=await response.json();assert.equal(response.status,201);
  await call(prefix,{token:owner.token,method:'DELETE'});await service.appFiles!.cleanup();
  assert.equal(await service.store.one('SELECT id FROM app_data_files WHERE id=?',orphan.id),undefined);

 }finally{await close();}
});


test("configured app attachments stream to private OSS and retain only metadata",async t=>{
 const {service,call,account,close}=await fixture();
 const writes:{key:string;bytes:number;acl:unknown}[]=[];
 t.mock.method(OSS.prototype,'put',async function(key:string,source:AsyncIterable<Uint8Array>,options:{headers:Record<string,string>}) {
   let size=0;for await(const chunk of source)size+=chunk.byteLength;
   writes.push({key,bytes:size,acl:options.headers['x-oss-object-acl']});return {name:key,res:{status:200}};
 });
 try{
  await service.settings.set('oss',{region:'oss-cn-hangzhou',bucket:'fixture-bucket',accessKeyId:'fixture-id',accessKeySecret:'fixture-secret'});
  const owner=await account('oss-files@data.test');
  const app=await call('/api/data/v1/apps',{token:owner.token,body:{name:'OSS files',kind:'site'}});
  const response=await service.app.request('http://localhost:4785/api/data/v1/apps/'+app.data.app.id+'/files',{method:'POST',headers:{Authorization:'Bearer '+owner.token,'Content-Type':'image/png','Content-Length':'3','X-Data-File':encodeURIComponent(JSON.stringify({name:'图片.png'}))},body:new Uint8Array([1,2,3])});
  assert.equal(response.status,201);const file=await response.json();
  assert.equal(writes.length,1);assert.equal(writes[0].acl,'private');assert.equal(writes[0].bytes,3);
  const row=await service.store.one('SELECT storage_key FROM app_data_files WHERE id=?',file.id);assert(String(row?.storage_key).startsWith('oss/'));
  const download=await call('/api/data/v1/apps/'+app.data.app.id+'/files/'+file.id,{token:owner.token});
  assert.equal(download.status,200);assert(new URL(download.data.url).hostname==='fixture-bucket.oss-cn-hangzhou.aliyuncs.com');
 }finally{await close();}
});
