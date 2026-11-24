import { shiftInlineDrawingRecord, type InlineDrawingRecord } from './drawing-layout.ts';
import type { StyleSpanRecord } from './semantic-records.ts';
import { DEFAULT_RUN_STYLE } from './run-style.ts';

/** A picture's one model unit in text: U+FFFC OBJECT REPLACEMENT CHARACTER. */
export const PICTURE_CHAR = '\ufffc';

/**
 * Align a line's text and its inline pictures together.
 *
 * Alignment and bidi reordering work on spans. On a line whose text bidi resolution shaped,
 * each picture joins them as a stand-in span: its U+FFFC, its own resolved level, and its
 * advance as its width. It then reorders with the text around it, so a picture in a
 * right-to-left paragraph stands to the right of the text that follows it. Each picture moves
 * to where its stand-in landed, and the stand-ins leave the line again.
 *
 * A line that needed no bidi resolution takes stand-ins without a level, so it keeps its
 * logical order while alignment and justification still move each picture with the text
 * around it. A line of pictures only in a right-to-left paragraph reorders, so its pictures
 * read right to left.
 */
export function alignLineWithPictures(
  placedSpans: readonly StyleSpanRecord[],
  placedDrawings: readonly InlineDrawingRecord[],
  paragraphRtl: boolean,
  align: (spans: readonly StyleSpanRecord[]) => readonly StyleSpanRecord[],
  offsetOf: (alignedSpans: readonly StyleSpanRecord[]) => number
): {
  readonly spans: readonly StyleSpanRecord[];
  readonly drawings: readonly InlineDrawingRecord[];
  readonly offset: number;
} {
  if (placedDrawings.length === 0) {
    const spans = align(placedSpans);
    return { spans, offset: offsetOf(spans), drawings: placedDrawings };
  }
  const template = placedSpans.find((span) => span.style.shaping);
  const resolved =
    template !== undefined || placedDrawings.some((drawing) => drawing.bidiLevel !== undefined);
  const baseLevel = template?.style.shaping?.baseLevel ?? (paragraphRtl ? 1 : 0);
  const groupsByRun = template?.style.shaping?.runDirection !== undefined;
  const { shaping: _shaping, ...plainStyle } =
    template?.style ?? placedSpans[0]?.style ?? DEFAULT_RUN_STYLE;
  const standIns = placedDrawings.map((drawing): StyleSpanRecord => {
    const level = drawing.bidiLevel ?? baseLevel;
    const direction = level % 2 ? ('rtl' as const) : ('ltr' as const);
    const shaping = {
      script: 'Zyyy',
      direction,
      level,
      baseLevel,
      // Lines that group text by run direction read a picture in its resolved direction, or
      // inside an override in its run's group.
      ...(groupsByRun ? { runDirection: drawing.bidiRunDirection ?? direction } : {}),
    };
    return {
      range: { paragraphId: drawing.paragraphId, start: drawing.start, end: drawing.start + 1 },
      text: PICTURE_CHAR,
      props: [],
      style: resolved ? { ...plainStyle, shaping } : plainStyle,
      box: {
        x: drawing.advanceStart,
        y: drawing.y,
        width: Math.max(0, drawing.advanceEnd - drawing.advanceStart),
        height: 0,
      },
    };
  });
  // Spans and pictures in model order: the order bidi reordering reads them in.
  const sorted = [...placedSpans, ...standIns].sort(
    (left, right) => left.range.start - right.range.start || left.box.x - right.box.x
  );
  // A float's jump before a picture splits the line into passages, which reorder apart. Spans
  // already carry theirs; a stand-in carries the room left after the content before it.
  const own = new Set<StyleSpanRecord>(standIns);
  const merged = sorted.map((span, index) => {
    const previous = sorted[index - 1];
    if (!own.has(span) || !previous) return span;
    const jump = span.box.x - (previous.box.x + previous.box.width);
    return jump > 0.001 ? { ...span, wrapAdvanceBefore: jump } : span;
  });
  const aligned = align(merged);
  // Alignment preserves each span's properties array while rebuilding its geometry.
  // Use that private identity: several cached pictures can share one field offset.
  const owners = new Map(
    standIns.map((span, index) => [span.props, placedDrawings[index]!] as const)
  );
  const landed = new Map<InlineDrawingRecord, number>();
  for (const span of aligned) {
    const owner = owners.get(span.props);
    if (owner) landed.set(owner, span.box.x);
  }
  const spans = aligned.filter((span) => !owners.has(span.props));
  const drawings = placedDrawings.map((drawing) =>
    shiftInlineDrawingRecord(
      drawing,
      (landed.get(drawing) ?? drawing.advanceStart) - drawing.advanceStart,
      0
    )
  );
  return { spans, drawings, offset: offsetOf(spans) };
}
