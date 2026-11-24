// Saved field results laid out as text (`fieldResults: 'editable'`).
//
// In that mode a field that shows its saved result (DATE, MERGEFIELD, HYPERLINK display text)
// has no model unit of its own: its result runs are ordinary text at their own offsets, the
// same offsets the store's editable mode addresses. These helpers mark the pieces of one such
// result so paint and the caret can treat them as one field.

import { fldSimpleInstr, type OoxmlElement } from '@docx-editor.dev/core/store';
import { parseHyperlinkInstruction } from './field-link.ts';
import { parseRefLinkInstruction } from './field-ref-link.ts';
import type { FieldAwarePiece, FieldLinkProjector } from './field-pieces.ts';
import type { SpanLinkRecord } from './semantic-records.ts';

/**
 * The link a saved `w:fldSimple` result carries: the enclosing typed link when there is one,
 * otherwise its own HYPERLINK (or hyperlinked REF) instruction through the sanitizing projector.
 */
export function savedSimpleResultLink(
  simple: OoxmlElement,
  currentLink: SpanLinkRecord | undefined,
  projectFieldLink: FieldLinkProjector | undefined
): SpanLinkRecord | undefined {
  if (currentLink) return currentLink;
  const instruction = fldSimpleInstr(simple) ?? '';
  const spec = parseHyperlinkInstruction(instruction) ?? parseRefLinkInstruction(instruction);
  return (spec ? projectFieldLink?.(spec) : null) ?? undefined;
}

/**
 * Mark the pieces from `first` on as one saved result over `[resultStart, resultEnd)`. A piece
 * already marked as a field (a buffered complex result) keeps its own marker fields.
 */
export function markSavedResultPieces(
  pieces: FieldAwarePiece[],
  first: number,
  resultStart: number,
  resultEnd: number
): void {
  for (let index = first; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    pieces[index] = {
      ...piece,
      fieldAtom: { ...(piece.fieldAtom ?? { formField: false }), resultStart, resultEnd },
    };
  }
}
