import { describe, expect, test } from "bun:test";

import { parseTokenStarModels } from "../src/react-app/domains/connections/provider-auth/tokenstar-provider";

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
});
