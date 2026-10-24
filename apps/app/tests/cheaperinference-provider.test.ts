import { describe, expect, test } from "bun:test";

import {
  CHEAPER_INFERENCE_PROVIDER,
  cheaperInferenceModelName,
  cheaperInferenceRuntimeModels,
  parseCheaperInferenceModels,
} from "../src/react-app/domains/connections/provider-auth/cheaperinference-provider";

describe("Cheaper Inference provider preset", () => {
  test("points at the Cheaper Inference OpenAI-compatible gateway", () => {
    expect(CHEAPER_INFERENCE_PROVIDER).toMatchObject({
      providerId: "cheaperinference",
      name: "Cheaper Inference",
      baseURL: "https://api.cheaperinference.com/v1",
    });
  });

  test("fallback models cover models from several labs", () => {
    expect(CHEAPER_INFERENCE_PROVIDER.fallbackModels.map((model) => model.id)).toEqual([
      "gpt-5.4-mini",
      "gpt-5.4",
      "claude-sonnet-5",
      "gemini-3.1-pro",
      "deepseek-v4-flash",
      "glm-5.3",
    ]);
  });

  test("derives a friendly name for unknown gateway models", () => {
    expect(cheaperInferenceModelName("gpt-5.4-mini")).toBe("GPT-5.4 Mini");
    expect(cheaperInferenceModelName("claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(cheaperInferenceModelName("unknown/model")).toBe("Model");
  });

  test("builds runtime models from a model id list", () => {
    expect(cheaperInferenceRuntimeModels(["gpt-5.4-mini", "glm-5.3"])).toEqual({
      "gpt-5.4-mini": { name: "GPT-5.4 Mini" },
      "glm-5.3": { name: "GLM-5.3" },
    });
  });

  test("parses OpenAI-compatible model responses and keeps text models only", () => {
    expect(
      parseCheaperInferenceModels({
        data: [
          { id: "gpt-5.4-mini", type: "text" },
          { id: "glm-5.3", name: "GLM-5.3" },
          { id: "nano-banana", type: "image" },
          { id: " " },
          { id: "gpt-5.4-mini" },
        ],
      }),
    ).toEqual([
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
      { id: "glm-5.3", name: "GLM-5.3" },
    ]);
  });

  test("ignores malformed responses", () => {
    expect(parseCheaperInferenceModels({ data: [{ name: "No ID" }] })).toEqual([]);
    expect(parseCheaperInferenceModels(null)).toEqual([]);
  });
});
