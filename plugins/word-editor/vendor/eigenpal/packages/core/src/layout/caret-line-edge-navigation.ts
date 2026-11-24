// Line-boundary affinity for keyboard navigation.
//
// One offset can end a wrapped line and start the next. Without a preference the caret shows
// at the start of the next line (`caretAt`). A caret that the reader put at the END of the
// upper line (End, a click past the line end, Down into the line end) carries that line as
// its affinity, and the motions here keep it: Home and End read the LOGICAL edges of the line
// the caret is on, and Up and Down start from that line and can land on a line's end.

import { lineSegmentFor, lineSegments } from './line-segments.ts';
import { paragraphLinesIndex } from './paragraph-lines.ts';
import { breakEndsLineBefore } from './semantic-caret-line.ts';
import type { LineRecord, SemanticLayout, TextMeasurer } from './semantic-records.ts';
import type { CaretGeometry } from './semantic-interaction.ts';

interface Position {
  readonly paragraphId: string;
  readonly offset: number;
}

interface CaretOnLine {
  readonly position: Position;
  readonly x: number;
  readonly lineId: string;
}

/** What the helpers read from the caret model, injected to keep this module a leaf. */
export interface LineEdgeDeps {
  /** Caret geometry for a position, on `lineId` when that line shows it. */
  locate(position: Position, lineId?: string): CaretOnLine | null;
  /** Whether keyboard navigation can rest at a position at all (on any line). */
  hasStop(position: Position): boolean;
}

/** A motion result that names the line the caret shows on. */
export interface LineAffineTarget {
  readonly position: Position;
  readonly lineId: string;
}

function placedLine(
  layout: SemanticLayout,
  paragraphId: string,
  lineId: string
): LineRecord | null {
  for (const { line } of paragraphLinesIndex(layout).get(paragraphId) ?? []) {
    if (line.id === lineId) return line;
  }
  return null;
}

/**
 * Home (`direction` -1) or End (+1): the logical start or end of the caret's line.
 *
 * End stops before a hard break, which belongs to the line it ended, and after trailing spaces
 * of a soft wrap, where the caret shows at the end of this line. Null where the visual rule
 * still applies: lines that join several paragraphs, and edges no caret can rest at (resolved
 * away deleted text).
 */
export function lineEdgeTarget(
  layout: SemanticLayout,
  position: Position,
  direction: -1 | 1,
  lineId: string | undefined,
  deps: LineEdgeDeps
): LineAffineTarget | null {
  const current = deps.locate(position, lineId);
  if (!current) return null;
  const line = placedLine(layout, position.paragraphId, current.lineId);
  if (!line || lineSegments(line).length !== 1) return null;
  const segment = lineSegmentFor(line, position.paragraphId);
  if (!segment) return null;
  // A field cut across lines is one model unit: its edges belong to the lines where the
  // field starts and ends, and the visual rule answers inside it.
  const edgeSpan = direction < 0 ? segment.spans[0] : segment.spans.at(-1);
  if (edgeSpan?.projected) return null;
  let offset = direction < 0 ? segment.start : segment.end;
  if (direction > 0 && offset > segment.start && breakEndsLineBefore(line, offset)) offset -= 1;
  const target = { paragraphId: position.paragraphId, offset };
  if (!deps.hasStop(target)) return null;
  const shown = deps.locate(target, line.id);
  if (!shown || shown.lineId !== line.id) return null;
  // The edge must be this line's own position, or the end of a wrap that the next line
  // starts at, where the caret shows on this line through its affinity.
  if (deps.locate(target)?.lineId !== line.id && !(direction > 0 && offset === segment.end)) {
    return null;
  }
  return { position: target, lineId: line.id };
}

/**
 * Where Up or Down starts from when the caret shows on a line its offset does not belong to.
 *
 * The motion steps from the caret's own line, at the caret's own x; null when the caret is
 * already on the line its offset belongs to, and the plain motion applies.
 */
export function verticalStartOnAffineLine(
  position: Position,
  lineId: string | undefined,
  deps: LineEdgeDeps
): { readonly position: Position; readonly x: number } | null {
  if (lineId === undefined) return null;
  const canonical = deps.locate(position);
  const shown = deps.locate(position, lineId);
  if (!canonical || !shown || shown.lineId !== lineId || canonical.lineId === lineId) return null;
  // The last position before the shared one is on the shown line, at its last character.
  if (position.offset === 0) return null;
  const before = { paragraphId: position.paragraphId, offset: position.offset - 1 };
  const onLine = deps.locate(before, lineId);
  return onLine && onLine.lineId === lineId ? { position: before, x: shown.x } : null;
}

/**
 * After Up or Down landed on a line: the line's END when it is nearer the column than the
 * landing, so a column past the line's text reaches the end of a wrapped line too.
 */
export function verticalLineEndTarget(
  layout: SemanticLayout,
  landed: Position,
  targetX: number,
  deps: LineEdgeDeps
): LineAffineTarget | null {
  const shown = deps.locate(landed);
  if (!shown) return null;
  const end = lineEdgeTarget(layout, landed, 1, shown.lineId, deps);
  if (!end || end.position.offset <= landed.offset || end.lineId !== shown.lineId) return null;
  // Only a wrap end needs this: any other end already had a stop the motion could choose.
  const canonicalEnd = deps.locate(end.position);
  if (!canonicalEnd || canonicalEnd.lineId === end.lineId) return null;
  const endGeometry = deps.locate(end.position, end.lineId);
  if (!endGeometry) return null;
  return Math.abs(endGeometry.x - targetX) < Math.abs(shown.x - targetX) ? end : null;
}

/** How `moveCaret` resolves a motion. */
export interface MoveCaretOptions {
  /** Precomputed active-story stops; body navigation keeps the indexed default. */
  readonly stops?: readonly CaretGeometry[];
  readonly measurer?: TextMeasurer;
  /**
   * The line the caret shows on (its line affinity), for an offset that ends one wrapped line
   * and starts the next. Home, End, Up, and Down then start from that line. A line that does
   * not hold the offset is ignored, and the default line for the offset applies.
   */
  readonly lineId?: string;
}
