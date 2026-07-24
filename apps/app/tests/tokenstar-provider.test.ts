import { describe, expect, test } from "bun:test";

import {
  parseTokenStarModels,
  tokenStarRuntimeModels,
} from "../src/react-app/domains/connections/provider-auth/tokenstar-provider";

describe("parseTokenStarModels", () => {
  test("parses OpenAI-compatible model responses", () => {
    expect(
      parseTokenStarModels({
        data: [
          { id: "gpt-5.6" },
          { id: "kimi-k3", name: "Kimi K3" },
          { id: " " },
          { id: "gpt-5.6" },
        ],
      }),
    ).toEqual([
      { id: "gpt-5.6", name: "GPT 5.6" },
      { id: "kimi-k3", name: "Kimi K3" },
    ]);
  });

  test("ignores malformed responses", () => {
    expect(parseTokenStarModels({ data: [{ name: "No ID" }] })).toEqual([]);
    expect(parseTokenStarModels(null)).toEqual([]);
  });

  test("adds effort variants only for supported GPT models", () => {
    expect(tokenStarRuntimeModels(["gpt-5.6-sol", "kimi-k2.7-code"])).toEqual({
      "gpt-5.6-sol": {
        name: "GPT 5.6 Sol",
        variants: { low: {}, medium: {}, high: {} },
      },
      "kimi-k2.7-code": { name: "Kimi K2.7 Code" },
    });
  });
});
