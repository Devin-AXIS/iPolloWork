import { describe, expect, it } from "vitest";
import { normalizeStudioUrlPanelTab } from "./studioUrlState";

describe("Studio URL panel state", () => {
  it("preserves the component library tab in shareable Studio state", () => {
    expect(
      normalizeStudioUrlPanelTab("components", {
        inspectorPanelsEnabled: true,
      }),
    ).toBe("components");
  });
});
