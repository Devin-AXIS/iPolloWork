import { findNode } from '../store/package/ooxml-edit.ts';
// Field boundaries, rather than paragraph ownership, define the generated read-only region.
import { paragraphOffsetIndex, type OoxmlPart, type TreeDocOp } from '@docx-editor.dev/core/store';
import { detectBodyTocs, tocFieldRange, type DetectedToc } from '../store/package/toc-detect.ts';
import { treeOpReach } from '../store/store/tree-op-content-controls.ts';
import type { SemanticPosition, SemanticSelection } from '../layout/semantic-interaction.ts';

export interface TocParagraphRange {
  readonly toc: DetectedToc;
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  readonly length: number;
  readonly startsHere: boolean;
  readonly endsHere: boolean;
}
const cache = new WeakMap<OoxmlPart, readonly TocParagraphRange[]>();
export function tocParagraphRanges(part: OoxmlPart): readonly TocParagraphRange[] {
  const cached = cache.get(part);
  if (cached) return cached;
  const tocs = detectBodyTocs(part);
  if (tocs.length === 0) {
    cache.set(part, []);
    return [];
  }
  const ranges: TocParagraphRange[] = [];
  for (const toc of tocs) {
    const field = tocFieldRange(toc);
    for (const paragraphId of new Set([
      toc.beginParagraphId,
      ...toc.resultParagraphIds,
      toc.endParagraphId,
    ])) {
      const paragraph = findNode(part, paragraphId);
      if (paragraph?.kind !== 'paragraph') continue;
      const offsets = paragraphOffsetIndex(paragraph);
      const startsHere = paragraphId === toc.beginParagraphId;
      const endsHere = paragraphId === toc.endParagraphId;
      ranges.push({
        toc,
        paragraphId,
        length: offsets.length,
        startsHere,
        endsHere,
        start: startsHere ? (offsets.spanOf(toc.beginNodeId)?.start ?? 0) : 0,
        end:
          endsHere && field
            ? (offsets.spanOf(field.endNodeId)?.end ?? offsets.length)
            : offsets.length,
      });
    }
  }
  cache.set(part, ranges);
  return ranges;
}
export function fullyProtectedTocParagraphs(part: OoxmlPart): ReadonlySet<string> {
  return new Set(
    tocParagraphRanges(part)
      .filter(
        (r) => r.start === 0 && r.end === r.length && !(r.endsHere && !r.startsHere && r.end === 0)
      )
      .map((r) => r.paragraphId)
  );
}
function contains(range: TocParagraphRange, offset: number): boolean {
  if (range.endsHere && !range.startsHere && range.end === 0) return false;
  if (range.startsHere && range.start > 0 && offset <= range.start) return false;
  if (range.endsHere && range.end < range.length && offset >= range.end) return false;
  return offset >= range.start && offset <= range.end;
}
export function tocAtPosition(
  part: OoxmlPart,
  position: SemanticPosition
): DetectedToc | undefined {
  return tocParagraphRanges(part).find(
    (r) => r.paragraphId === position.paragraphId && contains(r, position.offset)
  )?.toc;
}
export function selectionTouchesTocRange(part: OoxmlPart, selection: SemanticSelection): boolean {
  const { anchor, head } = selection;
  if (anchor.paragraphId === head.paragraphId) {
    const start = Math.min(anchor.offset, head.offset),
      end = Math.max(anchor.offset, head.offset);
    return tocParagraphRanges(part).some(
      (r) =>
        r.paragraphId === anchor.paragraphId &&
        (start === end ? contains(r, start) : start < r.end && end > r.start)
    );
  }
  // Whole controls can be removed by a surrounding selection. The operation guard checks
  // writes into generated paragraphs; selection endpoints catch edits starting inside one.
  return tocAtPosition(part, anchor) !== undefined || tocAtPosition(part, head) !== undefined;
}
export function opTouchesTocRange(part: OoxmlPart, op: TreeDocOp): boolean {
  const ranges = tocParagraphRanges(part);
  if (ranges.length === 0) return false;
  const reach = treeOpReach(op);
  if (reach.kind === 'nodes') {
    return reach.targets.some((target) =>
      ranges.some((r) => {
        if (target.nodeId !== r.paragraphId) return false;
        if (target.range) {
          const { start, end } = target.range;
          return start === end ? contains(r, start) : start < r.end && end > r.start;
        }
        if (op.op === 'joinParagraphs' && op.firstId === r.paragraphId && r.endsHere && r.end === 0)
          return false;
        if (target.removes || target.structural) return true;
        // A marker-only boundary must not prevent styling the ordinary heading after it.
        return r.end > r.start || (r.length === 0 && !r.endsHere);
      })
    );
  }
  // Retain the existing refusal for paragraph ids in other operation shapes.
  const ids = new Set(ranges.map((r) => r.paragraphId));
  const inspect = (value: unknown, key = ''): boolean => {
    if (typeof value === 'string') return /(?:Id|Ids)$/.test(key) && ids.has(value);
    if (Array.isArray(value)) return value.some((v) => inspect(v, key));
    return (
      !!value && typeof value === 'object' && Object.entries(value).some(([k, v]) => inspect(v, k))
    );
  };
  return inspect(op);
}

export function tocEscapePosition(
  part: OoxmlPart,
  position: SemanticPosition,
  backwards: boolean
): SemanticPosition | null {
  const toc = tocAtPosition(part, position);
  if (!toc) return null;
  const range = tocParagraphRanges(part).find(
    (r) =>
      r.toc.id === toc.id &&
      (backwards ? r.startsHere && r.start > 0 : r.endsHere && r.end < r.length)
  );
  return range
    ? { paragraphId: range.paragraphId, offset: backwards ? range.start : range.end }
    : null;
}

export function tocControlId(toc: DetectedToc, part: OoxmlPart): string {
  const partial = tocParagraphRanges(part).some(
    (range) => range.toc.id === toc.id && (range.start > 0 || range.end < range.length)
  );
  return !partial && toc.contentControlId ? toc.contentControlId : `toc:${toc.id}`;
}

export function tocForElement(
  part: OoxmlPart,
  paragraphId: string | null | undefined,
  target: Element | null
): DetectedToc | undefined {
  if (!paragraphId) return undefined;
  const run = target?.closest<HTMLElement>('[data-start]');
  return tocParagraphRanges(part).find(
    (range) =>
      range.paragraphId === paragraphId &&
      (run
        ? Number(run.dataset.start) < range.end && Number(run.dataset.end) > range.start
        : fullyProtectedTocParagraphs(part).has(paragraphId))
  )?.toc;
}

/** Whether a body paragraph belongs to a detected TOC boundary or cached result. */
export function paragraphInBodyToc(part: OoxmlPart, paragraphId: string): boolean {
  return detectBodyTocs(part).some(
    (toc) =>
      toc.beginParagraphId === paragraphId ||
      toc.endParagraphId === paragraphId ||
      toc.resultParagraphIds.includes(paragraphId)
  );
}
