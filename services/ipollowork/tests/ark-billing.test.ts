/** Ark media use one key, with provider usage settling each model's own unit. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { ExecutionService } from "../src/execution.js";
import { costCredits, reserveUsage, usageCost } from "../src/pricing.js";
import { ledgerEntry, wallet } from "../src/domain.js";
import { testConfig } from "./database.js";

test("Ark video tokens and image pixel tiers settle through one configured key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-ark-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await service.auth.api.signUpEmail({ body: { email: "ark@example.test", name: "Ark", password: "Ark-fixture-password" } });
    const actor = { ...user, role: "admin" };
    let calls = 0;
    const executor = new ExecutionService(service.store, service.settings, async (url, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ark-fixture-key");
      assert.equal(new Headers(init?.headers).has("X-DashScope-Async"), false);
      if (String(url).endsWith("/images/generations")) return Response.json({ data: [{ size: "1536x1536", url: "https://example.test/image.png" }], usage: { input_images: 2, generated_images: 1 } });
      return init?.method === "POST" ? Response.json({ id: "ark-task" }) : Response.json({ status: "succeeded", usage: { completion_tokens: 108900 } });
    });
    await executor.connection(actor, "volcengine-video", { key: "ark-fixture-key", enabled: true });
    const catalog = await executor.admin(actor);
    const video = catalog.items.find(item => item.id === "official-volcengine-video")!;
    const image = catalog.items.find(item => item.id === "official-volcengine-image")!;
    assert.equal(video.keyId, image.keyId);
    assert.deepEqual(video.models.map(model => model.id), ["doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"]);
    const payload = { model: video.models[0].id, content: [{ type: "text", text: "Garden" }], duration: 5, resolution: "720p" };
    const reserved = reserveUsage(video.billing!, payload);
    assert.equal(usageCost(reserved, { status: "running" }), null);
    assert.equal(usageCost(reserved, { status: "expired" }), 0);
    assert.equal(costCredits(usageCost(reserved, { status: "succeeded", usage: { completion_tokens: 108900 } })!), 5010);
    assert.equal(reserved.rate?.outputPerMillion, 46000000);
    const reference = reserveUsage(video.billing!, { ...payload, content: [{ type: "video_url", video_url: { url: "https://example.test/video.mp4" } }] });
    assert.equal(reference.rate?.outputPerMillion, 28000000);
    assert(reference.micros > reserved.micros);
    assert.throws(() => reserveUsage(video.billing!, { ...payload, content: [{ type: "draft_task" }] }), { code: "SERVICE_OPERATION_UNPRICED" });
    assert.throws(() => reserveUsage(video.billing!, { ...payload, duration: 30 }));
    const imagePayload = { model: image.models[0].id, prompt: "Garden", image: ["one", "two"], size: "2K" };
    const imageHold = reserveUsage(image.billing!, imagePayload);
    assert.equal(costCredits(imageHold.micros), 330);
    assert.equal(costCredits(usageCost(imageHold, { data: [{ size: "1536x1536" }], usage: { input_images: 2, generated_images: 1 } })!), 230);
    assert.throws(() => usageCost(imageHold, { data: [{ size: "8000x8000" }], usage: { input_images: 2, generated_images: 1 } }));
    await service.store.transaction(() => ledgerEntry(service.store, user.id, 100000, "grant", "Fixture"));
    const post = (path: string, body: unknown) => ({ requestId: randomUUID(), method: "POST", path, contentType: "application/json", body: Buffer.from(JSON.stringify(body)).toString("base64") });
    await (await executor.invoke(actor, video.id, post("/contents/generations/tasks", payload))).text();
    await (await executor.invoke(actor, video.id, { requestId: randomUUID(), method: "GET", path: "/contents/generations/tasks/ark-task" })).text();
    await (await executor.invoke(actor, image.id, post("/images/generations", imagePayload))).text();
    assert.equal((await wallet(service.store, user.id)).balance, 94760);
    assert.equal(calls, 3);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});
