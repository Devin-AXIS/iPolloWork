export const CHEAPER_INFERENCE_PROVIDER = {
  providerId: "cheaperinference",
  name: "Cheaper Inference",
  baseURL: "https://api.cheaperinference.com/v1",
  signupUrl: "https://cheaperinference.com/signup",
  fallbackModels: [
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "glm-5.3", name: "GLM-5.3" },
  ],
};

export type CheaperInferenceModel = {
  id: string;
  name: string;
};

const humanizeModelName = (id: string) => {
  const gatewaySlug = id.split("/").at(-1) ?? id;
  return gatewaySlug
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .flatMap((word) => {
      if (!word) return [];
      if (/\d/.test(word) || word.length <= 3) return [word.toUpperCase()];
      const lower = word.toLowerCase();
      return [lower.charAt(0).toUpperCase() + lower.slice(1)];
    })
    .join(" ");
};

export function cheaperInferenceModelName(id: string) {
  return (
    CHEAPER_INFERENCE_PROVIDER.fallbackModels.find((model) => model.id === id)?.name ??
    humanizeModelName(id)
  );
}

export function cheaperInferenceRuntimeModels(modelIds: string[]) {
  return Object.fromEntries(
    modelIds.map((id) => [
      id,
      {
        name: cheaperInferenceModelName(id),
      },
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCheaperInferenceModels(value: unknown): CheaperInferenceModel[] {
  const rawModels = isRecord(value) && Array.isArray(value.data) ? value.data : [];
  const seen = new Set<string>();
  return rawModels.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    if (typeof entry.type === "string" && entry.type !== "text") return [];
    const id = entry.id.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const name = typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : cheaperInferenceModelName(id);
    return [{ id, name }];
  });
}
