export const TOKENSTAR_PROVIDER = {
  providerId: "tokenstar",
  name: "TokenStar",
  baseURL: "https://api.tokenstar.io/v1",
  fallbackModels: [
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
    { id: "gpt-5.5", name: "GPT 5.5" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
  ],
};

export type TokenStarModel = {
  id: string;
  name: string;
};

const humanizeModelName = (id: string) =>
  id
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

export function tokenStarModelName(id: string) {
  return TOKENSTAR_PROVIDER.fallbackModels.find((model) => model.id === id)?.name ?? humanizeModelName(id);
}

export function tokenStarModelSupportsEffort(id: string) {
  return id === "gpt-5.5" || id.startsWith("gpt-5.6-");
}

export function tokenStarRuntimeModels(modelIds: string[]) {
  return Object.fromEntries(
    modelIds.map((id) => [
      id,
      {
        name: tokenStarModelName(id),
        ...(tokenStarModelSupportsEffort(id)
          ? { variants: { low: {}, medium: {}, high: {} } }
          : {}),
      },
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTokenStarModels(value: unknown): TokenStarModel[] {
  const rawModels = isRecord(value) && Array.isArray(value.data) ? value.data : [];
  const seen = new Set<string>();
  return rawModels.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    const id = entry.id.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const name = typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : tokenStarModelName(id);
    return [{ id, name }];
  });
}
