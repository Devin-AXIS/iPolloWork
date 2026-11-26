import test from "node:test";
import { ReasoningEffortId, ToolCallId, createAssistantMessage, createToolResultMessage } from "@deepseek-ai/dsh-llm";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { agentEvents, type Agent } from "@deepseek-ai/dsh-agent";
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
  let catalogModel = "model";
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
                id: catalogModel,
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
    const admitStep = (provider: string, model = "model") => agentEvents(ctx, {} as Agent).waterfall(
      "agent/pre-step",
      { modelSelection: { provider, model }, messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => {
        assert(ctx.llm.listProviders().some(item => item.id === provider));
        return Promise.resolve({ kind: "enter", messages: [] });
      },
    );
    assert.equal(ctx.llm.listProviders().length, 0);
    const startup = refresh();
    const admitted = admitStep("ipollo-chat");
    await assert.rejects(startup, /Default selection temporarily unavailable/);
    assert.equal((await admitted).kind, "enter");
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
    await assert.rejects(admitStep("ipollo-chat"), { code: "IPW_OFFICIAL_MODEL_SOURCE_CHANGED" });
    await center.choose("bailian", { source: "official", serviceId: "chat" });
    assert.equal((await admitStep("ipollo-chat")).kind, "enter");
    assert.equal(ctx.llm.listProviders().length, 1);
    catalogModel = "replacement";
    await refresh();
    await assert.rejects(admitStep("ipollo-chat"), { code: "IPW_OFFICIAL_MODEL_UNAVAILABLE" });
    catalogModel = "model";
    assert.equal((await admitStep("ipollo-chat")).kind, "enter");
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
  let proxyAuthorization: string | undefined;
  let rejection: { code: string; upstreamStatus?: number } = { code: "INSUFFICIENT_POINTS" };
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
      return Response.json({ ...rejection, error: "private upstream diagnostics" }, { status: rejection.upstreamStatus ? 503 : 409 });
    });
  const center = new Services(account, credentials, new AbortController().signal);
  let refresh = async () => {};
  await ctx.plugin({ inject: ["llm", "webServer"], apply(scope: Context) {
    refresh = mountServiceModels(scope, {
      getOrigin: () => scope.webServer.getOrigin(),
      register: route => scope.webServer.register({
        ...route,
        handler(request, response) {
          proxyAuthorization ??= request.headers.authorization;
          return route.handler(request, response);
        },
      }),
    }, center, account);
  } });
  try {
    await refresh();
    const url = ctx.webServer.getOrigin() + "/ipollo-service-models/chat/v1/chat/completions";
    const denied = await fetch(url, { method: "POST", body: "{}" });
    assert.equal(denied.status, 401);
    assert.equal(calls, 0);
    const chunks = [];
    for await (const chunk of ctx.llm.stream({ provider: "ipollo-chat", model: "test-model", messages: [] })) chunks.push(chunk);
    const finish = chunks.find(chunk => chunk.type === "finish");
    assert.equal(finish?.reason.kind, "error");
    if (finish?.reason.kind === "error") assert.equal(finish.reason.failure.code, "ACCOUNT_QUOTA");
    assert.equal(calls, 1);
    assert(proxyAuthorization);
    const oversized = await fetch(url, {
      method: "POST",
      headers: { Authorization: proxyAuthorization },
      body: new Uint8Array(16 * 1024 * 1024 + 1),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "IPW_MODEL_REQUEST_TOO_LARGE");
    assert.equal(calls, 1);

    rejection = { code: "SERVICE_UPSTREAM_REJECTED", upstreamStatus: 401 };
    const rejected = [];
    for await (const chunk of ctx.llm.stream({ provider: "ipollo-chat", model: "test-model", messages: [] })) rejected.push(chunk);
    const failed = rejected.find(chunk => chunk.type === "finish");
    if (failed?.reason.kind !== "error") assert.fail("Expected a model rejection");
    assert.equal(failed.reason.failure.code, "SERVICE_UPSTREAM_REJECTED");
    const diagnostic = JSON.parse(failed.reason.failure.message);
    assert.match(diagnostic.requestId, /^[\da-f-]{36}$/);
    assert.equal(diagnostic.upstreamStatus, 401);
    assert.doesNotMatch(failed.reason.failure.message, /private upstream diagnostics|account-secret/);
    assert.equal(calls, 2);
  } finally { await ctx.fiber.dispose(); }
});

test("the native model stream recovers gateway and midstream interruptions using one invocation id", async () => {
  const {default:WebServer}=await import("@deepseek-ai/dsh-host-webserver");
  const ctx=new Context();
  await ctx.plugin(WebServer,{host:"127.0.0.1",port:0});
  await ctx.plugin(LlmRuntime);
  const ids:string[]=[];
  let interrupted = false;
  let uncertain = false;
  const credentials:CredentialStore={readRecord:async key=>key==="ipollowork-suite/account"?{kind:"grant",payload:{version:1,origin:"https://accounts.test",token:"test-account"}}:undefined,modifyRecord:async()=>undefined,deleteRecord:async()=>{}};
  const account=new AccountService(credentials,resolveConfig({accountOrigin:"https://accounts.test"}),new AbortController().signal,async(url,init)=>{
    if(String(url).endsWith("/services"))return Response.json({items:[{id:"chat",title:"Chat",provider:"fixture",capabilities:["chat"],origin:"https://provider.test",basePath:"/v1",available:true,routes:[],models:[{id:"fixture",name:"Fixture",contextWindow:32768,maxTokens:2048}]}],points:10});
    const input = JSON.parse(String(init?.body));
    ids.push(input.requestId);
    if(ids.length===1)throw new TypeError("fetch failed");
    if(ids.length===2)return new Response('<html>Bad gateway</html>',{status:502});
    if(ids.length===3)return Response.json({code:"SERVICE_DRAINING"},{status:503});
    if(ids.length===4)return Response.json({code:"SERVICE_CALL_RUNNING"},{status:409});
    const first = 'data: '+JSON.stringify({id:"fixture",object:"chat.completion.chunk",created:1,model:"fixture",choices:[{index:0,delta:{role:"assistant",content:"Recovered"},finish_reason:null}]})+'\n\n';
    const rest = 'data: '+JSON.stringify({id:"fixture",object:"chat.completion.chunk",created:1,model:"fixture",choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n';
    const headers = { "content-type": "text/event-stream", "x-ipollo-call-id": input.requestId };
    if (ids.length === (uncertain ? 7 : 5)) {
      assert.equal(input.replayOnly, undefined);
      return new Response(new ReadableStream({ pull(controller) {
        if (interrupted) controller.error(new TypeError("terminated"));
        else {
          interrupted = true;
          controller.enqueue(new TextEncoder().encode(first + rest.slice(0, 10)));
        }
      } }), { headers });
    }
    assert.equal(input.replayOnly, true);
    if (uncertain) return Response.json({ code: "SERVICE_CALL_UNKNOWN" }, { status: 409 });
    return new Response(first + rest, { headers });
  });
  let refresh=async()=>{};
  await ctx.plugin({inject:["llm","webServer"],apply(scope:Context){refresh=mountServiceModels(scope,{getOrigin:()=>scope.webServer.getOrigin(),register:route=>scope.webServer.register(route)},new Services(account,credentials,new AbortController().signal),account);}});
  try {
    await refresh();
    const chunks=[];
    for await(const chunk of ctx.llm.stream({provider:"ipollo-chat",model:"fixture",messages:[]}))chunks.push(chunk);
    const finish=chunks.find(chunk=>chunk.type==="finish");
    assert.equal(finish?.reason.kind,"stop");
    assert.equal(chunks.filter(chunk => chunk.type === "text-delta").map(chunk => chunk.text).join(""), "Recovered");
    assert.equal(ids.length,6);
    assert.equal(new Set(ids).size,1);

    uncertain = true;
    interrupted = false;
    const failedChunks = [];
    for await (const chunk of ctx.llm.stream({ provider: "ipollo-chat", model: "fixture", messages: [] })) failedChunks.push(chunk);
    const failed = failedChunks.find(chunk => chunk.type === "finish");
    if (failed?.reason.kind !== "error") assert.fail("Expected an unconfirmed stream to stop");
    assert.equal(failed.reason.failure.code, "SERVICE_CALL_UNKNOWN");
    assert.equal(failed.reason.failure.status, undefined);
    assert.equal(JSON.parse(failed.reason.failure.message).requestId, ids[6]);
    assert.equal(ids.length, 8);
    assert.equal(ids[6], ids[7]);
    assert.notEqual(ids[0], ids[6]);
  } finally {await ctx.fiber.dispose();}
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
