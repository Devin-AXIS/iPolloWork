import { setLineHangingPunctuationAdvance } from './line-hanging-punctuation.ts';
import { hangingCjkPunctuationAdvance } from './cjk-spacing.ts';
import { eastAsianLanguage, type CjkParagraphTypography } from './cjk-typography.ts';
import type { FieldAwarePiece } from './field-projection.ts';
import type { ParagraphFlowOptions } from './paragraph-flow-options.ts';
import type { PendingLine } from './pending-line.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/**
 * Whether only whitespace follows `boundary` of `pieces[pieceIndex]` in its paragraph: text
 * ending there closes the paragraph.
 */
export function paragraphFinalAt(
  pieces: readonly FieldAwarePiece[]
): (pieceIndex: number, boundary: number) => boolean {
  let lastPiece = -1;
  let lastEnd = 0;
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const end = pieces[index]!.text.trimEnd().length;
    if (end > 0) {
      lastPiece = index;
      lastEnd = end;
      break;
    }
  }
  return (pieceIndex, boundary) =>
    pieceIndex > lastPiece || (pieceIndex === lastPiece && boundary >= lastEnd);
}

/**
 * The advance of the half-width Latin mark (below U+2000) that ends `candidate` and may hang
 * past the margin, or 0. A justified line that may shrink its spaces
 * (`ParagraphFlowOptions.spaceShrink`) shrinks them before such a mark hangs, and
 * hangs it only when the spaces reach their floor first: see `spaceShrinkFit`. Full-width
 * marks hang as before.
 */
export function spaceShrinkMarkAdvance(
  candidate: string,
  piece: FieldAwarePiece,
  measurer: TextMeasurer,
  typography: CjkParagraphTypography,
  paragraphFinal: boolean
): number {
  const mark = candidate.at(-1);
  if (!(typography.hangingPunctuation ?? typography.overflowPunctuation)) return 0;
  if (mark === undefined || mark.charCodeAt(0) >= 0x2000) return 0;
  const options = { paragraphFinal, policy: typography };
  return hangingCjkPunctuationAdvance(candidate, piece, measurer, options) ?? 0;
}

/**
 * Retain the actual overflow decision for alignment after placement and cache reuse. A
 * hanging Korean mark lets the text before it fill the measure only under
 * `koreanHangingLineFills`; otherwise that line keeps its natural width.
 */
export function rememberHangingPunctuation(
  line: PendingLine,
  span: StyleSpanRecord,
  piece: FieldAwarePiece,
  measurer: TextMeasurer,
  hangs: boolean,
  available: number,
  flow: Pick<ParagraphFlowOptions, 'koreanHangingLineFills'> | undefined
): void {
  // `hangs` already admitted the mark, so a Korean mark that hangs closes its paragraph.
  let advance =
    hangs && line.width + span.box.width > available + 0.001
      ? hangingCjkPunctuationAdvance(span.text, piece, measurer, { paragraphFinal: true })
      : undefined;
  if (
    advance !== undefined &&
    flow?.koreanHangingLineFills !== true &&
    /^ko(?:-|$)/.test(eastAsianLanguage(piece.props) ?? '')
  )
    advance = undefined;
  if (advance !== undefined || !span.lineEndWhitespace)
    setLineHangingPunctuationAdvance(line, advance);
}
