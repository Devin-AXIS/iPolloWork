import { copyLineHangingPunctuation } from './line-hanging-punctuation.ts';
import { automaticTextSpacingBefore } from './cjk-automatic-spacing.ts';
// The broken-but-unplaced line: the record breakParagraph accumulates and pagination
// budgets, before placement publishes a LineRecord from it. Extracted from paragraph-flow
// so the flow module stays under its line budget; paragraph-flow re-exports everything here.

import { baselineShiftPtOf, type ResolvedRunStyle } from './run-style.ts';
import { isIdeographicForLineBreak, lastCodePointOf } from './cjk-line-break.ts';
import type { RevisionAttribution } from './revision-projection.ts';
import type { StyleSpanRecord } from './semantic-records.ts';
import { clipInlineDrawingRecordVertically, type InlineDrawingRecord } from './drawing-layout.ts';
import { topAndBottomSkipBeforeLine, type ExclusionZone } from './drawing-exclusion.ts';
import type { ModelRange } from './field-pieces.ts';
import type { WrapSegment } from './line-wrap-passages.ts';
import type { SpaceShrinkFloor } from './space-shrink-rule.ts';
import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';

export interface PendingLine {
  readonly spans: StyleSpanRecord[];
  readonly drawings: InlineDrawingRecord[];
  readonly start: number;
  end: number;
  width: number;
  height: number;
  baseline: number;
  /**
   * Space ABOVE the glyph band inside {@link height}.
   *
   * Exact spacing can center the glyphs and move the baseline. Auto/atLeast spacing leaves
   * this at zero and puts its extra depth below instead.
   */
  leading: number;
  /**
   * Auto/atLeast line-spacing depth below the painted glyph band.
   *
   * Word lets this external depth cross the bottom text margin when the glyphs themselves
   * still fit. Pagination therefore budgets {@link height} minus this amount at a page
   * bottom, while paint keeps the full box and padding.
   */
  trailingSpacing: number;
  /** When true, layout must start a new page after this line is placed. */
  pageBreakAfter?: boolean;
  /** When true, layout must advance to the next authored section column. */
  columnBreakAfter?: boolean;
  /** An authored line break (`w:br` textWrapping or `w:cr`), never an automatic wrap. */
  manualBreakAfter?: true;
  /**
   * The flow kept the paragraph's last word on this line by borrowing inter-word space.
   * Alignment compresses a paragraph's last line only when this is set, never for another
   * overflow such as hanging punctuation.
   */
  spaceShrink?: true;
  /**
   * The flow admitted a word on this line by borrowing inter-word space, so its natural
   * content can run past its float passage while the compressed line stays inside it.
   */
  borrowedSpace?: true;
  /**
   * The line borrowed inter-word space under a rule for every alignment
   * (`SpaceShrinkRule.everyAlignment`), so alignment compresses it to fill the measure as it
   * does a justified line, each space down to this floor.
   */
  compressesSpaces?: SpaceShrinkFloor;
  /** Model ranges on this line covering deleted content; see {@link LineRecord.deletedRanges}. */
  deletedRanges?: readonly ModelRange[];
  /** Vertical gap inserted before this line to clear a drawing exclusion band. */
  exclusionSkipBefore?: number;
  /**
   * The line follows a text wrapping break that clears floating objects (`w:br w:clear`).
   * Placement keeps its skip even on a line before the paragraph's first anchor.
   */
  breakClearance?: true;
  /**
   * The skip clears a paragraph-framed band of an anchor on a later line of the same paragraph
   * (`top-and-bottom-earlier-lines.ts`). Placement keeps it, as it keeps {@link breakClearance}.
   */
  ownBandClearance?: true;
  /** Clearance inherited by an empty anchor paragraph from other drawing bands. */
  anchorClearanceBefore?: number;
  /**
   * The first-line offset this line was broken with: the paragraph's first line, and the
   * first line after page breaks that open it ({@link holdsOnlyPageBreak}). Absent when zero.
   */
  firstLineOffset?: number;
  /**
   * The horizontal passage a float left this line, when that passage is narrower than the
   * paragraph's measure and holds the whole line.
   *
   * `start` is where the line's content begins (after any first-line indent) and `end` is the
   * passage's right edge, both in paragraph-local coordinates. Centring, right alignment and
   * justification align INSIDE this passage: Word centres a heading between the two pictures
   * beside it, not between the page margins, and stretches a justified line to the float's
   * near edge rather than through it. Absent when no float shortens the line, when the line
   * steps over a float into a later passage, or when the passage is the whole measure.
   * `contentEnd` marks a line whose pen stepped over a float without placing anything past it.
   */
  wrapSegment?: WrapSegment;
  /**
   * The float passages a line that steps over a float holds content in, in the order its pen
   * met them, in paragraph-local coordinates (mirrored when {@link wrapMirrored}). The first
   * starts where the line's content begins.
   *
   * Each part of such a line aligns INSIDE its own passage: centred text is centred beside the
   * float on each side, and right-aligned text ends at each passage's right edge. Aligning the
   * line as one block moved the text before the float onto the picture. Absent on a line that
   * one passage holds whole, which {@link wrapSegment} describes.
   */
  wrapPassages?: readonly { readonly start: number; readonly end: number }[];
  /**
   * The line broke in x mirrored about its paragraph's measure, as a right-to-left line does
   * beside a float (`wrap-break-space.ts`): it fills the rightmost passage first. Its spans,
   * {@link wrapSegment} and {@link wrapPassages} are then in that mirrored x, in break order.
   */
  wrapMirrored?: true;
  /** Tracked anchored-drawing attributions on this line; see {@link LineRecord.anchorRevisions}. */
  anchorRevisions?: readonly RevisionAttribution[];
  /** Revisions a resolved view answered on this line; see {@link LineRecord.changeSites}. */
  changeSites?: readonly RevisionAttribution[];
}

/** Merge baseline-aligned face boxes, preserving both ascent and descent. */
export function growLineMetrics(
  line: { height: number; baseline: number },
  metrics: { readonly height: number; readonly baseline: number }
): void {
  const descent = Math.max(line.height - line.baseline, metrics.height - metrics.baseline);
  line.baseline = Math.max(line.baseline, metrics.baseline);
  line.height = line.baseline + descent;
}

/** The character at a model offset among a paragraph's pieces, if a piece holds it. */
function characterAt(
  pieces: readonly { readonly start: number; readonly text: string }[],
  offset: number
): string | undefined {
  for (const piece of pieces) {
    if (offset >= piece.start && offset < piece.start + piece.text.length) {
      return piece.text[offset - piece.start];
    }
  }
  return undefined;
}

/** Zero-width format characters: they take no room in a passage. */
const ZERO_WIDTH_OPENER = /^[\u200b-\u200f\u2060\ufeff]$/u;

/**
 * Whether a line that opens at `offset` has already been admitted to the passage it stands
 * in, so a segment too wide for that passage is broken there by character rather than moved
 * below the floats.
 *
 * Two cases, both observed in reference renders: the line opens with a zero-width character,
 * which fits any passage and so admits it; or the line continues a segment that the line
 * before cut by character because it did not fit. The line breaker reports that cut as
 * `continuesCutSegment`; the text alone cannot tell it, since a line also ends legally after
 * a CJK character, a slash, or a dash. In both cases, an oversized glyph overflows beside the
 * float on the next line instead of opening below it.
 */
export function admittedToNarrowPassage(
  pieces: readonly { readonly start: number; readonly text: string }[],
  offset: number,
  continuesCutSegment: boolean
): boolean {
  const opening = characterAt(pieces, offset);
  if (opening !== undefined && ZERO_WIDTH_OPENER.test(opening)) return true;
  return continuesCutSegment;
}

/**
 * Whether page or column breaks, and nothing else, precede `offset` among a paragraph's
 * pieces: the text from `offset` is then the paragraph's first line, with its indent.
 */
export function onlyLeadingBreaksBefore(
  pieces: readonly { readonly start: number; readonly text: string; readonly breakKind?: string }[],
  offset: number
): boolean {
  let seen = false;
  for (const piece of pieces) {
    if (piece.start >= offset) continue;
    if (piece.text !== PAGE_BREAK_CHAR && piece.breakKind !== 'column') return false;
    seen = true;
  }
  return seen;
}

/** Whether page breaks, and nothing else, precede `offset` among a paragraph's pieces. */
export function onlyPageBreaksBefore(
  pieces: readonly { readonly start: number; readonly text: string }[],
  offset: number
): boolean {
  let seen = false;
  for (const piece of pieces) {
    if (piece.start >= offset) continue;
    if (piece.text !== PAGE_BREAK_CHAR) return false;
    seen = true;
  }
  return seen;
}

/**
 * Whether a line holds anything that the next word must follow. A page break that a table
 * cell ignores has no extent, so a line that holds only such breaks is still at its start.
 */
export function lineHoldsContent(
  line: Pick<PendingLine, 'spans' | 'drawings'>,
  pageBreaksIgnored: boolean
): boolean {
  if (line.drawings.length > 0 || (line.spans.length > 0 && !pageBreaksIgnored)) return true;
  return line.spans.some((span) => span.text !== PAGE_BREAK_CHAR);
}

/**
 * Ignored page breaks before a line's first content sit where that content starts, after
 * the float passages and clearances the pen took to reach it. They stay put on a line that
 * holds nothing else.
 */
export function placeLeadingIgnoredBreaks(line: PendingLine, pageBreaksIgnored: boolean): void {
  if (!pageBreaksIgnored || line.spans[0]?.text !== PAGE_BREAK_CHAR) return;
  const text = line.spans.find((span) => span.text !== PAGE_BREAK_CHAR);
  let start = text?.range.start ?? Infinity;
  let x = text?.box.x;
  for (const drawing of line.drawings) {
    if (drawing.start < start) [start, x] = [drawing.start, drawing.advanceStart];
  }
  if (x === undefined) return;
  for (let index = 0; line.spans[index]?.text === PAGE_BREAK_CHAR; index += 1) {
    const span = line.spans[index]!;
    if (span.range.start < start) line.spans[index] = { ...span, box: { ...span.box, x } };
  }
}

/** The published break kind of a placed line: column first, as placement checks it. */
export function lineBreakAfterFields(
  line: Pick<PendingLine, 'pageBreakAfter' | 'columnBreakAfter'>
): { readonly breakAfter?: 'page' | 'column' } {
  if (line.columnBreakAfter) return { breakAfter: 'column' };
  return line.pageBreakAfter ? { breakAfter: 'page' } : {};
}

/** Whether a line holds nothing but the page break that ends it. */
export function holdsOnlyPageBreak(line: PendingLine): boolean {
  return (
    line.pageBreakAfter === true &&
    line.drawings.length === 0 &&
    line.spans.every((span) => span.text === '' || span.text === PAGE_BREAK_CHAR)
  );
}

/**
 * Spaces (U+0020), ideographic spaces (U+3000) and tabs take no line height, whatever their
 * face, size, underline or tab leader. A line that holds only them measures as an empty line:
 * the paragraph mark sets its height. A no-break space still counts, and so does a line break.
 */
export function isHeightlessWhitespace(text: string): boolean {
  // Spaces, tabs, soft hyphens and zero-width characters draw no ink: a line of only these
  // takes the paragraph mark's height. An ideographic space draws in the East Asian face, so
  // counting it would give a Latin line the taller line of that face.
  return text.length > 0 && /^[ \t\u00AD\u200B\u200C\u200D\u2060\uFEFF\u3000]+$/.test(text);
}

/** Face extents translated by an authored baseline position, without rescaling glyphs. */
export function positionedRunMetrics(
  metrics: { readonly height: number; readonly baseline: number },
  style?: ResolvedRunStyle
): { readonly height: number; readonly baseline: number } {
  const shift = style?.baselineShiftPt ? baselineShiftPtOf(style) : 0;
  return shift ? { height: metrics.height, baseline: metrics.baseline + shift } : metrics;
}

/** {@link growLineMetrics} for a placed span; {@link isHeightlessWhitespace} text leaves the box. */
export function growLineMetricsForText(
  line: { height: number; baseline: number },
  metrics: { readonly height: number; readonly baseline: number },
  text: string,
  style?: ResolvedRunStyle
): void {
  if (isHeightlessWhitespace(text)) return;
  // Face metrics already include script scaling. Only translate their baseline;
  // paint keeps the original face box and applies the same glyph displacement.
  growLineMetrics(line, positionedRunMetrics(metrics, style));
}

/**
 * The text whose shaped faces set a span's line band, or undefined for the run's own face.
 *
 * A note separator is a rule and a legacy FORMCHECKBOX is a drawn box of its `w:size`. Neither
 * is a glyph, so a fallback face picked to cover the placeholder text must not size the line:
 * the checkbox's ballot-box placeholder otherwise took a symbol or CJK face's band, about 1.7 em
 * where the run's own face gives 1.15 em.
 */
export function lineBandText(
  item: Pick<StyleSpanRecord, 'noteSeparator' | 'fieldAtom'>,
  text: string
): string | undefined {
  return item.noteSeparator || item.fieldAtom?.formControl?.kind === 'checkbox' ? undefined : text;
}

/**
 * Every {@link StyleSpanRecord} field outside range, text and box, as a checked record:
 * a new field fails to compile here until it is added (blocking the merge below when it
 * differs) or consciously exempted beside range/text/box in the `Exclude`.
 */
const SPAN_DECORATIONS: Record<Exclude<keyof StyleSpanRecord, 'range' | 'text' | 'box'>, true> = {
  props: true,
  style: true,
  fontSlot: true,
  syntheticBold: true,
  glyphOffsetPt: true,
  borderBaselinePt: true,
  caretEdges: true,
  tabLeader: true,
  tabLeaderAdvancePt: true,
  tabAlignment: true,
  link: true,
  wrapAdvanceBefore: true,
  revisions: true,
  changeSites: true,
  fieldAtom: true,
  projected: true,
  equation: true,
  unsupported: true,
  noteNav: true,
  noteSeparator: true,
  lineEndWhitespace: true,
  optionalHyphenBreak: true,
};

const SPAN_DECORATION_KEYS = Object.keys(SPAN_DECORATIONS) as readonly (keyof StyleSpanRecord)[];

/**
 * Everything outside a span's range, text and box, compared by reference.
 *
 * Two spans that share every decoration share the objects, because they come from one run's
 * one resolution — placement passes `piece.revisions`, `piece.link` and the rest through
 * without copying. Reference equality is therefore the exact test; the span-count tests in
 * `cjk-line-breaking.test.ts` pin a revised and a linked run so a future defensive copy on
 * that path cannot silently return CJK to one span per ideograph.
 */
function decorationsMatch(previous: StyleSpanRecord, current: StyleSpanRecord): boolean {
  for (const key of SPAN_DECORATION_KEYS) {
    if (previous[key] !== current[key]) return false;
  }
  return true;
}

const isSoundMark = (codePoint: number) => codePoint === 0x3099 || codePoint === 0x309a;

/** Whether one ideographic seam between two closed spans carries no information. */
function seamIsMergeable(previous: StyleSpanRecord, current: StyleSpanRecord): boolean {
  if (previous.glyphOffsetPt || current.glyphOffsetPt) return false;
  // `caretEdges` is measured against a span's own text, so a merge would invalidate it.
  // Placement attaches it AFTER this runs; the guard keeps that ordering from being load-bearing.
  if (previous.caretEdges !== undefined || current.caretEdges !== undefined) return false;
  const before = lastCodePointOf(previous.text);
  const after = current.text.codePointAt(0);
  if (before === undefined || after === undefined) return false;
  // A sound mark split into its own span (`sound-mark-pieces.ts`) must not rejoin its base.
  if (isSoundMark(before) || isSoundMark(after)) return false;
  if (!isIdeographicForLineBreak(before) || !isIdeographicForLineBreak(after)) return false;
  if (previous.range.paragraphId !== current.range.paragraphId) return false;
  if (previous.range.end !== current.range.start) return false;
  if (Math.abs(previous.box.x + previous.box.width - current.box.x) > 0.01) return false;
  if (previous.box.height !== current.box.height) return false;
  return decorationsMatch(previous, current);
}

/**
 * Merge a closed line's ideographic span seams back into one span per style run.
 *
 * Ideographic word boundaries make every character a placement candidate, so the placement
 * loop emits one span per ideograph. The break decisions are right, but a clause that used
 * to paint as a single span now paints and hit-tests as dozens. Once the line is closed
 * those seams carry no information, so they merge back.
 *
 * Latin word seams are deliberately left alone: their trailing spaces are where
 * justification stretches, and their span shape predates ideographic breaking.
 */
export function coalesceIdeographicSpans(line: PendingLine): void {
  if (line.spans.length < 2) return;
  const merged: StyleSpanRecord[] = [];
  for (let index = 0; index < line.spans.length;) {
    // Scan the whole mergeable group first, then build ONE span from it — merging into a
    // growing accumulator re-copied every seam, an O(m²) cost per group. Adjacent-pair
    // seams test the same conditions the accumulator did: the decoration and height
    // checks are transitive, and the x-abutment check against the true neighbour is
    // tighter than against an accumulated width.
    let groupEnd = index;
    while (
      groupEnd + 1 < line.spans.length &&
      seamIsMergeable(line.spans[groupEnd]!, line.spans[groupEnd + 1]!)
    ) {
      groupEnd += 1;
    }
    const first = line.spans[index]!;
    if (groupEnd === index) {
      merged.push(first);
      index += 1;
      continue;
    }
    const parts: string[] = [];
    // The merged width is the SUM of the per-ideograph advances the line was broken and
    // justified against, not a re-measure of the joined text: paint must fill exactly the
    // box the line reserved, and a face that kerned across ideograph seams would make the
    // two disagree. CJK faces advance ideographs uniformly, so the sum is also the shape.
    let width = 0;
    for (let cursor = index; cursor <= groupEnd; cursor += 1) {
      parts.push(line.spans[cursor]!.text);
      width += line.spans[cursor]!.box.width;
    }
    merged.push({
      ...first,
      range: { ...first.range, end: line.spans[groupEnd]!.range.end },
      text: parts.join(''),
      box: { ...first.box, width },
    });
    index = groupEnd + 1;
  }
  if (merged.length === line.spans.length) return;
  line.spans.length = 0;
  for (const span of merged) line.spans.push(span);
}

/** Vertical extent of a pending line for flow/pagination budget checks (skip + box + optional tail). */
export function pendingLineFlowExtent(
  line: Pick<
    PendingLine,
    'height' | 'trailingSpacing' | 'exclusionSkipBefore' | 'anchorClearanceBefore'
  >,
  tail = 0
): number {
  return (
    (line.anchorClearanceBefore ?? line.exclusionSkipBefore ?? 0) +
    Math.max(0, line.height - line.trailingSpacing) +
    tail
  );
}

/** Recompute topAndBottom skip at placement time from live page zones and absolute line top. */
export function pendingLineExclusionSkipAtPlacement(
  line: Pick<PendingLine, 'height' | 'exclusionSkipBefore'>,
  lineTopY: number,
  zones: readonly ExclusionZone[]
): number {
  return Math.max(
    topAndBottomSkipBeforeLine(lineTopY, line.height, zones),
    line.exclusionSkipBefore ?? 0
  );
}

export function pendingLineFlowExtentAtPlacement(
  lineTopY: number,
  line: Pick<
    PendingLine,
    'height' | 'trailingSpacing' | 'exclusionSkipBefore' | 'anchorClearanceBefore'
  >,
  zones: readonly ExclusionZone[],
  tail = 0
): number {
  const skip = pendingLineExclusionSkipAtPlacement(line, lineTopY, zones);
  return (
    (line.anchorClearanceBefore ?? skip) + Math.max(0, line.height - line.trailingSpacing) + tail
  );
}

/**
 * A cached line, safe to hand back on every later hit.
 *
 * Placement copies span boxes rather than mutating them, but a cache entry outlives the
 * layout that produced it — freezing means a future change to the placement path cannot
 * quietly corrupt every subsequent reuse.
 */
export function frozenLine(line: PendingLine): PendingLine {
  return copyLineHangingPunctuation(
    line,
    Object.freeze({
      spans: line.spans.map((span) =>
        Object.freeze({ ...span, box: Object.freeze({ ...span.box }) })
      ),
      drawings: line.drawings.map((drawing) =>
        Object.freeze({
          ...drawing,
          paintBounds: Object.freeze({ ...drawing.paintBounds }),
          hitBounds: Object.freeze({ ...drawing.hitBounds }),
        })
      ),
      start: line.start,
      end: line.end,
      width: line.width,
      height: line.height,
      baseline: line.baseline,
      leading: line.leading,
      trailingSpacing: line.trailingSpacing,
      ...(line.pageBreakAfter ? { pageBreakAfter: true } : {}),
      ...(line.columnBreakAfter ? { columnBreakAfter: true } : {}),
      ...(line.manualBreakAfter ? { manualBreakAfter: true } : {}),
      ...(line.spaceShrink ? { spaceShrink: true } : {}),
      ...(line.compressesSpaces ? { compressesSpaces: line.compressesSpaces } : {}),
      ...(line.deletedRanges ? { deletedRanges: Object.freeze(line.deletedRanges) } : {}),
      ...(line.exclusionSkipBefore ? { exclusionSkipBefore: line.exclusionSkipBefore } : {}),
      ...(line.breakClearance ? { breakClearance: true } : {}),
      ...(line.ownBandClearance ? { ownBandClearance: true } : {}),
      ...(line.anchorClearanceBefore !== undefined
        ? { anchorClearanceBefore: line.anchorClearanceBefore }
        : {}),
      ...(line.firstLineOffset ? { firstLineOffset: line.firstLineOffset } : {}),
      ...(line.wrapSegment ? { wrapSegment: Object.freeze({ ...line.wrapSegment }) } : {}),
      ...(line.wrapPassages
        ? {
            wrapPassages: Object.freeze(line.wrapPassages.map((passage) => Object.freeze(passage))),
          }
        : {}),
      ...(line.wrapMirrored ? { wrapMirrored: true } : {}),
      ...(line.anchorRevisions ? { anchorRevisions: Object.freeze(line.anchorRevisions) } : {}),
      ...(line.changeSites ? { changeSites: Object.freeze(line.changeSites) } : {}),
    }) as PendingLine
  );
}

/**
 * The line's content origin: the leftmost advance of any span OR inline drawing.
 *
 * An inline drawing is content too. Paint opens the line at this x and reserves each
 * drawing's advance as an inline spacer before the spans that follow it, so an origin taken
 * from the spans alone started a picture-first line at its first glyph and the spacer then
 * pushed that glyph a second picture width to the right.
 */
export function lineContentX(
  spans: readonly StyleSpanRecord[],
  drawings: readonly Pick<InlineDrawingRecord, 'advanceStart' | 'advanceEnd'>[],
  fallback: number
): number {
  return lineContentEdges(spans, drawings)?.left ?? fallback;
}

/**
 * The left and right edges of a line's content: every span box and inline drawing advance,
 * or null for a line with neither. The one place that decides what counts as line content,
 * for the line's origin, its end in hit testing, and where its terminator mark goes.
 */
export function lineContentEdges(
  spans: readonly StyleSpanRecord[],
  drawings: readonly Pick<InlineDrawingRecord, 'advanceStart' | 'advanceEnd'>[]
): { readonly left: number; readonly right: number } | null {
  if (spans.length === 0 && drawings.length === 0) return null;
  let left = Infinity;
  let right = -Infinity;
  for (const span of spans) {
    left = Math.min(left, span.box.x);
    right = Math.max(right, span.box.x + span.box.width);
  }
  for (const drawing of drawings) {
    left = Math.min(left, drawing.advanceStart);
    right = Math.max(right, drawing.advanceEnd);
  }
  return { left, right };
}

/**
 * Record the jumps a float's wrap zone forced before each of this line's spans.
 *
 * Spans are laid contiguously as the pen advances, so at close time the ONLY horizontal
 * gaps before them are advances the pen skipped: an inline drawing's own reserved slot,
 * which paint already fills, and a wrap exclusion the line stepped over to resume in the
 * next passage. Justification has not run yet, so nothing here can be confused with slack.
 *
 * Paint flows each span after the previous one, and each inline drawing's spacer reaches the
 * drawing's far edge (covering any jump before the drawing). So a span's jump is whatever is
 * left between the far edge of the content before it and the span. A span with no content
 * before it starts the line, so it has nothing to jump.
 */
export function markPendingLineWrapAdvances(line: PendingLine): void {
  // Model order is the order paint flushes spacers in; one forward pass visits each once.
  const drawings =
    line.drawings.length > 1
      ? [...line.drawings].sort((left, right) => left.start - right.start)
      : line.drawings;
  let next = 0;
  for (let index = 0; index < line.spans.length; index += 1) {
    const previous = line.spans[index - 1];
    const current = line.spans[index]!;
    let flowEnd = previous ? previous.box.x + previous.box.width : -Infinity;
    for (; next < drawings.length && drawings[next]!.start < current.range.start; next += 1) {
      flowEnd = Math.max(flowEnd, drawings[next]!.advanceEnd);
    }
    if (!Number.isFinite(flowEnd)) continue;
    const gap = current.box.x - flowEnd - automaticTextSpacingBefore(current);
    if (gap <= 0.001) continue;
    line.spans[index] = { ...current, wrapAdvanceBefore: gap };
  }
}

/** Include each inline drawing's final baseline-adjusted extent in its line. */
export function growPendingLineDrawingExtent(line: PendingLine): void {
  for (const drawing of line.drawings)
    line.height = Math.max(line.height, drawing.y + drawing.height + drawing.distB);
}

/**
 * Clip each inline drawing that reaches above its line's top to paint from that top down. Text
 * art whose ink reaches past its box keeps it, as text drawn along an arch rises over the box.
 */
export function clipLineDrawingsAtTop(line: PendingLine): void {
  for (let index = 0; index < line.drawings.length; index += 1) {
    const drawing = line.drawings[index]!;
    const bounds = drawing.paintBounds;
    if (bounds.y >= -0.001 || drawing.textArt?.inkBounds) continue;
    line.drawings[index] = clipInlineDrawingRecordVertically(drawing, 0, bounds.y + bounds.height);
  }
}
