import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/app.js";
import { testConfig as loadConfig } from "./database.js";
import { ExecutionService } from "../src/execution.js";
import { ledgerEntry, wallet } from "../src/domain.js";
import type { Actor } from "../src/auth.js";

test("the model gateway forwards large screenshot histories and rejects invalid Base64", async () => {
  const received: { path: string | undefined; hash: string }[] = [];
  const upstream = createServer(async (req, res) => {
    const hash = createHash("sha256");
    for await (const chunk of req) hash.update(chunk);
    received.push({ path: req.url, hash: hash.digest("hex") });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  assert(address && typeof address !== "string");
  const dir = await mkdtemp(join(tmpdir(), "ipw-screenshot-history-"));
  try {
    const app = await createService(await loadConfig({ DATA_DIR: dir, SERVICE_ORIGIN: "http://localhost:4785" }));
    try {
      const caller = await app.auth.api.signUpEmail({ body: {
        email: "screenshots@example.test", name: "Screenshot test", password: "Valid-password-2026",
      } });
      assert(caller.token);
      const actor: Actor = { id: caller.user.id, email: caller.user.email, name: caller.user.name, role: "admin" };
      const executor = new ExecutionService(app.store, app.settings);
      await executor.save(actor, {
        id: "vision-fixture", title: "Vision fixture", provider: "test", keyId: "vision-test", key: "fixture-key",
        baseUrl: `http://127.0.0.1:${address.port}/v1`, capabilities: ["chat"], enabled: true,
        routes: [{ method: "POST", path: "/chat/completions", points: 0 }],
      });
      const invoke = (body: string) => {
        const envelope = JSON.stringify({ requestId: randomUUID(), method: "POST", path: "/chat/completions",
          contentType: "application/json", body });
        return app.app.request("/api/v1/services/vision-fixture/invoke", {
          method: "POST",
          headers: { authorization: `Bearer ${caller.token}`, "content-type": "application/json",
            "content-length": String(Buffer.byteLength(envelope)) },
          body: envelope,
        });
      };
      const screenshot = "data:image/jpeg;base64," + Buffer.alloc(400 * 1024).toString("base64");
      const payload = JSON.stringify({ model: "deepseek-flash", messages: Array.from({ length: 21 }, () => ({
        role: "user", content: [{ type: "image_url", image_url: { url: screenshot } }],
      })) });
      const response = await invoke(Buffer.from(payload).toString("base64"));
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).choices[0].message.content, "OK");
      assert.deepEqual(received, [{ path: "/v1/chat/completions", hash: createHash("sha256").update(payload).digest("hex") }]);

      for (const body of ["abc", "ab=c", "a===", "ab-_", "abcd\n"]) {
        const invalid = await invoke(body);
        assert.equal(invalid.status, 400);
        assert.equal((await invalid.json()).code, "INVALID_INPUT");
      }
      const oversized = await invoke("A".repeat(25 * 1024 * 1024));
      assert.equal(oversized.status, 413);
      await oversized.body?.cancel();
      assert.equal(received.length, 1);
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  }
});

test("official execution shares server credentials, enforces plans and settles each receipt once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-execution-"));
  const app = await createService(
    await loadConfig({
      DATA_DIR: dir,
      SERVICE_ORIGIN: "http://localhost:4785",
    }),
  );
  try {
    const signup = await app.auth.api.signUpEmail({
      body: {
        email: "execution@example.test",
        name: "Execution",
        password: "Valid-password-2026",
      },
    });
    const actor: Actor = {
      id: signup.user.id,
      email: signup.user.email,
      name: signup.user.name,
      role: "admin",
      emailVerified: false,
    };
    let requests = 0;
    let jobMode = false;
    let failure = false;
    let unavailable = false;
    const executor = new ExecutionService(
      app.store,
      app.settings,
      async (url, options) => {
        requests++;
        if (jobMode) return Response.json({ id: "job42", status: "done" });
        assert.equal(
          String(url),
          "https://provider.example/v1/chat/completions",
        );
        assert.equal(
          new Headers(options?.headers).get("authorization"),
          "Bearer provider-secret",
        );
        if (unavailable) throw new Error("network");
        return new Response(JSON.stringify({ answer: "hello", usage: { prompt_tokens: 1, completion_tokens: 2 } }), {
          status: failure ? 400 : 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const spec = {
      id: "official-chat",
      title: "官方对话",
      provider: "bailian",
      baseUrl: "https://provider.example/v1",
      keyId: "bailian",
      key: "provider-secret",
      capabilities: ["chat"],
      routes: [{ method: "POST", path: "/chat/completions", points: 3 }],
      enabled: true,
    };
    await executor.save(actor, spec);
    assert(
      !JSON.stringify(await executor.catalog(actor)).includes(
        "provider-secret",
      ),
    );
    assert(
      !JSON.stringify(await executor.admin(actor)).includes("provider-secret"),
    );
    await assert.rejects(
      async () => await executor.save({ ...actor, role: "user" }, spec),
    );
    await app.store.transaction(
      async () =>
        await ledgerEntry(app.store, actor.id, 20, "fixture", "fixture"),
    );
    const request = {
      requestId: randomUUID(),
      method: "POST",
      path: "/chat/completions",
      contentType: "application/json",
      body: Buffer.from('{"model":"test","messages":[{"role":"user","content":"Hello"}]}').toString("base64"),
    };
    assert.equal(
      (await (await executor.invoke(actor, spec.id, request)).json()).answer,
      "hello",
    );
    assert.equal(Number((await wallet(app.store, actor.id)).balance), 17);
    assert.equal(
      (await (await executor.invoke(actor, spec.id, request)).json()).answer,
      "hello",
    );
    assert.equal(requests, 1);
    await assert.rejects(
      executor.invoke(actor, spec.id, { ...request, body: "e30=" }),
    );
    await assert.rejects(
      executor.invoke(actor, spec.id, {
        ...request,
        requestId: randomUUID(),
        path: "//evil.test",
      }),
    );
    failure = true;
    await assert.rejects(
      executor.invoke(actor, spec.id, { ...request, requestId: randomUUID() }),
    );
    assert.equal(Number((await wallet(app.store, actor.id)).balance), 17);
    failure = false;
    unavailable = true;
    const unknownId = randomUUID();
    await assert.rejects(
      executor.invoke(actor, spec.id, { ...request, requestId: unknownId }),
    );
    assert.equal(Number((await wallet(app.store, actor.id)).balance), 14);
    await executor.reconcile(actor, unknownId, "failed");
    assert.equal(Number((await wallet(app.store, actor.id)).balance), 17);
    await assert.rejects(
      async () => await executor.reconcile(actor, unknownId, "failed"),
    );
    await app.store.run(
      "INSERT INTO plans VALUES('member','Member','','membership',1,'CNY',0,1,1,NULL,?,NULL)",
      Date.now(),
    );
    await executor.save(actor, { ...spec, planIds: ["member"] });
    assert.equal((await executor.catalog(actor)).items[0].available, false);
    await assert.rejects(
      executor.invoke(actor, spec.id, { ...request, requestId: randomUUID() }),
    );
    await app.store.run(
      "INSERT INTO orders(id,user_id,plan_id,provider,status,amount,currency,points,days,created_at) VALUES('fixture',?,'member','points','paid',0,'CNY',0,1,?)",
      actor.id,
      Date.now(),
    );
    await app.store.run(
      "INSERT INTO entitlements VALUES('fixture',?,'member',?,?,NULL)",
      actor.id,
      Date.now() - 100,
      Date.now() + 60000,
    );
    assert.equal((await executor.catalog(actor)).items[0].available, true);
    unavailable = false;
    const pendingId = randomUUID();
    const pending = await executor.invoke(actor, spec.id, {
      ...request,
      requestId: pendingId,
    });
    await assert.rejects(
      executor.invoke(actor, spec.id, { ...request, requestId: pendingId }),
      { code: "SERVICE_CALL_RUNNING" },
    );
    await pending.text();
    assert.equal(Number((await wallet(app.store, actor.id)).balance), 14);
    const pending2 = await executor.invoke(actor, spec.id, {
      ...request,
      requestId: randomUUID(),
    });
    await pending2.body!.cancel();
    assert.equal(
      (await executor.history(actor)).items.some(
        (row) => row.state === "unknown",
      ),
      true,
    );
    await assert.rejects(
      executor.invoke(actor, spec.id, {
        ...request,
        requestId: randomUUID(),
        path: "/a/../chat/completions",
      }),
    );
    await executor.save(actor, {
      ...spec,
      billing: { kind: "chat", source: "https://provider.example/pricing", verifiedAt: Date.now(), validUntil: Date.now() + 60000, rates: [{ model: "test", inputPerMillion: 1000000, outputPerMillion: 1000000, maxInputTokens: 4096, maxOutputTokens: 32 }] },
      models: [
        { id: "test", name: "Test", contextWindow: 4096, maxTokens: 32 },
      ],
    });
    await assert.rejects(
      executor.invoke(actor, spec.id, {
        ...request,
        requestId: randomUUID(),
        body: Buffer.from('{"model":"other"}').toString("base64"),
      }),
    );
    await assert.rejects(
      executor.invoke(actor, spec.id, {
        ...request,
        requestId: randomUUID(),
        body: Buffer.from('{"model":"test","max_tokens":33}').toString(
          "base64",
        ),
      }),
    );
    assert.equal(
      (
        await (
          await executor.invoke(actor, spec.id, {
            ...request,
            requestId: randomUUID(),
          })
        ).json()
      ).answer,
      "hello",
    );
    jobMode = true;
    const jobService = spec.id + "-jobs";
    await executor.save(actor, {
      ...spec,
      id: jobService,
      models: [],
      routes: [
        { method: "POST", path: "/jobs", points: 1, jobResultField: "id" },
        { method: "GET", path: "/jobs/:id", points: 0 },
      ],
    });
    await (
      await executor.invoke(actor, jobService, {
        ...request,
        requestId: randomUUID(),
        path: "/jobs",
        body: "e30=",
      })
    ).text();
    const poll = {
      requestId: randomUUID(),
      path: "/jobs/job42",
      method: "GET",
    };
    await assert.rejects(
      executor.invoke({ ...actor, id: "another-user" }, jobService, poll),
    );
    assert.equal(
      (await (await executor.invoke(actor, jobService, poll)).json()).status,
      "done",
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("administrators probe a connection without billing, and the stored key is reused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-probe-"));
  const app = await createService(
    await loadConfig({
      DATA_DIR: dir,
      SERVICE_ORIGIN: "http://localhost:4785",
    }),
  );
  try {
    const signup = await app.auth.api.signUpEmail({
      body: {
        email: "probe@example.test",
        name: "Probe",
        password: "Valid-password-2026",
      },
    });
    const actor: Actor = {
      id: signup.user.id,
      email: signup.user.email,
      name: signup.user.name,
      role: "admin",
      emailVerified: false,
    };
    const seen: { url: string; auth: string | null; body?: string }[] = [];
    let status = 200,
      down = false;
    const executor = new ExecutionService(
      app.store,
      app.settings,
      async (url, options) => {
        seen.push({
          url: String(url),
          auth: new Headers(options?.headers).get("authorization"),
          ...(typeof options?.body === "string" ? { body: options.body } : {}),
        });
        if (down) throw new Error("network");
        if (String(url).endsWith("/models"))
          return Response.json(
            {
              data: [
                { id: "deepseek-chat" },
                { id: "deepseek-reasoner" },
                { bad: 1 },
              ],
            },
            { status },
          );
        return Response.json({ choices: [] }, { status });
      },
    );
    const draft = {
      baseUrl: "https://provider.example/v1/",
      keyId: "deepseek",
      key: "draft-secret",
    };
    const listed = await executor.probe(actor, draft);
    assert.deepEqual(
      { ok: listed.ok, models: listed.models },
      { ok: true, models: ["deepseek-chat", "deepseek-reasoner"] },
    );
    assert.deepEqual(seen.at(-1), {
      url: "https://provider.example/v1/models",
      auth: "Bearer draft-secret",
    });
    await assert.rejects(
      executor.probe(actor, { ...draft, key: undefined }),
      /SERVICE_UNCONFIGURED/,
    );
    await executor.save(actor, {
      id: "official-deepseek",
      title: "DeepSeek",
      provider: "deepseek",
      baseUrl: draft.baseUrl,
      keyId: "deepseek",
      key: "stored-secret",
      capabilities: ["chat"],
      routes: [{ method: "POST", path: "/chat/completions", points: 1 }],
    });
    const pinged = await executor.probe(actor, {
      baseUrl: draft.baseUrl,
      keyId: "deepseek",
      model: "deepseek-chat",
    });
    assert.equal(pinged.ok, true);
    assert.equal(seen.at(-1)?.auth, "Bearer stored-secret");
    assert.equal(JSON.parse(seen.at(-1)!.body!).max_tokens, 1);
    assert(!JSON.stringify(pinged).includes("secret"));
    status = 401;
    assert.equal((await executor.probe(actor, draft)).reason, "auth");
    status = 404;
    assert.equal((await executor.probe(actor, draft)).ok, true);
    assert.equal(
      (await executor.probe(actor, { ...draft, model: "missing" })).reason,
      "upstream",
    );
    down = true;
    assert.equal((await executor.probe(actor, draft)).reason, "unreachable");
    await assert.rejects(executor.probe({ ...actor, role: "user" }, draft));
    assert.equal(
      (
        await app.store.one<{ n: number }>(
          "SELECT count(*) n FROM service_calls",
        )
      )?.n,
      0,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("one account runs independent services concurrently without duplicate charges", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-parallel-execution-"));
  const config = await loadConfig({ DATA_DIR: dir, SERVICE_ORIGIN: "http://localhost:4785" });
  const app = await createService(config);
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  try {
    const { user } = await app.auth.api.signUpEmail({ body: { email: "parallel@example.test", name: "Parallel", password: "Parallel-test-password" } });
    const actor: Actor = { id: user.id, email: user.email, name: user.name, role: "admin", emailVerified: false };
    await app.store.transaction(() => ledgerEntry(app.store, actor.id, 20, "parallel-funds", "Fixture"));
    const executor = new ExecutionService(app.store, app.settings, async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }), { headers: { "content-type": "application/json" } }));
    const spec = { id: "parallel-a", title: "Parallel", provider: "bailian", baseUrl: "https://provider.example/v1", keyId: "bailian", key: "fixture-key", capabilities: ["chat"], routes: [{ method: "POST", path: "/chat/completions", points: 3 }], enabled: true };
    await executor.save(actor, spec);
    await executor.save(actor, { ...spec, id: "parallel-b" });
    const requests = ["parallel-a", "parallel-b"].map(serviceId => ({ serviceId, input: { requestId: randomUUID(), path: "/chat/completions", method: "POST", body: "e30=", contentType: "application/json" } }));
    const responses = await Promise.all(requests.map(request => executor.invoke(actor, request.serviceId, request.input)));
    assert.equal(streams.length, 2);
    assert.equal((await app.store.one("SELECT COUNT(*) AS total FROM service_calls WHERE user_id=? AND state='running'", actor.id))?.total, 2);
    assert.equal((await wallet(app.store, actor.id)).balance, 14);
    await assert.rejects(executor.invoke(actor, requests[0]!.serviceId, requests[0]!.input), { code: "SERVICE_CALL_RUNNING" });
    for (const stream of streams) { stream.enqueue(new TextEncoder().encode('{"answer":"ok"}')); stream.close(); }
    assert.deepEqual(await Promise.all(responses.map(response => response.json())), [{ answer: "ok" }, { answer: "ok" }]);
    assert.equal((await app.store.one("SELECT COUNT(*) AS total FROM service_calls WHERE user_id=? AND state='running'", actor.id))?.total, 0);
    assert.equal((await wallet(app.store, actor.id)).balance, 14);
    await (await executor.invoke(actor, requests[0]!.serviceId, requests[0]!.input)).text();
    assert.equal(streams.length, 2);
    assert.equal((await wallet(app.store, actor.id)).balance, 14);
    const shared = { ...requests[0]!.input, requestId: randomUUID() };
    const duplicates = await Promise.allSettled([executor.invoke(actor, spec.id, shared), executor.invoke(actor, spec.id, shared)]);
    assert.equal(duplicates.filter(result => result.status === "fulfilled").length, 1);
    const rejected = duplicates.find(result => result.status === "rejected");
    if (rejected?.status === "rejected") assert.equal(rejected.reason.code, "SERVICE_CALL_RUNNING");
    assert.equal(streams.length, 3);
    assert.equal((await wallet(app.store, actor.id)).balance, 11);
    streams[2]!.enqueue(new TextEncoder().encode('{"answer":"once"}'));
    streams[2]!.close();
    for (const result of duplicates) if (result.status === "fulfilled") assert.deepEqual(await result.value.json(), { answer: "once" });
    assert.equal((await wallet(app.store, actor.id)).balance, 11);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
