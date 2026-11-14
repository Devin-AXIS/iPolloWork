/** Shared model metadata for discovery, operator editing and the public catalog. */
import { z } from "zod";
import { serviceCategories, type ServiceCategory } from "./service-categories.js";
import { rateSchema, type ModelRate } from "./pricing.js";
import { ServiceError } from "./errors.js";

/** Operator and provider model records accepted by the catalog. */
export const serviceModelSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  category: z.enum(serviceCategories).optional(),
  contextWindow: z.number().int().min(1024).optional(),
  maxTokens: z.number().int().min(1).optional(),
  enabled: z.boolean().optional(),
  capabilities: z.array(z.string()).max(50).optional(),
});
/** Public model metadata without credentials or billing records. */
export type ServiceModel = z.infer<typeof serviceModelSchema>;
/** Supported HTTP operations; unknown protocols remain in the disabled tool group. */
export type ModelOperation = "chat" | "image" | "video" | "speech" | "transcription" | "embedding" | "tool";

/** Routes are provider-owned; model discovery cannot introduce arbitrary endpoints. */
export const bailianOperations: Record<ModelOperation, {
  category: ServiceCategory; title: string; basePath: string;
  routes: { method: "GET" | "POST"; path: string; points: number; async?: boolean; jobResultField?: string }[];
}> = {
  chat: { category: "language", title: "语言模型", basePath: "/compatible-mode/v1", routes: [{ method: "POST", path: "/chat/completions", points: 0 }] },
  image: { category: "image", title: "图像生成", basePath: "", routes: [
    { method: "POST", path: "/api/v1/services/aigc/multimodal-generation/generation", points: 0 },
    { method: "POST", path: "/api/v1/services/aigc/text2image/image-synthesis", points: 0, async: true, jobResultField: "output.task_id" },
    { method: "POST", path: "/api/v1/services/aigc/image2image/image-synthesis", points: 0, async: true, jobResultField: "output.task_id" },
    { method: "GET", path: "/api/v1/tasks/:id", points: 0 },
  ] },
  video: { category: "video", title: "视频生成", basePath: "", routes: [
    { method: "POST", path: "/api/v1/services/aigc/video-generation/video-synthesis", points: 0, async: true, jobResultField: "output.task_id" },
    { method: "POST", path: "/api/v1/services/aigc/image2video/video-synthesis", points: 0, async: true, jobResultField: "output.task_id" },
    { method: "GET", path: "/api/v1/tasks/:id", points: 0 },
  ] },
  speech: { category: "audio", title: "语音合成", basePath: "", routes: [{ method: "POST", path: "/api/v1/services/aigc/multimodal-generation/generation", points: 0 }] },
  transcription: { category: "audio", title: "语音识别", basePath: "", routes: [
    { method: "POST", path: "/api/v1/services/audio/asr/transcription", points: 0, async: true, jobResultField: "output.task_id" },
    { method: "POST", path: "/api/v1/services/aigc/multimodal-generation/generation", points: 0 },
    { method: "GET", path: "/api/v1/tasks/:id", points: 0 },
  ] },
  embedding: { category: "embedding", title: "向量模型", basePath: "/compatible-mode/v1", routes: [{ method: "POST", path: "/embeddings", points: 0 }] },
  tool: { category: "tool", title: "其他模型", basePath: "", routes: [] },
};

const priceItem = z.object({ type: z.string(), price: z.coerce.number().nonnegative(), price_unit: z.string(), time_band: z.string().optional() });
const listingSchema = z.object({
  success: z.boolean(),
  output: z.object({ total: z.number().int().nonnegative().max(5000), models: z.array(z.object({
    model: z.string().min(1).max(200), name: z.string().optional(),
    capabilities: z.array(z.string()).default([]),
    model_info: z.object({ context_window: z.number().nullable().optional(), max_output_tokens: z.number().nullable().optional() }).nullable().optional(),
    prices: z.array(z.object({ range_name: z.string(), prices: z.array(priceItem) })).default([]),
  })).max(100) }),
});

/** Decode one official page. Unrecognized prices stay unpriced and cannot be enabled.
 * @param raw Untrusted JSON from the official model directory.
 * @returns Classified model records and supported prices without enabling new models.
 */
export function parseBailianPage(raw: unknown): { total: number; items: { model: ServiceModel; operation: ModelOperation; rate?: ModelRate }[] } {
  const page = listingSchema.parse(raw);
  if (!page.success) throw new ServiceError("SERVICE_DISCOVERY_FAILED", 503, "百炼模型目录请求失败");
  return { total: page.output.total, items: page.output.models.map(entry => {
    const caps = entry.capabilities;
    const operation: ModelOperation = caps.includes("TG") || caps.includes("Reasoning") ? "chat"
      : caps.includes("IG") ? "image" : caps.includes("VG") ? "video"
      : caps.includes("TTS") || caps.includes("Realtime-Text-to-Speech") ? "speech"
      : caps.includes("ASR") || caps.includes("Realtime-ASR") ? "transcription"
      : caps.includes("TR") || caps.includes("ME") ? "embedding" : "tool";
    const model: ServiceModel = { id: entry.model, name: entry.name || entry.model, category: bailianOperations[operation].category, enabled: false, capabilities: caps };
    if (entry.model_info?.context_window) model.contextWindow = entry.model_info.context_window;
    if (entry.model_info?.max_output_tokens) model.maxTokens = entry.model_info.max_output_tokens;
    const rates = entry.prices.map(group => {
      const values: Record<string, number> = {};
      let unit: ModelRate["unit"];
      for (const p of group.prices) {
        if (p.time_band && !["standard", "peak"].includes(p.time_band)) continue;
        const micros = Math.round(p.price * 1_000_000);
        if (/百万.*token|million.*token/i.test(p.price_unit)) {
          unit = "token";
          if (p.type === "input_token") values.inputPerMillion = Math.max(values.inputPerMillion ?? 0, micros);
          else if (p.type === "output_token") values.outputPerMillion = Math.max(values.outputPerMillion ?? 0, micros);
          else if (["cache_read_input_token", "input_token_cache_hit"].includes(p.type)) values.cachedInputPerMillion = Math.max(values.cachedInputPerMillion ?? 0, micros);
          else if (p.type === "cache_creation_input_token") values.cacheWritePerMillion = Math.max(values.cacheWritePerMillion ?? 0, micros);
          else return undefined;
        } else {
          const nextUnit: ModelRate["unit"] = /张|image/i.test(p.price_unit) ? "image"
            : /字符|character/i.test(p.price_unit) ? "character"
            : /秒|second/i.test(p.price_unit) ? operation === "video" ? "video_second" : "audio_second" : undefined;
          if (!nextUnit || (unit && unit !== nextUnit)) return undefined;
          unit = nextUnit;
          const amount = nextUnit === "character" && /万|10000|10,000/.test(p.price_unit) ? micros / 10000 : micros;
          if (p.type.startsWith("input")) values.inputUnitPrice = Math.max(values.inputUnitPrice ?? 0, Math.round(amount));
          else if (p.type.startsWith("output")) values.outputUnitPrice = Math.max(values.outputUnitPrice ?? 0, Math.round(amount));
          else return undefined;
        }
      }
      if (!unit || (unit === "token" && (values.inputPerMillion === undefined || (operation === "chat" && values.outputPerMillion === undefined)))) return undefined;
      const range = group.range_name === "Default" ? undefined : /<=\s*([\d.]+)\s*([kKmM])?/.exec(group.range_name);
      const resolution = /^(?:\d{3,4}p|[1248]k)$/i.test(group.range_name) ? group.range_name : undefined;
      if (group.range_name !== "Default" && !range && !resolution) return undefined;
      const upToInputTokens = range ? Number(range[1]) * (range[2]?.toLowerCase() === "m" ? 1_000_000 : range[2] ? 1000 : 1) : undefined;
      return { ...values, unit, ...(upToInputTokens ? { upToInputTokens } : {}), ...(resolution ? { resolution } : {}) };
    });
    let rate: ModelRate | undefined;
    if (rates.length && rates.every(value => value !== undefined) && (rates[0].unit !== "token" || (model.contextWindow && (model.maxTokens || operation === "embedding")) )) {
      const largest = rates.reduce((a, b) => (a.upToInputTokens ?? Infinity) > (b.upToInputTokens ?? Infinity) ? a : b);
      rate = rateSchema.parse({ model: model.id, ...largest, maxInputTokens: model.contextWindow ?? 131072, maxOutputTokens: model.maxTokens ?? 8192, maxUnits: operation === "transcription" ? 3600 : operation === "image" ? 10 : 15, tiers: rates.length > 1 || rates.some(rate => "resolution" in rate || "upToInputTokens" in rate) ? rates.map(({ unit: _unit, ...value }) => value) : [] });
    }
    return { model, operation, ...(rate ? { rate } : {}) };
  }) };
}
