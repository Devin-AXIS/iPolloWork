/** Operator-owned starting catalog. Secrets are configured separately and no service starts enabled. */
import { arkModelGroups, arkBilling, arkServiceId, arkProvider } from "./ark-models.js";
import { bailianChatPresets } from "./bailian-models.js";
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
const arkSource = "https://console.volcengine.com/ark/region:cn-beijing/docs/model-pricing";
const arkVideoRates = [
  { id: "doubao-seedance-2-0-260128", seconds: 15, prices: [["480p", 46, 28, 691200], ["720p", 46, 28, 1555200], ["1080p", 51, 31, 3499200], ["4k", 26, 16, 13996800]] as const },
  { id: "doubao-seedance-2-5-260628", seconds: 30, prices: [["480p", 70, 42, 691200], ["720p", 70, 42, 1555200], ["1080p", 77, 46, 3499200]] as const },
].map(model => ({
  model: model.id, unit: "video_token", maxInputTokens: 1, maxOutputTokens: 1,
  outputPerMillion: Math.max(...model.prices.map(([, plain]) => plain)) * 1000000,
  maxUnits: model.seconds, maxFramesPerSecond: 24,
  tiers: model.prices.flatMap(([resolution, plain, reference, maxVideoPixels]) => [
    { resolution, videoInput: false, outputPerMillion: plain * 1000000, maxVideoPixels },
    { resolution, videoInput: true, outputPerMillion: reference * 1000000, maxVideoPixels },
  ]),
}));
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
const catalog = [
  {
    id: "official-bailian",
    title: "百炼 · 语言模型",
    provider: "aliyun-bailian",
    keyId: "bailian",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    capabilities: ["chat"],
    routes: [{ method: "POST", path: "/chat/completions", points: 0 }],
    billing: billing("chat", bailianSource, bailianChatPresets.map(entry => entry.rate)),
    models: bailianChatPresets.map(entry => entry.model),
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
  {
    id: "official-volcengine-video", title: "火山 · Seedance 2.0 / 2.5", provider: "volcengine-video", keyId: "volcengine-video",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3", capabilities: ["video"],
    routes: [{ method: "POST", path: "/contents/generations/tasks", points: 0, jobResultField: "id" }, { method: "GET", path: "/contents/generations/tasks/:id", points: 0 }],
    billing: billing("video", arkSource, arkVideoRates, { protocol: "ark", maxInputVideoSeconds: 30 }), models: [],
  },
  {
    id: "official-volcengine-image", title: "火山 · Seedream 5.5", provider: "volcengine-video", keyId: "volcengine-video",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3", capabilities: ["image"],
    routes: [{ method: "POST", path: "/images/generations", points: 0 }],
    billing: billing("image", arkSource, [
      { model: "doubao-seedream-5-5-261028", unit: "image", maxInputTokens: 1, maxOutputTokens: 1, maxUnits: 100, inputUnitPrice: 50000, outputUnitPrice: 230000,
        tiers: [{ upToPixels: 2610000, inputUnitPrice: 50000, outputUnitPrice: 130000 }, { upToPixels: 4630000, inputUnitPrice: 50000, outputUnitPrice: 230000 }] },
      { model: "doubao-seedream-5-0-260128", unit: "image", maxInputTokens: 1, maxOutputTokens: 1, maxUnits: 15, outputUnitPrice: 220000 },
    ], { protocol: "ark" }), models: [],
  },
];

/** Add missing presets and recommendation metadata; preserve operator values and credentials. */
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
  const chatRow = await store.one("SELECT plan_ids FROM execution_services WHERE id=?", "official-bailian");
  const chatDetails = JSON.parse(String(chatRow!.plan_ids));
  const chatModels = new Map(serviceModelSchema.array().parse(chatDetails.models).map(model => [model.id, model]));
  const chatRates = new Map(rateSchema.array().parse(chatDetails.billing?.rates ?? []).map(rate => [rate.model, rate]));
  for (const entry of bailianChatPresets) {
    const previous = chatModels.get(entry.model.id);
    chatModels.set(entry.model.id, { ...entry.model, ...previous, recommended: previous?.recommended ?? true });
    if (!chatRates.has(entry.rate.model)) chatRates.set(entry.rate.model, entry.rate);
  }
  const chatBilling = chatDetails.billing ?? billing("chat", bailianSource, [...chatRates.values()]);
  await store.run("UPDATE execution_services SET plan_ids=? WHERE id=?", JSON.stringify({ ...chatDetails, models: [...chatModels.values()], billing: { ...chatBilling, rates: [...chatRates.values()] } }), "official-bailian");
  await store.run("UPDATE execution_services SET title=? WHERE id=? AND title=?", "百炼 · 语言模型", "official-bailian", "百炼 · 千问与 DeepSeek");
  for (const [operation, group] of Object.entries(arkModelGroups)) {
    const kind = operation as keyof typeof arkModelGroups;
    const id = arkServiceId(kind);
    const row = await store.one("SELECT plan_ids FROM execution_services WHERE id=?", id);
    const existing = row ? JSON.parse(String(row.plan_ids)) : {};
    const models = new Map(serviceModelSchema.array().parse(existing.models ?? []).map(model => [model.id, model]));
    const rates = new Map(rateSchema.array().parse(existing.billing?.rates ?? []).map(rate => [rate.model, rate]));
    for (const model of group.models) if (!models.has(model.id)) models.set(model.id, serviceModelSchema.parse(model));
    for (const rate of group.rates) if (!rates.has(rate.model)) rates.set(rate.model, rate);
    const baseBilling = existing.billing ?? arkBilling(kind);
    const billing = baseBilling && rates.size ? billingSchema.parse({ ...baseBilling, rates: [...rates.values()] }) : undefined;
    const details = { ...existing, ids: existing.ids ?? [], category: group.category, vendor: arkProvider, models: [...models.values()], billing, timeoutMs: existing.timeoutMs ?? 600000 };
    const speech = group.baseUrl === "https://openspeech.bytedance.com";
    await store.run("INSERT INTO execution_services VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET plan_ids=excluded.plan_ids", id, "火山 · " + group.title, arkProvider, group.baseUrl, arkProvider, speech ? "X-Api-Key" : "Authorization", speech ? "" : "Bearer ", JSON.stringify([operation.startsWith("transcription")?"transcription":operation]), JSON.stringify(group.routes), JSON.stringify(details), 0, Date.now());
  }
  await store.run("UPDATE execution_services SET title=? WHERE id=? AND title=?", "火山 · Seedream 图像", "official-volcengine-image", "火山 · Seedream 5.5");
  await store.run("UPDATE execution_services SET title=? WHERE id=? AND title=?", "火山 · Seedance 视频", "official-volcengine-video", "火山 · Seedance 2.0 / 2.5");
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
