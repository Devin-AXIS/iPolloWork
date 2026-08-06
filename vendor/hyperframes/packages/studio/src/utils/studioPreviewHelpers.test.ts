import { describe, expect, it } from "vitest";
import {
  isFullBleedTarget,
  resolveEffectStackSelectionTarget,
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

function element(input: {
  text: string;
  position?: string;
  pointerEvents?: string;
  box?: DOMRect;
}): HTMLElement {
  const result = {
    textContent: input.text,
    getBoundingClientRect: () => input.box ?? rect(0, 0, 100, 30),
  } as unknown as HTMLElement;
  Object.assign(result, {
    nodeType: 1,
    style: {},
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          position: input.position ?? "static",
          pointerEvents: input.pointerEvents ?? "auto",
        }),
      },
    },
  });
  return result;
}

describe("resolveEffectStackSelectionTarget", () => {
  it("promotes duplicate visual text layers to their shared parent", () => {
    const parent = { children: [] } as unknown as HTMLElement;
    const base = element({ text: "AI相关技术", box: rect(100, 80, 300, 90) });
    const cyan = element({
      text: "AI相关技术",
      position: "absolute",
      pointerEvents: "none",
      box: rect(98, 80, 300, 90),
    });
    const magenta = element({
      text: "AI相关技术",
      position: "absolute",
      pointerEvents: "none",
      box: rect(102, 80, 300, 90),
    });
    Object.assign(parent, { children: [base, cyan, magenta] });
    Object.assign(base, { parentElement: parent });
    Object.assign(cyan, { parentElement: parent });
    Object.assign(magenta, { parentElement: parent });

    expect(resolveEffectStackSelectionTarget(base)).toBe(parent);
    expect(resolveEffectStackSelectionTarget(cyan)).toBe(parent);
  });

  it("leaves ordinary repeated text elements independently selectable", () => {
    const parent = { children: [] } as unknown as HTMLElement;
    const first = element({ text: "Repeated", box: rect(0, 0, 100, 30) });
    const second = element({ text: "Repeated", box: rect(0, 80, 100, 30) });
    Object.assign(parent, { children: [first, second] });
    Object.assign(first, { parentElement: parent });
    Object.assign(second, { parentElement: parent });

    expect(resolveEffectStackSelectionTarget(first)).toBe(first);
  });
});

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
