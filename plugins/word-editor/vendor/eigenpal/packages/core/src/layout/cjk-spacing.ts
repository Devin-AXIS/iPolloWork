// Opt-in OOXML punctuation compression and hanging punctuation. All advances
// are measured here and travel in layout records to browser paint and exporters.
import type { FieldAwarePiece } from './field-projection.ts';
import { formatRevisionOf } from './revision-projection.ts';
import { segmentGraphemes } from './grapheme.ts';
import { measureDisplayText, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import {
  eastAsianLanguage,
  kinsokuCharacters,
  koreanFinalMarkHangs,
  type CjkParagraphTypography,
} from './cjk-typography.ts';
import { withLayoutDerivedSpacing } from './layout-derived-spacing.ts';
import { isRunKerningEnabled } from './run-kerning.ts';

const FULLWIDTH_PUNCTUATION =
  /^[、。〈〉《》「」『』【】〔〕〖〗〘〙〚〛！（），．：；？［］｛｝]$/u;
// Opening/closing classes have a half-em side bearing. A colon needs a separate
// seam rule because its ink can be centred, depending on the face and locale.
const OPENING = /^[〈《「『【〔〖〘〚（［｛]$/u;
const CLOSING = /^[、。〉》」』】〕〗〙〛），．］｝]$/u;

/** A colon cannot borrow an opening bearing across a line or exclusion passage. */
export function colonLostOpeningBearing(lines: LineSpans): boolean {
  return lines.some((line) =>
    line.spans.some(
      (span, index) =>
        span.glyphOffsetPt === 0 &&
        span.text.endsWith('：') &&
        (!line.spans[index + 1] || (line.spans[index + 1]!.wrapAdvanceBefore ?? 0) > 0)
    )
  );
}

type LineSpans = readonly { readonly spans: readonly StyleSpanRecord[] }[];

/** Natural advances a paragraph keeps after a shared bearing was lost to a line break. */
export interface LineLocalAdvances {
  /** Every centred colon keeps its natural advance. */
  readonly preserveColonAdvances: boolean;
  /** Source offsets of closing punctuation whose right bearing stays. */
  readonly keepRightBearings?: ReadonlySet<number>;
}
const SHARED_BEARINGS: LineLocalAdvances = Object.freeze({ preserveColonAdvances: false });

/**
 * A shared punctuation bearing holds only when both characters share a line. Returns the
 * advances for a retry when a colon or a line-final closing character lost its neighbour
 * to the next line, or `null` when the lines stand.
 */
export function lineLocalBearingRetry(
  lines: LineSpans,
  advances: LineLocalAdvances
): LineLocalAdvances | null {
  // Natural colon advances move line breaks, so read line-final characters on the retried
  // lines. Kept bearings found now could land mid-line there and break a same-line pair.
  if (!advances.preserveColonAdvances && colonLostOpeningBearing(lines)) {
    return { ...advances, preserveColonAdvances: true };
  }
  const keep = new Set(advances.keepRightBearings);
  for (const line of lines.slice(0, -1)) {
    const span = line.spans.at(-1);
    if (span?.glyphOffsetPt !== 0 || span.text.endsWith('：')) continue;
    const last = segmentGraphemes(span.text).at(-1)!;
    if (CLOSING.test(last.text)) keep.add(span.range.end - last.text.length);
  }
  if (keep.size === (advances.keepRightBearings?.size ?? 0)) return null;
  return { ...advances, keepRightBearings: keep };
}

/**
 * Natural widths of right-trimmed punctuation. A line fits such a character at its natural
 * advance: the shared bearing applies only when its neighbour lands on the same line.
 */
export function cjkSeamNaturalWidths(
  pieces: readonly FieldAwarePiece[],
  originals: readonly FieldAwarePiece[],
  measurer: TextMeasurer
): ReadonlyMap<FieldAwarePiece, number> {
  const widths = new Map<FieldAwarePiece, number>();
  let originalIndex = 0;
  for (const piece of pieces) {
    if (piece.glyphOffsetPt !== 0) continue;
    while (originalIndex + 1 < originals.length && originals[originalIndex]!.end <= piece.start)
      originalIndex++;
    const original = originals[originalIndex]!;
    widths.set(
      piece,
      measureDisplayText(piece.text, styleForFontSlot(original.style, original.fontSlot), measurer)
    );
  }
  return widths;
}

const compressible = (piece: FieldAwarePiece): boolean =>
  !piece.projected &&
  // Outlined ink extends into the nominal bearing; keep its complete advance.
  !piece.style.textOutline &&
  // Mirroring changes which glyph side owns the bearing. Keep RTL ink uncompressed
  // until compression can resolve the mirrored glyph's physical bearings.
  piece.style.shaping?.direction !== 'rtl' &&
  // Transparent selection ink suppresses native decorations. Keep decorated and
  // tracked text on the native paint path, including hidden revision presentations.
  !piece.style.underline &&
  !piece.style.strike &&
  !piece.style.doubleStrike &&
  !piece.revisions?.length &&
  !formatRevisionOf(piece.props) &&
  piece.measureText === undefined &&
  !piece.positionalTab &&
  !piece.equation &&
  !piece.inlineDrawing &&
  piece.end - piece.start === piece.text.length;

interface CompressionSlice {
  readonly from: number;
  readonly to: number;
  readonly reduction: number;
  readonly glyphOffset: number | undefined;
}

function compressionSlices(
  pieces: readonly FieldAwarePiece[],
  includePunctuation: boolean,
  measurer: TextMeasurer,
  { preserveColonAdvances, keepRightBearings }: LineLocalAdvances
): ReadonlyMap<FieldAwarePiece, readonly CompressionSlice[]> {
  const starts: number[] = [];
  let length = 0;
  const text = pieces
    .map((piece) => {
      starts.push(length);
      const visible = compressible(piece) ? piece.text : '\ufffc';
      length += visible.length;
      return visible;
    })
    .join('');
  const slices = new Map<FieldAwarePiece, CompressionSlice[]>();
  const ownerAt = (offset: number): FieldAwarePiece | undefined => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return pieces[low];
  };
  const pairEnabled = (left: number, right: number): boolean => {
    if (!includePunctuation) return false;
    const a = ownerAt(left);
    const b = ownerAt(right);
    return Boolean(
      a &&
      b &&
      [a, b].every(
        (piece) =>
          isRunKerningEnabled(styleForFontSlot(piece.style, piece.fontSlot)) &&
          !/^ko(?:-|$)/i.test(eastAsianLanguage(piece.props) ?? '')
      )
    );
  };
  let pieceIndex = 0;
  const clusters = segmentGraphemes(text);
  for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
    const cluster = clusters[clusterIndex]!;
    const previous = clusters[clusterIndex - 1]?.text;
    const next = clusters[clusterIndex + 1]?.text;
    while (pieceIndex + 1 < pieces.length && starts[pieceIndex + 1]! <= cluster.utf16From)
      pieceIndex++;
    const base = pieces[pieceIndex]!;
    // Remove one shared half-em at a punctuation seam, not both neighbours'
    // bearings. Ordinary text and authored spaces are never compression triggers.
    // Paragraph and manual-line boundaries do not supply a neighbouring bearing.
    const trimLeft =
      OPENING.test(cluster.text) &&
      previous !== undefined &&
      OPENING.test(previous) &&
      pairEnabled(clusters[clusterIndex - 1]!.utf16From, cluster.utf16From);
    const trimRight =
      next !== undefined &&
      !keepRightBearings?.has(base.start + cluster.utf16From - starts[pieceIndex]!) &&
      pairEnabled(cluster.utf16From, clusters[clusterIndex + 1]!.utf16From) &&
      ((CLOSING.test(cluster.text) &&
        (OPENING.test(next) || CLOSING.test(next) || next === '：')) ||
        // Retain the following opening's left bearing. It receives a centred
        // colon's overhang without moving or clipping the colon's native ink.
        (cluster.text === '：' &&
          (OPENING.test(next) || CLOSING.test(next)) &&
          !preserveColonAdvances &&
          !base.style.highlight &&
          !base.style.shading));
    const fraction = trimLeft || trimRight ? 0.5 : 0;
    if (!fraction) continue;
    // Measure the complete cluster with its base character's font. Apply the
    // same per-unit reduction to every fragment, including split combining marks.
    const face = styleForFontSlot(base.style, base.fontSlot);
    const advance = measureDisplayText(cluster.text, face, measurer);
    // Authored tracking is not part of a glyph's side bearing. Do not remove half
    // of that tracking, or let compression turn an advance negative.
    const naturalAdvance =
      trimLeft || trimRight
        ? measureDisplayText(cluster.text, { ...face, characterSpacingPt: 0 }, measurer)
        : advance;
    let bearing = naturalAdvance * fraction;
    if (cluster.text === '：' && next !== undefined) {
      let nextPieceIndex = pieceIndex;
      const nextFrom = clusters[clusterIndex + 1]!.utf16From;
      while (nextPieceIndex + 1 < pieces.length && starts[nextPieceIndex + 1]! <= nextFrom)
        nextPieceIndex++;
      const nextPiece = pieces[nextPieceIndex]!;
      const nextFace = styleForFontSlot(nextPiece.style, nextPiece.fontSlot);
      if (OPENING.test(next)) {
        // A smaller following bracket cannot receive a larger colon's whole half-em.
        const nextAdvance = measureDisplayText(
          next,
          { ...nextFace, characterSpacingPt: 0 },
          measurer
        );
        bearing = Math.min(bearing, Math.max(0, nextAdvance / 2));
      } else {
        // Word halves the complete colon cell before closing punctuation, including
        // authored spacing. Word permits overlapping horizontal bounds here:
        // centered colon dots and low closing ink occupy different vertical bands.
        // Keep native ink within the pair; the natural-width wrap guard prevents
        // a colon from losing this following cell across a line or float passage.
        const ink = measurer.inkBounds?.(cluster.text, face);
        const nextInk = measurer.inkBounds?.(next, nextFace);
        const nextAdvance = measureDisplayText(next, nextFace, measurer);
        if (
          !ink ||
          !nextInk ||
          ![ink.left, ink.right, nextInk.left, nextInk.right].every(Number.isFinite) ||
          ink.left < 0 ||
          nextInk.left < 0 ||
          ink.right < ink.left ||
          nextInk.right < nextInk.left ||
          ink.right > naturalAdvance ||
          ink.right > advance / 2 + nextAdvance ||
          nextInk.right > nextAdvance ||
          nextPiece.style.highlight ||
          nextPiece.style.shading
        )
          continue;
        bearing = advance / 2;
      }
    }
    const reduction = Math.max(0, Math.min(advance, bearing)) / cluster.text.length;
    for (
      let index = pieceIndex;
      index < pieces.length && starts[index]! < cluster.utf16To;
      index++
    ) {
      const piece = pieces[index]!;
      const from = Math.max(0, cluster.utf16From - starts[index]!);
      const to = Math.min(piece.text.length, cluster.utf16To - starts[index]!);
      if (from === to) continue;
      let list = slices.get(piece);
      if (!list) {
        list = [];
        slices.set(piece, list);
      }
      list.push({
        from,
        to,
        reduction,
        glyphOffset: trimLeft ? -reduction : trimRight ? 0 : undefined,
      });
    }
  }
  return slices;
}

export function compressCjkPieces(
  pieces: readonly FieldAwarePiece[],
  policy: CjkParagraphTypography,
  measurer: TextMeasurer,
  advances: LineLocalAdvances = SHARED_BEARINGS
): readonly FieldAwarePiece[] {
  const punctuation =
    policy.settings?.punctuationKerning !== false && policy.settings?.sourceEastAsianFont === true;
  if (!punctuation) return pieces;
  const result: FieldAwarePiece[] = [];
  const derived = new WeakMap<ResolvedRunStyle, Map<number, ResolvedRunStyle>>();
  const slices = compressionSlices(pieces, punctuation, measurer, advances);
  for (const piece of pieces) {
    const compressedSlices = slices.get(piece);
    if (!compressedSlices) {
      result.push(piece);
      continue;
    }
    let from = 0;
    for (const slice of compressedSlices) {
      if (slice.from > from)
        result.push({
          ...piece,
          text: piece.text.slice(from, slice.from),
          start: piece.start + from,
          end: piece.start + slice.from,
        });
      // Compress whitespace, never horizontally scale the glyph. The same letter
      // spacing reaches measurement, paint, caret edges, and export.
      const spacing = piece.style.characterSpacingPt - slice.reduction;
      let bySpacing = derived.get(piece.style);
      if (!bySpacing) {
        bySpacing = new Map();
        derived.set(piece.style, bySpacing);
      }
      let compressed = bySpacing.get(spacing);
      if (!compressed) {
        compressed = withLayoutDerivedSpacing(piece.style, spacing);
        bySpacing.set(spacing, compressed);
      }
      result.push({
        ...piece,
        text: piece.text.slice(slice.from, slice.to),
        start: piece.start + slice.from,
        end: piece.start + slice.to,
        style: compressed,
        ...(slice.glyphOffset !== undefined ? { glyphOffsetPt: slice.glyphOffset } : {}),
      });
      from = slice.to;
    }
    if (from === 0) result.push(piece);
    else if (from < piece.text.length)
      result.push({ ...piece, text: piece.text.slice(from), start: piece.start + from });
  }
  return result;
}

/**
 * Line-end marks that stay inside the measure in Japanese text. They wrap with the character
 * before them instead of hanging.
 */
const JAPANESE_NON_HANGING = '〕》〉！？：；・!?:;)]}％°';
/** Closing and other punctuation, and the degree sign, which Chinese text also hangs. */
const HANGING_CLASS = /^[\p{Pe}\p{Pf}\p{Po}°]$/u;
/** The half-width ideographic comma cannot start a Traditional Chinese line, and never hangs. */
const TRADITIONAL_CHINESE_NON_HANGING = '､';

/**
 * Whether the paragraph's line-start rules let `mark` hang. The list is the custom or default
 * one for the run language. A paragraph that turns kinsoku off hangs only half-width marks,
 * except in a legacy compatibility mode, whose hanging ignores the switch. Without a run
 * language the list is unknown, and only the switch counts.
 */
function lineStartForbids(
  mark: string,
  language: string | undefined,
  policy: CjkParagraphTypography
): boolean {
  if (!policy.kinsoku && policy.settings?.legacyLineEndPunctuation !== true)
    return !FULLWIDTH_PUNCTUATION.test(mark);
  return (
    language === undefined || kinsokuCharacters(language, policy.settings).before.includes(mark)
  );
}

/** How {@link hangingCjkPunctuationAdvance} decides a line-end mark. */
export interface HangingMarkOptions {
  /**
   * Only whitespace follows the text in its paragraph. Korean text hangs a mark other than
   * `。` or `、` only there.
   */
  readonly paragraphFinal?: boolean;
  /**
   * The paragraph typography. With it, a mark hangs only when the line-start rules forbid it
   * at a line start; otherwise it starts the next line.
   */
  readonly policy?: CjkParagraphTypography;
}

/** The advance of the final mark that may hang past the margin, or undefined when none may. */
export function hangingCjkPunctuationAdvance(
  text: string,
  piece: FieldAwarePiece,
  measurer: TextMeasurer,
  { paragraphFinal = false, policy }: HangingMarkOptions = {}
): number | undefined {
  if (piece.projected || piece.measureText !== undefined) return undefined;
  // Callers check the paragraph's hanging policy first. Ordinary Latin words/spaces must not
  // allocate a grapheme array on every placement candidate just to discover no punctuation.
  const tail = text[text.length - 1];
  if (!tail || !HANGING_CLASS.test(tail)) return undefined;
  const language = eastAsianLanguage(piece.props);
  if (
    language?.startsWith('ko') &&
    (!paragraphFinal || '。、'.includes(tail) || !koreanFinalMarkHangs(policy?.settings))
  )
    return undefined;
  if (language?.startsWith('ja') && JAPANESE_NON_HANGING.includes(tail)) return undefined;
  // Simplified Chinese keeps a full-width full stop inside the measure; Traditional hangs it.
  if (/^zh-cn$/i.test(language ?? '') && tail === '．') return undefined;
  if (/^zh-(tw|hk|mo|hant)(-|$)/.test(language ?? '') && TRADITIONAL_CHINESE_NON_HANGING === tail)
    return undefined;
  if (policy && !lineStartForbids(tail, language, policy)) return undefined;
  if (!FULLWIDTH_PUNCTUATION.test(tail) && !language) return undefined;
  const last = segmentGraphemes(text).at(-1)?.text;
  if (!last || !HANGING_CLASS.test(last)) return undefined;
  return measureDisplayText(last, styleForFontSlot(piece.style, piece.fontSlot), measurer);
}

/** Whether the text fits the remaining measure once its final mark hangs past the margin. */
export function hangsWithin(advance: number | undefined, remaining: number, width: number) {
  return advance !== undefined && width - advance <= remaining + 0.001 && remaining >= -0.001;
}

export function canHangCjkPunctuation(
  text: string,
  piece: FieldAwarePiece,
  remaining: number,
  width: number,
  measurer: TextMeasurer,
  options: HangingMarkOptions = {}
): boolean {
  return hangsWithin(
    hangingCjkPunctuationAdvance(text, piece, measurer, options),
    remaining,
    width
  );
}
