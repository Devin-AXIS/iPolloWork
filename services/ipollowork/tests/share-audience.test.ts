import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { getRequestListener } from "@hono/node-server";
import { WebSocket } from "ws";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/app.js";
import { testConfig as loadConfig } from "./database.js";
import { audienceAllows, resolveShareAudience } from "../src/share-audience.js";

test("native audiences follow membership and public links admit guests until revoked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-audience-"));
  const service = await createService(
    await loadConfig({
      DATA_DIR: dir,
      SERVICE_ORIGIN: "http://localhost:4785",
    }),
  );
  let peer = 0;
  const http = async (
    path: string,
    token?: string,
    body?: unknown,
    method?: string,
  ) =>
    service.app.request("http://localhost:4785" + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        "x-ipollo-peer-ip": "192.0.2." + ++peer,
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const account = async (name: string) => {
    const response = await http("/api/auth/sign-up/email", undefined, {
      name,
      email: name + "@example.test",
      password: "Audience-test-password-2026",
    });
    const value = (await response.json()) as {
      token: string;
      user: { id: string; name: string; email: string };
    };
    assert.equal(response.status, 200);
    return { ...value, actor: { ...value.user, role: "user" } };
  };
  try {
    const owner = await account("owner"),
      member = await account("member"),
      outsider = await account("outsider");
    const enterpriseResponse = await http("/api/v1/enterprises", owner.token, {
      name: "Team",
    });
    const enterprise = (await enterpriseResponse.json()) as { id: string };
    const departmentResponse = await http(
      "/api/v1/enterprises/" + enterprise.id + "/departments",
      owner.token,
      { name: "Design" },
    );
    const department = (await departmentResponse.json()) as { id: string };
    await service.store.run(
      "INSERT INTO members VALUES(?,?,?,?,?)",
      enterprise.id,
      member.user.id,
      "member",
      department.id,
      Date.now(),
    );
    const share = {
      owner_id: owner.user.id,
      project_id: null,
      mode: "view",
      audience_json: "",
    };
    const check = async (audience: unknown) => ({
      ...share,
      audience_json: JSON.stringify(
        await resolveShareAudience(service.store, owner.actor, audience),
      ),
    });
    const team = await check({ kind: "team", enterpriseId: enterprise.id });
    assert(await audienceAllows(service.store, team, member.actor));
    assert(!(await audienceAllows(service.store, team, outsider.actor)));
    const departments = await check({
      kind: "departments",
      enterpriseId: enterprise.id,
      departmentIds: [department.id],
    });
    assert(await audienceAllows(service.store, departments, member.actor));
    await service.store.run(
      "UPDATE members SET department_id=NULL WHERE user_id=?",
      member.user.id,
    );
    assert(!(await audienceAllows(service.store, departments, member.actor)));
    const selected = await check({
      kind: "members",
      enterpriseId: enterprise.id,
      userIds: [member.user.id],
    });
    assert(await audienceAllows(service.store, selected, member.actor));
    await assert.rejects(
      async () =>
        await check({
          kind: "members",
          enterpriseId: enterprise.id,
          userIds: [outsider.user.id],
        }),
    );
    await assert.rejects(
      async () =>
        await resolveShareAudience(service.store, outsider.actor, {
          kind: "team",
          enterpriseId: enterprise.id,
        }),
    );
    await service.store.run(
      "DELETE FROM members WHERE user_id=?",
      member.user.id,
    );
    assert(!(await audienceAllows(service.store, selected, member.actor)));
    const response = await http("/api/v1/liveshare/intents", owner.token, {
      sessionId: "source",
      title: "Public",
      role: "view",
      allowsFork: false,
      audience: { kind: "link" },
    });
    assert.equal(response.status, 201);
    const result = (await response.json()) as { intent: string };
    const id = result.intent.slice("ipollo-intent:".length);
    await service.store.run(
      "UPDATE live_shares SET native_id=? WHERE id=?",
      "native-public",
      id,
    );
    const publicShare = await service.relay.share("native-public");
    assert.equal(
      (await service.relay.snapshot(publicShare)).accessMode,
      "open",
    );
    assert.deepEqual(
      (await service.relay.snapshot(publicShare)).allowedSubjectIds,
      [],
    );
    assert.equal((await service.relay.snapshot(publicShare)).allowsFork, false);
    assert.equal(
      (
        await http(
          "/api/v1/liveshare/shares/native-public/audience",
          outsider.token,
        )
      ).status,
      403,
    );
    const changed = await http(
      "/api/v1/liveshare/shares/native-public/audience",
      owner.token,
      { audience: { kind: "team", enterpriseId: enterprise.id } },
      "PUT",
    );
    assert.equal(changed.status, 200);
    assert.equal(
      (await service.relay.snapshot(await service.relay.share("native-public")))
        .accessMode,
      "selected",
    );
    const scope = await http(
      "/api/v1/liveshare/shares/native-public/audience",
      owner.token,
    );
    assert.deepEqual(await scope.json(), {
      audience: { kind: "team", enterpriseId: enterprise.id },
    });
    assert.equal(
      (
        await http(
          "/api/v1/liveshare/shares/native-public/audience",
          owner.token,
          {
            audience: {
              kind: "members",
              enterpriseId: enterprise.id,
              userIds: [outsider.user.id],
            },
          },
          "PUT",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await http(
          "/api/v1/liveshare/shares/native-public/audience",
          outsider.token,
          { audience: { kind: "link" } },
          "PUT",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await http(
          "/api/v1/liveshare/shares/native-public/audience",
          owner.token,
          { audience: { kind: "link" } },
          "PUT",
        )
      ).status,
      200,
    );
    const restored = await service.relay.share("native-public");
    assert.equal(restored.mode, "view");
    assert.equal(restored.allows_fork, 0);
    const guest = service.relay.sign({
      purpose: "viewer",
      sessionId: "",
      subjectId: "guest:test",
      displayName: "Guest",
      shareId: "native-public",
      anonymous: true,
      expiresAt: Date.now() + 3600000,
    });
    assert.equal((await service.relay.verify(guest, "viewer")).anonymous, true);
    const nativeLink = await http("/?shareId=native-public");
    assert.equal(nativeLink.status, 302);
    assert.equal(nativeLink.headers.get("location"), "/s/native-public");
    const directory = await http("/api/v1/liveshare/shares", outsider.token);
    assert.deepEqual(
      ((await directory.json()) as { shares: unknown[] }).shares,
      [],
    );
    const page = await http("/s/native-public");
    assert.equal(page.status, 200);
    assert(!(await page.text()).includes('id="login"'));
    await service.store.run(
      "UPDATE live_shares SET audience_json=? WHERE id=?",
      JSON.stringify({ kind: "team", enterpriseId: enterprise.id }),
      id,
    );
    await assert.rejects(
      async () => await service.relay.verify(guest, "viewer"),
    );
    const privatePage = await http("/s/native-public");
    assert((await privatePage.text()).includes('id="login"'));
    await service.store.run(
      "UPDATE live_shares SET revoked_at=? WHERE id=?",
      Date.now(),
      id,
    );
    await assert.rejects(
      async () => await service.relay.share("native-public"),
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PostgreSQL restart preserves project share records and fork permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-audience-migration-"));
  const config = await loadConfig({
    DATA_DIR: dir,
    SERVICE_ORIGIN: "http://localhost:4785",
  });
  let service = await createService(config);
  try {
    const owner = await service.auth.api.signUpEmail({
      body: {
        name: "Owner",
        email: "migration@example.test",
        password: "Migration-test-password-2026",
      },
    });
    await service.store.run(
      "INSERT INTO projects(id,owner_id,title,created_at) VALUES(?,?,?,?)",
      "project",
      owner.user.id,
      "Project",
      Date.now(),
    );
    await service.store.run(
      "INSERT INTO live_shares(id,owner_id,project_id,source_session,mode,title,created_at,allows_fork) VALUES(?,?,?,?,?,?,?,?)",
      "legacy",
      owner.user.id,
      "project",
      "source",
      "write",
      "Existing",
      Date.now(),
      1,
    );
    await service.close();
    service = await createService(config);
    const row = await service.store.one(
      "SELECT * FROM live_shares WHERE id=?",
      "legacy",
    );
    assert.equal(row?.project_id, "project");
    assert.equal(row?.title, "Existing");
    assert.equal(row?.audience_json, '{"kind":"project"}');
    assert.equal(row?.allows_fork, 1);
    assert.equal(
      (
        await service.store.one(
          "SELECT MAX(version) AS version FROM service_schema",
        )
      )?.version,
      4,
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("unextended native open links work without a suite intent and keep expiry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-native-open-"));
  const service = await createService(
    await loadConfig({
      DATA_DIR: dir,
      SERVICE_ORIGIN: "http://localhost:4785",
    }),
  );
  const server = createServer(getRequestListener(service.app.fetch)),
    detach = service.relay.attach(server);
  const sockets: WebSocket[] = [];
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert(address && typeof address !== "string");
    const user = await service.auth.api.signUpEmail({
      body: {
        name: "Owner",
        email: "open@example.test",
        password: "Native-open-test-2026",
      },
    });
    const session = (await service.store.one(
      'SELECT id FROM session WHERE "userId"=?',
      user.user.id,
    ))!;
    const credential = service.relay.sign({
      purpose: "owner",
      sessionId: String(session.id),
      subjectId: user.user.id,
      displayName: "Owner",
      instanceKey: "instance",
      expiresAt: Date.now() + 3600000,
    });
    const expiry = new Date(Date.now() + 1800000).toISOString();
    const url = new URL(
      "ws://127.0.0.1:" + address.port + "/__tunnel_gateway__",
    );
    for (const [key, value] of Object.entries({
      shareId: "native-open",
      sessionId: "source",
      sessionTitle: "Open native link",
      sessionMode: "view",
      accessMode: "open",
      protocolVersion: "1",
      expiresAt: expiry,
    }))
      url.searchParams.set(key, value);
    const ws = new WebSocket(url, {
      headers: {
        authorization: "Bearer " + "g".repeat(32),
        "x-liveshare-owner-credential": credential,
      },
    });
    sockets.push(ws);
    const first = once(ws, "message");
    await once(ws, "open");
    const frame = JSON.parse(String((await first)[0]));
    assert.equal(frame.accessMode, "open");
    assert.deepEqual(frame.allowedSubjectIds, []);
    assert.equal(frame.expiresAt, expiry);
    const stored = await service.relay.share("native-open");
    assert.equal(stored.project_id, null);
    assert.equal(stored.title, "Open native link");
    const deniedUrl = new URL(url);
    deniedUrl.searchParams.set("shareId", "private-without-intent");
    deniedUrl.searchParams.set("accessMode", "selected");
    const denied = new WebSocket(deniedUrl, {
      headers: {
        authorization: "Bearer " + "g".repeat(32),
        "x-liveshare-owner-credential": credential,
      },
    });
    sockets.push(denied);
    denied.on("error", () => {});
    const status = await new Promise<number | undefined>((resolve) =>
      denied.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode);
      }),
    );
    assert.equal(status, 403);
    await service.store.run(
      "UPDATE live_shares SET expires_at=? WHERE native_id=?",
      Date.now() - 1,
      "native-open",
    );
    await assert.rejects(async () => await service.relay.share("native-open"));
  } finally {
    for (const ws of sockets)
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    detach();
    service.relay.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
