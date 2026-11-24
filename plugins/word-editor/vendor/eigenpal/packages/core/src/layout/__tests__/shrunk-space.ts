// A left-to-right line shrinks a space by moving the spans after it left: the span keeps its
// natural box, and the next span starts inside it. A line that bidi reorders carries the shrink
// as negative word spacing in the span's style instead. These helpers read either.
import type { StyleSpanRecord } from '../semantic-records.ts';

/** How far the space closing `spans[index]` shrank. */
export function shrunkBy(spans: readonly StyleSpanRecord[], index: number): number {
  const span = spans[index]!;
  const next = spans[index + 1];
  // Only a next span to the right can start inside this one; bidi can place it to the left.
  const overlap =
    next && next.box.x > span.box.x ? Math.max(0, span.box.x + span.box.width - next.box.x) : 0;
  return overlap + Math.max(0, -(span.style.shaping?.wordSpacingPt ?? 0));
}

/** The shrink of every span's closing space as a negative spacing, 0 where none. */
export function spacingOf(spans: readonly StyleSpanRecord[]): number[] {
  return spans.map((_, index) => {
    const shrink = shrunkBy(spans, index);
    return shrink > 1e-9 ? -shrink : 0;
  });
}

/** Whether any space on the line shrank. */
export function anyShrunk(spans: readonly StyleSpanRecord[]): boolean {
  return spans.some((_, index) => shrunkBy(spans, index) > 0.001);
}
