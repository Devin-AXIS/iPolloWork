import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAssistantMessageEventStream } from "../dsh-runtime/node_modules/@earendil-works/pi-ai/dist/index.js";

import {
  apply,
  createOpenAiCodexPriorityProvider,
  OPENAI_CODEX_PRIORITY_PROVIDER_ID,
} from "../dsh-runtime/ipollowork-host-tools.mjs";

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

test("registers the engine-neutral catalog and forwards DSH session context", async () => {
  process.env.IPOLLOWORK_SERVER_URL = "http://ipollowork.test";
  process.env.IPOLLOWORK_SERVER_TOKEN = "secret-token";
  process.env.IPOLLOWORK_WORKSPACE_ID = "ws_dsh";
  const requests = [];
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
        ],
      });
    }
    return Response.json({ ok: true, actions: [] });
  };

  /** @type {any[]} */
  const registered = [];
  /** @type {any} */
  let priorityAdapter;
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
    ["gpt-5.4-fast", "gpt-5.4-mini-fast", "gpt-5.5-fast"],
  );
  assert.deepEqual(registered.map((tool) => tool.name), [
    "ipollowork_extension_list_actions",
    "ipollowork_project_read",
  ]);
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
});

test("maps Fast aliases to the base Codex model with the priority service tier", () => {
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
