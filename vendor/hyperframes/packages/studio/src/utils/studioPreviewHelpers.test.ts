import { describe, expect, it } from "vitest";
import {
  installEmbeddedHtmlAssetScaling,
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
  it("upgrades existing illustration iframes to resize-stable scaling", () => {
    let resize: (() => void) | undefined;
    let disconnected = false;
    class FakeResizeObserver {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    }
    const iframe = {
      style: { scale: "1", transform: "scale(1)" },
      __hfResizeObserver: { disconnect: () => (disconnected = true) },
    };
    const container = {
      clientWidth: 480,
      clientHeight: 270,
      querySelector: () => iframe,
    };
    const doc = {
      defaultView: {
        ResizeObserver: FakeResizeObserver,
        CSS: { supports: () => true },
      },
      querySelectorAll: () => [container],
    } as unknown as Document;

    installEmbeddedHtmlAssetScaling(doc);
    expect(disconnected).toBe(true);
    expect(iframe.style.scale).toBe("0.3");
    expect(iframe.style.transform).toBe("none");

    container.clientHeight = 180;
    resize?.();
    expect(iframe.style.scale).toBe("0.2");
  });

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
