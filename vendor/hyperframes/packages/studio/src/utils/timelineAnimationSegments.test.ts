import { describe, expect, test } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import {
  buildTimelineAnimationSegment,
  buildTimelineAnimationSegments,
  clampAnimationMetaToOwner,
  isAnimationSharedForOwner,
  isTimelineAnimationDirectlyMovable,
  resolveLocalTimelineAnimationOwnerRange,
  resolveTimelineAnimationMoveUpdate,
  resolveTimelineAnimationPhase,
} from "./timelineAnimationSegments";

const OWNER = { start: 2, duration: 8 };

function animation(overrides: Partial<GsapAnimation> = {}): GsapAnimation {
  return {
    id: "animation-1",
    targetSelector: "#title",
    method: "to",
    position: 3,
    duration: 2,
    properties: { x: 100 },
    ...overrides,
  };
}

describe("timeline animation segments", () => {
  test("maps existing tweens into their owner clip without creating lanes", () => {
    expect(
      buildTimelineAnimationSegments(
        [
          animation({ id: "entrance", method: "from", position: 2, duration: 1 }),
          animation({ id: "exit", position: 9, duration: 1, properties: { opacity: 0 } }),
        ],
        OWNER,
      ),
    ).toEqual([
      {
        animationId: "entrance",
        phase: "entrance",
        startPercentage: 0,
        endPercentage: 12.5,
      },
      {
        animationId: "exit",
        phase: "exit",
        startPercentage: 87.5,
        endPercentage: 100,
      },
    ]);
  });

  test("prefers resolved start and clips every segment to its owner", () => {
    expect(
      buildTimelineAnimationSegment(
        animation({ position: 99, resolvedStart: 1, duration: 4 }),
        OWNER,
      ),
    ).toEqual({
      animationId: "animation-1",
      phase: "entrance",
      startPercentage: 0,
      endPercentage: 37.5,
    });
    expect(
      buildTimelineAnimationSegment(
        animation({ position: "not-a-time", duration: 1 }),
        OWNER,
      ),
    ).toBeNull();
    expect(buildTimelineAnimationSegment(animation({ method: "set" }), OWNER)).toBeNull();
  });

  test("classifies a full-owner from tween as entrance and a repeated tween as loop", () => {
    expect(
      resolveTimelineAnimationPhase(
        animation({ method: "from", position: 2, duration: 8 }),
        OWNER,
      ),
    ).toBe("entrance");
    expect(
      resolveTimelineAnimationPhase(
        animation({ position: 2, duration: 1, extras: { repeat: "__raw:3" } }),
        OWNER,
      ),
    ).toBe("loop");
  });

  test("uses repeat and repeatDelay for the visible span", () => {
    expect(
      buildTimelineAnimationSegment(
        animation({
          position: 2,
          duration: 1,
          extras: { repeat: "__raw:2", repeatDelay: "__raw:0.5" },
        }),
        OWNER,
      ),
    ).toEqual({
      animationId: "animation-1",
      phase: "loop",
      startPercentage: 0,
      endPercentage: 50,
    });
  });

  test("clamps one atomic timing update to the owner range", () => {
    expect(
      clampAnimationMetaToOwner(
        animation({ position: 8, duration: 1 }),
        { position: 9.75 },
        OWNER,
      ),
    ).toEqual({ position: 9 });
    expect(
      clampAnimationMetaToOwner(
        animation({
          position: 8,
          duration: 1,
          extras: { repeat: "__raw:1", repeatDelay: "__raw:0.5" },
        }),
        { duration: 4 },
        OWNER,
      ),
    ).toEqual({ duration: 0.75 });
  });

  test("deduplicates a parsed tween by animation id", () => {
    expect(
      buildTimelineAnimationSegments(
        [
          animation({ id: "same", position: 2 }),
          animation({ id: "same", position: 4 }),
        ],
        OWNER,
      ),
    ).toHaveLength(1);
  });

  test("allows editing only for an exact owner id selector", () => {
    expect(isAnimationSharedForOwner(animation(), "title")).toBe(false);
    expect(
      isAnimationSharedForOwner(animation({ targetSelector: ".title" }), "title"),
    ).toBe(true);
    expect(
      isAnimationSharedForOwner(
        animation({ targetSelector: "#title, #subtitle" }),
        "title",
      ),
    ).toBe(true);
    expect(isAnimationSharedForOwner(animation(), null)).toBe(true);
  });

  test("keeps shared and generated animations read-only", () => {
    expect(isTimelineAnimationDirectlyMovable(animation(), "title")).toBe(true);
    expect(
      isTimelineAnimationDirectlyMovable(animation({ provenance: { kind: "literal" } }), "title"),
    ).toBe(true);
    expect(
      isTimelineAnimationDirectlyMovable(
        animation({ targetSelector: "#title, #subtitle" }),
        "title",
      ),
    ).toBe(false);
    expect(
      isTimelineAnimationDirectlyMovable(
        animation({ provenance: { kind: "helper", fn: "reveal" } }),
        "title",
      ),
    ).toBe(false);
    expect(
      isTimelineAnimationDirectlyMovable(animation({ provenance: { kind: "loop" } }), "title"),
    ).toBe(false);
    expect(
      isTimelineAnimationDirectlyMovable(
        animation({ provenance: { kind: "runtime-dynamic" } }),
        "title",
      ),
    ).toBe(false);
    expect(
      isTimelineAnimationDirectlyMovable(animation({ method: "set" }), "title"),
    ).toBe(false);
    expect(
      isTimelineAnimationDirectlyMovable(
        animation({ position: "not-a-time" }),
        "title",
      ),
    ).toBe(false);
  });

  test("rebases expanded owners and moves only by the dragged percentage", () => {
    const ownerRange = resolveLocalTimelineAnimationOwnerRange({
      start: 12,
      duration: 8,
      expandedParentStart: 10,
    });
    expect(ownerRange).toEqual(OWNER);
    expect(
      resolveTimelineAnimationMoveUpdate(animation({ position: 3, duration: 2 }), 25, ownerRange),
    ).toEqual({ position: 5 });
    expect(
      resolveLocalTimelineAnimationOwnerRange({ start: 2, duration: 8 }),
    ).toEqual(OWNER);
    expect(
      resolveLocalTimelineAnimationOwnerRange({
        start: 1,
        duration: 4,
        expandedParentStart: 3,
      }),
    ).toEqual({ start: 0, duration: 4 });
  });

  test("keeps moved and repeated animations inside the owner", () => {
    expect(
      resolveTimelineAnimationMoveUpdate(animation(), -100, OWNER),
    ).toEqual({ position: 2 });
    expect(
      resolveTimelineAnimationMoveUpdate(animation(), 100, OWNER),
    ).toEqual({ position: 8 });
    expect(
      resolveTimelineAnimationMoveUpdate(
        animation({
          position: 3,
          duration: 1,
          extras: { repeat: "__raw:1", repeatDelay: "__raw:0.5" },
        }),
        100,
        OWNER,
      ),
    ).toEqual({ position: 7.5 });
  });
});
