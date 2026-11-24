import { firstReviewRange, type ReviewItem, type SemanticPosition } from '../layout/index.ts';

/**
 * The whole span a card covers. Content kinds (insert/delete/replace) span first range
 * start to last range end — their ranges are contiguous by construction, a replacement's
 * two halves included. Everything else anchors at its first range only.
 */
export function reviewItemSpan(
  item: ReviewItem
): { readonly start: SemanticPosition; readonly end: SemanticPosition } | null {
  if (item.kind === 'revision') {
    const ranges = item.ranges;
    if (ranges.length === 0) return null;
    const contiguous =
      item.revisionKind === 'replace' ||
      item.revisionKind === 'insert' ||
      item.revisionKind === 'delete';
    const last = contiguous ? ranges[ranges.length - 1]! : ranges[0]!;
    return { start: ranges[0]!.start, end: last.end };
  }
  const range = firstReviewRange(item);
  return range ? { start: range.start, end: range.end } : null;
}
