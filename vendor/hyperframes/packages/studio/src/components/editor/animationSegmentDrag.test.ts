import { describe, expect, test } from "vitest";
import {
  clampAnimationSegmentDelta,
  commitResolvedAnimationSegmentDrag,
  previewAnimationSegmentDelta,
  resolveAnimationSegmentDrag,
} from "./animationSegmentDrag";

describe("animation segment drag", () => {
  test("keeps the complete segment inside its owner clip", () => {
    expect(clampAnimationSegmentDelta(-50, 20, 40)).toBe(-20);
    expect(clampAnimationSegmentDelta(90, 20, 40)).toBe(60);
  });

  test("does not turn pointer jitter into a source mutation", () => {
    expect(
      resolveAnimationSegmentDrag({
        pointerDownX: 100,
        pointerUpX: 103,
        clipWidthPx: 200,
        startPercentage: 20,
        endPercentage: 40,
      }),
    ).toEqual({ kind: "click" });
    expect(
      resolveAnimationSegmentDrag({
        pointerDownX: 100,
        pointerUpX: 110,
        clipWidthPx: 0,
        startPercentage: 20,
        endPercentage: 40,
      }),
    ).toEqual({ kind: "click" });
  });

  test("starts a drag at the shared four-pixel gesture threshold", () => {
    expect(
      resolveAnimationSegmentDrag({
        pointerDownX: 100,
        pointerUpX: 104,
        clipWidthPx: 200,
        startPercentage: 20,
        endPercentage: 40,
      }),
    ).toEqual({ kind: "move", deltaPercentage: 2 });
    expect(
      resolveAnimationSegmentDrag({
        pointerDownX: 100,
        pointerUpX: 96,
        clipWidthPx: 200,
        startPercentage: 20,
        endPercentage: 40,
      }),
    ).toEqual({ kind: "move", deltaPercentage: -2 });
  });

  test("returns one bounded clip-relative delta on release", () => {
    expect(
      resolveAnimationSegmentDrag({
        pointerDownX: 100,
        pointerUpX: 300,
        clipWidthPx: 200,
        startPercentage: 20,
        endPercentage: 40,
      }),
    ).toEqual({ kind: "move", deltaPercentage: 60 });
  });

  test("uses the same clamp for the rAF preview and release", () => {
    const options = {
      pointerDownX: 100,
      pointerMoveX: 20,
      clipWidthPx: 200,
      startPercentage: 20,
      endPercentage: 40,
    };
    const previewDelta = previewAnimationSegmentDelta(options);
    const release = resolveAnimationSegmentDrag({
      ...options,
      pointerUpX: options.pointerMoveX,
    });
    expect(previewDelta).toBe(-20);
    expect(release).toEqual({ kind: "move", deltaPercentage: previewDelta });
  });

  test("skips a release that is already pinned to the clip boundary", () => {
    expect(
      resolveAnimationSegmentDrag({
        pointerDownX: 100,
        pointerUpX: 120,
        clipWidthPx: 200,
        startPercentage: 80,
        endPercentage: 100,
      }),
    ).toEqual({ kind: "noop" });
    expect(
      resolveAnimationSegmentDrag({
        pointerDownX: 100,
        pointerUpX: 80,
        clipWidthPx: 200,
        startPercentage: 0,
        endPercentage: 20,
      }),
    ).toEqual({ kind: "noop" });
  });

  test("commits only the dragged animation once", () => {
    const calls: Array<{ animationId: string; deltaPercentage: number }> = [];
    const onMove = (animationId: string, deltaPercentage: number) => {
      calls.push({ animationId, deltaPercentage });
    };

    expect(
      commitResolvedAnimationSegmentDrag(
        "entrance",
        { kind: "move", deltaPercentage: 25 },
        onMove,
      ),
    ).toBe(true);
    expect(
      commitResolvedAnimationSegmentDrag("exit", { kind: "noop" }, onMove),
    ).toBe(false);
    expect(calls).toEqual([
      { animationId: "entrance", deltaPercentage: 25 },
    ]);
  });
});
