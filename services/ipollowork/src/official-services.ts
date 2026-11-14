/** Operator-owned starting catalog. Secrets are configured separately and no service starts enabled. */
import type { Store } from "./database.js";
import { billingSchema, rateSchema, type BillingSpec } from "./pricing.js";
import { bailianOperations, serviceModelSchema, type ModelOperation } from "./model-catalog.js";

const bailianModels: Partial<Record<ModelOperation, { id: string; unit: "image" | "video_second" | "audio_second" | "character" | "token"; input?: number; output?: number; resolutions?: { resolution: string; output: number }[] }[]>> = {
  image: [{ id: "qwen-image-3.0", unit: "image", input: .02, output: .18 }, { id: "wan2.6-image", unit: "image", output: .2 }, { id: "wan2.6-t2i", unit: "image", output: .2 }],
  video: ["wan2.7-t2v", "wan2.7-i2v", "wan2.6-t2v", "wan2.6-i2v"].map(id => ({ id, unit: "video_second", resolutions: [{ resolution: "720P", output: .6 }, { resolution: "1080P", output: 1 }] })),
  speech: [{ id: "qwen-audio-3.0-tts-flash", unit: "character", input: .0001 }, { id: "qwen-audio-3.1-tts-plus", unit: "character", input: .00014 }],
  transcription: [{ id: "fun-asr", unit: "audio_second", input: .00022 }, { id: "qwen3-asr-flash-filetrans", unit: "audio_second", input: .00022 }, { id: "paraformer-v2", unit: "audio_second", input: .00008 }],
  embedding: [{ id: "text-embedding-v4", unit: "token", input: .5 }, { id: "qwen3.7-text-embedding", unit: "token", input: .5 }],
};

const verifiedAt = Date.UTC(2026, 10, 14),
  validUntil = Date.UTC(2026, 11, 14);
const bailianSource = "https://help.aliyun.com/zh/model-studio/model-pricing";
const minimaxSource = "https://platform.minimax.cn/docs/pricing/overview";
const tokenRate = (
  model: string,
  input: number,
  output: number,
  context = 1000000,
) => ({
  model,
  inputPerMillion: input * 1000000,
  outputPerMillion: output * 1000000,
  maxInputTokens: context,
  maxOutputTokens: 8192,
});
const billing = (
  kind: BillingSpec["kind"],
  source: string,
  rates: unknown[],
  extra = {},
) =>
  billingSchema.parse({
    kind,
    source,
    rates,
    verifiedAt,
    validUntil,
    ...extra,
  });
const chatRates = [
  tokenRate("qwen3.8-flash", 0.8, 2.7),
  tokenRate("qwen3.8-max", 12, 36),
  tokenRate("vanchin/deepseek-v4.1-flash", 2, 8, 131072),
];
const catalog = [
  {
    id: "official-bailian",
    title: "百炼 · 千问与 DeepSeek",
    provider: "aliyun-bailian",
    keyId: "bailian",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    capabilities: ["chat"],
    routes: [{ method: "POST", path: "/chat/completions", points: 0 }],
    billing: billing("chat", bailianSource, chatRates),
    models: chatRates.map((rate) => ({
      id: rate.model,
      name: rate.model,
      contextWindow: rate.maxInputTokens,
      maxTokens: rate.maxOutputTokens,
    })),
  },
  {
    id: "official-minimax-image",
    title: "MiniMax · 图片",
    provider: "minimax",
    keyId: "minimax",
    baseUrl: "https://api.minimax.cn",
    capabilities: ["image"],
    routes: [
      { method: "POST", path: "/v1/images/generations", points: 0 },
      { method: "POST", path: "/v1/images/edits", points: 0 },
    ],
    billing: billing("image", minimaxSource, [
      {
        ...tokenRate("MiniMax-H3-Image", 15, 25, 524288),
        imageInputPerMillion: 10000000,
        maxOutputTokens: 32768,
      },
    ]),
    models: [],
  },
  {
    id: "official-minimax-video",
    title: "MiniMax · H3 视频",
    provider: "minimax",
    keyId: "minimax",
    baseUrl: "https://api.minimax.cn",
    capabilities: ["video"],
    routes: [
      {
        method: "POST",
        path: "/v2/video_generation",
        points: 0,
        jobResultField: "task_id",
      },
      { method: "GET", path: "/v2/query/video_generation/:id", points: 0 },
    ],
    billing: billing("video", minimaxSource, [tokenRate("MiniMax-H3", 0, 0)], {
      second768: 500000,
      second2k: 800000,
      imageInput: 200000,
    }),
    models: [],
  },
  {
    id: "official-bailian-speech",
    title: "百炼 · 语音生成",
    provider: "aliyun-bailian",
    keyId: "bailian",
    baseUrl: "https://dashscope.aliyuncs.com",
    capabilities: ["speech"],
    routes: [
      {
        method: "POST",
        path: "/api/v1/services/aigc/multimodal-generation/generation",
        points: 0,
      },
    ],
    billing: billing(
      "speech",
      bailianSource,
      [tokenRate("qwen3-tts-flash", 0, 0)],
      { charactersPerTenThousand: 800000 },
    ),
    models: [],
  },
];

/** Seed only missing records; operator edits, credentials and enabled states are never overwritten. */
export async function seedOfficialServices(store: Store): Promise<void> {
  for (const entry of catalog)
    await store.run(
      "INSERT INTO execution_services VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      entry.id,
      entry.title,
      entry.provider,
      entry.baseUrl,
      entry.keyId,
      "Authorization",
      "Bearer ",
      JSON.stringify(entry.capabilities),
      JSON.stringify(entry.routes),
      JSON.stringify({
        ids: [],
        models: entry.models.length
          ? entry.models.map((model) => ({ ...model, category: "language" }))
          : entry.billing.rates.map((rate) => ({
              id: rate.model,
              name: rate.model,
              category:
                entry.billing.kind === "speech" ? "audio" : entry.billing.kind,
            })),
        category:
          entry.billing.kind === "chat"
            ? "language"
            : entry.billing.kind === "speech"
              ? "audio"
              : entry.billing.kind,
        vendor: entry.provider,
        billing: entry.billing,
        timeoutMs: 600000,
      }),
      0,
      Date.now(),
    );
  for (const [operation, models] of Object.entries(bailianModels)) {
    const kind = operation as ModelOperation;
    const config = bailianOperations[kind];
    const id = "official-bailian-" + (kind === "transcription" ? "asr" : kind);
    const existing = await store.one("SELECT plan_ids FROM execution_services WHERE id=?", id);
    const details = existing ? JSON.parse(String(existing.plan_ids)) : {};
    const rates = models.map(model => ({
      model: model.id, unit: model.unit,
      inputPerMillion: model.unit === "token" ? Math.round((model.input ?? 0) * 1_000_000) : 0,
      outputPerMillion: 0,
      inputUnitPrice: model.unit === "token" ? 0 : Math.round((model.input ?? 0) * 1_000_000),
      outputUnitPrice: Math.round((model.output ?? 0) * 1_000_000),
      maxInputTokens: 32768, maxOutputTokens: 8192,
      maxUnits: model.unit === "audio_second" ? 3600 : model.unit === "image" ? 10 : 15,
      tiers: model.resolutions?.map(row => ({ resolution: row.resolution, outputUnitPrice: Math.round(row.output * 1_000_000) })) ?? [],
    }));
    const oldModels = new Map(serviceModelSchema.array().parse(details.models ?? []).map(model => [model.id, model]));
    const oldRates = new Map(rateSchema.array().parse(details.billing?.rates ?? []).map(rate => [rate.model, rate]));
    for (const model of models) if (!oldModels.has(model.id)) oldModels.set(model.id, { id: model.id, name: model.id, category: config.category, enabled: true });
    for (const rate of rates) if (!oldRates.has(rate.model)) oldRates.set(rate.model, rateSchema.parse(rate));
    const nextBilling = billingSchema.parse({ kind: kind === "transcription" ? "audio" : kind, protocol: "dashscope", source: bailianSource, verifiedAt, validUntil, ...details.billing, rates: [...oldRates.values()] });
    const next = { ...details, ids: details.ids ?? [], category: config.category, vendor: "aliyun-bailian", models: [...oldModels.values()], billing: nextBilling, timeoutMs: details.timeoutMs ?? 600000 };
    await store.run("INSERT INTO execution_services VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET plan_ids=excluded.plan_ids", id, "百炼 · " + config.title, "aliyun-bailian", "https://dashscope.aliyuncs.com" + config.basePath, "bailian", "Authorization", "Bearer ", JSON.stringify([kind]), JSON.stringify(config.routes), JSON.stringify(next), 0, Date.now());
  }
  await store.run("INSERT INTO execution_services VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING", "official-bailian-other", "百炼 · 其他模型", "aliyun-bailian", "https://dashscope.aliyuncs.com", "bailian", "Authorization", "Bearer ", JSON.stringify(["tool"]), "[]", JSON.stringify({ ids: [], category: "tool", vendor: "aliyun-bailian", models: [], timeoutMs: 600000 }), 0, Date.now());
  for (const plan of [
    {
      id: "ipollo-standard",
      name: "标准套餐",
      amount: 9900,
      points: 40000,
      description:
        "30 天会员，40,000 积分；按官方服务用量扣除，可使用自己的 Key",
    },
    {
      id: "ipollo-pro",
      name: "专业套餐",
      amount: 29900,
      points: 160000,
      description:
        "30 天会员，160,000 积分；按官方服务用量扣除，可使用自己的 Key",
    },
  ])
    await store.run(
      "INSERT INTO plans VALUES(?,?,?,?,?,'CNY',?,30,0,NULL,?,NULL) ON CONFLICT(id) DO NOTHING",
      plan.id,
      plan.name,
      plan.description,
      "membership",
      plan.amount,
      plan.points,
      Date.now(),
    );
}
