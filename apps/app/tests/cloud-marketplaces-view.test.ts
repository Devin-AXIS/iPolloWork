import { describe, expect, test } from "bun:test";

import { shouldShowMarketplaceRows } from "../src/react-app/domains/settings/pages/cloud-marketplaces-view";

describe("Cloud marketplace row visibility", () => {
  test("hides marketplace rows until a personal Cloud account is signed in", () => {
    expect(shouldShowMarketplaceRows(false)).toBe(false);
    expect(shouldShowMarketplaceRows(true)).toBe(true);
  });
});
