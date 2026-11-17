import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/app.js";
import { testConfig } from "./database.js";

test("link invitation lifecycle: register without mail, accept and enforce isolation", async () => {
  const messages: { to: string; template: string; url: string }[] = [];
  let mailStatus = 200;
  const mailbox = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-mail-token");
    let body = "";
    for await (const chunk of req) body += chunk;
    messages.push(JSON.parse(body));
    res.writeHead(mailStatus).end();
  });
  await new Promise<void>(resolve => mailbox.listen(0, "127.0.0.1", resolve));
  const address = mailbox.address();
  assert.ok(address && typeof address === "object");
  const dir = await mkdtemp(join(tmpdir(), "ipw-mail-"));
  const config = await testConfig({ DATA_DIR: dir, SERVICE_ORIGIN: "http://localhost:4785", MAIL_WEBHOOK_URL: `http://127.0.0.1:${address.port}/mail`, MAIL_WEBHOOK_TOKEN: "test-mail-token" });
  const service = await createService(config);
  let counter = 0;
  const request = async (path: string, token?: string, body?: unknown, method?: string) => {
    const response = await service.app.request(new URL(path, config.origin).href, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { Origin: config.origin, "Content-Type": "application/json", "x-ipollo-peer-ip": `192.0.2.${++counter}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, data: text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null };
  };
  const signup = async (email: string, callbackURL = config.origin + "/") => {
    const result = await request("/api/auth/sign-up/email", undefined, { name: email, email, password: "Long-Test-Password-2026", callbackURL });
    assert.equal(result.status, 200);
    return result.data as { token: string; user: { id: string } };
  };
  try {
    const owner = await signup("owner@mail.test");
    const duplicate = await request("/api/auth/sign-up/email", undefined, { name: "Duplicate", email: "OWNER@mail.test", password: "Long-Test-Password-2026" });
    assert.equal(duplicate.status, 422);
    assert.equal(duplicate.data.code, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");
    const rejected = await request("/api/auth/sign-in/email", undefined, { email: "owner@mail.test", password: "Incorrect-Test-Password" });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.data.code, "INVALID_EMAIL_OR_PASSWORD");
    const org = await request("/api/v1/enterprises", owner.token, { name: "受邀组织" });
    const orgId = org.data.id;
    const other = await request("/api/v1/enterprises", owner.token, { name: "隔离组织" });
    const base = `/api/v1/enterprises/${orgId}`;
    const invitation = await request(base + "/invitations", owner.token, { email: "guest@mail.test" });
    assert.equal(invitation.status, 201);
    assert.equal(invitation.data.delivery, "link");
    assert.equal(messages.length, 0);
    const token = new URL(invitation.data.url).pathname.split("/").pop();
    const preview = await request(`/api/invitations/${token}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.organization, "受邀组织");
    assert.equal(preview.data.email, undefined);
    const guest = await signup("guest@mail.test", invitation.data.url);
    const accept = `/api/v1/invitations/${token}/accept`;
    assert.equal((await request(accept, owner.token, {})).data.code, "INVITATION_EMAIL_MISMATCH");
    const accepts = await Promise.all([request(accept, guest.token, {}), request(accept, guest.token, {})]);
    assert.ok(accepts.every(result => result.status === 200));
    assert.equal((await request(`/api/v1/enterprises/${other.data.id}`, guest.token)).status, 403);
    assert.equal((await request(base + "/invitations", guest.token, { email: "third@mail.test", role: "admin" })).status, 403);
    const listed = await request("/api/v1/enterprises", guest.token);
    assert.deepEqual(listed.data.items.map((item: { id: string }) => item.id), [orgId]);
    const space = await request("/api/v1/projects", owner.token, { title: "Only invited", enterpriseId: orgId });
    const hidden = await request("/api/v1/projects", owner.token, { title: "Hidden space", enterpriseId: orgId });
    for (const project of [space, hidden])
      assert.equal((await request(`/api/v1/projects/${project.data.id}/access`, owner.token, { mode: "selected", grants: [] }, "PUT")).status, 200);
    const spaceInvite = await request(base + "/invitations", owner.token, { email: "guest@mail.test", projectId: space.data.id, projectRole: "view" });
    assert.equal(spaceInvite.status, 201);
    assert.equal((await request(`/api/v1/invitations/${new URL(spaceInvite.data.url).pathname.split('/').pop()}/accept`, guest.token, {})).status, 200);
    assert.equal((await request(`/api/v1/projects/${space.data.id}/space`, guest.token)).data.project.role, "view");
    assert.equal((await request(`/api/v1/projects/${hidden.data.id}/space`, guest.token)).status, 403);
    assert.equal((await request(`/api/v1/projects/${space.data.id}/access`, guest.token, { mode: "enterprise", grants: [] }, "PUT")).status, 403);
    assert.equal((await request(base + "/invitations", owner.token, { email: "guest@mail.test", projectId: space.data.id, role: "admin" })).status, 400);
    const constraints = await service.store.all("SELECT conname FROM pg_constraint WHERE conrelid='invitations'::regclass");
    assert.ok(constraints.some(row => row.conname === "invitation_project_role"));
    const revoke = await request(base + "/invitations", owner.token, { email: "guest@mail.test" });
    await request(base + `/invitations/${revoke.data.id}`, owner.token, undefined, "DELETE");
    assert.equal((await request(`/api/v1/invitations/${new URL(revoke.data.url).pathname.split('/').pop()}/accept`, guest.token, {})).status, 404);
    const expired = await request(base + "/invitations", owner.token, { email: "guest@mail.test" });
    await service.store.run("UPDATE invitations SET expires_at=0 WHERE id=?", expired.data.id);
    assert.equal((await request(`/api/invitations/${new URL(expired.data.url).pathname.split('/').pop()}`)).status, 404);
    await request(base + `/members/${guest.user.id}`, owner.token, undefined, "DELETE");
    assert.equal((await request(base, guest.token)).status, 403);
    // Replaying an accepted invitation must not restore revoked membership.
    assert.equal((await request(accept, guest.token, {})).status, 409);
    assert.equal((await request(base, guest.token)).status, 403);
    assert.equal(messages.length, 0, "Registration and invitations must not send mail");
    const reset = await request("/api/auth/request-password-reset", undefined, { email: "guest@mail.test", redirectTo: config.origin + "/reset-password" });
    assert.equal(reset.status, 200);
    const resetMail = messages.findLast(m => m.template === "reset-password");
    assert.ok(resetMail);
    const resetToken = new URL(resetMail.url).pathname.split('/').pop();
    assert.equal((await request("/api/auth/reset-password", undefined, { token: resetToken, newPassword: "Changed-Test-Password-2026" })).status, 200);
    assert.equal((await request("/api/auth/sign-in/email", undefined, { email: "guest@mail.test", password: "Changed-Test-Password-2026" })).status, 200);
    mailStatus = 502;
    const stalled = await service.app.request(config.origin + "/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "guest@mail.test", redirectTo: config.origin + "/reset-password" }),
    });
    assert.equal(stalled.status, 503);
    assert.equal((await stalled.json()).code, "MAIL_DELIVERY_FAILED");
  } finally {
    await service.close();
    await new Promise<void>((resolve, reject) => mailbox.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
