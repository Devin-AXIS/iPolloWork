import { lineSegmentFor, type LineSegment } from './line-segments.ts';
import type { LineRecord, SemanticLayout } from './semantic-records.ts';
import { paragraphFragmentsOf } from './semantic-records.ts';
import { paragraphLinesFor, type PlacedLine } from './paragraph-lines.ts';
import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';

/**
 * Whether a LATER line of the same paragraph starts at this offset, and so owns it.
 *
 * Asked across the whole paragraph rather than the current fragment: a paragraph split by a
 * page boundary continues on the next page, and the line that owns the position may live in
 * a different fragment. `caretAt` resolves against the same paragraph-wide index, so both
 * lanes answer with the same line. When nothing later claims it — a layout that produced no
 * line after the break — the break's own line keeps the stop rather than losing the position.
 */
export function laterLineOwns(layout: SemanticLayout, line: LineRecord, offset: number): boolean {
  const lines = paragraphLinesFor(layout, line.range.paragraphId) ?? [];
  let seen = false;
  for (const placed of lines) {
    if (placed.line === line) {
      seen = true;
      continue;
    }
    if (seen && placed.line.range.start === offset) return true;
  }
  return false;
}

/**
 * Whether the line right after `line` in its paragraph starts at `offset` — a soft wrap or a
 * page continuation that shares the offset. Only the NEXT line counts: a story laid out once
 * and attached to every page lists its lines again for each sheet, and a later copy starting
 * at the same offset is not a continuation.
 */
export function nextLineStartsAt(
  layout: SemanticLayout,
  line: LineRecord,
  offset: number
): boolean {
  const lines = paragraphLinesFor(layout, line.range.paragraphId);
  const index = lines.findIndex((placed) => placed.line === line);
  const next = lines[index + 1]?.line;
  return index >= 0 && next !== undefined && next !== line && next.range.start === offset;
}

/** The cut field fragment on `line` whose range starts or ends at `offset`, if any. */
function fieldFragmentAt(
  line: LineRecord,
  paragraphId: string,
  offset: number,
  edge: 'start' | 'end'
): { readonly start: number; readonly end: number } | null {
  for (const { projected, range } of line.spans) {
    if (!projected || range.paragraphId !== paragraphId || range.start >= range.end) continue;
    if ((edge === 'end' ? range.end : range.start) === offset) return range;
  }
  for (const drawing of line.drawings ?? []) {
    if (drawing.paragraphId !== paragraphId) continue;
    const range = { start: drawing.start, end: drawing.start + 1 };
    if ((edge === 'end' ? range.end : range.start) === offset) return range;
  }
  return null;
}

/** Each line record's FIRST position in its paragraph's line list, built once per list. */
const linePositions = new WeakMap<readonly PlacedLine[], Map<LineRecord, number>>();

function linePosition(lines: readonly PlacedLine[], line: LineRecord): number {
  let positions = linePositions.get(lines);
  if (!positions) {
    positions = new Map();
    for (const [at, placed] of lines.entries())
      if (!positions.has(placed.line)) positions.set(placed.line, at);
    linePositions.set(lines, positions);
  }
  return positions.get(line) ?? -1;
}

/**
 * Whether another line of the same story occurrence draws the same field, in `direction`.
 *
 * A header or footer paragraph is indexed once per page, with the same line records or with
 * per-page records that reuse their ids. Every occurrence opens with the paragraph's first
 * line id, so the scan stops there: past it lies another copy, not a continuation. A
 * repeated header row is not indexed at all; its copy scans the repeat lines on its page.
 */
function fieldContinues(
  layout: SemanticLayout,
  line: LineRecord,
  paragraphId: string,
  field: { readonly start: number; readonly end: number },
  direction: 1 | -1,
  pageIndex: number | undefined
): boolean {
  let lines: readonly PlacedLine[] = paragraphLinesFor(layout, paragraphId) ?? [];
  let index = linePosition(lines, line);
  if (index < 0 && pageIndex !== undefined) {
    lines = headerRepeatLinesOnPage(layout, pageIndex, paragraphId);
    index = lines.findIndex((placed) => placed.line === line);
  }
  if (index < 0) return false;
  const opening = lines[0]!.line.id;
  for (let at = index + direction; at >= 0 && at < lines.length; at += direction) {
    const other = lines[at]!.line;
    if (direction === 1 && other.id === opening) return false;
    const segment = lineSegmentFor(other, paragraphId);
    if (segment) {
      if (direction === 1 ? segment.start >= field.end : segment.end <= field.start) return false;
      if (fieldFragmentAt(other, paragraphId, field.end, 'end')?.start === field.start) return true;
    }
    if (other.id === opening) return false;
  }
  return false;
}

/**
 * Whether the field ending at `offset` on this line continues on a LATER line, which then
 * owns the offset after the field.
 *
 * Every fragment of a field cut across lines publishes the whole field range, and each line
 * that draws one covers that range in its segment (`lineSegments`). The offset after the field belongs
 * to the last of those lines, where the last fragment ends. `caretAt` and the caret stops
 * both ask this, so the drawn caret and keyboard motion agree. Ordinary text never has a
 * cut field fragment, so it never reaches the scan.
 */
export function laterSegmentHolds(
  layout: SemanticLayout,
  line: LineRecord,
  paragraphId: string,
  offset: number,
  pageIndex?: number
): boolean {
  const field = fieldFragmentAt(line, paragraphId, offset, 'end');
  return field !== null && fieldContinues(layout, line, paragraphId, field, 1, pageIndex);
}

/**
 * Whether the field starting at `offset` on this line began on an EARLIER line, which then
 * owns the offset before the field. The mirror of {@link laterSegmentHolds}.
 */
export function earlierSegmentHolds(
  layout: SemanticLayout,
  line: LineRecord,
  paragraphId: string,
  offset: number,
  pageIndex?: number
): boolean {
  const field = fieldFragmentAt(line, paragraphId, offset, 'start');
  return field !== null && fieldContinues(layout, line, paragraphId, field, -1, pageIndex);
}

/** The continuation line when a soft wrap opens on an inline drawing atom. */
export function laterLineWithDrawingAt(
  layout: SemanticLayout,
  paragraphId: string,
  offset: number
): LineRecord | null {
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    if (line.range.start !== offset) continue;
    if (line.drawings?.some((drawing) => drawing.start === offset)) return line;
  }
  return null;
}

/**
 * True when `offset` sits strictly inside a span that is not a 1:1 model↔paint mapping
 * (projected PAGE digits, leaders) — those interiors are not navigable caret stops.
 * Tabs keep a 1:1 `\t` range; their wide box is still only two stops (before/after).
 */
export function isNonNavigableInterior(
  line: LineRecord,
  offset: number,
  segment?: LineSegment
): boolean {
  for (const span of segment ? segment.spans : line.spans) {
    if (offset <= span.range.start || offset >= span.range.end) continue;
    if (span.projected) return true;
    if (span.text.length !== span.range.end - span.range.start) return true;
  }
  return false;
}

/**
 * Whether an authored break is what ended this line.
 *
 * The break OCCUPIES a model offset and is published as a zero-width span, so a line that a
 * Shift+Enter terminated carries it as its last span. That is the one case where a position
 * shared by two lines is not ambiguous — see `caretAt`.
 *
 * A PAGE break counts for exactly the same reason, and leaving it out was worse than the
 * hard-break case rather than milder: the line it opens is on the NEXT PAGE, so reporting
 * the end of the line the break closed put the caret on a different page from the text that
 * would be typed at it. Click below the last line, type, and the letters appear a page
 * later. A column break already arrives here as `\n` — only `w:type="page"` projects its
 * own character.
 */
export function endsWithLineBreak(line: {
  readonly spans: readonly { readonly text: string }[];
}): boolean {
  const last = line.spans[line.spans.length - 1]?.text;
  return last === '\n' || last === PAGE_BREAK_CHAR;
}

/**
 * Whether the break that ended this line is the model unit just before `offset`, so the line
 * the break opened owns that position.
 *
 * A break inside a projected field result carries the field's whole one-unit range. The
 * lines between two such breaks then start and end at the offset after the field, and a
 * test on the line's own range sees no content to be after. The break's range does.
 */
export function breakEndsLineBefore(line: LineRecord, offset: number): boolean {
  const last = line.spans[line.spans.length - 1];
  if (!last || !endsWithLineBreak(line)) return false;
  return last.range.start < offset && last.range.end === offset;
}

/**
 * Whether this paragraph's slice of the line is ONE inline drawing and nothing else — a
 * picture too wide to share its line, painted as a block in text clothing.
 *
 * That is the other case where the position shared by two lines is not ambiguous, and it is
 * the hard-break case wearing an image: the drawing is what ended the line, so the caret at
 * the offset after it belongs before the text that follows. Painting it at the picture's
 * right edge instead meant a click before that text resolved the right offset but drew the
 * caret a full picture away — the caret looked stuck beside the following words, and there
 * was no click that showed one at the text's start.
 */
export function isDrawingOnlySegment(line: LineRecord, segment: LineSegment): boolean {
  if (segment.end - segment.start !== 1) return false;
  if (!line.drawings?.some((drawing) => drawing.start === segment.start)) return false;
  for (const span of segment.spans) {
    if (span.range.end > span.range.start) return false;
  }
  return true;
}

/**
 * Header-repeat lines of one paragraph on one sheet.
 *
 * The main line index skips `w:tblHeader` repeats so keyboard stops visit each offset once.
 * A click on a later copy still needs geometry on THAT sheet, or the painted caret and
 * scroll-follow jump back to the authored row on page 0.
 */
export function headerRepeatLinesOnPage(
  layout: SemanticLayout,
  pageIndex: number,
  paragraphId: string
): PlacedLine[] {
  const page = layout.pages[pageIndex];
  if (!page) return [];
  const found: PlacedLine[] = [];
  for (const fragment of paragraphFragmentsOf(page, true)) {
    if (fragment.paragraphId !== paragraphId) continue;
    for (const line of fragment.lines)
      found.push({ line, pageIndex, ...(fragment.clipToBox ? { clipBox: fragment.box } : {}) });
  }
  return found;
}
