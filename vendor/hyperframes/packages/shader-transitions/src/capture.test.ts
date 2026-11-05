import { afterEach, describe, expect, it, vi } from "vitest";
import { isHtmlInCanvasCaptureSupported } from "./capture.js";

describe("isHtmlInCanvasCaptureSupported", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false outside the browser", () => {
    vi.stubGlobal("document", undefined);

    expect(isHtmlInCanvasCaptureSupported()).toBe(false);
  });

  it("returns true when layoutSubtree and drawElementImage are available", () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        setAttribute: () => undefined,
        layoutSubtree: true,
        getContext: () => ({
          drawElementImage: () => undefined,
        }),
      }),
    });

    expect(isHtmlInCanvasCaptureSupported()).toBe(true);
  });

  it("returns false when drawElementImage is missing", () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        setAttribute: () => undefined,
        layoutSubtree: true,
        getContext: () => ({}),
      }),
    });

    expect(isHtmlInCanvasCaptureSupported()).toBe(false);
  });
});
