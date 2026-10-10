import { describe, expect, test } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { computeDragPreview, computeResizePreview } from "./timelineClipDragPreview";
import type { DraggedClipState } from "./timelineClipDragTypes";

const CLIP: TimelineElement = {
  id: "rw-thread",
  key: "rw-thread",
  tag: "div",
  start: 1,
  duration: 2,
  track: 0,
  domId: "rw-thread",
};

function drag(mode: DraggedClipState["mode"]): DraggedClipState {
  return {
    element: CLIP,
    mode,
    selectionKeys: new Set(["rw-thread"]),
    originClientX: 0,
    originClientY: 0,
    originScrollLeft: 0,
    originScrollTop: 0,
    pointerClientX: 0,
    pointerClientY: 0,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    previewStart: CLIP.start,
    previewTrack: CLIP.track,
    desiredTrack: CLIP.track,
    insertRow: null,
    snapTime: null,
    snapType: null,
    started: false,
  };
}

const context = {
  scroll: null,
  pps: 100,
  duration: 10,
  trackOrder: [0, 1],
  elements: [
    CLIP,
    {
      id: "occupied",
      key: "occupied",
      tag: "div",
      start: 3,
      duration: 2,
      track: 0,
      domId: "occupied",
    },
  ] satisfies TimelineElement[],
  buildSnapTargets: () => [],
};

describe("timeline drag axis intent", () => {
  test("time drag never changes layers or creates a track", () => {
    const preview = computeDragPreview(drag("time"), 300, 10_000, context);

    expect(preview.previewStart).toBe(4);
    expect(preview.previewTrack).toBe(CLIP.track);
    expect(preview.desiredTrack).toBe(CLIP.track);
    expect(preview.insertRow).toBeNull();
  });

  test("layer-order drag ignores horizontal pointer drift", () => {
    const preview = computeDragPreview(drag("layer-order"), 10_000, 10_000, context);

    expect(preview.previewStart).toBe(CLIP.start);
    expect(preview.desiredTrack).not.toBe(CLIP.track);
    expect(preview.insertRow).not.toBeNull();
    expect(preview.snapTime).toBeNull();
    expect(preview.snapType).toBeNull();
  });
});

describe("component stretch handles", () => {
  test.each(["start", "end"] as const)(
    "%s edge permits full source retiming without trim limits",
    (edge) => {
      const element = {
        ...CLIP,
        compositionSrc: "scene.html",
        start: 10,
        duration: 10,
        sourceDuration: 10,
        playbackStart: 0,
      };
      const preview = computeResizePreview(
        {
          element,
          edge,
          selectionKeys: new Set(),
          originClientX: 0,
          previewStart: 10,
          previewDuration: 10,
          started: true,
        },
        edge === "start" ? -1000 : 1000,
        { scroll: null, pps: 100, duration: 40, buildSnapTargets: () => [] },
      );
      expect(preview.previewDuration).toBe(20);
      expect(preview.previewPlaybackStart).toBeUndefined();
      expect(preview.previewStart).toBe(edge === "start" ? 0 : 10);
    },
  );
  test("a video retains its source trim limit", () => {
    const element = {
      ...CLIP,
      tag: "video",
      start: 10,
      duration: 10,
      sourceDuration: 10,
      playbackStart: 0,
    };
    const preview = computeResizePreview(
      {
        element,
        edge: "start",
        selectionKeys: new Set(),
        originClientX: 0,
        previewStart: 10,
        previewDuration: 10,
        started: true,
      },
      -1000,
      { scroll: null, pps: 100, duration: 40, buildSnapTargets: () => [] },
    );
    expect(preview.previewStart).toBe(10);
    expect(preview.previewDuration).toBe(10);
    expect(preview.previewPlaybackStart).toBe(0);
  });
});
