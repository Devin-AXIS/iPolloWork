/** Discoverable model capabilities over the existing authorized, metered execution service. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "./auth.js";
import type { Store, Row } from "./database.js";
import type { App } from "./http.js";
import type { ExecutionService } from "./execution.js";
import { ServiceError } from "./errors.js";
import { capabilityInputs, capabilityKinds, capabilityRequest, invocationPath, type CapabilityKind, type CapabilityRoute } from "./capability-protocol.js";

type CatalogService = Awaited<ReturnType<ExecutionService["catalog"]>>["items"][number];
const titles: Record<CapabilityKind, string> = { chat: "语言对话", image: "图片生成与编辑", video: "视频生成", speech: "语音合成", transcription: "语音识别", embedding: "文本向量", rerank: "文本重排" };
const protocols: Record<CapabilityKind, readonly string[]> = { chat: ["openai", "dashscope", "ark"], image: ["openai", "dashscope", "ark"], video: ["dashscope", "ark"], speech: ["openai", "dashscope", "volcengine-speech"], transcription: ["dashscope", "volcengine-speech"], embedding: ["openai", "dashscope", "ark"], rerank: ["openai", "dashscope"] };
const invokeSchema = z.object({ requestId: z.uuid(), model: z.string().min(1).max(200).optional(), input: z.unknown() }).strict();
const pageSchema = z.object({ offset: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(100).default(25) });
const jsonObject = z.record(z.string(), z.unknown());
interface Entry { id: string; kind: CapabilityKind; service: CatalogService; models: CatalogService["models"] }
interface CallRow extends Row { id: string; service_id: string; state: string; response_body: string | null; response_type: string | null; job_id: string | null; points: number; cost_micros: number | null }

function entries(services: CatalogService[]): Entry[] {
  return services.flatMap(service => capabilityKinds.flatMap(kind => {
    if (!service.available || !service.capabilities.includes(kind) || !protocols[kind].includes(service.protocol)) return [];
    const models = service.models.filter(model => invocationPath(service.provider, model, service.routes) !== undefined);
    return models.length ? [{ id: `${service.id}:${kind}`, kind, service, models }] : [];
  }));
}
function summary(entry: Entry) {
  return { id: entry.id, kind: entry.kind, title: `${entry.service.title} · ${titles[entry.kind]}`, modelCount: entry.models.length };
}
function result(requestId: string, body: unknown, kind: CapabilityKind, capability?: string, submittedJob = false) {
  const root = jsonObject.parse(body);
  const nested = root.output && typeof root.output === "object" && !Array.isArray(root.output) ? jsonObject.parse(root.output) : root;
  const status = String(nested.task_status ?? nested.status ?? "").toLowerCase();
  const failed = ["failed", "canceled", "cancelled", "expired"].includes(status) || Boolean(root.error);
  const pending = ["pending", "running", "queued", "processing", "in_progress"].includes(status) || (submittedJob && !status && !failed);
  return { requestId, ...(capability ? { capability } : {}), kind, state: failed ? "failed" : pending ? "pending" : "succeeded", result: root,
    ...(pending ? { task: `/api/v1/capability-tasks/${requestId}` } : {}) };
}
/** Metadata and execution share one catalog; only already-authorized models can be selected. */
export class Capabilities {
  constructor(private execution: ExecutionService, private store: Store) {}
  private async entry(actor: Actor, id: string): Promise<Entry> {
    const entry = entries((await this.execution.catalog(actor)).items).find(entry => entry.id === id);
    if (!entry) throw new ServiceError("CAPABILITY_UNAVAILABLE", 404, "该能力未启用、未授权或尚未配置调用接口");
    return entry;
  }
  /** List concise capability summaries, with detailed schemas loaded separately.
   * @param actor Current account identity.
   * @param kind Optional capability-kind filter.
   * @returns Available authorized capability summaries.
   */
  async list(actor: Actor, kind?: string) {
    if (kind && !capabilityKinds.includes(kind as CapabilityKind)) throw new ServiceError("CAPABILITY_KIND_INVALID", 400);
    return { version: 1, items: entries((await this.execution.catalog(actor)).items).filter(entry => !kind || entry.kind === kind).map(summary) };
  }
  /** Describe a capability's inputs and a bounded page of its models.
   * @param actor Current account identity.
   * @param id Discovered capability identifier.
   * @param query Model selection and pagination fields.
   * @returns Input schema, model metadata and invocation instructions.
   */
  async describe(actor: Actor, id: string, query: { offset?: unknown; limit?: unknown; model?: string } = {}) {
    const entry = await this.entry(actor, id);
    const { offset, limit } = pageSchema.parse(query);
    const selected = query.model ? entry.models.find(model => model.id === query.model) : undefined;
    if (query.model && !selected) throw new ServiceError("CAPABILITY_MODEL_UNAVAILABLE", 400);
    const modelList = selected ? [selected] : entry.models.slice(offset, offset + limit);
    return { ...summary(entry), inputSchema: z.toJSONSchema(capabilityInputs[entry.kind]),
      models: modelList.map(model => ({ id: model.id, name: model.name, inputModalities: entry.kind === "transcription" ? ["audio"] : entry.kind === "image" && (entry.service.protocol === "ark" || invocationPath(entry.service.provider, model, entry.service.routes)?.endsWith("multimodal-generation/generation")) ? ["text", "image"] : entry.kind === "video" && (entry.service.protocol === "ark" || invocationPath(entry.service.provider, model, entry.service.routes)?.includes("image2video")) ? ["text", "image"] : entry.kind === "chat" ? (model.inputModalities ?? ["text"]).filter(modality => modality === "text" || modality === "image") : ["text"],
        limits: entry.service.limits.find(limit => limit.model === model.id) ?? null })),
      nextOffset: !selected && offset + limit < entry.models.length ? offset + limit : null,
      execution: { method: "POST", path: `/api/v1/capabilities/${encodeURIComponent(id)}/invoke`, requestId: "UUID; reuse the same ID when checking or retrying the same request", asynchronous: entry.service.routes.some(route => route.async || route.jobResultField),
        result: "state, requestId and provider result; pending jobs expose a task URL" } };
  }
  /** Execute one typed request through the existing billing and request-id deduplication.
   * @param actor Current account identity.
   * @param id Discovered capability identifier.
   * @param raw Untrusted invocation JSON.
   * @returns Provider result or a receipt for an unfinished task.
   */
  async invoke(actor: Actor, id: string, raw: unknown) {
    const input = invokeSchema.parse(raw);
    const entry = await this.entry(actor, id);
    const model = input.model ? entry.models.find(model => model.id === input.model) : entry.models.find(model => model.recommended) ?? entry.models[0];
    if (!model) throw new ServiceError("CAPABILITY_MODEL_UNAVAILABLE", 400);
    const path = invocationPath(entry.service.provider, model, entry.service.routes);
    if (!path) throw new ServiceError("CAPABILITY_ROUTE_UNAVAILABLE", 400);
    const body = capabilityRequest(entry.kind, entry.service.protocol, path, model.id, input.input);
    const response = await this.execution.invoke(actor, entry.service.id, { requestId: input.requestId, method: "POST", path, contentType: "application/json", body: Buffer.from(JSON.stringify(body)).toString("base64") });
    return this.response(input.requestId, entry.kind, response, entry.id, Boolean(entry.service.routes.find(route => route.path === path)?.jobResultField));
  }
  private async response(id: string, kind: CapabilityKind, response: Response, capability?: string, submittedJob = false) {
    if (!response.headers.get("content-type")?.includes("json")) {
      const data = Buffer.from(await response.arrayBuffer());
      return { requestId: id, kind, capability, state: "succeeded", result: { mimeType: response.headers.get("content-type"), base64: data.toString("base64") } };
    }
    return result(id, await response.json(), kind, capability, submittedJob);
  }
  /** Read only the owner's receipt; refresh provider jobs without submitting the creation request again.
   * @param actor Current account identity.
   * @param id Original invocation request UUID.
   * @returns Stored result, refreshed task state or an unresolved receipt.
   */
  async task(actor: Actor, id: string) {
    z.uuid().parse(id);
    const call = await this.store.one<CallRow>("SELECT id,service_id,state,response_body,response_type,job_id,points,cost_micros FROM service_calls WHERE id=? AND user_id=?", id, actor.id);
    if (!call) throw new ServiceError("CAPABILITY_TASK_NOT_FOUND", 404);
    const available = entries((await this.execution.catalog(actor)).items).find(entry => entry.service.id === call.service_id);
    if (!available) throw new ServiceError("CAPABILITY_UNAVAILABLE", 403);
    if (call.state !== "succeeded") return { requestId: id, kind: available.kind, state: call.state === "running" ? "pending" : call.state,
      ...(call.state === "unknown" ? { message: "结果尚未确认，请查询此任务或联系管理员，不要换请求编号重复提交" } : {}) };
    if (!call.job_id) {
      if (!call.response_body) throw new ServiceError("CAPABILITY_RESULT_EXPIRED", 410);
      return this.response(id, available.kind, new Response(Buffer.from(call.response_body, "base64"), { headers: { "content-type": call.response_type ?? "application/json" } }), available.id);
    }
    const latest = await this.store.one<CallRow>("SELECT id,service_id,state,response_body,response_type,job_id,points,cost_micros FROM service_calls WHERE user_id=? AND service_id=? AND job_id=? AND id<>? AND state='succeeded' ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT 1", actor.id, call.service_id, call.job_id, call.id);
    if (latest?.response_body) {
      const body: unknown = JSON.parse(Buffer.from(latest.response_body, "base64").toString("utf8"));
      const state = result(id, body, available.kind, available.id);
      if (state.state !== "pending" && latest.id !== call.id) return state;
    }
    const route = (available.service.routes as CapabilityRoute[]).find(route => (route.method === "GET" && route.path.includes(":id")) || route.jobField);
    if (!route) throw new ServiceError("CAPABILITY_TASK_POLL_UNAVAILABLE", 409);
    const response = await this.execution.invoke(actor, call.service_id, { requestId: randomUUID(), method: route.method,
      path: route.path.replace(":id", encodeURIComponent(call.job_id)),
      ...(route.method === "POST" && route.jobField ? { contentType: "application/json", body: Buffer.from(JSON.stringify({ [route.jobField]: call.job_id })).toString("base64") } : {}) });
    return this.response(id, available.kind, response, available.id);
  }
}
/** Mount capability routes under the same account, permission and billing checks as existing services.
 * @param app Authenticated account router.
 * @param capabilities Authorized discovery and invocation provider.
 */
export function mountCapabilities(app: App, capabilities: Capabilities) {
  app.get("/api/v1/capabilities", async c => c.json(await capabilities.list(c.get("actor"), c.req.query("kind"))));
  app.get("/api/v1/capabilities/:id", async c => c.json(await capabilities.describe(c.get("actor"), c.req.param("id"), c.req.query())));
  app.post("/api/v1/capabilities/:id/invoke", async c => c.json(await capabilities.invoke(c.get("actor"), c.req.param("id"), await c.req.json())));
  app.get("/api/v1/capability-tasks/:id", async c => c.json(await capabilities.task(c.get("actor"), c.req.param("id"))));
}
