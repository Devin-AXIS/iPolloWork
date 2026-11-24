// Where an offset sits ACROSS a line, in points.
//
// Split out because two lanes need it and neither owns the other: caret stops ask it for a
// position, selection rectangles ask it for the ends of a range. Both must ask it about ONE
// paragraph's share of the line, which is what the segment argument is for.

import { segmentGraphemes, type GraphemeSegment } from './grapheme.ts';
import { MAX_CARET_ADVANCE_UTF16 } from './shaped-caret-advances.ts';
import { drawingAtOffset, endingPicture, pictureEdgeX } from './inline-picture-caret.ts';
import { spanOffsetX } from './semantic-hit-test.ts';
import type { LineSegment } from './line-segments.ts';
import type { LineRecord, StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

export /** The x offset of `offset` within a line, by walking its spans. */
function xWithinLine(
  line: LineRecord,
  offset: number,
  measurer?: TextMeasurer | undefined,
  segment?: LineSegment,
  upstream = false
): number {
  // An offset only means something in ONE paragraph, so a mixed line is walked through the
  // segment that owns it. Given none, the line is its own segment, which is every ordinary
  // line and the path this function always took.
  const spans = segment ? segment.spans : line.spans;
  const ended = upstream ? upstreamX(line, spans, offset, measurer, segment) : null;
  if (ended !== null) return ended;
  // The content that starts at an offset owns it; see `drawingAtOffset`.
  const picture = drawingAtOffset(line, offset, segment);
  if (picture) return pictureEdgeX(picture, offset > picture.start);
  let x = segment ? (segment.spans[0]?.box.x ?? line.contentX) : line.contentX;
  for (const span of spans) {
    if (offset <= span.range.start)
      return span.style.shaping ? spanOffsetX(span, span.range.start, measurer) : span.box.x;
    if (offset >= span.range.end) {
      x = span.style.shaping
        ? spanOffsetX(span, span.range.end, measurer)
        : span.box.x + span.box.width;
      continue;
    }
    // MEASURED, not interpolated. Interpolating across the span's advance is exact only for a
    // uniform one — in any proportional face it draws the caret a fraction of the way through
    // the span rather than at a glyph edge, so a caret between two letters appeared on top of
    // one. Without a measurer it still interpolates, and says so.
    return spanOffsetX(span, offset, measurer);
  }
  return x;
}

export interface LineRangeBand {
  readonly x: number;
  readonly width: number;
}

/** Merge touching physical bands without filling gaps between reordered runs. */
export function mergeLineRangeBands(bands: LineRangeBand[]): LineRangeBand[] {
  bands.sort((a, b) => a.x - b.x);
  const merged: LineRangeBand[] = [];
  for (const band of bands) {
    const previous = merged.at(-1);
    if (previous && band.x <= previous.x + previous.width + 0.001) {
      merged[merged.length - 1] = {
        x: previous.x,
        width: Math.max(previous.x + previous.width, band.x + band.width) - previous.x,
      };
    } else merged.push(band);
  }
  return merged;
}

const selectionGraphemes = new WeakMap<StyleSpanRecord, readonly GraphemeSegment[]>();
const CONTROL_ONLY = /^[\p{Control}\p{Default_Ignorable_Code_Point}]+$/u;
const VISIBLE_BASE = /[\p{Letter}\p{Number}\p{Punctuation}\p{Symbol}]/u;

/** Highlight ink for partial clusters without inventing new insertion positions. */
function selectionSpanEdges(
  span: StyleSpanRecord,
  from: number,
  to: number,
  measurer?: TextMeasurer
): readonly [number, number] | null {
  if (CONTROL_ONLY.test(span.text.slice(from - span.range.start, to - span.range.start)))
    return null;
  if (
    span.style.shaping &&
    measurer &&
    span.text.length <= MAX_CARET_ADVANCE_UTF16 &&
    span.text.length === span.range.end - span.range.start
  ) {
    let graphemes = selectionGraphemes.get(span);
    if (!graphemes) {
      graphemes = segmentGraphemes(span.text);
      selectionGraphemes.set(span, graphemes);
    }
    const at = (offset: number) => {
      let low = 0;
      let high = graphemes.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (graphemes[middle]!.utf16To <= offset) low = middle + 1;
        else high = middle;
      }
      return graphemes[low];
    };
    const first = at(from - span.range.start);
    const last = at(to - span.range.start - 1);
    if (first && last) {
      from = span.range.start + first.utf16From;
      to = span.range.start + last.utf16To;
      const leading = spanOffsetX(span, span.range.start + last.utf16From, measurer);
      // Whole-run caret vectors collapse ligature interiors to their leading edge.
      // Expand a selected base's flat trailing edge to the next cluster edge. Marks
      // inherit their grapheme's base; isolated marks and controls never borrow ink.
      if (VISIBLE_BASE.test(last.text) && spanOffsetX(span, to, measurer) === leading) {
        let low = to + 1;
        let high = span.range.end;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (spanOffsetX(span, middle, measurer) === leading) low = middle + 1;
          else high = middle;
        }
        to = Math.min(low, span.range.end);
      }
    }
  }
  return [spanOffsetX(span, from, measurer), spanOffsetX(span, to, measurer)];
}

/**
 * The x of a range END at `offset`, where the content that ends there owns it: a band over a
 * picture or a word stops at it rather than past a picture or a float's jump after it. A word
 * whose next word justification moved keeps the stretched gap, which the next word owns.
 * Null when nothing ends at `offset`, so the caret's own rule answers.
 */
function upstreamX(
  line: LineRecord,
  spans: readonly StyleSpanRecord[],
  offset: number,
  measurer: TextMeasurer | undefined,
  segment: LineSegment | undefined
): number | null {
  const picture = endingPicture(segment?.drawings ?? line.drawings ?? [], offset);
  if (picture) {
    // A cached field can end with text after its last picture.
    let edge = pictureEdgeX(picture, true);
    for (const span of spans) {
      if (span.projected && span.range.end === offset) {
        edge = Math.max(edge, span.box.x + span.box.width);
      }
    }
    return edge;
  }
  const ending = spans.find((span) => span.range.end === offset && span.range.start < offset);
  if (!ending) return null;
  const next = spans.find((span) => span.range.start === offset && span.range.end > offset);
  if (next && !((next.wrapAdvanceBefore ?? 0) > 0)) return null;
  return ending.style.shaping
    ? spanOffsetX(ending, offset, measurer)
    : ending.box.x + ending.box.width;
}

/** A logical range can occupy several disjoint physical bands in a bidi line. */
export function rangeBandsWithinLine(
  line: LineRecord,
  start: number,
  end: number,
  measurer?: TextMeasurer,
  segment?: LineSegment
): LineRangeBand[] {
  const spans = segment?.spans ?? line.spans;
  if (!spans.some((span) => span.style.shaping !== undefined)) {
    const a = xWithinLine(line, start, measurer, segment);
    const b = xWithinLine(line, end, measurer, segment, end > start);
    return [{ x: Math.min(a, b), width: Math.abs(b - a) }];
  }
  const bands: LineRangeBand[] = [];
  // A picture reorders with the text on a shaped line, so it brings its own band.
  for (const picture of segment?.drawings ?? line.drawings ?? []) {
    if (picture.start < start || picture.start >= end) continue;
    bands.push({ x: picture.advanceStart, width: picture.advanceEnd - picture.advanceStart });
  }
  for (const span of spans) {
    const from = Math.max(start, span.range.start);
    const to = Math.min(end, span.range.end);
    if (from >= to) continue;
    const edges = selectionSpanEdges(span, from, to, measurer);
    if (!edges) continue;
    const [a, b] = edges;
    bands.push({ x: Math.min(a, b), width: Math.abs(b - a) });
  }
  return mergeLineRangeBands(bands);
}
