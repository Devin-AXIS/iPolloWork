// Where a point beyond a line's content, or in a gap inside it, lands. Split from
// `semantic-hit-test.ts`, which resolves every other point on a line.

import type { InlineDrawingRecord } from './drawing-layout.ts';
import { pictureIsRtl } from './inline-picture-caret.ts';
import { lineForSegment, lineSegments } from './line-segments.ts';
import type {
  LineRecord,
  SemanticLayout,
  StyleSpanRecord,
  TextMeasurer,
} from './semantic-records.ts';
import { caretBoxOnLine, lineEndOffset } from './semantic-hit-test.ts';

/** What the two resolvers read from a hit test's context. */
export interface EdgeHitContext {
  readonly layout: SemanticLayout;
  readonly measurer: TextMeasurer | undefined;
}

/** A resolved position on a line: its offset and the caret x drawn for it. */
export interface EdgeOffset {
  readonly offset: number;
  readonly x: number;
  readonly withinSpan: boolean;
}

/**
 * A point beyond either end of a line's content.
 *
 * Past the paragraph's end side (where its mark stands: the left of a right-to-left paragraph)
 * it is the line's own end. Past the start side the content at that edge answers: a picture
 * gives the side of it the point is on, in the picture's own direction, so a point right of a
 * left-to-right picture is after it even in a right-to-left paragraph. A side that is the
 * line's first or last content is the line's own start or end, which also reaches content
 * that paints no box, such as a hidden run. Null between the ends, and on the start side when
 * no picture stands at the edge, where the nearest text answers.
 */
export function beyondLine(
  line: LineRecord,
  left: number,
  right: number,
  x: number,
  context: EdgeHitContext,
  paragraphRtl: boolean,
  edge: { readonly left?: InlineDrawingRecord; readonly right?: InlineDrawingRecord }
): EdgeOffset | null {
  if (x > left && x < right) return null;
  const atRight = x >= right;
  let atEnd = atRight !== paragraphRtl;
  if (!atEnd) {
    const picture = atRight ? edge.right : edge.left;
    if (!picture) return null;
    const side = atRight !== pictureIsRtl(picture) ? picture.start + 1 : picture.start;
    const ownSpans = line.spans.filter((span) => span.range.paragraphId === picture.paragraphId);
    const ownDrawings = (line.drawings ?? []).filter(
      (drawing) => drawing.paragraphId === picture.paragraphId
    );
    const first = Math.min(
      ...ownSpans.map((s) => s.range.start),
      ...ownDrawings.map((d) => d.start)
    );
    const last = Math.max(
      ...ownSpans.map((s) => s.range.end),
      ...ownDrawings.map((d) => d.start + 1)
    );
    if (side > first && side < last) {
      const segment = lineSegments(line).find((entry) => entry.paragraphId === picture.paragraphId);
      return {
        offset: side,
        x: caretBoxOnLine(line, side, context.measurer, segment).x,
        withinSpan: false,
      };
    }
    atEnd = side >= last;
  }
  // A join line ends in its last paragraph and starts in its first, each counting its own.
  const segments = lineSegments(line);
  const segment = atEnd ? segments.at(-1) : segments[0];
  const owned = lineForSegment(line, segment);
  const offset = atEnd ? lineEndOffset(context.layout, owned) : owned.range.start;
  return {
    offset,
    x: caretBoxOnLine(line, offset, context.measurer, segment).x,
    withinSpan: false,
  };
}

/**
 * A point in a gap between two pieces of a line's content.
 *
 * Between two text spans the gap is slack a justified line spread, so the nearer edge answers.
 * Beside a picture it is room a float's wrap jump or a margin left, and the point means the
 * boundary between the two pieces: just after the content on its left. The caret for that
 * offset draws where the content that starts there draws it, past any jump.
 */
export function gapOffset(
  line: LineRecord,
  spans: readonly StyleSpanRecord[],
  x: number,
  context: EdgeHitContext
): EdgeOffset {
  const pieces: GapPiece[] = spans.map((span) => ({
    from: span.box.x,
    to: span.box.x + span.box.width,
    start: span.range.start,
    end: span.range.end,
    paragraphId: span.range.paragraphId,
    text: true,
    rtl: span.style.shaping?.direction === 'rtl',
  }));
  for (const picture of line.drawings ?? []) {
    pieces.push({
      from: picture.advanceStart,
      to: picture.advanceEnd,
      start: picture.start,
      end: picture.start + 1,
      paragraphId: picture.paragraphId,
      text: false,
      rtl: pictureIsRtl(picture),
    });
  }
  let before: GapPiece | undefined;
  let after: GapPiece | undefined;
  for (const piece of pieces) {
    if (piece.to <= x && (!before || piece.to > before.to)) before = piece;
    if (piece.from > x && (!after || piece.from < after.from)) after = piece;
  }
  if (before?.text && after?.text) {
    return x - before.to <= after.from - x
      ? { offset: before.end, x: before.to, withinSpan: false }
      : { offset: after.start, x: after.from, withinSpan: false };
  }
  // The boundary a gap stands for is the offset its two neighbours share. With one neighbour,
  // or none shared, it is that piece's far side in reading order: the end of a left-to-right
  // piece on the left of the gap, or the start of a right-to-left one.
  const shared =
    before && after && before.paragraphId === after.paragraphId
      ? [before.start, before.end].find((offset) => offset === after.start || offset === after.end)
      : undefined;
  const side = before
    ? { offset: shared ?? (before.rtl ? before.start : before.end), piece: before }
    : after && { offset: after.rtl ? after.end : after.start, piece: after };
  if (!side) return { offset: line.range.start, x: line.contentX, withinSpan: false };
  const segment = lineSegments(line).find((entry) => entry.paragraphId === side.piece.paragraphId);
  const caretX = caretBoxOnLine(line, side.offset, context.measurer, segment).x;
  return { offset: side.offset, x: caretX, withinSpan: false };
}

/** A span or an inline picture, by its advance and its model range, for {@link gapOffset}. */
interface GapPiece {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly end: number;
  readonly paragraphId: string;
  readonly text: boolean;
  /** Reads right to left, so its logical start is its right edge. */
  readonly rtl: boolean;
}
