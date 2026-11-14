/** Real HTTP and persistence checks for project output versions and bounded memory. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";

test("project outputs stream into immutable versions, preserve author and lose access with membership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-archives-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  const account = async (name: string) => {
    const value = await service.auth.api.signUpEmail({
      body: {
        name,
        email: name + "@example.test",
        password: "Archive-test-password-2026",
      },
    });
    assert(value.token);
    return { ...value, token: value.token };
  };
  try {
    const owner = await account("owner"),
      member = await account("member"),
      outside = await account("outside");
    const organization = randomUUID(),
      project = randomUUID();
    await service.store.run(
      "INSERT INTO enterprises VALUES(?,?,?,?)",
      organization,
      "Organization",
      owner.user.id,
      Date.now(),
    );
    for (const user of [owner.user, member.user])
      await service.store.run(
        "INSERT INTO members VALUES(?,?,?,?,?)",
        organization,
        user.id,
        "member",
        null,
        Date.now(),
      );
    await service.store.run(
      "INSERT INTO projects(id,owner_id,enterprise_id,title,created_at) VALUES(?,?,?,?,?)",
      project,
      owner.user.id,
      organization,
      "Project",
      Date.now(),
    );
    await service.store.run(
      "INSERT INTO project_grants VALUES(?,'member',?,'participate')",
      project,
      member.user.id,
    );
    const endpoint = "/api/v1/projects/" + project;
    const upload = (
      token: string,
      requestId: string,
      body: string,
      kind = "output",
      path = "page.html",
      bytes = Buffer.byteLength(body),
    ) =>
      service.app.request(endpoint + "/artifacts/upload", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "x-ipw-artifact": Buffer.from(
            JSON.stringify({ requestId, kind, path, bytes }),
          ).toString("base64url"),
        },
        body,
      });
    const id = randomUUID(),
      first = await upload(member.token, id, "first");
    assert.equal(first.status, 201);
    const saved = await first.json();
    assert.equal(saved.version, 1);
    assert.equal(
      (await (await upload(member.token, id, "first")).json()).id,
      saved.id,
    );
    assert.equal((await upload(member.token, id, "changed")).status, 409);
    assert.equal(
      (await (await upload(member.token, randomUUID(), "second")).json())
        .version,
      2,
    );
    assert.equal(
      (await upload(member.token, randomUUID(), "input", "input")).status,
      400,
    );
    assert.equal(
      (await upload(outside.token, randomUUID(), "secret")).status,
      403,
    );
    assert.equal(
      (await upload(member.token, randomUUID(), "bad", "output", "../escape"))
        .status,
      400,
    );
    assert.equal(
      (
        await upload(
          member.token,
          randomUUID(),
          "short",
          "output",
          "broken",
          10,
        )
      ).status,
      409,
    );
    assert.equal(
      (await service.store.one("SELECT COUNT(*) AS n FROM project_artifacts"))
        ?.n,
      2,
    );
    assert.equal((await readdir(join(dir, "files"))).length, 2);
    const headers = { authorization: "Bearer " + member.token };
    const versions = await service.app.request(
      endpoint + "/artifacts/" + saved.id + "/versions",
      { headers },
    );
    assert.deepEqual(
      (await versions.json()).items.map(
        (item: { version: number }) => item.version,
      ),
      [2, 1],
    );
    const file = await service.app.request(
      "/api/v1/resources/" + saved.resourceId + "/download",
      { headers },
    );
    assert.equal(await file.text(), "first");
    await service.store.run(
      "DELETE FROM members WHERE user_id=?",
      member.user.id,
    );
    assert.equal(
      (
        await service.app.request(
          "/api/v1/resources/" + saved.resourceId + "/download",
          { headers },
        )
      ).status,
      403,
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("project memory keeps originals outside PostgreSQL and rejects oversized or third-level summaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-memory-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const account = await service.auth.api.signUpEmail({
      body: {
        name: "Owner",
        email: "memory@example.test",
        password: "Memory-test-password-2026",
      },
    });
    const project = randomUUID(),
      headers = {
        authorization: "Bearer " + account.token,
        "content-type": "application/json",
      };
    await service.store.run(
      "INSERT INTO projects(id,owner_id,title,created_at) VALUES(?,?,?,?)",
      project,
      account.user.id,
      "Project",
      Date.now(),
    );
    const endpoint = "/api/v1/projects/" + project,
      request = (path: string, body: unknown) =>
        service.app.request(endpoint + path, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
    const proposal = await request("/changes", {
      requestId: randomUUID(),
      kind: "memory",
      title: "Decision",
      text: "Original discussion",
      baseVersion: 0,
    });
    const change = await proposal.json();
    assert.equal(proposal.status, 201);
    const row = await service.store.one(
      "SELECT content FROM project_changes WHERE id=?",
      change.id,
    );
    assert(!String(row?.content).includes("Original discussion"));
    const accept = "/changes/" + change.id + "/accept";
    assert.equal(
      (await request(accept, { expectedVersion: 0, text: "### Too deep" }))
        .status,
      400,
    );
    assert.equal(
      (await request(accept, { expectedVersion: 0, text: "a".repeat(8001) }))
        .status,
      400,
    );
    assert.equal(
      (
        await request(accept, {
          expectedVersion: 0,
          text: "# Goal\nSummary\n## Decision\nAccepted",
        })
      ).status,
      200,
    );
    const version = await service.app.request(endpoint + "/memory-versions/1", {
      headers,
    });
    assert.equal(
      await version.text(),
      "# Goal\nSummary\n## Decision\nAccepted",
    );
    assert.equal(
      (
        await service.store.one(
          "SELECT memory_version FROM projects WHERE id=?",
          project,
        )
      )?.memory_version,
      1,
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
