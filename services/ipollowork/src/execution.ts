/** Account-authorized service gateway. Provider credentials never cross the public API. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { App } from "./http.js";
import type { Store, Row } from "./database.js";
import type { Actor } from "./auth.js";
import { Settings } from "./settings.js";
import {
  audit,
  enterpriseAccess,
  isEnterpriseManager,
  ledgerEntry,
  now,
  requireAdmin,
  requireEnterpriseManager,
  wallet,
} from "./domain.js";
import { ServiceError } from "./errors.js";
import {
  audienceOf,
  audienceSchema,
  canUse,
  grantedTo,
  replaceAudience,
  requireUse,
} from "./grants.js";
import {
  billingSchema,
  reserveUsage,
  costCredits,
  usageCost,
  usageResponse,
  type BillingReservation,
} from "./pricing.js";

import { serviceCategories, serviceCategory } from "./service-categories.js";

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
          category: z.enum(serviceCategories).optional(),
          contextWindow: z.number().int().min(1024).optional(),
          maxTokens: z.number().int().min(1).optional(),
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
    category: z.enum(serviceCategories).optional(),
    vendor: identifier.optional(),
    capabilities: z.array(identifier).min(1).max(30),
    routes: z.array(routeSchema).min(1).max(50),
    planIds: z.array(z.string().min(1).max(100)).max(100).default([]),
    enabled: z.boolean().default(false),
    billing: billingSchema.optional(),
    timeoutMs: z.number().int().min(1000).max(900000).default(120000),
  })
  .strict();
type Definition = z.infer<typeof executionServiceSchema>;
/** A draft connection to probe; `key` falls back to the stored key of `keyId`. */
const probeSchema = executionServiceSchema
  .pick({
    baseUrl: true,
    keyId: true,
    key: true,
    headerName: true,
    headerPrefix: true,
  })
  .extend({ model: z.string().min(1).max(200).optional() })
  .strict();
const enterpriseServiceSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    title: z.string().trim().min(1).max(100),
    baseUrl: executionServiceSchema.shape.baseUrl,
    key: executionServiceSchema.shape.key,
    headerName: executionServiceSchema.shape.headerName,
    headerPrefix: executionServiceSchema.shape.headerPrefix,
    models: executionServiceSchema.shape.models,
    category: executionServiceSchema.shape.category,
    vendor: executionServiceSchema.shape.vendor,
    routes: z.array(routeSchema).min(1).max(50).optional(),
    enabled: z.boolean().default(true),
    audience: audienceSchema.optional(),
  })
  .strict();
const enterpriseProbeSchema = z
  .object({
    serviceId: z.string().min(1).max(100).optional(),
    baseUrl: executionServiceSchema.shape.baseUrl,
    key: executionServiceSchema.shape.key,
    headerName: executionServiceSchema.shape.headerName,
    headerPrefix: executionServiceSchema.shape.headerPrefix,
    model: z.string().min(1).max(200).optional(),
  })
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
  const details = JSON.parse(row.plan_ids);
  const category = serviceCategory(
    details.category,
    JSON.parse(row.capabilities),
  );
  const entries = details.models?.length
    ? details.models
    : category !== "language" && details.billing?.rates
      ? details.billing.rates.map((rate: { model: string }) => ({
          id: rate.model,
          name: rate.model,
        }))
      : [];
  return {
    category,
    vendor:
      details.vendor ?? (row.id.startsWith("ent-") ? "custom" : row.provider),
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
    models: entries.map((model: Definition["models"][number]) => ({
      ...model,
      category: model.category ?? category,
    })),
    enabled: Boolean(row.enabled),
    billing: JSON.parse(row.plan_ids).billing,
    timeoutMs: JSON.parse(row.plan_ids).timeoutMs ?? 120000,
  };
}
async function allowed(
  store: Store,
  actor: Actor,
  service: Definition,
): Promise<boolean> {
  if (!service.planIds.length) return true;
  for (const id of service.planIds) {
    if (
      await store.one(
        "SELECT order_id FROM entitlements WHERE user_id=? AND plan_id=? AND revoked_at IS NULL AND starts_at<=? AND expires_at>?",
        actor.id,
        id,
        now(),
        now(),
      )
    )
      return true;
  }
  return false;
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
    /** Development deployments on a loopback origin may connect enterprise models to loopback upstreams. */
    private loopbackUpstreams = false,
  ) {}
  /** Mark interrupted requests uncertain only after their reservation lease expires. */
  async recover(): Promise<void> {
    await this.store.run(
      "UPDATE service_calls SET response_body=NULL WHERE updated_at<?",
      now() - 86400000,
    );
    await this.store.run(
      `UPDATE service_calls c SET state='unknown',updated_at=? FROM execution_services s
      WHERE c.service_id=s.id AND c.state='running'
      AND c.updated_at+COALESCE((s.plan_ids::jsonb->>'timeoutMs')::bigint,120000)<?`,
      now(),
      now(),
    );
  }
  /** Official services: every service not owned by an enterprise. */
  private async rows() {
    return await this.store.all<ServiceRow>(
      "SELECT * FROM execution_services WHERE id NOT IN (SELECT service_id FROM enterprise_services) ORDER BY created_at,id LIMIT 200",
    );
  }
  /** Enabled enterprise models the actor may use: managers see all of their enterprises' models, members only granted ones. */
  private async enterpriseRows(actor: Actor) {
    return await this.store.all<
      ServiceRow & { enterprise_id: string; enterprise_name: string }
    >(
      `SELECT s.*,es.enterprise_id,e.name AS enterprise_name FROM execution_services s JOIN enterprise_services es ON es.service_id=s.id JOIN enterprises e ON e.id=es.enterprise_id
       JOIN members m ON m.enterprise_id=es.enterprise_id AND m.user_id=? WHERE s.enabled=1 AND (m.role IN('owner','admin') OR ${grantedTo("s.id")}) ORDER BY s.created_at,s.id LIMIT 200`,
      actor.id,
      "service",
    );
  }
  async catalog(actor: Actor) {
    return {
      items: (
        await Promise.all(
          (await this.rows())
            .filter((r) => r.enabled)
            .map(async (row) => {
              const s = definition(row);
              return {
                id: s.id,
                title: s.title,
                provider: s.provider,
                capabilities: s.capabilities,
                category: s.category,
                vendor: s.vendor,
                origin: new URL(s.baseUrl).origin,
                basePath: new URL(s.baseUrl).pathname.replace(/\/$/, ""),
                routes: s.routes,
                models: s.models,
                billing: s.billing,
                available:
                  (await allowed(this.store, actor, s)) &&
                  Boolean(
                    (await this.settings.get("service-key/" + s.keyId)).key,
                  ),
                enterprise: null as { id: string; name: string } | null,
              };
            }),
        )
      ).concat(
        await Promise.all(
          (await this.enterpriseRows(actor)).map(async (row) => {
            const s = definition(row);
            return {
              id: s.id,
              title: s.title,
              provider: s.provider,
              capabilities: s.capabilities,
              category: s.category,
              vendor: s.vendor,
              origin: new URL(s.baseUrl).origin,
              basePath: new URL(s.baseUrl).pathname.replace(/\/$/, ""),
              routes: s.routes,
              models: s.models,
              billing: undefined,
              available: Boolean(
                (await this.settings.get("service-key/" + s.keyId)).key,
              ),
              enterprise: { id: row.enterprise_id, name: row.enterprise_name },
            };
          }),
        ),
      ),
      points: Number((await wallet(this.store, actor.id)).balance),
    };
  }
  async admin(actor: Actor) {
    requireAdmin(actor);
    return {
      items: await Promise.all(
        (await this.rows()).map(async (row) => {
          const s = definition(row);
          return {
            ...s,
            configured: Boolean(
              (await this.settings.get("service-key/" + s.keyId)).key,
            ),
          };
        }),
      ),
    };
  }
  async save(actor: Actor, raw: unknown) {
    requireAdmin(actor);
    const s = executionServiceSchema.parse(raw);
    s.category = serviceCategory(s.category, s.capabilities);
    s.vendor ??= s.provider;
    s.models = s.models.map((model) => ({
      ...model,
      category: model.category ?? s.category,
    }));
    if (
      s.models.some(
        (model) =>
          model.category === "language" &&
          (!model.contextWindow || !model.maxTokens),
      )
    )
      throw new ServiceError("MODEL_LIMITS_REQUIRED", 400);
    const saved = await this.store.one<ServiceRow>(
      "SELECT * FROM execution_services WHERE id=?",
      s.id,
    );
    if (saved && !s.billing) s.billing = definition(saved).billing;
    if (s.enabled && s.billing && s.billing.validUntil <= Date.now())
      throw new ServiceError("SERVICE_PRICE_EXPIRED", 400);
    if (
      s.billing?.kind === "chat" &&
      s.models.some(
        (model) => !s.billing!.rates.some((rate) => rate.model === model.id),
      )
    )
      throw new ServiceError("SERVICE_MODEL_UNPRICED", 400);
    if (
      (await this.store.one(
        "SELECT 1 FROM enterprise_services WHERE service_id=?",
        s.id,
      )) ||
      s.keyId.startsWith("ent-")
    )
      throw new ServiceError(
        "SERVICE_OWNED_BY_ENTERPRISE",
        409,
        "该服务属于组织，请在组织空间中管理",
      );
    for (const id of s.planIds)
      if (!(await this.store.one("SELECT id FROM plans WHERE id=?", id)))
        throw new ServiceError("PLAN_NOT_FOUND", 400);
    await this.store.transaction(async () => {
      if (s.key)
        await this.settings.set("service-key/" + s.keyId, { key: s.key });
      await this.store.run(
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
        JSON.stringify({
          ids: s.planIds,
          models: s.models,
          category: s.category,
          vendor: s.vendor,
          billing: s.billing,
          timeoutMs: s.timeoutMs,
        }),
        Number(s.enabled),
        now(),
      );
      await audit(this.store, actor, "service.save", s.id);
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
    const key =
      draft.key || (await this.settings.get("service-key/" + draft.keyId)).key;
    if (!key) throw new ServiceError("SERVICE_UNCONFIGURED", 400);
    return await this.upstreamProbe(
      draft.baseUrl,
      draft.headerName,
      draft.headerPrefix,
      key,
      draft.model,
    );
  }
  private async upstreamProbe(
    baseUrl: string,
    headerName: string,
    headerPrefix: string,
    key: string,
    model?: string,
  ): Promise<ProbeResult> {
    const base = baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      accept: "application/json",
      [headerName]: headerPrefix + key,
    };
    const signal = AbortSignal.timeout(10000),
      started = Date.now();
    try {
      const response = model
        ? await this.fetcher(base + "/chat/completions", {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
              stream: false,
            }),
            redirect: "manual",
            signal,
          })
        : await this.fetcher(base + "/models", {
            headers,
            redirect: "manual",
            signal,
          });
      const latency = Date.now() - started;
      let models: string[] = [];
      if (response.ok && !model) {
        const body = (await response.json().catch(() => null)) as {
          data?: unknown;
        } | null;
        if (body && Array.isArray(body.data))
          models = body.data
            .map((item) =>
              item && typeof item === "object" && "id" in item
                ? (item as { id: unknown }).id
                : undefined,
            )
            .filter(
              (id): id is string =>
                typeof id === "string" && id.length > 0 && id.length <= 200,
            )
            .slice(0, 200);
      } else await response.body?.cancel().catch(() => {});
      // An upstream without a model listing still proves the address and key were accepted.
      const ok =
        response.ok ||
        (!model && (response.status === 404 || response.status === 405));
      return {
        ok,
        status: response.status,
        latency,
        models,
        ...(ok
          ? {}
          : {
              reason:
                response.status === 401 || response.status === 403
                  ? "auth"
                  : "upstream",
            }),
      };
    } catch {
      return {
        ok: false,
        status: 0,
        latency: Date.now() - started,
        models: [],
        reason: signal.aborted ? "timeout" : "unreachable",
      };
    }
  }
  /** Reject enterprise upstreams on private or loopback hosts, which would let an enterprise manager reach this server's network. */
  private enterpriseUpstream(raw: string): string {
    const url = new URL(raw),
      host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const loopback =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      /^127\./.test(host) ||
      host === "::1";
    if (loopback && this.loopbackUpstreams) return raw;
    if (
      url.protocol !== "https:" ||
      loopback ||
      /^(10|0)\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^(fc|fd|fe80)/.test(host) ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    )
      throw new ServiceError(
        "SERVICE_UPSTREAM_FORBIDDEN",
        400,
        "组织模型需要公网 HTTPS 地址",
      );
    return raw;
  }
  private async enterpriseService(
    enterpriseId: string,
    serviceId: string,
  ): Promise<ServiceRow> {
    const row = await this.store.one<ServiceRow>(
      "SELECT s.* FROM execution_services s JOIN enterprise_services es ON es.service_id=s.id WHERE s.id=? AND es.enterprise_id=?",
      serviceId,
      enterpriseId,
    );
    if (!row)
      throw new ServiceError("SERVICE_UNAVAILABLE", 404, "组织模型不存在");
    return row;
  }
  /** Enterprise models for the enterprise page; managers also see disabled ones and whether a key is stored. */
  async enterpriseList(actor: Actor, enterpriseId: string) {
    await enterpriseAccess(this.store, actor, enterpriseId);
    const manage = await isEnterpriseManager(this.store, actor, enterpriseId);
    const rows = await this.store.all<ServiceRow>(
      "SELECT s.* FROM execution_services s JOIN enterprise_services es ON es.service_id=s.id WHERE es.enterprise_id=? ORDER BY s.created_at,s.id LIMIT 200",
      enterpriseId,
    );
    const visible: ServiceRow[] = [];
    for (const row of rows)
      if (
        manage ||
        (row.enabled &&
          (await canUse(this.store, actor, enterpriseId, "service", row.id)))
      )
        visible.push(row);
    return await Promise.all(
      visible.map(async (row) => {
        const s = definition(row);
        return {
          id: s.id,
          title: s.title,
          provider: s.provider,
          baseUrl: s.baseUrl,
          models: s.models,
          routes: s.routes,
          category: s.category,
          vendor: s.vendor,
          enabled: s.enabled,
          headerName: s.headerName,
          headerPrefix: s.headerPrefix,
          configured: Boolean(
            (await this.settings.get("service-key/" + s.keyId)).key,
          ),
          audience: await audienceOf(this.store, "service", s.id),
        };
      }),
    );
  }
  /** Create or update an enterprise model. The enterprise pays its provider directly, so calls carry no points. */
  async enterpriseSave(actor: Actor, enterpriseId: string, raw: unknown) {
    await requireEnterpriseManager(this.store, actor, enterpriseId);
    const input = enterpriseServiceSchema.parse(raw);
    const baseUrl = this.enterpriseUpstream(input.baseUrl);
    const existing = input.id
      ? await this.enterpriseService(enterpriseId, input.id)
      : undefined;
    const previous = existing ? definition(existing) : undefined;
    const category = input.category ?? previous?.category ?? "language";
    const routes =
      input.routes ??
      previous?.routes ??
      (category === "language"
        ? [{ method: "POST", path: "/chat/completions", points: 0 }]
        : undefined);
    if (!routes)
      throw new ServiceError(
        "SERVICE_ROUTES_REQUIRED",
        400,
        "请配置此类型服务的接口路径",
      );
    if (
      input.models.some(
        (model) =>
          (model.category ?? category) === "language" &&
          (!model.contextWindow || !model.maxTokens),
      )
    )
      throw new ServiceError("MODEL_LIMITS_REQUIRED", 400);
    const id =
      existing?.id ?? "ent-" + randomUUID().replace(/-/g, "").slice(0, 20);
    if (!existing && !input.key)
      throw new ServiceError("SERVICE_UNCONFIGURED", 400, "请填写 Key");
    await this.store.transaction(async () => {
      if (input.key)
        await this.settings.set("service-key/" + id, { key: input.key });
      await this.store.run(
        "INSERT INTO execution_services(id,title,provider,base_url,key_id,header_name,header_prefix,capabilities,routes,plan_ids,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,base_url=excluded.base_url,header_name=excluded.header_name,header_prefix=excluded.header_prefix,capabilities=excluded.capabilities,routes=excluded.routes,plan_ids=excluded.plan_ids,enabled=excluded.enabled",
        id,
        input.title,
        id,
        baseUrl,
        id,
        input.headerName,
        input.headerPrefix,
        JSON.stringify([category === "language" ? "chat" : category]),
        JSON.stringify(routes.map((route) => ({ ...route, points: 0 }))),
        JSON.stringify({
          ids: [],
          models: input.models,
          category,
          vendor: input.vendor ?? previous?.vendor ?? "custom",
        }),
        Number(input.enabled),
        now(),
      );
      if (!existing) {
        await this.store.run(
          "INSERT INTO enterprise_services VALUES(?,?)",
          id,
          enterpriseId,
        );
        await replaceAudience(
          this.store,
          enterpriseId,
          "service",
          id,
          input.audience ?? { all: true, departments: [], members: [] },
        );
      } else if (input.audience)
        await replaceAudience(
          this.store,
          enterpriseId,
          "service",
          id,
          input.audience,
        );
      await audit(this.store, actor, "enterprise.service.save", id);
    });
    return { id };
  }
  async enterpriseRemove(
    actor: Actor,
    enterpriseId: string,
    serviceId: string,
  ) {
    await requireEnterpriseManager(this.store, actor, enterpriseId);
    const row = await this.enterpriseService(enterpriseId, serviceId);
    await this.store.transaction(async () => {
      // Receipts keep their service reference; a model with history is disabled and detached instead of deleted.
      const used = await this.store.one(
        "SELECT 1 FROM service_calls WHERE service_id=? LIMIT 1",
        row.id,
      );
      await this.store.run(
        "DELETE FROM enterprise_grants WHERE asset_kind='service' AND asset_id=?",
        row.id,
      );
      if (used)
        await this.store.run(
          "UPDATE execution_services SET enabled=0 WHERE id=?",
          row.id,
        );
      else {
        await this.store.run(
          "DELETE FROM enterprise_services WHERE service_id=?",
          row.id,
        );
        await this.store.run(
          "DELETE FROM execution_services WHERE id=?",
          row.id,
        );
      }
      await this.settings.set("service-key/" + row.key_id, {});
      await audit(this.store, actor, "enterprise.service.remove", row.id);
    });
    return { ok: true };
  }
  /** Probe a draft enterprise model; a stored key is reused only for a model of this enterprise. */
  async enterpriseProbe(
    actor: Actor,
    enterpriseId: string,
    raw: unknown,
  ): Promise<ProbeResult> {
    await requireEnterpriseManager(this.store, actor, enterpriseId);
    const draft = enterpriseProbeSchema.parse(raw);
    const baseUrl = this.enterpriseUpstream(draft.baseUrl);
    const key =
      draft.key ||
      (draft.serviceId
        ? (
            await this.settings.get(
              "service-key/" +
                (await this.enterpriseService(enterpriseId, draft.serviceId))
                  .key_id,
            )
          ).key
        : undefined);
    if (!key) throw new ServiceError("SERVICE_UNCONFIGURED", 400, "请填写 Key");
    return await this.upstreamProbe(
      baseUrl,
      draft.headerName,
      draft.headerPrefix,
      key,
      draft.model,
    );
  }
  async calls(actor: Actor) {
    requireAdmin(actor);
    return {
      items: await this.store.all(
        "SELECT id,user_id,service_id,state,points,cost_micros,billing_settled,created_at FROM service_calls ORDER BY created_at DESC LIMIT 200",
      ),
    };
  }
  async history(actor: Actor) {
    return {
      items: await this.store.all(
        "SELECT id,service_id,state,points,cost_micros,billing_settled,created_at,updated_at FROM service_calls WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        actor.id,
      ),
    };
  }
  async reconcile(actor: Actor, id: string, outcome: "succeeded" | "failed") {
    requireAdmin(actor);
    await this.store.transaction(async () => {
      const call = await this.store.one<CallRow>(
        "SELECT * FROM service_calls WHERE id=? FOR UPDATE",
        id,
      );
      if (!call || call.state !== "unknown")
        throw new ServiceError("SERVICE_RECONCILIATION_CONFLICT", 409);
      if (outcome === "failed" && call.points)
        await ledgerEntry(
          this.store,
          call.user_id,
          call.points,
          "service-refund/" + id,
          "服务调用退款",
        );
      await this.store.run(
        "UPDATE service_calls SET state=?,updated_at=?,billing_settled=true,points=?,cost_micros=CASE WHEN ? THEN 0 ELSE cost_micros END WHERE id=?",
        outcome,
        now(),
        outcome === "failed" ? 0 : call.points,
        outcome === "failed",
        id,
      );
      await audit(this.store, actor, "service.reconcile", id);
    });
    return { ok: true };
  }
  private async settleUsage(id: string, micros: number): Promise<void> {
    let blocked: string | undefined;
    await this.store.transaction(async () => {
      const call = await this.store.one(
        "SELECT * FROM service_calls WHERE id=? FOR UPDATE",
        id,
      );
      if (!call || call.billing_settled || call.state === "failed") return;
      const points = costCredits(micros),
        held = Number(call.points);
      if (points > held) {
        blocked = String(call.service_id);
        await this.store.run(
          "UPDATE service_calls SET state='unknown',cost_micros=? WHERE id=?",
          micros,
          id,
        );
        return;
      }
      if (held > points)
        await ledgerEntry(
          this.store,
          String(call.user_id),
          held - points,
          "service-settle/" + id,
          "服务用量结算",
        );
      await this.store.run(
        "UPDATE service_calls SET points=?,cost_micros=?,billing_settled=true WHERE id=?",
        points,
        micros,
        id,
      );
    });
    if (blocked) {
      await this.store.run(
        "UPDATE execution_services SET enabled=0 WHERE id=?",
        blocked,
      );
      throw new ServiceError("SERVICE_USAGE_OUT_OF_BOUNDS", 503);
    }
  }
  async invoke(actor: Actor, id: string, raw: unknown): Promise<Response> {
    const input = requestSchema.parse(raw),
      row = await this.store.one<ServiceRow>(
        "SELECT * FROM execution_services WHERE id=? AND enabled=1",
        id,
      );
    if (!row) throw new ServiceError("SERVICE_UNAVAILABLE", 404);
    const s = definition(row);
    const owner = await this.store.one<{ enterprise_id: string }>(
      "SELECT enterprise_id FROM enterprise_services WHERE service_id=?",
      id,
    );
    if (owner)
      await requireUse(this.store, actor, owner.enterprise_id, "service", id);
    else if (!(await allowed(this.store, actor, s)))
      throw new ServiceError("SERVICE_PLAN_REQUIRED", 403);
    const route = routeCost(s, input.path, input.method),
      key = (await this.settings.get("service-key/" + s.keyId)).key;
    let points = owner ? 0 : route.points;
    let reservation: BillingReservation | undefined;
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
      if ((model.category ?? s.category) === "language") {
        if (
          limit !== undefined &&
          (typeof limit !== "number" ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > model.maxTokens!)
        )
          throw new ServiceError("SERVICE_TOKEN_LIMIT", 400);
        if (limit === undefined) payload.max_tokens = model.maxTokens;
      }
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
      !(await this.store.one(
        "SELECT id FROM service_calls WHERE user_id=? AND service_id=? AND job_id=?",
        actor.id,
        id,
        jobId,
      ))
    )
      throw new ServiceError("SERVICE_JOB_FORBIDDEN", 403);
    if (!owner && s.billing && input.method === "POST" && !jobId) {
      const payload = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(upstreamBody?.toString("utf8") ?? "{}"));
      reservation = reserveUsage(s.billing, payload);
      points = costCredits(reservation.micros);
      upstreamBody = Buffer.from(JSON.stringify(payload));
    }
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
    const existing = await this.store.transaction(async () => {
      const previous = await this.store.one<CallRow>(
        "SELECT * FROM service_calls WHERE id=?",
        input.requestId,
      );
      if (previous) {
        if (previous.user_id !== actor.id || previous.request_hash !== hash)
          throw new ServiceError("IDEMPOTENCY_CONFLICT", 409);
        return previous;
      }
      if (
        await this.store.one(
          "SELECT id FROM service_calls WHERE user_id=? AND state='running'",
          actor.id,
        )
      )
        throw new ServiceError("SERVICE_BUSY", 409);
      if (points)
        await ledgerEntry(
          this.store,
          actor.id,
          -points,
          "service/" + input.requestId,
          "官方服务 · " + s.title,
        );
      await this.store.run(
        "INSERT INTO service_calls(id,user_id,service_id,request_hash,state,points,created_at,updated_at,billing_snapshot) VALUES(?,?,?,?,'running',?,?,?,?)",
        input.requestId,
        actor.id,
        id,
        hash,
        points,
        now(),
        now(),
        reservation ? JSON.stringify(reservation) : null,
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
    const fail = async (state: "failed" | "unknown") =>
      await this.store.transaction(async () => {
        const call = await this.store.one(
          "SELECT state FROM service_calls WHERE id=? FOR UPDATE",
          input.requestId,
        );
        if (call?.state !== "running") return;
        if (state === "failed" && points)
          await ledgerEntry(
            this.store,
            actor.id,
            points,
            "service-refund/" + input.requestId,
            "服务调用退款",
          );
        await this.store.run(
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
        signal: AbortSignal.timeout(s.timeoutMs),
      });
    } catch {
      await fail("unknown");
      throw new ServiceError("SERVICE_OUTCOME_UNKNOWN", 503);
    }
    if (!response.ok) {
      await response.body?.cancel();
      await fail(response.status < 500 ? "failed" : "unknown");
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
    const settle = async (bytes: Buffer) => {
      if (reservation && reservation.spec.kind !== "video") {
        const cost = usageCost(reservation, usageResponse(bytes, type));
        if (cost === null) throw new ServiceError("SERVICE_USAGE_MISSING", 503);
        await this.settleUsage(input.requestId, cost);
      } else if (jobId && s.billing?.kind === "video") {
        const parent = await store.one(
          "SELECT id,billing_snapshot FROM service_calls WHERE user_id=? AND service_id=? AND job_id=? AND billing_snapshot IS NOT NULL",
          actor.id,
          id,
          jobId,
        );
        if (parent) {
          const snapshot = JSON.parse(
            String(parent.billing_snapshot),
          ) as BillingReservation;
          const cost = usageCost(snapshot, usageResponse(bytes, type));
          if (cost !== null) await this.settleUsage(String(parent.id), cost);
        }
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader?.read();
          if (!next || next.done) {
            await settle(Buffer.concat(chunks));
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
            if (reservation?.spec.kind === "video" && !returnedJob)
              throw new ServiceError("SERVICE_JOB_MISSING", 503);
            await store.run(
              "UPDATE service_calls SET state='succeeded',response_type=?,response_body=?,job_id=?,updated_at=? WHERE id=? AND state='running'",
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
          await fail("unknown");
          await reader?.cancel().catch(() => {});
          controller.error(new Error("Service response interrupted"));
        }
      },
      async cancel() {
        await fail("unknown");
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
  app.get("/api/v1/services", async (c) =>
    c.json(await service.catalog(c.get("actor"))),
  );
  app.get("/api/v1/services/usage", async (c) =>
    c.json(await service.history(c.get("actor"))),
  );
  app.get("/api/v1/admin/services", async (c) =>
    c.json(await service.admin(c.get("actor"))),
  );
  app.put("/api/v1/admin/services", async (c) =>
    c.json(await service.save(c.get("actor"), await c.req.json())),
  );
  app.get("/api/v1/enterprises/:id/services", async (c) =>
    c.json({
      items: await service.enterpriseList(c.get("actor"), c.req.param("id")),
    }),
  );
  app.put("/api/v1/enterprises/:id/services", async (c) =>
    c.json(
      await service.enterpriseSave(
        c.get("actor"),
        c.req.param("id"),
        await c.req.json(),
      ),
    ),
  );
  app.delete("/api/v1/enterprises/:id/services/:serviceId", async (c) =>
    c.json(
      await service.enterpriseRemove(
        c.get("actor"),
        c.req.param("id"),
        c.req.param("serviceId"),
      ),
    ),
  );
  app.post("/api/v1/enterprises/:id/services/probe", async (c) =>
    c.json(
      await service.enterpriseProbe(
        c.get("actor"),
        c.req.param("id"),
        await c.req.json(),
      ),
    ),
  );
  app.post("/api/v1/admin/services/probe", async (c) =>
    c.json(await service.probe(c.get("actor"), await c.req.json())),
  );
  app.get("/api/v1/admin/service-calls", async (c) =>
    c.json(await service.calls(c.get("actor"))),
  );
  app.post("/api/v1/admin/service-calls/:id/reconcile", async (c) => {
    const { outcome } = z
      .object({ outcome: z.enum(["succeeded", "failed"]) })
      .parse(await c.req.json());
    return c.json(
      await service.reconcile(c.get("actor"), c.req.param("id"), outcome),
    );
  });
  app.post(
    "/api/v1/services/:id/invoke",
    async (c) =>
      await service.invoke(
        c.get("actor"),
        c.req.param("id"),
        await c.req.json(),
      ),
  );
}
