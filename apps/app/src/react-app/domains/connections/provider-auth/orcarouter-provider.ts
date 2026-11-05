export const ORCAROUTER_PROVIDER = {
  providerId: "orcarouter",
  name: "OrcaRouter",
  baseURL: "https://api.orcarouter.ai/v1",
  signupUrl: "https://www.orcarouter.ai",
  fallbackModels: [
    { id: "orcarouter/auto", name: "OrcaRouter Auto" },
    { id: "openai/gpt-5.5", name: "GPT-5.5" },
    { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "qwen/qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "minimax/minimax-m2.7", name: "MiniMax M2.7" },
    { id: "grok/grok-4.3", name: "Grok 4.3" },
  ],
};

export type OrcaRouterModel = {
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

export function orcarouterModelName(id: string) {
  return (
    ORCAROUTER_PROVIDER.fallbackModels.find((model) => model.id === id)?.name ??
    humanizeModelName(id)
  );
}

export function orcarouterRuntimeModels(modelIds: string[]) {
  return Object.fromEntries(
    modelIds.map((id) => [
      id,
      {
        name: orcarouterModelName(id),
      },
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOrcaRouterModels(value: unknown): OrcaRouterModel[] {
  const rawModels = isRecord(value) && Array.isArray(value.data) ? value.data : [];
  const seen = new Set<string>();
  return rawModels.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    const id = entry.id.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const name = typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : orcarouterModelName(id);
    return [{ id, name }];
  });
}
