import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const hostToolsUrl = new URL("../dsh-runtime/ipollowork-host-tools.mjs", import.meta.url);
const piAiUrl = new URL("../dsh-runtime/node_modules/@earendil-works/pi-ai/dist/index.js", import.meta.url);
const runtimePrepared = existsSync(fileURLToPath(piAiUrl));

async function loadRuntimeModules() {
  const [hostTools, piAi] = await Promise.all([
    import(hostToolsUrl.href),
    import(piAiUrl.href),
  ]);
  return { ...hostTools, ...piAi };
}

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  url: process.env.IPOLLOWORK_SERVER_URL,
  token: process.env.IPOLLOWORK_SERVER_TOKEN,
  workspaceId: process.env.IPOLLOWORK_WORKSPACE_ID,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of [
    ["IPOLLOWORK_SERVER_URL", originalEnvironment.url],
    ["IPOLLOWORK_SERVER_TOKEN", originalEnvironment.token],
    ["IPOLLOWORK_WORKSPACE_ID", originalEnvironment.workspaceId],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("registers the engine-neutral catalog and forwards DSH session context", { skip: !runtimePrepared }, async () => {
  const { apply, OPENAI_CODEX_PRIORITY_PROVIDER_ID } = await loadRuntimeModules();
  process.env.IPOLLOWORK_SERVER_URL = "http://ipollowork.test";
  process.env.IPOLLOWORK_SERVER_TOKEN = "secret-token";
  process.env.IPOLLOWORK_WORKSPACE_ID = "ws_dsh";
  const requests = [];
  const scheduleDescription = "Prepare a preview, ask exactly: 是否需要生成计划并加入 iPolloWork 日程？ When directly requested, treat that request as agreement to schedule.";
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/engine-tools")) {
      return Response.json({
        tools: [
          {
            name: "ipollowork_extension_list_actions",
            description: "List extension actions",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
          {
            name: "ipollowork_project_read",
            description: "Read the current project",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
          {
            name: "ipollowork_schedule_preview",
            description: scheduleDescription,
            parameters: {
              type: "object",
              properties: { tasks: { type: "array" } },
              required: ["tasks"],
              additionalProperties: false,
            },
          },
          {
            name: "ipollowork_schedule_apply",
            description: "Apply a confirmed schedule preview",
            parameters: {
              type: "object",
              properties: { previewId: { type: "string" } },
              required: ["previewId"],
              additionalProperties: false,
            },
          },
        ],
      });
    }
    return Response.json({ ok: true, actions: [] });
  };

  /** @type {any[]} */
  const registered = [];
  /** @type {any} */
  let priorityAdapter;
  /** @type {any} */
  let systemSection;
  const ctx = {
    credentials: {
      async resolve() {
        return { value: "codex-access-token", source: "test" };
      },
    },
    llm: {
      registerAdapter(routes, adapter) {
        assert.deepEqual(routes, [OPENAI_CODEX_PRIORITY_PROVIDER_ID]);
        priorityAdapter = adapter;
        return () => undefined;
      },
    },
    tools: {
      register(definition) {
        registered.push(definition);
        return () => undefined;
      },
    },
    systemPrompt: {
      section(section) {
        systemSection = section;
        return () => undefined;
      },
    },
    effect(factory) {
      return factory();
    },
    get() {
      return undefined;
    },
  };
  await apply(ctx);
  if (!priorityAdapter) throw new Error("DSH priority model adapter was not registered");
  assert.deepEqual(
    (await priorityAdapter.listModels(OPENAI_CODEX_PRIORITY_PROVIDER_ID)).map((model) => model.id),
    [
      "gpt-5.4-fast",
      "gpt-5.4-mini-fast",
      "gpt-5.5-fast",
      "gpt-5.6-luna-fast",
      "gpt-5.6-sol-fast",
      "gpt-5.6-terra-fast",
    ],
  );
  assert.deepEqual(registered.map((tool) => tool.name), [
    "ipollowork_extension_list_actions",
    "ipollowork_project_read",
    "ipollowork_schedule_preview",
    "ipollowork_schedule_apply",
  ]);
  assert.deepEqual(systemSection, {
    name: "ipollowork:schedule-import",
    order: 100,
    text: scheduleDescription,
  });
  assert.match(registered[2].description, /是否需要生成计划并加入 iPolloWork 日程？/);
  assert.match(registered[2].description, /treat that request as agreement to schedule/);
  const result = await registered[1].execute({}, {
    signal: new AbortController().signal,
    agent: {
      id: "session_1",
      session: { meta: { cwd: "/tmp/project" } },
    },
  });
  assert.deepEqual(result, { ok: true, actions: [] });
  const call = JSON.parse(String(requests[1].init.body));
  assert.equal(call.name, "ipollowork_project_read");
  assert.deepEqual(call.context, {
    workspaceId: "ws_dsh",
    directory: "/tmp/project",
    sessionId: "session_1",
  });
  assert.equal(requests[1].init.headers.Authorization, "Bearer secret-token");

  const tasks = [{
    title: "Review launch plan",
    startAt: "2026-08-26T10:15:00+08:00",
    dueAt: "2026-08-26T11:00:00+08:00",
  }];
  await registered[2].execute({ tasks }, {
    signal: new AbortController().signal,
    agent: { id: "session_1", session: { meta: { cwd: "/tmp/project" } } },
  });
  await registered[3].execute({ previewId: "schedule_preview_1" }, {
    signal: new AbortController().signal,
    agent: { id: "session_1", session: { meta: { cwd: "/tmp/project" } } },
  });
  assert.deepEqual(JSON.parse(String(requests[2].init.body)), {
    name: "ipollowork_schedule_preview",
    args: { tasks },
    context: {
      workspaceId: "ws_dsh",
      directory: "/tmp/project",
      sessionId: "session_1",
    },
  });
  assert.deepEqual(JSON.parse(String(requests[3].init.body)), {
    name: "ipollowork_schedule_apply",
    args: { previewId: "schedule_preview_1" },
    context: {
      workspaceId: "ws_dsh",
      directory: "/tmp/project",
      sessionId: "session_1",
    },
  });
});

test("maps Fast aliases to the base Codex model with the priority service tier", { skip: !runtimePrepared }, async () => {
  const { createAssistantMessageEventStream, createOpenAiCodexPriorityProvider } = await loadRuntimeModules();
  /** @type {any} */
  let request;
  const baseProvider = {
    id: "openai-codex",
    name: "OpenAI Codex",
    auth: {
      apiKey: {
        name: "Test API key",
        async resolve() { return undefined; },
      },
    },
    getModels: () => [{
      id: "gpt-5.4",
      name: "GPT-5.4",
      provider: "openai-codex",
      api: /** @type {"openai-codex-responses"} */ ("openai-codex-responses"),
      baseUrl: "https://chatgpt.com/backend-api/codex",
      reasoning: true,
      input: /** @type {Array<"text" | "image">} */ (["text"]),
      contextWindow: 100,
      maxTokens: 10,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
    stream(model, context, options) {
      request = { model, context, options };
      return createAssistantMessageEventStream();
    },
    streamSimple() {
      throw new Error("priority aliases must use the API-specific stream");
    },
  };
  const provider = createOpenAiCodexPriorityProvider(baseProvider);
  const alias = provider.getModels()[0];
  provider.streamSimple(alias, { messages: [] }, { reasoning: "high" });

  assert.equal(alias.id, "gpt-5.4-fast");
  assert.equal(request.model.id, "gpt-5.4");
  assert.equal(request.model.provider, "openai-codex");
  assert.equal(request.options.reasoningEffort, "high");
  assert.equal(request.options.serviceTier, "priority");
});
