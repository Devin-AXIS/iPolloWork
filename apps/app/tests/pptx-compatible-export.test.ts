import { describe, expect, test } from "bun:test";

import {
  createPptxCompatibleTextRuns,
  frameForPptxCompatibleShape,
  hasPptxCompatibleObjectMarkers,
  hasPptxCompatibleVisibleDimensions,
  hasUnsupportedPptxCompatibleTransition,
  isPptxCompatibleRuntimeElement,
  normalizePptxCompatibleMarkerName,
  pointsForPptxCompatibleSlide,
  validatePptxCompatibleMarkup,
} from "../src/react-app/domains/session/design/pptx-compatible-export";

describe("PPTX-compatible export", () => {
  test("keeps rich text as independently editable PowerPoint runs", () => {
    expect(createPptxCompatibleTextRuns([
      { text: "Native ", style: { color: "111827", bold: false } },
      { text: "PPTX", style: { color: "0F766E", bold: true } },
    ])).toEqual([
      { text: "Native ", options: { color: "111827", bold: false } },
      { text: "PPTX", options: { color: "0F766E", bold: true } },
    ]);
  });

  test("drops source indentation while preserving an explicit rich-text line break", () => {
    expect(createPptxCompatibleTextRuns([
      { text: "Product", style: { color: "F0BCA0", bold: true } },
      { text: "\n        Market", style: { color: "FFFFFF", bold: true } },
      { text: "\n        Category", breakLineBefore: true, style: { color: "FFFFFF", bold: true } },
      { text: "\n      ", style: { color: "FFFFFF", bold: true } },
    ])).toEqual([
      { text: "Product", options: { color: "F0BCA0", bold: true } },
      { text: "Market", options: { color: "FFFFFF", bold: true } },
      { text: "Category", options: { color: "FFFFFF", bold: true, softBreakBefore: true } },
    ]);
  });

  test("scales CSS typography to the same fixed slide coordinate system as its frame", () => {
    expect(pointsForPptxCompatibleSlide("78px", 1600)).toBe(46.799);
    expect(pointsForPptxCompatibleSlide("76.44px", 1600)).toBe(45.863);
  });

  test("keeps the validation result available for unsupported visual diagnostics", () => {
    expect(validatePptxCompatibleMarkup({
      hasUnsupportedVisual: true,
      hasUnmarkedVisibleElement: false,
    })).toEqual({ valid: false, reason: "unsupported-visual" });
    expect(validatePptxCompatibleMarkup({
      hasUnsupportedVisual: false,
      hasUnmarkedVisibleElement: true,
    })).toEqual({ valid: false, reason: "unmarked-visible-element" });
    expect(validatePptxCompatibleMarkup({
      hasUnsupportedVisual: false,
      hasUnmarkedVisibleElement: false,
    })).toEqual({ valid: true });
  });

  test("routes marked unsupported visuals to local fallback images", async () => {
    const source = await Bun.file(new URL("../src/react-app/domains/session/design/pptx-compatible-export.ts", import.meta.url)).text();

    expect(source).toContain('{ kind: "fallback", element');
    expect(source).toContain("fallbackRoots.some");
  });

  test("only enables strict native export when the document has native object markers", () => {
    expect(hasPptxCompatibleObjectMarkers('<section class="slide"><h1>融资路演</h1></section>')).toBe(false);
    expect(hasPptxCompatibleObjectMarkers('<section class="slide"><h1 data-pptx-text>融资路演</h1></section>')).toBe(true);
  });

  test("exports a CSS top border as an editable horizontal line rather than a rectangle", () => {
    expect(frameForPptxCompatibleShape("line", { x: 1, y: 2, w: 3, h: 0.5 })).toEqual({
      x: 1,
      y: 2,
      w: 3,
      h: 0,
    });
  });

  test("keeps a one-pixel marked divider eligible for native line export", () => {
    expect(hasPptxCompatibleVisibleDimensions("line", 320, 1)).toBe(true);
    expect(hasPptxCompatibleVisibleDimensions("rect", 320, 1)).toBe(false);
  });

  test("blocks every non-zero CSS transition from the strict native route", () => {
    expect(hasUnsupportedPptxCompatibleTransition("0s, 0ms")).toBe(false);
    expect(hasUnsupportedPptxCompatibleTransition("180ms")).toBe(true);
    expect(hasUnsupportedPptxCompatibleTransition("0s, 0.2s")).toBe(true);
  });

  test("excludes shared deck controls and speaker notes from native slide export", () => {
    expect(isPptxCompatibleRuntimeElement({
      tagName: "DIV",
      className: "slide-counter",
      attributes: {},
    })).toBe(true);
    expect(isPptxCompatibleRuntimeElement({
      tagName: "NAV",
      className: "controls",
      attributes: {},
    })).toBe(true);
    expect(isPptxCompatibleRuntimeElement({
      tagName: "DIV",
      className: "ipw-notes",
      attributes: { "data-ipw-notes": "" },
    })).toBe(true);
    expect(isPptxCompatibleRuntimeElement({
      tagName: "DIV",
      className: "card",
      attributes: {},
    })).toBe(false);
  });

  test("recovers a PPTX marker when generated HTML leaves a trailing quote in its attribute name", () => {
    expect(normalizePptxCompatibleMarkerName('data-pptx-text"')).toBe("data-pptx-text");
    expect(normalizePptxCompatibleMarkerName("data-pptx-shape''")).toBe("data-pptx-shape");
    expect(normalizePptxCompatibleMarkerName("data-pptx-text")).toBe("data-pptx-text");
    expect(normalizePptxCompatibleMarkerName("data-pptx-unknown\"")).toBeNull();
  });
});
