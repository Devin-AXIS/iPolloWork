// Space advances with balanced single-byte and double-byte widths
// (`w:balanceSingleByteDoubleByteWidth`), in every compatibility mode. Measured rules:
//
// - A space whose neighbour on either side is an East Asian character (Hangul, a CJK ideograph,
//   kana) drawn in a face that holds East Asian glyphs takes the balanced width. A space
//   between Latin letters or digits keeps its own advance.
// - Every space in a run of two or more spaces takes the balanced width, whatever its
//   neighbours.
// - The balanced width is half the font size when the run's East Asian face holds East Asian
//   glyphs (Batang, Gulim, Malgun Gothic). Otherwise it is the average character width of the
//   space's own face (OS/2 `xAvgCharWidth`), as for Times New Roman.
// - Authored scaling (`w:w`) scales the balanced width, and the space's own character spacing
//   (`w:spacing`) counts twice: 10 pt text with -0.4 pt spacing has 4.2 pt spaces. Faces
//   without East Asian glyphs keep their spaces when the run scales or spaces its characters.
// - Only spaces widen. Latin letters, digits and punctuation keep their advances.
// - The no-break space and the tab keep their advances.
//
// A widened space is a piece of its own whose character spacing carries the difference, so line
// fitting, caret placement and paint read one advance. Source text and offsets never change.
import { authoredCjkGapMetric } from './cjk-auto-spacing-metric-port.ts';
import { knownFamilyReverseGap } from './authored-average-widths.ts';
import { isCjk } from './cjk-paragraph-breaks.ts';
import { fitTextGroupOf } from './fit-text-groups.ts';
import type { CjkParagraphTypography } from './cjk-typography.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { measureDisplayText, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './text-measurer.ts';

/** Below this, an advance in points counts as zero. */
const EPSILON_PT = 0.001;

/**
 * Styles of widened spaces, each to the style it widened from; their spans keep the balanced
 * width on justified lines.
 */
const widenedStyles = new WeakMap<ResolvedRunStyle, ResolvedRunStyle>();
/** No space has widened yet: lines of documents without balanced widths skip every lookup. */
let noneWidened = true;

/** Whether the span is a run of spaces at the balanced width. */
export function isBalancedSpace(span: { readonly style: ResolvedRunStyle }): boolean {
  return !noneWidened && widenedStyles.has(span.style);
}

/** Whether any line may hold a balanced space, read before a per-span search. */
export function mayHoldBalancedSpaces(): boolean {
  return !noneWidened;
}

/** Whether a paragraph with these settings widens spaces at all. */
function balancesSpaceWidths(typography: CjkParagraphTypography): boolean {
  return typography.settings?.balancedWidths === true;
}

/** A syllable, an ideograph, and kana: a face that draws any of them is an East Asian face. */
const EAST_ASIAN_SAMPLES = ['\uac00', '\u4e00', '\u3042', '\u30a2'];

/** Whether the face of `style` holds East Asian glyphs; a measurer without an answer says yes. */
function eastAsianFace(style: ResolvedRunStyle, measurer: TextMeasurer): boolean {
  if (!measurer.faceCovers) return true;
  const face = styleForFontSlot(style, 'eastAsia');
  return EAST_ASIAN_SAMPLES.some((sample) => measurer.faceCovers!(sample, face) !== false);
}

/**
 * The balanced width of one space in `style`: half the font size with an East Asian face,
 * otherwise the average character width of the space's face. Undefined when that width is
 * unknown.
 */
export function balancedSpaceWidth(
  style: ResolvedRunStyle,
  measurer: TextMeasurer | undefined
): number | undefined {
  if (!measurer || eastAsianFace(style, measurer)) return style.fontSizePt / 2;
  const half = authoredCjkGapMetric(measurer, style) ?? knownFamilyReverseGap(style);
  return half === undefined ? undefined : 2 * half;
}

/** Widened styles by measurer, run style and font slot; null where the space keeps its advance. */
const widenedByMeasurer = new WeakMap<
  TextMeasurer,
  WeakMap<ResolvedRunStyle, Map<FieldAwarePiece['fontSlot'], ResolvedRunStyle | null>>
>();

/** The style of a widened space in `style`, or null when the space keeps its advance. */
function widenedStyle(
  style: ResolvedRunStyle,
  fontSlot: FieldAwarePiece['fontSlot'],
  measurer: TextMeasurer
): ResolvedRunStyle | null {
  let byStyle = widenedByMeasurer.get(measurer);
  if (!byStyle) widenedByMeasurer.set(measurer, (byStyle = new WeakMap()));
  let bySlot = byStyle.get(style);
  if (!bySlot) byStyle.set(style, (bySlot = new Map()));
  const known = bySlot.get(fontSlot);
  if (known !== undefined) return known;
  let result: ResolvedRunStyle | null = null;
  const face = styleForFontSlot(style, fontSlot);
  const width = scaledBalancedSpaceWidth(face, measurer);
  if (width !== undefined) {
    // The widened space carries its whole difference from the unspaced glyph as spacing.
    const unspaced = face.characterSpacingPt === 0 ? face : { ...face, characterSpacingPt: 0 };
    const glyph = measureDisplayText(' ', unspaced, measurer);
    const spacing = width - glyph;
    if (Math.abs(spacing - style.characterSpacingPt) > EPSILON_PT) {
      result = { ...style, characterSpacingPt: spacing };
      widenedStyles.set(result, style);
      noneWidened = false;
    }
  }
  bySlot.set(fontSlot, result);
  return result;
}

/**
 * The balanced width of one space of `face` with its authored scaling and character spacing:
 * the balanced width scaled by `w:w`, plus twice `w:spacing`. Faces without East Asian glyphs
 * keep their spaces when the run scales or spaces its characters; their widths were not
 * measured.
 */
function scaledBalancedSpaceWidth(
  face: ResolvedRunStyle,
  measurer: TextMeasurer
): number | undefined {
  const plain = face.characterSpacingPt === 0 && face.horizontalScalePercent === 100;
  if (!plain && !eastAsianFace(face, measurer)) return undefined;
  const width = balancedSpaceWidth(face, measurer);
  // Strong condensing can make the width negative, as it does for a natural spaced space.
  if (width === undefined || plain) return width;
  return width * (face.horizontalScalePercent / 100) + 2 * face.characterSpacingPt;
}

/**
 * The style a widened space had before it widened, or the span's own style when it is not a
 * widened space. Its spacing is the authored one.
 */
export function unwidenedStyle(style: ResolvedRunStyle): ResolvedRunStyle {
  return (!noneWidened && widenedStyles.get(style)) || style;
}

function plainText(piece: FieldAwarePiece): boolean {
  return (
    piece.end - piece.start === piece.text.length &&
    !piece.projected &&
    piece.measureText === undefined &&
    !piece.fieldAtom &&
    !piece.equation &&
    !piece.inlineDrawing &&
    !piece.positionalTab &&
    !piece.style.hidden &&
    // A fitted group keeps its stated width.
    fitTextGroupOf(piece) === undefined
  );
}

/** Whether `character` of `piece` is East Asian text drawn in an East Asian face. */
function eastAsianNeighbour(
  piece: FieldAwarePiece | undefined,
  character: string | undefined,
  measurer: TextMeasurer
): boolean {
  const cp = character?.codePointAt(0);
  if (!piece || cp === undefined || !isCjk(cp)) return false;
  if (!measurer.faceCovers) return true;
  return measurer.faceCovers(character!, styleForFontSlot(piece.style, piece.fontSlot)) !== false;
}

/**
 * Split plain text pieces so that each space at the balanced width is a piece of its own, in
 * the widened style. Pieces are returned as they are when the document does not balance
 * widths or no space widens.
 */
export function widenBalancedSpaces(
  pieces: FieldAwarePiece[],
  typography: CjkParagraphTypography,
  measurer: TextMeasurer | undefined
): FieldAwarePiece[] {
  if (!measurer || !balancesSpaceWidths(typography)) return pieces;
  // Each run of spaces, as [piece, from, to) cuts; a run may continue across pieces.
  const widen = new Map<number, [number, number][]>();
  let index = 0;
  while (index < pieces.length) {
    const piece = pieces[index]!;
    const offset = plainText(piece) ? piece.text.indexOf(' ') : -1;
    if (offset < 0) {
      index += 1;
      continue;
    }
    index = collectSpaceRuns(pieces, index, measurer, widen);
  }
  if (widen.size === 0) return pieces;
  const out: FieldAwarePiece[] = [];
  pieces.forEach((piece, at) => {
    const cuts = widen.get(at);
    if (!cuts) return void out.push(piece);
    let from = 0;
    const push = (to: number, style: ResolvedRunStyle) => {
      if (to > from)
        out.push({
          ...piece,
          style,
          text: piece.text.slice(from, to),
          start: piece.start + from,
          end: piece.start + to,
        });
      from = to;
    };
    for (const [start, end] of cuts) {
      push(start, piece.style);
      push(end, widenedStyle(piece.style, piece.fontSlot, measurer)!);
    }
    push(piece.text.length, piece.style);
  });
  return out;
}

/**
 * Find the space runs of the plain pieces that start at `first` and continue while each piece
 * follows the last one directly. Records the runs that widen; answers the next piece to read.
 */
function collectSpaceRuns(
  pieces: readonly FieldAwarePiece[],
  first: number,
  measurer: TextMeasurer,
  widen: Map<number, [number, number][]>
): number {
  let end = first + 1;
  while (
    end < pieces.length &&
    plainText(pieces[end]!) &&
    pieces[end]!.start === pieces[end - 1]!.end
  )
    end += 1;
  const before = pieces[first - 1];
  let previous: { piece: FieldAwarePiece | undefined; character: string | undefined } = {
    piece: before && plainText(before) && before.end === pieces[first]!.start ? before : undefined,
    character: before ? lastCharacter(before.text) : undefined,
  };
  // The open run: its pieces and cuts, and its length in spaces.
  let run: { at: number; from: number; to: number }[] = [];
  const close = (piece: FieldAwarePiece | undefined, character: string | undefined) => {
    const length = run.reduce((sum, part) => sum + part.to - part.from, 0);
    if (
      length > 0 &&
      (length > 1 ||
        eastAsianNeighbour(previous.piece, previous.character, measurer) ||
        eastAsianNeighbour(piece, character, measurer))
    )
      for (const part of run) {
        const style = widenedStyle(pieces[part.at]!.style, pieces[part.at]!.fontSlot, measurer);
        if (style) {
          const cuts = widen.get(part.at) ?? [];
          cuts.push([part.from, part.to]);
          widen.set(part.at, cuts);
        }
      }
    run = [];
  };
  for (let at = first; at < end; at += 1) {
    const piece = pieces[at]!;
    const text = piece.text;
    for (let offset = 0; offset < text.length; offset += 1) {
      if (text[offset] === ' ') {
        const last = run.at(-1);
        if (last && last.at === at && last.to === offset) last.to += 1;
        else run.push({ at, from: offset, to: offset + 1 });
        continue;
      }
      const character = String.fromCodePoint(text.codePointAt(offset)!);
      if (run.length > 0) close(piece, character);
      previous = { piece, character };
      offset += character.length - 1;
    }
  }
  const after = pieces[end];
  if (run.length > 0)
    close(
      after && plainText(after) && after.start === pieces[end - 1]!.end ? after : undefined,
      after?.text === undefined || after.text === ''
        ? undefined
        : String.fromCodePoint(after.text.codePointAt(0)!)
    );
  return end;
}

/** The last code point of `text`, as a string. */
function lastCharacter(text: string): string | undefined {
  const tail = text.charCodeAt(text.length - 1);
  if (Number.isNaN(tail)) return undefined;
  return tail >= 0xdc00 && tail <= 0xdfff && text.length > 1 ? text.slice(-2) : text.slice(-1);
}
