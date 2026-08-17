import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { isApiError } from "../../../errors.js";
import type { RequestContext, Route } from "../../../routes/registry.js";
import { matchRoute } from "../../../routes/registry.js";
import type { ServerConfig } from "../../../types.js";
import { describeModules, registerApiModules, type ApiModuleContext } from "../../module.js";
import { verifyWebhookSignature, WEBHOOK_EVENT_HEADER, WEBHOOK_SIGNATURE_HEADER } from "./delivery.js";
import {
  dispatchWebhookEvent,
  parseCreateWebhookInput,
  webhooksModule,
  WEBHOOK_SECRET_MIN_LENGTH,
} from "./module.js";
import {
  isKnownWebhookEvent,
  matchesWebhookEvent,
  MemoryWebhookStore,
  resolveWebhookStorePath,
  toPublicWebhook,
  WebhookStore,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_PER_WORKSPACE,
  WEBHOOK_TEST_EVENT,
  WEBHOOK_UNBRIDGED_EVENT_TYPES,
} from "./store.js";

const config = { workspaces: [], readOnly: false } as unknown as ServerConfig;

const PUBLIC_URL = "https://hooks.example.com/ingest";
const SUPPLIED_SECRET = "supplied_secret_value_0123456789";

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

interface Harness {
  routes: Route[];
  store: MemoryWebhookStore;
  calls: Array<{ url: string; init: RequestInit }>;
  call: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: Record<string, unknown>; raw: string }>;
}

function createHarness(options: { fetchStatus?: number } = {}): Harness {
  const store = new MemoryWebhookStore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const webhookFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: options.fetchStatus ?? 200 });
  }) as unknown as typeof fetch;

  const context: ApiModuleContext = {
    config,
    ensureWritable: () => {},
    requireClientScope: () => {},
    jsonResponse: (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    }),
    readJsonBody: async (request) => (await request.json()) as Record<string, unknown>,
    resolveWorkspace: async (_config, id) => ({ id }),
    services: { webhookStore: store, webhookFetch },
  };

  const routes: Route[] = [];
  registerApiModules(routes, [webhooksModule], context);

  const call: Harness["call"] = async (method, path, body) => {
    const matched = matchRoute(routes, method, path);
    if (!matched) throw new Error(`No route for ${method} ${path}`);
    const request = new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const ctx: RequestContext = {
      request,
      url: new URL(request.url),
      params: matched.params,
      config,
      approvals: {} as never,
      reloadEvents: {} as never,
      tokens: {} as never,
    };
    const response = await matched.handler(ctx);
    const raw = await response.text();
    return { status: response.status, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}, raw };
  };

  return { routes, store, calls, call };
}

const webhooksPath = (workspaceId = "w1") => `/api/v1/workspaces/${workspaceId}/webhooks`;

async function createWebhook(harness: Harness, body: Record<string, unknown> = {}) {
  return harness.call("POST", webhooksPath(), { url: PUBLIC_URL, events: ["task.created"], ...body });
}

const savedEnv = process.env.IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE;
const savedStoreEnv = process.env.IPOLLOWORK_WEBHOOK_STORE;

afterEach(() => {
  if (savedEnv === undefined) delete process.env.IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE;
  else process.env.IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE = savedEnv;
  if (savedStoreEnv === undefined) delete process.env.IPOLLOWORK_WEBHOOK_STORE;
  else process.env.IPOLLOWORK_WEBHOOK_STORE = savedStoreEnv;
});

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

describe("webhooks module registration", () => {
  test("declares the expected identity", () => {
    expect(webhooksModule.id).toBe("webhooks");
    expect(webhooksModule.version).toBe("1.0.0");
    expect(webhooksModule.stability).toBe("preview");
  });

  test("registers five routes with the right effects and scopes", () => {
    const routes: Route[] = [];
    const result = registerApiModules(routes, [webhooksModule], {
      config,
      ensureWritable: () => {},
      requireClientScope: () => {},
      jsonResponse: (data, status = 200) => Response.json(data as never, { status }),
      readJsonBody: async (request) => (await request.json()) as Record<string, unknown>,
      resolveWorkspace: async () => ({ id: "w1" }),
      services: { webhookStore: new MemoryWebhookStore() },
    });

    expect(routes).toHaveLength(5);
    const [described] = describeModules(result);
    expect(described?.operations).toEqual([
      {
        operationId: "createWebhook",
        method: "POST",
        path: "/api/v1/workspaces/:workspaceId/webhooks",
        effect: "write",
        scope: "collaborator",
        summary: "Create a webhook subscription",
        streaming: null,
        deprecated: false,
      },
      {
        operationId: "listWebhooks",
        method: "GET",
        path: "/api/v1/workspaces/:workspaceId/webhooks",
        effect: "read",
        scope: "viewer",
        summary: "List webhook subscriptions",
        streaming: null,
        deprecated: false,
      },
      {
        operationId: "getWebhook",
        method: "GET",
        path: "/api/v1/workspaces/:workspaceId/webhooks/:webhookId",
        effect: "read",
        scope: "viewer",
        summary: "Get a webhook subscription",
        streaming: null,
        deprecated: false,
      },
      {
        operationId: "deleteWebhook",
        method: "DELETE",
        path: "/api/v1/workspaces/:workspaceId/webhooks/:webhookId",
        effect: "destructive",
        scope: "collaborator",
        summary: "Delete a webhook subscription",
        streaming: null,
        deprecated: false,
      },
      {
        operationId: "testWebhook",
        method: "POST",
        path: "/api/v1/workspaces/:workspaceId/webhooks/:webhookId/test",
        effect: "write",
        scope: "collaborator",
        summary: "Send a test delivery to a webhook",
        streaming: null,
        deprecated: false,
      },
    ]);
  });

  test("write operations go through the module gates", async () => {
    const gates: string[] = [];
    const routes: Route[] = [];
    registerApiModules(routes, [webhooksModule], {
      config,
      ensureWritable: () => gates.push("ensureWritable"),
      requireClientScope: (_ctx, required) => gates.push(`scope:${required}`),
      jsonResponse: (data, status = 200) => Response.json(data as never, { status }),
      readJsonBody: async (request) => (await request.json()) as Record<string, unknown>,
      resolveWorkspace: async () => ({ id: "w1" }),
      services: { webhookStore: new MemoryWebhookStore() },
    });

    const matched = matchRoute(routes, "GET", webhooksPath())!;
    await matched.handler({
      request: new Request(`http://localhost${webhooksPath()}`),
      url: new URL(`http://localhost${webhooksPath()}`),
      params: matched.params,
      config,
      approvals: {} as never,
      reloadEvents: {} as never,
      tokens: {} as never,
    });
    // A read must not trip the write gate; that gating lives in the registry, not here.
    expect(gates).toEqual(["scope:viewer"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

describe("parseCreateWebhookInput", () => {
  const expectApiError = (fn: () => unknown, code: string) => {
    try {
      fn();
      throw new Error("expected a throw");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(code);
      expect((error as { status: number }).status).toBe(400);
    }
  };

  test("accepts a public url with known events", () => {
    const parsed = parseCreateWebhookInput({ url: PUBLIC_URL, events: ["task.created", "task.failed"] });
    expect(parsed.url).toBe(PUBLIC_URL);
    expect(parsed.events).toEqual(["task.created", "task.failed"]);
    expect(parsed.active).toBe(true);
  });

  test("rejects an engine event that nothing would ever deliver", () => {
    // Accepting `session.idle` would create a subscription that can never fire, and the
    // caller could not tell that from a quiet workspace.
    expectApiError(
      () => parseCreateWebhookInput({ url: PUBLIC_URL, events: ["session.idle"] }),
      "webhook_events_invalid",
    );
  });

  test("generates a secret when none is supplied", () => {
    const parsed = parseCreateWebhookInput({ url: PUBLIC_URL, events: ["*"] });
    expect(parsed.generatedSecret).toBe(true);
    expect(parsed.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  test("keeps a supplied secret and does not mark it generated", () => {
    const parsed = parseCreateWebhookInput({ url: PUBLIC_URL, events: ["*"], secret: SUPPLIED_SECRET });
    expect(parsed.generatedSecret).toBe(false);
    expect(parsed.secret).toBe(SUPPLIED_SECRET);
  });

  test("trims and de-duplicates events", () => {
    expect(parseCreateWebhookInput({ url: PUBLIC_URL, events: [" task.created ", "task.created"] }).events)
      .toEqual(["task.created"]);
  });

  test("rejects a missing or malformed url", () => {
    expectApiError(() => parseCreateWebhookInput({ events: ["*"] }), "webhook_url_invalid");
    expectApiError(() => parseCreateWebhookInput({ url: 42, events: ["*"] }), "webhook_url_invalid");
    expectApiError(() => parseCreateWebhookInput({ url: "not a url", events: ["*"] }), "webhook_url_invalid");
  });

  test("rejects a private url and points at the escape hatch", () => {
    try {
      parseCreateWebhookInput({ url: "http://169.254.169.254/latest", events: ["*"] });
      throw new Error("expected a throw");
    } catch (error) {
      const details = (error as { details: { reason: string; hint?: string } }).details;
      expect(details.reason).toBe("private_address");
      expect(details.hint).toContain("IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE");
    }
  });

  test("accepts a private url when the deployment opted in", () => {
    expect(parseCreateWebhookInput({ url: "http://127.0.0.1:3000/hook", events: ["*"] }, { allowPrivate: true }).url)
      .toBe("http://127.0.0.1:3000/hook");
  });

  test("rejects empty, non-string and unknown events", () => {
    expectApiError(() => parseCreateWebhookInput({ url: PUBLIC_URL, events: [] }), "webhook_events_invalid");
    expectApiError(() => parseCreateWebhookInput({ url: PUBLIC_URL, events: "task.created" }), "webhook_events_invalid");
    expectApiError(() => parseCreateWebhookInput({ url: PUBLIC_URL, events: [1] }), "webhook_events_invalid");
    expectApiError(
      () => parseCreateWebhookInput({ url: PUBLIC_URL, events: ["task.exploded"] }),
      "webhook_events_invalid",
    );
    // The test ping is not a subscribable product event.
    expectApiError(
      () => parseCreateWebhookInput({ url: PUBLIC_URL, events: [WEBHOOK_TEST_EVENT] }),
      "webhook_events_invalid",
    );
  });

  test("rejects a weak or non-string secret", () => {
    expectApiError(
      () => parseCreateWebhookInput({ url: PUBLIC_URL, events: ["*"], secret: "short" }),
      "webhook_secret_invalid",
    );
    expectApiError(
      () => parseCreateWebhookInput({ url: PUBLIC_URL, events: ["*"], secret: 12345678901234567890 }),
      "webhook_secret_invalid",
    );
    expect(
      parseCreateWebhookInput({ url: PUBLIC_URL, events: ["*"], secret: "x".repeat(WEBHOOK_SECRET_MIN_LENGTH) }).secret,
    ).toHaveLength(WEBHOOK_SECRET_MIN_LENGTH);
  });

  test("rejects a non-boolean active flag", () => {
    expectApiError(
      () => parseCreateWebhookInput({ url: PUBLIC_URL, events: ["*"], active: "yes" }),
      "webhook_active_invalid",
    );
    expect(parseCreateWebhookInput({ url: PUBLIC_URL, events: ["*"], active: false }).active).toBe(false);
  });
});

describe("event catalogue", () => {
  test("covers exactly the events that are actually delivered", () => {
    expect(isKnownWebhookEvent("*")).toBe(true);
    expect(isKnownWebhookEvent("task.awaiting_approval")).toBe(true);
    expect(isKnownWebhookEvent("task.made_up")).toBe(false);
    expect(WEBHOOK_EVENT_TYPES).toContain("task.failed");
  });

  test("engine events are not subscribable until something bridges them", () => {
    // `bridgeTaskEventsToWebhooks` is the only producer, so these would be accepted and
    // never fire. They are listed separately rather than silently offered.
    for (const event of ["session.idle", "message.delta", "permission.asked"]) {
      expect(isKnownWebhookEvent(event)).toBe(false);
      expect(WEBHOOK_UNBRIDGED_EVENT_TYPES).toContain(event);
    }
  });

  test("matching honours the wildcard", () => {
    expect(matchesWebhookEvent(["*"], "anything.at.all")).toBe(true);
    expect(matchesWebhookEvent(["task.created"], "task.created")).toBe(true);
    expect(matchesWebhookEvent(["task.created"], "task.failed")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

describe("createWebhook", () => {
  test("returns 201 with the public view and the generated secret once", async () => {
    const harness = createHarness();
    const created = await createWebhook(harness);

    expect(created.status).toBe(201);
    const webhook = created.body.webhook as Record<string, unknown>;
    expect(webhook.url).toBe(PUBLIC_URL);
    expect(webhook.events).toEqual(["task.created"]);
    expect(webhook.active).toBe(true);
    expect(webhook.hasSecret).toBe(true);
    expect(webhook).not.toHaveProperty("secret");
    // Generated secrets are shown exactly once, at the top level, never inside the record.
    expect(typeof created.body.secret).toBe("string");
  });

  test("does not echo a caller-supplied secret", async () => {
    const harness = createHarness();
    const created = await createWebhook(harness, { secret: SUPPLIED_SECRET });
    expect(created.body).not.toHaveProperty("secret");
    expect(created.raw).not.toContain(SUPPLIED_SECRET);
    expect((created.body.webhook as Record<string, unknown>).hasSecret).toBe(true);
  });

  test("rejects a private destination unless the server opted in", async () => {
    delete process.env.IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE;
    const harness = createHarness();
    await expect(createWebhook(harness, { url: "http://127.0.0.1:8080/hook" }))
      .rejects.toMatchObject({ code: "webhook_url_invalid", status: 400 });

    process.env.IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE = "1";
    const allowed = await createWebhook(harness, { url: "http://127.0.0.1:8080/hook" });
    expect(allowed.status).toBe(201);
  });

  test("enforces the per-workspace limit", async () => {
    const harness = createHarness();
    for (let index = 0; index < WEBHOOK_MAX_PER_WORKSPACE; index += 1) {
      await createWebhook(harness, { url: `${PUBLIC_URL}/${index}` });
    }
    await expect(createWebhook(harness)).rejects.toMatchObject({ code: "webhook_limit_reached", status: 409 });
  });

  test("scopes subscriptions to their workspace", async () => {
    const harness = createHarness();
    await createWebhook(harness);
    await harness.call("POST", webhooksPath("w2"), { url: PUBLIC_URL, events: ["*"] });

    const first = await harness.call("GET", webhooksPath("w1"));
    const second = await harness.call("GET", webhooksPath("w2"));
    expect((first.body.webhooks as unknown[])).toHaveLength(1);
    expect((second.body.webhooks as unknown[])).toHaveLength(1);
    expect((first.body.webhooks as Array<{ workspaceId: string }>)[0]?.workspaceId).toBe("w1");
  });
});

describe("read endpoints never expose a secret", () => {
  test("list and get return hasSecret instead of the secret", async () => {
    const harness = createHarness();
    const created = await createWebhook(harness, { secret: SUPPLIED_SECRET });
    const id = (created.body.webhook as { id: string }).id;

    const listed = await harness.call("GET", webhooksPath());
    expect(listed.raw).not.toContain(SUPPLIED_SECRET);
    expect(listed.raw).not.toContain("\"secret\"");
    expect((listed.body.webhooks as Array<{ hasSecret: boolean }>)[0]?.hasSecret).toBe(true);

    const fetched = await harness.call("GET", `${webhooksPath()}/${id}`);
    expect(fetched.raw).not.toContain(SUPPLIED_SECRET);
    expect(fetched.body.webhook).not.toHaveProperty("secret");
    expect((fetched.body.webhook as { hasSecret: boolean }).hasSecret).toBe(true);
  });

  test("hasSecret is false when a stored record has none", () => {
    const record = {
      id: "h1",
      workspaceId: "w1",
      url: PUBLIC_URL,
      events: ["*"],
      active: true,
      createdAt: 1,
    };
    expect(toPublicWebhook(record)).toEqual({ ...record, hasSecret: false });
    expect(toPublicWebhook({ ...record, secret: "" }).hasSecret).toBe(false);
  });

  test("getWebhook 404s for an unknown id and across workspaces", async () => {
    const harness = createHarness();
    const created = await createWebhook(harness);
    const id = (created.body.webhook as { id: string }).id;

    await expect(harness.call("GET", `${webhooksPath()}/nope`))
      .rejects.toMatchObject({ code: "webhook_not_found", status: 404 });
    await expect(harness.call("GET", `${webhooksPath("w2")}/${id}`))
      .rejects.toMatchObject({ code: "webhook_not_found", status: 404 });
  });
});

describe("deleteWebhook", () => {
  test("removes the subscription", async () => {
    const harness = createHarness();
    const created = await createWebhook(harness);
    const id = (created.body.webhook as { id: string }).id;

    const deleted = await harness.call("DELETE", `${webhooksPath()}/${id}`);
    expect(deleted.body).toEqual({ deleted: true, id });

    const listed = await harness.call("GET", webhooksPath());
    expect(listed.body.webhooks).toEqual([]);
    await expect(harness.call("DELETE", `${webhooksPath()}/${id}`))
      .rejects.toMatchObject({ code: "webhook_not_found" });
  });
});

describe("testWebhook", () => {
  test("sends one signed ping and reports the outcome without leaking the secret", async () => {
    const harness = createHarness();
    const created = await createWebhook(harness, { secret: SUPPLIED_SECRET, events: ["task.failed"] });
    const id = (created.body.webhook as { id: string }).id;

    const tested = await harness.call("POST", `${webhooksPath()}/${id}/test`);
    expect(tested.status).toBe(200);
    expect(tested.raw).not.toContain(SUPPLIED_SECRET);

    const delivery = tested.body.delivery as { ok: boolean; status: number; attempts: unknown[] };
    expect(delivery.ok).toBe(true);
    expect(delivery.status).toBe(200);
    expect(delivery.attempts).toHaveLength(1);

    expect(harness.calls).toHaveLength(1);
    const call = harness.calls[0]!;
    const headers = call.init.headers as Record<string, string>;
    // The ping bypasses the event filter — this subscription only asked for task.failed.
    expect(headers[WEBHOOK_EVENT_HEADER]).toBe(WEBHOOK_TEST_EVENT);
    expect(verifyWebhookSignature(SUPPLIED_SECRET, String(call.init.body), headers[WEBHOOK_SIGNATURE_HEADER] ?? ""))
      .toBe(true);
  });

  test("reports a rejecting subscriber as data rather than raising", async () => {
    const harness = createHarness({ fetchStatus: 410 });
    const created = await createWebhook(harness);
    const id = (created.body.webhook as { id: string }).id;

    const tested = await harness.call("POST", `${webhooksPath()}/${id}/test`);
    expect(tested.status).toBe(200);
    expect((tested.body.delivery as { ok: boolean; status: number }).ok).toBe(false);
    expect((tested.body.delivery as { ok: boolean; status: number }).status).toBe(410);
    // A 410 is not retryable, so a single attempt was made.
    expect(harness.calls).toHaveLength(1);
  });

  test("refuses a stored url that the current policy no longer allows", async () => {
    process.env.IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE = "1";
    const harness = createHarness();
    const created = await createWebhook(harness, { url: "http://127.0.0.1:8080/hook" });
    const id = (created.body.webhook as { id: string }).id;

    delete process.env.IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE;
    await expect(harness.call("POST", `${webhooksPath()}/${id}/test`))
      .rejects.toMatchObject({ code: "webhook_url_invalid", status: 400 });
    expect(harness.calls).toHaveLength(0);
  });

  test("404s for an unknown webhook", async () => {
    const harness = createHarness();
    await expect(harness.call("POST", `${webhooksPath()}/nope/test`))
      .rejects.toMatchObject({ code: "webhook_not_found", status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

describe("dispatchWebhookEvent", () => {
  const fetchOk = (calls: string[]) =>
    (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

  test("delivers to matching and wildcard subscriptions only", async () => {
    const store = new MemoryWebhookStore();
    await store.create({ workspaceId: "w1", url: "https://a.example.com/", events: ["task.created"] });
    await store.create({ workspaceId: "w1", url: "https://b.example.com/", events: ["*"] });
    await store.create({ workspaceId: "w1", url: "https://c.example.com/", events: ["task.failed"] });
    await store.create({ workspaceId: "w2", url: "https://d.example.com/", events: ["*"] });

    const calls: string[] = [];
    const results = await dispatchWebhookEvent(
      store,
      { workspaceId: "w1", type: "task.created", data: { taskId: "t1" } },
      { fetchImpl: fetchOk(calls), sleep: async () => {} },
    );

    expect(results).toHaveLength(2);
    expect(calls.sort()).toEqual(["https://a.example.com/", "https://b.example.com/"]);
  });

  test("skips inactive subscriptions", async () => {
    const store = new MemoryWebhookStore();
    await store.create({ workspaceId: "w1", url: "https://a.example.com/", events: ["*"], active: false });
    const calls: string[] = [];
    expect(await dispatchWebhookEvent(
      store,
      { workspaceId: "w1", type: "task.created", data: {} },
      { fetchImpl: fetchOk(calls), sleep: async () => {} },
    )).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("re-validates the stored url at send time", async () => {
    const store = new MemoryWebhookStore();
    // Created while the private opt-in was on; the policy has since tightened.
    await store.create({ workspaceId: "w1", url: "http://169.254.169.254/", events: ["*"] });
    await store.create({ workspaceId: "w1", url: "https://ok.example.com/", events: ["*"] });

    const calls: string[] = [];
    const results = await dispatchWebhookEvent(
      store,
      { workspaceId: "w1", type: "task.created", data: {} },
      { fetchImpl: fetchOk(calls), sleep: async () => {} },
    );
    expect(results).toHaveLength(1);
    expect(calls).toEqual(["https://ok.example.com/"]);
  });

  test("one unreachable subscriber does not stop the others", async () => {
    const store = new MemoryWebhookStore();
    await store.create({ workspaceId: "w1", url: "https://down.example.com/", events: ["*"] });
    await store.create({ workspaceId: "w1", url: "https://up.example.com/", events: ["*"] });

    const impl = (async (url: string | URL | Request) => {
      if (String(url).includes("down")) throw new Error("ECONNREFUSED");
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const results = await dispatchWebhookEvent(
      store,
      { workspaceId: "w1", type: "task.created", data: {} },
      { fetchImpl: impl, sleep: async () => {}, maxAttempts: 2 },
    );
    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
  });
});

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

describe("WebhookStore persistence", () => {
  test("resolves next to the server config, like the token store", () => {
    delete process.env.IPOLLOWORK_WEBHOOK_STORE;
    expect(resolveWebhookStorePath({ configPath: "/etc/ipollowork/config.json" } as ServerConfig))
      .toBe("/etc/ipollowork/webhooks.json");

    process.env.IPOLLOWORK_WEBHOOK_STORE = "/var/lib/hooks.json";
    expect(resolveWebhookStorePath({ configPath: "/etc/ipollowork/config.json" } as ServerConfig))
      .toBe("/var/lib/hooks.json");
  });

  test("round-trips through the file and keeps the secret on disk only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ipollowork-webhooks-"));
    try {
      process.env.IPOLLOWORK_WEBHOOK_STORE = join(dir, "webhooks.json");
      const store = new WebhookStore(config);
      const created = await store.create({
        workspaceId: "w1",
        url: PUBLIC_URL,
        events: ["task.created"],
        secret: SUPPLIED_SECRET,
      });

      const onDisk = await readFile(join(dir, "webhooks.json"), "utf8");
      expect(onDisk).toContain(SUPPLIED_SECRET);
      // ...but the shape the API returns carries no secret at all.
      expect(JSON.stringify(toPublicWebhook(created))).not.toContain(SUPPLIED_SECRET);

      const reloaded = new WebhookStore(config);
      const listed = await reloaded.list("w1");
      expect(listed).toHaveLength(1);
      expect(listed[0]?.secret).toBe(SUPPLIED_SECRET);
      expect(await reloaded.get("w1", created.id)).not.toBeNull();
      expect(await reloaded.get("w2", created.id)).toBeNull();

      expect(await reloaded.delete("w1", created.id)).toBe(true);
      expect(await new WebhookStore(config).list("w1")).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a corrupt or missing store degrades to empty rather than throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ipollowork-webhooks-"));
    try {
      process.env.IPOLLOWORK_WEBHOOK_STORE = join(dir, "missing.json");
      expect(await new WebhookStore(config).list("w1")).toEqual([]);

      await Bun.write(join(dir, "corrupt.json"), "{not json");
      process.env.IPOLLOWORK_WEBHOOK_STORE = join(dir, "corrupt.json");
      expect(await new WebhookStore(config).list("w1")).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("concurrent creates all survive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ipollowork-webhooks-"));
    try {
      process.env.IPOLLOWORK_WEBHOOK_STORE = join(dir, "webhooks.json");
      const store = new WebhookStore(config);
      await Promise.all(
        [0, 1, 2, 3, 4].map((index) =>
          store.create({ workspaceId: "w1", url: `${PUBLIC_URL}/${index}`, events: ["*"] }),
        ),
      );
      expect(await new WebhookStore(config).list("w1")).toHaveLength(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
