import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";
import { ExecutionService } from "../src/execution.js";
import { ledgerEntry, wallet } from "../src/domain.js";
import { capabilityRequest, invocationPath } from "../src/capability-protocol.js";
import type { Actor } from "../src/auth.js";

const multi = "/api/v1/services/aigc/multimodal-generation/generation";
test("typed capability requests translate inputs and reject guessed endpoints and unsupported references", () => {
  assert.equal(invocationPath("aliyun-bailian", { id: "qwen-image-3.0" }, [{ method: "POST", path: multi }]), multi);
  assert.equal(invocationPath("aliyun-bailian", { id: "unknown" }, [{ method: "POST", path: multi }, { method: "POST", path: "/other" }]), undefined);
  assert.equal(invocationPath("custom", { id: "declared", invocationPath: "/untrusted" }, [{ method: "POST", path: multi }]), undefined);
  assert.deepEqual(capabilityRequest("image", "dashscope", multi, "qwen-image-3.0", { prompt: "A mountain", images: ["https://media.test/in.png"] }), { model: "qwen-image-3.0", input: { messages: [{ role: "user", content: [{ image: "https://media.test/in.png" }, { text: "A mountain" }] }] }, parameters: { n: 1 } });
  assert.deepEqual(capabilityRequest("speech", "dashscope", multi, "tts", { text: "你好", voice: "Cherry" }), { model: "tts", input: { text: "你好", voice: "Cherry" } });
  assert.deepEqual(capabilityRequest("embedding", "openai", "/embeddings", "embed", { texts: ["hello"], dimensions: 256 }), { model: "embed", input: ["hello"], dimensions: 256 });
  assert.deepEqual(capabilityRequest("transcription", "dashscope", "/asr", "asr", { audio: "https://media.test/voice.wav" }), { model: "asr", input: { file_urls: ["https://media.test/voice.wav"] }, parameters: {} });
  assert.deepEqual(capabilityRequest("rerank", "dashscope", "/rerank", "rank", { query: "apple", documents: ["fruit", "vehicle"], topN: 1 }), { model: "rank", input: { query: "apple", documents: ["fruit", "vehicle"] }, parameters: { top_n: 1 } });
  assert.deepEqual(capabilityRequest("embedding", "ark", "/embeddings/multimodal", "embed", { texts: ["hello"] }), { model: "embed", input: [{ type: "text", text: "hello" }] });
  assert.deepEqual(capabilityRequest("chat", "openai", "/chat/completions", "vision", { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://media.test/image.png" } }] }] }).messages, [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://media.test/image.png" } }] }]);
  assert.throws(() => capabilityRequest("video", "dashscope", "/image2video/video-synthesis", "video", { prompt: "Move", duration: 5 }), { code: "CAPABILITY_IMAGE_REQUIRED" });
  assert.throws(() => capabilityRequest("image", "openai", "/images/generations", "image", { prompt: "Draw", images: ["https://media.test/in.png"] }), { code: "CAPABILITY_INPUT_UNSUPPORTED" });
  assert.throws(() => capabilityRequest("image", "dashscope", multi, "image", { prompt: "Draw", images: ["file:///secret"] }));
  assert.throws(() => capabilityRequest("chat", "openai", "/chat/completions", "chat", { messages: [{ role: "user", content: "Hi" }], path: "/admin" }));
});

test("HTTP keys are revocable and scoped; repeated calls bill once and async results remain owner-only", async () => {
  let calls = 0, polls = 0, ranks = 0;
  let imageBody: unknown;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer provider-secret");
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/images/generations") {
      calls++; imageBody = JSON.parse(Buffer.concat(chunks).toString());
      res.end(JSON.stringify({ data: [{ url: "https://media.test/result.png" }], usage: { image_count: 1 } }));
    } else if (req.url === "/v1/rerank") {
      ranks++;
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { model: "rank", input: { query: "fruit", documents: ["apple", "truck"] }, parameters: { top_n: 2 } });
      res.end(JSON.stringify({ output: { results: [{ index: 0, relevance_score: 0.9 }] } }));
    } else if (req.url === "/v1/video") {
      calls++; res.end(JSON.stringify({ output: { task_id: "video-job", task_status: "PENDING" } }));
    } else if (req.url === "/v1/tasks/video-job") {
      polls++; res.end(JSON.stringify({ output: { task_id: "video-job", task_status: "SUCCEEDED", video_url: "https://media.test/result.mp4" }, usage: { output_video_duration: 5 } }));
    } else { res.statusCode = 404; res.end("{}"); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const dir = await mkdtemp(join(tmpdir(), "ipw-capabilities-"));
  const service = await createService(await testConfig({ DATA_DIR: dir, SERVICE_ORIGIN: "http://localhost:4785" }));
  try {
    const user = await service.auth.api.signUpEmail({ body: { name: "Caller", email: "caller@example.test", password: "Valid-password-2026" } });
    const login = await service.auth.api.signInEmail({ body: { email: user.user.email, password: "Valid-password-2026" } });
    const headers = { authorization: `Bearer ${login.token}`, "content-type": "application/json" };
    const actor: Actor = { id: user.user.id, name: user.user.name, email: user.user.email, role: "admin" };
    const execution = new ExecutionService(service.store, service.settings);
    const common = { provider: "test", keyId: "test", key: "provider-secret", baseUrl: `http://127.0.0.1:${address.port}/v1`, enabled: true };
    const bill = { source: "https://prices.test", verifiedAt: Date.now(), validUntil: Date.now() + 1000000 };
    await execution.save(actor, { ...common, id: "test-image", title: "Image", category: "image", capabilities: ["image"], models: [{ id: "image", name: "Image" }], routes: [{ method: "POST", path: "/images/generations", points: 0 }], billing: { ...bill, kind: "image", protocol: "openai", rates: [{ model: "image", unit: "image", outputUnitPrice: 1000, maxInputTokens: 1, maxOutputTokens: 1, maxUnits: 10 }] } });
    await execution.save(actor, { ...common, id: "test-video", title: "Video", category: "video", capabilities: ["video"], models: [{ id: "video", name: "Video" }], routes: [{ method: "POST", path: "/video", points: 0, async: true, jobResultField: "output.task_id" }, { method: "GET", path: "/tasks/:id", points: 0 }], billing: { ...bill, kind: "video", protocol: "dashscope", rates: [{ model: "video", unit: "video_second", outputUnitPrice: 1000, maxInputTokens: 1, maxOutputTokens: 1, maxUnits: 10 }] } });
    await execution.save(actor, { ...common, id: "test-rank", title: "Rerank", category: "embedding", capabilities: ["rerank"], models: [{ id: "rank", name: "Rerank" }], routes: [{ method: "POST", path: "/rerank", points: 0 }], billing: { ...bill, kind: "request", protocol: "dashscope", rates: [{ model: "rank", unit: "request", outputUnitPrice: 1000, maxInputTokens: 1, maxOutputTokens: 1 }] } });
    await service.store.transaction(() => ledgerEntry(service.store, actor.id, 20, "fixture", "fixture"));
    const created = await service.app.request("/api/v1/access-keys", { method: "POST", headers, body: JSON.stringify({ name: "My website" }) });
    assert.equal(created.status, 201, await created.clone().text());
    const access = await created.json(); assert.match(access.key, /^ipw_/);
    const stored = await service.store.one('SELECT key FROM apikey WHERE id=?', access.id);
    assert(stored?.key); assert.notEqual(stored.key, access.key);
    const keyHeaders = { authorization: `Bearer ${access.key}`, "content-type": "application/json" };
    const listed = await service.app.request("/api/v1/capabilities", { headers: keyHeaders });
    assert.equal(listed.status, 200); assert.equal((await listed.json()).items.length, 3);
    const describe = await service.app.request("/api/v1/capabilities/test-image%3Aimage", { headers: keyHeaders });
    assert.equal(describe.status, 200); assert((await describe.json()).inputSchema.properties.prompt);
    const listKeys = await service.app.request("/api/v1/access-keys", { headers });
    assert(!JSON.stringify(await listKeys.json()).includes(access.key));
    for (const path of ["/api/v1/admin/services", "/api/v1/me/summary", "/api/v1/access-keys"]) assert.equal((await service.app.request(path, { headers: keyHeaders })).status, 403);
    const id = randomUUID(), payload = JSON.stringify({ requestId: id, model: "image", input: { prompt: "A mountain" } });
    const invoke = () => service.app.request("/api/v1/capabilities/test-image%3Aimage/invoke", { method: "POST", headers: keyHeaders, body: payload });
    const first = await invoke(); assert.equal(first.status, 200, await first.clone().text()); assert.equal((await first.json()).state, "succeeded");
    assert.deepEqual(imageBody, { model: "image", prompt: "A mountain", n: 1 });
    assert.equal((await invoke()).status, 200); assert.equal(calls, 1); assert.equal(Number((await wallet(service.store, actor.id)).balance), 19);
    const other = await service.auth.api.signUpEmail({ body: { name: "Other", email: "other@example.test", password: "Valid-password-2026" } });
    const otherLogin = await service.auth.api.signInEmail({ body: { email: other.user.email, password: "Valid-password-2026" } });
    assert.equal((await service.app.request(`/api/v1/access-keys/${access.id}`, { method: "DELETE", headers: { authorization: `Bearer ${otherLogin.token}` } })).status, 404);
    assert.equal((await service.app.request(`/api/v1/capability-tasks/${id}`, { headers: { authorization: `Bearer ${otherLogin.token}` } })).status, 404);
    const videoId = randomUUID();
    const video = await service.app.request("/api/v1/capabilities/test-video%3Avideo/invoke", { method: "POST", headers: keyHeaders, body: JSON.stringify({ requestId: videoId, input: { prompt: "Waves", duration: 5 } }) });
    assert.equal(video.status, 200, await video.clone().text()); assert.equal((await video.json()).state, "pending");
    const task = await service.app.request(`/api/v1/capability-tasks/${videoId}`, { headers: keyHeaders });
    assert.equal(task.status, 200, await task.clone().text()); assert.equal((await task.json()).state, "succeeded");
    assert.equal((await service.app.request(`/api/v1/capability-tasks/${videoId}`, { headers: keyHeaders })).status, 200);
    assert.equal(calls, 2); assert.equal(polls, 1); assert.equal(Number((await wallet(service.store, actor.id)).balance), 14);
    const rank = await service.app.request("/api/v1/capabilities/test-rank%3Arerank/invoke", { method: "POST", headers: keyHeaders, body: JSON.stringify({ requestId: randomUUID(), input: { query: "fruit", documents: ["apple", "truck"] } }) });
    assert.equal(rank.status, 200, await rank.clone().text());
    assert.equal((await rank.json()).state, "succeeded");
    assert.equal(ranks, 1);
    assert.equal(Number((await wallet(service.store, actor.id)).balance), 13);
    const invalid = await service.app.request("/api/v1/capabilities/test-image%3Aimage/invoke", { method: "POST", headers: keyHeaders, body: JSON.stringify({ requestId: randomUUID(), input: { prompt: "Draw" }, path: "/admin" }) });
    assert.equal(invalid.status, 400); assert.equal(calls, 2);
    assert.equal((await service.app.request(`/api/v1/access-keys/${access.id}`, { method: "DELETE", headers })).status, 200);
    assert.equal((await service.app.request("/api/v1/capabilities", { headers: keyHeaders })).status, 401);
    const expired = await service.auth.api.createApiKey({ body: { userId: actor.id, name: "Expired" } });
    await service.store.run('UPDATE apikey SET "expiresAt"=? WHERE id=?', new Date(0), expired.id);
    assert.equal((await service.app.request("/api/v1/capabilities", { headers: { "x-api-key": expired.key } })).status, 401);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
