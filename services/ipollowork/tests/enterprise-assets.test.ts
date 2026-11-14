import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { testConfig as loadConfig } from "./database.js";
import { ExecutionService } from "../src/execution.js";
import type { Actor } from "../src/auth.js";

const code = (expected: string) => (error: unknown) =>
  (error as { code?: string }).code === expected;

test("departments and members receive only the packages, skills and models granted to them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-assets-"));
  const config = await loadConfig({
    DATA_DIR: dir,
    SERVICE_ORIGIN: "http://localhost:4785",
  });
  const service = await createService(config);
  let n = 0;
  const http = async <T = Record<string, unknown>>(
    path: string,
    token: string,
    body?: unknown,
    method?: string,
  ) => {
    const response = await service.app.request(config.origin + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "x-ipollo-peer-ip": "192.0.2." + (++n % 200),
        Authorization: "Bearer " + token,
        Origin: config.origin,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const type = response.headers.get("content-type") ?? "";
    return {
      status: response.status,
      data: (type.includes("json")
        ? await response.json()
        : await response.text()) as T,
    };
  };
  const account = async (email: string) => {
    const signup = await http<{ user: { id: string } }>(
      "/api/auth/sign-up/email",
      "",
      {
        email,
        name: email.split("@")[0],
        password: "Valid-testing-password-2026",
      },
    );
    await service.store.run(
      'UPDATE "user" SET "emailVerified"=true WHERE id=?',
      signup.data.user.id,
    );
    const signed = await http<{ token: string }>(
      "/api/auth/sign-in/email",
      "",
      { email, password: "Valid-testing-password-2026" },
    );
    return { id: signup.data.user.id, token: signed.data.token, email };
  };
  try {
    const owner = await account("owner@assets.test"),
      design = await account("design@assets.test"),
      sales = await account("sales@assets.test");
    const enterprise = (
      await http<{ id: string }>("/api/v1/enterprises", owner.token, {
        name: "Assets",
      })
    ).data.id;
    const dep = async (name: string) =>
      (
        await http<{ id: string }>(
          `/api/v1/enterprises/${enterprise}/departments`,
          owner.token,
          { name },
        )
      ).data.id;
    const designDep = await dep("设计部"),
      salesDep = await dep("销售部");
    for (const [member, department] of [
      [design, designDep],
      [sales, salesDep],
    ] as const) {
      await service.store.run(
        "INSERT INTO members VALUES(?,?,?,?,?)",
        enterprise,
        member.id,
        "member",
        department,
        Date.now(),
      );
    }
    const base = `/api/v1/enterprises/${enterprise}`;

    const pack = (
      await http<{ id: string }>(base + "/packages", owner.token, {
        title: "品牌素材",
        audience: { all: false, departments: [designDep], members: [] },
      })
    ).data.id;
    const form = new FormData();
    form.set(
      "file",
      new File(["logo-bytes"], "logo.svg", { type: "image/svg+xml" }),
    );
    const file = (
      await http<{ id: string }>(
        base + `/packages/${pack}/files`,
        owner.token,
        form,
      )
    ).data.id;
    assert.equal(
      (await http(base + `/packages/${pack}/files`, design.token, form)).status,
      403,
      "members cannot add files",
    );

    const listed = async (token: string) =>
      (
        await http<{
          packages: { id: string }[];
          skills: { id: string; name: string }[];
        }>(base + "/assets", token)
      ).data;
    assert.deepEqual(
      (await listed(design.token)).packages.map((p) => p.id),
      [pack],
    );
    assert.deepEqual((await listed(sales.token)).packages, []);
    assert.equal(
      (
        await http(
          base + `/packages/${pack}/files/${file}/download`,
          design.token,
        )
      ).data,
      "logo-bytes",
    );
    assert.equal(
      (
        await http(
          base + `/packages/${pack}/files/${file}/download`,
          sales.token,
        )
      ).status,
      403,
    );
    assert.equal(
      (await http(base + `/packages/${pack}`, sales.token)).status,
      403,
    );

    const grant = await http<{ audience: { members: string[] } }>(
      base + "/grants",
      owner.token,
      {
        kind: "package",
        assetId: pack,
        audience: { all: false, departments: [designDep], members: [sales.id] },
      },
      "PUT",
    );
    assert.deepEqual(grant.data.audience.members, [sales.id]);
    assert.equal(
      (
        await http(
          base + `/packages/${pack}/files/${file}/download`,
          sales.token,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await http(
          base + "/grants",
          design.token,
          { kind: "package", assetId: pack, audience: { all: true } },
          "PUT",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await http(
          base + "/grants",
          owner.token,
          {
            kind: "package",
            assetId: pack,
            audience: { all: false, departments: [randomUUID()] },
          },
          "PUT",
        )
      ).status,
      400,
    );

    const skill = (
      await http<{ id: string; name: string }>(base + "/skills", owner.token, {
        title: "Brand voice",
        description: "Write in the brand voice",
        content: "# Brand voice\nUse short sentences.",
        audience: { all: false, departments: [salesDep], members: [] },
      })
    ).data;
    assert.equal(skill.name, "brand-voice");
    const mine = async (token: string) =>
      (
        await http<{
          items: { name: string; content: string; enterpriseName: string }[];
        }>("/api/v1/me/enterprise-skills", token)
      ).data.items;
    assert.deepEqual(
      (await mine(sales.token)).map((s) => [s.name, s.enterpriseName]),
      [["brand-voice", "Assets"]],
    );
    assert.match((await mine(sales.token))[0]!.content, /short sentences/);
    assert.deepEqual(await mine(design.token), []);
    assert.equal(
      (await mine(owner.token)).length,
      1,
      "managers can use every skill",
    );

    // Deleting a department unassigns its members and removes its grants.
    assert.equal(
      (
        await http(
          base + `/departments/${designDep}`,
          owner.token,
          undefined,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await service.store.one(
          "SELECT department_id FROM members WHERE user_id=?",
          design.id,
        )
      )?.department_id,
      null,
    );
    assert.deepEqual((await listed(design.token)).packages, []);
    assert.equal(
      (
        await http(
          base + `/departments/${salesDep}`,
          owner.token,
          { name: "大客户部" },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await http(
          base + `/members/${sales.id}`,
          owner.token,
          undefined,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await service.store.one(
          "SELECT COUNT(*) AS n FROM enterprise_grants WHERE audience_id=?",
          sales.id,
        )
      )?.n,
      0,
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("enterprise models use the enterprise key, follow grants, never charge points and stay out of official administration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-ent-models-"));
  const service = await createService(
    await loadConfig({
      DATA_DIR: dir,
      SERVICE_ORIGIN: "https://work.example.test",
    }),
  );
  try {
    const user = async (email: string, role = "user"): Promise<Actor> => {
      const signup = await service.auth.api.signUpEmail({
        body: {
          email,
          name: email.split("@")[0]!,
          password: "Valid-password-2026",
        },
      });
      return {
        id: signup.user.id,
        email,
        name: signup.user.name,
        role,
        emailVerified: true,
      };
    };
    const owner = await user("owner@models.test"),
      granted = await user("granted@models.test"),
      other = await user("other@models.test"),
      admin = await user("admin@models.test", "admin");
    const enterprise = randomUUID(),
      dep = randomUUID();
    await service.store.run(
      "INSERT INTO enterprises VALUES(?,?,?,?)",
      enterprise,
      "Models",
      owner.id,
      Date.now(),
    );
    await service.store.run(
      "INSERT INTO departments VALUES(?,?,?)",
      dep,
      enterprise,
      "研发部",
    );
    await service.store.run(
      "INSERT INTO members VALUES(?,?,?,?,?)",
      enterprise,
      owner.id,
      "owner",
      null,
      Date.now(),
    );
    await service.store.run(
      "INSERT INTO members VALUES(?,?,?,?,?)",
      enterprise,
      granted.id,
      "member",
      dep,
      Date.now(),
    );
    await service.store.run(
      "INSERT INTO members VALUES(?,?,?,?,?)",
      enterprise,
      other.id,
      "member",
      null,
      Date.now(),
    );
    const seen: { url: string; auth: string | null }[] = [];
    const gateway = new ExecutionService(
      service.store,
      service.settings,
      async (url, options) => {
        seen.push({
          url: String(url),
          auth: new Headers(options?.headers).get("authorization"),
        });
        return Response.json({ choices: [{ message: { content: "ok" } }] });
      },
    );
    await assert.rejects(
      async () =>
        await gateway.enterpriseSave(owner, enterprise, {
          title: "Local",
          baseUrl: "https://10.0.0.5/v1",
          key: "k",
          models: [],
        }),
      code("SERVICE_UPSTREAM_FORBIDDEN"),
    );
    await assert.rejects(
      async () =>
        await gateway.enterpriseSave(granted, enterprise, {
          title: "X",
          baseUrl: "https://llm.example.test/v1",
          key: "k",
          models: [],
        }),
      code("ENTERPRISE_FORBIDDEN"),
    );
    const { id } = await gateway.enterpriseSave(owner, enterprise, {
      title: "企业 DeepSeek",
      baseUrl: "https://llm.example.test/v1",
      key: "enterprise-secret",
      models: [
        {
          id: "deepseek-chat",
          name: "DeepSeek Chat",
          contextWindow: 65536,
          maxTokens: 4096,
        },
      ],
      audience: { all: false, departments: [dep], members: [] },
    });
    const catalog = async (actor: Actor) =>
      (await gateway.catalog(actor)).items.filter((item) => item.enterprise);
    assert.deepEqual(
      (await catalog(granted)).map((item) => [
        item.id,
        item.enterprise?.name,
        item.available,
      ]),
      [[id, "Models", true]],
    );
    assert.deepEqual(await catalog(other), []);
    assert.equal(
      (await gateway.admin(admin)).items.some((item) => item.id === id),
      false,
      "official administration excludes enterprise models",
    );
    await assert.rejects(
      async () =>
        await gateway.save(admin, {
          id,
          title: "Takeover",
          provider: "x",
          baseUrl: "https://evil.example/v1",
          keyId: "x",
          capabilities: ["chat"],
          routes: [{ method: "POST", path: "/chat/completions", points: 1 }],
        }),
      code("SERVICE_OWNED_BY_ENTERPRISE"),
    );
    const request = {
      requestId: randomUUID(),
      method: "POST",
      path: "/chat/completions",
      contentType: "application/json",
      body: Buffer.from('{"model":"deepseek-chat"}').toString("base64"),
    };
    assert.equal((await gateway.invoke(granted, id, request)).status, 200);
    assert.equal(seen.at(-1)?.auth, "Bearer enterprise-secret");
    assert.equal(
      (
        await service.store.one(
          "SELECT points FROM service_calls WHERE service_id=?",
          id,
        )
      )?.points,
      0,
    );
    await assert.rejects(
      gateway.invoke(other, id, { ...request, requestId: randomUUID() }),
      code("ASSET_FORBIDDEN"),
    );
    assert.equal(
      JSON.stringify(await gateway.enterpriseList(owner, enterprise)).includes(
        "enterprise-secret",
      ),
      false,
    );
    await assert.rejects(
      gateway.enterpriseProbe(owner, enterprise, {
        baseUrl: "https://llm.example.test/v1",
        serviceId: "official-deepseek",
      }),
      code("SERVICE_UNAVAILABLE"),
    );
    assert.equal(
      (
        await gateway.enterpriseProbe(owner, enterprise, {
          baseUrl: "https://llm.example.test/v1",
          serviceId: id,
        })
      ).ok,
      true,
    );
    await gateway.enterpriseRemove(owner, enterprise, id);
    assert.deepEqual(
      await catalog(granted),
      [],
      "a model with receipts is disabled instead of deleted",
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
