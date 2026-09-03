type OpenCodeZenPublicModelProfile = {
  name: string;
  agentCompatible: boolean;
  sessionAffinity: boolean;
  contextWindow: number;
  maxTokens: number;
};

const OPENCODE_ZEN_PUBLIC_MODEL_PROFILES = new Map<string, OpenCodeZenPublicModelProfile>([
  ["big-pickle", { name: "Big Pickle", agentCompatible: true, sessionAffinity: true, contextWindow: 200_000, maxTokens: 32_000 }],
  ["hy3-free", { name: "Hy3 Free", agentCompatible: true, sessionAffinity: true, contextWindow: 190_000, maxTokens: 64_000 }],
  ["mimo-v2.5-free", { name: "MiMo-V2.5 Free", agentCompatible: true, sessionAffinity: true, contextWindow: 200_000, maxTokens: 32_000 }],
  ["nemotron-3-ultra-free", { name: "Nemotron 3 Ultra Free", agentCompatible: true, sessionAffinity: true, contextWindow: 1_000_000, maxTokens: 128_000 }],
  ["nemotron-3.5-lightning-free", { name: "Nemotron 3.5 Lightning Free", agentCompatible: true, sessionAffinity: true, contextWindow: 262_144, maxTokens: 262_144 }],
  // Ox is served by Zen's public inference route. A non-empty
  // x-opencode-session currently selects an unavailable Console route, so all
  // engine adapters must deliberately omit session affinity for this model.
  // Zen currently rejects the tool-bearing requests that every iPolloWork
  // agent sends. Keep the historical name/affinity mapping for saved sessions,
  // but restore it to the runnable roster only after that upstream route
  // accepts agent tools again.
  ["x-preview-f-free", { name: "Ox Alpha Free", agentCompatible: false, sessionAffinity: false, contextWindow: 1_000_000, maxTokens: 131_072 }],
]);

export const OPENCODE_ZEN_PUBLIC_DEFAULT_MODEL_ID = "big-pickle";

export function isOpenCodeZenPublicModel(modelId: string): boolean {
  return OPENCODE_ZEN_PUBLIC_MODEL_PROFILES.get(modelId)?.agentCompatible === true;
}

export function openCodeZenPublicModelName(modelId: string): string | undefined {
  return OPENCODE_ZEN_PUBLIC_MODEL_PROFILES.get(modelId)?.name;
}

export function openCodeZenPublicModelUsesSessionAffinity(modelId: string): boolean {
  return OPENCODE_ZEN_PUBLIC_MODEL_PROFILES.get(modelId)?.sessionAffinity !== false;
}

export function openCodeZenPublicModels(): Array<{
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
}> {
  return [...OPENCODE_ZEN_PUBLIC_MODEL_PROFILES].flatMap(([id, profile]) => (
    profile.agentCompatible
      ? [{
          id,
          name: profile.name,
          contextWindow: profile.contextWindow,
          maxTokens: profile.maxTokens,
        }]
      : []
  ));
}
