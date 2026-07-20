import { describe, expect, test } from "bun:test";

import { shouldOfferGitHubReleaseUpdate } from "../src/react-app/domains/settings/state/electron-updater-state";

describe("GitHub desktop update availability", () => {
  test("offers a newer GitHub release without depending on Cloud version metadata", () => {
    expect(shouldOfferGitHubReleaseUpdate({ available: true, latestVersion: "0.17.30" })).toBe(true);
  });

  test("does not offer an incomplete or non-new release result", () => {
    expect(shouldOfferGitHubReleaseUpdate({ available: false, latestVersion: "0.17.30" })).toBe(false);
    expect(shouldOfferGitHubReleaseUpdate({ available: true, latestVersion: null })).toBe(false);
  });
});
