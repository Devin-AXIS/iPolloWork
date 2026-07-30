import { describe, expect, test } from "vitest";
import {
  captureTimelineDragSelection,
  clampGroupMoveDelta,
  expandedChildDragOffsetPx,
  multiDragPassengerOffsetPx,
  toggleTimelineSelection,
} from "./timelineMultiDragPreview";

describe("timeline drag selection scope", () => {
  test("plain drag captures only the clip under the pointer", () => {
    expect(
      [...captureTimelineDragSelection("a", new Set(["a", "b"]), false)],
    ).toEqual(["a"]);
  });

  test("modifier drag captures an explicit existing multi-selection", () => {
    const selected = new Set(["a", "b"]);
    const captured = captureTimelineDragSelection("a", selected, true);

    expect([...captured]).toEqual(["a", "b"]);
    selected.add("c");
    expect([...captured]).toEqual(["a", "b"]);
  });

  test("modifier drag outside the selection starts a new single gesture", () => {
    expect(
      [...captureTimelineDragSelection("c", new Set(["a", "b"]), true)],
    ).toEqual(["c"]);
  });

  test("excludes locked or derived rows from the frozen drag selection", () => {
    expect(
      [
        ...captureTimelineDragSelection(
          "parent",
          new Set(["parent", "locked-child", "other"]),
          true,
          new Set(["parent", "other"]),
        ),
      ],
    ).toEqual(["parent", "other"]);
  });

  test("modifier click toggles membership and keeps a valid anchor", () => {
    const added = toggleTimelineSelection("b", new Set(["a"]), "a");
    expect([...added.selectedKeys]).toEqual(["a", "b"]);
    expect(added.anchorKey).toBe("b");

    const removed = toggleTimelineSelection("b", added.selectedKeys, added.anchorKey);
    expect([...removed.selectedKeys]).toEqual(["a"]);
    expect(removed.anchorKey).toBe("a");
  });

  test("keeps a multi-drag rigid when its earliest member reaches zero", () => {
    const appliedDelta = clampGroupMoveDelta(-3, [1, 4, 8]);
    expect(appliedDelta).toBe(-1);

    const preview = {
      dragStarted: true,
      draggedKey: "b",
      draggedOriginStart: 4,
      draggedPreviewStart: 4 + appliedDelta,
      selectedKeys: new Set(["a", "b", "c"]),
    };
    expect(multiDragPassengerOffsetPx("a", 100, preview)).toBe(-100);
    expect(multiDragPassengerOffsetPx("c", 100, preview)).toBe(-100);
  });

  test("moves only expanded rows owned by the dragged display parent", () => {
    const preview = {
      dragStarted: true,
      draggedKey: "scene",
      draggedOriginStart: 2,
      draggedPreviewStart: 3.5,
      selectedKeys: new Set(["scene"]),
    };

    expect(expandedChildDragOffsetPx("scene", 80, preview)).toBe(120);
    expect(expandedChildDragOffsetPx("different-scene", 80, preview)).toBe(0);
    expect(expandedChildDragOffsetPx(undefined, 80, preview)).toBe(0);
  });
});
