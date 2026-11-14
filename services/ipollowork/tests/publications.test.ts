/** Published sites become readable only after the complete upload, on a separate origin. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";

test("publication keeps drafts private, preserves relative assets and supports public byte ranges", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-publication-"));
  const origin = "http://127.0.0.1:62001";
  const service = await createService(
    await testConfig({ DATA_DIR: dir, PUBLICATION_ORIGIN: origin }),
  );
  try {
    const owner = await service.auth.api.signUpEmail({
      body: {
        name: "Publisher",
        email: "publisher@example.test",
        password: "Publication-test-2026",
      },
    });
    const outside = await service.auth.api.signUpEmail({
      body: {
        name: "Outside",
        email: "outside@example.test",
        password: "Publication-test-2026",
      },
    });
    const headers = {
      Authorization: "Bearer " + owner.token,
      "Content-Type": "application/json",
    };
    const files = [
      {
        path: "design/entry.html",
        body: '<!doctype html><link rel="stylesheet" href="style.css"><h1>Published</h1>',
      },
      { path: "design/style.css", body: "h1 { color: purple }" },
      { path: "design/主题.css", body: "body { margin: 0 }" },
      { path: "design/Z.css", body: "h1 { margin: 0 }" },
    ];
    const input = {
      requestId: randomUUID(),
      entry: files[0]!.path,
      files: files.map((file) => ({
        path: file.path,
        bytes: Buffer.byteLength(file.body),
      })),
    };
    const init = await service.app.request("/api/v1/publications", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    assert.equal(init.status, 201, await init.clone().text());
    const publication = await init.json();
    const path = "/api/v1/publications/" + publication.id;
    assert.equal(
      (
        await service.app.request(
          origin + "/p/" + publication.id + "/design/entry.html",
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await service.app.request(path + "/publish", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await service.app.request(path + "/files/design/entry.html", {
          method: "PUT",
          headers: { Authorization: "Bearer " + outside.token },
          body: files[0]!.body,
        })
      ).status,
      404,
    );
    for (const file of files)
      assert.equal(
        (
          await service.app.request(path + "/files/" + file.path, {
            method: "PUT",
            headers,
            body: file.body,
          })
        ).status,
        200,
      );
    assert.equal(
      (
        await service.app.request("/api/v1/publications", {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
      201,
    );
    const result = await service.app.request(path + "/publish", {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(result.status, 200, await result.clone().text());
    const { url } = await result.json();
    assert.equal(new URL(url).origin, origin);
    const page = await service.app.request(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type")!, /text\/html/);
    assert.equal(page.headers.get("content-disposition"), "inline");
    assert.match(page.headers.get("content-security-policy")!, /sandbox/);
    assert.equal(await page.text(), files[0]!.body);
    const asset = new URL("style.css", url);
    assert.equal(
      await (await service.app.request(asset.href)).text(),
      files[1]!.body,
    );
    const partial = await service.app.request(asset.href, {
      headers: { Range: "bytes=0-1" },
    });
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), "h1");
    assert.equal(
      (
        await service.app.request(asset.href, {
          headers: { Range: "bytes=999-1000" },
        })
      ).status,
      416,
    );
    assert.equal(
      (await service.app.request(origin + "/api/v1/me/summary", { headers }))
        .status,
      404,
    );
    assert.equal(
      (
        await service.app.request(
          "http://localhost:4785" + new URL(url).pathname,
        )
      ).status,
      404,
    );
    const quota = await service.storage.quota("personal", owner.user.id);
    assert.equal(
      quota.used_bytes,
      files.reduce((sum, file) => sum + Buffer.byteLength(file.body), 0),
    );
    const rows = await service.store.all(
      "SELECT expires_at,published_at,attached FROM storage_objects",
    );
    assert(
      rows.every(
        (row) => row.expires_at === null && row.published_at && row.attached,
      ),
    );
    const invalid = await service.app.request("/api/v1/publications", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...input,
        requestId: randomUUID(),
        entry: "../private.env",
        files: [{ path: "../private.env", bytes: 1 }],
      }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
