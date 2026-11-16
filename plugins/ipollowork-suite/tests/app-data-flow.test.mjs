/** Real DSH loop and PostgreSQL integration; the service is checked in its own TypeScript program. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import { LlmAdapter, createUserMessage } from "@deepseek-ai/dsh-llm";
import SandboxPolicy from "@deepseek-ai/dsh-sandbox-policy";
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from "@deepseek-ai/dsh-agent-loop-testkit";
import { AccountService } from "../src/host/account.ts";
import { resolveConfig } from "../src/host/config.ts";
import { AppDataService, appDataTool } from "../src/host/app-data.ts";
import { createService } from "../../../services/ipollowork/src/app.ts";
import { CloudProjects } from "../../../services/ipollowork/src/cloud-projects.ts";
import { testConfig } from "../../../services/ipollowork/tests/database.ts";
class DataModel extends LlmAdapter {
  calls = 0;
  async resolveModel(provider, model) {
    return { provider, id: model, name: model };
  }
  async *stream(_options) {
    const steps = [{ define: "notes", fields: { title: "text" }, strict: true }, { insert: "notes", values: { title: "Saved by the official Agent loop" } }, { find: "notes" }];
    const statement = steps[this.calls++];
    if (statement) {
      yield { type: "block-start", index: 0, blockType: "tool-call" };
      yield { type: "block-end", index: 0, block: { type: "tool-call", id: brandString("data-" + this.calls), name: "app_data", arguments: JSON.stringify({ app: "Project application", kind: "site", statement }) } };
      yield { type: "finish", reason: { kind: "tool-calls" } };
    } else {
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "block-end", index: 0, block: { type: "text", text: "Application data saved and read back." } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  }
}
for (const cloudMode of [false, true]) test(`official Agent saves and reads app data through ${cloudMode ? "cloud project" : "local account"} authorization`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-agent-data-"));
  const config = await testConfig({ DATA_DIR: dir, SERVICE_ORIGIN: "http://localhost:4785" });
  const service = await createService(config);
  const ctx = new Context();
  const previous = process.env.IPW_DATA_FLOW_TOKEN;
  try {
    const signup = await service.auth.api.signUpEmail({ body: { email: "flow@example.test", name: "Flow", password: "Flow-password-2026!" } });
    let token = signup.token;
    if (cloudMode) {
      await service.settings.set("cloud", { enabled: "true", gatewayOrigin: "https://gateway.test", gatewayKey: "x".repeat(32) });
      const projectId = randomUUID();
      await service.store.run("INSERT INTO projects(id,owner_id,title,created_at,execution_mode) VALUES(?,?,?,?,'cloud')", projectId, signup.user.id, "Cloud project", Date.now());
      let ticket = "";
      const cloud = new CloudProjects(service.store, service.settings, config, async (_url, init) => {
        ticket = JSON.parse(String(init?.body)).ticket;
        return Response.json({ url: "https://cloud.test/?token=owner" });
      });
      const actor = { id: signup.user.id, name: "Flow", email: "flow@example.test", role: "user" };
      await cloud.open(actor, projectId);
      const grant = await cloud.authenticate(ticket);
      token = (await cloud.claim(actor, grant.grant, randomUUID())).runtimeToken;
    }
    process.env.IPW_DATA_FLOW_TOKEN = token;
    const transport = async (url, init) => service.app.request(String(url), init);
    const account = new AccountService({ readRecord: async () => ({ kind: "grant", payload: { version: 1, origin: config.origin, token } }), modifyRecord: async () => void 0, deleteRecord: async () => {
    } }, resolveConfig({ accountOrigin: config.origin, ...cloudMode ? { cloudRuntimeTokenEnv: "IPW_DATA_FLOW_TOKEN" } : {} }), new AbortController().signal, transport);
    const data = new AppDataService(account);
    await mountAgentLoopTestDependencies(ctx);
    await ctx.plugin(SandboxPolicy, { mode: "workspace-write" });
    const model = new DataModel();
    ctx.llm.registerAdapter(["fixture"], model);
    const harness = await mountAgentLoopTestHarness(ctx);
    const agent = await harness.create(brandString("app-data-flow"), { provider: "fixture", model: "fixture" });
    const owner = ctx.plugin({ inject: ["tools", "sandboxPolicy"], apply(scope) {
      scope.effect(() => scope.tools.register(appDataTool(data, () => "Project application", (session) => scope.sandboxPolicy.resolve({ session }).mode === "read-only")));
    } });
    await owner;
    agent.followup(createUserMessage({ content: [{ type: "text", text: "Create an application record and read it back" }], source: { kind: "user" } }));
    await agent.whenIdle();
    const results = agent.session.snapshotEvents().filter((event) => event.type === "tool/result");
    assert.equal(results.length, 3);
    assert(results.every((event) => event.type === "tool/result" && !event.data.message.isError), JSON.stringify(results));
    assert.equal(model.calls, 4);
    const records = await service.appData.data.all("SELECT data::text AS data FROM data_records WHERE deleted_at IS NULL");
    assert.equal(records.length, 1);
    assert(String(records[0].data).includes("Saved by the official Agent loop"));
    assert(!JSON.stringify(agent.session.snapshotEvents()).includes(token));
    const app = await service.appData.data.one("SELECT project_id FROM data_apps WHERE deleted_at IS NULL");
    assert.equal(Boolean(app?.project_id), cloudMode);
  } finally {
    await ctx.fiber.dispose();
    await service.close();
    await rm(dir, { recursive: true, force: true });
    if (previous === void 0) delete process.env.IPW_DATA_FLOW_TOKEN;
    else process.env.IPW_DATA_FLOW_TOKEN = previous;
  }
});
