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

    expect(source).toContain("h-[900px] w-[1600px] origin-top-left");
    expect(source).toContain("presentationCanvasScale(previewViewport.width, previewViewport.height)");
    expect(source).toContain("!isPresentationTemplate ? (");
  });

  test("starts presentation templates in canvas editing mode", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('setEditing(isPresentationTemplate);');
    expect(source).toContain("Edit");
  });

  test("keeps the website toolbar compact and ordered", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).not.toContain('>Current design</p>');
    expect(source).not.toContain("Edit page");
    expect(source).toContain('className="order-3 shrink-0 rounded-lg"');
    expect(source).toContain("panelWidth < 360");
    expect(source).toContain('className="w-14 shrink-0 rounded-lg border-0 bg-transparent');
    expect(source).toContain("const currentVersionLabel = `V${versionTargets.length + 1}`");
    expect(source).toContain("<SelectValue>{viewedVersionLabel}</SelectValue>");
  });

  test("measures the presentation viewport after the canvas mounts", async () => {
    const source = await Bun.file(panelUrl).text();
    const measurementEffect = source.match(/React\.useEffect\(\(\) => \{\s*const viewport = previewViewportRef\.current;[\s\S]*?\}, \[([^\]]*)\]\);/);

    expect(measurementEffect?.[1]).toContain("isPresentationTemplate");
    expect(measurementEffect?.[1]).toContain("sourceHydrated");
  });

  test("applies modifier-wheel zoom from the presentation iframe and exposes reset", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('event.data.type === "zoom"');
    expect(source).toContain("presentationCanvasWheelZoom(current, event.data.deltaY)");
    expect(source).toContain('aria-label="Fit canvas to view"');
    expect(source).toContain("setPresentationZoom(1)");
  });

  test("moves publish and export into more actions below 480px", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("panelWidth < 480");
    expect(source).toContain("compact={compactToolbar}");
    expect(source).toContain("showExports={Boolean(deck)}");
    expect(source).toContain("onPublish={() => publishMutation.mutate()}");
  });

  test("orders editing actions before sharing and export", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source.indexOf('aria-label="Fit canvas to view"')).toBeLessThan(source.indexOf('aria-label="Save design"'));
    expect(source.indexOf('aria-label="Save design"')).toBeLessThan(source.indexOf('aria-label="Publish to object storage"'));
    expect(source.indexOf('aria-label="Publish to object storage"')).toBeLessThan(source.indexOf("<DesignExportMenu"));
  });

  test("offers selected-element deletion only from the floating toolbar", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('aria-label="Delete selected element"');
    expect(source).toContain('type: "delete"');
    expect(source).toContain("disabled={!selection.canDelete}");
  });

  test("places AI after every floating toolbar action", async () => {
    const source = await Bun.file(panelUrl).text();
    expect(source).toContain('aria-label="Ask AI about selected element"');
    expect(source.lastIndexOf('aria-label="Ask AI about selected element"')).toBeGreaterThan(source.lastIndexOf('aria-label="Toggle advanced design settings"'));
  });

  test("keeps protected runtime controls unavailable to AI", async () => {
    const source = await Bun.file(panelUrl).text();
    const labelIndex = source.lastIndexOf('aria-label="Ask AI about selected element"');
    const actionStart = source.lastIndexOf("<Button", labelIndex);
    expect(source.slice(actionStart, labelIndex)).toContain("disabled={!selection.canDelete || saveMutation.isPending || viewedVersionPath !== \"current\"}");
  });

  test("pans the overflowed presentation canvas without moving the slide", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('event.data.type === "pan"');
    expect(source).toContain("scrollBy({ left: -event.data.deltaX, top: -event.data.deltaY })");
    expect(source).toContain("overflow-auto");
    expect(source).toContain("presentationCanvasStageSize");
  });

  test("dismisses the floating selection toolbar when the editor deselects", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('event.data.type === "deselected"');
    expect(source).toContain("setSelection(null);");
    expect(source).toContain("setQuickEdit(null);");
    expect(source).toContain("setAdvancedOpen(false);");
  });
});
