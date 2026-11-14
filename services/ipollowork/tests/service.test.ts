import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { createService } from "../src/app.js";
import { testConfig as loadConfig } from "./database.js";
import {
  ledgerEntry,
  now,
  wallet,
  settleOrder,
  refundOrder,
} from "../src/domain.js";

test("standalone service: identity, enterprise isolation, files and payments", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-services-test-"));
  const config = await loadConfig({
    DATA_DIR: dir,
    SERVICE_ORIGIN: "http://localhost:4785",
  });
  let service = await createService(config);
  let requestNumber = 0;
  const http = async <T = Record<string, unknown>>(
    path: string,
    token?: string,
    body?: unknown,
    method?: string,
  ) => {
    const response = await service.app.request(config.origin + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "x-ipollo-peer-ip": "192.0.2." + (++requestNumber % 200),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        Origin: config.origin,
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  const account = async (email: string, admin = false) => {
    const signup = await http<{ user: { id: string }; token: string }>(
      "/api/auth/sign-up/email",
      undefined,
      {
        email,
        name: email.split("@")[0],
        password: "Valid-testing-password-2026",
      },
    );
    assert.equal(signup.status, 200, JSON.stringify(signup.data));
    await service.store.run(
      'UPDATE "user" SET role=?,"emailVerified"=true WHERE id=?',
      admin ? "admin" : "user",
      signup.data.user.id,
    );
    const signed = await http<{ token: string }>(
      "/api/auth/sign-in/email",
      undefined,
      { email, password: "Valid-testing-password-2026" },
    );
    assert.equal(signed.status, 200);
    return { id: signup.data.user.id, token: signed.data.token, email };
  };
  const legacyShare = async <T = { id: string }>(
    path: string,
    token: string,
    body: {
      projectId: string;
      title: string;
      transcript: unknown;
      visibility?: string;
      recipients?: { email: string; role: string }[];
    },
  ) => {
    const user = await http<{ user: { id: string } }>(
      "/api/auth/get-session",
      token,
    );
    const id = randomUUID();
    await service.store.run(
      "INSERT INTO shares VALUES(?,?,?,?,?,?,NULL,?)",
      id,
      user.data.user.id,
      body.projectId,
      body.title,
      JSON.stringify(body.transcript),
      body.visibility ?? "selected",
      Date.now(),
    );
    for (const recipient of body.recipients ?? []) {
      const target = await service.store.one(
        'SELECT id FROM "user" WHERE email=?',
        recipient.email,
      );
      await service.store.run(
        "INSERT INTO share_members VALUES(?,?,?)",
        id,
        target!.id,
        recipient.role,
      );
    }
    return { status: 201, data: { id } as T };
  };
  try {
    const owner = await account("owner@example.test"),
      colleague = await account("colleague@example.test"),
      outsider = await account("outsider@example.test"),
      admin = await account("admin@example.test", true);
    await t.test(
      "native Work login routes expose identity and balance without admin access",
      async () => {
        const session = await http<{ user: { id: string } }>(
          "/api/auth/get-session",
          owner.token,
        );
        assert.equal(session.data.user.id, owner.id);
        const summary = await http<{ points: { balance: number } }>(
          "/api/v1/me/summary",
          owner.token,
        );
        assert.equal(summary.data.points.balance, 0);
        assert.equal(
          (await http("/api/v1/admin/overview", owner.token)).status,
          403,
        );
        assert.equal((await http("/api/v1/me/summary")).status, 401);
        const native = await service.app.request(
          config.origin + "/api/auth/sign-in/email",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ipollo-peer-ip": "192.0.2.201",
            },
            body: JSON.stringify({
              email: owner.email,
              password: "Valid-testing-password-2026",
            }),
          },
        );
        assert.equal(native.status, 200);
        const cookieWithoutOrigin = await service.app.request(
          config.origin + "/api/auth/sign-in/email",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              cookie: "session=example",
              "x-ipollo-peer-ip": "192.0.2.202",
            },
            body: JSON.stringify({
              email: owner.email,
              password: "Valid-testing-password-2026",
            }),
          },
        );
        assert.equal(cookieWithoutOrigin.status, 403);
        const registrationBody = JSON.stringify({
          name: "Native signup",
          email: "native-signup@example.test",
          password: "Native-password-2026",
        });
        const registration = await service.app.request(
          config.origin + "/api/auth/sign-up/email",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ipollo-peer-ip": "192.0.2.203",
            },
            body: registrationBody,
          },
        );
        assert.equal(registration.status, 200);
        const registered = await registration.json();
        assert.ok(registered.token);
        assert.equal(registered.user.role, "user");
        const foreignRegistration = await service.app.request(
          config.origin + "/api/auth/sign-up/email",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ipollo-peer-ip": "192.0.2.204",
              Origin: "https://evil.test",
            },
            body: registrationBody,
          },
        );
        assert.equal(foreignRegistration.status, 403);
        const cross = await service.app.request(
          config.origin + "/api/v1/enterprises",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + owner.token,
              Origin: "https://evil.test",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: "Bad" }),
          },
        );
        assert.equal(cross.status, 403);
      },
    );
    const enterprise = await http<{ id: string }>(
      "/api/v1/enterprises",
      owner.token,
      { name: "产品团队" },
    );
    assert.equal(enterprise.status, 201);
    const id = enterprise.data.id;
    await t.test(
      "native projects are idempotent and moving ownership revokes previous shares",
      async () => {
        const body = {
          title: "Native project",
          enterpriseId: id,
          nativeId: "native-project-id",
        };
        const created = await http<{ id: string }>(
          "/api/v1/projects",
          owner.token,
          body,
        );
        const repeated = await http<{ id: string }>(
          "/api/v1/projects",
          owner.token,
          body,
        );
        assert.equal(created.data.id, repeated.data.id);
        assert.equal(
          (
            await http("/api/v1/projects", owner.token, {
              ...body,
              enterpriseId: null,
            })
          ).status,
          409,
        );
        const share = await legacyShare<{ id: string }>(
          "/api/v1/shares",
          owner.token,
          {
            projectId: created.data.id,
            title: "Before move",
            visibility: "enterprise",
            transcript: [{ role: "user", content: "Hello" }],
          },
        );
        assert.equal(
          (
            await http(
              "/api/v1/projects/" + created.data.id,
              outsider.token,
              { enterpriseId: null },
              "PATCH",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await http(
              "/api/v1/projects/" + created.data.id,
              owner.token,
              { enterpriseId: null },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (await http("/api/v1/shares/" + share.data.id, owner.token)).status,
          404,
        );
        assert.equal(
          (
            await service.store.one(
              "SELECT MAX(version) AS user_version FROM service_schema",
            )
          )?.user_version,
          4,
        );
      },
    );
    await t.test(
      "invitations are email-bound, verified, idempotent and department-scoped",
      async () => {
        const department = await http<{ id: string }>(
          "/api/v1/enterprises/" + id + "/departments",
          owner.token,
          { name: "研发" },
        );
        const invite = await http<{ url: string }>(
          "/api/v1/enterprises/" + id + "/invitations",
          owner.token,
          { email: colleague.email, departmentId: department.data.id },
        );
        const path =
          "/api/v1/invitations/" + invite.data.url.split("/").pop() + "/accept";
        assert.equal((await http(path, outsider.token, {})).status, 403);
        await service.store.run(
          'UPDATE "user" SET "emailVerified"=false WHERE id=?',
          colleague.id,
        );
        assert.equal((await http(path, colleague.token, {})).status, 403);
        await service.store.run(
          'UPDATE "user" SET "emailVerified"=true WHERE id=?',
          colleague.id,
        );
        assert.equal((await http(path, colleague.token, {})).status, 200);
        assert.equal(
          (await http(path, colleague.token, {})).data.duplicate,
          true,
        );
        assert.equal(
          (await http("/api/v1/enterprises/" + id, outsider.token)).status,
          403,
        );
        const other = await http<{ id: string }>(
          "/api/v1/enterprises",
          outsider.token,
          { name: "另一个团队" },
        );
        const dept2 = await http<{ id: string }>(
          "/api/v1/enterprises/" + other.data.id + "/departments",
          outsider.token,
          { name: "研发" },
        );
        assert.equal(
          (
            await http(
              "/api/v1/enterprises/" + id + "/members/" + colleague.id,
              owner.token,
              { role: "member", departmentId: dept2.data.id },
              "PATCH",
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "private files and shared conversations lose access when membership is removed",
      async () => {
        const form = new FormData(),
          content = Buffer.from([0, 255, 1, 2, 3]);
        form.set("file", new File([content], "private.zip"));
        form.set(
          "metadata",
          JSON.stringify({
            title: "私有插件",
            kind: "plugin",
            visibility: "enterprise",
            enterpriseId: id,
          }),
        );
        const resource = await http<{ id: string }>(
          "/api/v1/resources",
          owner.token,
          form,
        );
        assert.equal(resource.status, 201);
        const download = "/api/v1/resources/" + resource.data.id + "/download";
        assert.equal((await http(download, outsider.token)).status, 403);
        const file = await service.app.request(config.origin + download, {
          headers: { Authorization: "Bearer " + colleague.token },
        });
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), content);
        const project = await http<{ id: string }>(
          "/api/v1/projects",
          owner.token,
          { title: "新品", enterpriseId: id, nativeId: "dsh-project" },
        );
        const share = await legacyShare<{ id: string }>(
          "/api/v1/shares",
          owner.token,
          {
            projectId: project.data.id,
            title: "方案",
            visibility: "enterprise",
            transcript: [{ role: "assistant", content: "私密内容" }],
            recipients: [{ email: colleague.email, role: "comment" }],
          },
        );
        assert.equal(share.status, 201);
        assert.equal(
          (await http("/api/v1/shares/" + share.data.id, colleague.token))
            .status,
          200,
        );
        assert.equal(
          (
            await http<{ items: { id: string }[] }>(
              "/api/v1/shares",
              colleague.token,
            )
          ).data.items.some((s) => s.id === share.data.id),
          true,
        );
        assert.equal(
          (
            await http<{ items: { id: string }[] }>(
              "/api/v1/shares",
              outsider.token,
            )
          ).data.items.some((s) => s.id === share.data.id),
          false,
        );
        assert.equal(
          (await http("/api/v1/shares/" + share.data.id, outsider.token))
            .status,
          403,
        );
        assert.equal(
          (
            await http(
              "/api/v1/shares/" + share.data.id + "/comments",
              colleague.token,
              { content: "收到" },
            )
          ).status,
          410,
        );
        assert.equal(
          (
            await http(
              "/api/v1/enterprises/" + id + "/members/" + colleague.id,
              owner.token,
              undefined,
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal(
          (await http("/api/v1/shares/" + share.data.id, colleague.token))
            .status,
          403,
        );
        assert.equal((await http(download, colleague.token)).status, 403);
        assert.equal(
          (
            await http<{ items: unknown[] }>(
              "/api/v1/resources?kind=plugin",
              colleague.token,
            )
          ).data.items.length,
          0,
        );
      },
    );
    await t.test(
      "verified payment notifications settle once; tampering rolls back; refunds reverse credits",
      async () => {
        const plan = await http<{ id: string }>(
          "/api/v1/admin/plans",
          admin.token,
          {
            name: "积分包",
            kind: "points",
            amount: 990,
            currency: "CNY",
            points: 1000,
          },
        );
        assert.equal(plan.status, 201);
        const orderId = randomUUID();
        await service.store.run(
          "INSERT INTO orders VALUES(?,?,?,?,NULL,'pending',?,?,?,?,?,NULL)",
          orderId,
          owner.id,
          plan.data.id,
          "stripe",
          990,
          "CNY",
          1000,
          0,
          now(),
        );
        await service.settings.set("stripe", {
          secretKey: "sk_test_fixture_only",
          webhookSecret: "whsec_fixture_only",
        });
        const stripe = new Stripe("sk_test_fixture_only");
        const event = {
          id: "evt_local",
          object: "event",
          type: "checkout.session.completed",
          data: {
            object: {
              client_reference_id: orderId,
              payment_status: "paid",
              amount_total: 990,
              currency: "cny",
              payment_intent: "pi_local",
            },
          },
        };
        const send = async (payload: object, signature?: string) => {
          const body = JSON.stringify(payload);
          return service.app.request(config.origin + "/hooks/stripe", {
            method: "POST",
            headers: {
              "stripe-signature":
                signature ??
                stripe.webhooks.generateTestHeaderString({
                  payload: body,
                  secret: "whsec_fixture_only",
                }),
            },
            body,
          });
        };
        assert.equal((await send(event, "bad")).status, 400);
        assert.equal(
          (
            await send({
              ...event,
              data: { object: { ...event.data.object, amount_total: 1 } },
            })
          ).status,
          409,
        );
        assert.equal(
          Number((await wallet(service.store, owner.id)).balance),
          0,
        );
        const responses = await Promise.all([
          await send(event),
          await send(event),
          await send(event),
        ]);
        assert.ok(responses.every((r) => r.status === 200));
        assert.equal(
          Number((await wallet(service.store, owner.id)).balance),
          1000,
        );
        assert.equal(
          (
            await service.store.one(
              "SELECT COUNT(*) AS value FROM ledger WHERE reference=?",
              "order/" + orderId,
            )
          )?.value,
          1,
        );
        const refund = {
          type: "charge.refunded",
          data: { object: { refunded: true, payment_intent: "pi_local" } },
        };
        assert.equal((await send(refund)).status, 200);
        assert.equal((await send(refund)).status, 200);
        assert.equal(
          Number((await wallet(service.store, owner.id)).balance),
          0,
        );
      },
    );
    await t.test(
      "points pricing differs from cash and insufficient balances cannot spend",
      async () => {
        const plan = await http<{ id: string }>(
          "/api/v1/admin/plans",
          admin.token,
          {
            name: "月度会员",
            kind: "membership",
            amount: 1900,
            currency: "CNY",
            points: 0,
            days: 30,
            pointsCost: 50,
          },
        );
        const order = {
          planId: plan.data.id,
          provider: "points",
          requestId: randomUUID(),
        };
        assert.equal(
          (await http("/api/v1/orders", owner.token, order)).status,
          409,
        );
        await service.store.transaction(
          async () =>
            await ledgerEntry(
              service.store,
              owner.id,
              100,
              "fixture",
              "测试",
              admin.id,
            ),
        );
        assert.equal(
          (await http("/api/v1/orders", owner.token, order)).status,
          200,
        );
        assert.equal(
          (await http("/api/v1/orders", owner.token, order)).status,
          200,
        );
        assert.equal(
          Number((await wallet(service.store, owner.id)).balance),
          50,
        );
      },
    );
    await t.test(
      "refunds remove the duration from later stacked memberships",
      async (subtest) => {
        subtest.mock.timers.enable({apis:["Date"],now:Date.now()});
        subtest.after(() => subtest.mock.timers.reset());
        const plan = await http<{ id: string }>(
          "/api/v1/admin/plans",
          admin.token,
          {
            name: "会员退款检查",
            kind: "membership",
            amount: 100,
            points: 0,
            days: 30,
          },
        );
        const orders = [randomUUID(), randomUUID()];
        for (const id of orders) {
          await service.store.run(
            "INSERT INTO orders VALUES(?,?,?,?,NULL,'pending',?,?,?,?,?,NULL)",
            id,
            colleague.id,
            plan.data.id,
            "stripe",
            100,
            "CNY",
            0,
            30,
            now(),
          );
          await settleOrder(service.store, id, id, 100, "CNY");
        }
        const end = Number(
          (
            await service.store.one(
              "SELECT MAX(expires_at) AS value FROM entitlements WHERE user_id=?",
              colleague.id,
            )
          )?.value,
        );
        await refundOrder(service.store, orders[0]);
        const updated = Number(
          (
            await service.store.one(
              "SELECT MAX(expires_at) AS value FROM entitlements WHERE user_id=? AND revoked_at IS NULL",
              colleague.id,
            )
          )?.value,
        );
        assert.equal(end - updated, 30 * 86400000);
      },
    );
    await t.test(
      "settings stay encrypted and banning a user revokes active sessions",
      async () => {
        const settings = await http<{ stripe: { secretKey: string } }>(
          "/api/v1/admin/settings",
          admin.token,
        );
        assert.equal(settings.data.stripe.secretKey, "••••••••");
        assert.ok(
          !String(
            (
              await service.store.one(
                "SELECT value FROM settings WHERE key='stripe'",
              )
            )?.value,
          ).includes("sk_test"),
        );
        assert.equal(
          (
            await http(
              "/api/v1/admin/users/" + outsider.id,
              admin.token,
              { banned: true, role: "user" },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (await http("/api/v1/me/summary", outsider.token)).status,
          401,
        );
        assert.equal(
          (
            await http(
              "/api/v1/admin/users/" + admin.id,
              admin.token,
              { banned: true, role: "user" },
              "PATCH",
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "PostgreSQL restarts keep balances and schemas; runtime does not use Cloud",
      async () => {
        const oldBalance = (await wallet(service.store, owner.id)).balance;
        await service.close();
        service = await createService(config);
        assert.equal(
          (await wallet(service.store, owner.id)).balance,
          oldBalance,
        );
        assert.equal(
          (await http("/api/v1/me/summary", owner.token)).status,
          200,
        );
        assert.equal((await http("/api/health")).data.database, "postgresql");
        const code = await readFile(
          new URL("../src/app.ts", import.meta.url),
          "utf8",
        );
        assert.ok(!code.includes("iPolloWork-cloud"));
      },
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
