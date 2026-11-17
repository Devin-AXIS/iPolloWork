import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/app.js";
import { tokenUsage } from "../src/enterprise-analytics.js";
import { testConfig } from "./database.js";

test("token reporting accepts JSON and SSE but never guesses missing or invalid counts", () => {
  assert.deepEqual(tokenUsage(Buffer.from('{"usage":{"prompt_tokens":10,"completion_tokens":3}}'), "application/json"), { input: 10, output: 3 });
  assert.deepEqual(tokenUsage(Buffer.from('data: {"usage":{"input_tokens":8,"output_tokens":2}}\n\ndata: [DONE]\n'), "text/event-stream"), { input: 8, output: 2 });
  for (const body of ['bad', '{}', '{"usage":{"total_tokens":10}}', '{"usage":{"input_tokens":-1,"output_tokens":2}}'])
    assert.equal(tokenUsage(Buffer.from(body), "application/json"), null);
});

test("enterprise analytics isolates tenants, freezes department attribution and bounds grouping pages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-analytics-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    for (const id of ["owner", "member", "other"]) {
      await service.store.run('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",role) VALUES(?,?,?,true,now(),now(),?)', id, id, id + "@analytics.test", "user");
    }
    const now = Date.now();
    await service.store.run("INSERT INTO enterprises VALUES('e','Enterprise','owner',?),('foreign','Foreign','other',?)", now, now);
    await service.store.run("INSERT INTO departments VALUES('old','e','Original department'),('new','e','New department')");
    await service.store.run("INSERT INTO members VALUES('e','owner','owner',NULL,?),('e','member','member','new',?),('foreign','other','owner',NULL,?)", now, now, now);
    await service.store.run("INSERT INTO execution_services(id,title,provider,base_url,key_id,header_name,header_prefix,capabilities,routes,plan_ids,enabled,created_at) VALUES('svc','Shared model','test','https://example.test','key','Authorization','Bearer','[]','[]','[]',1,?)", now);
    for (let i = 0; i < 27; i++) await service.store.run("INSERT INTO service_calls(id,user_id,service_id,request_hash,state,points,created_at,updated_at,enterprise_id,department_id,model_id,input_tokens,output_tokens) VALUES(?,'member','svc',?,'succeeded',2,?,?,'e','old',?,10,3)", "c" + i, "h" + i, now, now, "model-" + i);
    await service.store.run("INSERT INTO service_calls(id,user_id,service_id,request_hash,state,points,created_at,updated_at,enterprise_id,is_job_poll) VALUES('poll','member','svc','poll','succeeded',0,?,?,'e',true),('personal','member','svc','personal','succeeded',99,?,?,NULL,false),('foreign','other','svc','foreign','succeeded',99,?,?,'foreign',false)", now, now, now, now, now, now);
    // Test the real authorization and JSON validation handlers with authenticated actors.
    const { Hono } = await import("hono");
    const { mountEnterpriseAnalytics } = await import("../src/enterprise-analytics.js");
    const { ServiceError } = await import("../src/errors.js");
    const { ZodError } = await import("zod");
    const app = new Hono<{ Variables: { actor: import("../src/auth.js").Actor } }>();
    app.use("*", async (c, next) => { c.set("actor", { id: c.req.header("x-user") ?? "owner", role: "user", name: "Fixture", email: "fixture@analytics.test" }); await next(); });
    app.onError((error, c) => c.json({ error: error.message }, error instanceof ServiceError ? error.status : error instanceof ZodError ? 400 : 500));
    mountEnterpriseAnalytics(app, service.store);
    const request = (body: unknown, user = "owner", tenant = "e") => app.request("http://localhost/api/v1/enterprises/" + tenant + "/analytics", { method: "POST", headers: { "Content-Type": "application/json", "x-user": user }, body: JSON.stringify(body) });
    await service.store.run("INSERT INTO projects(id,owner_id,enterprise_id,title,created_at) VALUES('project','owner','e','Project',?)", now);
    const activity = (user = "member", body: unknown = { sessionId: "session", callId: "call", kind: "skill", name: "research", succeeded: true }) => app.request("http://localhost/api/v1/projects/project/activity", { method: "POST", headers: { "Content-Type": "application/json", "x-user": user }, body: JSON.stringify(body) });
    assert.equal((await activity()).status, 200);
    assert.equal((await activity()).status, 200);
    assert.equal((await activity("other")).status, 403);
    assert.equal((await activity("member", { sessionId: "s", callId: "c", kind: "sql", name: "x", succeeded: true })).status, 400);
    const response = await request({ days: 30, groupBy: "department", page: 1 });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.totals.tasks, 27);
    assert.equal(data.totals.inputTokens, 270);
    assert.equal(data.totals.points, 54);
    assert.equal(data.rows[0].name, "Original department");
    assert.equal(data.skillInvocations, 1);
    assert.equal(data.activityRows[0].name, "New department");
    assert.equal(data.activityRows[0].calls, 1);
    assert.equal(data.pluginInvocations, 0);
    const skus = await (await request({ days: 30, groupBy: "sku", page: 2 })).json();
    assert.equal(skus.totalRows, 27);
    assert.equal(skus.rows.length, 2);
    assert.equal((await request({ days: 30, groupBy: "member", page: 1 }, "member")).status, 403);
    assert.equal((await request({}, "owner", "foreign")).status, 403);
    assert.equal((await request({ days: 365 })).status, 400);
    assert.equal((await request({ groupBy: "injection" })).status, 400);
    assert.equal((await request({ page: 0 })).status, 400);
    const indexes = await service.store.all("SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname='service_calls_enterprise_time'");
    assert.equal(indexes.length, 1);
    assert.equal((await service.store.one("SELECT MAX(version) AS version FROM service_schema"))?.version, 17);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});
