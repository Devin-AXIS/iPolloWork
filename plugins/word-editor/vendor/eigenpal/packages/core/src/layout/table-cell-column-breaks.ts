// Column breaks inside a table cell.
import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import type { FieldAwarePiece } from './field-pieces.ts';

/**
 * A column break (`w:br w:type="column"`, 17.3.3.1) inside a table cell breaks nothing. The
 * text after it continues on the same line, and the cell takes no extra line, in a section of
 * one column or of several. That is how a page break inside a cell behaves, so the break
 * takes the ignored page break's path: it keeps its offset and has no geometry.
 */
export function ignoreCellColumnBreaks(
  pieces: readonly FieldAwarePiece[],
  inTableCell: boolean
): readonly FieldAwarePiece[] {
  if (!inTableCell || !pieces.some((piece) => piece.breakKind === 'column')) return pieces;
  return pieces.map((piece) =>
    piece.breakKind === 'column' ? { ...piece, text: PAGE_BREAK_CHAR, breakKind: 'page' } : piece
  );
}
