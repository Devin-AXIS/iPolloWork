import type { TimelineElement } from "../player/store/playerStore";

export { buildPatchTarget, readFileContent } from "../hooks/timelineEditingHelpers";

/** Minimum distance (seconds) from clip boundaries to allow a split. */
export const SPLIT_BOUNDARY_EPSILON_S = 0.03;

/**
 * True when splitTime leaves at least SPLIT_BOUNDARY_EPSILON_S on both sides
 * of the cut. Inclusive at the epsilon offsets: the timeline canvas clamps
 * edge clicks to exactly start/end ± epsilon, so the clamped value must pass.
 */
export function isSplitTimeWithinBounds(
  splitTime: number,
  clipStart: number,
  clipDuration: number,
): boolean {
  return (
    splitTime >= clipStart + SPLIT_BOUNDARY_EPSILON_S &&
    splitTime <= clipStart + clipDuration - SPLIT_BOUNDARY_EPSILON_S
  );
}

export function canSplitElement(el: TimelineElement): boolean {
  return (
    !el.timelineLocked &&
    el.timingSource !== "implicit" &&
    !!el.duration &&
    Number.isFinite(el.duration)
  );
}

/**
 * True when `el` can be split AND `splitTime` lies within its boundary epsilon.
 * Shared by the single-clip and split-all razor paths so both honor the same
 * minimum-distance rule (split-all previously used raw `>`/`<`, letting cuts
 * land inside the epsilon margin and produce a degenerate slice).
 */
export function canSplitElementAt(el: TimelineElement, splitTime: number): boolean {
  return canSplitElement(el) && isSplitTimeWithinBounds(splitTime, el.start, el.duration);
}

/** Elements that the split-all razor action can cut at `splitTime`. */
export function selectSplittableElements(
  elements: TimelineElement[],
  splitTime: number,
): TimelineElement[] {
  return elements.filter((el) => canSplitElementAt(el, splitTime));
}

export interface OptimisticTimelineSplit {
  original: TimelineElement;
  originalKey: string;
  pendingKey: string;
  elements: TimelineElement[];
}

/**
 * Build the immediate timeline-only result shown while the source mutation is
 * being persisted. The original keeps its identity and selection; the second
 * half gets a temporary identity that the authoritative preview reload replaces.
 */
export function buildOptimisticTimelineSplit(
  elements: TimelineElement[],
  target: TimelineElement,
  splitTime: number,
  pendingKey: string,
): OptimisticTimelineSplit | null {
  if (!canSplitElementAt(target, splitTime)) return null;

  const originalKey = target.key ?? target.id;
  const index = elements.findIndex((element) => (element.key ?? element.id) === originalKey);
  if (index < 0) return null;

  const original = elements[index];
  const firstDuration = splitTime - original.start;
  const secondDuration = original.duration - firstDuration;
  if (firstDuration <= 0 || secondDuration <= 0) return null;

  const playbackRate = original.playbackRate ?? 1;
  const secondPlaybackStart =
    original.playbackStart == null
      ? undefined
      : original.playbackStart + firstDuration * playbackRate;
  const second: TimelineElement = {
    ...original,
    id: pendingKey,
    key: pendingKey,
    start: splitTime,
    duration: secondDuration,
    playbackStart: secondPlaybackStart,
    // The clone does not exist in the preview DOM until persistence completes.
    // Avoid temporarily pointing both timeline clips at the same live node.
    domId: undefined,
    hfId: undefined,
    selector: undefined,
    selectorIndex: undefined,
  };
  const nextElements = elements.slice();
  nextElements.splice(index, 1, { ...original, duration: firstDuration }, second);
  return { original, originalKey, pendingKey, elements: nextElements };
}

/** Roll back only this optimistic split without clobbering unrelated edits. */
export function rollbackOptimisticTimelineSplit(
  elements: TimelineElement[],
  split: OptimisticTimelineSplit,
): TimelineElement[] {
  if (!elements.some((element) => (element.key ?? element.id) === split.pendingKey)) {
    return elements;
  }

  return elements
    .filter((element) => (element.key ?? element.id) !== split.pendingKey)
    .map((element) =>
      (element.key ?? element.id) === split.originalKey
        ? {
            ...element,
            start: split.original.start,
            duration: split.original.duration,
            playbackStart: split.original.playbackStart,
          }
        : element,
    );
}
