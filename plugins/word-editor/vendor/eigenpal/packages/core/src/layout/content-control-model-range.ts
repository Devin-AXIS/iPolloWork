// The model range an inline content control covers, published on its boundary record so a
// consumer maps the control to positions through the model, never back from its geometry.

import type { ContentControlModelRange } from './semantic-records.ts';

interface CollectedRange {
  readonly level: string;
  readonly paragraphId?: string;
  readonly range?: { readonly start: number; readonly end: number };
}

/** `{ range }` for an inline control with a known paragraph range, else nothing. */
export function modelRangeOf(collected: CollectedRange): { range?: ContentControlModelRange } {
  const { paragraphId, range } = collected;
  if (collected.level !== 'inline' || paragraphId === undefined || range === undefined) return {};
  return { range: { paragraphId, start: range.start, end: range.end } };
}

export function sameModelRange(
  left: ContentControlModelRange | undefined,
  right: ContentControlModelRange | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.paragraphId === right.paragraphId && left.start === right.start && left.end === right.end
  );
}
