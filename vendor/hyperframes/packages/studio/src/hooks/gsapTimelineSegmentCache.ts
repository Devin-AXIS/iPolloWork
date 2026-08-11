import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { StableElementLocator } from "@hyperframes/core/motion-presets";
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

interface TimelineMotionTarget {
  id: string;
  key?: string;
  domId?: string;
  hfId?: string;
  selector?: string;
  sourceFile?: string;
}

/**
 * Semantic motion can target a leaf by stable CSS selector even when that leaf
 * has no DOM id. Resolve that locator to the exact key consumed by TimelineLanes
 * so its phase strip is attached to the same row the user selected.
 */
export function resolveMotionTimelineTargetKeys(
  target: StableElementLocator,
  sourceFile: string,
  elements: readonly TimelineMotionTarget[],
): string[] {
  const keys = new Set<string>();
  for (const element of elements) {
    if ((element.sourceFile ?? "index.html") !== sourceFile) continue;
    const matches =
      (target.elementId !== undefined &&
        (element.domId === target.elementId || element.id === target.elementId)) ||
      (target.hfId !== undefined && element.hfId === target.hfId) ||
      element.selector === target.selector;
    if (matches) keys.add(element.key ?? element.id);
  }
  return Array.from(keys);
}

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
