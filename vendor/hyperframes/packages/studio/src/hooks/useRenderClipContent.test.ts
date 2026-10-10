// @vitest-environment happy-dom
import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player/store/playerStore";
import { readStudioUiPreferences } from "../utils/studioUiPreferences";
import { resolveTimelineThumbnailPreview, useRenderClipContent } from "./useRenderClipContent";

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
  test("toggles existing clip thumbnails immediately while preserving audio content and the saved preference", () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function ClipState() {
      const projectIdRef = useRef("project-1");
      const render = useRenderClipContent({ projectIdRef, activePreviewUrl: null });
      const visual = render(element({ selector: "#headline" }), { clip: "", label: "" });
      const audio = render(element({ tag: "audio", src: "tone.wav" }), { clip: "", label: "" });
      return React.createElement("div", null, `${visual ? "visual" : "hidden"}:${audio ? "audio" : "missing"}`);
    }
    try {
      act(() => usePlayerStore.getState().setThumbnailMode("adaptive"));
      act(() => root.render(React.createElement(ClipState)));
      expect(host.textContent).toBe("visual:audio");
      act(() => usePlayerStore.getState().setThumbnailMode("hidden"));
      expect(host.textContent).toBe("hidden:audio");
      expect(readStudioUiPreferences().thumbnailMode).toBe("hidden");
      act(() => usePlayerStore.getState().setThumbnailMode("adaptive"));
      expect(host.textContent).toBe("visual:audio");
    } finally {
      act(() => root.unmount());
      act(() => usePlayerStore.getState().setThumbnailMode("adaptive"));
      localStorage.clear();
      host.remove();
    }
  });

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
