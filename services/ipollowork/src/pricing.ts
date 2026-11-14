/** Provider usage is priced in integer millionths of CNY; one credit covers 0.001 CNY. */
import { z } from "zod";
import type { Config } from "./config.js";
import { ServiceError } from "./errors.js";

const price = z.number().int().nonnegative().max(1_000_000_000);
const rateSchema = z.object({
  model: z.string().min(1),
  inputPerMillion: price,
  outputPerMillion: price,
  imageInputPerMillion: price.default(0),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
});
export const billingSchema = z
  .object({
    kind: z.enum(["chat", "image", "speech", "video"]),
    source: z.url(),
    verifiedAt: z.number().int().positive(),
    validUntil: z.number().int().positive(),
    rates: z.array(rateSchema).min(1).max(100),
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
}

function scaled(units: number, rate: number, divisor: number): number {
  if (!Number.isSafeInteger(units) || units < 0)
    throw new ServiceError("SERVICE_INVALID_USAGE", 503);
  return Number(
    (BigInt(units) * BigInt(rate) + BigInt(divisor - 1)) / BigInt(divisor),
  );
}
export const costCredits = (micros: number): number => scaled(micros, 1, 1000);
const object = z.record(z.string(), z.unknown());
const units = z.number().int().nonnegative();

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
  if (!rate) throw new ServiceError("SERVICE_MODEL_UNAVAILABLE", 403);
  if (spec.kind === "speech") {
    const text = z.string().max(20000).parse(object.parse(body.input).text);
    return {
      spec,
      model: rate.model,
      micros: scaled(
        Array.from(text).length,
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
      body.max_completion_tokens ?? body.max_tokens ?? rate.maxOutputTokens,
    );
  if (body.stream)
    body.stream_options = {
      ...object.parse(body.stream_options ?? {}),
      include_usage: true,
    };
  const bytes = Buffer.byteLength(JSON.stringify(body));
  const messages = z.array(object).min(1).parse(body.messages);
  const multimodal = JSON.stringify(messages).includes('"image_url"');
  if (!multimodal && bytes + 2048 > rate.maxInputTokens)
    throw new ServiceError("SERVICE_INPUT_LIMIT", 400);
  const input = multimodal ? rate.maxInputTokens : bytes + 2048;
  return {
    spec,
    model: rate.model,
    micros:
      scaled(input, rate.inputPerMillion, 1000000) +
      scaled(maximum, rate.outputPerMillion, 1000000),
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
  if (spec.kind === "speech") {
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
  return (
    scaled(units.parse(usage.prompt_tokens), rate.inputPerMillion, 1000000) +
    scaled(units.parse(usage.completion_tokens), rate.outputPerMillion, 1000000)
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
  const net =
    (BigInt(plan.amount) * BigInt(10000 - policy.paymentFeeBps)) / 10000n -
    BigInt(
      plan.kind === "membership" ? policy.membershipOperatingReserveFen : 0,
    );
  const budget = (net * BigInt(10000 - policy.minimumMarginBps)) / 10000n;
  if (budget < (BigInt(plan.points) + 9n) / 10n)
    throw new ServiceError(
      "PLAN_BELOW_COST",
      400,
      "套餐价格低于成本保护线，请调整价格或积分",
    );
}
