import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ExecutionService } from "../src/execution.js";
import { ledgerEntry, wallet } from "../src/domain.js";
import type { Actor } from "../src/auth.js";

test("official execution shares server credentials, enforces plans and settles each receipt once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-execution-"));
  const app = await createService(
    loadConfig({ DATA_DIR: dir, SERVICE_ORIGIN: "http://localhost:4785" }),
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
        return new Response(JSON.stringify({ answer: "hello" }), {
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
    executor.save(actor, spec);
    assert(
      !JSON.stringify(executor.catalog(actor)).includes("provider-secret"),
    );
    assert(!JSON.stringify(executor.admin(actor)).includes("provider-secret"));
    assert.throws(() => executor.save({ ...actor, role: "user" }, spec));
    app.store.transaction(() =>
      ledgerEntry(app.store, actor.id, 20, "fixture", "fixture"),
    );
    const request = {
      requestId: randomUUID(),
      method: "POST",
      path: "/chat/completions",
      contentType: "application/json",
      body: Buffer.from('{"model":"test"}').toString("base64"),
    };
    assert.equal(
      (await (await executor.invoke(actor, spec.id, request)).json()).answer,
      "hello",
    );
    assert.equal(Number(wallet(app.store, actor.id).balance), 17);
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
    assert.equal(Number(wallet(app.store, actor.id).balance), 17);
    failure = false;
    unavailable = true;
    const unknownId = randomUUID();
    await assert.rejects(
      executor.invoke(actor, spec.id, { ...request, requestId: unknownId }),
    );
    assert.equal(Number(wallet(app.store, actor.id).balance), 14);
    executor.reconcile(actor, unknownId, "failed");
    assert.equal(Number(wallet(app.store, actor.id).balance), 17);
    assert.throws(() => executor.reconcile(actor, unknownId, "failed"));
    app.store.run(
      "INSERT INTO plans VALUES('member','Member','','membership',1,'CNY',0,1,1,NULL,?,NULL)",
      Date.now(),
    );
    executor.save(actor, { ...spec, planIds: ["member"] });
    assert.equal(executor.catalog(actor).items[0].available, false);
    await assert.rejects(
      executor.invoke(actor, spec.id, { ...request, requestId: randomUUID() }),
    );
    app.store.run(
      "INSERT INTO orders(id,user_id,plan_id,provider,status,amount,currency,points,days,created_at) VALUES('fixture',?,'member','points','paid',0,'CNY',0,1,?)",
      actor.id,
      Date.now(),
    );
    app.store.run(
      "INSERT INTO entitlements VALUES('fixture',?,'member',?,?,NULL)",
      actor.id,
      Date.now() - 100,
      Date.now() + 60000,
    );
    assert.equal(executor.catalog(actor).items[0].available, true);
    unavailable = false;
    const pendingId = randomUUID();
    const pending = await executor.invoke(actor, spec.id, {
      ...request,
      requestId: pendingId,
    });
    await assert.rejects(
      executor.invoke(actor, spec.id, { ...request, requestId: randomUUID() }),
    );
    await pending.text();
    assert.equal(Number(wallet(app.store, actor.id).balance), 14);
    const pending2 = await executor.invoke(actor, spec.id, {
      ...request,
      requestId: randomUUID(),
    });
    await pending2.body!.cancel();
    assert.equal(
      executor.history(actor).items.some((row) => row.state === "unknown"),
      true,
    );
    await assert.rejects(
      executor.invoke(actor, spec.id, {
        ...request,
        requestId: randomUUID(),
        path: "/a/../chat/completions",
      }),
    );
    executor.save(actor, {
      ...spec,
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
    executor.save(actor, {
      ...spec,
      models: [],
      routes: [
        { method: "POST", path: "/jobs", points: 1, jobResultField: "id" },
        { method: "GET", path: "/jobs/:id", points: 0 },
      ],
    });
    await (
      await executor.invoke(actor, spec.id, {
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
      executor.invoke({ ...actor, id: "another-user" }, spec.id, poll),
    );
    assert.equal(
      (await (await executor.invoke(actor, spec.id, poll)).json()).status,
      "done",
    );
  } finally {
    app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("administrators probe a connection without billing, and the stored key is reused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-probe-"));
  const app = await createService(loadConfig({ DATA_DIR: dir, SERVICE_ORIGIN: "http://localhost:4785" }));
  try {
    const signup = await app.auth.api.signUpEmail({ body: { email: "probe@example.test", name: "Probe", password: "Valid-password-2026" } });
    const actor: Actor = { id: signup.user.id, email: signup.user.email, name: signup.user.name, role: "admin", emailVerified: false };
    const seen: { url: string; auth: string | null; body?: string }[] = [];
    let status = 200, down = false;
    const executor = new ExecutionService(app.store, app.settings, async (url, options) => {
      seen.push({ url: String(url), auth: new Headers(options?.headers).get("authorization"), ...(typeof options?.body === "string" ? { body: options.body } : {}) });
      if (down) throw new Error("network");
      if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }, { bad: 1 }] }, { status });
      return Response.json({ choices: [] }, { status });
    });
    const draft = { baseUrl: "https://provider.example/v1/", keyId: "deepseek", key: "draft-secret" };
    const listed = await executor.probe(actor, draft);
    assert.deepEqual({ ok: listed.ok, models: listed.models }, { ok: true, models: ["deepseek-chat", "deepseek-reasoner"] });
    assert.deepEqual(seen.at(-1), { url: "https://provider.example/v1/models", auth: "Bearer draft-secret" });
    await assert.rejects(executor.probe(actor, { ...draft, key: undefined }), /SERVICE_UNCONFIGURED/);
    executor.save(actor, { id: "official-deepseek", title: "DeepSeek", provider: "deepseek", baseUrl: draft.baseUrl, keyId: "deepseek", key: "stored-secret", capabilities: ["chat"], routes: [{ method: "POST", path: "/chat/completions", points: 1 }] });
    const pinged = await executor.probe(actor, { baseUrl: draft.baseUrl, keyId: "deepseek", model: "deepseek-chat" });
    assert.equal(pinged.ok, true);
    assert.equal(seen.at(-1)?.auth, "Bearer stored-secret");
    assert.equal(JSON.parse(seen.at(-1)!.body!).max_tokens, 1);
    assert(!JSON.stringify(pinged).includes("secret"));
    status = 401;
    assert.equal((await executor.probe(actor, draft)).reason, "auth");
    status = 404;
    assert.equal((await executor.probe(actor, draft)).ok, true);
    assert.equal((await executor.probe(actor, { ...draft, model: "missing" })).reason, "upstream");
    down = true;
    assert.equal((await executor.probe(actor, draft)).reason, "unreachable");
    await assert.rejects(executor.probe({ ...actor, role: "user" }, draft));
    assert.equal(app.store.one<{ n: number }>("SELECT count(*) n FROM service_calls")?.n, 0);
  } finally {
    app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
