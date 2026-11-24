// A `w:hint="eastAsia"` character the East Asian face has no glyph for.
//
// The hint sends punctuation and symbols such as U+2011, quotes, and dashes to the East Asian
// face. When that face has no glyph for the character (SimSun, Microsoft YaHei, MingLiU, Malgun
// Gothic, and Batang have no U+2011), the character is drawn by a fallback face with the advance
// of the Latin face, and the East Asian face sets neither its width nor the line height. The
// run language does not change this. Projection resolves font slots before any face is known,
// so this pass runs where a measurer is: it hands such characters back to the Latin slot.
import { hasEastAsiaSymbolHint, isEastAsiaHinted } from './east-asia-symbol-hint.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './text-measurer.ts';

/** Every character the hint can move: the unconditional table and the conditional ranges. */
const ANY_HINT_SCOPE = { chineseLanguage: true, chineseFace: true } as const;

/**
 * Split hinted East Asian pieces so that each character the East Asian face cannot draw takes
 * the Latin slot. Pieces are returned as they are when the measurer cannot answer coverage.
 */
export function returnUncoveredHintedText(
  pieces: FieldAwarePiece[],
  measurer: TextMeasurer
): FieldAwarePiece[] {
  if (!measurer.faceCovers) return pieces;
  let out: FieldAwarePiece[] | null = null;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const cuts = hintedPiece(piece) ? uncoveredRanges(piece, measurer) : [];
    if (cuts.length === 0) {
      out?.push(piece);
      continue;
    }
    out ??= pieces.slice(0, index);
    let from = 0;
    for (const range of cuts) {
      if (range.from > from) out.push(slice(piece, from, range.from, true));
      out.push(slice(piece, range.from, range.to, false));
      from = range.to;
    }
    if (from < piece.text.length) out.push(slice(piece, from, piece.text.length, true));
  }
  return out ?? pieces;
}

/** A literal East Asian slot piece of a run with the East Asian hint. */
function hintedPiece(piece: FieldAwarePiece): boolean {
  return (
    piece.fontSlot === 'eastAsia' &&
    piece.end - piece.start === piece.text.length &&
    !piece.projected &&
    piece.measureText === undefined &&
    !piece.fieldAtom &&
    !piece.noteNav &&
    !piece.equation &&
    !piece.inlineDrawing &&
    hasEastAsiaSymbolHint(piece.props)
  );
}

/** Ranges of hintable characters, whole code points, that the East Asian face cannot draw. */
function uncoveredRanges(
  piece: FieldAwarePiece,
  measurer: TextMeasurer
): { from: number; to: number }[] {
  const style = styleForFontSlot(piece.style, 'eastAsia');
  const ranges: { from: number; to: number }[] = [];
  for (let from = 0; from < piece.text.length;) {
    const codePoint = piece.text.codePointAt(from)!;
    const to = from + (codePoint > 0xffff ? 2 : 1);
    const character = piece.text.slice(from, to);
    if (
      isEastAsiaHinted(codePoint, ANY_HINT_SCOPE) &&
      measurer.faceCovers!(character, style) === false
    ) {
      const previous = ranges.at(-1);
      if (previous && previous.to === from) previous.to = to;
      else ranges.push({ from, to });
    }
    from = to;
  }
  return ranges;
}

function slice(
  piece: FieldAwarePiece,
  from: number,
  to: number,
  eastAsia: boolean
): FieldAwarePiece {
  const { fontSlot: _slot, ...rest } = piece;
  return {
    ...rest,
    text: piece.text.slice(from, to),
    start: piece.start + from,
    end: piece.start + to,
    ...(eastAsia ? { fontSlot: 'eastAsia' as const } : {}),
  };
}
