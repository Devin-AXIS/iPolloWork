export const TOKENSTAR_PROVIDER = {
  providerId: "tokenstar",
  name: "TokenStar",
  baseURL: "https://api.tokenstar.io/v1",
  fallbackModels: [
    { id: "gpt-5.6", name: "GPT 5.6" },
    { id: "kimi-k3", name: "Kimi K3" },
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
      : humanizeModelName(id);
    return [{ id, name }];
  });
}

