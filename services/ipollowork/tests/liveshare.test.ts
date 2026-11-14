import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { createService } from "../src/app.js";
import { testConfig as loadConfig } from "./database.js";

test("native relay binds project permissions, identities, revocation and reconnection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-relay-"));
  const config = await loadConfig({
    DATA_DIR: dir,
    SERVICE_ORIGIN: "http://localhost:4785",
  });
  const service = await createService(config),
    server = createServer(getRequestListener(service.app.fetch));
  const detach = service.relay.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  // HTTP fixtures are decoded per endpoint and their fields are asserted before use.
  let peer = 0;
  const request = async (
    path: string,
    token?: string,
    body?: unknown,
    method?: string,
  ) => {
    const response = await service.app.request(config.origin + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        "Content-Type": "application/json",
        "x-ipollo-peer-ip": "192.0.2." + ++peer,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { response, data: (await response.json()) as Record<string, any> };
  };
  const account = async (name: string) =>
    (
      await request("/api/auth/sign-up/email", undefined, {
        name,
        email: name + "@example.test",
        password: "Relay-test-password-2026",
      })
    ).data;
  const sockets: WebSocket[] = [];
  try {
    const owner = await account("owner"),
      member = await account("member"),
      reader = await account("reader"),
      outsider = await account("outsider");
    const eid = (
      await request("/api/v1/enterprises", owner.token, { name: "Team" })
    ).data.id;
    const did = (
      await request(
        "/api/v1/enterprises/" + eid + "/departments",
        owner.token,
        { name: "Design" },
      )
    ).data.id;
    for (const user of [member, reader])
      await service.store.run(
        "INSERT INTO members VALUES(?,?,?,?,?)",
        eid,
        user.user.id,
        "member",
        user === member ? did : null,
        Date.now(),
      );
    const pid = (
      await request("/api/v1/projects", owner.token, {
        title: "Project",
        enterpriseId: eid,
      })
    ).data.id;
    await request(
      "/api/v1/projects/" + pid + "/access",
      owner.token,
      {
        mode: "selected",
        grants: [
          { kind: "department", subjectId: did, role: "participate" },
          { kind: "member", subjectId: reader.user.id, role: "view" },
        ],
      },
      "PUT",
    );
    const verifier = randomBytes(32).toString("base64url"),
      challenge = createHash("sha256").update(verifier).digest("base64url");
    const code = (
      await request("/api/v1/liveshare/authorize", owner.token, {
        challenge,
        instanceKey: "test-instance",
      })
    ).data.code;
    assert.equal(
      (
        await request("/__liveshare/owner-credential", undefined, {
          code,
          instanceKey: "wrong",
          code_verifier: verifier,
        })
      ).response.status,
      401,
    );
    const credential = (
      await request("/__liveshare/owner-credential", undefined, {
        code,
        instanceKey: "test-instance",
        code_verifier: verifier,
      })
    ).data.credential;
    assert.equal(
      (
        await request("/__liveshare/owner-credential", undefined, {
          code,
          instanceKey: "test-instance",
          code_verifier: verifier,
        })
      ).response.status,
      401,
    );
    assert.equal(
      (
        await request("/api/v1/liveshare/intents", reader.token, {
          projectId: pid,
          sessionId: "source",
          title: "Shared",
          role: "participate",
        })
      ).response.status,
      403,
    );
    const intent = (
      await request("/api/v1/liveshare/intents", owner.token, {
        projectId: pid,
        sessionId: "source",
        title: "Shared",
        role: "participate",
      })
    ).data.intent;
    const url = new URL(base.replace("http:", "ws:") + "/__tunnel_gateway__");
    for (const [key, value] of Object.entries({
      shareId: "native-1",
      sessionId: "source",
      sessionMode: "write",
      protocolVersion: "1",
      allowedSubjectId: intent,
    }))
      url.searchParams.set(key, value);
    const connect = () => {
      const ws = new WebSocket(url, {
        headers: {
          authorization: "Bearer " + "g".repeat(32),
          "x-liveshare-owner-credential": credential,
        },
      });
      sockets.push(ws);
      return ws;
    };
    const ws = connect();
    const frames: Record<string, any>[] = [];
    ws.on("message", (data) => frames.push(JSON.parse(data.toString())));
    await once(ws, "open");
    const eventually = async (check: () => boolean) => {
      for (let i = 0; i < 100 && !check(); i++)
        await new Promise((r) => setTimeout(r, 10));
      assert(check());
    };
    await eventually(() => frames.length > 0);
    assert(
      frames[0]!.allowedSubjectIds.some((id: string) =>
        id.endsWith(member.user.id),
      ),
    );
    assert(
      !frames[0]!.allowedSubjectIds.some((id: string) =>
        id.endsWith(reader.user.id),
      ),
    );
    const rr = await request("/api/v1/liveshare/shares", reader.token);
    assert.equal(rr.response.status, 200, JSON.stringify(rr.data));
    assert.equal(rr.data.shares.length, 0);
    assert.equal(
      (await request("/api/v1/liveshare/shares", member.token)).data.shares
        .length,
      1,
    );
    assert.equal(
      (await request("/api/v1/liveshare/shares", outsider.token)).data.shares
        .length,
      0,
    );
    const session = (await service.store.one(
      'SELECT id FROM session WHERE "userId"=?',
      member.user.id,
    ))!;
    const viewer = service.relay.sign({
      purpose: "viewer",
      sessionId: String(session.id),
      subjectId: member.user.id,
      displayName: "member",
      shareId: "native-1",
      expiresAt: Date.now() + 60000,
    });
    const wrapper = await service.app.request(config.origin + "/s/native-1", {
      headers: { Authorization: "Bearer " + member.token },
    });
    assert.equal(wrapper.status, 200);
    assert(!wrapper.headers.get("content-security-policy")?.includes("'unsafe-eval'"));
    assert.equal(wrapper.headers.get("cross-origin-resource-policy"), "same-origin");
    const framePath = (await wrapper.text()).match(
      /src="(\/__liveshare\/assets\/[^\"]+)"/,
    )?.[1];
    assert(framePath);
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === "share-rpc" && frame.body.op === "asset")
        ws.send(
          JSON.stringify({
            type: "share-rpc-res",
            id: frame.id,
            status: 200,
            body: {
              contentType: "text/html",
              base64: Buffer.from(
                "<html><head></head><body>Native</body></html>",
              ).toString("base64"),
            },
          }),
        );
    });
    for (const path of [framePath, framePath + "plugins/arbitrary.html"]) {
      const document = await service.app.request(config.origin + path);
      assert.equal(document.status, 200);
      assert(
        document.headers
          .get("content-security-policy")
          ?.includes("sandbox allow-scripts"),
      );
      assert(
        !document.headers
          .get("content-security-policy")
          ?.includes("allow-same-origin"),
      );
      assert.equal(document.headers.get("access-control-allow-origin"), "*");
      assert.equal(document.headers.get("cross-origin-resource-policy"), "cross-origin");
      assert(document.headers.get("content-security-policy")?.includes("'unsafe-eval'"));
    }
    frames.length = 0;
    const viewRequest = async (body: unknown) =>
      await request("/__share/rpc?shareId=native-1", viewer, body);
    const result = viewRequest({
      op: "call",
      path: "/api/session/page",
      body: {},
      actor: { subjectId: owner.user.id },
    });
    await eventually(() => frames.some((f) => f.type === "share-rpc"));
    const frame = frames.find((f) => f.type === "share-rpc")!;
    assert.equal(frame.actor.subjectId, member.user.id);
    assert.equal(frame.actor.tenantId, pid);
    ws.send(
      JSON.stringify({
        type: "share-rpc-res",
        id: frame.id,
        status: 200,
        body: { ok: true },
      }),
    );
    assert.equal((await result).data.ok, true);
    const pending = viewRequest({ op: "stream-next", id: 33 });
    await eventually(
      () => frames.filter((f) => f.type === "share-rpc").length === 2,
    );
    await request(
      "/api/v1/enterprises/" + eid + "/members/" + member.user.id,
      owner.token,
      { role: "member", departmentId: null },
      "PATCH",
    );
    assert.equal((await pending).response.status, 403);
    assert.equal(
      (await viewRequest({ op: "call", path: "/api/session/page", body: {} }))
        .response.status,
      403,
    );
    await eventually(() => frames.some((f) => f.type === "share-rpc-cancel"));
    assert.equal(
      (await request("/__liveshare/requests?shareId=native-1", "wrong"))
        .response.status,
      401,
    );
    const snapshot = await request(
      "/__liveshare/requests?shareId=native-1",
      "g".repeat(32),
    );
    assert.equal(snapshot.data.allowedSubjectIds.length, 1);
    assert(snapshot.data.version > 1);
    ws.close();
    await once(ws, "close");
    assert.equal(service.relay.online("native-1"), false);
    const reconnect = connect();
    await once(reconnect, "open");
    assert(service.relay.online("native-1"));
    assert.equal(
      (
        await request(
          "/__liveshare/share?shareId=native-1",
          "g".repeat(32),
          undefined,
          "DELETE",
        )
      ).response.status,
      200,
    );
    await once(reconnect, "close");
    assert.equal(
      (await request("/api/v1/liveshare/shares", owner.token)).data.shares
        .length,
      0,
    );
  } finally {
    for (const ws of sockets) ws.terminate();
    detach();
    service.relay.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
