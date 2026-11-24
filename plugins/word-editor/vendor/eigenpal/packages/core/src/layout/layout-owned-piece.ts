// Which pieces publish a model range that their painted text does not map one to one.

import type { FieldAwarePiece } from './field-pieces.ts';

/**
 * Whether layout owns this piece's range rather than its text.
 *
 * A projected field publishes the model range it stands in for. A `w:ptab` publishes its
 * ZERO-WIDTH insertion point, because it contributes no text to the paragraph. Any piece
 * whose display length disagrees with its model range is also layout-owned (an inert
 * DATE/TOC/REF cache before `projected` was set). Every span cut from such a piece
 * publishes the whole piece range.
 */
export function isLayoutOwnedPiece(piece: FieldAwarePiece): boolean {
  return (
    Boolean(piece.projected) ||
    Boolean(piece.positionalTab) ||
    piece.end - piece.start !== piece.text.length
  );
}

/**
 * Whether a piece's oversized word may be cut into display fragments.
 *
 * A layout-owned field result (a URL in a HYPERLINK field, a REF result) is cut too, with
 * every fragment publishing the whole piece range. Text that a later pass rewrites, or a
 * width that stands in for other text, stays whole: `measureText`, positional tabs, page
 * numbers, form controls, navigable note marks, and note separators.
 */
export function canChopPiece(piece: FieldAwarePiece): boolean {
  if (piece.measureText !== undefined) return false;
  if (!isLayoutOwnedPiece(piece)) return true;
  const atom = piece.fieldAtom;
  return (
    !piece.positionalTab &&
    !piece.noteNav &&
    !piece.noteSeparator &&
    !atom?.pageField &&
    !atom?.pageRef &&
    !atom?.formControl
  );
}
