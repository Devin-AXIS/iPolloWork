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
