import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";

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
      body: { name: "Reading list", workspace: "notes" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.app.slug, "reading-list");
    assert.match(created.data.app.publicKey, /^pk_/);
    const again = await call<{ app: Json; created: boolean }>("/api/data/v1/apps", {
      token: owner.token,
      body: { name: "Reading list" },
    });
    assert.equal(again.status, 200, "the same slug returns the existing app");
    assert.equal(again.data.app.id, created.data.app.id);
    const chinese = await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "预约" } });
    const chineseAgain = await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "预约" } });
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
    assert.equal((await run({ find: "books", where: { colour: "red" } })).data.code, "DATA_FIELD_UNKNOWN");
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
    assert.deepEqual(listed.data.items.map((a) => [a.name, a.owner.kind, a.workspace, a.public]), [["Reading list", "user", "notes", false]]);
  } finally {
    await close();
  }
});

test("a public key reads and creates only where a collection opts in, within the rate limit", async () => {
  const { call, account, close } = await fixture({ APP_DATA_ANONYMOUS_PER_MINUTE: "5" });
  try {
    const owner = await account("site@data.test");
    const app = (await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "Studio site" } })).data.app;
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
    assert.equal((await run({ find: "menu" }, visitor)).status, 200);
    assert.equal((await run({ find: "menu" }, visitor)).status, 429, "the sixth call in a minute is limited");
    assert.equal((await run({ find: "menu" }, { key: "pk_wrong", ip: "203.0.113.12" })).status, 404);
    assert.equal((await run({ info: true }, { key: visitor.key, ip: "203.0.113.13" })).status, 403);
    const preflight = await call(`/api/data/v1/apps/${app.id}/run`, { method: "OPTIONS", origin: "https://studio.example" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    const owned = await run({ find: "bookings" });
    assert.deepEqual(owned.data.items.map((b: Json) => b.name), ["Ann"], "the owner reads every booking");
    const rotated = await call<{ app: Json }>(`/api/data/v1/apps/${app.id}`, { method: "PATCH", token: owner.token, body: { rotateKey: true } });
    assert.notEqual(rotated.data.app.publicKey, app.publicKey);
    assert.equal((await run({ find: "menu" }, { key: visitor.key, ip: "203.0.113.14" })).status, 404, "a rotated key stops working");
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
    const app = (await call<{ app: Json }>("/api/data/v1/apps", { token: owner.token, body: { name: "Team tasks", enterpriseId: enterprise } })).data.app;
    assert.equal((await call("/api/data/v1/apps", { token: outsider.token, body: { name: "x", enterpriseId: enterprise } })).status, 403);
    const run = (body: unknown, token: string) => call<Json>(`/api/data/v1/apps/${app.id}/run`, { token, body });

    assert.equal((await run({ insert: "tasks", values: { title: "Plan" } }, member.token)).status, 200);
    const listed = await call<{ items: Json[] }>("/api/data/v1/apps", { token: member.token });
    assert.deepEqual(listed.data.items.map((a) => [a.owner.kind, a.owner.name, a.canManage]), [["enterprise", "Acme", false]]);
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
