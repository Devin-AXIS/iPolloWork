import { describe, expect, it } from "vitest";
import { normalizeStudioUrlPanelTab, parseStudioUrlStateFromHash } from "./studioUrlState";

describe("Studio URL panel state", () => {
  it("preserves the component library tab in shareable Studio state", () => {
    expect(
      normalizeStudioUrlPanelTab("components", {
        inspectorPanelsEnabled: true,
      }),
    ).toBe("components");
  });
  it("migrates historical animation-properties deep links to Layers without losing selection or time", () => {
    const state = parseStudioUrlStateFromHash("#project/demo?v=1&tab=animation-properties&t=3.25&selFile=compositions%2Fscene.html&selId=title");
    expect(state.rightPanelTab).toBe("design");
    expect(state.currentTime).toBe(3.25);
    expect(state.selection?.sourceFile).toBe("compositions/scene.html");
    expect(state.selection?.id).toBe("title");
  });
});
