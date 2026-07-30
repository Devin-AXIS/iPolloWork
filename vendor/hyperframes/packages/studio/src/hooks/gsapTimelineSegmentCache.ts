import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type {
  KeyframeCacheEntry,
  KeyframeCacheUpdate,
} from "../player/store/playerStore";
import {
  buildTimelineAnimationSegments,
  type TimelineAnimationOwnerRange,
} from "../utils/timelineAnimationSegments";

export type TimelineSegmentsByElement = Map<
  string,
  NonNullable<KeyframeCacheEntry["animationSegments"]>
>;

export function appendTimelineAnimationSegments(
  segmentsByElement: TimelineSegmentsByElement,
  animation: GsapAnimation,
  targetIds: readonly string[],
  resolveOwnerRange: (elementId: string) => TimelineAnimationOwnerRange,
): void {
  for (const id of targetIds) {
    const segments = buildTimelineAnimationSegments([animation], resolveOwnerRange(id));
    if (segments.length === 0) continue;
    segmentsByElement.set(id, [...(segmentsByElement.get(id) ?? []), ...segments]);
  }
}

export function attachTimelineAnimationSegments(
  cacheByElement: Map<string, KeyframeCacheEntry>,
  segmentsByElement: TimelineSegmentsByElement,
): void {
  for (const [id, animationSegments] of segmentsByElement) {
    const entry = cacheByElement.get(id) ?? { format: "percentage", keyframes: [] };
    entry.animationSegments = animationSegments;
    cacheByElement.set(id, entry);
  }
}

export function buildTimelineCacheUpdates(
  sourceFile: string,
  cacheByElement: ReadonlyMap<string, KeyframeCacheEntry>,
): KeyframeCacheUpdate[] {
  return Array.from(cacheByElement).flatMap(([id, data]) => [
    { elementId: `${sourceFile}#${id}`, data },
    { elementId: id, data },
    ...(sourceFile !== "index.html" ? [{ elementId: `index.html#${id}`, data }] : []),
  ]);
}
