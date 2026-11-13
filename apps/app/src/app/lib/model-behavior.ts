import type { ProviderListItem } from "../types";
import type { ModelBehaviorOption } from "../types";
import { t } from "../../i18n";

type ProviderModel = ProviderListItem["models"][string];

// The Alibaba (China) catalog also lists retired routes and models that need
// a different API. These IDs failed on its OpenAI-compatible chat endpoint.
const unavailableAlibabaChinaChatModels = new Set([
  "deepseek-r1-distill-qwen-1-5b", "deepseek-r1-distill-qwen-7b",
  "deepseek-r1-distill-qwen-14b", "deepseek-r1-distill-qwen-32b",
  "qwen-deep-research", "qwen-math-plus", "qwen-math-turbo", "qwen-mt-turbo",
  "qwen-omni-turbo", "qwen-omni-turbo-realtime", "qwen-turbo", "qwen-vl-max", "qwen-vl-plus",
  "qwen2-5-7b-instruct", "qwen2-5-14b-instruct", "qwen2-5-32b-instruct", "qwen2-5-72b-instruct",
  "qwen2-5-coder-7b-instruct", "qwen2-5-coder-32b-instruct", "qwen2-5-math-7b-instruct",
  "qwen2-5-math-72b-instruct", "qwen2-5-omni-7b", "qwen2-5-vl-7b-instruct", "qwen2-5-vl-72b-instruct",
  "qwen3-8b", "qwen3-14b", "qwen3-32b", "qwen3-235b-a22b", "qwen3-asr-flash",
  "qwen3-coder-30b-a3b-instruct", "qwen3-coder-480b-a35b-instruct", "qwen3-coder-plus",
  "qwen3-max", "qwen3-next-80b-a3b-instruct", "qwen3-next-80b-a3b-thinking",
  "qwen3-omni-flash-realtime", "qwen3-vl-30b-a3b", "qwen3-vl-235b-a22b", "qwen3.6-max-preview",
]);

/**
 * GPT chat routes older than 5.5 are no longer accepted by the supported
 * account runtimes. Keep non-GPT products (for example gpt-image) and other
 * model families available while removing stale GPT chat selections.
 */
export function isSupportedChatModelId(id: string, providerId?: string) {
  const modelId = id.trim().toLowerCase().split("/").at(-1) ?? "";
  if (providerId === "alibaba-cn" && unavailableAlibabaChinaChatModels.has(modelId)) return false;
  const version = /^(?:chat)?gpt-(\d+)(?:\.(\d+))?/.exec(modelId);
  if (!version) return true;
  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 5);
}

export function tokenStarModelSupportsEffort(id: string) {
  return id === "gpt-5.5" || id.startsWith("gpt-5.6-");
}

const WELL_KNOWN_VARIANT_ORDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const VARIANT_DEFAULT_TARGET = 3;
const VARIANT_DEFAULT_SCORE: Record<string, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: VARIANT_DEFAULT_TARGET,
  high: 4,
  xhigh: 5,
  max: 6,
};

function defaultBehaviorOption(): ModelBehaviorOption {
  return {
    value: null,
    label: t("settings.provider_default_label"),
    description: t("settings.provider_default_desc"),
  };
}

const humanize = (value: string) => {
  const cleaned = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return value;
  return cleaned
    .split(" ")
    .flatMap((word) => {
      if (!word) return [];
      if (/\d/.test(word) || word.length <= 3) return [word.toUpperCase()];
      const lower = word.toLowerCase();
      return [lower.charAt(0).toUpperCase() + lower.slice(1)];
    })
    .join(" ");
};

export const normalizeModelBehaviorValue = (value: string | null) => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "balance" ||
    normalized === "balanced" ||
    normalized === "default" ||
    normalized === "provider-default"
  ) {
    return null;
  }
  return normalized;
};

const getVariantKeys = (model: ProviderModel) => {
  const keys = Object.keys(model.variants ?? {}).flatMap((key) => {
    const normalized = normalizeModelBehaviorValue(key);
    return normalized ? [normalized] : [];
  });
  return Array.from(new Set(keys));
};

const sortVariantKeys = (keys: string[]) =>
  keys.slice().sort((a, b) => {
    const aIndex = WELL_KNOWN_VARIANT_ORDER.indexOf(a as (typeof WELL_KNOWN_VARIANT_ORDER)[number]);
    const bIndex = WELL_KNOWN_VARIANT_ORDER.indexOf(b as (typeof WELL_KNOWN_VARIANT_ORDER)[number]);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    return a.localeCompare(b);
  });

const getDefaultVariantKey = (keys: string[]) => {
  let selected: string | null = null;
  let selectedScore: number | null = null;

  for (const key of keys) {
    const score = VARIANT_DEFAULT_SCORE[key];
    if (score == null) continue;
    if (selectedScore == null) {
      selected = key;
      selectedScore = score;
      continue;
    }

    const distance = Math.abs(score - VARIANT_DEFAULT_TARGET);
    const selectedDistance = Math.abs(selectedScore - VARIANT_DEFAULT_TARGET);
    if (distance < selectedDistance || (distance === selectedDistance && score > selectedScore)) {
      selected = key;
      selectedScore = score;
    }
  }

  return selected ?? keys[0] ?? null;
};

const providerFamily = (providerID: string, providerName?: string | null) => {
  const normalizedId = providerID.trim().toLowerCase();
  if (["anthropic", "openai", "google", "opencode"].includes(normalizedId)) {
    return normalizedId;
  }

  const normalizedName = providerName?.trim().toLowerCase() ?? "";
  if (normalizedName.includes("anthropic")) return "anthropic";
  if (normalizedName.includes("openai")) return "openai";
  if (normalizedName.includes("google")) return "google";
  if (normalizedName.includes("opencode")) return "opencode";
  return normalizedId;
};

const getBehaviorTitle = (
  providerID: string,
  model: ProviderModel,
  variantKeys: string[],
  providerName?: string | null,
) => {
  const family = providerFamily(providerID, providerName);
  if (variantKeys.length > 0) {
    if (family === "anthropic") return t("model_behavior.title_extended_thinking");
    if (family === "google") return t("model_behavior.title_reasoning_budget");
    if (
      family === "openai" ||
      family === "opencode" ||
      variantKeys.some((key) => ["none", "minimal", "low", "medium", "high", "xhigh"].includes(key))
    ) {
      return t("model_behavior.title_reasoning_effort");
    }
    return t("app.model_behavior_title");
  }
  if (model.capabilities?.reasoning) return t("model_behavior.title_builtin_reasoning");
  return t("model_behavior.title_standard_generation");
};

const getVariantLabel = (providerID: string, key: string, providerName?: string | null) => {
  const family = providerFamily(providerID, providerName);
  if (key === "none") return t("model_behavior.label_fast");
  if (key === "minimal") return t("model_behavior.label_quick");
  if (key === "low") return t("model_behavior.label_light");
  if (key === "medium") return t("model_behavior.label_balanced");
  if (key === "high") return family === "anthropic" ? t("model_behavior.label_extended") : t("model_behavior.label_deep");
  if (key === "xhigh") return t("model_behavior.label_extra_deep");
  if (key === "max") return t("model_behavior.label_maximum");
  if (key === "ultra") return t("model_behavior.label_ultra");
  return humanize(key);
};

export const formatGenericBehaviorLabel = (value: string | null) => {
  const normalized = normalizeModelBehaviorValue(value);
  if (!normalized) return defaultBehaviorOption().label;
  return getVariantLabel("generic", normalized);
};

const getVariantDescription = (
  providerID: string,
  key: string,
  label: string,
  providerName?: string | null,
) => {
  const family = providerFamily(providerID, providerName);
  if (key === "none") return t("model_behavior.desc_none");
  if (key === "minimal") return t("model_behavior.desc_minimal");
  if (key === "low") return family === "google"
    ? t("model_behavior.desc_low_google")
    : t("model_behavior.desc_low");
  if (key === "medium") return t("model_behavior.desc_medium");
  if (key === "high") return family === "anthropic"
    ? t("model_behavior.desc_high_anthropic")
    : t("model_behavior.desc_high");
  if (key === "xhigh" || key === "max") return family === "anthropic"
    ? t("model_behavior.desc_max_anthropic")
    : t("model_behavior.desc_max");
  return t("model_behavior.desc_generic", { label: label.toLowerCase() });
};

export const getModelBehaviorOptions = (
  providerID: string,
  model: ProviderModel,
  providerName?: string | null,
): ModelBehaviorOption[] => {
  const variantKeys = sortVariantKeys(getVariantKeys(model));
  if (!variantKeys.length) return [];
  return [
    defaultBehaviorOption(),
    ...variantKeys.map((key) => {
      const label = getVariantLabel(providerID, key, providerName);
      return {
        value: key,
        label,
        description: getVariantDescription(providerID, key, label, providerName),
      };
    }),
  ];
};

const getDefaultModelBehaviorValue = (model: ProviderModel) =>
  getDefaultVariantKey(sortVariantKeys(getVariantKeys(model)));

export const sanitizeModelBehaviorValue = (
  providerID: string,
  model: ProviderModel,
  value: string | null,
  providerName?: string | null,
) => {
  const normalized = normalizeModelBehaviorValue(value);
  if (!normalized) return null;
  return getModelBehaviorOptions(providerID, model, providerName).some((option) => option.value === normalized)
    ? normalized
    : null;
};

export const getModelBehaviorSummary = (
  providerID: string,
  model: ProviderModel,
  value: string | null,
  providerName?: string | null,
) => {
  const options = getModelBehaviorOptions(providerID, model, providerName);
  const sanitized = sanitizeModelBehaviorValue(providerID, model, value, providerName);
  const selectedValue = sanitized ?? getDefaultModelBehaviorValue(model);
  const selected = options.find((option) => option.value === selectedValue) ?? options[0] ?? null;
  const title = getBehaviorTitle(providerID, model, getVariantKeys(model), providerName);

  if (options.length > 0) {
    return {
      title,
      label: selected?.label ?? defaultBehaviorOption().label,
      description: selected?.description ?? defaultBehaviorOption().description,
      value: selected?.value ?? null,
      options,
    };
  }

  if (model.capabilities?.reasoning) {
    return {
      title,
      label: t("model_behavior.label_builtin"),
      description: t("model_behavior.desc_builtin"),
      value: null,
      options,
    };
  }

  return {
    title,
    label: t("model_behavior.label_standard"),
    description: t("model_behavior.desc_standard"),
    value: null,
    options,
  };
};
