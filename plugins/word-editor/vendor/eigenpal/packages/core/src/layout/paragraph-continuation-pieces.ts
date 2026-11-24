import type { FieldAwarePiece } from './field-pieces.ts';
import { withRuleWidths } from './horizontal-rule.ts';
import type { TextboxStoryLayouter } from './inline-textbox-flow.ts';
import { withFittedInlineTextboxes } from './textbox-placement.ts';

/** Keep projected boundary content while trimming already placed model text. */
export function paragraphContinuationPieces(
  pieces: readonly FieldAwarePiece[],
  startOffset: number,
  showFieldCodes = false
): FieldAwarePiece[] {
  return pieces.flatMap((piece): FieldAwarePiece[] => {
    if (
      piece.end <= startOffset &&
      !(
        (startOffset === 0 || showFieldCodes || piece.unsupported) &&
        piece.projected &&
        piece.start === piece.end &&
        piece.start === startOffset
      )
    )
      return [];
    if (piece.start >= startOffset) return [piece];
    const trim = startOffset - piece.start;
    return [
      {
        ...piece,
        text: piece.projected ? piece.text : piece.text.slice(trim),
        start: startOffset,
      },
    ];
  });
}

/**
 * The continuation pieces, with each horizontal rule sized to the line width `widthPt` and
 * each inline text box that fits its text sized to that text.
 */
export function continuationPiecesWithRules(
  pieces: readonly FieldAwarePiece[],
  startOffset: number,
  flow:
    | {
        readonly showFieldCodes?: boolean;
        readonly layoutTextboxStory?: TextboxStoryLayouter;
      }
    | undefined,
  widthPt: number
): FieldAwarePiece[] {
  return withFittedInlineTextboxes(
    withRuleWidths(paragraphContinuationPieces(pieces, startOffset, flow?.showFieldCodes), widthPt),
    flow?.layoutTextboxStory
  );
}
