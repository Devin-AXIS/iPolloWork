import { describe, expect, test } from "bun:test";

import { withTokenstarModel } from "../src/react-app/infra/provider-list-query";

describe("withTokenstarModel", () => {
  test("adds Tokenstar beside Big Pickle on the OpenCode provider", () => {
    const result = withTokenstarModel({
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          source: "custom",
          models: {
            "big-pickle": { name: "Big Pickle" },
          },
        },
      ],
      connected: ["opencode"],
      default: {},
    });

    expect(result.all[0]?.models.tokenstar).toEqual({ name: "Tokenstar" });
  });

  test("does not add Tokenstar when Big Pickle is absent", () => {
    const result = withTokenstarModel({
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          source: "custom",
          models: {},
        },
      ],
      connected: ["opencode"],
      default: {},
    });

    expect(result.all[0]?.models.tokenstar).toBeUndefined();
  });
});
