import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../player";
import { resolveTimelineThumbnailPreview } from "./useRenderClipContent";

function element(overrides: Partial<TimelineElement> = {}): TimelineElement {
  return {
    id: "headline",
    tag: "div",
    start: 6,
    duration: 4,
    track: 0,
    ...overrides,
  };
}

describe("timeline element thumbnail previews", () => {
  test("captures a top-level element from the master preview", () => {
    expect(
      resolveTimelineThumbnailPreview(
        element({ selector: "#headline", sourceFile: "index.html" }),
        "project-1",
        null,
      ),
    ).toEqual({
      previewUrl: "/api/projects/project-1/preview",
      selector: "#headline",
      selectorIndex: undefined,
      seekTime: 6,
      duration: 4,
    });
  });

  test("captures an expanded child from its own source at local time", () => {
    expect(
      resolveTimelineThumbnailPreview(
        element({
          hfId: "hf-child",
          sourceFile: "compositions\\opening scene.html",
          expandedParentStart: 5,
        }),
        "project-1",
        null,
      ),
    ).toEqual({
      previewUrl: "/api/projects/project-1/preview/comp/compositions/opening%20scene.html",
      selector: '[data-hf-id="hf-child"]',
      selectorIndex: undefined,
      seekTime: 1,
      duration: 4,
    });
  });

  test("falls back to a plain clip when no stable DOM locator exists", () => {
    expect(resolveTimelineThumbnailPreview(element(), "project-1", null)).toBeNull();
  });
});
