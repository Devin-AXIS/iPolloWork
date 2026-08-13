import { compareProviders } from "@/app/utils/providers";
import type {
  ProviderAuthMethod,
  ProviderAuthProvider,
} from "./store";

export type ProviderAuthEntry = {
  id: string;
  name: string;
  methods: ProviderAuthMethod[];
  connected: boolean;
  env: string[];
  variantIds?: string[];
  variantNames?: string[];
  recommended?: boolean;
};

type BuildProviderAuthEntriesOptions = {
  authMethods: Record<string, ProviderAuthMethod[]>;
  connectedProviderIds: string[];
  providers: ProviderAuthProvider[];
  isRemoteWorker: boolean;
  showiPolloWorkModelsSubscribe: boolean;
};

const IPOLLOWORK_MODELS_PROVIDER_ID = "ipollowork";

export const PROVIDER_LABELS: Record<string, string> = {
  ipollowork: "iPolloWork",
  opencode: "iPolloWork Built-in Models",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  qwen: "Qwen",
  tokenstar: "TokenStar",
};

const RECOMMENDED_PROVIDER_IDS = [
  IPOLLOWORK_MODELS_PROVIDER_ID,
  "openai",
  "anthropic",
  "google",
  "alibaba-cn",
  "kimi-for-coding",
  "minimax-cn",
  "stepfun",
  "deepseek",
  "zhipuai",
  "mistral",
  "cohere",
  "perplexity",
  "meta",
  "amazon-bedrock",
  "azure",
  "github-copilot",
  "xai",
] as const;

const RECOMMENDED_PROVIDER_SET = new Set<string>(RECOMMENDED_PROVIDER_IDS);

const COLLAPSED_PROVIDER_GROUPS = [
  {
    canonicalId: "alibaba-cn",
    name: "Qwen / Alibaba Cloud",
    variantIds: [
      "qwen",
      "alibaba",
      "alibaba-coding-plan",
      "alibaba-coding-plan-cn",
      "alibaba-token-plan",
      "alibaba-token-plan-cn",
    ],
  },
  {
    canonicalId: "kimi-for-coding",
    name: "Kimi / Moonshot AI",
    variantIds: ["moonshotai", "moonshotai-cn"],
  },
  {
    canonicalId: "minimax-cn",
    name: "MiniMax",
    variantIds: ["minimax", "minimax-coding-plan", "minimax-cn-coding-plan"],
  },
  {
    canonicalId: "stepfun",
    name: "StepFun",
    variantIds: ["stepfun-ai", "stepfun-step-plan", "stepfun-ai-step-plan"],
  },
  {
    canonicalId: "zhipuai",
    name: "Zhipu AI",
    variantIds: ["zhipuai-coding-plan"],
  },
  {
    canonicalId: "siliconflow-cn",
    name: "SiliconFlow",
    variantIds: ["siliconflow"],
  },
  {
    canonicalId: "xiaomi-token-plan-cn",
    name: "Xiaomi",
    variantIds: ["xiaomi", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp"],
  },
  {
    canonicalId: "tencent-tokenhub",
    name: "Tencent",
    variantIds: ["tencent-coding-plan", "tencent-token-plan"],
  },
] as const;

const COLLAPSED_VARIANT_TO_CANONICAL = new Map<string, string>();
for (const group of COLLAPSED_PROVIDER_GROUPS) {
  for (const id of group.variantIds) {
    COLLAPSED_VARIANT_TO_CANONICAL.set(id, group.canonicalId);
  }
}

export function formatProviderAuthName(id: string, fallback?: string | null) {
  const normalized = id.trim();
  const mapped = PROVIDER_LABELS[normalized.toLowerCase()];
  if (mapped) return mapped;

  const named = fallback?.trim();
  if (named) return named;

  const cleaned = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return id;

  return cleaned
    .split(" ")
    .flatMap((word) => {
      if (!word) return [];
      if (/\d/.test(word) || word.length <= 3) {
        return [word.toUpperCase()];
      }
      const lower = word.toLowerCase();
      return [lower.charAt(0).toUpperCase() + lower.slice(1)];
    })
    .join(" ");
}

export const isOpenAiProvider = (id: string, fallbackName?: string | null) => {
  const normalizedId = id.trim().toLowerCase();
  const normalizedName = fallbackName?.trim().toLowerCase() ?? "";
  return normalizedId === "openai" || normalizedName === "openai";
};

export const isAnthropicProvider = (id: string, fallbackName?: string | null) => {
  const normalizedId = id.trim().toLowerCase();
  const normalizedName = fallbackName?.trim().toLowerCase() ?? "";
  return normalizedId === "anthropic" || normalizedName === "anthropic";
};

const isOpenAiHeadlessMethod = (method: ProviderAuthMethod) => {
  const label = method.label.toLowerCase();
  return method.type === "oauth" && (label.includes("headless") || label.includes("device"));
};

const isClaudeProMaxMethod = (method: ProviderAuthMethod) => {
  const label = method.label.toLowerCase();
  return method.type === "oauth" && (label.includes("pro/max") || label.includes("create an api key"));
};

const getRecommendedRank = (id: string) => {
  const index = RECOMMENDED_PROVIDER_IDS.indexOf(id as (typeof RECOMMENDED_PROVIDER_IDS)[number]);
  return index === -1 ? RECOMMENDED_PROVIDER_IDS.length : index;
};

const compareRecommendedEntries = (a: ProviderAuthEntry, b: ProviderAuthEntry) => {
  const rankDiff = getRecommendedRank(a.id) - getRecommendedRank(b.id);
  if (rankDiff !== 0) return rankDiff;
  return compareProviders(a, b);
};

export const buildProviderAuthEntries = (options: BuildProviderAuthEntriesOptions): ProviderAuthEntry[] => {
  const methods = options.authMethods ?? {};
  const connected = new Set(options.connectedProviderIds ?? []);
  const providers = options.providers ?? [];
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const entriesById = new Map<string, ProviderAuthEntry>();

  for (const id of Object.keys(methods)) {
    const provider = providersById.get(id);
    const entryMethods = (methods[id] ?? []).filter((method) => {
      if (isAnthropicProvider(id, provider?.name) && isClaudeProMaxMethod(method)) {
        return false;
      }
      if (!isOpenAiProvider(id, provider?.name)) return true;
      if (method.type !== "oauth") return true;
      if (options.isRemoteWorker) return isOpenAiHeadlessMethod(method);
      return !isOpenAiHeadlessMethod(method);
    });
    if (entryMethods.length === 0) continue;

    entriesById.set(id, {
      id,
      name: formatProviderAuthName(id, provider?.name),
      methods: entryMethods,
      connected: connected.has(id),
      env: Array.isArray(provider?.env) ? provider.env : [],
      recommended: RECOMMENDED_PROVIDER_SET.has(id),
    });
  }

  if (options.showiPolloWorkModelsSubscribe) {
    entriesById.set(IPOLLOWORK_MODELS_PROVIDER_ID, {
      id: IPOLLOWORK_MODELS_PROVIDER_ID,
      name: "iPolloWork",
      methods: [{ type: "cloud", label: "Subscribe" }],
      connected: connected.has(IPOLLOWORK_MODELS_PROVIDER_ID),
      env: [],
      recommended: true,
    });
  }

  for (const group of COLLAPSED_PROVIDER_GROUPS) {
    const canonical = entriesById.get(group.canonicalId);
    if (!canonical) continue;

    const variants = group.variantIds
      .map((id) => entriesById.get(id))
      .filter((entry): entry is ProviderAuthEntry => Boolean(entry));
    if (!variants.length) continue;

    entriesById.set(group.canonicalId, {
      ...canonical,
      name: group.name,
      connected: canonical.connected || variants.some((entry) => entry.connected),
      variantIds: variants.map((entry) => entry.id),
      variantNames: variants.map((entry) => entry.name),
      recommended: true,
    });
  }

  return Array.from(entriesById.values()).sort(compareProviders);
};

export const getProviderAuthEntryGroups = (entries: ProviderAuthEntry[], searchQuery: string) => {
  const query = searchQuery.trim().toLowerCase();
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const matches = (entry: ProviderAuthEntry) => {
    if (!query) return true;
    const methodText = entry.methods
      .map((method) => method.label || (method.type === "oauth" ? "OAuth" : "API key"))
      .join(" ");
    const variantText = [...(entry.variantIds ?? []), ...(entry.variantNames ?? [])].join(" ");
    return `${entry.name} ${entry.id} ${variantText} ${methodText}`.toLowerCase().includes(query);
  };

  if (query) {
    const matched = new Map<string, ProviderAuthEntry>();
    for (const entry of entries) {
      if (!matches(entry)) continue;
      const canonicalId = COLLAPSED_VARIANT_TO_CANONICAL.get(entry.id);
      const canonical = canonicalId ? entriesById.get(canonicalId) : null;
      const visibleEntry = canonical ?? entry;
      matched.set(visibleEntry.id, visibleEntry);
    }
    return {
      recommended: Array.from(matched.values()).sort(compareRecommendedEntries),
      more: [] as ProviderAuthEntry[],
    };
  }

  const recommended = entries
    .filter((entry) => entry.recommended && !COLLAPSED_VARIANT_TO_CANONICAL.has(entry.id))
    .sort(compareRecommendedEntries);
  const more = entries
    .filter((entry) => !entry.recommended && !COLLAPSED_VARIANT_TO_CANONICAL.has(entry.id))
    .sort(compareProviders);

  return { recommended, more };
};

export const getProviderAuthEntryVariantLabel = (entry: ProviderAuthEntry) => {
  const names = entry.variantNames ?? [];
  if (!names.length) return null;
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
};
