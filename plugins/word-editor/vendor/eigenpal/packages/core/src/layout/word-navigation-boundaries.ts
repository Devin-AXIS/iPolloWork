import { paragraphLinesFor } from './paragraph-lines.ts';
import { lineSegmentFor } from './line-segments.ts';
import { contentControlsOfLayout, type SemanticLayout } from './semantic-records.ts';

/** Visible deletion boundaries split words without changing canonical text offsets. */
export function deletedTextBoundaries(
  layout: SemanticLayout,
  paragraphId: string
): ReadonlySet<number> {
  const stops = new Set<number>();
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
      if (span.range.end === span.range.start) continue;
      if (!span.revisions?.some((entry) => entry.kind === 'delete' || entry.kind === 'moveFrom')) {
        continue;
      }
      stops.add(span.range.start);
      stops.add(span.range.end);
    }
  }
  return stops;
}

/**
 * Word-motion stops: deletion edges plus both edges of every inline control.
 *
 * A control edge splits a word whatever the control's lock, so a word motion never carries
 * the caret into or out of a control in one step. An edge that already falls on a word edge
 * is still a stop of its own.
 */
export function wordMotionBoundaries(
  layout: SemanticLayout,
  paragraphId: string
): ReadonlySet<number> {
  const stops = new Set(deletedTextBoundaries(layout, paragraphId));
  for (const edge of inlineControlEdges(layout, paragraphId)) stops.add(edge);
  return stops;
}

/**
 * Both edges of every inline control in a paragraph, without deletion edges.
 *
 * The format painter's word uses these alone: it paints only the runs the view renders, so a
 * tracked deletion's edge must not split the word it paints.
 */
export function inlineControlEdges(
  layout: SemanticLayout,
  paragraphId: string
): ReadonlySet<number> {
  const stops = new Set<number>();
  for (const control of contentControlsOfLayout(layout)) {
    if (
      control.level !== 'inline' ||
      control.placeholder ||
      control.range?.paragraphId !== paragraphId
    )
      continue;
    stops.add(control.range.start);
    stops.add(control.range.end);
  }
  return stops;
}

/**
 * The side of an inline control edge that a pointer at `position` was on.
 *
 * A hit resolves to the nearest caret offset, so a click on the half of a letter next to a
 * control edge reports the edge itself. The control the hit lands in tells the two sides
 * apart: just outside a start edge, or just inside an end edge, the clicked letter is the one
 * BEFORE the offset.
 */
export function controlEdgeSide(
  layout: SemanticLayout,
  position: { readonly paragraphId: string; readonly offset: number },
  hitControlId: string | null
): 'before' | 'after' {
  const controls = contentControlsOfLayout(layout);
  const hit = hitControlId === null ? undefined : controls.find((c) => c.id === hitControlId);
  for (const control of controls) {
    const range = control.range;
    if (control.level !== 'inline' || range?.paragraphId !== position.paragraphId) continue;
    // An empty control has no box a pointer can land in, so it never tells the sides apart.
    if (range.start === range.end) continue;
    // Inside when the hit control is this control or one nested in it.
    const inside =
      hit?.range?.paragraphId === range.paragraphId &&
      hit.range.start >= range.start &&
      hit.range.end <= range.end;
    if (range.start === position.offset && !inside) return 'before';
    if (range.end === position.offset && inside) return 'before';
  }
  return 'after';
}
