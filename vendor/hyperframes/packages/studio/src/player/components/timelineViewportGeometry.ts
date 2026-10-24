import { TIMELINE_VIEWPORT_BUDGETS } from "../lib/timelineViewportBudgets";
import type { TimelineTimeRange } from "../lib/timelineClipIndex";
interface TimelineScrollViewportSnapshot { scrollLeft: number; clientWidth: number; }

export function getTimelineRenderTimeRange(
  viewport: Pick<TimelineScrollViewportSnapshot, "scrollLeft" | "clientWidth">,
  pixelsPerSecond: number,
  contentOrigin: number,
  duration: number,
): TimelineTimeRange {
  if (!(pixelsPerSecond > 0) || !(duration > 0) || !(viewport.clientWidth > 0)) {
    return { start: 0, end: 0 };
  }
  const overscanPx = viewport.clientWidth * TIMELINE_VIEWPORT_BUDGETS.timeOverscanViewportRatio;
  const startPx = viewport.scrollLeft - contentOrigin - overscanPx;
  const endPx = viewport.scrollLeft + viewport.clientWidth - contentOrigin + overscanPx;
  return {
    start: Math.min(duration, Math.max(0, startPx / pixelsPerSecond)),
    end: Math.min(duration, Math.max(0, endPx / pixelsPerSecond)),
  };
}

export function getTimelineVisibleTimeRange(
  viewport: Pick<TimelineScrollViewportSnapshot, "scrollLeft" | "clientWidth">,
  pixelsPerSecond: number,
  contentOrigin: number,
  duration: number,
): { start: number; end: number } {
  if (!(pixelsPerSecond > 0) || !(duration > 0)) return { start: 0, end: 0 };
  const start = Math.max(0, (viewport.scrollLeft - contentOrigin) / pixelsPerSecond);
  const end = Math.min(
    duration,
    Math.max(start, (viewport.scrollLeft + viewport.clientWidth - contentOrigin) / pixelsPerSecond),
  );
  return { start: Math.min(start, duration), end };
}
