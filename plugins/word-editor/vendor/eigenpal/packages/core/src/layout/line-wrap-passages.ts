import { lineContentEdges, type PendingLine } from './pending-line.ts';
import type { WrapBreakSpace } from './wrap-break-space.ts';

/** A horizontal run of x a float leaves free on one line, in paragraph-local coordinates. */
export interface WrapInterval {
  readonly start: number;
  readonly end: number;
}

/** The one passage that holds a whole line. */
export interface WrapSegment extends WrapInterval {
  /**
   * Where the content ends, when the pen stepped over a float but placed nothing past it.
   * Alignment measures the content from here rather than from the pen.
   */
  readonly contentEnd?: number;
}

/**
 * The float passages a closed line aligns inside: `wrapSegment` when one passage holds the
 * WHOLE line, or `wrapPassages` when the line steps over a float and owns two or more disjoint
 * runs of x, each aligning inside its own passage. Null when the line aligns against the
 * paragraph's own measure.
 *
 * `contentStart` is where the line's content begins, after any first-line indent; it opens
 * the first passage. `contentEnd` is the far edge of the line's content, and `penEnd` is where
 * the pen stopped, which can lie past a float the line stepped over without placing anything.
 * `borrowedSpace` says the line compresses its spaces, so content that runs past the first
 * passage without reaching a later one still aligns inside that passage.
 */
export function lineWrapPassages(
  intervals: readonly WrapInterval[],
  contentStart: number,
  contentEnd: number,
  penEnd: number,
  measure: WrapInterval,
  borrowedSpace = false
):
  | { readonly wrapSegment: WrapSegment }
  | { readonly wrapPassages: readonly WrapInterval[] }
  | null {
  const from = intervals.findIndex(
    (interval) => contentStart >= interval.start - 0.001 && contentStart <= interval.end + 0.001
  );
  if (from < 0) return null;
  const segment = intervals[from]!;
  if (contentEnd > segment.end + 0.001) {
    let to = from;
    while (to + 1 < intervals.length && intervals[to + 1]!.start <= contentEnd + 0.001) to += 1;
    if (to > from) {
      return {
        wrapPassages: intervals.slice(from, to + 1).map((interval, index) => ({
          start: index === 0 ? contentStart : interval.start,
          end: interval.end,
        })),
      };
    }
    // A line that borrowed inter-word space overflows its passage by that amount and
    // still compresses inside it.
    if (!borrowedSpace) return null;
  }
  // The full measure is what alignment already assumes; recording it would only add a
  // second spelling of the same geometry to every cache key.
  if (segment.start <= measure.start + 0.001 && segment.end >= measure.end - 0.001) return null;
  const stepped = penEnd > segment.end + 0.001;
  return {
    wrapSegment: { start: contentStart, end: segment.end, ...(stepped ? { contentEnd } : {}) },
  };
}

/**
 * Record on `line` the float passages it aligns inside, from the `intervals` its pen saw on
 * this line. A line in a mirrored break space records them in that space and is marked
 * `wrapMirrored`, so alignment can map each part back to its physical passage.
 */
export function recordLineWrapPassages(
  line: PendingLine,
  intervals: readonly WrapInterval[],
  lineOrigin: number,
  space: Pick<WrapBreakSpace, 'left' | 'right' | 'mirrored'>
): void {
  const penEnd = lineOrigin + line.width;
  const edges = lineContentEdges(line.spans, line.drawings);
  const contentStart = edges?.left ?? Math.max(space.left, lineOrigin);
  const passages = lineWrapPassages(
    intervals,
    contentStart,
    Math.min(penEnd, edges?.right ?? penEnd),
    penEnd,
    { start: space.left, end: space.right },
    line.borrowedSpace === true
  );
  if (!passages) return;
  Object.assign(line, passages);
  if (space.mirrored) line.wrapMirrored = true;
}
