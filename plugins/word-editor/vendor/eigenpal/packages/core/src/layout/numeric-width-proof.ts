import type { FieldAwarePiece } from './field-pieces.ts';
import type { PendingLine } from './pending-line.ts';
import type { ParagraphFlowOptions } from './paragraph-flow-options.ts';
import { lineTiedToPlacement } from './paragraph-cache-width-reuse.ts';
import { createWidthComparisonProof, widthComparisonProofHolds } from './width-comparison-proof.ts';

import { rememberNumericWidthProof } from './numeric-width-proof-cache.ts';
export { numericLinesHoldAtWidth, carryNumericWidthProof } from './numeric-width-proof-cache.ts';
const PIECE_KEYS = new Set(['text', 'props', 'style', 'start', 'end', 'fontSlot']);

/**
 * One complete numeric piece has no word seams, spaces, tabs, punctuation, or field effects.
 * With zero first-line offset and no exclusions, its empty line room is exactly available.
 * Only the oversized-word comparisons select its cuts. Other paragraphs keep full breaking.
 */
export function numericWidthTrace(
  pieces: readonly FieldAwarePiece[],
  available: number,
  indentLeft: number,
  firstLineOffset: number,
  paragraphRtl: boolean,
  flow: ParagraphFlowOptions | undefined,
  tolerance: number
):
  | {
      observe(width: number, room: number, fits: boolean): void;
      finish(lines: readonly PendingLine[]): void;
    }
  | undefined {
  const piece = pieces[0];
  if (
    pieces.length !== 1 ||
    !piece ||
    piece.text.length < 2 ||
    piece.text.length > 64 ||
    !/^[0-9]+$/.test(piece.text) ||
    piece.start !== 0 ||
    piece.end !== piece.text.length ||
    paragraphRtl ||
    piece.style.shaping?.direction === 'rtl' ||
    firstLineOffset !== 0 ||
    !Number.isFinite(indentLeft) ||
    !Number.isFinite(available) ||
    available < 1 ||
    (flow?.contentOriginX ?? 0) < 0 ||
    !Number.isFinite(flow?.contentOriginX ?? 0) ||
    (flow?.startOffset ?? 0) !== 0 ||
    flow?.pageExclusionZones?.length ||
    flow?.ownBandsFromFirstLine?.size
  )
    return undefined;
  for (const key of Object.keys(piece))
    if (!PIECE_KEYS.has(key) && piece[key as keyof FieldAwarePiece] !== undefined) return undefined;
  const trace = createWidthComparisonProof(tolerance);
  let invalid = false;
  return {
    observe(width, room, fits) {
      if (room !== available) invalid = true;
      trace.observe(width, room, fits);
    },
    finish(lines) {
      const proof = trace.finish();
      if (invalid || !proof || lines.length < 2 || lines.length > 64) return;
      let start = 0;
      let text = '';
      for (const line of lines) {
        if (
          lineTiedToPlacement(line) ||
          line.spans.length !== 1 ||
          line.start !== start ||
          line.firstLineOffset ||
          line.borrowedSpace ||
          line.compressesSpaces
        )
          return;
        const span = line.spans[0]!;
        if (
          span.fieldAtom ||
          span.noteNav ||
          span.noteSeparator ||
          span.lineEndWhitespace ||
          span.optionalHyphenBreak ||
          span.tabLeader ||
          span.glyphOffsetPt ||
          span.range.start !== line.start ||
          span.range.end !== line.end ||
          span.text.length !== line.end - line.start ||
          span.box.width !== line.width
        )
          return;
        start = line.end;
        text += span.text;
      }
      if (
        text !== piece.text ||
        start !== piece.end ||
        !widthComparisonProofHolds(proof, available)
      )
        return;
      // Without tabs or exclusions, lineAvailable is max(available, -lineOrigin).
      // Keep that second operand below every accepted candidate's available room.
      const minimumAvailable = Math.max(1, -((flow?.contentOriginX ?? 0) + indentLeft));
      if (!Number.isFinite(minimumAvailable) || available < minimumAvailable) return;
      rememberNumericWidthProof(lines, { ...proof, minimumAvailable });
    },
  };
}
