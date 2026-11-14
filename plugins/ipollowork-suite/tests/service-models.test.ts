import test from "node:test";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import { mountServiceModels } from "../src/host/service-models.ts";
import { Services } from "../src/host/services.ts";
import { AccountService } from "../src/host/account.ts";
import { resolveConfig } from "../src/host/config.ts";
import type { CredentialStore } from "../src/shared/types.ts";

test("official models register lazily, retain native providers and withdraw on own-key selection and unload", async () => {
  const ctx = new Context();
  const llm = ctx.plugin(LlmRuntime);
  await llm;
  const records = new Map<string, { kind: string; payload?: unknown }>([
    [
      "ipollowork-suite/account",
      {
        kind: "grant",
        payload: {
          version: 1,
          origin: "https://accounts.test",
          token: "test-account",
        },
      },
    ],
  ]);
  const credentials: CredentialStore = {
    readRecord: async (key) => records.get(key),
    modifyRecord: async (key, update) => {
      const record = await update(records.get(key));
      records.set(key, record);
      return record;
    },
    deleteRecord: async (key) => {
      records.delete(key);
    },
  };
  const account = new AccountService(
    credentials,
    resolveConfig({ accountOrigin: "https://accounts.test" }),
    new AbortController().signal,
    async () =>
      Response.json({
        items: [
          {
            id: "media",
            provider: "bailian",
            title: "Images",
            category: "image",
            capabilities: ["image"],
            origin: "https://vendor.test",
            basePath: "/v1",
            models: [{ id: "image", name: "Image", category: "image" }],
            routes: [],
            available: true,
          },
          {
            id: "chat",
            provider: "bailian",
            title: "Official",
            capabilities: ["chat"],
            origin: "https://vendor.test",
            basePath: "/v1",
            models: [
              {
                id: "model",
                name: "Model",
                contextWindow: 32768,
                maxTokens: 2048,
              },
            ],
            routes: [],
            available: true,
          },
        ],
        points: 10,
      }),
  );
  const center = new Services(
    account,
    credentials,
    new AbortController().signal,
  );
  let refresh = async () => {};
  const fiber = ctx.plugin({
    inject: ["llm"],
    apply(child: Context) {
      refresh = mountServiceModels(
        child,
        { getOrigin: () => "http://127.0.0.1:12345", register: () => () => {} },
        center,
        account,
      );
    },
  });
  await fiber;
  try {
    assert.equal(ctx.llm.listProviders().length, 0);
    await refresh();
    assert.equal(center.modelStatus, "ready");
    assert.deepEqual(
      ctx.llm.listProviders().map((p) => p.id),
      ["ipollo-chat"],
    );
    const models = await ctx.llm.listModels("ipollo-chat");
    assert.equal(models[0]?.id, "model");
    await center.choose("bailian", { source: "own" });
    await refresh();
    assert.equal(ctx.llm.listProviders().length, 0);
    await center.choose("bailian", { source: "official", serviceId: "chat" });
    await refresh();
    assert.equal(ctx.llm.listProviders().length, 1);
  } finally {
    await fiber.dispose();
  }
  assert.equal(ctx.llm.listProviders().length, 0);
  await llm.dispose();
});

test("account model calls use their private token and report insufficient points as account quota", async () => {
  const { default: WebServer } = await import("@deepseek-ai/dsh-host-webserver");
  const ctx = new Context();
  await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 });
  await ctx.plugin(LlmRuntime);
  let calls = 0;
  const credentials: CredentialStore = {
    readRecord: async key => key === "ipollowork-suite/account" ? { kind: "grant", payload: { version: 1, origin: "https://accounts.test", token: "account-secret" } } : undefined,
    modifyRecord: async () => undefined,
    deleteRecord: async () => {},
  };
  const account = new AccountService(credentials, resolveConfig({ accountOrigin: "https://accounts.test" }), new AbortController().signal,
    async url => {
      if (String(url).endsWith("/services")) return Response.json({ items: [{
        id: "chat", title: "Configured channel", provider: "test", capabilities: ["chat"],
        origin: "https://upstream.test", basePath: "/v1", available: true, routes: [],
        models: [{ id: "test-model", name: "Test model", contextWindow: 32768, maxTokens: 2048 }],
      }], points: 0 });
      calls++;
      return Response.json({ code: "INSUFFICIENT_POINTS" }, { status: 409 });
    });
  const center = new Services(account, credentials, new AbortController().signal);
  let refresh = async () => {};
  await ctx.plugin({ inject: ["llm", "webServer"], apply(scope: Context) {
    refresh = mountServiceModels(scope, {
      getOrigin: () => scope.webServer.getOrigin(), register: route => scope.webServer.register(route),
    }, center, account);
  } });
  try {
    await refresh();
    const denied = await fetch(ctx.webServer.getOrigin() + "/ipollo-service-models/chat/v1/chat/completions", { method: "POST", body: "{}" });
    assert.equal(denied.status, 401);
    assert.equal(calls, 0);
    const chunks = [];
    for await (const chunk of ctx.llm.stream({ provider: "ipollo-chat", model: "test-model", messages: [] })) chunks.push(chunk);
    const finish = chunks.find(chunk => chunk.type === "finish");
    assert.equal(finish?.reason.kind, "error");
    if (finish?.reason.kind === "error") assert.equal(finish.reason.failure.code, "ACCOUNT_QUOTA");
    assert.equal(calls, 1);
  } finally { await ctx.fiber.dispose(); }
});

for (const provider of ['deepseek', 'aliyun-bailian']) test(`${provider} retains its native reasoning levels and wire fields`, async () => {
  const { default: WebServer } = await import('@deepseek-ai/dsh-host-webserver');
  const ctx = new Context();
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 });
  await ctx.plugin(LlmRuntime);
  const credentials: CredentialStore = {
    readRecord: async key => key === 'ipollowork-suite/account' ? { kind: 'grant', payload: { version: 1, origin: 'https://accounts.test', token: 'test-account' } } : undefined,
    modifyRecord: async () => undefined, deleteRecord: async () => {},
  };
  let request: Record<string, unknown> | undefined;
  const account = new AccountService(credentials, resolveConfig({ accountOrigin: 'https://accounts.test' }), new AbortController().signal, async (url, init) => {
    if (String(url).endsWith('/services')) return Response.json({ items: [{ id: 'chat', title: 'Chat', provider, capabilities: ['chat'], origin: 'https://upstream.test', basePath: '/v1', available: true, routes: [], models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek', contextWindow: 32768, maxTokens: 2048 }] }], points: 0 });
    const envelope = JSON.parse(String(init?.body));
    request = JSON.parse(Buffer.from(envelope.body, 'base64').toString());
    return Response.json({ code: 'INSUFFICIENT_POINTS' }, { status: 409 });
  });
  let refresh = async () => {};
  await ctx.plugin({ inject: ['llm', 'webServer'], apply(scope: Context) {
    refresh = mountServiceModels(scope, { getOrigin: () => scope.webServer.getOrigin(), register: route => scope.webServer.register(route) }, new Services(account, credentials, new AbortController().signal), account);
  } });
  try {
    await refresh();
    const model = await ctx.llm.resolveModelInfo('ipollo-chat', 'deepseek-v4-pro');
    assert.deepEqual(model.reasoning?.efforts.map(entry => entry.id), provider === 'deepseek' ? ['off', 'high', 'max'] : ['high', 'max']);
    assert.equal(model.context?.contextWindow, 32768);
    for await (const _chunk of ctx.llm.stream({ provider: 'ipollo-chat', model: 'deepseek-v4-pro', messages: [], reasoningEffort: ReasoningEffortId('max') })) { /* Drain the gateway response to capture its request. */ }
    assert.equal(request?.reasoning_effort, 'max');
    if (provider === 'deepseek') assert.deepEqual(request?.thinking, { type: 'enabled' });
    else assert.equal(request?.enable_thinking, true);
    const failures = [];
    for await (const chunk of ctx.llm.stream({ provider: 'ipollo-chat', model: 'deepseek-v4-pro', messages: [], reasoningEffort: ReasoningEffortId('medium') })) failures.push(chunk);
    const failure = failures.find(chunk => chunk.type === 'finish');
    assert.equal(failure?.reason.kind, 'error');
    if (failure?.reason.kind === 'error') assert.equal(failure.reason.failure.code, 'UNSUPPORTED_REASONING_EFFORT');
    assert.equal(request?.reasoning_effort, 'max');
  } finally { await ctx.fiber.dispose(); }
});
