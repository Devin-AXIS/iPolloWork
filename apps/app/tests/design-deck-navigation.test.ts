import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);

describe("Design deck navigation", () => {
  test("keeps the slide controls available in preview mode", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toMatch(/\{deck \? \(\s*<div[^>]*data-testid="design-deck-navigation"/);
  });

  test("uses a fixed presentation canvas instead of a mobile document preview", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("h-[900px] w-[1600px] origin-center");
    expect(source).toContain("presentationCanvasScale(previewViewport.width, previewViewport.height)");
    expect(source).toContain("!isPresentationTemplate ? (");
  });

  test("measures the viewport after the async preview has mounted", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("}, [isPresentationTemplate, sourceHydrated]);");
  });

  test("does not show a redundant current design subtitle", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).not.toContain('"Current design"');
    expect(source).not.toContain('"Version preview"');
    expect(source).not.toContain('<p className="truncate text-sm font-medium">{fileName(activePagePath)}</p>');
  });
});
