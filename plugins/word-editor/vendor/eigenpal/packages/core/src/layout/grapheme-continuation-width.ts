// Reserve a complete grapheme before placing its first source-run fragment.
// The fragments keep their own styles, advances, and model ranges.
import type { FieldAwarePiece } from './field-pieces.ts';
import { isDefaultGraphemeBoundary, segmentGraphemes } from './grapheme.ts';
import { marksContinue } from './cjk-line-break.ts';
import { usesEastAsianParagraphBreaks } from './cjk-paragraph-breaks.ts';
import type { CjkParagraphTypography } from './cjk-typography.ts';
import { isParagraphText, paragraphBreakText } from './paragraph-word-cuts.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';

export function graphemeContinuationWidth(
  pieces: readonly FieldAwarePiece[],
  measurer: TextMeasurer,
  policy?: CjkParagraphTypography
): ((pieceIndex: number, boundary: number) => number) | undefined {
  if (policy && !usesEastAsianParagraphBreaks(pieces, policy)) return undefined;
  if (pieces.length < 2) return () => 0;
  if (
    isDefaultGraphemeBoundary() &&
    pieces.every((piece, index) => {
      const previous = pieces[index - 1];
      if (!previous) return true;
      if (
        !isParagraphText(previous) ||
        !isParagraphText(piece) ||
        previous.measureText !== undefined ||
        piece.measureText !== undefined ||
        !previous.text.length ||
        !piece.text.length
      )
        return false;
      const left = previous.text.charCodeAt(previous.text.length - 1);
      const right = piece.text.charCodeAt(0);
      return left >= 0x20 && left <= 0x7e && right >= 0x20 && right <= 0x7e;
    })
  )
    return () => 0;
  const tails = new Map<FieldAwarePiece, number>();
  const { text, starts } = paragraphBreakText(pieces);
  let pieceIndex = 0;
  for (const cluster of segmentGraphemes(text)) {
    while (
      pieceIndex + 1 < pieces.length &&
      starts.get(pieces[pieceIndex + 1]!)! <= cluster.utf16From
    )
      pieceIndex++;
    const fragments: { piece: FieldAwarePiece; text: string }[] = [];
    let plain = true;
    for (let index = pieceIndex; index < pieces.length; index++) {
      const piece = pieces[index]!;
      const start = starts.get(piece)!;
      if (start >= cluster.utf16To) break;
      if (!isParagraphText(piece) || piece.measureText !== undefined) {
        plain = false;
        break;
      }
      const from = Math.max(0, cluster.utf16From - start);
      const to = Math.min(piece.text.length, cluster.utf16To - start);
      if (to > from) fragments.push({ piece, text: piece.text.slice(from, to) });
    }
    if (!plain || fragments.length < 2) continue;
    let following = 0;
    for (let index = fragments.length - 1; index >= 0; index--) {
      const fragment = fragments[index]!;
      if (index < fragments.length - 1) {
        if (!marksContinue(fragment.text.charCodeAt(fragment.text.length - 1))) following = 0;
        tails.set(fragment.piece, following);
      }
      following += measureDisplayText(
        fragment.text,
        styleForFontSlot(fragment.piece.style, fragment.piece.fontSlot),
        measurer
      );
    }
  }
  return (index, boundary) => {
    const piece = pieces[index]!;
    return boundary === piece.text.length ? (tails.get(piece) ?? 0) : 0;
  };
}
