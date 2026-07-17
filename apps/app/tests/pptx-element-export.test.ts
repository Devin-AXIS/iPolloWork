import { describe, expect, test } from "bun:test";

import {
  classifyPptxElement,
  intersectsPptxSlide,
  needsPptxBackgroundFallback,
  pptxExportSummary,
  validatePptxElementPlanCoverage,
  requiresPptxInlineTextFallback,
  type PptxElementPlan,
} from "../src/react-app/domains/session/design/pptx-element-export";
import { isPptxExportElement, isPptxExportImage } from "../src/react-app/domains/session/design/pptx-dom";

const plainTextStyle = {
  backgroundImage: "none",
  transform: "none",
  filter: "none",
  textShadow: "none",
  backgroundClip: "border-box",
  webkitBackgroundClip: "border-box",
};

const solidCardStyle = {
  backgroundImage: "none",
  transform: "none",
  filter: "none",
  backdropFilter: "none",
  mixBlendMode: "normal",
  clipPath: "none",
  maskImage: "none",
};

describe("editable PPTX element export", () => {
  test("accepts elements from the iframe document without relying on the parent window constructor", () => {
    const iframeDiv = {
      nodeType: 1,
      tagName: "DIV",
      matches: () => true,
    } as unknown as Node;
    const iframeImage = {
      nodeType: 1,
      tagName: "IMG",
      matches: () => true,
    } as unknown as Node;

    expect(isPptxExportElement(iframeDiv)).toBe(true);
    expect(isPptxExportImage(iframeDiv)).toBe(false);
    expect(isPptxExportImage(iframeImage)).toBe(true);
  });

  test("keeps plain text, images and solid cards native", () => {
    expect(classifyPptxElement({ tag: "p", text: "Editable", style: plainTextStyle })).toBe("text");
    expect(classifyPptxElement({ tag: "img", src: "data:image/png;base64,AA==", style: plainTextStyle })).toBe("image");
    expect(classifyPptxElement({ tag: "div", style: solidCardStyle })).toBe("shape");
  });

  test("uses a local fallback for unsupported visual CSS", () => {
    expect(classifyPptxElement({ tag: "div", style: { ...solidCardStyle, backgroundImage: "linear-gradient(red, blue)" } })).toBe("fallback");
    expect(classifyPptxElement({ tag: "p", text: "Glow", style: { ...plainTextStyle, textShadow: "0 1px #000" } })).toBe("fallback");
  });

  test("counts native plans separately from local fallbacks", () => {
    expect(pptxExportSummary([
      { kind: "text" },
      { kind: "shape" },
      { kind: "fallback" },
    ] as PptxElementPlan[])).toEqual({ nativeObjectCount: 2, fallbackCount: 1 });
  });

  test("keeps mixed inline text containers visible as a single fallback object", () => {
    expect(requiresPptxInlineTextFallback({
      tag: "div",
      hasDirectText: true,
      hasElementChildren: true,
    })).toBe(true);
    expect(requiresPptxInlineTextFallback({
      tag: "div",
      hasDirectText: false,
      hasElementChildren: true,
    })).toBe(false);
    expect(requiresPptxInlineTextFallback({
      tag: "p",
      hasDirectText: true,
      hasElementChildren: true,
    })).toBe(false);
  });

  test("keeps content that is clipped by the slide edge eligible for export", () => {
    const slide = { left: 0, top: 0, right: 1600, bottom: 900 } as DOMRect;

    expect(intersectsPptxSlide({ left: 72, top: 100, right: 1800, bottom: 500, width: 1728, height: 400 }, slide)).toBe(true);
    expect(intersectsPptxSlide({ left: 1700, top: 100, right: 1800, bottom: 500, width: 100, height: 400 }, slide)).toBe(false);
  });

  test("rejects a content-bearing slide when no export objects were collected", () => {
    expect(validatePptxElementPlanCoverage({ hasVisibleContent: true, planCount: 0 })).toEqual({
      valid: false,
      reason: "visible-content-not-planned",
    });
    expect(validatePptxElementPlanCoverage({ hasVisibleContent: true, planCount: 1 })).toEqual({ valid: true });
    expect(validatePptxElementPlanCoverage({ hasVisibleContent: false, planCount: 0 })).toEqual({ valid: true });
  });

  test("only rasterizes complex slide backgrounds", () => {
    expect(needsPptxBackgroundFallback({ backgroundImage: "none", filter: "none" })).toBe(false);
    expect(needsPptxBackgroundFallback({ backgroundImage: "radial-gradient(red, blue)", filter: "none" })).toBe(true);
  });
});
