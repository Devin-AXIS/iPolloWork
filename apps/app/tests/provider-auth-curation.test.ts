import { describe, expect, test } from "bun:test";

import {
  buildProviderAuthEntries,
  formatProviderAuthName,
  getProviderAuthEntryGroups,
} from "../src/react-app/domains/connections/provider-auth/provider-auth-curation";
import type {
  ProviderAuthMethod,
  ProviderAuthProvider,
} from "../src/react-app/domains/connections/provider-auth/store";

const apiMethods: Record<string, ProviderAuthMethod[]> = {
  "302ai": [{ type: "api", label: "API key" }],
  alibaba: [{ type: "api", label: "API key" }],
  "alibaba-cn": [{ type: "api", label: "API key" }],
  "alibaba-coding-plan": [{ type: "api", label: "API key" }],
  "kimi-for-coding": [{ type: "api", label: "API key" }],
  lmstudio: [{ type: "api", label: "API key" }],
  "minimax-cn": [{ type: "api", label: "API key" }],
  mistral: [{ type: "api", label: "API key" }],
  "moonshotai-cn": [{ type: "api", label: "API key" }],
  modelscope: [{ type: "api", label: "API key" }],
  "ollama-cloud": [{ type: "api", label: "API key" }],
  openai: [{ type: "api", label: "API key" }],
  openrouter: [{ type: "api", label: "API key" }],
  qwen: [{ type: "api", label: "API key" }],
  "siliconflow-cn": [{ type: "api", label: "API key" }],
  stepfun: [{ type: "api", label: "API key" }],
  tokenstar: [{ type: "api", label: "API key" }],
  "github-copilot": [{ type: "oauth", label: "Login with GitHub Copilot" }],
};

const providers: ProviderAuthProvider[] = [
  { id: "302ai", name: "302.AI", env: ["API_KEY"] },
  { id: "alibaba", name: "Alibaba", env: ["API_KEY"] },
  { id: "alibaba-cn", name: "Alibaba (China)", env: ["API_KEY"] },
  { id: "alibaba-coding-plan", name: "Alibaba Coding Plan", env: ["API_KEY"] },
  { id: "kimi-for-coding", name: "Kimi For Coding", env: ["API_KEY"] },
  { id: "lmstudio", name: "LMStudio", env: ["API_KEY"] },
  { id: "minimax-cn", name: "MiniMax (minimaxi.com)", env: ["API_KEY"] },
  { id: "mistral", name: "Mistral", env: ["API_KEY"] },
  { id: "moonshotai-cn", name: "Moonshot AI (China)", env: ["API_KEY"] },
  { id: "modelscope", name: "ModelScope", env: ["API_KEY"] },
  { id: "ollama-cloud", name: "Ollama Cloud", env: ["API_KEY"] },
  { id: "openai", name: "OpenAI", env: ["OPENAI_API_KEY"] },
  { id: "openrouter", name: "OpenRouter", env: ["API_KEY"] },
  { id: "qwen", name: "Qwen", env: [] },
  { id: "siliconflow-cn", name: "SiliconFlow (China)", env: ["API_KEY"] },
  { id: "stepfun", name: "StepFun (China)", env: ["API_KEY"] },
  { id: "tokenstar", name: "TokenStar", env: [] },
  { id: "github-copilot", name: "GitHub Copilot", env: [] },
];

describe("provider auth curation", () => {
  test("keeps the default list focused on recommended providers", () => {
    const entries = buildProviderAuthEntries({
      authMethods: apiMethods,
      connectedProviderIds: [],
      providers,
      isRemoteWorker: false,
      showiPolloWorkModelsSubscribe: false,
    });
    const groups = getProviderAuthEntryGroups(entries, "");

    expect(groups.recommended.map((entry) => entry.id)).toEqual([
      "openai",
      "alibaba-cn",
      "kimi-for-coding",
      "minimax-cn",
      "stepfun",
      "mistral",
      "github-copilot",
    ]);
    expect(groups.recommended.map((entry) => entry.id)).not.toContain("302ai");
    expect(groups.recommended.map((entry) => entry.id)).not.toContain("tokenstar");
    expect(groups.recommended.map((entry) => entry.id)).not.toContain("openrouter");
    expect(groups.recommended.map((entry) => entry.id)).not.toContain("siliconflow-cn");
    expect(groups.recommended.map((entry) => entry.id)).not.toContain("modelscope");
    expect(groups.recommended.map((entry) => entry.id)).not.toContain("ollama-cloud");
    expect(groups.recommended.map((entry) => entry.id)).not.toContain("lmstudio");
    expect(groups.more.map((entry) => entry.id)).toContain("302ai");
    expect(groups.more.map((entry) => entry.id)).toContain("tokenstar");
    expect(groups.more.map((entry) => entry.id)).toContain("openrouter");
    expect(groups.more.map((entry) => entry.id)).not.toContain("github-copilot");
    expect(groups.more.map((entry) => entry.id)).toContain("siliconflow-cn");
    expect(groups.more.map((entry) => entry.id)).toContain("modelscope");
    expect(groups.more.map((entry) => entry.id)).toContain("ollama-cloud");
    expect(groups.more.map((entry) => entry.id)).toContain("lmstudio");
  });

  test("collapses Alibaba variants behind the recommended Qwen entry", () => {
    const entries = buildProviderAuthEntries({
      authMethods: apiMethods,
      connectedProviderIds: [],
      providers,
      isRemoteWorker: false,
      showiPolloWorkModelsSubscribe: false,
    });
    const qwen = getProviderAuthEntryGroups(entries, "").recommended.find((entry) => entry.id === "alibaba-cn");

    expect(qwen?.name).toBe("Qwen / Alibaba Cloud");
    expect(qwen?.variantIds).toEqual([
      "qwen",
      "alibaba",
      "alibaba-coding-plan",
    ]);
  });

  test("search includes long-tail and collapsed provider variants", () => {
    const entries = buildProviderAuthEntries({
      authMethods: apiMethods,
      connectedProviderIds: [],
      providers,
      isRemoteWorker: false,
      showiPolloWorkModelsSubscribe: false,
    });

    expect(getProviderAuthEntryGroups(entries, "302").recommended.map((entry) => entry.id)).toEqual(["302ai"]);
    expect(getProviderAuthEntryGroups(entries, "qwen").recommended.map((entry) => entry.id)).toEqual(["alibaba-cn"]);
  });

  test("white-labels the bundled OpenCode provider as iPolloWork", () => {
    expect(formatProviderAuthName("opencode")).toBe("iPolloWork Built-in Models");
    expect(formatProviderAuthName("opencode", "OpenCode Zen")).toBe("iPolloWork Built-in Models");
  });
});
