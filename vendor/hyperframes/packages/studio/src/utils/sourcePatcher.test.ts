import { describe, expect, it } from "vitest";

import { applyPatchByTarget } from "./sourcePatcher";

describe("applyPatchByTarget", () => {
  it("updates JSON attributes idempotently and removes stale duplicates", () => {
    const source = `<div id="map" data-variable-values='{"values":"CA:300"}' data-variable-values='{"values":"CA:200"}'></div>`;

    const patched = applyPatchByTarget(
      source,
      { id: "map" },
      {
        type: "attribute",
        property: "variable-values",
        value: JSON.stringify({ values: "CA:321" }),
      },
    );

    expect(patched).toContain(`data-variable-values='{"values":"CA:321"}'`);
    expect(patched.match(/data-variable-values=/g)).toHaveLength(1);
  });
});
