/** Provider catalogs, shared keys and metered media keep credits and access consistent. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { billingSchema, costCredits, hasModelPrice, planBudget, reserveUsage, usageCost } from "../src/pricing.js";
import { parseBailianPage } from "../src/model-catalog.js";
import { createService } from "../src/app.js";
import { ExecutionService } from "../src/execution.js";
import { ledgerEntry, wallet } from "../src/domain.js";
import { testConfig } from "./database.js";

const billing = (unit: "image" | "video_second" | "character" | "token", extra = {}) => billingSchema.parse({
  kind: unit === "token" ? "chat" : unit === "character" ? "speech" : unit === "image" ? "image" : "video",
  protocol: "dashscope", source: "https://help.aliyun.com/zh/model-studio/model-pricing",
  verifiedAt: Date.now(), validUntil: Date.now() + 60000,
  rates: [{ model: "fixture", unit, maxInputTokens: 10000, maxOutputTokens: 1000,
    inputPerMillion: 1000000, outputPerMillion: 2000000, cachedInputPerMillion: 100000,
    inputUnitPrice: unit === "character" ? 100 : 20000, outputUnitPrice: unit === "image" ? 180000 : 600000, ...extra }],
});

test("image and speech credits use their own units, including Chinese character weighting", () => {
  const image = reserveUsage(billing("image"), { model: "fixture", input: { messages: [{ content: [{ image: "one" }, { image: "two" }] }] }, parameters: { n: 2 } });
  assert.equal(costCredits(image.micros), 400);
  assert.equal(costCredits(usageCost(image, { usage: { image_count: 1 } })!), 220);
  const voice = reserveUsage(billing("character"), { model: "fixture", input: { text: "中文A" } });
  assert.equal(voice.micros, 500);
  assert.equal(costCredits(usageCost(voice, { output: { audio: {} } })!), 1);
  assert.throws(() => usageCost(image, { usage: {} }));
});

test("context tiers and cached input settle using the final provider usage", () => {
  const spec = billing("token", { tiers: [
    { upToInputTokens: 3000, inputPerMillion: 1000000, outputPerMillion: 2000000, cachedInputPerMillion: 100000 },
    { upToInputTokens: 10000, inputPerMillion: 3000000, outputPerMillion: 6000000, cachedInputPerMillion: 300000 },
  ] });
  const reserved = reserveUsage(spec, { model: "fixture", messages: [{ role: "user", content: "hello" }], max_tokens: 10 });
  assert.equal(usageCost(reserved, { usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80 } } }), 48);
  assert.throws(() => usageCost(reserved, { usage: { prompt_tokens: 10, completion_tokens: 1, prompt_cache_hit_tokens: 20 } }));
  const video = reserveUsage(billing("video_second", { inputUnitPrice: 0, tiers: [{ resolution: "720P", outputUnitPrice: 600000 }, { resolution: "1080P", outputUnitPrice: 1000000 }] }), { model: "fixture", parameters: { duration: 10, resolution: "720P" } });
  assert.equal(costCredits(video.micros), 6000);
  assert.equal(usageCost(video, { output: { task_status: "RUNNING" } }), null);
  assert.equal(usageCost(video, { output: { task_status: "FAILED" } }), 0);
  assert.equal(usageCost(video, { output: { task_status: "SUCCEEDED" }, usage: { output_video_duration: 5, input_video_duration: 0 } }), 3000000);
  assert.throws(() => reserveUsage(billing("video_second", { tiers: [{ resolution: "720P", outputUnitPrice: 600000 }] }), { model: "fixture", parameters: { duration: 10, resolution: "4K" } }), { code: "SERVICE_PRICE_VARIANT_REQUIRED" });
});

test("99 CNY funds 40000 credits while preserving the configured reserves", () => {
  const result = planBudget(9900, 40000, "membership", { paymentFeeBps: 500, minimumMarginBps: 3000, membershipOperatingReserveFen: 3000 });
  assert.deepEqual(result, { feeFen: 495, reserveFen: 3000, maximumPoints: 44830, modelCostFen: 4000, remainingFen: 2405, allowed: true });
  assert.equal(planBudget(9900, 50000, "membership", { paymentFeeBps: 500, minimumMarginBps: 3000, membershipOperatingReserveFen: 3000 }).allowed, false);
});

test("embedding arrays are metered and zero-valued draft prices stay unavailable", () => {
  const spec = billingSchema.parse({ ...billing("token"), kind: "embedding" });
  const reserved = reserveUsage(spec, { model: "fixture", input: ["one", "two"] });
  assert.equal(usageCost(reserved, { usage: { total_tokens: 20 } }), 20);
  spec.rates[0] = { ...spec.rates[0], inputPerMillion: 0, outputPerMillion: 0, inputUnitPrice: 0, outputUnitPrice: 0 };
  assert.equal(hasModelPrice(spec, "fixture"), false);
  assert.throws(() => reserveUsage(spec, { model: "fixture", input: ["one"] }), { code: "SERVICE_MODEL_UNAVAILABLE" });
  spec.rates[0].free = true;
  assert.equal(reserveUsage(spec, { model: "fixture", input: ["one"] }).micros, 0);
});

test("official discovery classifies each modality and never invents an unknown price", () => {
  const result = parseBailianPage({ success: true, output: { total: 4, models: [
    { model: "qwen-fixture", capabilities: ["TG", "VU"], model_info: { context_window: 10000, max_output_tokens: 1000 }, prices: [{ range_name: "Default", prices: [{ type: "input_token", price: "1", price_unit: "每百万tokens" }, { type: "output_token", price: "2", price_unit: "每百万tokens" }] }] },
    { model: "image-fixture", capabilities: ["IG"] }, { model: "asr-fixture", capabilities: ["ASR"] }, { model: "tts-fixture", capabilities: ["TTS"] },
  ] } });
  assert.deepEqual(result.items.map(item => item.operation), ["chat", "image", "transcription", "speech"]);
  assert.equal(result.items[0].rate?.inputPerMillion, 1000000);
  assert.equal(result.items[1].rate, undefined);
  assert(result.items.every(item => item.model.enabled === false));
  const video = parseBailianPage({ success: true, output: { total: 1, models: [{ model: "video", capabilities: ["VG"], prices: [{ range_name: "720P", prices: [{ type: "output_video", price: "0.6", price_unit: "每秒" }] }] }] } });
  assert.equal(video.items[0].rate?.unit, "video_second");
  assert.equal(video.items[0].rate?.tiers[0].resolution, "720P");
});

test("paginated discovery preserves operator prices and atomically rejects an incomplete catalog", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-discovery-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await service.auth.api.signUpEmail({ body: { email: "discovery@example.test", password: "Models-fixture-password", name: "Discovery" } });
    const actor = { ...user, role: "admin" };
    let pages = 0, incomplete = false, duplicate = false;
    const executor = new ExecutionService(service.store, service.settings, async url => {
      pages++;
      assert.equal(new URL(String(url)).pathname, "/api/v1/models");
      const page = new URL(String(url)).searchParams.get("page_no");
      return Response.json({ success: true, output: { total: 3, models: incomplete && page === "2" ? [] : [{ model: page === "1" || duplicate ? "qwen3.8-flash" : page === "2" ? "new-image" : "new-realtime", capabilities: page === "1" ? ["TG"] : page === "2" ? ["IG"] : ["Realtime-Omni"], model_info: { context_window: 10000, max_output_tokens: 1000 }, prices: [] }] } });
    });
    await executor.connection(actor, "bailian", { key: "catalog-key" });
    const before = (await executor.admin(actor)).items.find(row => row.id === "official-bailian")!;
    const result = await executor.syncModels(actor, "official-bailian");
    assert.equal(pages, 3);
    assert.equal(result.imported, 2);
    const after = (await executor.admin(actor)).items;
    assert.deepEqual(after.find(row => row.id === "official-bailian")?.billing, before.billing);
    assert.equal(after.find(row => row.id === "official-bailian-image")?.models.find(model => model.id === "new-image")?.enabled, false);
    const { configured: _configured, ...other } = after.find(row => row.id === "official-bailian-other")!;
    assert.equal(other.models[0].id, "new-realtime");
    assert.equal(other.enabled, false);
    assert.deepEqual(other.routes, []);
    await assert.rejects(executor.save(actor, { ...other, enabled: true }), { code: "SERVICE_ROUTES_REQUIRED" });
    incomplete = true;
    await assert.rejects(executor.syncModels(actor, "official-bailian"), { code: "SERVICE_DISCOVERY_INCOMPLETE" });
    assert.deepEqual((await executor.admin(actor)).items, after);
    incomplete = false;
    duplicate = true;
    await assert.rejects(executor.syncModels(actor, "official-bailian"), { code: "SERVICE_DISCOVERY_INCOMPLETE" });
    assert.deepEqual((await executor.admin(actor)).items, after);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});

test("one provider key enables only priced models; asynchronous image polling refunds unused output once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-models-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await service.auth.api.signUpEmail({ body: { email: "models@example.test", password: "Models-fixture-password", name: "Models" } });
    const actor = { ...user, role: "admin" };
    let calls = 0;
    const executor = new ExecutionService(service.store, service.settings, async (_url, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-shared-key");
      if (init?.method === "POST") {
        assert.equal(new Headers(init.headers).get("X-DashScope-Async"), "enable");
        return Response.json({ output: { task_id: "test-task", task_status: "PENDING" } });
      }
      return Response.json({ output: { task_status: "SUCCEEDED" }, usage: { image_count: 1 } });
    });
    const { configured: _configured, ...image } = (await executor.admin(actor)).items.find(row => row.id === "official-bailian-image")!;
    assert.equal((await executor.catalog(actor)).items.length, 0);
    await executor.connection(actor, "bailian", { key: "test-shared-key", enabled: true });
    const catalog = await executor.catalog(actor);
    assert(catalog.items.some(row => row.category === "image"));
    assert(catalog.items.some(row => row.category === "video"));
    assert(catalog.items.some(row => row.category === "audio"));
    assert(!JSON.stringify(catalog).includes("test-shared-key"));
    await assert.rejects(executor.connection({ ...actor, role: "user" }, "bailian", { key: "forbidden" }));
    await executor.save(actor, { ...image, models: [...image.models, { id: "unpriced", name: "Unpriced", category: "image", enabled: true }], enabled: false });
    await assert.rejects(executor.save(actor, { ...image, models: [{ id: "unpriced", name: "Unpriced" }], enabled: true }), { code: "SERVICE_MODEL_UNPRICED" });
    await executor.save(actor, { ...image, enabled: true });
    await service.store.transaction(() => ledgerEntry(service.store, user.id, 10000, "grant", "Test"));
    const request = { requestId: randomUUID(), method: "POST", path: "/api/v1/services/aigc/text2image/image-synthesis", contentType: "application/json", body: Buffer.from(JSON.stringify({ model: "wan2.6-t2i", input: { prompt: "Test" }, parameters: { n: 2 } })).toString("base64") };
    await (await executor.invoke(actor, image.id, request)).text();
    assert.equal((await wallet(service.store, user.id)).balance, 9600);
    const poll = { requestId: randomUUID(), method: "GET", path: "/api/v1/tasks/test-task" };
    await (await executor.invoke(actor, "official-bailian-video", poll)).text();
    assert.equal((await wallet(service.store, user.id)).balance, 9800);
    await (await executor.invoke(actor, "official-bailian-video", poll)).text();
    assert.equal(calls, 2);
    assert.equal((await wallet(service.store, user.id)).balance, 9800);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});
