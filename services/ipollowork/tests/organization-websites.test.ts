import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";

test("only members open approved websites and exchange organization credentials without receiving them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-org-browser-"));
  const config = await testConfig({ DATA_DIR: dir, SERVICE_ORIGIN: "http://localhost:4785" });
  const secret = "synthetic-application-credential";
  const endpoint = "https://business.example.com/internal/tickets";
  let called = 0, upstreamStatus = 200, upstreamTicket = "synthetic-one-use-ticket";
  let expected = {};
  const service = await createService(config, { websiteTicketTransport: async (url, method, headers, body) => {
    called++;
    assert.equal(url.href, endpoint);
    assert.equal(method, "POST");
    assert.equal(headers.authorization, "Bearer " + secret);
    assert.deepEqual(JSON.parse(body!.toString()), expected);
    const response = Readable.from([Buffer.from(JSON.stringify({ ticket: upstreamTicket, expiresIn: 45, internal: secret }))]);
    return Object.assign(response, { statusCode: upstreamStatus }) as IncomingMessage;
  } });
  let count = 0;
  const send = async (path: string, token?: string, body?: unknown, method?: string) => {
    const response = await service.app.request(config.origin + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", Origin: config.origin, "x-ipollo-peer-ip": "192.0.2." + ++count,
        ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const signup = (name: string) => send("/api/auth/sign-up/email", undefined,
    { name, email: name + "@example.com", password: "Synthetic-Test-Password-1" });
  try {
    const owner = (await signup("owner")).data;
    const admin = (await signup("platform")).data;
    const member = (await signup("member")).data;
    await service.store.run('UPDATE "user" SET role=? WHERE id=?', "admin", admin.user.id);
    const organization = (await send("/api/v1/enterprises", owner.token, { name: "Example organization" })).data;
    const organizationId = organization.id;
    const websiteId = randomUUID();
    const base = "/api/v1/enterprises/" + organizationId + "/websites";
    const path = base + "/" + websiteId;
    const item = { id: websiteId, label: "Business site", url: "https://business.example.com/", departmentId: null,
      role: "member", cookieNames: ["__Host-work"] };
    await service.store.run("INSERT INTO members VALUES(?,?,?,NULL,?)", organizationId, member.user.id, "member", Date.now());
    assert.deepEqual((await send("/api/v1/me/organizations", admin.token)).data, { organizations: [] });
    assert.deepEqual((await send("/api/v1/me/organizations", member.token)).data, {
      organizations: [{ id: organizationId, name: "Example organization", role: "member" }],
    });
    assert.equal((await send(base + "/manage", owner.token, { revision: 0, items: [{ ...item, url: "http://business.example.com/" }] }, "PUT")).status, 400);
    assert.equal((await send(base + "/manage", owner.token, { revision: 0, items: [item] }, "PUT")).status, 200);
    assert.equal((await send(path + "/ticket-config", member.token)).status, 403);
    assert.equal((await send(path + "/ticket-config", owner.token, { endpoint, credential: secret }, "PUT")).status, 200);
    assert.deepEqual((await send(path + "/ticket-config", owner.token)).data, { endpoint, configured: true });
    assert.equal((await send(path + "/ticket-config", owner.token, { endpoint }, "PUT")).status, 200);
    assert.equal((await send(path + "/ticket-config", owner.token, { endpoint: endpoint + "/changed" }, "PUT")).status, 400);
    const stored = await service.store.one("SELECT value FROM settings WHERE key=?", "organization-website-ticket/" + organizationId + "/" + websiteId);
    assert.ok(stored && !String(stored.value).includes(secret));
    assert.deepEqual((await send(path + "/desktop", member.token)).data, {
      userId: member.user.id, enterpriseId: organizationId, siteId: websiteId, label: item.label, url: item.url, cookieNames: item.cookieNames,
    });
    assert.equal((await send(path + "/desktop", admin.token)).status, 404);
    assert.equal((await send(path + "/ticket", owner.token, undefined, "POST")).status, 404);
    assert.equal(called, 0);
    expected = { organizationId, websiteId, userId: member.user.id };
    assert.deepEqual((await send(path + "/ticket", member.token, undefined, "POST")).data, { ticket: upstreamTicket, expiresIn: 45 });
    upstreamTicket = secret;
    assert.equal((await send(path + "/ticket", member.token, undefined, "POST")).status, 503);
    upstreamStatus = 302;
    assert.equal((await send(path + "/ticket", member.token, undefined, "POST")).status, 503);
    await service.store.run("UPDATE members SET status='suspended' WHERE enterprise_id=? AND user_id=?", organizationId, member.user.id);
    assert.deepEqual((await send("/api/v1/me/organizations", member.token)).data, { organizations: [] });
    assert.equal((await send(path + "/ticket", member.token, undefined, "POST")).status, 403);
    assert.equal((await send(base + "/manage", owner.token, { revision: 1, items: [] }, "PUT")).status, 200);
    assert.equal((await send(path + "/ticket-config", owner.token)).data.configured, false);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
