import { fragmentPageRoute, rememberFragmentPageRoute } from './fragment-page-routes.ts';
// Which paragraph a line's offsets count in.
//
// Two lanes need this and neither may import the other: the interaction lane resolves a
// POSITION and the hit-test lane resolves a POINT, and they already meet through the records.

import type { InlineDrawingRecord } from './drawing-layout.ts';
import { documentOrderIndex } from './document-order.ts';
import { paragraphFragmentsOf } from './semantic-records.ts';
import { paragraphFragmentsOnPage } from './story-fragments.ts';
import type {
  LineRecord,
  ListMarkerRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
} from './semantic-records.ts';
import type { SemanticPosition } from './semantic-interaction.ts';

/**
 * The part of a line that belongs to ONE paragraph.
 *
 * A line normally belongs to one paragraph outright, and then this is the whole of it — the
 * same object every caller read before, so nothing about an ordinary document takes a new
 * path. A resolved display mode merges paragraphs that a tracked decision merges, and the line
 * carrying the join holds spans from two of them. Offsets there are ambiguous by themselves:
 * both paragraphs start at zero, so an offset means nothing without the paragraph it counts in.
 */
export interface LineSegment {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  readonly spans: readonly StyleSpanRecord[];
  readonly drawings: readonly InlineDrawingRecord[];
}

/**
 * Whether a line segment owns the atom at `atomOffset` for `paragraphId` — half-open
 * `[start, end)` with downstream boundary affinity, ONE predicate for every reader that
 * pairs a position with the segment that draws it.
 */
export function segmentOwnsAtomOffset(
  segment: LineSegment,
  paragraphId: string,
  atomOffset: number
): boolean {
  return (
    segment.paragraphId === paragraphId && atomOffset >= segment.start && atomOffset < segment.end
  );
}

/** Cached per line: a mixed line is rare, and asking costs a walk of every span. */
const lineSegmentsCache = new WeakMap<LineRecord, readonly LineSegment[]>();

/** Every paragraph a line carries, in visual order. One entry for an ordinary line. */
export function lineSegments(line: LineRecord): readonly LineSegment[] {
  const cached = lineSegmentsCache.get(line);
  if (cached) return cached;
  // Opaque blocks have geometry without editable model positions.
  if (
    line.spans.length > 0 &&
    line.spans.every(
      (span) =>
        span.unsupported?.element.placement === 'block' &&
        span.unsupported.element.nodeId === line.range.paragraphId
    )
  )
    return [];
  const mixed =
    line.spans.some((span) => span.range.paragraphId !== line.range.paragraphId) ||
    (line.drawings ?? []).some((drawing) => drawing.paragraphId !== line.range.paragraphId);
  const segments = mixed ? splitLineByParagraph(line) : [wholeLineSegment(line)];
  lineSegmentsCache.set(line, segments);
  return segments;
}

/**
 * A line that belongs to one paragraph, as one segment covering what the line draws.
 *
 * A field cut across lines publishes its whole range on every fragment, while the line range
 * starts where the previous line ended. Starting at the earliest drawn span lets selection
 * reach every fragment and caret ownership see it (`laterSegmentHolds`).
 */
function wholeLineSegment(line: LineRecord): LineSegment {
  let start = line.range.start;
  for (const span of line.spans) if (span.range.start < start) start = span.range.start;
  return {
    paragraphId: line.range.paragraphId,
    start,
    end: line.range.end,
    spans: line.spans,
    drawings: line.drawings ?? [],
  };
}

/** Source member order is independent of the physical order used by hit testing. */
export function logicalLineSegments(line: LineRecord): readonly LineSegment[] {
  const segments = lineSegments(line);
  if (segments.length < 2 || !line.spans.some((span) => span.style.shaping)) return segments;
  const remaining = new Map(segments.map((segment) => [segment.paragraphId, segment]));
  const result: LineSegment[] = [];
  // Bidi layout retains span arrays in canonical order. Atom-only lines use the old path.
  for (const span of line.spans) {
    const segment = remaining.get(span.range.paragraphId);
    if (segment) {
      result.push(segment);
      remaining.delete(segment.paragraphId);
    }
  }
  return [...result, ...remaining.values()];
}

function splitLineByParagraph(line: LineRecord): readonly LineSegment[] {
  const visualOwners = [
    ...line.spans.map((span, index) => ({
      paragraphId: span.range.paragraphId,
      x: span.box?.x ?? index,
      order: index * 2 + 1,
    })),
    ...(line.drawings ?? []).map((drawing, index) => ({
      paragraphId: drawing.paragraphId,
      x: drawing.advanceStart ?? drawing.x ?? line.spans.length + index,
      order: index * 2,
    })),
  ].sort((left, right) => left.x - right.x || left.order - right.order);
  const paragraphIds: string[] = [];
  for (const atom of visualOwners) {
    if (!paragraphIds.includes(atom.paragraphId)) paragraphIds.push(atom.paragraphId);
  }
  return paragraphIds.map((paragraphId) => {
    const spans = line.spans.filter((span) => span.range.paragraphId === paragraphId);
    const drawings = (line.drawings ?? []).filter((drawing) => drawing.paragraphId === paragraphId);
    const starts = [
      ...spans.map((span) => span.range.start),
      ...drawings.map((drawing) => drawing.start),
    ];
    const ends = [
      ...spans.map((span) => span.range.end),
      ...drawings.map((drawing) => drawing.start + 1),
    ];
    let start = starts[0]!;
    let end = ends[0]!;
    for (let index = 1; index < starts.length; index += 1) {
      if (starts[index]! < start) start = starts[index]!;
      if (ends[index]! > end) end = ends[index]!;
    }
    return {
      paragraphId,
      start,
      end,
      spans,
      drawings,
    };
  });
}

/** The segment a paragraph owns on this line, or null when it owns none of it. */
export function lineSegmentFor(line: LineRecord, paragraphId: string): LineSegment | null {
  return lineSegments(line).find((segment) => segment.paragraphId === paragraphId) ?? null;
}

/**
 * The part of ONE PARAGRAPH's share of `line` that a selection covers, in that paragraph's
 * offsets, or null when the selection does not reach it.
 *
 * Asked per segment rather than per line. A resolved display mode lays merged paragraphs out
 * on shared lines, and both members count from zero, so a line-wide answer highlighted the
 * wrong characters — or none, when the selection lay entirely in the member the line is not
 * named after.
 */
export function segmentOverlap(
  layout: SemanticLayout,
  segment: LineSegment,
  from: SemanticPosition,
  to: SemanticPosition,
  index: ReadonlyMap<string, number> = documentOrderIndex(layout)
): { start: number; end: number } | null {
  if (from.paragraphId === to.paragraphId) {
    if (segment.paragraphId !== from.paragraphId) return null;
    const start = Math.max(segment.start, from.offset),
      end = Math.min(segment.end, to.offset);
    return end > start ? { start, end } : null;
  }
  const lineParagraph = index.get(segment.paragraphId);
  const fromParagraph = index.get(from.paragraphId);
  const toParagraph = index.get(to.paragraphId);
  if (lineParagraph === undefined || fromParagraph === undefined || toParagraph === undefined)
    return null;
  if (lineParagraph < fromParagraph || lineParagraph > toParagraph) return null;

  const start =
    lineParagraph === fromParagraph ? Math.max(segment.start, from.offset) : segment.start;
  const end = lineParagraph === toParagraph ? Math.min(segment.end, to.offset) : segment.end;
  return end > start ? { start, end } : null;
}

/**
 * The paragraphs drawn BEFORE this one inside the same paragraph box, nearest first.
 *
 * Empty for an ordinary paragraph. A resolved display mode lays a run of paragraphs out as
 * one, and the breaks between them are not breaks the reader can see — so a key that acts on
 * "the boundary before the caret" must know it is standing on one of them.
 */
export function mergedPredecessorsOf(
  layout: SemanticLayout,
  paragraphId: string
): readonly string[] {
  const position = mergedPositions(layout).get(paragraphId);
  return position ? position.members.slice(0, position.at).reverse() : [];
}

/** Where a member first sits after another member of its fragment: members and its index. */
interface MergedPosition {
  readonly members: readonly string[];
  readonly at: number;
}

const EMPTY_MERGED_POSITIONS: ReadonlyMap<string, MergedPosition> = new Map();
const mergedPositionsByPage = new WeakMap<PageRecord, ReadonlyMap<string, MergedPosition>>();
const mergedPositionsByLayout = new WeakMap<SemanticLayout, ReadonlyMap<string, MergedPosition>>();

/**
 * The FIRST fragment, in page and fragment order, that holds each paragraph after position 0.
 *
 * One walk per page record, reused by every layout that keeps the page, and one merge per
 * layout. A position stores the shared member list and an index, not a copied prefix, so a
 * merged run of n paragraphs costs O(n) here however many of its members are asked about.
 */
function mergedPositions(layout: SemanticLayout): ReadonlyMap<string, MergedPosition> {
  const cached = mergedPositionsByLayout.get(layout);
  if (cached) return cached;
  let merged: Map<string, MergedPosition> | undefined;
  for (const page of layout.pages) {
    for (const [paragraphId, position] of mergedPositionsOnPage(page)) {
      merged ??= new Map();
      if (!merged.has(paragraphId)) merged.set(paragraphId, position);
    }
  }
  const result = merged ?? EMPTY_MERGED_POSITIONS;
  mergedPositionsByLayout.set(layout, result);
  return result;
}

function mergedPositionsOnPage(page: PageRecord): ReadonlyMap<string, MergedPosition> {
  const cached = mergedPositionsByPage.get(page);
  if (cached) return cached;
  let found: Map<string, MergedPosition> | undefined;
  for (const fragment of paragraphFragmentsOf(page)) {
    const members = fragmentParagraphs(fragment);
    if (members.length < 2) continue;
    // `indexOf` semantics: a member listed twice answers from its first position only, and a
    // member first listed at position 0 is not after anyone in this fragment.
    const seen = new Set<string>();
    for (let at = 0; at < members.length; at += 1) {
      const paragraphId = members[at]!;
      if (seen.has(paragraphId)) continue;
      seen.add(paragraphId);
      if (at === 0) continue;
      found ??= new Map();
      if (!found.has(paragraphId)) found.set(paragraphId, { members, at });
    }
  }
  const result = found ?? EMPTY_MERGED_POSITIONS;
  mergedPositionsByPage.set(page, result);
  return result;
}

/** Cached per fragment: the answer is a walk of every line, and most callers ask repeatedly. */
const fragmentParagraphsCache = new WeakMap<ParagraphFragmentRecord, readonly string[]>();

/**
 * Every paragraph a fragment DRAWS, in canonical member order.
 *
 * `[fragment.paragraphId]` for an ordinary one, which is what it has always been. A resolved
 * display mode publishes a merged run as one fragment under the SURVIVOR's identity, so the
 * absorbed members have no fragment named after them. Anything keyed on `fragment.paragraphId`
 * alone reports those paragraphs as unlaid — no marker, no anchor, no note reference — while
 * the reader is looking straight at them.
 */
export function fragmentParagraphs(fragment: ParagraphFragmentRecord): readonly string[] {
  const cached = fragmentParagraphsCache.get(fragment);
  if (cached) return cached;
  // Ordinary paragraphs need membership only, not allocated segment geometry.
  if (
    (fragment.lines ?? []).every(
      (line) =>
        line.range.paragraphId === fragment.paragraphId &&
        line.spans.every((span) => span.range.paragraphId === fragment.paragraphId) &&
        (line.drawings ?? []).every((drawing) => drawing.paragraphId === fragment.paragraphId)
    )
  ) {
    const members = [fragment.paragraphId];
    fragmentParagraphsCache.set(fragment, members);
    return members;
  }

  // From the LINES, so the order is the order the reader meets them, and the fragment's own
  // name last if no line named it — an empty paragraph has no span to speak for it.
  const held: string[] = [];
  for (const line of fragment.lines ?? []) {
    for (const segment of logicalLineSegments(line)) {
      if (!held.includes(segment.paragraphId)) held.push(segment.paragraphId);
    }
  }
  if (!held.includes(fragment.paragraphId)) held.push(fragment.paragraphId);
  fragmentParagraphsCache.set(fragment, held);
  return held;
}

/**
 * The extent of ONE paragraph inside a fragment, in that paragraph's own offsets.
 *
 * An ordinary fragment answers from its own `range`, unchanged and without touching a line —
 * the shape every caller has always read. Only a merged fragment pays for the walk.
 */
export function fragmentExtentOf(
  fragment: ParagraphFragmentRecord,
  paragraphId: string
): { readonly start: number; readonly end: number } | null {
  const held = fragmentParagraphs(fragment);
  if (held.length === 1) {
    return held[0] === paragraphId
      ? { start: fragment.range.start, end: fragment.range.end }
      : null;
  }
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const line of fragment.lines ?? []) {
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    start = Math.min(start, segment.start);
    end = Math.max(end, segment.end);
  }
  return end >= start ? { start, end } : null;
}

/**
 * Whether a fragment draws `paragraphId` at `offset`.
 *
 * Half-open — `[start, end)` — so a boundary offset belongs to the later fragment, which is
 * the affinity every fragment-ownership question in the engine already uses.
 */
export function fragmentOwnsPosition(
  fragment: ParagraphFragmentRecord,
  paragraphId: string,
  offset: number
): boolean {
  const extent = fragmentExtentOf(fragment, paragraphId);
  return extent !== null && offset >= extent.start && offset < extent.end;
}

/**
 * The fragment that DRAWS a paragraph, wherever it is nested, or null.
 *
 * The fast path is the old lookup by name and returns on the first hit; the walk of the lines
 * runs only when no fragment claims the id, which is the merged case.
 */
export function fragmentHolding(
  layout: SemanticLayout,
  paragraphId: string
): ParagraphFragmentRecord | null {
  const route = fragmentPageRoute(layout, paragraphId);
  if (route !== undefined) {
    const page = layout.pages.find((candidate) => candidate.index === route);
    if (page) {
      const fragments = paragraphFragmentsOnPage(page);
      const named = fragments.find((fragment) => fragment.paragraphId === paragraphId);
      if (named) return named;
      const drawn = fragments.find((fragment) =>
        fragmentParagraphs(fragment).includes(paragraphId)
      );
      if (drawn) return drawn;
    }
  }
  const index = holdingIndexOf(layout);
  const named = namedFragment(layout, index, paragraphId);
  if (named) {
    rememberFragmentPageRoute(layout, paragraphId, index.pages.get(named)!);
    return named;
  }
  if (!index.drawn) {
    // Built once, on the first read that no fragment claims by name: the merged case.
    const drawn = new Map<string, ParagraphFragmentRecord>();
    for (const page of layout.pages) {
      for (const fragment of paragraphFragmentsOnPage(page)) {
        for (const id of fragmentParagraphs(fragment)) if (!drawn.has(id)) drawn.set(id, fragment);
      }
    }
    index.drawn = drawn;
  }
  const drawn = index.drawn.get(paragraphId);
  if (drawn) rememberFragmentPageRoute(layout, paragraphId, index.pages.get(drawn)!);
  return drawn ?? null;
}

/**
 * Per layout: the fragments {@link fragmentHolding} answers from, so a read over a long
 * selection walks the pages once instead of once per paragraph.
 *
 * `named` keeps the FIRST fragment in page order that carries each name, and fills page by
 * page only as far as a read needs, so a caret read near the top of a long document still
 * loads only the pages before it. `drawn` is the fallback for a name no fragment carries.
 * Layouts are immutable, so identity is the key.
 */
interface HoldingIndex {
  /** Pages `0..loadedPages - 1` are in `named`. */
  loadedPages: number;
  readonly named: Map<string, ParagraphFragmentRecord>;
  readonly pages: WeakMap<ParagraphFragmentRecord, number>;
  drawn: ReadonlyMap<string, ParagraphFragmentRecord> | null;
}

const HOLDING_INDEXES = new WeakMap<SemanticLayout, HoldingIndex>();

function holdingIndexOf(layout: SemanticLayout): HoldingIndex {
  let index = HOLDING_INDEXES.get(layout);
  if (!index) {
    index = { loadedPages: 0, named: new Map(), pages: new WeakMap(), drawn: null };
    HOLDING_INDEXES.set(layout, index);
  }
  return index;
}

function namedFragment(
  layout: SemanticLayout,
  index: HoldingIndex,
  paragraphId: string
): ParagraphFragmentRecord | undefined {
  let found = index.named.get(paragraphId);
  while (!found && index.loadedPages < layout.pages.length) {
    const page = layout.pages[index.loadedPages++]!;
    for (const fragment of paragraphFragmentsOnPage(page)) {
      if (!index.pages.has(fragment)) index.pages.set(fragment, page.index);
      if (!index.named.has(fragment.paragraphId)) index.named.set(fragment.paragraphId, fragment);
    }
    found = index.named.get(paragraphId);
  }
  return found;
}

/**
 * The list marker a paragraph publishes, or null.
 *
 * It is on the fragment {@link fragmentHolding} finds, except when page breaks open the
 * paragraph: layout then publishes it with the first line after them, on a later fragment.
 */
export function markerHolding(
  layout: SemanticLayout,
  paragraphId: string
): ListMarkerRecord | null {
  const first = fragmentHolding(layout, paragraphId);
  if (!first || first.marker) return first?.marker ?? null;
  const opensWithBreak = first.lines.every((line) =>
    line.spans.every((span) => !/[^\f]/.test(span.text))
  );
  if (!opensWithBreak || first.paragraphId !== paragraphId) return null;
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOnPage(page)) {
      if (fragment.paragraphId === paragraphId && fragment.marker) return fragment.marker;
    }
  }
  return null;
}

/** View one merged member in its own offset space for logical line-end rules. */
export function lineForSegment(line: LineRecord, segment: LineSegment | undefined): LineRecord {
  return segment
    ? {
        ...line,
        range: { paragraphId: segment.paragraphId, start: segment.start, end: segment.end },
        spans: segment.spans,
        drawings: segment.drawings,
      }
    : line;
}
