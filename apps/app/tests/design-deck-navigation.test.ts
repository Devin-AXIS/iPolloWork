import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);

describe("Design deck navigation", () => {
  test("keeps the slide controls available in preview mode", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toMatch(/\{deck \? \(\s*<div[^>]*data-testid="design-deck-navigation"/);
  });

  test("shows only the slide position in the deck navigation label", async () => {
    const source = await Bun.file(panelUrl).text();

    const navigation = source.match(/data-testid="design-deck-navigation"[\s\S]*?\) : null\}/)?.[0] ?? "";

    expect(navigation).toContain("{deck.index + 1} / {deck.total}");
    expect(navigation).not.toContain("deck.title");
  });

  test("uses a fixed presentation canvas instead of a mobile document preview", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("h-[900px] w-[1600px] origin-center");
    expect(source).toContain("presentationCanvasScale(previewViewport.width, previewViewport.height)");
    expect(source).toContain("!isPresentationTemplate ? (");
  });
});
