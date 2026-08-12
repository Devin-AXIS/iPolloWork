import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { resolveElementVisibleTiming } from "../../player/lib/timedClipVisibility";
import type { DomEditSelection } from "./domEditingTypes";

/**
 * The single source of truth for an element's clip start/duration in the
 * inspector. Both the Motion group's Timing row (`FlatTimingRow`) and the
 * Layout group's keyframe gutter (fed via `elStart`/`elDuration` from
 * `PropertyPanel.tsx` through `PropertyPanelFlat.tsx`) must derive this the
 * same way — otherwise a keyframe-percentage seek in Layout lands on a
 * different absolute time than the range Motion displays for the same
 * element (found by the Plan 3a+3b whole-plan coherence review).
 *
 * Precedence: the live DOM visibility window (the intersection of the element
 * and its timed ancestors), then detached/authored data attributes, then the
 * element's own GSAP tweens (earliest tween start → latest tween end).
 */
export interface ElementTiming {
  start: number;
  duration: number;
  /** True when duration/start came from `deriveTimingFromAnimations`, not an authored attribute. */
  inferred: boolean;
}

export interface ElementTimingRange {
  start: number;
  end: number;
  duration: number;
}

const END_PREVIEW_EPSILON_SECONDS = 0.001;

/** Keep the untouched boundary fixed when editing an absolute timeline range. */
export function resolveElementTimingEdit(
  start: number,
  end: number,
  field: "start" | "end",
  value: number,
): ElementTimingRange | null {
  const nextStart = field === "start" ? value : start;
  const nextEnd = field === "end" ? value : end;
  if (
    !Number.isFinite(nextStart) ||
    !Number.isFinite(nextEnd) ||
    nextStart < 0 ||
    nextEnd <= nextStart
  ) {
    return null;
  }
  return { start: nextStart, end: nextEnd, duration: nextEnd - nextStart };
}

/** Keep the selected element visible after its timeline range is shortened. */
export function clampPreviewTimeToElementRange(
  currentTime: number,
  range: Pick<ElementTimingRange, "start" | "end">,
): number {
  if (currentTime < range.start) return range.start;
  if (currentTime >= range.end) {
    return Math.max(range.start, range.end - END_PREVIEW_EPSILON_SECONDS);
  }
  return currentTime;
}

function deriveTimingFromAnimations(
  animations: GsapAnimation[],
): { start: number; duration: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of animations) {
    const s = a.resolvedStart ?? (typeof a.position === "number" ? a.position : 0);
    const d = a.duration ?? 0;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s + d);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  return { start: lo, duration: hi - lo };
}

export function deriveElementTiming(
  element: Pick<DomEditSelection, "dataAttributes" | "element">,
  animations: GsapAnimation[] = [],
): ElementTiming {
  const visibleTiming = resolveElementVisibleTiming(element.element);
  if (visibleTiming) {
    return { ...visibleTiming, inferred: false };
  }

  const explicitStart = Number.parseFloat(element.dataAttributes.start ?? "0") || 0;
  const explicitDuration =
    Number.parseFloat(
      element.dataAttributes.duration ?? element.dataAttributes["hf-authored-duration"] ?? "0",
    ) || 0;

  const derived = explicitDuration > 0 ? null : deriveTimingFromAnimations(animations);
  return {
    start: derived ? derived.start : explicitStart,
    duration: derived ? derived.duration : explicitDuration,
    inferred: derived !== null,
  };
}
