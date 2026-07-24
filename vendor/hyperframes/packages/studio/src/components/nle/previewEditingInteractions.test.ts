import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preview editing interactions", () => {
  it("selects canvas elements on one click without opening Design automatically", () => {
    const source = readFileSync(new URL("../../hooks/usePreviewInteraction.ts", import.meta.url), "utf8");

    expect(source).toContain("applyDomSelection(nextSelection, { revealPanel: false })");
    expect(source).toContain("applyDomSelection(nextSel, { revealPanel: false })");
    expect(source).not.toContain("DOUBLE_CLICK_MS");
    expect(source).not.toContain("isDoubleClick");
    expect(source).not.toContain("applyDomSelection(hit, { revealPanel: true })");
    expect(source).not.toContain("exitPreviewFullscreenForInspector");
  });

  it("drives the floating toolbar from the selected DOM element", () => {
    const source = readFileSync(new URL("./PreviewTextSelectionToolbar.tsx", import.meta.url), "utf8");

    expect(source).toContain("activeSelection?.element");
    expect(source).toContain("isTextLeafElement");
    expect(source).toContain("showTextControls");
    expect(source).toContain('aria-label="Open Design properties"');
    expect(source).toContain("applyDomSelection(activeSelection, { revealPanel: true })");
    expect(source).not.toContain('addEventListener("selectionchange"');
    expect(source).not.toContain("beginDragSelection");
    expect(source).not.toContain("TextSelectionDrag");
  });

  it("keeps rich-text formatting for text leaf elements", () => {
    const source = readFileSync(new URL("./PreviewTextSelectionToolbar.tsx", import.meta.url), "utf8");

    expect(source).toContain("activeFormats: TextFormatState");
    expect(source).toContain("detectSelectionFormats(range)");
    expect(source).toContain("toggleMarkedSelectionFormat(");
    expect(source).toContain("current.activeFormats[action]");
    expect(source).toContain('aria-pressed={state.activeFormats.bold}');
    expect(source).toContain('aria-pressed={state.activeFormats.italic}');
    expect(source).toContain('aria-pressed={state.activeFormats.strike}');
    expect(source).toContain('aria-pressed={state.activeFormats.code}');
    expect(source).toContain('aria-pressed={state.activeFormats.link}');
  });

  it("keeps the element toolbar attached while the selected element is dragged", () => {
    const toolbarSource = readFileSync(
      new URL("./PreviewTextSelectionToolbar.tsx", import.meta.url),
      "utf8",
    );
    const chromeSource = readFileSync(
      new URL("../editor/DomEditSelectionChrome.tsx", import.meta.url),
      "utf8",
    );

    expect(toolbarSource).toContain("requestAnimationFrame(refreshPosition)");
    expect(toolbarSource).toContain("cancelAnimationFrame(frameId)");
    expect(chromeSource).toContain('touchAction: "none"');
    expect(chromeSource).toContain('userSelect: "none"');
    expect(chromeSource).toContain("if (e.button !== 0)");
  });
});
