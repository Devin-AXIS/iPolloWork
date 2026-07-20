import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);

describe("Design deck navigation", () => {
  test("keeps compact slide controls code available for fixed preview mode", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toMatch(/\{deck \? \(\s*<div[^>]*data-testid="design-deck-navigation"/);
  });

  test("shows only the slide position in the deck navigation label", async () => {
    const source = await Bun.file(panelUrl).text();

    const navigation = source.match(/data-testid="design-deck-navigation"[\s\S]*?\) : null\}/)?.[0] ?? "";

    expect(navigation).toContain("{deck.index + 1} / {deck.total}");
    expect(navigation).not.toContain("deck.title");
  });

  test("keeps ordinary slide HTML scrollable while reserving fixed canvas for compatible PPTX", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("const usesFixedPresentationPreview = usesNativeEditablePptx");
    expect(source).toContain("h-[900px] w-[1600px] origin-center");
    expect(source).toContain("presentationCanvasScale(previewViewport.width, previewViewport.height)");
    expect(source).toContain("const visiblePresentationScale = presentationScale || FALLBACK_PRESENTATION_SCALE");
    expect(source).toContain("[activePagePath, previewRevision, sourceHydrated, usesFixedPresentationPreview]");
    expect(source).toContain("scale(${visiblePresentationScale})");
    expect(source).toContain("h-full w-full rounded-lg shadow-sm");
    expect(source).toContain("!isPresentationTemplate ? (");
  });
});
