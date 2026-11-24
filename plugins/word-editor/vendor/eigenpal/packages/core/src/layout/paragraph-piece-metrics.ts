// The measured piece a broken line is assembled from, and the three pure readings taken over
// a piece run: where content still follows a tab, how wide the segment after one is, and
// where a `w:ptab` lands. Extracted from paragraph-flow so that module stays inside its line
// budget; it is the only consumer.

import { RIGHT_TO_LEFT_LETTER } from './rtl-letter.ts';
import { PAGE_BREAK_CHAR, type OoxmlProperty } from '@docx-editor.dev/core/store';
import type { FieldAwarePiece, PositionalTab } from './field-projection.ts';
import type { TabLeader } from './paragraph-tabs.ts';
import { measureInlineDrawing } from './drawing-layout.ts';
import { displayText, runStylesEqual, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import * as lineEndSpaces from './line-end-whitespace.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** One measurable piece of a paragraph: text carrying one property set. */
export interface Piece {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  /** Resolved once here, so nothing downstream re-derives it. */
  readonly style: ResolvedRunStyle;
  readonly start: number;
  readonly end: number;
  /** Live PAGE/NUMPAGES projection — model range covers suppressed cached result (or zero-width if empty). */
  readonly projected?: boolean;
  /** When set, measure this instead of `text` (note-mark width reservation). */
  readonly measureText?: string;
  /** Note citation / mark navigation for paint. */
  readonly noteNav?: {
    readonly scopeId: string;
    readonly direction: 'to-note' | 'to-body';
  };
  /** Zero-width `w:ptab` destination metadata. */
  readonly positionalTab?: PositionalTab;
  readonly breakKind?: FieldAwarePiece['breakKind'];
  /** Sanitized hyperlink this piece belongs to. */
  readonly link?: import('./semantic-records.ts').SpanLinkRecord;
  /** Typed inline drawing occupying one UTF-16 model unit. */
  readonly inlineDrawing?: import('./drawing-layout.ts').InlineDrawingLayoutInput;
  /** Bounded OMML equation occupying one UTF-16 model unit. */
  readonly equation?: FieldAwarePiece['equation'];
  readonly unsupported?: FieldAwarePiece['unsupported'];
  /**
   * The `w:rFonts` slot this piece's text resolves its face through, from
   * `applyEastAsiaFontSlots`. `style` stays the run's real resolution; every measurement
   * below resolves the face with `styleForFontSlot`, and the slot is republished on the
   * span so paint and hit-testing resolve the same one.
   */
  readonly fontSlot?: FieldAwarePiece['fontSlot'];
}

/**
 * Whether anything that occupies space still follows this tab on its own line.
 *
 * A TRAILING tab does not wrap in Word — same rule as a trailing space. Header lines are
 * routinely authored as `LEFT<tab><tab><tab>RIGHT<tab><tab>`, and treating the last tabs
 * as wrappable opened a new line per tab: the header grew by several lines, and because a
 * header's flow height sets the body's effective top margin, the body was pushed down the
 * page. Stops at a hard break, which ends the line anyway, and skips further tabs and
 * spaces, which are themselves trimmed at the line end. When `pageBreaksIgnored` (a table
 * cell), a page break ends nothing and is skipped too.
 */
export function placeableContentSuffixes(
  pieces: readonly Piece[],
  pageBreaksIgnored = false
): readonly Uint8Array[] {
  const suffixes = new Array<Uint8Array>(pieces.length);
  let follows = false;
  for (let pieceIndex = pieces.length - 1; pieceIndex >= 0; pieceIndex -= 1) {
    const piece = pieces[pieceIndex]!;
    const suffix = new Uint8Array(piece.text.length + 1);
    suffix[piece.text.length] = follows ? 1 : 0;
    if (piece.inlineDrawing) {
      suffix.fill(1);
    } else {
      for (let cursor = piece.text.length - 1; cursor >= 0; cursor -= 1) {
        const ch = piece.text[cursor]!;
        if (ch === PAGE_BREAK_CHAR && pageBreaksIgnored) suffix[cursor] = suffix[cursor + 1]!;
        else if (ch === '\n' || ch === PAGE_BREAK_CHAR) suffix[cursor] = 0;
        else if (ch !== '\t' && !lineEndSpaces.isCollapsibleLineEndWhitespace(ch))
          suffix[cursor] = 1;
        else suffix[cursor] = suffix[cursor + 1]!;
      }
    }
    suffixes[pieceIndex] = suffix;
    follows = suffix[0] === 1;
  }
  return suffixes;
}

/**
 * The text after a tab, up to the next tab or break: its width, and where a decimal stop
 * aligns it. An ignored page break adds no width and does not end the segment.
 *
 * `decimalOffset` is the advance before the first `.`, or the whole width when there is none.
 * `rtlDecimalOffset` is the same point measured from the segment's LEADING (right) edge, for a
 * right-to-left paragraph, whose stops count from the right margin. Digits keep left-to-right
 * order there, so the point's left edge still sits on the stop and the text after it lies on
 * the leading side; a point after a right-to-left letter reads the other way.
 */
export function measureFollowingTabSegment(
  pieces: readonly Piece[],
  pieceIndex: number,
  offsetInPiece: number,
  measurer: TextMeasurer,
  pageBreaksIgnored = false
): { width: number; decimalOffset: number; rtlDecimalOffset: number } {
  let width = 0;
  let decimalOffset = 0;
  let sawDecimal = false;
  let afterRightToLeftLetter = false;
  // The last visible character, while only ignored page breaks follow it; `broken` once one
  // has. Without a break between them, a piece boundary ends the lookback as before.
  let carried: { piece: Piece; char: string; end: number; broken: boolean } | undefined;
  const result = () => ({
    width,
    decimalOffset: sawDecimal ? decimalOffset : width,
    rtlDecimalOffset:
      !sawDecimal || afterRightToLeftLetter
        ? sawDecimal
          ? decimalOffset
          : width
        : width - decimalOffset,
  });
  for (let index = pieceIndex; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const style = styleForFontSlot(piece.style, piece.fontSlot);
    // An inline picture or placeholder advances the segment by its own width.
    const atomWidth = piece.unsupported
      ? piece.unsupported.width
      : piece.inlineDrawing
        ? measureInlineDrawing(piece.inlineDrawing.projection).totalWidth
        : undefined;
    if (atomWidth !== undefined) {
      width += atomWidth;
      if (!sawDecimal) decimalOffset = width;
      continue;
    }
    const from = index === pieceIndex ? offsetInPiece : 0;
    let to = from;
    while (to < piece.text.length) {
      const ch = piece.text[to]!;
      if (ch === '\t' || ch === '\n' || (ch === PAGE_BREAK_CHAR && !pageBreaksIgnored)) break;
      to += 1;
    }
    // Measure each piece's slice whole, so a joining script (Arabic) measures as shaped
    // and not as a sum of isolated letters.
    const visibleSlice = (end: number) => {
      const slice = piece.text.slice(from, end);
      return pageBreaksIgnored ? slice.replaceAll(PAGE_BREAK_CHAR, '') : slice;
    };
    const measure = (end: number) =>
      end > from ? measurer.measure(displayText(visibleSlice(end), style), style) : 0;
    const segmentWidth = measure(to);
    if (!sawDecimal) {
      const dot = piece.text.indexOf('.', from);
      if (dot !== -1 && dot < to) {
        sawDecimal = true;
        const preceding =
          visibleSlice(dot).at(-1) ??
          (carried?.broken && carried.end === piece.start && oneShapedItem(carried.piece, piece)
            ? carried.char
            : undefined);
        afterRightToLeftLetter = preceding !== undefined && RIGHT_TO_LEFT_LETTER.test(preceding);
        // Decimal point itself sits ON the stop — offset is the advance before it.
        decimalOffset += measure(dot);
      } else {
        decimalOffset += segmentWidth;
      }
    }
    width += segmentWidth;
    if (to < piece.text.length) return result();
    const tail = visibleSlice(to).at(-1);
    if (tail !== undefined) carried = { piece, char: tail, end: piece.end, broken: false };
    else if (carried?.end === piece.start && pageBreaksIgnored && piece.text === PAGE_BREAK_CHAR)
      carried = { ...carried, end: piece.end, broken: true };
    else carried = undefined;
  }
  return result();
}

/**
 * Whether two pieces are the halves of one shaped item that an ignored page break split.
 *
 * The decimal rule reads the character before the point within its item. Bidi resolution
 * itemizes a cell's text as though its page breaks were absent, then splits an item at each
 * break into halves with one style, apart from the joining context each half reads. Pieces
 * that differ in anything else (a formatting change, a bidi level) were separate items
 * without the break too.
 */
function oneShapedItem(before: Piece, after: Piece): boolean {
  const shaping = after.style.shaping;
  if (!shaping || !before.style.shaping) return false;
  const { context } = before.style.shaping;
  return runStylesEqual(before.style, { ...after.style, shaping: { ...shaping, context } });
}

/**
 * Where a `w:ptab` sends the caret, in the same shape `nextTabDestination` answers with.
 *
 * ECMA-376 §17.3.3.16: the position is stated by `w:alignment` against the reference
 * `w:relativeTo` names, rather than looked up in `w:tabs`.
 *
 * ONLY `w:alignment` is honoured here; the reference is always the paragraph's own text
 * column (`indentLeft`..`rightEdge`), which is what `w:relativeTo="margin"` — the value
 * every contents field Word generates carries — means. `indent` differs from it only for
 * an indented paragraph and `leftMargin` only for a ptab pointing backwards, both of which
 * the clamp in `tabAdvanceWidth` already resolves to no advance. `positionalTabOf` still
 * validates the attribute so a hostile value cannot reach geometry if that changes.
 */
export function positionalTabDestination(
  positional: PositionalTab,
  indentLeft: number,
  rightEdge: number,
  marginExtent: { readonly left: number; readonly right: number } | undefined
): { positionPt: number; alignment: 'left' | 'center' | 'right' | 'decimal'; leader?: TabLeader } {
  // `indent` measures against the paragraph's own column; `margin` and `leftMargin` against
  // the containing one. They differ exactly when the paragraph is indented — which is where
  // reading `w:relativeTo` and then ignoring it put the page number short of the margin by
  // the width of the indent.
  const column =
    positional.relativeTo === 'indent' || !marginExtent
      ? { left: indentLeft, right: rightEdge }
      : marginExtent;
  const positionPt =
    positional.alignment === 'right'
      ? column.right
      : positional.alignment === 'center'
        ? (column.left + column.right) / 2
        : column.left;
  return {
    positionPt,
    alignment: positional.alignment,
    ...(positional.leader ? { leader: positional.leader } : {}),
  };
}
