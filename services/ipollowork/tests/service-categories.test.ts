/** Catalog metadata lets clients distinguish language models, media models and tools. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";
import {serviceCategory} from "../src/service-categories.js";
import { ExecutionService } from "../src/execution.js";
test("catalog and organization grants retain categories and vendors without treating media as chat", async () => {
  assert.equal(serviceCategory(undefined,["chat","image"]),"language");
  const dir = await mkdtemp(join(tmpdir(), "ipw-categories-"));
  const app = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await app.auth.api.signUpEmail({
      body: {
        name: "Categories",
        email: "categories@example.test",
        password: "Categories-fixture-password",
      },
    });
    const actor = { ...user, role: "admin" },
      execution = new ExecutionService(app.store, app.settings);
    const catalog = await execution.admin(actor);
    assert.deepEqual(
      new Set(catalog.items.map((item) => item.category)),
      new Set(["language", "image", "video", "audio", "embedding", "tool"]),
    );
    assert(
      catalog.items.every((item) =>
        item.models.every((model) => model.category === item.category),
      ),
    );
    await execution.save(actor, {
      id: "search-tool",
      title: "Search",
      provider: "search",
      category: "tool",
      vendor: "search",
      capabilities: ["tool"],
      baseUrl: "https://tools.example",
      keyId: "search",
      key: "fixture",
      routes: [{ method: "POST", path: "/search", points: 0 }],
      enabled: true,
    });
    assert.equal(
      (await execution.catalog(actor)).items.find(
        (item) => item.id === "search-tool",
      )?.category,
      "tool",
    );
    await app.store.run(
      "INSERT INTO enterprises(id,name,owner_id,created_at) VALUES(?,?,?,?)",
      "org",
      "Organization",
      user.id,
      Date.now(),
    );
    const saved = await execution.enterpriseSave(actor, "org", {
      title: "Images",
      category: "image",
      vendor: "minimax",
      baseUrl: "https://media.example",
      key: "fixture",
      models: [{ id: "media-model", name: "Media model" }],
      routes: [{ method: "POST", path: "/images", points: 0 }],
    });
    const entry = (await execution.enterpriseList(actor, "org")).find(
      (item) => item.id === saved.id,
    )!;
    assert.equal(entry.category, "image");
    assert.equal(entry.vendor, "minimax");
    assert.equal(entry.models[0]?.category, "image");
    await execution.enterpriseSave(actor, "org", {
      id: saved.id,
      title: "Images",
      baseUrl: "https://media.example",
      models: [{ id: "media-model", name: "Media model" }],
    });
    assert.equal(
      (await execution.enterpriseList(actor, "org"))[0]?.category,
      "image",
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
