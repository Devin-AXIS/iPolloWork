/** Multi-vendor presets and directory discovery share one Alibaba connection. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createService } from "../src/app.js";
import { ExecutionService } from "../src/execution.js";
import { seedOfficialServices } from "../src/official-services.js";
import { bailianChatPresets } from "../src/bailian-models.js";
import { ledgerEntry, wallet } from "../src/domain.js";
import { billingSchema, reserveUsage, usageCost } from "../src/pricing.js";
import { ModelPricing } from "../web/model-pricing.js";
import { testConfig } from "./database.js";

test("Alibaba presets retain operator choices and route third-party models with one workspace key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-bailian-"));
  const app = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await app.auth.api.signUpEmail({ body: { email: "bailian@example.test", password: "Bailian-fixture-password", name: "Bailian" } });
    const actor = { ...user, role: "admin" };
    const executor = new ExecutionService(app.store, app.settings, async (url, init) => {
      const target = new URL(String(url));
      assert.equal(target.origin, "https://workspace-fixture.cn-beijing.maas.aliyuncs.com");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer shared-bailian-fixture");
      if (target.pathname === "/api/v1/models") {
        assert.equal(target.searchParams.has("providers"), false);
        return Response.json({ success: true, output: { total: 2, models: [
          { model: "third-party-new", name: "New third-party model", provider: "mini-max", capabilities: ["TG"], model_info: { context_window: 1000000, max_output_tokens: 8192 }, prices: [] },
          { model: "awaiting-limits", provider: "zhipu-ai", capabilities: ["TG"], model_info: null },
        ] } });
      }
      assert.equal(target.pathname, "/compatible-mode/v1/chat/completions");
      assert.equal(JSON.parse(String(init?.body)).model, "MiniMax/MiniMax-M3.1-Flash");
      return Response.json({ choices: [{ message: { role: "assistant", content: "hello" } }], usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 300 } } });
    });
    const initial = (await executor.admin(actor)).items.find(s => s.id === "official-bailian")!;
    assert.deepEqual(new Set(initial.models.map(m => m.vendor)), new Set(["qwen", "deepseek", "mini-max", "moonshot-ai", "zhipu-ai", "xiaomi"]));
    assert.equal(initial.models.filter(m => m.recommended).length, 10);
    assert.equal(initial.enabled, false);
    const { configured: _configured, ...draft } = initial;
    await executor.save(actor, { ...draft, title: "Operator models", models: initial.models.filter(m => m.id !== "glm-5.3").map(m => m.id === "qwen3.8-flash" ? { ...m, name: "Operator choice", enabled: false } : m).concat({ id: "legacy-model", name: "Legacy model", category: "language", enabled: false, contextWindow: 10000, maxTokens: 1000 }), billing: { ...initial.billing!, rates: initial.billing!.rates.map(rate => rate.model === "qwen3.8-flash" ? { ...rate, inputPerMillion: 9000000 } : rate) } });
    await seedOfficialServices(app.store);
    const once = (await executor.admin(actor)).items.find(s => s.id === initial.id)!;
    assert.equal(once.title, "Operator models");
    assert.equal(once.models.find(m => m.id === "qwen3.8-flash")?.enabled, false);
    assert.equal(once.models.find(m => m.id === "qwen3.8-flash")?.name, "Operator choice");
    assert.equal(once.billing!.rates.find(r => r.model === "qwen3.8-flash")?.inputPerMillion, 9000000);
    assert(once.models.some(m => m.id === "glm-5.3"));
    assert(once.models.some(m => m.id === "legacy-model"));
    await seedOfficialServices(app.store);
    assert.deepEqual((await executor.admin(actor)).items.find(s => s.id === initial.id), once);
    await executor.connection(actor, "bailian", { key: "shared-bailian-fixture", origin: "https://workspace-fixture.cn-beijing.maas.aliyuncs.com", enabled: true });
    await executor.syncModels(actor, initial.id);
    const discovered = (await executor.admin(actor)).items.find(s => s.id === initial.id)!.models.find(m => m.id === "third-party-new")!;
    assert.equal(discovered.vendor, "mini-max");
    assert.equal(discovered.enabled, false);
    assert.equal(discovered.recommended, undefined);
    const afterSync = (await executor.admin(actor)).items.find(s => s.id === initial.id)!;
    assert.equal(afterSync.models.find(m => m.id === "awaiting-limits")?.contextWindow, undefined);
    const { configured: _afterConfigured, ...afterDraft } = afterSync;
    await assert.rejects(executor.save(actor, { ...afterDraft, models: afterSync.models.map(m => m.id === "awaiting-limits" ? { ...m, enabled: true } : m) }), { code: "MODEL_LIMITS_REQUIRED" });
    await app.store.transaction(() => ledgerEntry(app.store, user.id, 100000, "grant", "Fixture"));
    const response = await executor.invoke(actor, initial.id, { requestId: randomUUID(), method: "POST", path: "/chat/completions", contentType: "application/json", body: Buffer.from(JSON.stringify({ model: "MiniMax/MiniMax-M3.1-Flash", messages: [{ role: "user", content: "hello" }], max_tokens: 100 })).toString("base64") });
    await response.text();
    assert.equal((await wallet(app.store, user.id)).balance, 99998);
    const visible = (await executor.catalog(actor)).items.find(s => s.id === initial.id)!;
    assert(visible.models.some(m => m.id === "MiniMax/MiniMax-M3.1-Flash"));
    assert(!visible.models.some(m => m.id === "qwen3.8-flash" || m.id === "third-party-new" || m.id === "legacy-model"));
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test("tiered and multimodal preset usage settles at published rates", () => {
  const spec = billingSchema.parse({ kind: "chat", source: "https://help.aliyun.com/zh/model-studio/model-pricing", verifiedAt: Date.now(), validUntil: Date.now() + 60000, rates: bailianChatPresets.map(entry => entry.rate) });
  const reserve = (model: string) => reserveUsage(spec, { model, messages: [{ role: "user", content: "hello" }], max_tokens: 100 });
  assert.equal(usageCost(reserve("qwen3.7-plus"), { usage: { prompt_tokens: 256000, completion_tokens: 100 } }), 512800);
  assert.equal(usageCost(reserve("qwen3.7-plus"), { usage: { prompt_tokens: 256001, completion_tokens: 100 } }), 1538406);
  assert.equal(usageCost(reserve("xiaomi/mimo-v2.6-pro-ultraspeed"), { usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { audio_tokens: 400, cached_tokens: 200, audio_cached_tokens: 100 } } }), 30050);
});

test("the initial model editor shows recommended versions while retaining the full catalog count", () => {
  const models = [...bailianChatPresets.map(entry => entry.model), { id: "legacy-hidden", name: "Legacy", enabled: false }];
  const html = renderToStaticMarkup(createElement(ModelPricing, { models, setModels() {}, setBilling() {}, category: "language", source: "https://help.aliyun.com/zh/model-studio/model-pricing" }));
  assert.match(html, /显示全部模型（11）/);
  assert.match(html, /MiniMax M3.1 Flash/);
  assert.doesNotMatch(html, /legacy-hidden/);
  const custom = renderToStaticMarkup(createElement(ModelPricing, { models: [{ id: "custom-model", name: "Custom" }], setModels() {}, setBilling() {}, category: "language", source: "https://example.test/prices" }));
  assert.match(custom, /custom-model/);
  assert.doesNotMatch(custom, /显示全部模型/);
  const full = renderToStaticMarkup(createElement(ModelPricing, { models: Array.from({ length: 61 }, (_, index) => ({ id: `model-${index}`, name: `Model ${index}` })), setModels() {}, setBilling() {}, category: "language", source: "https://example.test/prices" }));
  assert.match(full, /显示更多（已显示 50 \/ 61）/);
});
