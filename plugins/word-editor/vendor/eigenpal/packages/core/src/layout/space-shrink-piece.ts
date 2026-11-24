import type { FieldAwarePiece } from './field-pieces.ts';

/** Text with a stable measured advance that can complete a space-compressed word. */
export function isSpaceShrinkWordPiece(piece: FieldAwarePiece): boolean {
  const field = piece.fieldAtom;
  if (
    piece.positionalTab ||
    piece.measureText !== undefined ||
    piece.inlineDrawing ||
    piece.anchoredAtom ||
    piece.equation ||
    piece.noteSeparator ||
    // Form fields and page-number fields change after the line is decided.
    (field && !field.fixedResult)
  )
    return false;
  if (piece.projected) {
    // Body citations keep their atomic range, even when their display has several digits.
    // A field shown by its saved result (a cross-reference number) has a fixed width too.
    // Reserved page-local marks retain their existing policy.
    return (
      (piece.noteNav?.direction === 'to-note' ||
        (piece.noteNav === undefined && field?.fixedResult === true)) &&
      piece.end - piece.start === 1 &&
      piece.text.length > 0 &&
      !/\s/u.test(piece.text)
    );
  }
  return field === undefined && piece.end - piece.start === piece.text.length;
}
