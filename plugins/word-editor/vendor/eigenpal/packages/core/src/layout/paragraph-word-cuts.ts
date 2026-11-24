// Word boundaries read over paragraph text and mapped back to the pieces that hold it, shared
// by line breaking (`paragraph-word-breaks.ts`) and table AutoFit minimums.
//
// Per-piece `wordBoundaries` cannot see the text before a piece, so a dash that opens a run
// never broke after itself ("ALPHA" | "-PRIME"), though the same text in one run did. The
// space, zero-width-space, dash, and tab rules here read the paragraph text instead. A
// layout-owned piece (a field result, picture, equation, or positional tab) is a barrier in
// that text, as in the East Asian analysis, and keeps its own boundaries.

import { BREAK_AFTER_DASH, wordBoundaries } from './cjk-line-break.ts';
import type { FieldAwarePiece } from './field-pieces.ts';

/**
 * Whether a piece is text that maps one-to-one to model offsets. Every other piece is a
 * barrier in paragraph-wide break analysis.
 */
export const isParagraphText = (piece: FieldAwarePiece): boolean =>
  !piece.projected &&
  !piece.positionalTab &&
  !piece.inlineDrawing &&
  !piece.equation &&
  piece.end - piece.start === piece.text.length;

/**
 * Paragraph text for break analysis, and where each piece starts in it. Plain text joins as
 * itself, every other non-empty piece as one U+FFFC, and a skipped piece adds nothing.
 */
export function paragraphBreakText(
  pieces: readonly FieldAwarePiece[],
  skip: (piece: FieldAwarePiece) => boolean = () => false
): { readonly text: string; readonly starts: ReadonlyMap<FieldAwarePiece, number> } {
  const starts = new Map<FieldAwarePiece, number>();
  const strings: string[] = [];
  let total = 0;
  for (const piece of pieces) {
    starts.set(piece, total);
    const text = skip(piece)
      ? ''
      : isParagraphText(piece)
        ? piece.text
        : '￼'.repeat(Math.min(piece.text.length, 1));
    strings.push(text);
    total += text.length;
  }
  return { text: strings.join(''), starts };
}

/** Word boundaries per piece, read over the paragraph text. */
export interface ParagraphWordCuts {
  /**
   * The piece's break boundaries, ending at `text.length`: the space, zero-width-space, dash,
   * and tab rules of `wordBoundaries` over the paragraph text for plain text, and over the
   * piece's own text for a layout-owned piece.
   */
  boundaries(piece: FieldAwarePiece): readonly number[];
}

/**
 * Each piece's boundaries over the paragraph text, or null when per-piece `wordBoundaries`
 * already give every cut: no plain-text run after the first opens with a dash. `skip` drops
 * pieces that add no text, such as hidden runs, as they add no width.
 */
export function paragraphWordCuts(
  pieces: readonly FieldAwarePiece[],
  skip: (piece: FieldAwarePiece) => boolean = () => false
): ParagraphWordCuts | null {
  const runOpensWithDash = pieces.some(
    (piece, index) =>
      index > 0 && !skip(piece) && isParagraphText(piece) && BREAK_AFTER_DASH.has(piece.text[0]!)
  );
  if (!runOpensWithDash) return null;
  const { text, starts } = paragraphBreakText(pieces, skip);
  let paragraphCuts: readonly number[] | undefined;
  const boundaries = new Map<FieldAwarePiece, readonly number[]>();
  const boundariesOf = (piece: FieldAwarePiece): readonly number[] => {
    if (!isParagraphText(piece) || skip(piece)) return wordBoundaries(piece.text, false);
    // No ideographic pass: a paragraph with East Asian text takes the East Asian analysis.
    paragraphCuts ??= wordBoundaries(text, false);
    const start = starts.get(piece)!;
    const end = start + piece.text.length;
    // The first paragraph cut inside the piece.
    let low = 0;
    let high = paragraphCuts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (paragraphCuts[mid]! <= start) low = mid + 1;
      else high = mid;
    }
    const base: number[] = [];
    for (let at = low; at < paragraphCuts.length && paragraphCuts[at]! < end; at++)
      base.push(paragraphCuts[at]! - start);
    base.push(piece.text.length);
    return base;
  };
  return {
    boundaries(piece) {
      let found = boundaries.get(piece);
      if (!found) boundaries.set(piece, (found = boundariesOf(piece)));
      return found;
    },
  };
}
