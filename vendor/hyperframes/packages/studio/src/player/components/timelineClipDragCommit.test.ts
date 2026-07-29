import { describe, expect, test, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { commitDraggedClipMove } from "./timelineClipDragCommit";
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

const SECOND_CLIP: TimelineElement = {
  id: "scene-title",
  key: "scene-title",
  tag: "h1",
  start: 4,
  duration: 2,
  track: 1,
  domId: "scene-title",
};

const EXPANDED_CHILD: TimelineElement = {
  id: "rw-thread-child",
  key: "rw-thread-child",
  tag: "span",
  start: 1.5,
  duration: 1,
  track: 0.25,
  expandedParentStart: 1,
  expandedDisplayHostKey: "rw-thread",
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
    pointerClientX: 100,
    pointerClientY: 100,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    previewStart: 3,
    previewTrack: 1,
    desiredTrack: 1,
    insertRow: 1,
    snapTime: null,
    snapType: null,
    started: true,
  };
}

describe("timeline drag commit intent", () => {
  test("defensively commits malformed time previews as time-only", () => {
    const updateElement = vi.fn();
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    const onStackingPatches = vi.fn();

    commitDraggedClipMove(drag("time"), {
      elements: [CLIP, EXPANDED_CHILD],
      trackOrder: [0, 1],
      updateElement,
      onMoveElement,
      onMoveElements,
      selectedKeys: new Set(["rw-thread", "late-selection"]),
      readZIndex: () => 0,
      onStackingPatches,
    });

    expect(updateElement).toHaveBeenCalledWith("rw-thread", { start: 3, track: 0 });
    expect(onMoveElement).toHaveBeenCalledWith(CLIP, { start: 3, track: 0 });
    expect(onMoveElements).not.toHaveBeenCalled();
    expect(onStackingPatches).not.toHaveBeenCalled();
  });

  test("commits a frozen modifier selection as one atomic time move", () => {
    const updateElement = vi.fn();
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn(() => Promise.resolve());

    commitDraggedClipMove(
      {
        ...drag("time"),
        selectionKeys: new Set(["rw-thread", "scene-title"]),
      },
      {
        elements: [CLIP, SECOND_CLIP],
        trackOrder: [0, 1],
        updateElement,
        onMoveElement,
        onMoveElements,
        selectedKeys: new Set(["rw-thread", "selection-added-after-pointerdown"]),
      },
    );

    expect(updateElement).toHaveBeenCalledTimes(2);
    expect(updateElement).toHaveBeenCalledWith("rw-thread", { start: 3, track: 0 });
    expect(updateElement).toHaveBeenCalledWith("scene-title", { start: 6, track: 1 });
    expect(onMoveElements).toHaveBeenCalledTimes(1);
    expect(onMoveElements).toHaveBeenCalledWith(
      [
        { element: CLIP, updates: { start: 3, track: 0 } },
        { element: SECOND_CLIP, updates: { start: 6, track: 1 } },
      ],
      undefined,
      "timing",
      undefined,
    );
    expect(onMoveElement).not.toHaveBeenCalled();
  });

  test("layer-order commit pins the authored start", () => {
    const updateElement = vi.fn();
    const onMoveElements = vi.fn(() => Promise.resolve());

    commitDraggedClipMove({ ...drag("layer-order"), insertRow: null }, {
      elements: [CLIP],
      trackOrder: [0, 1],
      updateElement,
      onMoveElements,
      selectedKeys: new Set(["rw-thread"]),
    });

    expect(updateElement).toHaveBeenCalledWith(
      "rw-thread",
      expect.objectContaining({ start: CLIP.start, track: 1 }),
    );
    expect(onMoveElements).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          element: CLIP,
          updates: { start: CLIP.start, track: 1 },
        }),
      ],
      expect.any(String),
      "lane-reorder",
      undefined,
    );
  });
});
