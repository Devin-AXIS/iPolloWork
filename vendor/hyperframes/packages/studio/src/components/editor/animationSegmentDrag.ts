import { KEYFRAME_DRAG_THRESHOLD_PX } from "./keyframeDrag";

const NOOP_EPSILON_PERCENTAGE = 0.1;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface AnimationSegmentDragResult {
  kind: "click" | "noop" | "move";
  deltaPercentage?: number;
}

export function commitResolvedAnimationSegmentDrag(
  animationId: string,
  result: AnimationSegmentDragResult,
  onMove: (animationId: string, deltaPercentage: number) => void,
): boolean {
  if (result.kind !== "move" || result.deltaPercentage === undefined) return false;
  onMove(animationId, result.deltaPercentage);
  return true;
}

/**
 * Keep a whole animation segment inside its owner clip while preserving its
 * displayed width. The returned delta is clip-relative, not segment-relative.
 */
export function clampAnimationSegmentDelta(
  deltaPercentage: number,
  startPercentage: number,
  endPercentage: number,
): number {
  return clamp(deltaPercentage, -startPercentage, 100 - endPercentage);
}

/**
 * Resolve a pointer release into one animation timing move. Pointer motion is
 * expressed as a clip-relative percentage so the mutation layer can add the
 * delta to the source tween's current position, including nested compositions.
 */
export function resolveAnimationSegmentDrag(options: {
  pointerDownX: number;
  pointerUpX: number;
  clipWidthPx: number;
  startPercentage: number;
  endPercentage: number;
}): AnimationSegmentDragResult {
  const deltaPx = options.pointerUpX - options.pointerDownX;
  if (Math.abs(deltaPx) < KEYFRAME_DRAG_THRESHOLD_PX || options.clipWidthPx <= 0) {
    return { kind: "click" };
  }

  const deltaPercentage = clampAnimationSegmentDelta(
    (deltaPx / options.clipWidthPx) * 100,
    options.startPercentage,
    options.endPercentage,
  );
  if (Math.abs(deltaPercentage) < NOOP_EPSILON_PERCENTAGE) {
    return { kind: "noop" };
  }
  return { kind: "move", deltaPercentage };
}

/** Clip-relative, clamped preview delta used by the rAF-only pointer preview. */
export function previewAnimationSegmentDelta(options: {
  pointerDownX: number;
  pointerMoveX: number;
  clipWidthPx: number;
  startPercentage: number;
  endPercentage: number;
}): number {
  if (options.clipWidthPx <= 0) return 0;
  return clampAnimationSegmentDelta(
    ((options.pointerMoveX - options.pointerDownX) / options.clipWidthPx) * 100,
    options.startPercentage,
    options.endPercentage,
  );
}
