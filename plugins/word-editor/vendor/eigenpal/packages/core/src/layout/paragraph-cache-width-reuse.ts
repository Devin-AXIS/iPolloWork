import { numericLinesHoldAtWidth } from './numeric-width-proof-cache.ts';
import { lineHangingPunctuationAdvance } from './line-hanging-punctuation.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { endsWithSpaceSlot } from './trailing-spaces.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './pending-line.ts';

type Reader = (paragraph: OoxmlNode, key: string, accept: (value: unknown) => boolean) => unknown;
const readers = new WeakMap<object, Reader>();

/** Internal access to entries with identical dependencies except available width. */
export function registerWidthAlternativeReader(cache: object, read: Reader): void {
  readers.set(cache, read);
}

/** Line facts that tie a measured break to its width, its place on the page, or its neighbors. */
export function lineTiedToPlacement(line: PendingLine): boolean {
  return Boolean(
    line.drawings.length ||
    line.wrapSegment ||
    line.wrapPassages ||
    line.exclusionSkipBefore ||
    line.anchorClearanceBefore ||
    line.pageBreakAfter ||
    line.columnBreakAfter ||
    line.manualBreakAfter ||
    line.spaceShrink ||
    lineHangingPunctuationAdvance(line) ||
    line.deletedRanges?.length ||
    line.anchorRevisions?.length ||
    line.changeSites?.length
  );
}

/** ASCII letters, digits, ordinary punctuation and the ordinary space (U+0020). */
const ORDINARY_TEXT = /^[A-Za-z0-9 .,:;()%+/-]+$/;
const movableLines = new WeakMap<PendingLine, boolean>();

/**
 * The width-independent half of {@link tokenLineHoldsAtWidth}, memoized per immutable line.
 *
 * A line that fits its width never reaches a width-dependent branch of the breaker: every
 * such branch either needs an overflow (a prefix of the line wider than the room), or wrap
 * zones, tabs, pictures, CJK fitting or right-to-left text, which this refuses. Advances are
 * never negative here, so no prefix is wider than the whole line. A space hung at the line end
 * is the one width-dependent piece of ordinary text, so a line ending in a space is refused.
 */
export function tokenLineMovable(line: PendingLine): boolean {
  let known = movableLines.get(line);
  if (known === undefined) {
    known =
      !lineTiedToPlacement(line) &&
      line.spans.length > 0 &&
      !endsWithSpaceSlot(line.spans[line.spans.length - 1]!.text) &&
      line.spans.every(
        (span) =>
          ORDINARY_TEXT.test(span.text) &&
          span.box.width >= 0 &&
          span.style.shaping?.direction !== 'rtl' &&
          !span.lineEndWhitespace &&
          !span.optionalHyphenBreak &&
          !span.tabLeader &&
          !span.glyphOffsetPt &&
          !span.noteSeparator
      );
    movableLines.set(line, known);
  }
  return known;
}

/**
 * How far past `available` a line may reach and still hold. Every ordinary-text overflow
 * comparison in the breaker allows 0.001pt; half of it leaves room for the rounding of those
 * comparisons, so a line within this band takes no overflow branch. AutoFit columns land
 * within rounding of their widest line, which this keeps transferable.
 */
export const LINE_HOLD_TOLERANCE_PT = 0.0005;

/** A complete ordinary text line is the same break at `available` when that width holds it. */
export function tokenLineHoldsAtWidth(line: PendingLine, available: number): boolean {
  return (
    tokenLineMovable(line) &&
    line.width + Math.max(0, line.firstLineOffset ?? 0) <= available + LINE_HOLD_TOLERANCE_PT
  );
}

/** Reuse a complete ordinary line or a numeric paragraph with an exact break proof. */
export function reuseParagraphAtWidth(
  cache: ParagraphLayoutCache<readonly PendingLine[]>,
  paragraph: OoxmlNode,
  key: string,
  available: number
): readonly PendingLine[] | undefined {
  return readers.get(cache)?.(paragraph, key, (value) => {
    const lines = value as readonly PendingLine[];
    return (
      Array.isArray(lines) &&
      ((lines.length === 1 && tokenLineHoldsAtWidth(lines[0]!, available)) ||
        numericLinesHoldAtWidth(lines, available))
    );
  }) as readonly PendingLine[] | undefined;
}
