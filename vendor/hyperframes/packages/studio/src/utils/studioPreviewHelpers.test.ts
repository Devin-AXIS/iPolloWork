import { describe, expect, it } from "vitest";
import {
  isFullBleedTarget,
  resolveEmbeddedHtmlAssetSelectionTarget,
} from "./studioPreviewHelpers";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("resolveEmbeddedHtmlAssetSelectionTarget", () => {
  it("promotes an illustration iframe to its resizable clip wrapper", () => {
    const parent = {
      getAttribute: (name: string) =>
        name === "src"
          ? "assets/video-illustrations/example.html"
          : name === "data-hf-lock-aspect-ratio"
            ? "16:9"
            : null,
      hasAttribute: (name: string) => name === "data-hf-lock-aspect-ratio",
    } as unknown as HTMLElement;
    const iframe = { tagName: "IFRAME", parentElement: parent } as unknown as HTMLElement;
    expect(resolveEmbeddedHtmlAssetSelectionTarget(iframe)).toBe(parent);
  });

  it("keeps a full-canvas illustration wrapper selectable above lower layers", () => {
    const illustration = {
      tagName: "DIV",
      getAttribute: (name: string) =>
        name === "data-hf-asset-kind" ? "html" : name === "src" ? "assets/video-illustrations/example.html" : null,
      hasAttribute: (name: string) => name === "data-hf-lock-aspect-ratio",
      getBoundingClientRect: () => rect(0, 0, 1920, 1080),
    } as unknown as HTMLElement;

    expect(isFullBleedTarget(illustration, { width: 1920, height: 1080 })).toBe(false);
  });

  it("does not promote unrelated iframes", () => {
    const parent = {
      getAttribute: () => null,
      hasAttribute: () => false,
    } as unknown as HTMLElement;
    const iframe = { tagName: "IFRAME", parentElement: parent } as unknown as HTMLElement;
    expect(resolveEmbeddedHtmlAssetSelectionTarget(iframe)).toBe(iframe);
  });
});
