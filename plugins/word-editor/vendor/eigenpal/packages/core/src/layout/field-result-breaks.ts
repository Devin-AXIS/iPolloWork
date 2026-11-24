// Breaks inside a projected field result.
//
// An atomic field paints its cached result as one projected piece over one model unit. The
// result text keeps each `w:br` / `w:cr` as `\n` and each page break as `\f`, the same
// vocabulary `paragraphTextOf` uses, but line breaking only ends a line at a BREAK PIECE.
// This pass cuts such a piece at its breaks: text parts and break parts all keep the
// field's one model range, so the caret, selection and offsets still see one atom.

import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import type { FieldAwarePiece } from './field-pieces.ts';

/**
 * Most breaks one projected piece is cut at. A result is already capped in length; this
 * caps the pieces one result can add. Breaks past it stay in the last part's text.
 */
export const MAX_FIELD_RESULT_BREAKS = 1_024;

function splitsAtBreaks(piece: FieldAwarePiece): boolean {
  if (!piece.projected || piece.breakKind || piece.positionalTab) return false;
  if (piece.inlineDrawing || piece.equation || piece.anchoredAtom) return false;
  if (piece.measureText !== undefined || piece.noteSeparator || piece.noteNav) return false;
  return piece.text.includes('\n') || piece.text.includes(PAGE_BREAK_CHAR);
}

function nextBreakAt(text: string, from: number): number {
  const line = text.indexOf('\n', from);
  const page = text.indexOf(PAGE_BREAK_CHAR, from);
  if (line < 0) return page;
  if (page < 0) return line;
  return Math.min(line, page);
}

function cutAtBreaks(piece: FieldAwarePiece, out: FieldAwarePiece[]): void {
  const { text } = piece;
  let from = 0;
  for (let cuts = 0; cuts < MAX_FIELD_RESULT_BREAKS; cuts += 1) {
    const at = nextBreakAt(text, from);
    if (at < 0) break;
    if (at > from) out.push({ ...piece, text: text.slice(from, at) });
    const page = text[at] === PAGE_BREAK_CHAR;
    out.push({ ...piece, text: page ? PAGE_BREAK_CHAR : '\n', breakKind: page ? 'page' : 'line' });
    from = at + 1;
  }
  if (from < text.length) out.push({ ...piece, text: text.slice(from) });
}

/** Cut each projected field result at its breaks; other pieces pass through unchanged. */
export function splitFieldResultBreaks(pieces: FieldAwarePiece[]): FieldAwarePiece[] {
  if (!pieces.some(splitsAtBreaks)) return pieces;
  const out: FieldAwarePiece[] = [];
  for (const piece of pieces) {
    if (splitsAtBreaks(piece)) cutAtBreaks(piece, out);
    else out.push(piece);
  }
  return out;
}
