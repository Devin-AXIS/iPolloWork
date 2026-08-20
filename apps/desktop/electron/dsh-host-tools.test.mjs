import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { apply } from "../dsh-runtime/ipollowork-host-tools.mjs";

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
        tools: [{
          name: "ipollowork_extension_list_actions",
          description: "List extension actions",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        }],
      });
    }
    return Response.json({ ok: true, actions: [] });
  };

  /** @type {any} */
  let registered;
  const ctx = {
    tools: {
      register(definition) {
        registered = definition;
        return () => undefined;
      },
    },
    effect(factory) {
      return factory();
    },
  };
  await apply(ctx);
  if (!registered) throw new Error("DSH host tool was not registered");
  assert.equal(registered.name, "ipollowork_extension_list_actions");
  const result = await registered.execute({}, {
    signal: new AbortController().signal,
    agent: {
      id: "session_1",
      session: { meta: { cwd: "/tmp/project" } },
    },
  });
  assert.deepEqual(result, { ok: true, actions: [] });
  const call = JSON.parse(String(requests[1].init.body));
  assert.deepEqual(call.context, {
    workspaceId: "ws_dsh",
    directory: "/tmp/project",
    sessionId: "session_1",
  });
  assert.equal(requests[1].init.headers.Authorization, "Bearer secret-token");
});
