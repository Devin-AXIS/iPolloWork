import test from "node:test";
import { ReasoningEffortId, ToolCallId, createAssistantMessage, createToolResultMessage } from "@deepseek-ai/dsh-llm";
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
                inputModalities: ["text", "image"],
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
  let defaultAttempts = 0;
  const fiber = ctx.plugin({
    inject: ["llm"],
    apply(child: Context) {
      refresh = mountServiceModels(
        child,
        { getOrigin: () => "http://127.0.0.1:12345", register: () => () => {} },
        center,
        account,
        async () => {
          if (++defaultAttempts === 1) throw new Error("Default selection temporarily unavailable");
        },
      );
    },
  });
  await fiber;
  try {
    assert.equal(ctx.llm.listProviders().length, 0);
    await assert.rejects(refresh(), /Default selection temporarily unavailable/);
    assert.equal(center.modelStatus, "error");
    assert.equal(ctx.llm.listProviders().length, 1);
    await refresh();
    assert.equal(center.modelStatus, "ready");
    assert.equal(center.modelError, "");
    assert.equal(defaultAttempts, 2);
    assert.deepEqual(
      ctx.llm.listProviders().map((p) => p.id),
      ["ipollo-chat"],
    );
    const models = await ctx.llm.listModels("ipollo-chat");
    assert.equal(models[0]?.id, "model");
    assert.deepEqual(models[0]?.inputModalities, ["text", "image"]);
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

for (const [provider, id] of [['deepseek', 'deepseek-v4-pro'], ['aliyun-bailian', 'deepseek-v4-pro'], ['aliyun-bailian', 'qwen3.7-plus']]) test(`${provider}/${id} retains its native reasoning levels and wire fields`, async () => {
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
    if (String(url).endsWith('/services')) return Response.json({ items: [{ id: 'chat', title: 'Chat', provider, capabilities: ['chat'], origin: 'https://upstream.test', basePath: '/v1', available: true, routes: [], models: [{ id, name: id, contextWindow: 32768, maxTokens: 2048 }] }], points: 0 });
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
    const model = await ctx.llm.resolveModelInfo('ipollo-chat', id!);
    assert.deepEqual(model.reasoning?.efforts.map(entry => entry.id), id === 'qwen3.7-plus' ? ['off', 'high'] : provider === 'deepseek' ? ['off', 'high', 'max'] : ['high', 'max']);
    assert.equal(model.context?.contextWindow, 32768);
    const effort = id === 'qwen3.7-plus' ? 'high' : 'max';
    for await (const _chunk of ctx.llm.stream({ provider: 'ipollo-chat', model: id!, messages: [], reasoningEffort: ReasoningEffortId(effort) })) { /* Drain the gateway response to capture its request. */ }
    assert.equal(request?.reasoning_effort, id === 'qwen3.7-plus' ? undefined : 'max');
    if (provider === 'deepseek') assert.deepEqual(request?.thinking, { type: 'enabled' });
    else assert.equal(request?.enable_thinking, true);
    const failures = [];
    for await (const chunk of ctx.llm.stream({ provider: 'ipollo-chat', model: id!, messages: [], reasoningEffort: ReasoningEffortId('medium') })) failures.push(chunk);
    const failure = failures.find(chunk => chunk.type === 'finish');
    assert.equal(failure?.reason.kind, 'error');
    if (failure?.reason.kind === 'error') assert.equal(failure.reason.failure.code, 'UNSUPPORTED_REASONING_EFFORT');
    assert.equal(request?.reasoning_effort, id === 'qwen3.7-plus' ? undefined : 'max');
  } finally { await ctx.fiber.dispose(); }
});

test('cloud source choices reject personal keys before storing credentials',async()=>{
 const config=resolveConfig({accountOrigin:'https://account.test',cloudRuntimeTokenEnv:'TEST_CLOUD_TOKEN'});
 let writes=0;const credentials:CredentialStore={readRecord:async()=>({kind:'grant',payload:{test:{source:'own'}}}),modifyRecord:async()=>{writes++;return {kind:'grant',payload:{}}},deleteRecord:async()=>{}};
 const account=new AccountService(credentials,config,new AbortController().signal);
 const services=new Services(account,credentials,new AbortController().signal);
 assert.deepEqual(await services.choices(),{});
 await assert.rejects(services.choose('deepseek',{source:'own'}),{code:'IPW_CLOUD_MODEL_FORBIDDEN'});
 assert.equal(writes,0);
});

test('official vision models read durable images through attachments mounted after adapter registration', async () => {
  const { default: WebServer } = await import('@deepseek-ai/dsh-host-webserver');
  const { LocalAttachmentStore } = await import('@deepseek-ai/dsh-attachment-local');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'ipw-vision-'));
  const ctx = new Context();
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 });
  await ctx.plugin(LlmRuntime);
  const credentials: CredentialStore = {
    readRecord: async key => key === 'ipollowork-suite/account' ? { kind: 'grant', payload: { version: 1, origin: 'https://accounts.test', token: 'test-account' } } : undefined,
    modifyRecord: async () => undefined, deleteRecord: async () => {},
  };
  const captured: { payload?: { messages: { content: unknown }[] } } = {};
  const account = new AccountService(credentials, resolveConfig({ accountOrigin: 'https://accounts.test' }), new AbortController().signal, async (url, init) => {
    if (String(url).endsWith('/services')) return Response.json({ items: [{ id: 'vision', title: 'Vision', provider: 'test', capabilities: ['chat'], origin: 'https://upstream.test', basePath: '/v1', available: true, routes: [], models: [{ id: 'vision-model', name: 'Vision', contextWindow: 32768, maxTokens: 2048, inputModalities: ['text','image'] }] }], points: 10 });
    const envelope = JSON.parse(String(init?.body));
    captured.payload = JSON.parse(Buffer.from(envelope.body, 'base64').toString());
    return new Response('data: '+JSON.stringify({id:'vision-test',object:'chat.completion.chunk',created:1,model:'vision-model',choices:[{index:0,delta:{role:'assistant',content:'I can see the screenshot.'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'vision-test',object:'chat.completion.chunk',created:1,model:'vision-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:6,total_tokens:18}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  });
  let refresh = async () => {};
  await ctx.plugin({ inject: ['llm', 'webServer'], apply(scope: Context) {
    refresh = mountServiceModels(scope, {getOrigin:()=>scope.webServer.getOrigin(),register:route=>scope.webServer.register(route)},new Services(account,credentials,new AbortController().signal),account);
  }});
  try {
    await refresh();
    const attachments = new LocalAttachmentStore(ctx, { dshHome: home });
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC','base64');
    const ref = await attachments.saveImage({data:bytes,mediaType:'image/png'});
    ctx.set('attachments',attachments);
    const messages = [{role:'user' as const,content:[{type:'text' as const,text:'Inspect this screenshot'},{type:'image' as const,attachment:ref}]}];
    const toolMessages = [
      {role:'user' as const,content:[{type:'text' as const,text:'Inspect the generated page'}]},
      createAssistantMessage({source:{provider:'ipollo-vision',model:'vision-model'},content:[{type:'tool-call',id:ToolCallId('screenshot-call'),name:'read_image',arguments:'{}'}]}),
      createToolResultMessage({callId:ToolCallId('screenshot-call'),isError:false,content:[{type:'image',attachment:ref}]}),
    ];
    for (const prepared of [false,true]) for (const history of [messages,toolMessages]) {

      const chunks=[];
      const options={provider:'ipollo-vision',model:'vision-model',messages:history};
      const stream=prepared?(await ctx.llm.prepareCall({provider:'ipollo-vision',model:'vision-model'})).stream(options):ctx.llm.stream(options);
      for await (const chunk of stream) chunks.push(chunk);
      const finish=chunks.find(chunk=>chunk.type==='finish');
      assert.equal(finish?.reason.kind,'stop',JSON.stringify(finish));
      assert.ok(JSON.stringify(captured.payload?.messages).includes('data:image/png;base64,'));
      assert.ok(!JSON.stringify(captured.payload).includes(home),'host paths must not be sent as image URLs');
    }
  } finally { await ctx.fiber.dispose(); await rm(home,{recursive:true,force:true}); }
});
