/** Operator-owned starting catalog. Secrets are configured separately and no service starts enabled. */
import type { Store } from "./database.js";
import { billingSchema, type BillingSpec } from "./pricing.js";

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
        models: entry.models,
        billing: entry.billing,
        timeoutMs: 600000,
      }),
      0,
      Date.now(),
    );
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
