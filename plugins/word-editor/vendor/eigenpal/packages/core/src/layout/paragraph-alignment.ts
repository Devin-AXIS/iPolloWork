import { OVERFLOW_TOLERANCE_PT, SLACK_RESIDUE_PT } from './paragraph-alignment-tolerance.ts';
import { lineHangingPunctuationAdvance } from './line-hanging-punctuation.ts';
import type { PendingLine } from './pending-line.ts';
import { shrinkJustifiedSpans } from './paragraph-space-shrink.ts';
import { insideFitTextGroup } from './fit-text-groups.ts';
import { PAGE_BREAK_CHAR, type OoxmlProperty } from '@docx-editor.dev/core/store';
import { paragraphIsRtl, reorderBidiSpans, splitBidiTrailingWhitespace } from './rtl-paragraph.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { stretchBalancedSpaces } from './balanced-space-stretch.ts';
import { justifyCjkSpans } from './cjk-justify.ts';
import { distributeLineCharacters, spacesAbsorbSlack } from './distributed-character-spacing.ts';
import type { DistributedSpacing } from './distributed-spacing.ts';
import type { SpaceShrinkFloor } from './space-shrink-rule.ts';
import {
  endsWithSpaceSlot,
  withoutLineEndWhitespace,
  withoutTrailingSpaces,
  withoutTrailingZeroWidthSpaces,
} from './trailing-spaces.ts';
import { alignBidiTrailingSpaces, bidiTrailingSpaces } from './bidi-trailing-spaces.ts';
import {
  alignBidiPassageSpans,
  alignPassageSpans,
  isMirroredPassageList,
  partUsedWidth,
  type LinePassage,
  type MirroredLinePassage,
} from './passage-alignment.ts';

/** Horizontal alignment of a paragraph (`w:jc`, ECMA-376 §17.3.1.13). */
export type Alignment = 'left' | 'center' | 'right' | 'both';

/**
 * The PHYSICAL alignment of a paragraph.
 *
 * In a bidi paragraph Word reads `left` and `right` as the leading and trailing edges, the
 * same as `start` and `end`: `<w:bidi/><w:jc w:val="left"/>` sits at the right margin
 * (verified against Word 16 PDF output). The kashida and Thai variants justify.
 */
export function paragraphAlignment(props: readonly OoxmlProperty[]): Alignment {
  const rtl = paragraphIsRtl(props);
  const leading: Alignment = rtl ? 'right' : 'left';
  const trailing: Alignment = rtl ? 'left' : 'right';
  let alignment: Alignment = leading;
  for (const property of props) {
    if (property.localName !== 'jc') continue;
    switch (property.attributes?.val) {
      case 'center':
        alignment = 'center';
        break;
      case 'right':
      case 'end':
        alignment = trailing;
        break;
      case 'both':
      case 'distribute':
      case 'lowKashida':
      case 'mediumKashida':
      case 'highKashida':
      case 'thaiDistribute':
        alignment = 'both';
        break;
      default:
        alignment = leading;
    }
  }
  return alignment;
}

/**
 * The `w:jc` value that puts a paragraph at a PHYSICAL edge, the inverse of
 * {@link paragraphAlignment}: a bidi paragraph reaches its right margin with `left`.
 */
export function jcValueForAlignment(
  alignment: 'left' | 'center' | 'right' | 'justify' | 'both',
  rtl: boolean
): string {
  if (alignment === 'center') return 'center';
  if (alignment === 'justify' || alignment === 'both') return 'both';
  if (!rtl) return alignment;
  return alignment === 'left' ? 'right' : 'left';
}

/**
 * True when this span's trailing U+0020 is an inter-word slot Word can stretch.
 *
 * Paint reapplies justification as CSS `word-spacing` on those same spaces. Inserting layout
 * slack at every style-span boundary (tabs, run splits mid-phrase) put gaps where paint has
 * none and shifted every later span — caret mid-word drifted by a multiple of the step while
 * the highlight (DOM) stayed on the glyphs.
 */
function endsWithExpandableSpace(text: string): boolean {
  // A zero-width space after the space takes no room; the space is still the slot.
  return withoutTrailingZeroWidthSpaces(text).endsWith(' ');
}

/**
 * A table cell ignores its page breaks, so a line that wrapped right after one aligns as the
 * same line without it: otherwise the break span would end the content, and the space before
 * it would count as text. The breaks then follow the aligned text. Null when the line does
 * not end with such a break, or holds nothing else.
 */
function alignBeforeIgnoredBreaks(
  spans: readonly StyleSpanRecord[],
  align: (content: readonly StyleSpanRecord[]) => readonly StyleSpanRecord[]
): readonly StyleSpanRecord[] | null {
  let end = spans.length;
  while (end > 0 && spans[end - 1]!.text === PAGE_BREAK_CHAR && spans[end - 1]!.box.width === 0) {
    end -= 1;
  }
  if (end === 0 || end === spans.length) return null;
  const aligned = align(spans.slice(0, end));
  const before = spans[end - 1]!;
  const after = aligned[aligned.length - 1]!;
  const shift = after.box.x + after.box.width - (before.box.x + before.box.width);
  return [
    ...aligned,
    ...spans.slice(end).map((span) => ({ ...span, box: { ...span.box, x: span.box.x + shift } })),
  ];
}

/**
 * Align logical spans before bidi reordering. Layout publishes the shared geometry.
 * Justification expands inter-word spaces, matching paint's CSS word-spacing.
 * Empty lines stay unchanged; callers publish their aligned origin as contentX.
 */
function alignLogicalSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  indentLeft: number,
  available: number,
  alignment: Alignment,
  isLastLine: boolean,
  lineUsedWidth: number | undefined,
  paragraphRtl: boolean,
  pageBreaksIgnored: boolean,
  lastLineShrinks: boolean,
  distributed: DistributedSpacing | undefined,
  eastAsianSpacing: boolean,
  hangingPunctuationAdvance: number,
  floor?: SpaceShrinkFloor,
  keepsBalancedSpaces = false
): readonly StyleSpanRecord[] {
  if (spans.length === 0) return spans;
  // An unbounded line (a measuring pass) has no far edge to align or justify against.
  if (alignment === 'left' || !Number.isFinite(available)) return spans;
  if (pageBreaksIgnored) {
    const aligned = alignBeforeIgnoredBreaks(spans, (content) =>
      alignLogicalSpans(
        content,
        measurer,
        indentLeft,
        available,
        alignment,
        isLastLine,
        lineUsedWidth,
        paragraphRtl,
        false,
        lastLineShrinks,
        distributed,
        eastAsianSpacing,
        hangingPunctuationAdvance,
        floor,
        keepsBalancedSpaces
      )
    );
    if (aligned) return aligned;
  }

  let trailingEnd = spans.length;
  while (
    trailingEnd > 0 &&
    spans[trailingEnd - 1]!.box.width === 0 &&
    (spans[trailingEnd - 1]!.text === '\n' || spans[trailingEnd - 1]!.text === PAGE_BREAK_CHAR)
  ) {
    trailingEnd -= 1;
  }
  let trailingStart = trailingEnd;
  while (trailingStart > 0 && spans[trailingStart - 1]!.lineEndWhitespace) {
    trailingStart -= 1;
  }
  const lastContentSpan = spans[trailingEnd - 1];
  // Clipped whitespace runs hang past the content: with two of them the last one is a
  // zero-width span AT the measure, so last-span arithmetic reports no slack at all. The
  // content ends where the first hanging span starts, whatever hangs after it.
  // Breaks alone do not hang: the content then ends where its own whitespace starts.
  const hangingStart =
    trailingStart < trailingEnd ? spans[trailingStart]!.box.x - indentLeft : undefined;
  const spansReachLineEnd =
    lineUsedWidth !== undefined &&
    lastContentSpan !== undefined &&
    Math.abs(lastContentSpan.box.x + lastContentSpan.box.width - indentLeft - lineUsedWidth) <=
      OVERFLOW_TOLERANCE_PT;
  const visible = visibleTextEnd(spans, trailingEnd, indentLeft, lineUsedWidth, measurer);
  if (
    trailingStart < trailingEnd &&
    spansReachLineEnd &&
    (alignment === 'center' || alignment === 'right')
  ) {
    const slack =
      available -
      (paragraphRtl || visible === undefined ? hangingStart! : Math.min(hangingStart!, visible));
    if (slack <= 0) return spans;
    const offset = alignment === 'center' ? slack / 2 : slack;
    const clipsAtMargin = (lineUsedWidth ?? 0) >= available - OVERFLOW_TOLERANCE_PT;
    let fillX = spans[trailingStart]!.box.x + offset;
    return spans.map((span, index) => {
      if (index < trailingStart) return { ...span, box: { ...span.box, x: span.box.x + offset } };
      if (!clipsAtMargin) return { ...span, box: { ...span.box, x: span.box.x + offset } };
      const width = Math.min(span.box.width, Math.max(0, indentLeft + available - fillX));
      const aligned = { ...span, box: { ...span.box, x: fillX, width } };
      fillX += width;
      return aligned;
    });
  }

  // Trailing whitespace hangs into the margin rather than pushing the text off-centre, which
  // is what Word does and what stops a line ending in a space from looking misaligned.
  const last = spans[spans.length - 1]!;
  // `box.width` was reserved from the DRAWN text, so the visible part has to be measured the
  // same way: the difference is what the trailing whitespace measures, and mixing a drawn
  // total with a source-measured visible part reports nearly the whole span as whitespace.
  // Centre and right pass `lineUsedWidth` and never read this; the path that does is a
  // JUSTIFIED non-last line, where an over-reported `trailing` inflates `slack` and
  // over-stretches the line. Measured only on that path.
  // Only U+0020 hangs. A tab or no-break space remains content after bidi alignment
  // separates the zero-width break that follows it.
  const trailingWhitespaceOf = (
    span: StyleSpanRecord,
    visible = withoutTrailingSpaces(span.text)
  ): number =>
    visible === span.text
      ? 0
      : span.box.width -
        measureDisplayText(visible, styleForFontSlot(span.style, span.fontSlot), measurer);
  // The content ends at the last span holding more than U+0020 spaces. A break closing the
  // line, and spaces in spans of their own, are not content: they hang. Before a break only
  // U+0020 hangs; a tab or a no-break space there is content.
  let contentLast = trailingEnd - 1;
  while (contentLast > 0 && withoutTrailingSpaces(spans[contentLast]!.text) === '') {
    contentLast -= 1;
  }
  const contentEnd = spans[contentLast] ?? last;
  const contentEndWithoutTrailingWhitespace = (): number => {
    const end = contentEnd.box.x - indentLeft + contentEnd.box.width;
    const used =
      end -
      trailingWhitespaceOf(
        contentEnd,
        contentEnd === last ? undefined : withoutTrailingSpaces(contentEnd.text)
      );
    // A space before a zero-width space is content while it fits; it hangs when it overflows.
    if (used <= available + OVERFLOW_TOLERANCE_PT) return used;
    return end - trailingWhitespaceOf(contentEnd, withoutLineEndWhitespace(contentEnd.text));
  };
  // A justified line's hanging spaces may follow a word that keeps its own space (a double
  // space split across runs). That space hangs too: it is neither content nor a slot.
  // Only U+0020 hangs; a tab or a no-break space before the hanging spaces is content.
  const hangsAfterOwnSpace =
    alignment === 'both' &&
    !paragraphRtl &&
    lineUsedWidth === undefined &&
    trailingStart > 0 &&
    trailingStart < trailingEnd;
  let used =
    lineUsedWidth ??
    (hangingStart !== undefined && hangsAfterOwnSpace
      ? hangingStart -
        trailingWhitespaceOf(
          spans[trailingStart - 1]!,
          withoutTrailingSpaces(spans[trailingStart - 1]!.text)
        )
      : hangingStart) ??
    contentEndWithoutTrailingWhitespace();
  let rtlTrailingAdvance = 0;
  // A space retained at a natural wrap still owns its model/caret advance, but Word
  // centers/right-aligns the visible text. Do not subtract from drawing-owned width,
  // tabs or nonbreaking spaces: only a text span reaching the measured line end qualifies.
  // A space before a zero-width space is content while it fits, and hangs when it overflows.
  // The span's box can be priced to the room left, so the text decides the overflow.
  const overflowingSlot =
    lastContentSpan !== undefined &&
    !lastContentSpan.text.endsWith(' ') &&
    endsWithSpaceSlot(lastContentSpan.text) &&
    lastContentSpan.box.x -
      indentLeft +
      measureDisplayText(
        lastContentSpan.text,
        styleForFontSlot(lastContentSpan.style, lastContentSpan.fontSlot),
        measurer
      ) >
      available + OVERFLOW_TOLERANCE_PT;
  if (
    (alignment === 'center' || alignment === 'right') &&
    spansReachLineEnd &&
    (lastContentSpan?.text.endsWith(' ') || overflowingSlot) &&
    !lastContentSpan.lineEndWhitespace
  ) {
    const visible = overflowingSlot
      ? withoutLineEndWhitespace(lastContentSpan.text)
      : withoutTrailingSpaces(lastContentSpan.text);
    const width = measureDisplayText(
      visible,
      styleForFontSlot(lastContentSpan.style, lastContentSpan.fontSlot),
      measurer
    );
    const trailing = Math.max(0, lastContentSpan.box.width - width);
    used -= trailing;
    // Bidi puts these spaces before the visible text. Move the full line back by
    // their advance, so right/center alignment still anchors the visible glyphs.
    if (paragraphRtl) rtlTrailingAdvance = trailing;
  }
  // Every trailing U+0020 hangs past a centred or right-aligned line, also the spaces that
  // still fit before the measure and the one that closes the last word's span.
  if ((alignment === 'center' || alignment === 'right') && !paragraphRtl && visible !== undefined)
    used = Math.min(used, visible);
  // The hanging mark keeps its advance outside the measure; only its prefix fills the line.
  if (alignment === 'both') used -= hangingPunctuationAdvance;
  const slack = available - used;
  // A last line compresses only when the flow kept the paragraph's last word by borrowing
  // inter-word space. Hanging punctuation also overflows a line, and keeps its spacing.
  if (slack < -0.001 && alignment === 'both' && (!isLastLine || lastLineShrinks))
    return shrinkJustifiedSpans(
      spans,
      -slack,
      measurer,
      hangsAfterOwnSpace ? trailingStart - 1 : Math.max(0, contentLast),
      floor,
      paragraphRtl,
      keepsBalancedSpaces
    );
  // A line that fills its measure can leave a rounding residue, which must not become spacing.
  if (slack <= SLACK_RESIDUE_PT) return spans;

  // The last line of a justified paragraph is set flush left, never stretched.
  if (alignment === 'both') {
    if (isLastLine && hangingPunctuationAdvance === 0) return spans;
    // Zero-width spaces closing the line take no room, so the boundary before them is no slot.
    let slotEnd = Math.min(trailingStart, contentLast + 1);
    while (
      slotEnd > 1 &&
      spans[slotEnd - 1]!.text.length > 0 &&
      withoutTrailingZeroWidthSpaces(spans[slotEnd - 1]!.text) === ''
    )
      slotEnd -= 1;
    const centered = (): readonly StyleSpanRecord[] =>
      spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + slack / 2 } }));
    // Float advances hold their reserved positions, so a line with one never moves.
    const floatReserved = spans.some((span) => (span.wrapAdvanceBefore ?? 0) > 0.001);
    // A left-to-right distributed line with a tab stretches only the text after its last
    // tab, from that tab's stop to the line end, when the stop is a left one. Otherwise, or
    // when that text has nothing to stretch, the whole line centers with its tab positions.
    const tabIndex =
      distributed !== undefined && !paragraphRtl && !floatReserved
        ? lastTabBefore(spans, slotEnd)
        : -1;
    if (tabIndex >= 0) {
      const from = tabIndex + 1;
      const stretched =
        spans[tabIndex]!.tabAlignment === undefined && from < slotEnd
          ? stretchJustifiedLine(
              spans.slice(from),
              measurer,
              slack,
              slotEnd - from,
              distributed,
              true
            )
          : null;
      return stretched ? [...spans.slice(0, from), ...stretched] : centered();
    }
    // A distributed line with nothing to stretch, such as a single word or character, centers.
    const centers =
      distributed !== undefined &&
      !floatReserved &&
      !spans.some((span) => span.text.includes('\t'));
    const stretched = stretchJustifiedLine(
      spans,
      measurer,
      slack,
      slotEnd,
      distributed,
      centers,
      paragraphRtl,
      eastAsianSpacing
    );
    if (stretched) return stretched;
    // Nothing to stretch, such as one word before a manual line break: a distributed line
    // centers; any other line stays at its start edge, the right one in a right-to-left paragraph.
    if (centers) return centered();
    if (!paragraphRtl) return spans;
    const start = slack - rtlTrailingAdvance;
    return spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + start } }));
  }

  const offset = (alignment === 'center' ? slack / 2 : slack) - rtlTrailingAdvance;
  return spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + offset } }));
}

/** The index of the last tab span before `end`, or -1. */
function lastTabBefore(spans: readonly StyleSpanRecord[], end: number): number {
  for (let index = Math.min(end, spans.length) - 1; index >= 0; index -= 1) {
    if (spans[index]!.text.includes('\t')) return index;
  }
  return -1;
}

/**
 * Stretch a justified line, or the part of a distributed line after its last tab, by `slack`
 * over `spans[0, slotEnd)`. `distributed` is the spacing of a distributed line, undefined for
 * an ordinary justified line. `spreads` says whether the line may spread its characters or
 * center: a distributed line with no reserved position. Returns null when nothing can
 * stretch, so the caller decides where the line sits.
 */
function stretchJustifiedLine(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  slack: number,
  slotEnd: number,
  distributed: DistributedSpacing | undefined,
  spreads: boolean,
  paragraphRtl = false,
  eastAsianSpacing = true
): readonly StyleSpanRecord[] | null {
  // Character distribution, unless the spaces can take all the slack: the line then sets
  // as a justified line, and only its spaces stretch.
  let spacesOnly = false;
  if (spreads && distributed !== undefined && distributed !== 'spaces' && !paragraphRtl) {
    spacesOnly = spacesAbsorbSlack(spans, measurer, slack, slotEnd, distributed);
    if (!spacesOnly) return distributeLineCharacters(spans, measurer, slack, slotEnd, distributed);
  }
  // Spaces at the balanced width set the common width that every space stretches to. Bidi
  // places a right-to-left line again from its widths, so it keeps the rules below.
  const balanced = paragraphRtl
    ? null
    : stretchBalancedSpaces(spans, measurer, slack, slotEnd, distributed !== undefined);
  if (balanced) return balanced;
  // Document defaults can turn East Asian justification off; a justified line then
  // stretches only its spaces. Distributed lines keep their own rules.
  const eastAsian = eastAsianSpacing || distributed !== undefined;
  const justified =
    spacesOnly || !eastAsian ? null : justifyCjkSpans(spans, measurer, slack, distributed);
  if (justified) return justified === spans && spreads ? null : justified;
  // Only boundaries after an expandable space receive slack — the same slots paint stretches
  // with `word-spacing`. A uniform step across every span pair invented gaps before tabs and
  // run splits and drifted every later caret by N×step. Hanging whitespace runs are not
  // slots either: a boundary between two of them took a share of the slack from the words.
  const gapBefore: number[] = [];
  // Spaces before a distributed line's first character keep their advance.
  let slotStart = 1;
  if (distributed !== undefined) {
    while (slotStart < slotEnd && withoutTrailingSpaces(spans[slotStart - 1]!.text) === '')
      slotStart += 1;
  }
  for (let index = slotStart; index < slotEnd; index += 1) {
    // A space inside a fitted group is not a slot: the group keeps its stated width.
    if (insideFitTextGroup(spans[index - 1]!, spans[index]!)) continue;
    if (endsWithExpandableSpace(spans[index - 1]!.text)) gapBefore.push(index);
  }
  if (gapBefore.length === 0) return null;
  const step = slack / gapBefore.length;
  const gapSet = new Set(gapBefore);
  let shift = 0;
  return spans.map((span, index) => {
    if (gapSet.has(index)) shift += step;
    return shift === 0 ? span : { ...span, box: { ...span.box, x: span.box.x + shift } };
  });
}

/**
 * Whether a line aligns as its paragraph's last line: it is that line, or a page or column
 * break closes it. Under the `pageBreakLinesStretch` compatibility rule, a page or column
 * break does not; under `unstretchedManualBreakLines`, a manual line break does. A distributed
 * paragraph (`w:jc w:val="distribute"`) stretches a line before such a break as it does any
 * other.
 */
export function setsLikeLastLine(
  props: readonly OoxmlProperty[],
  line: {
    readonly pageBreakAfter?: boolean;
    readonly columnBreakAfter?: boolean;
    readonly manualBreakAfter?: true;
  },
  isLastLine: boolean,
  compatibility?: {
    readonly unstretchedManualBreakLines?: true;
    readonly pageBreakLinesStretch?: true;
  }
): boolean {
  const pageBreakSetsLast =
    (line.pageBreakAfter === true || line.columnBreakAfter === true) &&
    compatibility?.pageBreakLinesStretch !== true;
  const manualBreakSetsLast =
    line.manualBreakAfter === true && compatibility?.unstretchedManualBreakLines === true;
  if (!isLastLine && !pageBreakSetsLast && !manualBreakSetsLast) return false;
  // Distributed paragraphs stretch their final line and every passage beside a float.
  return !isDistributedAlignment(props);
}

/** Whether the paragraph is distributed (`w:jc w:val="distribute"`); the last `w:jc` wins. */
export function isDistributedAlignment(props: readonly OoxmlProperty[]): boolean {
  let distributed = false;
  for (const property of props) {
    if (property.localName === 'jc') distributed = property.attributes?.val === 'distribute';
  }
  return distributed;
}

/**
 * The {@link DistributedSpacing} of a paragraph's lines, or undefined when it is not
 * distributed. `document` is the style cascade, which carries the document's choice.
 */
export function paragraphDistributedSpacing(
  props: readonly OoxmlProperty[],
  document: { readonly distributedSpacing?: DistributedSpacing } | undefined
): DistributedSpacing | undefined {
  if (!isDistributedAlignment(props)) return undefined;
  return document?.distributedSpacing ?? 'spaces';
}

/**
 * {@link setsLikeLastLine} for a line laid out in a box: a table cell, a header or footer, a
 * note, or a text box. A table cell ignores page breaks, so there only a manual line break
 * can close a line. In the other stories a page break still closes its line. Column breaks
 * do not change how a line in a box aligns.
 */
export function boxLineSetsLikeLastLine(
  props: readonly OoxmlProperty[],
  line: { readonly pageBreakAfter?: boolean; readonly manualBreakAfter?: true },
  isLastLine: boolean,
  compatibility?: Parameters<typeof setsLikeLastLine>[3]
): boolean {
  if (isLastLine) return setsLikeLastLine(props, line, true, compatibility);
  // A line that no break closes aligns as an inner line.
  if (line.pageBreakAfter !== true && line.manualBreakAfter !== true) return false;
  const closing = {
    ...(line.pageBreakAfter === true ? { pageBreakAfter: true } : {}),
    ...(line.manualBreakAfter === true ? { manualBreakAfter: true as const } : {}),
  };
  return setsLikeLastLine(props, closing, false, compatibility);
}

/**
 * Align one line. `lastLineShrinks` is the line's `PendingLine.spaceShrink`: without
 * it, a justified last line that overflows keeps its natural spacing. `passages` are the float
 * passages of a line that steps over a float; each part of the line aligns inside its own.
 * `eastAsianSpacing` false (see `CjkTypographySettings.eastAsianSpacing`) keeps justified East
 * Asian text from spreading between its characters. `keepsBalancedSpaces`
 * (`CjkTypographySettings.balancedSpaceShrink`) keeps a space at the balanced width when the
 * line shrinks its spaces.
 */
export function alignSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  indentLeft: number,
  available: number,
  alignment: Alignment,
  isLastLine: boolean,
  lineUsedWidth?: number,
  paragraphRtl = spans.some((span) => span.style.shaping?.baseLevel === 1),
  pageBreaksIgnored = false,
  lastLineShrinks = false,
  passages?: readonly LinePassage[],
  distributed?: DistributedSpacing,
  eastAsianSpacing = true,
  pendingLine?: PendingLine,
  keepsBalancedSpaces = false
): readonly StyleSpanRecord[] {
  const hangingPunctuationAdvance = pendingLine ? lineHangingPunctuationAdvance(pendingLine) : 0;
  // A right-to-left last line aligns to the right, unless the flow kept its last word by
  // borrowing inter-word space: then it compresses as justified text does.
  // A line whose final mark hangs fills the measure before the mark at every alignment. Only
  // legacy compatibility modes hang marks outside justified paragraphs, and only they compress
  // the spaces of a line at every alignment.
  const effective =
    hangingPunctuationAdvance > 0 || pendingLine?.compressesSpaces !== undefined
      ? 'both'
      : alignment === 'both' && isLastLine && paragraphRtl && !lastLineShrinks
        ? 'right'
        : alignment;
  const split = splitBidiTrailingWhitespace(spans, measurer);
  const bidiLine = paragraphRtl || split.some(isRightToLeft);
  if (passages && passages.length > 1 && !bidiLine) {
    const aligned = alignPassageSpans(split, passages, (part, passage, isLastPart) =>
      alignLogicalSpans(
        part,
        measurer,
        passage.start,
        Math.max(1, passage.end - passage.start),
        effective,
        isLastLine && isLastPart,
        effective === 'center' || effective === 'right' ? partUsedWidth(part, passage) : undefined,
        false,
        pageBreaksIgnored,
        lastLineShrinks,
        distributed,
        eastAsianSpacing,
        isLastPart ? hangingPunctuationAdvance : 0,
        pendingLine?.compressesSpaces,
        keepsBalancedSpaces
      )
    );
    if (aligned) return reorderBidiSpans(aligned, false, pageBreaksIgnored);
  } else if (passages && (isMirroredPassageList(passages) || passages.length > 1)) {
    // Each part aligns, and bidi reorders it, as a line of its own inside its passage.
    const aligned = alignBidiPassageSpans(spans, passages, (part, passage, isLastPart) =>
      alignSpans(
        part,
        measurer,
        passage.start,
        Math.max(1, passage.end - passage.start),
        alignment,
        isLastLine && isLastPart,
        alignment === 'center' || alignment === 'right' ? partUsedWidth(part, passage) : undefined,
        paragraphRtl,
        pageBreaksIgnored,
        lastLineShrinks
      )
    );
    if (aligned) return aligned;
  }
  const align = (
    line: readonly StyleSpanRecord[],
    measure: number,
    usedWidth: number | undefined
  ): readonly StyleSpanRecord[] =>
    alignLogicalSpans(
      line,
      measurer,
      indentLeft,
      measure,
      effective,
      isLastLine,
      usedWidth,
      paragraphRtl,
      pageBreaksIgnored,
      lastLineShrinks,
      distributed,
      eastAsianSpacing,
      hangingPunctuationAdvance,
      pendingLine?.compressesSpaces,
      keepsBalancedSpaces
    );
  const trailing = bidiTrailingSpaces(split, paragraphRtl, isLastLine, pageBreaksIgnored);
  if (trailing) {
    return alignBidiTrailingSpaces(
      split,
      trailing,
      align,
      indentLeft,
      available,
      lineUsedWidth,
      paragraphRtl,
      pageBreaksIgnored
    );
  }
  return reorderBidiSpans(align(split, available, lineUsedWidth), paragraphRtl, pageBreaksIgnored);
}

function isRightToLeft(span: StyleSpanRecord): boolean {
  return span.style.shaping?.direction === 'rtl';
}

/**
 * {@link alignSpans} for a body line inside its {@link lineAlignmentMeasure}. The paragraph's
 * `props` decide whether the line sets like a last line and whether it is distributed.
 */
export function alignBodyLineSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  measure: ReturnType<typeof lineAlignmentMeasure>,
  alignment: Alignment,
  props: readonly OoxmlProperty[],
  line: Parameters<typeof setsLikeLastLine>[1] & { readonly spaceShrink?: boolean },
  isLastLine: boolean,
  compatibility:
    | (NonNullable<Parameters<typeof setsLikeLastLine>[3]> & {
        readonly distributedSpacing?: DistributedSpacing;
        readonly typography?: {
          readonly eastAsianSpacing?: false;
          readonly balancedSpaceShrink?: true;
        };
      })
    | undefined,
  rtl: boolean
): readonly StyleSpanRecord[] {
  return alignSpans(
    spans,
    measurer,
    measure.indent,
    measure.available,
    alignment,
    setsLikeLastLine(props, line, isLastLine, compatibility),
    alignment === 'center' || alignment === 'right' ? measure.used : undefined,
    rtl,
    false,
    line.spaceShrink === true,
    measure.passages,
    paragraphDistributedSpacing(props, compatibility),
    compatibility?.typography?.eastAsianSpacing !== false,
    line as PendingLine,
    compatibility?.typography?.balancedSpaceShrink === true
  );
}

/**
 * How far alignment moved a line. A line with no spans still aligns: an empty centred
 * paragraph puts its (zero width) content, and so the caret, at the middle of the measure.
 */
export function lineAlignOffset(
  placedSpans: readonly StyleSpanRecord[],
  alignedSpans: readonly StyleSpanRecord[],
  alignment: Alignment,
  available: number,
  used: number
): number {
  if (placedSpans.length > 0 && alignedSpans.length > 0) {
    return alignedSpans[0]!.box.x - placedSpans[0]!.box.x;
  }
  if (alignment === 'left' || alignment === 'both') return 0;
  const slack = available - used;
  if (slack <= 0 || !Number.isFinite(slack)) return 0;
  return alignment === 'center' ? slack / 2 : slack;
}

/**
 * The horizontal box a line aligns inside: the passage a float left it, or the paragraph's
 * own measure when no float shortens the line.
 *
 * `used` is the line's content extent measured from that box's left edge, so the snap advance
 * a float forced before the first glyph is not mistaken for content and does not push a
 * centred line off toward the far margin. A line that steps over a float also returns its
 * `passages` in the spans' x space, for {@link alignSpans} to align each part inside its own.
 *
 * `penX` is the offset placement adds to the line's pen x: the column's left edge, less the
 * first-line indent of a right-to-left line. A right-to-left line breaks in mirrored x
 * (`PendingLine.wrapMirrored`). Its passages come back physical, in the order the line fills
 * them (rightmost first), each with the pen x it began at.
 */
export function lineAlignmentMeasure(
  line: {
    readonly width: number;
    readonly wrapSegment?: {
      readonly start: number;
      readonly end: number;
      readonly contentEnd?: number;
    };
    readonly wrapPassages?: readonly LinePassage[];
    readonly wrapMirrored?: true;
  },
  penX: number,
  lineIndent: number,
  lineAvailableWidth: number
): {
  readonly indent: number;
  readonly available: number;
  readonly used: number;
  readonly passages?: readonly LinePassage[];
} {
  const segment = line.wrapSegment;
  if (line.wrapMirrored) {
    // The line broke in x mirrored about its measure, which runs from `lineIndent` for
    // `lineAvailableWidth`. Each passage maps back to its physical place, in break order.
    const axis = 2 * lineIndent + lineAvailableWidth;
    const broken = line.wrapPassages ?? (segment ? [segment] : []);
    return {
      indent: lineIndent,
      available: lineAvailableWidth,
      used: line.width,
      passages: broken.map((passage): MirroredLinePassage => ({
        start: axis - (passage.end + penX),
        end: axis - (passage.start + penX),
        mirrored: true,
        breakStart: passage.start + penX,
      })),
    };
  }
  if (!segment) {
    const passages = line.wrapPassages?.map((passage) => ({
      start: penX + passage.start,
      end: penX + passage.end,
    }));
    return {
      indent: lineIndent,
      available: lineAvailableWidth,
      used: line.width,
      ...(passages ? { passages } : {}),
    };
  }
  return {
    indent: penX + segment.start,
    available: Math.max(1, segment.end - segment.start),
    used:
      segment.contentEnd !== undefined
        ? segment.contentEnd - segment.start
        : lineIndent - penX + line.width - segment.start,
  };
}

/**
 * Where a line's visible text ends, relative to `indentLeft`: the last span holding more than
 * U+0020 spaces, without its own trailing spaces. Undefined when the line holds no such span,
 * or when something past the text spans (an inline picture) reaches further than they do.
 */
function visibleTextEnd(
  spans: readonly StyleSpanRecord[],
  trailingEnd: number,
  indentLeft: number,
  lineUsedWidth: number | undefined,
  measurer: TextMeasurer
): number | undefined {
  let spansEnd = -Infinity;
  for (let index = 0; index < trailingEnd; index += 1) {
    const span = spans[index]!;
    spansEnd = Math.max(spansEnd, span.box.x + span.box.width);
  }
  if (lineUsedWidth !== undefined && lineUsedWidth > spansEnd - indentLeft + OVERFLOW_TOLERANCE_PT)
    return undefined;
  for (let index = trailingEnd - 1; index >= 0; index -= 1) {
    const span = spans[index]!;
    const visible = withoutTrailingSpaces(span.text);
    if (visible === '') continue;
    if (visible === span.text) return span.box.x - indentLeft + span.box.width;
    const style = styleForFontSlot(span.style, span.fontSlot);
    return span.box.x - indentLeft + measureDisplayText(visible, style, measurer);
  }
  return undefined;
}
