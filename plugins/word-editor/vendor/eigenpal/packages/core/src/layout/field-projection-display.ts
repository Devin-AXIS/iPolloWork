import { unmergedPiecesOfParagraphForDisplay } from './field-projection-walk.ts';
import { styleSeparatorPieces, collectDisplayPieces } from './style-separator-pieces.ts';
import { splitFieldResultBreaks } from './field-result-breaks.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
/** Internal view projection retains each display member's source style. @internal */
export function piecesOfParagraphForDisplay(
  ...args: Parameters<typeof unmergedPiecesOfParagraphForDisplay>
): FieldAwarePiece[] {
  return splitFieldResultBreaks(
    styleSeparatorPieces(args, unmergedPiecesOfParagraphForDisplay) ??
      collectDisplayPieces(args, unmergedPiecesOfParagraphForDisplay)
  );
}
