import { describe, expect, test } from "bun:test";

import {
  classifyPptxElement,
  needsPptxBackgroundFallback,
  pptxExportSummary,
  type PptxElementPlan,
} from "../src/react-app/domains/session/design/pptx-element-export";

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

  test("only rasterizes complex slide backgrounds", () => {
    expect(needsPptxBackgroundFallback({ backgroundImage: "none", filter: "none" })).toBe(false);
    expect(needsPptxBackgroundFallback({ backgroundImage: "radial-gradient(red, blue)", filter: "none" })).toBe(true);
  });
});
