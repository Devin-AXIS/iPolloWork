import { FieldResultsModeMemo } from '../store/package/field-result-mode.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { detectBodyTocs, tocFieldRange } from '../store/package/toc-detect.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';

export interface FieldCodeRange {
  readonly start: number;
  readonly end: number;
  readonly code?: string;
  readonly sourceNodeId?: string;
  readonly suppressParagraph: boolean;
}
export type FieldCodeRanges = ReadonlyMap<string, readonly FieldCodeRange[]>;
/** Offsets differ between field-result modes, so each mode keeps its own entry. */
const cache = new FieldResultsModeMemo<OoxmlPart, FieldCodeRanges>();
/** Cross-paragraph fields retain their original model ranges while their results are hidden. */
export function tocCodeRanges(part: OoxmlPart): FieldCodeRanges {
  const held = cache.get(part);
  if (held) return held;
  const ranges = new Map<string, FieldCodeRange[]>();
  for (const toc of detectBodyTocs(part)) {
    if (toc.beginParagraphId === toc.endParagraphId) continue;
    const field = tocFieldRange(toc);
    if (!field) continue;
    for (const id of new Set([
      toc.beginParagraphId,
      ...toc.resultParagraphIds,
      toc.endParagraphId,
    ])) {
      const paragraph = findNode(part, id);
      if (paragraph?.kind !== 'paragraph') continue;
      const offsets = paragraphOffsetIndex(paragraph);
      const startsHere = id === toc.beginParagraphId;
      const start = startsHere ? (offsets.spanOf(toc.beginNodeId)?.start ?? 0) : 0;
      const end =
        id === toc.endParagraphId
          ? (offsets.spanOf(field.endNodeId)?.end ?? offsets.length)
          : offsets.length;
      const range = {
        start,
        end,
        ...(startsHere
          ? { code: `{ ${toc.instruction.raw} }`, sourceNodeId: toc.beginNodeId }
          : {}),
        suppressParagraph: !startsHere && start === 0 && end === offsets.length,
      };
      const list = ranges.get(id);
      if (list) list.push(range);
      else ranges.set(id, [range]);
    }
  }
  cache.set(part, ranges);
  return ranges;
}
