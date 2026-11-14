/** Account-authorized service gateway. Provider credentials never cross the public API. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store, Row } from "./database.js";
import type { Actor } from "./auth.js";
import { Settings } from "./settings.js";
import { audit, ledgerEntry, now, requireAdmin, wallet } from "./domain.js";
import { ServiceError } from "./errors.js";

const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const routeSchema = z
  .object({
    method: z.enum(["GET", "POST"]),
    path: z
      .string()
      .regex(/^\/[A-Za-z0-9_/:.~-]*$/)
      .max(300),
    points: z.number().int().min(0).max(1000000),
    jobField: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
      .optional(),
    jobResultField: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_.]*$/)
      .optional(),
  })
  .strict();
export const executionServiceSchema = z
  .object({
    id: identifier,
    title: z.string().trim().min(1).max(100),
    provider: identifier,
    baseUrl: z.url().refine((raw) => {
      const u = new URL(raw);
      return (
        (u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    }),
    models: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          name: z.string().min(1).max(200),
          contextWindow: z.number().int().min(1024),
          maxTokens: z.number().int().min(1),
        }),
      )
      .max(200)
      .default([]),
    keyId: identifier,
    key: z
      .string()
      .max(8192)
      .refine((v) => !/[\r\n]/.test(v))
      .optional(),
    headerName: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9-]*$/)
      .default("Authorization"),
    headerPrefix: z
      .string()
      .max(50)
      .refine((v) => !/[\r\n]/.test(v))
      .default("Bearer "),
    capabilities: z.array(identifier).min(1).max(30),
    routes: z.array(routeSchema).min(1).max(50),
    planIds: z.array(z.string().min(1).max(100)).max(100).default([]),
    enabled: z.boolean().default(false),
  })
  .strict();
type Definition = z.infer<typeof executionServiceSchema>;
/** A draft connection to probe; `key` falls back to the stored key of `keyId`. */
const probeSchema = executionServiceSchema
  .pick({ baseUrl: true, keyId: true, key: true, headerName: true, headerPrefix: true })
  .extend({ model: z.string().min(1).max(200).optional() })
  .strict();
export interface ProbeResult {
  ok: boolean;
  status: number;
  latency: number;
  /** `auth`: the upstream rejected the key; `unreachable`: no HTTP response; `timeout`: no response within 10 s; `upstream`: any other non-success status. */
  reason?: "auth" | "unreachable" | "timeout" | "upstream";
  /** Model ids from the upstream `/models` listing; empty when it has none. */
  models: string[];
}
type ServiceRow = Row & {
  id: string;
  title: string;
  provider: string;
  base_url: string;
  key_id: string;
  header_name: string;
  header_prefix: string;
  capabilities: string;
  routes: string;
  plan_ids: string;
  enabled: number;
};
type CallRow = Row & {
  id: string;
  user_id: string;
  service_id: string;
  request_hash: string;
  state: string;
  points: number;
  response_type: string | null;
  response_body: string | null;
};
const requestSchema = z
  .object({
    requestId: z.uuid(),
    path: z.string().min(1).max(2000),
    method: z.enum(["GET", "POST"]),
    body: z
      .string()
      .max(24 * 1024 * 1024)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
      .optional(),
    contentType: z
      .string()
      .max(200)
      .refine((v) => !/[\r\n]/.test(v))
      .optional(),
  })
  .strict();
function definition(row: ServiceRow): Definition {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider,
    baseUrl: row.base_url,
    keyId: row.key_id,
    headerName: row.header_name,
    headerPrefix: row.header_prefix,
    capabilities: JSON.parse(row.capabilities),
    routes: JSON.parse(row.routes),
    planIds: JSON.parse(row.plan_ids).ids ?? JSON.parse(row.plan_ids),
    models: JSON.parse(row.plan_ids).models ?? [],
    enabled: Boolean(row.enabled),
  };
}
function allowed(store: Store, actor: Actor, service: Definition): boolean {
  return (
    !service.planIds.length ||
    service.planIds.some((id) =>
      Boolean(
        store.one(
          "SELECT order_id FROM entitlements WHERE user_id=? AND plan_id=? AND revoked_at IS NULL AND starts_at<=? AND expires_at>?",
          actor.id,
          id,
          now(),
          now(),
        ),
      ),
    )
  );
}
function routeCost(
  service: Definition,
  path: string,
  method: string,
): z.infer<typeof routeSchema> {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /%2f|%5c|%2e/i.test(path)
  )
    throw new ServiceError("SERVICE_PATH_FORBIDDEN", 400);
  const parsed = new URL(path, "https://gateway.invalid");
  if (
    parsed.origin !== "https://gateway.invalid" ||
    parsed.hash ||
    parsed.pathname + parsed.search !== path
  )
    throw new ServiceError("SERVICE_PATH_FORBIDDEN", 400);
  const route = service.routes.find(
    (r) =>
      r.method === method &&
      new RegExp(
        "^" +
          r.path
            .split("/")
            .map((part) =>
              part.startsWith(":")
                ? "[A-Za-z0-9_-]+"
                : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join("/") +
          "$",
      ).test(parsed.pathname),
  );
  if (!route) throw new ServiceError("SERVICE_OPERATION_UNAVAILABLE", 403);
  return route;
}
/** Own configured upstreams, idempotent debits and bounded response replay. */
export class ExecutionService {
  constructor(
    private store: Store,
    private settings: Settings,
    private fetcher: typeof fetch = fetch,
  ) {
    store.run(
      "UPDATE service_calls SET response_body=NULL WHERE updated_at<?",
      now() - 86400000,
    );
    store.run(
      "UPDATE service_calls SET state='unknown',updated_at=? WHERE state='running'",
      now(),
    );
  }
  private rows() {
    return this.store.all<ServiceRow>(
      "SELECT * FROM execution_services ORDER BY created_at,id LIMIT 200",
    );
  }
  catalog(actor: Actor) {
    return {
      items: this.rows()
        .filter((r) => r.enabled)
        .map((row) => {
          const s = definition(row);
          return {
            id: s.id,
            title: s.title,
            provider: s.provider,
            capabilities: s.capabilities,
            origin: new URL(s.baseUrl).origin,
            basePath: new URL(s.baseUrl).pathname.replace(/\/$/, ""),
            routes: s.routes,
            models: s.models,
            available:
              allowed(this.store, actor, s) &&
              Boolean(this.settings.get("service-key/" + s.keyId).key),
          };
        }),
      points: Number(wallet(this.store, actor.id).balance),
    };
  }
  admin(actor: Actor) {
    requireAdmin(actor);
    return {
      items: this.rows().map((row) => {
        const s = definition(row);
        return {
          ...s,
          configured: Boolean(this.settings.get("service-key/" + s.keyId).key),
        };
      }),
    };
  }
  save(actor: Actor, raw: unknown) {
    requireAdmin(actor);
    const s = executionServiceSchema.parse(raw);
    for (const id of s.planIds)
      if (!this.store.one("SELECT id FROM plans WHERE id=?", id))
        throw new ServiceError("PLAN_NOT_FOUND", 400);
    this.store.transaction(() => {
      if (s.key) this.settings.set("service-key/" + s.keyId, { key: s.key });
      this.store.run(
        "INSERT INTO execution_services VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,provider=excluded.provider,base_url=excluded.base_url,key_id=excluded.key_id,header_name=excluded.header_name,header_prefix=excluded.header_prefix,capabilities=excluded.capabilities,routes=excluded.routes,plan_ids=excluded.plan_ids,enabled=excluded.enabled",
        s.id,
        s.title,
        s.provider,
        s.baseUrl,
        s.keyId,
        s.headerName,
        s.headerPrefix,
        JSON.stringify(s.capabilities),
        JSON.stringify(s.routes),
        JSON.stringify({ ids: s.planIds, models: s.models }),
        Number(s.enabled),
        now(),
      );
      audit(this.store, actor, "service.save", s.id);
    });
    return { ok: true };
  }
  /**
   * Probe a draft or saved connection before or after saving it. Without `model` this lists `/models`;
   * with `model` it sends a one-token chat completion. Nothing is billed or recorded, and the key is never returned.
   */
  async probe(actor: Actor, raw: unknown): Promise<ProbeResult> {
    requireAdmin(actor);
    const draft = probeSchema.parse(raw);
    const key = draft.key || this.settings.get("service-key/" + draft.keyId).key;
    if (!key) throw new ServiceError("SERVICE_UNCONFIGURED", 400);
    const base = draft.baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = { accept: "application/json", [draft.headerName]: draft.headerPrefix + key };
    const signal = AbortSignal.timeout(10000), started = Date.now();
    try {
      const response = draft.model
        ? await this.fetcher(base + "/chat/completions", {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ model: draft.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
            redirect: "manual",
            signal,
          })
        : await this.fetcher(base + "/models", { headers, redirect: "manual", signal });
      const latency = Date.now() - started;
      let models: string[] = [];
      if (response.ok && !draft.model) {
        const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
        if (body && Array.isArray(body.data))
          models = body.data
            .map((item) => (item && typeof item === "object" && "id" in item ? (item as { id: unknown }).id : undefined))
            .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200)
            .slice(0, 200);
      } else await response.body?.cancel().catch(() => {});
      // An upstream without a model listing still proves the address and key were accepted.
      const ok = response.ok || (!draft.model && (response.status === 404 || response.status === 405));
      return { ok, status: response.status, latency, models, ...(ok ? {} : { reason: response.status === 401 || response.status === 403 ? "auth" : "upstream" }) };
    } catch {
      return { ok: false, status: 0, latency: Date.now() - started, models: [], reason: signal.aborted ? "timeout" : "unreachable" };
    }
  }
  calls(actor: Actor) {
    requireAdmin(actor);
    return {
      items: this.store.all(
        "SELECT id,user_id,service_id,state,points,created_at FROM service_calls ORDER BY created_at DESC LIMIT 200",
      ),
    };
  }
  history(actor: Actor) {
    return {
      items: this.store.all(
        "SELECT id,service_id,state,points,created_at,updated_at FROM service_calls WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        actor.id,
      ),
    };
  }
  reconcile(actor: Actor, id: string, outcome: "succeeded" | "failed") {
    requireAdmin(actor);
    this.store.transaction(() => {
      const call = this.store.one<CallRow>(
        "SELECT * FROM service_calls WHERE id=?",
        id,
      );
      if (!call || call.state !== "unknown")
        throw new ServiceError("SERVICE_RECONCILIATION_CONFLICT", 409);
      if (outcome === "failed" && call.points)
        ledgerEntry(
          this.store,
          call.user_id,
          call.points,
          "service-refund/" + id,
          "服务调用退款",
        );
      this.store.run(
        "UPDATE service_calls SET state=?,updated_at=? WHERE id=?",
        outcome,
        now(),
        id,
      );
      audit(this.store, actor, "service.reconcile", id);
    });
    return { ok: true };
  }
  async invoke(actor: Actor, id: string, raw: unknown): Promise<Response> {
    const input = requestSchema.parse(raw),
      row = this.store.one<ServiceRow>(
        "SELECT * FROM execution_services WHERE id=? AND enabled=1",
        id,
      );
    if (!row) throw new ServiceError("SERVICE_UNAVAILABLE", 404);
    const s = definition(row);
    if (!allowed(this.store, actor, s))
      throw new ServiceError("SERVICE_PLAN_REQUIRED", 403);
    const route = routeCost(s, input.path, input.method),
      points = route.points,
      key = this.settings.get("service-key/" + s.keyId).key;
    if (!key) throw new ServiceError("SERVICE_UNCONFIGURED", 503);
    let upstreamBody = input.body
      ? Buffer.from(input.body, "base64")
      : undefined;
    if (s.models.length && input.method === "POST") {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(upstreamBody?.toString("utf8") ?? "{}");
      } catch {
        throw new ServiceError("SERVICE_INVALID_MODEL_REQUEST", 400);
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new ServiceError("SERVICE_INVALID_MODEL_REQUEST", 400);
      const model = s.models.find((model) => model.id === payload.model);
      if (!model) throw new ServiceError("SERVICE_MODEL_UNAVAILABLE", 403);
      const limit = payload.max_completion_tokens ?? payload.max_tokens;
      if (
        limit !== undefined &&
        (typeof limit !== "number" ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > model.maxTokens)
      )
        throw new ServiceError("SERVICE_TOKEN_LIMIT", 400);
      if (limit === undefined) payload.max_tokens = model.maxTokens;
      upstreamBody = Buffer.from(JSON.stringify(payload));
    }
    const routeParts = route.path.split("/"),
      pathParts = new URL(input.path, "https://gateway.invalid").pathname.split(
        "/",
      );
    let jobId = routeParts.includes(":id")
      ? pathParts[routeParts.indexOf(":id")]
      : undefined;
    if (route.jobField) {
      let payload: Record<string, unknown> = {};
      if (input.method === "POST") {
        try {
          payload = JSON.parse(upstreamBody?.toString("utf8") ?? "{}");
        } catch {
          throw new ServiceError("SERVICE_INVALID_JOB", 400);
        }
      }
      const raw =
        input.method === "GET"
          ? new URL(input.path, "https://gateway.invalid").searchParams.get(
              route.jobField,
            )
          : payload[route.jobField];
      if (typeof raw !== "string" || !raw)
        throw new ServiceError("SERVICE_INVALID_JOB", 400);
      jobId = raw;
    }
    if (
      jobId &&
      !this.store.one(
        "SELECT id FROM service_calls WHERE user_id=? AND service_id=? AND job_id=?",
        actor.id,
        id,
        jobId,
      )
    )
      throw new ServiceError("SERVICE_JOB_FORBIDDEN", 403);
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          id,
          input.path,
          input.method,
          input.contentType,
          input.body,
        ]),
      )
      .digest("hex");
    const existing = this.store.transaction(() => {
      const previous = this.store.one<CallRow>(
        "SELECT * FROM service_calls WHERE id=?",
        input.requestId,
      );
      if (previous) {
        if (previous.user_id !== actor.id || previous.request_hash !== hash)
          throw new ServiceError("IDEMPOTENCY_CONFLICT", 409);
        return previous;
      }
      if (
        this.store.one(
          "SELECT id FROM service_calls WHERE user_id=? AND state='running'",
          actor.id,
        )
      )
        throw new ServiceError("SERVICE_BUSY", 409);
      if (points)
        ledgerEntry(
          this.store,
          actor.id,
          -points,
          "service/" + input.requestId,
          "官方服务 · " + s.title,
        );
      this.store.run(
        "INSERT INTO service_calls(id,user_id,service_id,request_hash,state,points,created_at,updated_at) VALUES(?,?,?,?,'running',?,?,?)",
        input.requestId,
        actor.id,
        id,
        hash,
        points,
        now(),
        now(),
      );
      return undefined;
    });
    if (existing) {
      if (existing.state === "succeeded" && existing.response_body !== null)
        return new Response(Buffer.from(existing.response_body, "base64"), {
          headers: {
            "content-type": existing.response_type ?? "application/json",
            "cache-control": "no-store",
          },
        });
      throw new ServiceError(
        "SERVICE_CALL_" + existing.state.toUpperCase(),
        409,
      );
    }
    const fail = (state: "failed" | "unknown") =>
      this.store.transaction(() => {
        if (state === "failed" && points)
          ledgerEntry(
            this.store,
            actor.id,
            points,
            "service-refund/" + input.requestId,
            "服务调用退款",
          );
        this.store.run(
          "UPDATE service_calls SET state=?,updated_at=? WHERE id=? AND state='running'",
          state,
          now(),
          input.requestId,
        );
      });
    let response: Response;
    try {
      response = await this.fetcher(s.baseUrl.replace(/\/$/, "") + input.path, {
        method: input.method,
        headers: {
          [s.headerName]: s.headerPrefix + key,
          ...(input.contentType ? { "content-type": input.contentType } : {}),
        },
        body: input.method === "POST" ? upstreamBody : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      fail("unknown");
      throw new ServiceError("SERVICE_OUTCOME_UNKNOWN", 503);
    }
    if (!response.ok) {
      await response.body?.cancel();
      fail(response.status < 500 ? "failed" : "unknown");
      throw new ServiceError(
        response.status < 500
          ? "SERVICE_UPSTREAM_REJECTED"
          : "SERVICE_OUTCOME_UNKNOWN",
        503,
      );
    }
    const type =
      response.headers.get("content-type") ?? "application/octet-stream";
    const reader = response.body?.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    const store = this.store;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader?.read();
          if (!next || next.done) {
            let returnedJob: string | null = null;
            if (route.jobResultField) {
              try {
                let value: unknown = JSON.parse(
                  Buffer.concat(chunks).toString("utf8"),
                );
                for (const part of route.jobResultField.split("."))
                  value =
                    value && typeof value === "object"
                      ? Reflect.get(value, part)
                      : undefined;
                if (typeof value === "string" && value.length <= 256)
                  returnedJob = value;
              } catch {
                /* A non-JSON result supplies no job reference. */
              }
            }
            store.run(
              "UPDATE service_calls SET state='succeeded',response_type=?,response_body=?,job_id=?,updated_at=? WHERE id=?",
              type,
              Buffer.concat(chunks).toString("base64"),
              returnedJob,
              now(),
              input.requestId,
            );
            controller.close();
            reader?.releaseLock();
            return;
          }
          size += next.value.length;
          if (size > 16 * 1024 * 1024) throw new Error("response limit");
          chunks.push(Buffer.from(next.value));
          controller.enqueue(next.value);
        } catch {
          fail("unknown");
          await reader?.cancel().catch(() => {});
          controller.error(new Error("Service response interrupted"));
        }
      },
      async cancel() {
        fail("unknown");
        await reader?.cancel();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": type,
        "cache-control": "no-store",
        "x-ipollo-call-id": input.requestId,
      },
    });
  }
}
/** All writes are authenticated; only administrators configure upstreams or settle unknown calls. */
export function mountExecution(app: App, service: ExecutionService) {
  app.get("/api/v1/services", (c) => c.json(service.catalog(c.get("actor"))));
  app.get("/api/v1/services/usage", (c) =>
    c.json(service.history(c.get("actor"))),
  );
  app.get("/api/v1/admin/services", (c) =>
    c.json(service.admin(c.get("actor"))),
  );
  app.put("/api/v1/admin/services", async (c) =>
    c.json(service.save(c.get("actor"), await c.req.json())),
  );
  app.post("/api/v1/admin/services/probe", async (c) =>
    c.json(await service.probe(c.get("actor"), await c.req.json())),
  );
  app.get("/api/v1/admin/service-calls", (c) =>
    c.json(service.calls(c.get("actor"))),
  );
  app.post("/api/v1/admin/service-calls/:id/reconcile", async (c) => {
    const { outcome } = z
      .object({ outcome: z.enum(["succeeded", "failed"]) })
      .parse(await c.req.json());
    return c.json(
      service.reconcile(c.get("actor"), c.req.param("id"), outcome),
    );
  });
  app.post("/api/v1/services/:id/invoke", async (c) =>
    service.invoke(c.get("actor"), c.req.param("id"), await c.req.json()),
  );
}
