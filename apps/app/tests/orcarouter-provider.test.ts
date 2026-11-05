import { describe, expect, test } from "bun:test";

import {
  ORCAROUTER_PROVIDER,
  orcarouterModelName,
  orcarouterRuntimeModels,
  parseOrcaRouterModels,
} from "../src/react-app/domains/connections/provider-auth/orcarouter-provider";

describe("OrcaRouter provider preset", () => {
  test("points at the OrcaRouter OpenAI-compatible gateway", () => {
    expect(ORCAROUTER_PROVIDER).toMatchObject({
      providerId: "orcarouter",
      name: "OrcaRouter",
      baseURL: "https://api.orcarouter.ai/v1",
    });
  });

  test("fallback models cover the adaptive router and the flagship gateway models", () => {
    expect(ORCAROUTER_PROVIDER.fallbackModels.map((model) => model.id)).toEqual([
      "orcarouter/auto",
      "openai/gpt-5.5",
      "anthropic/claude-opus-4.8",
      "google/gemini-3.5-flash",
      "deepseek/deepseek-v4-pro",
      "qwen/qwen3.7-max",
      "minimax/minimax-m2.7",
      "grok/grok-4.3",
    ]);
  });

  test("derives a friendly name for unknown gateway models", () => {
    expect(orcarouterModelName("orcarouter/auto")).toBe("OrcaRouter Auto");
    expect(orcarouterModelName("openai/gpt-5.5")).toBe("GPT-5.5");
    expect(orcarouterModelName("anthropic/claude-opus-4.8")).toBe("Claude Opus 4.8");
    expect(orcarouterModelName("unknown/model")).toBe("Model");
  });

  test("builds runtime models from a model id list", () => {
    expect(orcarouterRuntimeModels(["orcarouter/auto", "openai/gpt-5.5"])).toEqual({
      "orcarouter/auto": { name: "OrcaRouter Auto" },
      "openai/gpt-5.5": { name: "GPT-5.5" },
    });
  });

  test("parses OpenAI-compatible model responses", () => {
    expect(
      parseOrcaRouterModels({
        data: [
          { id: "orcarouter/auto" },
          { id: "openai/gpt-5.5", name: "GPT-5.5" },
          { id: " " },
          { id: "orcarouter/auto" },
        ],
      }),
    ).toEqual([
      { id: "orcarouter/auto", name: "OrcaRouter Auto" },
      { id: "openai/gpt-5.5", name: "GPT-5.5" },
    ]);
  });

  test("ignores malformed responses", () => {
    expect(parseOrcaRouterModels({ data: [{ name: "No ID" }] })).toEqual([]);
    expect(parseOrcaRouterModels(null)).toEqual([]);
  });
});
