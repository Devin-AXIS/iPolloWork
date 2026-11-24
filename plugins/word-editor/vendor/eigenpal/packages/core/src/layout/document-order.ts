// Paragraph order across the laid-out document.
//
// Paragraphs follow source order, independent of physical bidi positions, taken from the LINES for
// the same reason — a resolved display mode can lay several paragraphs out as one fragment,
// and a paragraph missing from this order compares as before every other one, which would put
// a selection anchored in it at the top of the document.

import { logicalLineSegments } from './line-segments.ts';
import { paragraphFragmentsOf, paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type { BlockFragmentRecord, PageRecord, SemanticLayout } from './semantic-records.ts';
import { weakRefOf, type WeakRefOf } from '../store/package/weak-ref.ts';

// Memoized PER LAYOUT, which is sound because a published layout is immutable: a new revision
// is a new object. Without this every selection walk recomputed the order — and `lineOverlap`
// runs once per line, so `spansInSelection` on a large document recomputed a full-document
// scan thousands of times per keystroke. The toolbar reading formatting on every commit is
// what turned that into seconds.
const documentOrderCache = new WeakMap<SemanticLayout, string[]>();
const documentOrderIndexCache = new WeakMap<SemanticLayout, Map<string, number>>();
const everyStoryOrderCache = new WeakMap<SemanticLayout, string[]>();

/**
 * Paragraph ids on ONE page, in order, remembered on its immutable body fragments.
 *
 * Incremental layout hands an untouched page back as the same object, so a keystroke only
 * ever walks the lines of the page it landed on. The whole-document walk this replaces ran
 * on every commit — the order is rebuilt each revision because the layout object is new —
 * and at several hundred pages that walk cost more than the edit itself.
 */
// Footer completion can replace a page before its first order read. Body ownership
// lets that later read serve the retained page too, without retaining page geometry.
const pageOrderCache = new WeakMap<readonly BlockFragmentRecord[], readonly string[]>();

/** @internal Caller proves both pages name the same paragraphs in the same logical order. */
export function carryPageOrder(from: PageRecord, to: PageRecord): void {
  const order = pageOrderCache.get(from.fragments);
  if (order) pageOrderCache.set(to.fragments, order);
}

function pageOrder(page: PageRecord): readonly string[] {
  const cached = pageOrderCache.get(page.fragments);
  if (cached) return cached;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const fragment of paragraphFragmentsOf(page)) {
    // From the LINES, not the fragment. A merged fragment is named after one paragraph and
    // carries several, and a paragraph missing from this order compares as before every
    // other one — which would put a selection anchored in it at the top of the document.
    for (const line of fragment.lines) {
      for (const segment of logicalLineSegments(line)) {
        if (seen.has(segment.paragraphId)) continue;
        seen.add(segment.paragraphId);
        order.push(segment.paragraphId);
      }
    }
    if (fragment.lines.length === 0 && !seen.has(fragment.paragraphId)) {
      seen.add(fragment.paragraphId);
      order.push(fragment.paragraphId);
    }
  }
  pageOrderCache.set(page.fragments, order);
  return order;
}

/**
 * The last order built, with the page orders it came from. A keystroke publishes a new layout
 * whose pages are the previous objects but the one it landed on, and that page usually lists
 * the same paragraphs; the order, and its index, then stand.
 */
let lastOrder: {
  /** Weakly: the order must not keep a closed document's layout alive. */
  readonly pages: WeakRefOf<readonly PageRecord[]>;
  readonly orders: readonly (readonly string[])[];
  readonly order: string[];
  index?: Map<string, number>;
} | null = null;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** The previous order when `layout`'s pages list the same paragraphs, page by page. */
function carriedOrder(layout: SemanticLayout): string[] | null {
  const last = lastOrder;
  const pages = last?.pages.deref();
  if (!last || !pages || pages.length !== layout.pages.length) return null;
  const orders: (readonly string[])[] = [];
  for (const [index, page] of layout.pages.entries()) {
    if (page === pages[index]) {
      orders.push(last.orders[index]!);
      continue;
    }
    const order = pageOrder(page);
    if (!sameIds(order, last.orders[index]!)) return null;
    orders.push(order);
  }
  lastOrder = { pages: weakRefOf(layout.pages), orders, order: last.order, index: last.index };
  return last.order;
}

/** Paragraph ids in document order, deduplicated across fragments. */
export function documentOrder(layout: SemanticLayout): string[] {
  const cached = documentOrderCache.get(layout);
  if (cached) return cached;
  const carried = carriedOrder(layout);
  if (carried) {
    documentOrderCache.set(layout, carried);
    return carried;
  }
  const seen = new Set<string>();
  const order: string[] = [];
  for (const page of layout.pages) {
    for (const paragraphId of pageOrder(page)) {
      // Deduplicated ACROSS pages as well as within one: a paragraph split by a page break
      // is ordered where it starts.
      if (seen.has(paragraphId)) continue;
      seen.add(paragraphId);
      order.push(paragraphId);
    }
  }
  documentOrderCache.set(layout, order);
  lastOrder = { pages: weakRefOf(layout.pages), orders: layout.pages.map(pageOrder), order };
  return order;
}

/** Document-order position by paragraph id, for O(1) ordering checks. */
export function documentOrderIndex(layout: SemanticLayout): Map<string, number> {
  const cached = documentOrderIndexCache.get(layout);
  if (cached) return cached;
  const order = documentOrder(layout);
  // The same order is the same index; see `lastOrder`.
  let index = lastOrder?.order === order ? lastOrder.index : undefined;
  if (!index) {
    index = new Map<string, number>();
    for (const [position, id] of order.entries()) index.set(id, position);
    if (lastOrder?.order === order) lastOrder.index = index;
  }
  documentOrderIndexCache.set(layout, index);
  return index;
}

/**
 * Paragraph ids of EVERY story the layout paints, in the order they sit on the page.
 *
 * Body, then each page's header and footer, then its note areas — per page, so a story's own
 * paragraphs stay adjacent and in reading order. That is all any caller needs: a selection
 * cannot span two stories (the engine refuses one), so only the order WITHIN a story is ever
 * compared, and this gets that right for all of them at once.
 *
 * What a caller passes when it has no story in hand — `selectionRects` and
 * `spansInSelection` both REQUIRE an order rather than defaulting to one, deliberately.
 * {@link documentOrder} is the body alone, and
 * using it as a default is what let selection reads silently answer about the wrong story —
 * two paragraphs selected in a header both ranked -1, the walk gave up, and the run properties
 * came back short. A caller that DOES know its story should still pass that story's order:
 * it is smaller, and it cannot match a paragraph the caret is not among.
 */
export function everyStoryOrder(layout: SemanticLayout): string[] {
  const cached = everyStoryOrderCache.get(layout);
  if (cached) return cached;
  const seen = new Set<string>();
  const order: string[] = [];
  const take = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const fragment of paragraphFragmentsOfBlocks(blocks)) {
      for (const line of fragment.lines) {
        for (const segment of logicalLineSegments(line)) {
          if (seen.has(segment.paragraphId)) continue;
          seen.add(segment.paragraphId);
          order.push(segment.paragraphId);
        }
      }
      // A paragraph with no lines still has a position; without this it compares as before
      // every other one, which puts a selection anchored in it at the top of its story.
      if (fragment.lines.length === 0 && !seen.has(fragment.paragraphId)) {
        seen.add(fragment.paragraphId);
        order.push(fragment.paragraphId);
      }
    }
  };
  for (const page of layout.pages) {
    // The body first, through the same page-level memo the body-only order uses.
    for (const paragraphId of pageOrder(page)) {
      if (seen.has(paragraphId)) continue;
      seen.add(paragraphId);
      order.push(paragraphId);
    }
    for (const story of [page.header, page.footer]) {
      if (story) take(story.fragments);
    }
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      if (area.separator) take(area.separator.fragments);
      if (area.continuationNotice) take(area.continuationNotice.fragments);
      for (const note of area.notes) take(note.fragments);
    }
  }
  everyStoryOrderCache.set(layout, order);
  return order;
}
