// @vitest-environment happy-dom
import { getTimelineRowTop, type TimelinePresentationRow } from "./timelineLayout";
import { applyTimelineGroupResizePreview } from "./timelineGroupEditing";
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
          resizeMode: "stretch",
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
      expect(preview.previewPlaybackStart).toBe(0);
      expect(preview.previewStart).toBe(edge === "start" ? 0 : 10);
    },
  );
  test("composition trim keeps speed and advances the source in-point", () => {
    const element = {
      ...CLIP,
      compositionSrc: "scene.html",
      start: 10,
      duration: 5,
      sourceDuration: 10,
      playbackStart: 1,
      playbackRate: 2,
    };
    const preview = computeResizePreview(
      {
        element,
        edge: "start",
        selectionKeys: new Set(),
        originClientX: 0,
        previewStart: 10,
        previewDuration: 5,
        started: true,
      },
      100,
      { scroll: null, pps: 100, buildSnapTargets: () => [] },
    );
    expect(preview.previewStart).toBe(11);
    expect(preview.previewDuration).toBe(4);
    expect(preview.previewPlaybackStart).toBe(3);
  });
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

describe("group trim and stretch", () => {
  const element = {
    ...CLIP,
    tag: "video",
    start: 2,
    duration: 4,
    playbackStart: 1,
    playbackRate: 2,
    sourceDuration: 10,
  };
  const members = [
    {
      element,
      key: element.id,
      start: 2,
      duration: 4,
      playbackStart: 1,
      playbackRate: 2,
      sourceDuration: 10,
    },
  ];
  test("trim uses source limits for every member", () => {
    const session = {
      grabbedKey: element.id,
      edge: "end" as const,
      members,
      changes: [],
      hasChanged: false,
    };
    const result = applyTimelineGroupResizePreview(session, {
      previewStart: 2,
      previewDuration: 8,
    });
    expect(result?.duration).toBe(4.5);
    expect(result?.playbackStart).toBe(1);
  });
  test("stretch extends beyond source duration and retains the in-point", () => {
    const session = {
      grabbedKey: element.id,
      edge: "end" as const,
      resizeMode: "stretch" as const,
      members,
      changes: [],
      hasChanged: false,
    };
    const result = applyTimelineGroupResizePreview(session, {
      previewStart: 2,
      previewDuration: 8,
    });
    expect(result?.duration).toBe(8);
    expect(result?.playbackStart).toBe(1);
  });
});


describe("clip drag across expanded property rows", () => {
  const rows: TimelinePresentationRow[] = [
    {kind:"layer",key:"rw-thread",track:0,elementKey:"rw-thread"},
    {kind:"group",key:"rw-thread:transform",track:0,elementKey:"rw-thread",label:"Transform"},
    {kind:"group",key:"rw-thread:position",track:0,elementKey:"rw-thread",label:"Position"},
    {kind:"property",key:"rw-thread:x",track:0,elementKey:"rw-thread",property:"x",label:"X"},
    {kind:"property",key:"rw-thread:y",track:0,elementKey:"rw-thread",property:"y",label:"Y"},
    {kind:"property",key:"rw-thread:scale",track:0,elementKey:"rw-thread",property:"scale",label:"Scale"},
    {kind:"property",key:"rw-thread:opacity",track:0,elementKey:"rw-thread",property:"opacity",label:"Opacity"},
    {kind:"layer",key:"occupied",track:1,elementKey:"occupied"},
  ];
  test("hovering a property row retains its parent lane instead of creating a track", () => {
    const preview = computeDragPreview(drag("layer-order"),0,getTimelineRowTop(3)+20,
      {...context,scroll:document.createElement("div"),presentationRows:rows});
    expect(preview.previewTrack).toBe(0);
    expect(preview.desiredTrack).toBe(0);
    expect(preview.insertRow).toBeNull();
  });
  test("the layer below expanded children remains the second logical reorder target", () => {
    const preview = computeDragPreview(drag("layer-order"),0,getTimelineRowTop(7)+20,
      {...context,scroll:document.createElement("div"),presentationRows:rows});
    expect(preview.desiredTrack).toBe(1);
    expect(preview.insertRow).toBe(2);
    expect(preview.previewStart).toBe(CLIP.start);
  });
});
