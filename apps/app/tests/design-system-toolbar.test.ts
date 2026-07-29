import { describe, expect, test } from "bun:test";

const panelUrl = new URL(
  "../src/react-app/domains/session/design/design-panel.tsx",
  import.meta.url,
);

describe("Design System toolbar", () => {
  test("keeps a selection-independent Design System entry point", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('aria-label="Toggle design system"');
    expect(source).toContain('setPropertiesTab("design-system")');
    expect(source).toContain('propertiesTab === "design-system" || selectionSummary');
  });
});
