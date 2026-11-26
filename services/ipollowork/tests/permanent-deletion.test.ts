import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createService } from "../src/app.js";
import { deleteOssObject } from "../src/oss-client.js";
import { testConfig } from "./database.js";

test("permanent project deletion revokes access, preserves shared objects and resumes on restart", async t => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-project-deletion-"));
  const publicationOrigin = "http://127.0.0.1:62001";
  const config = await testConfig({ DATA_DIR: dir, STORAGE_CLEANUP_INTERVAL_MS: "1000", PUBLICATION_ORIGIN: publicationOrigin });
  let service = await createService(config);
  try {
    const owner = await service.auth.api.signUpEmail({ body: { name: "Owner", email: "owner@example.test", password: "Deletion-test-password-2026" } });
    assert(owner.token);
    const authorization = "Bearer " + owner.token;
    const project = randomUUID(), other = randomUUID(), moved = randomUUID();
    for (const id of [project, other, moved])
      await service.store.run("INSERT INTO projects(id,owner_id,title,created_at) VALUES(?,?,?,?)", id, owner.user.id, id, Date.now());
    const endpoint = "/api/v1/projects/" + project;
    const local = join(dir, "local-workspace-file.txt");
    await writeFile(local, "workspace content");
    const request = (path: string, init: RequestInit = {}) => service.app.request(path, {
      ...init, headers: { authorization, ...init.headers },
    });
    const upload = async (path: string) => {
      const body = "artifact";
      const response = await request(endpoint + "/artifacts/upload", {
        method: "POST", body,
        headers: { "x-ipw-artifact": Buffer.from(JSON.stringify({ requestId: randomUUID(), kind: "output", path, bytes: body.length })).toString("base64url") },
      });
      assert.equal(response.status, 201);
      return (await response.json()).resourceId as string;
    };
    const exclusive = await upload("exclusive.txt"), shared = await upload("shared.txt");
    await service.store.run("UPDATE projects SET files=? WHERE id=?", JSON.stringify([{ path: "shared.txt", resourceId: shared }]), other);
    assert.equal((await request("/api/v1/projects/" + moved, { method: "DELETE" })).status, 200);
    assert(await service.store.one("SELECT id FROM projects WHERE id=? AND deleted_at IS NOT NULL", moved));

    assert(service.appData);
    const app = (await service.appData.ensure({ ...owner.user, role: "user" }, { name: "Project data", kind: "plugin", projectId: project })).app;
    const appPath = "/api/data/v1/apps/" + app.id;
    assert.equal((await request(appPath + "/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ insert: "records", values: { content: "remove me" } }) })).status, 200);
    const attachment = await request(appPath + "/files", {
      method: "POST", body: "file",
      headers: { "x-data-file": encodeURIComponent(JSON.stringify({ name: "file.txt" })), "content-type": "text/plain", "content-length": "4" },
    });
    assert.equal(attachment.status, 201);
    const attachmentId = (await attachment.json()).id as string;
    const page = "<h1>Project website</h1>";
    const site = await request("/api/v1/publications", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project, requestId: randomUUID(), entry: "index.html", files: [{ path: "index.html", bytes: page.length }] }),
    });
    assert.equal(site.status, 201);
    const siteId = (await site.json()).id as string;
    const website = "/api/v1/publications/" + siteId;
    assert.equal((await request(website + "/files/index.html", { method: "PUT", body: page })).status, 200);
    assert.equal((await request(website + "/publish", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 200);
    const publicPage = publicationOrigin + "/p/" + siteId + "/index.html";
    assert.equal((await service.app.request(publicPage)).status, 200);
    const websiteObject = await service.store.one<{ storage_key: string }>("SELECT storage_key FROM publication_files WHERE publication_id=?", siteId);
    assert(websiteObject);
    const stored = await service.store.one<{ storage_key: string }>("SELECT storage_key FROM resources WHERE id=?", exclusive);
    assert(stored && stored.storage_key.startsWith("local/"));
    const exclusiveFile = join(dir, "files", stored.storage_key.slice(6));
    const failed = t.mock.method(service.storage, "remove", async () => { throw new Error("storage offline"); });
    const deletion = await request(endpoint + "/permanent", { method: "DELETE" });
    assert.equal(deletion.status, 202, JSON.stringify(await deletion.clone().json()));
    const receipt = (await deletion.json()).deletionId as string;
    assert.equal((await request("/api/v1/resources/" + exclusive + "/download")).status, 404);
    assert.equal((await request("/api/v1/resources/" + shared + "/download")).status, 200);
    assert.equal((await request(appPath)).status, 404);
    assert.equal((await service.app.request(publicPage)).status, 404);
    assert.equal((await request(appPath + "/files/" + attachmentId)).status, 404);
    assert.equal(await readFile(exclusiveFile, "utf8"), "artifact");
    assert.equal(await service.store.one("SELECT id FROM projects WHERE id=?", project), undefined);
    await service.close();
    failed.mock.restore();

    service = await createService(config);
    assert(service.appData);
    const statusPath = "/api/v1/deletions/" + receipt;
    const until = Date.now() + 20_000;
    let status = "pending";
    while (status === "pending" && Date.now() < until) {
      status = (await (await request(statusPath)).json()).status;
      if (status === "pending") await delay(300);
    }
    assert.equal(status, "completed");
    await assert.rejects(readFile(exclusiveFile), { code: "ENOENT" });
    await assert.rejects(readFile(join(dir, "files", attachmentId)), { code: "ENOENT" });
    await assert.rejects(readFile(join(dir, "files", websiteObject.storage_key.slice(6))), { code: "ENOENT" });
    assert.equal(await service.store.one("SELECT id FROM app_data_files WHERE id=?", attachmentId), undefined);
    assert.equal(await service.appData.data.one("SELECT id FROM data_apps WHERE id=?", app.id), undefined);
    assert.equal(await service.appData.data.one("SELECT id FROM data_records WHERE app_id=?", app.id), undefined);
    assert.equal(await readFile(local, "utf8"), "workspace content");
    assert.equal((await request("/api/v1/resources/" + shared + "/download")).status, 200);
    assert.equal((await (await request(endpoint + "/permanent", { method: "DELETE" })).json()).deletionId, receipt);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("deleting a versioned OSS object removes exact versions before markers", async () => {
  const key = "objects/item", sibling = key + "-shared";
  const calls: string[] = [];
  let lists = 0;
  const client = {
    delete: async (name: string, options?: { versionId: string }) => {
      assert.equal(name, key);
      calls.push(options?.versionId ?? "create-marker");
      return { res: { headers: { "x-oss-delete-marker": true } } };
    },
    listObjectVersions: async (query: { prefix: string; keyMarker?: string; versionIdMarker?: string }) => {
      assert.equal(query.prefix, key);
      if (++lists === 1) return {
        objects: [{ name: key, versionId: "new" }], deleteMarker: [{ name: key, versionId: "marker" }],
        isTruncated: true, nextKeyMarker: key, nextVersionIdMarker: "new",
      };
      if (lists === 2) {
        assert.equal(query.versionIdMarker, "new");
        return { objects: [{ name: key, versionId: "null" }, { name: sibling, versionId: "shared" }], deleteMarker: [] };
      }
      return { objects: [{ name: sibling, versionId: "shared" }], deleteMarker: [] };
    },
  } as unknown as Parameters<typeof deleteOssObject>[0];
  await deleteOssObject(client, key);
  assert.deepEqual(calls, ["create-marker", "new", "null", "marker"]);
});

test("referenced account removal rolls back identity changes and an unreferenced account is removed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-account-deletion-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const signup = (name: string) => service.auth.api.signUpEmail({ body: { name, email: name + "@example.test", password: "Deletion-test-password-2026" } });
    const admin = await signup("admin"), linked = await signup("linked"), free = await signup("free");
    await service.store.run('UPDATE "user" SET role=? WHERE id=?', "admin", admin.user.id);
    await service.store.run("INSERT INTO projects(id,owner_id,title,created_at) VALUES(?,?,?,?)", randomUUID(), linked.user.id, "Owned", Date.now());
    const remove = (id: string) => service.app.request("/api/auth/admin/remove-user", {
      method: "POST", headers: { authorization: "Bearer " + admin.token, "content-type": "application/json" },
      body: JSON.stringify({ userId: id }),
    });
    const denied = await remove(linked.user.id);
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).code, "ACCOUNT_HAS_DEPENDENCIES");
    assert(await service.store.one('SELECT id FROM session WHERE "userId"=?', linked.user.id));
    assert(await service.store.one('SELECT id FROM account WHERE "userId"=?', linked.user.id));
    assert.equal((await remove(free.user.id)).status, 200);
    assert.equal(await service.store.one('SELECT id FROM "user" WHERE id=?', free.user.id), undefined);
    assert.equal(await service.store.one('SELECT id FROM session WHERE "userId"=?', free.user.id), undefined);
    assert.equal(await service.store.one('SELECT id FROM account WHERE "userId"=?', free.user.id), undefined);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
