/** Capacity reservations and retention never remove native workspace files. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";

test("personal quota is reserved atomically, unpublished copies expire and published copies remain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-storage-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await service.auth.api.signUpEmail({
      body: {
        name: "Owner",
        email: "storage@example.test",
        password: "Storage-test-password-2026",
      },
    });
    const owner = { userId: user.id, organizationId: null };
    await service.storage.setQuota("personal", user.id, 10);
    const saved = await service.storage.put(
      randomUUID(),
      owner,
      "text/plain",
      Buffer.from("123456"),
    );
    await service.storage.persist(saved, async () => {});
    const row = await service.store.one(
      "SELECT * FROM storage_objects WHERE storage_key=?",
      saved,
    );
    assert.equal(
      Number(row!.expires_at) - Number(row!.created_at),
      7 * 86400000,
    );
    const attempts = await Promise.allSettled(
      [1, 2].map(() =>
        service.storage.put(
          randomUUID(),
          owner,
          "text/plain",
          Buffer.from("1234"),
        ),
      ),
    );
    assert.equal(
      attempts.filter((item) => item.status === "fulfilled").length,
      1,
    );
    assert.equal(
      (await service.storage.quota("personal", user.id)).used_bytes,
      10,
    );
    const extra = attempts.find((item) => item.status === "fulfilled");
    assert(extra?.status === "fulfilled");
    await service.storage.persist(extra.value, async () => {});
    await service.storage.publish(saved);
    await service.store.run(
      "UPDATE storage_objects SET expires_at=? WHERE storage_key=?",
      Date.now() - 1,
      extra.value,
    );
    await writeFile(join(dir, "local-original.txt"), "Native file stays");
    await service.storage.cleanup();
    assert.equal(
      (await service.storage.quota("personal", user.id)).used_bytes,
      6,
    );
    assert.equal(
      await service.storage.read(saved).then((bytes) => bytes.toString()),
      "123456",
    );
    assert.equal(
      await readFile(join(dir, "local-original.txt"), "utf8"),
      "Native file stays",
    );
    await assert.rejects(service.storage.read(extra.value), {
      code: "OUTPUT_EXPIRED",
    });
    await assert.rejects(service.storage.setQuota("personal", user.id, 5), {
      code: "STORAGE_QUOTA_BELOW_USAGE",
    });
    await service.storage.setQuota("personal", user.id, 20);
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2));
        controller.close();
      },
    });
    await assert.rejects(
      service.storage.putStream(randomUUID(), owner, "text/plain", broken, 3),
      { code: "UPLOAD_INCOMPLETE" },
    );
    const quota = await service.storage.quota("personal", user.id);
    assert.equal(quota.used_bytes, 6);
    assert.equal(quota.reserved_bytes, 0);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("organization outputs have separate quota and no expiration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-org-storage-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await service.auth.api.signUpEmail({
      body: {
        name: "Owner",
        email: "org-storage@example.test",
        password: "Storage-test-password-2026",
      },
    });
    const organizationId = randomUUID();
    await service.store.run(
      "INSERT INTO enterprises VALUES(?,?,?,?)",
      organizationId,
      "Organization",
      user.id,
      Date.now(),
    );
    const key = await service.storage.put(
      randomUUID(),
      { userId: user.id, organizationId },
      "text/plain",
      Buffer.from("organization"),
    );
    await service.storage.persist(key, async () => {});
    assert.equal(
      (await service.storage.quota("organization", organizationId)).limit_bytes,
      500 * 1024 ** 3,
    );
    assert.equal(
      (await service.storage.quota("personal", user.id)).used_bytes,
      0,
    );
    assert.equal(
      (
        await service.store.one(
          "SELECT expires_at FROM storage_objects WHERE storage_key=?",
          key,
        )
      )?.expires_at,
      null,
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
