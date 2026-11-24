// The per-paragraph line index and the deleted-range projection derived from it.
//
// Extracted from semantic-interaction.ts, which owns the caret stops, hit regions and
// navigation built ON these: everything here is a pure read of one immutable layout,
// memoized per revision, with no knowledge of stops or selections.

import { lineSegments } from './line-segments.ts';
import { paragraphFragmentsOnPage } from './story-fragments.ts';
import type { LayoutBox, LineRecord, PageRecord, SemanticLayout } from './semantic-records.ts';
import { lineAtPosition, paragraphFragmentsOf } from './semantic-records.ts';
import type { SemanticPosition } from './semantic-interaction.ts';

/**
 * Lines grouped by the paragraph they render, with the page each sits on.
 *
 * Memoized PER LAYOUT — a published layout is immutable, so the grouping is computed once
 * per revision instead of once per read. The reads this serves — caret geometry, span
 * lookup for a selection, text reconstruction — are all "the lines of ONE paragraph", and
 * answering them by scanning every line of every page made each one O(document); the
 * toolbar asks after every commit, so the scans multiplied per keystroke.
 */
export interface PlacedLine {
  readonly line: LineRecord;
  readonly pageIndex: number;
  readonly clipBox?: LayoutBox;
}

const paragraphLinesCache = new WeakMap<SemanticLayout, Map<string, PlacedLine[]>>();

/**
 * One page's share of that index, remembered on the PAGE record.
 *
 * The composed map still has to be rebuilt per revision — a paragraph can move from one page
 * to the next — but the walk that produces it does not: incremental layout hands an untouched
 * page back as the same object, so typing re-walks the lines of one page rather than every
 * page in the document.
 */
const pageLinesCache = new WeakMap<PageRecord, ReadonlyMap<string, readonly PlacedLine[]>>();

export function paragraphLinesIndex(layout: SemanticLayout): Map<string, PlacedLine[]> {
  const cached = paragraphLinesCache.get(layout);
  if (cached) return cached;
  const index = new Map<string, PlacedLine[]>();
  for (const page of layout.pages) {
    pageTraversals += 1;
    for (const [paragraphId, placed] of pageLines(page)) {
      const entry = index.get(paragraphId);
      if (entry) entry.push(...placed);
      else index.set(paragraphId, [...placed]);
    }
  }
  // Answers already handed out stay the answers: a reader never sees two arrays for one
  // paragraph of one layout. They hold exactly the lines the index just collected.
  const requested = requestedParagraphLines.get(layout);
  if (requested) {
    for (const [paragraphId, placed] of requested) {
      if (placed.length > 0) index.set(paragraphId, placed as PlacedLine[]);
    }
    requestedParagraphLines.delete(layout);
  }
  paragraphLinesCache.set(layout, index);
  return index;
}

const requestedParagraphLines = new WeakMap<SemanticLayout, Map<string, readonly PlacedLine[]>>();

// Page membership can survive a width-only table update while line geometry changes.
// Retain only page numbers, never line or page records from the previous layout.
const paragraphPageRoutes = new WeakMap<SemanticLayout, Map<string, ReadonlySet<number>>>();

/** @internal Caller proves every paragraph keeps its page membership. */
export function carryParagraphPageRoutes(previous: SemanticLayout, next: SemanticLayout): void {
  if (previous === next || previous.pages.length !== next.pages.length) return;
  let routes = paragraphPageRoutes.get(previous);
  if (!routes) paragraphPageRoutes.set(previous, (routes = new Map()));
  // Wrappers can publish before their consumers read lines. Share bounded scalar routes
  // so those later reads also reach the session that supplies the next width-only update.
  paragraphPageRoutes.set(next, routes);
}

/**
 * Distinct paragraphs one layout answers by page scan before it builds the complete index.
 *
 * A single read visits every page, which beats building the whole index for the handful of
 * paragraphs a keystroke asks about. A range operation asks about every paragraph it spans,
 * and per-paragraph scans would cost paragraphs × pages; past this many the index wins.
 */
const LAZY_PARAGRAPH_READS = 32;

let pageTraversals = 0;

/** @internal Pages visited by paragraph line reads so far, for bounded-work tests. */
export function paragraphLinesPageTraversals(): number {
  return pageTraversals;
}

function rememberParagraphRoute(
  layout: SemanticLayout,
  paragraphId: string,
  lines: readonly PlacedLine[]
): readonly PlacedLine[] {
  if (!lines.length) return lines;
  let routes = paragraphPageRoutes.get(layout);
  if (!routes) paragraphPageRoutes.set(layout, (routes = new Map()));
  if (!routes.has(paragraphId)) {
    if (routes.size >= LAZY_PARAGRAPH_READS) routes.delete(routes.keys().next().value!);
    routes.set(paragraphId, new Set(lines.map((entry) => entry.pageIndex)));
  }
  return lines;
}

/** Read one paragraph without copying every page index into a document-wide map. */
export function paragraphLinesFor(
  layout: SemanticLayout,
  paragraphId: string
): readonly PlacedLine[] {
  const complete = paragraphLinesCache.get(layout);
  if (complete) return rememberParagraphRoute(layout, paragraphId, complete.get(paragraphId) ?? []);
  let requested = requestedParagraphLines.get(layout);
  if (!requested) requestedParagraphLines.set(layout, (requested = new Map()));
  const known = requested.get(paragraphId);
  if (known) return rememberParagraphRoute(layout, paragraphId, known);
  if (requested.size >= LAZY_PARAGRAPH_READS) {
    return rememberParagraphRoute(
      layout,
      paragraphId,
      paragraphLinesIndex(layout).get(paragraphId) ?? []
    );
  }
  const result: PlacedLine[] = [];
  const route = paragraphPageRoutes.get(layout)?.get(paragraphId);
  for (const page of layout.pages) {
    if (route && !route.has(page.index)) continue;
    pageTraversals += 1;
    const placed = pageLinesFor(page, paragraphId);
    if (placed) for (const line of placed) result.push(line);
  }
  requested.set(paragraphId, result);
  return rememberParagraphRoute(layout, paragraphId, result);
}

const requestedPageLines = new WeakMap<
  PageRecord,
  Map<string, readonly PlacedLine[] | undefined>
>();

/** @internal `to` draws the same lines on the same page as `from`; only marker labels moved. */
export function carryPageLines(from: PageRecord, to: PageRecord): void {
  const complete = pageLinesCache.get(from);
  if (complete) pageLinesCache.set(to, complete);
  const requested = requestedPageLines.get(from);
  if (requested) requestedPageLines.set(to, new Map(requested));
  const named = namedParagraphsCache.get(from);
  if (named) namedParagraphsCache.set(to, named);
}

/**
 * Every paragraph id a line on the page names, through its range, a span, or a drawing.
 *
 * A superset of the paragraphs the page draws. A read for a paragraph the page never names,
 * such as the one Enter just created, then skips the page in one lookup. Without it, each new
 * paragraph walked every line of every page before the caret could be placed.
 */
const namedParagraphsCache = new WeakMap<PageRecord, ReadonlySet<string>>();

/** @internal Caller proves that every line names the same paragraphs on this page. */
export function carryPageParagraphNames(from: PageRecord, to: PageRecord): void {
  const named = namedParagraphsCache.get(from);
  if (named) namedParagraphsCache.set(to, named);
}

function pageNamedParagraphs(page: PageRecord): ReadonlySet<string> {
  const cached = namedParagraphsCache.get(page);
  if (cached) return cached;
  const named = new Set<string>();
  for (const fragment of paragraphFragmentsOnPage(page)) {
    for (const line of fragment.lines) {
      named.add(line.range.paragraphId);
      for (const span of line.spans) named.add(span.range.paragraphId);
      for (const drawing of line.drawings ?? []) named.add(drawing.paragraphId);
    }
  }
  namedParagraphsCache.set(page, named);
  return named;
}

/** A caret read must not allocate entries for every other paragraph on a changed page. */
function pageLinesFor(page: PageRecord, paragraphId: string): readonly PlacedLine[] | undefined {
  const complete = pageLinesCache.get(page);
  if (complete) return complete.get(paragraphId);
  let requested = requestedPageLines.get(page);
  if (requested?.has(paragraphId)) return requested.get(paragraphId);
  if (requested && requested.size >= LAZY_PARAGRAPH_READS) return pageLines(page).get(paragraphId);
  let found: PlacedLine[] | undefined;
  if (!pageNamedParagraphs(page).has(paragraphId)) {
    if (!requested) requestedPageLines.set(page, (requested = new Map()));
    requested.set(paragraphId, found);
    return found;
  }
  for (const fragment of paragraphFragmentsOnPage(page)) {
    for (const line of fragment.lines) {
      // Merged paragraphs can draw a member whose id differs from the fragment and line.
      // Inspect ownership without building segment arrays for unrelated ordinary lines.
      if (
        line.range.paragraphId !== paragraphId &&
        !line.spans.some((span) => span.range.paragraphId === paragraphId) &&
        !line.drawings?.some((drawing) => drawing.paragraphId === paragraphId)
      )
        continue;
      if (!lineSegments(line).some((segment) => segment.paragraphId === paragraphId)) continue;
      (found ??= []).push({
        line,
        pageIndex: page.index,
        ...(fragment.clipToBox ? { clipBox: fragment.box } : {}),
      });
    }
  }
  if (!requested) requestedPageLines.set(page, (requested = new Map()));
  requested.set(paragraphId, found);
  return found;
}

function pageLines(page: PageRecord): ReadonlyMap<string, readonly PlacedLine[]> {
  const cached = pageLinesCache.get(page);
  if (cached) return cached;
  const index = new Map<string, PlacedLine[]>();
  /**
   * Under every paragraph the line carries, not just the one it names.
   *
   * A merged line belongs to two paragraphs, and a caret walking either of them has to find
   * it. An ordinary line has one segment and lands in exactly the one bucket it always did.
   */
  const indexLine = (line: LineRecord, pageIndex: number, clipBox?: LayoutBox): void => {
    for (const segment of lineSegments(line)) {
      const placed = { line, pageIndex, ...(clipBox ? { clipBox } : {}) };
      const entry = index.get(segment.paragraphId);
      if (entry) entry.push(placed);
      else index.set(segment.paragraphId, [placed]);
    }
  };
  const indexFragments = (
    fragments: readonly import('./semantic-records.ts').BlockFragmentRecord[],
    pageIndex: number
  ): void => {
    const visit = (
      blocks: readonly import('./semantic-records.ts').BlockFragmentRecord[]
    ): void => {
      for (const block of blocks) {
        if (block.kind === 'paragraph') {
          for (const line of block.lines)
            indexLine(line, pageIndex, block.clipToBox ? block.box : undefined);
          continue;
        }
        for (const row of block.rows) {
          if (row.isHeaderRepeat) continue;
          for (const cell of row.cells) visit(cell.blocks);
        }
      }
    };
    visit(fragments);
  };
  // Body first — primary story for caret stops built elsewhere via paragraphFragmentsOf.
  for (const fragment of paragraphFragmentsOf(page)) {
    for (const line of fragment.lines)
      indexLine(line, page.index, fragment.clipToBox ? fragment.box : undefined);
  }
  // Furniture paragraphs share this index so formatting / paragraphTextFromLayout can
  // resolve an open header/footer selection. documentOrder and caretStops stay body-only.
  if (page.header) indexFragments(page.header.fragments, page.index);
  if (page.footer) indexFragments(page.footer.fragments, page.index);
  // Note stories (footnotes/endnotes) — same formatting lane as furniture; not body order.
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    for (const note of area.notes) indexFragments(note.fragments, page.index);
  }
  requestedPageLines.delete(page);
  pageLinesCache.set(page, index);
  return index;
}

/**
 * The line a position sits on, asked of the paragraph's OWN lines first.
 *
 * `lineAtPosition` walks every line of every page, building that list as it goes. The reads
 * that ask it — "is a drawing selected?" among them — run once per published snapshot, so on
 * a long document each one allocated and walked the whole document's lines to answer a
 * question about one paragraph.
 *
 * The full walk is still the fallback, never dropped: a line can carry a paragraph through an
 * inline drawing alone, which has no segment for the index to file it under.
 */
export function lineAtIndexedPosition(
  layout: SemanticLayout,
  paragraphId: string,
  offset: number
): LineRecord | null {
  const placed = paragraphLinesFor(layout, paragraphId);
  if (placed && placed.length > 0) {
    const hit = lineAtPosition(
      layout,
      paragraphId,
      offset,
      placed.map((entry) => entry.line)
    );
    if (hit) return hit;
  }
  return lineAtPosition(layout, paragraphId, offset);
}

/**
 * A paragraph's deleted model ranges, coalesced across every line that carries them.
 *
 * `LineRecord.deletedRanges` is CLIPPED to each line, so a deletion that wraps publishes one
 * slice per line and every wrap boundary looks like a range edge. Merging adjacent and
 * overlapping slices restores the deletion's true extent, so an insertion aimed inside the
 * region relocates past ALL of it rather than to the nearest wrap boundary.
 *
 * Memoized per layout: a published layout is immutable, and the stop builder asks once per
 * line of the paragraph.
 */
const paragraphDeletedRangesCache = new WeakMap<
  SemanticLayout,
  Map<string, readonly { start: number; end: number }[]>
>();

export function paragraphDeletedRanges(
  layout: SemanticLayout,
  paragraphId: string
): readonly { start: number; end: number }[] {
  let byParagraph = paragraphDeletedRangesCache.get(layout);
  if (!byParagraph) {
    byParagraph = new Map();
    paragraphDeletedRangesCache.set(layout, byParagraph);
  }
  const cached = byParagraph.get(paragraphId);
  if (cached) return cached;
  const collected: { start: number; end: number }[] = [];
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    // A merged line indexes under both members but expresses `deletedRanges` in the offsets
    // of the paragraph it NAMES (merged-paragraph-ranges.ts); the other member's are dropped.
    if (line.range.paragraphId !== paragraphId) continue;
    for (const range of line.deletedRanges ?? []) {
      collected.push({ start: range.start, end: range.end });
    }
  }
  collected.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of collected) {
    const last = merged[merged.length - 1];
    // `<=` merges the wrap slices AND identical copies — a shared header/footer part paints
    // its lines once per page, so the same slice arrives once per sheet.
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  byParagraph.set(paragraphId, merged);
  return merged;
}

/**
 * True when this offset sits strictly INSIDE deleted content.
 *
 * The boundaries are kept: the position immediately before a deletion and the one immediately
 * after it are both real places to put a caret, and dropping them would make the deletion
 * unreachable — including for the accept or reject that resolves it.
 */
export function insideDeletedContent(
  ranges: readonly { start: number; end: number }[],
  offset: number
): boolean {
  for (const range of ranges) {
    if (offset > range.start && offset < range.end) return true;
  }
  return false;
}

/**
 * Where an INSERT aimed at this position actually lands: past any deletion it sits inside.
 *
 * The caret may rest anywhere in struck text — Word's rule, and the tracked lane's
 * (`tree-op-tracked.ts`): all-markup shows the words, so the reader can put the caret
 * between two of them. What may NOT happen is new content landing inside the `w:del`,
 * where it would serialize as `w:t` under a wrapper that requires `w:delText` and be taken
 * down by an accept of someone else's deletion. A deletion stays contiguous, so the words
 * go after it — the order a replacement reads in.
 *
 * RANGE endpoints are not this function's business: a drag may legitimately cover deleted
 * text, so callers adjust only collapsed insertion points.
 */
export function positionPastDeletion(
  layout: SemanticLayout,
  position: SemanticPosition
): SemanticPosition {
  for (const range of paragraphDeletedRanges(layout, position.paragraphId)) {
    if (position.offset > range.start && position.offset < range.end) {
      return { paragraphId: position.paragraphId, offset: range.end };
    }
  }
  return position;
}
