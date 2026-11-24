/** Refuse a text range that cuts through an atomic drawing. */
export function rangePartiallyOverlapsDrawingAtom(
  segments: readonly {
    readonly start: number;
    readonly end: number;
    readonly removeNodeIds?: readonly string[];
  }[],
  start: number,
  end: number
): boolean {
  for (const segment of segments) {
    if (!segment.removeNodeIds || segment.removeNodeIds.length === 0) continue;
    const overlaps = start < segment.end && end > segment.start;
    if (!overlaps) continue;
    const covers = start <= segment.start && end >= segment.end;
    if (!covers) return true;
  }
  return false;
}
