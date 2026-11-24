// Line pieces around the combining kana sound marks, U+3099 and U+309A (`sound-mark-spacing.ts`).
import type { FieldAwarePiece } from './field-pieces.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { hasSoundMark, isSoundMark } from './sound-mark-spacing.ts';
import type { TextMeasurer } from './text-measurer.ts';

/** Below this, an advance in points counts as zero. */
const EPSILON_PT = 0.001;

/**
 * Split literal pieces around the sound marks that need a span of their own. Pieces without
 * such a mark are returned as they are. Line breaking still keeps each mark with its base.
 *
 * The face decides, through the measurer: a mark spaces when its base and the mark together
 * measure wider than the base alone. Measuring the mark alone is not enough: some faces draw a
 * lone mark on a dotted circle, which they never draw after a base.
 *
 * - A face that draws the mark in a cell of its own: the mark lays out, and paints, as its own
 *   span, so a renderer that composes a base and a mark in one string draws them apart.
 * - A face that joins the mark with its base, where the lone mark adds no glyph and no advance
 *   and its ink lies inside its own cell: a mark that opens a piece after its base in another
 *   run cannot join it in one string, so it paints over its base, shifted back by the base
 *   advance.
 */
export function splitAtSpacedSoundMarks(
  pieces: FieldAwarePiece[],
  measurer: TextMeasurer
): FieldAwarePiece[] {
  let out: FieldAwarePiece[] | null = null;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const previous = adjacentBase(pieces[index - 1], piece);
    const overlay = baseOverlayOffset(previous, piece, measurer);
    const cuts = spacedSoundMarkCuts(previous, piece, measurer);
    if (overlay !== undefined && piece.text.length > 1 && cuts[0] !== 1) cuts.unshift(1);
    if (cuts.length === 0 && overlay === undefined) {
      out?.push(piece);
      continue;
    }
    out ??= pieces.slice(0, index);
    let from = 0;
    for (const to of [...cuts, piece.text.length]) {
      out.push({
        ...piece,
        text: piece.text.slice(from, to),
        start: piece.start + from,
        end: piece.start + to,
        ...(from === 0 && overlay !== undefined ? { glyphOffsetPt: overlay } : {}),
      });
      from = to;
    }
  }
  return out ?? pieces;
}

/** The previous piece when it ends, right before `piece`, with a base for a mark; else undefined. */
function adjacentBase(
  previous: FieldAwarePiece | undefined,
  piece: FieldAwarePiece
): FieldAwarePiece | undefined {
  if (!previous || !ordinaryPiece(previous) || previous.end !== piece.start) return undefined;
  const base = previous.text.at(-1);
  return base === undefined || /^[\s\p{M}]$/u.test(base) ? undefined : previous;
}

/** The advance a mark adds after `base` in `style`: zero where the face joins them. */
function addedAdvance(
  base: string,
  mark: string,
  style: ResolvedRunStyle,
  measurer: TextMeasurer
): number {
  return measurer.measure(base + mark, style) - measurer.measure(base, style);
}

/**
 * The glyph offset that draws a mark opening `piece` over the last character of `previous`,
 * or undefined. The mark joins its base, has no advance and no extra glyph alone, and its ink
 * lies inside its own cell, so drawn at the pen it would land on the next character.
 */
function baseOverlayOffset(
  previous: FieldAwarePiece | undefined,
  piece: FieldAwarePiece,
  measurer: TextMeasurer
): number | undefined {
  const mark = piece.text[0];
  if (!previous || mark === undefined || !isSoundMark(mark) || !ordinaryPiece(piece))
    return undefined;
  const base = previous.text.at(-1)!;
  const style = styleForFontSlot(piece.style, piece.fontSlot);
  if (addedAdvance(base, mark, style, measurer) > EPSILON_PT) return undefined;
  if (measurer.measure(mark, style) > EPSILON_PT) return undefined;
  const ink = measurer.inkBounds?.(mark, style);
  if (!ink || ink.left < 0) return undefined;
  const advance = measurer.measure(base, styleForFontSlot(previous.style, previous.fontSlot));
  return advance > EPSILON_PT ? -advance : undefined;
}

function ordinaryPiece(piece: FieldAwarePiece): boolean {
  return (
    piece.end - piece.start === piece.text.length &&
    !piece.projected &&
    piece.measureText === undefined &&
    !piece.fieldAtom &&
    !piece.equation &&
    !piece.inlineDrawing &&
    piece.glyphOffsetPt === undefined
  );
}

function spacedSoundMarkCuts(
  previous: FieldAwarePiece | undefined,
  piece: FieldAwarePiece,
  measurer: TextMeasurer
): number[] {
  if (!hasSoundMark(piece.text) || !ordinaryPiece(piece)) return [];
  const style = styleForFontSlot(piece.style, piece.fontSlot);
  const cuts: number[] = [];
  let base = previous?.text.at(-1);
  for (let offset = 0; offset < piece.text.length; offset += 1) {
    const mark = piece.text[offset]!;
    if (!isSoundMark(mark)) {
      base = mark;
      continue;
    }
    // A mark after another mark measures against the same base.
    if (base === undefined || addedAdvance(base, mark, style, measurer) <= EPSILON_PT) continue;
    if (offset > 0 && cuts.at(-1) !== offset) cuts.push(offset);
    if (offset + 1 < piece.text.length) cuts.push(offset + 1);
  }
  return cuts;
}
