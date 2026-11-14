/** Provider usage is priced in integer millionths of CNY; one credit covers 0.001 CNY. */
import { z } from "zod";
import type { Config } from "./config.js";
import { ServiceError } from "./errors.js";

const price = z.number().int().nonnegative().max(1_000_000_000);
const unitPrices = z.object({
  inputPerMillion: price.default(0),
  outputPerMillion: price.default(0),
  cachedInputPerMillion: price.optional(),
  cacheWritePerMillion: price.optional(),
  inputUnitPrice: price.default(0),
  outputUnitPrice: price.default(0),
  maxVideoPixels: z.number().int().positive().optional(),
});
/** Stored model rates use integer micro-CNY and explicit units. */
export const rateSchema = unitPrices.extend({
  model: z.string().min(1),
  free: z.boolean().default(false),
  unit: z.enum(["token", "video_token", "image", "video_second", "audio_second", "character", "request"]).optional(),
  imageInputPerMillion: price.default(0),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxUnits: z.number().positive().max(86400).default(60),
  maxFramesPerSecond: z.number().int().positive().max(120).default(24),
  tiers: z.array(unitPrices.extend({
    upToInputTokens: z.number().int().positive().optional(),
    resolution: z.string().max(60).optional(),
    audio: z.boolean().optional(),
    videoInput: z.boolean().optional(),
    upToPixels: z.number().int().positive().optional(),
  })).max(30).default([]),
});
/** A model's base rate and optional context or media variants. */
export type ModelRate = z.infer<typeof rateSchema>;
export const billingSchema = z
  .object({
    kind: z.enum(["chat", "image", "speech", "video", "embedding", "audio", "request"]),
    protocol: z.enum(["openai", "dashscope", "ark"]).default("openai"),
    source: z.url(),
    verifiedAt: z.number().int().positive(),
    validUntil: z.number().int().positive(),
    rates: z.array(rateSchema).min(1).max(5000),
    charactersPerTenThousand: price.default(0),
    second768: price.default(0),
    second2k: price.default(0),
    imageInput: price.default(0),
    maxInputVideoSeconds: z.number().int().nonnegative().default(60),
  })
  .strict();
export type BillingSpec = z.infer<typeof billingSchema>;
export interface BillingReservation {
  spec: BillingSpec;
  model: string;
  resolution?: string;
  micros: number;
  rate?: ModelRate;
  inputUnits?: number;
}

/** Provider-cost value of one credit, in millionths of CNY. */
export const CREDIT_MICROS = 1000;

/** A zero-valued draft is not a free model unless an operator explicitly marks it free.
 * @param spec The stored provider pricing record, when present.
 * @param model Model identifier to check.
 * @returns Whether the operator has declared a charge or explicitly marked it free.
 */
export function hasModelPrice(spec: BillingSpec | undefined, model: string): boolean {
  const rate = spec?.rates.find(rate => rate.model === model);
  if (!spec || !rate) return false;
  return rate.free || rate.inputPerMillion > 0 || rate.outputPerMillion > 0 || rate.inputUnitPrice > 0 || rate.outputUnitPrice > 0
    || rate.tiers.some(tier => tier.inputPerMillion > 0 || tier.outputPerMillion > 0 || tier.inputUnitPrice > 0 || tier.outputUnitPrice > 0)
    || (rate.unit === undefined && (spec.charactersPerTenThousand > 0 || spec.second768 > 0 || spec.second2k > 0));
}

function scaled(units: number, rate: number, divisor: number): number {
  if (!Number.isSafeInteger(units) || units < 0)
    throw new ServiceError("SERVICE_INVALID_USAGE", 503);
  return Number(
    (BigInt(units) * BigInt(rate) + BigInt(divisor - 1)) / BigInt(divisor),
  );
}
export const costCredits = (micros: number): number => scaled(micros, 1, CREDIT_MICROS);
const object = z.record(z.string(), z.unknown());
const units = z.number().int().nonnegative();

/** Select a model's resolution/audio variant or context tier; absent variants are rejected. */
function selectRate(rate: ModelRate, body: Record<string, unknown>, tokens: number): ModelRate {
  if (!rate.tiers.length) return rate;
  const parameters = object.parse(body.parameters ?? {});
  const resolution = String(parameters.resolution ?? body.resolution ?? parameters.size ?? body.size ?? "").toLowerCase();
  const audio = parameters.audio ?? body.audio;
  const videoInput = Array.isArray(body.content) && body.content.some(item => item && typeof item === "object" && "type" in item && item.type === "video_url");
  const matches = rate.tiers.filter(tier =>
    (tier.resolution === undefined || tier.resolution.toLowerCase() === resolution)
    && (tier.audio === undefined || tier.audio === audio)
    && (tier.videoInput === undefined || tier.videoInput === videoInput)
    && (tier.upToInputTokens === undefined || tokens <= tier.upToInputTokens),
  ).sort((a, b) => (a.upToInputTokens ?? Infinity) - (b.upToInputTokens ?? Infinity));
  const selected = matches[0];
  if (!selected) throw new ServiceError("SERVICE_PRICE_VARIANT_REQUIRED", 400, "请选择已定价的分辨率或模型参数");
  return { ...rate, ...selected };
}

function imagePixels(size: unknown): number {
  const match = typeof size === "string" ? /^(\d+)x(\d+)$/.exec(size) : null;
  if (!match) throw new ServiceError("SERVICE_INVALID_USAGE", 503);
  return Number(match[1]) * Number(match[2]);
}

function imageRate(rate: ModelRate, pixels: number): ModelRate {
  if (!rate.tiers.some(tier => tier.upToPixels !== undefined)) return rate;
  const tier = rate.tiers.filter(tier => tier.upToPixels !== undefined && pixels <= tier.upToPixels).sort((a, b) => a.upToPixels! - b.upToPixels!)[0];
  if (!tier) throw new ServiceError("SERVICE_PRICE_VARIANT_REQUIRED", 400);
  return { ...rate, ...tier };
}

function inputImages(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + inputImages(entry), 0);
  if (!value || typeof value !== "object") return 0;
  const entry = object.parse(value);
  if (typeof entry.image === "string" || entry.type === "image_url" || entry.type === "input_image") return 1;
  return Object.values(entry).reduce<number>((sum, entry) => sum + inputImages(entry), 0);
}

/** Read a terminal provider result. Pending tasks retain their pre-debited credits.
 * @param response Untrusted provider JSON.
 * @returns The parsed body and its pending or failed task state.
 */
export function terminalUsage(response: unknown): { body: Record<string, unknown>; pending: boolean; failed: boolean } {
  const body = object.parse(response);
  const task = object.parse(body.output ?? body.task ?? body);
  const status = String(task.task_status ?? task.status ?? "").toLowerCase();
  return { body, pending: ["pending", "running", "processing", "queued"].includes(status), failed: ["failed", "cancelled", "canceled", "expired"].includes(status) };
}

function meteredReservation(spec: BillingSpec, rate: ModelRate, body: Record<string, unknown>): BillingReservation {
  const parameters = object.parse(body.parameters ?? {});
  const selected = spec.protocol === "ark" && rate.unit === "image" ? imageRate(rate,
    typeof body.size === "string" && /^\d+x\d+$/.test(body.size) ? imagePixels(body.size)
      : body.size === "1K" || body.size === "1.5K" ? 2_610_000 : 4_630_000,
  ) : selectRate(rate, rate.unit === "video_token" ? { ...body, resolution: body.resolution ?? "720p" } : body, rate.maxInputTokens);
  let input = 0, output = 0;
  switch (selected.unit) {
    case "image":
      input = spec.protocol === "ark" ? (Array.isArray(body.image) ? z.array(z.string()).parse(body.image).length : typeof body.image === "string" ? 1 : 0) : inputImages(body.input ?? body.images ?? body.messages ?? {});
      if (input > selected.maxUnits) throw new ServiceError("SERVICE_INPUT_LIMIT", 400);
      output = z.number().int().positive().max(selected.maxUnits).parse(body.layer_decomposition === true ? object.parse(body.layer_decomposition_options ?? {}).max_images ?? 30 : object.parse(body.sequential_image_generation_options ?? {}).max_images ?? parameters.n ?? body.n ?? (body.sequential_image_generation === "auto" ? 15 : 1));
      break;
    case "video_token": {
      const content = z.array(object).parse(body.content);
      if (content.some(item => item.type === "draft_task")) throw new ServiceError("SERVICE_OPERATION_UNPRICED", 400, "样片续生成需要单独核定计费");
      const duration = z.number().int().min(-1).max(selected.maxUnits).parse(body.duration ?? -1);
      if (duration !== -1 && duration < 4) throw new ServiceError("SERVICE_INPUT_LIMIT", 400);
      const videos = content.filter(item => item.type === "video_url").length;
      const outputFrames = body.frames === undefined ? (duration === -1 ? selected.maxUnits : duration) * selected.maxFramesPerSecond : z.number().int().positive().max(selected.maxUnits * selected.maxFramesPerSecond + 1).parse(body.frames);
      const frames = outputFrames + videos * spec.maxInputVideoSeconds * selected.maxFramesPerSecond;
      if (!selected.maxVideoPixels) throw new ServiceError("SERVICE_PRICE_INVALID", 400);
      const tokens = Math.ceil(frames * selected.maxVideoPixels / 1024);
      return { spec, rate: selected, model: rate.model, micros: scaled(tokens, selected.outputPerMillion, 1000000) };
    }
    case "video_second":
      output = z.number().positive().max(selected.maxUnits).parse(parameters.duration ?? body.duration);
      input = selected.inputUnitPrice > 0 ? selected.maxUnits : 0;
      break;
    case "audio_second":
      input = selected.maxUnits;
      break;
    case "character": {
      const content = object.parse(body.input ?? body).text;
      input = Array.from(z.string().max(200000).parse(content ?? body.text)).reduce((count, character) => count + (spec.protocol === "dashscope" && /[\p{Script=Han}\p{Script=Hangul}]/u.test(character) ? 2 : 1), 0);
      break;
    }
    case "request": output = 1; break;
    default: throw new ServiceError("SERVICE_PRICE_INVALID", 400);
  }
  return { spec, rate: selected, model: rate.model, inputUnits: input, micros: Math.ceil(input * selected.inputUnitPrice + output * selected.outputUnitPrice) };
}

function meteredCost(reservation: BillingReservation, response: unknown): number | null {
  const state = terminalUsage(response);
  if (state.pending) return null;
  if (state.failed) return 0;
  const rate = reservation.rate!;
  const usage = object.parse(state.body.usage ?? object.parse(state.body.output ?? {}).usage ?? {});
  let input = reservation.inputUnits ?? 0, output = 0;
  switch (rate.unit) {
    case "image": {
      output = units.parse(usage.image_count ?? usage.output_image_count ?? usage.generated_images);
      if (reservation.spec.protocol === "ark") {
        input = units.parse(usage.input_images ?? input);
        const images = z.array(object).parse(state.body.data);
        const succeeded = images.filter(image => !image.error);
        if (succeeded.length !== output) throw new ServiceError("SERVICE_INVALID_USAGE", 503);
        return input * rate.inputUnitPrice + succeeded.reduce((sum, image) => sum + imageRate(rate, imagePixels(image.size)).outputUnitPrice, 0);
      }
      break;
    }
    case "video_token": return scaled(units.parse(usage.completion_tokens), rate.outputPerMillion, 1000000);
    case "video_second":
      input = z.number().nonnegative().parse(usage.input_video_duration ?? usage.input_seconds ?? 0);
      output = z.number().nonnegative().parse(usage.output_video_duration ?? usage.duration ?? usage.output_seconds);
      break;
    case "audio_second": input = z.number().nonnegative().parse(usage.duration ?? usage.audio_duration ?? usage.seconds); break;
    case "character":
      if (state.body.code || state.body.error) throw new ServiceError("SERVICE_INVALID_USAGE", 503);
      break;
    case "request": output = 1; break;
    default: throw new ServiceError("SERVICE_PRICE_INVALID", 503);
  }
  return Math.ceil(input * rate.inputUnitPrice + output * rate.outputUnitPrice);
}

/** Prepare a conservative hold before dispatch and request authoritative usage when supported. */
export function reserveUsage(
  spec: BillingSpec,
  body: Record<string, unknown>,
): BillingReservation {
  if (spec.validUntil <= Date.now())
    throw new ServiceError(
      "SERVICE_PRICE_EXPIRED",
      503,
      "服务价格需要重新核对",
    );
  const rate = spec.rates.find((rate) => rate.model === body.model);
  if (!rate || !hasModelPrice(spec, String(body.model))) throw new ServiceError("SERVICE_MODEL_UNAVAILABLE", 403);
  if (body.enable_search === true || (Array.isArray(body.tools) && body.tools.some(tool => tool && typeof tool === "object" && "type" in tool && /web_search|web_fetch/.test(String(tool.type)))))
    throw new ServiceError("SERVICE_OPERATION_UNPRICED", 400, "模型内置联网工具尚未配置计费");
  if (rate.free) {
    if (body.stream) body.stream_options = { ...object.parse(body.stream_options ?? {}), include_usage: true };
    return { spec, model: rate.model, micros: 0 };
  }
  if (rate.unit && rate.unit !== "token") return meteredReservation(spec, rate, body);
  if (spec.kind === "speech" && rate.unit === undefined) {
    const text = z.string().max(20000).parse(object.parse(body.input).text);
    return {
      spec,
      model: rate.model,
      micros: scaled(
        Array.from(text).reduce((count, character) => count + (spec.protocol === "dashscope" && /[\p{Script=Han}\p{Script=Hangul}]/u.test(character) ? 2 : 1), 0),
        spec.charactersPerTenThousand,
        10000,
      ),
    };
  }
  if (spec.kind === "video") {
    const duration = z.number().int().min(4).max(15).parse(body.duration);
    const resolution = z.enum(["768P", "2K"]).parse(body.resolution);
    const content = z.array(object).max(20).parse(body.content);
    const images = content.filter((item) => item.type === "image_url").length;
    const videos = content.filter((item) => item.type === "video_url").length;
    body.response_format = "task";
    const micros =
      (duration + videos * spec.maxInputVideoSeconds) *
        (resolution === "2K" ? spec.second2k : spec.second768) +
      Math.max(0, images - 5) * spec.imageInput;
    return { spec, model: rate.model, resolution, micros };
  }
  if (spec.kind === "image") {
    z.string().trim().min(1).max(32000).parse(body.prompt);
    if (body.images !== undefined) z.array(object).max(16).parse(body.images);
    const count = z
      .number()
      .int()
      .min(1)
      .max(10)
      .parse(body.n ?? 1);
    body.response_format = "url";
    return {
      spec,
      model: rate.model,
      micros:
        scaled(
          rate.maxInputTokens,
          Math.max(rate.inputPerMillion, rate.imageInputPerMillion),
          1000000,
        ) +
        scaled(rate.maxOutputTokens * count, rate.outputPerMillion, 1000000),
    };
  }
  const maximum = z
    .number()
    .int()
    .positive()
    .max(rate.maxOutputTokens)
    .parse(
      body.max_completion_tokens ?? body.max_tokens ?? object.parse(body.parameters ?? {}).max_tokens ?? rate.maxOutputTokens,
    );
  if (body.stream)
    body.stream_options = {
      ...object.parse(body.stream_options ?? {}),
      include_usage: true,
    };
  const bytes = Buffer.byteLength(JSON.stringify(body));
  const inputBody = typeof body.input === "object" && body.input !== null && !Array.isArray(body.input) ? object.parse(body.input) : {};
  const messages = spec.kind === "embedding" || (spec.kind === "speech" && inputBody.text !== undefined) ? [object.parse({ content: body.input })] : z.array(object).min(1).parse(body.messages ?? inputBody.messages);
  const multimodal = JSON.stringify(messages).includes('"image_url"');
  if (!multimodal && bytes + 2048 > rate.maxInputTokens)
    throw new ServiceError("SERVICE_INPUT_LIMIT", 400);
  const input = multimodal ? rate.maxInputTokens : bytes + 2048;
  const selected = selectRate(rate, body, input);
  return {
    spec,
    model: rate.model,
    rate: selected,
    micros:
      scaled(input, Math.max(selected.inputPerMillion, selected.cachedInputPerMillion ?? 0, selected.cacheWritePerMillion ?? 0), 1000000) +
      scaled(spec.kind === "embedding" ? 0 : maximum, selected.outputPerMillion, 1000000),
  };
}

/** Return verified cost, or null while an asynchronous task is still running. */
export function usageCost(
  reservation: BillingReservation,
  response: unknown,
): number | null {
  const body = object.parse(response),
    spec = reservation.spec,
    rate = spec.rates.find((rate) => rate.model === reservation.model)!;
  if (rate.free) return 0;
  if (reservation.rate?.unit && reservation.rate.unit !== "token") return meteredCost(reservation, body);
  if (spec.kind === "video") {
    const task = object.parse(body.task ?? body);
    if (["failed", "cancelled", "canceled"].includes(String(task.status)))
      return 0;
    if (task.status !== "succeeded") return null;
    const usage = object.parse(task.usage),
      seconds =
        units.parse(usage.input_seconds) + units.parse(usage.output_seconds);
    return (
      seconds *
        (reservation.resolution === "2K" ? spec.second2k : spec.second768) +
      Math.max(0, units.parse(usage.input_image_count) - 5) * spec.imageInput
    );
  }
  if (spec.kind === "speech" && rate.unit === undefined) {
    if (body.code || body.error)
      throw new ServiceError("SERVICE_INVALID_USAGE", 503);
    return reservation.micros;
  }
  const usage = object.parse(body.usage);
  if (spec.kind === "image") {
    const input = object.parse(usage.input_tokens_details);
    return (
      scaled(units.parse(input.text_tokens), rate.inputPerMillion, 1000000) +
      scaled(
        units.parse(input.image_tokens),
        rate.imageInputPerMillion,
        1000000,
      ) +
      scaled(units.parse(usage.output_tokens), rate.outputPerMillion, 1000000)
    );
  }
  const input = units.parse(usage.prompt_tokens ?? usage.input_tokens ?? usage.total_tokens);
  const chosen = reservation.rate && rate.tiers.some(tier => tier.upToInputTokens !== undefined) ? selectRate(rate, { parameters: {} }, input) : reservation.rate ?? rate;
  const details = object.parse(usage.prompt_tokens_details ?? usage.input_tokens_details ?? {});
  const cached = units.parse(usage.prompt_cache_hit_tokens ?? details.cached_tokens ?? 0);
  const written = units.parse(usage.cache_creation_input_tokens ?? 0);
  if (cached + written > input) throw new ServiceError("SERVICE_INVALID_USAGE", 503);
  return (
    scaled(input - cached - written, chosen.inputPerMillion, 1000000)
    + scaled(cached, chosen.cachedInputPerMillion ?? chosen.inputPerMillion, 1000000)
    + scaled(written, chosen.cacheWritePerMillion ?? chosen.inputPerMillion, 1000000)
    + scaled(units.parse(usage.completion_tokens ?? usage.output_tokens ?? (spec.kind === "embedding" ? 0 : undefined)), chosen.outputPerMillion, 1000000)
  );
}

/** Decode the terminal JSON/SSE usage record; incomplete streams never receive a guessed charge. */
export function usageResponse(bytes: Buffer, contentType: string): unknown {
  const text = bytes.toString("utf8");
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);
  let terminal: unknown;
  for (const line of text.split(/\r?\n/))
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload === "[DONE]" || !payload) continue;
      const value = object.parse(JSON.parse(payload));
      if (value.usage !== undefined) terminal = value;
    }
  if (!terminal) throw new ServiceError("SERVICE_USAGE_MISSING", 503);
  return terminal;
}

/** A sold credit balance cannot exceed net revenue after fees and the required margin. */
export function validatePlanPrice(
  plan: {
    kind: string;
    amount: number;
    currency: string;
    points: number;
    pointsCost: number | null;
    enabled: boolean;
  },
  policy: Pick<
    Config,
    "paymentFeeBps" | "minimumMarginBps" | "membershipOperatingReserveFen"
  >,
): void {
  if (!plan.enabled || !plan.points) return;
  if (plan.pointsCost !== null) {
    if (plan.pointsCost < plan.points)
      throw new ServiceError(
        "PLAN_BELOW_COST",
        400,
        "兑换积分不得少于赠送积分",
      );
    return;
  }
  if (plan.currency !== "CNY")
    throw new ServiceError(
      "PLAN_CURRENCY_UNPRICED",
      400,
      "请先配置该币种的成本汇率",
    );
  if (!planBudget(plan.amount, plan.points, plan.kind, policy).allowed)
    throw new ServiceError(
      "PLAN_BELOW_COST",
      400,
      "套餐价格低于成本保护线，请调整价格或积分",
    );
}

/** Calculate the sellable credit ceiling after configured fees, operating reserve and margin.
 * @param amount Plan price in fen.
 * @param points Credits included in the plan.
 * @param kind Whether the plan reserves membership operating costs.
 * @param policy Configured fee, margin and operating allowances.
 * @returns Cost allowances, remaining revenue and whether the credit amount fits.
 */
export function planBudget(amount: number, points: number, kind: string, policy: Pick<Config, "paymentFeeBps" | "minimumMarginBps" | "membershipOperatingReserveFen">) {
  const feeFen = Math.ceil(amount * policy.paymentFeeBps / 10000);
  const reserveFen = kind === "membership" ? policy.membershipOperatingReserveFen : 0;
  const netFen = Math.max(0, amount - feeFen - reserveFen);
  const maximumPoints = Math.floor(netFen * (10000 - policy.minimumMarginBps) / 10000) * 10;
  const modelCostFen = Math.ceil(points / 10);
  return { feeFen, reserveFen, maximumPoints, modelCostFen, remainingFen: amount - feeFen - reserveFen - modelCostFen, allowed: points <= maximumPoints };
}
