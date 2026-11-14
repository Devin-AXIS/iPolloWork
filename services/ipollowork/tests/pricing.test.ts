/** Usage settlement uses provider responses and cannot mint credits or replay a charge. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { ExecutionService } from "../src/execution.js";
import {
  billingSchema,
  rateSchema,
  reserveUsage,
  usageCost,
  validatePlanPrice,
} from "../src/pricing.js";
import { ledgerEntry, wallet } from "../src/domain.js";
import { testConfig } from "./database.js";

const rate = {
  model: "fixture",
  inputPerMillion: 1000000000,
  outputPerMillion: 1000000000,
  maxInputTokens: 10000,
  maxOutputTokens: 10,
};
const spec = (kind: "chat" | "image" | "speech" | "video") =>
  billingSchema.parse({
    kind,
    source: "https://provider.example/prices",
    verifiedAt: Date.now(),
    validUntil: Date.now() + 60000,
    rates: [rate],
    charactersPerTenThousand: 800000,
    second768: 500000,
    second2k: 800000,
    imageInput: 200000,
  });

test("chat credits settle from final SSE usage and a duplicate call does not charge twice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-pricing-")),
    app = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await app.auth.api.signUpEmail({
      body: {
        name: "Meter",
        email: "meter@example.test",
        password: "Meter-test-password-2026",
      },
    });
    const actor = { ...user, role: "admin" };
    await app.store.transaction(() =>
      ledgerEntry(app.store, user.id, 10000, "grant", "Grant"),
    );
    let calls = 0, missingUsage = false;
    const executor = new ExecutionService(
      app.store,
      app.settings,
      async (_url, init) => {
        calls++;
        assert.equal(
          JSON.parse(Buffer.from(init!.body as Uint8Array).toString())
            .stream_options.include_usage,
          true,
        );
        if (missingUsage) return new Response('data: [DONE]\n\n', {headers:{'content-type':'text/event-stream'}});
        return new Response(
          'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":10}}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    );
    await executor.save(actor, {
      id: "meter-chat",
      title: "Chat",
      provider: "fixture",
      baseUrl: "https://provider.example",
      keyId: "fixture",
      key: "secret",
      capabilities: ["chat"],
      routes: [{ method: "POST", path: "/chat/completions", points: 0 }],
      billing: spec("chat"),
      enabled: true,
    });
    const request = {
      requestId: randomUUID(),
      method: "POST",
      path: "/chat/completions",
      body: Buffer.from(
        JSON.stringify({
          model: "fixture",
          stream: true,
          max_tokens: 10,
          messages: [{ role: "user", content: "Hello" }],
        }),
      ).toString("base64"),
    };
    const response = await executor.invoke(actor, "meter-chat", request);
    await response.text();
    assert.equal((await wallet(app.store, user.id)).balance, 9970);
    assert.equal(
      (
        await app.store.one(
          "SELECT cost_micros FROM service_calls WHERE id=?",
          request.requestId,
        )
      )?.cost_micros,
      30000,
    );
    await (await executor.invoke(actor, "meter-chat", request)).text();
    assert.equal(calls, 1);
    assert.equal((await wallet(app.store, user.id)).balance, 9970);
    missingUsage = true;
    const uncertain = randomUUID();
    const incomplete = await executor.invoke(actor, "meter-chat", {...request,requestId:uncertain});
    await assert.rejects(incomplete.text(), /Service response interrupted/);
    assert.equal((await app.store.one("SELECT state FROM service_calls WHERE id=?",uncertain))?.state,"unknown");
    await executor.reconcile(actor,uncertain,"failed");
    assert.equal((await wallet(app.store,user.id)).balance,9970);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("video submission holds credits and polling settles the owned job once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-video-pricing-")),
    app = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await app.auth.api.signUpEmail({
      body: {
        name: "Meter",
        email: "video-meter@example.test",
        password: "Meter-test-password-2026",
      },
    });
    const actor = { ...user, role: "admin" };
    await app.store.transaction(() =>
      ledgerEntry(app.store, user.id, 10000, "grant", "Grant"),
    );
    let jobs = 0;
    const executor = new ExecutionService(
      app.store,
      app.settings,
      async (_url, init) =>
        init?.method === "POST"
          ? Response.json({ task_id: ++jobs === 1 ? "job" : "late-job" })
          : Response.json({
              task: {
                status: "succeeded",
                usage: {
                  input_seconds: 0,
                  output_seconds: 4,
                  input_image_count: 0,
                },
              },
            }),
    );
    await executor.save(actor, {
      id: "meter-video",
      title: "Video",
      provider: "fixture",
      baseUrl: "https://provider.example",
      keyId: "fixture",
      key: "secret",
      capabilities: ["video"],
      routes: [
        {
          method: "POST",
          path: "/video",
          points: 0,
          jobResultField: "task_id",
        },
        { method: "GET", path: "/video/:id", points: 0 },
      ],
      billing: spec("video"),
      enabled: true,
    });
    await (
      await executor.invoke(actor, "meter-video", {
        requestId: randomUUID(),
        method: "POST",
        path: "/video",
        body: Buffer.from(
          JSON.stringify({
            model: "fixture",
            resolution: "768P",
            duration: 5,
            content: [{ type: "text", text: "Scene" }],
          }),
        ).toString("base64"),
      })
    ).text();
    assert.equal((await wallet(app.store, user.id)).balance, 7500);
    for (let i = 0; i < 2; i++)
      await (
        await executor.invoke(actor, "meter-video", {
          requestId: randomUUID(),
          method: "GET",
          path: "/video/job",
        })
      ).text();
    assert.equal((await wallet(app.store, user.id)).balance, 8000);
    await assert.rejects(
      executor.invoke({ ...actor, id: "someone-else" }, "meter-video", {
        requestId: randomUUID(),
        method: "GET",
        path: "/video/job",
      }),
      { code: "SERVICE_JOB_FORBIDDEN" },
    );
    const lateId = randomUUID();
    await (
      await executor.invoke(actor, "meter-video", {
        requestId: lateId,
        method: "POST",
        path: "/video",
        body: Buffer.from(
          JSON.stringify({
            model: "fixture",
            resolution: "768P",
            duration: 5,
            content: [{ type: "text", text: "Scene" }],
          }),
        ).toString("base64"),
      })
    ).text();
    await app.store.run(
      "UPDATE service_calls SET state='unknown' WHERE id=?",
      lateId,
    );
    await executor.reconcile(actor, lateId, "failed");
    await (
      await executor.invoke(actor, "meter-video", {
        requestId: randomUUID(),
        method: "GET",
        path: "/video/late-job",
      })
    ).text();
    assert.equal(
      (await wallet(app.store, user.id)).balance,
      8000,
      "late provider completion must not refund an already reconciled call twice",
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("pricing rejects stale cards and below-cost plans, and separates image token prices", () => {
  assert.throws(
    () =>
      reserveUsage({ ...spec("chat"), validUntil: 1 }, { model: "fixture" }),
    { code: "SERVICE_PRICE_EXPIRED" },
  );
  const image = spec("image");
  image.rates[0] = rateSchema.parse({
    ...rate,
    inputPerMillion: 15000000,
    imageInputPerMillion: 10000000,
    outputPerMillion: 25000000,
  });
  const reserved = reserveUsage(image, {
    model: "fixture",
    n: 1,
    prompt: "An image",
  });
  assert.equal(
    usageCost(reserved, {
      usage: {
        input_tokens_details: { text_tokens: 100, image_tokens: 200 },
        output_tokens: 1000,
      },
    }),
    28500,
  );
  const policy = {
    paymentFeeBps: 500,
    minimumMarginBps: 3000,
    membershipOperatingReserveFen: 3000,
  };
  const plan = {
    kind: "membership",
    amount: 9900,
    currency: "CNY",
    points: 40000,
    pointsCost: null,
    enabled: true,
  };
  assert.doesNotThrow(() => validatePlanPrice(plan, policy));
  assert.throws(() => validatePlanPrice({ ...plan, points: 100000 }, policy), {
    code: "PLAN_BELOW_COST",
  });
  assert.throws(() => validatePlanPrice({ ...plan, pointsCost: 1 }, policy), {
    code: "PLAN_BELOW_COST",
  });
});
