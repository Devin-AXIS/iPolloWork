import { fragmentParagraphs } from '../layout/line-segments.ts';
import { tableFormattingMembers } from '../layout/table-fragment-facts.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../layout/semantic-records.ts';

// Formatting reads, per paragraph, from the first fragment that draws it.
//
// A layout answers a paragraph from the pages before its frontier: the pages some read has
// loaded so far, in order. Every paragraph sees every loaded page, as if the whole index of
// those pages were built, so a read of a late paragraph can expose an earlier paragraph's
// empty style on the pages it loaded. A read builds no entry for any other paragraph: each
// requested paragraph catches up to the frontier on its own, and a page answers one paragraph
// by walking only the fragments and tables that can draw it. Past `SPARSE_READS` distinct
// paragraphs, a layout or a page builds the complete index, keeping every answer it gave.

interface Entry {
  readonly fragment: ParagraphFragmentRecord;
  readonly indent: {
    readonly indent: ParagraphFragmentRecord['indent'];
    readonly inTable: boolean;
  };
  readonly emptyStyle: ParagraphFragmentRecord['emptyParagraphStyle'];
}

/** Distinct paragraphs a layout or a page answers one by one before it indexes them all. */
const SPARSE_READS = 32;

interface PageIndex {
  /** The page's stories in reading order, read from the page once: body, header, footer, notes. */
  readonly stories: readonly (readonly BlockFragmentRecord[])[];
  /** The page's entry per paragraph read so far, or null when the page draws none. */
  readonly sparse: Map<string, Entry | null>;
  complete: ReadonlyMap<string, Entry> | null;
}

interface LayoutIndex {
  /** Pages `0..frontier - 1` are loaded. */
  frontier: number;
  readonly entries: Map<string, Entry>;
  /** Per requested paragraph, the first page not yet merged; null once complete. */
  progress: Map<string, number> | null;
}

const byPage = new WeakMap<PageRecord, PageIndex>();
const byLayout = new WeakMap<SemanticLayout, LayoutIndex>();
/**
 * One entry per fragment and context: every paragraph a merged fragment draws shares it. An
 * immutable fragment placed both outside and inside a table needs a different `inTable` in
 * each, so each context has its own cache.
 */
const outsideTables = new WeakMap<ParagraphFragmentRecord, Entry>();
const insideTables = new WeakMap<ParagraphFragmentRecord, Entry>();

let observer: { pageReads: number; completePages: number; completeLayouts: number } | null = null;

/**
 * @internal Counts one-paragraph page reads, pages indexed completely, and layouts promoted to
 * the complete index, for tests that must see the reads stay sparse.
 */
export function formattingIndexTestRecorder(): {
  readonly pageReads: number;
  readonly completePages: number;
  readonly completeLayouts: number;
  dispose(): void;
} {
  const counts = { pageReads: 0, completePages: 0, completeLayouts: 0 };
  observer = counts;
  return {
    get pageReads() {
      return counts.pageReads;
    },
    get completePages() {
      return counts.completePages;
    },
    get completeLayouts() {
      return counts.completeLayouts;
    },
    dispose() {
      if (observer === counts) observer = null;
    },
  };
}

function pageIndex(page: PageRecord): PageIndex {
  const known = byPage.get(page);
  if (known) return known;
  const stories: (readonly BlockFragmentRecord[])[] = [page.fragments];
  if (page.header) stories.push(page.header.fragments);
  if (page.footer) stories.push(page.footer.fragments);
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    for (const note of area.notes) stories.push(note.fragments);
  }
  const index: PageIndex = { stories, sparse: new Map(), complete: null };
  byPage.set(page, index);
  return index;
}

function entryOf(fragment: ParagraphFragmentRecord, inTable: boolean): Entry {
  const entries = inTable ? insideTables : outsideTables;
  let entry = entries.get(fragment);
  if (!entry) {
    entry = {
      fragment,
      indent: { indent: fragment.indent, inTable },
      emptyStyle: fragment.emptyParagraphStyle,
    };
    entries.set(fragment, entry);
  }
  return entry;
}

/** `previous` with the first empty style it lacks: the merge every index level applies. */
function merged(previous: Entry | undefined, next: Entry): Entry {
  if (!previous) return next;
  if (!previous.emptyStyle && next.emptyStyle) return { ...previous, emptyStyle: next.emptyStyle };
  return previous;
}

function mergeEntry(entries: Map<string, Entry>, id: string, next: Entry): void {
  const previous = entries.get(id);
  const result = merged(previous, next);
  if (result !== previous) entries.set(id, result);
}

/** Every paragraph fragment of `stories`, outside repeated header rows, in reading order. */
function eachParagraphFragment(
  stories: readonly (readonly BlockFragmentRecord[])[],
  visit: (fragment: ParagraphFragmentRecord, inTable: boolean) => void
): void {
  const walk = (blocks: readonly BlockFragmentRecord[], inTable: boolean): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        visit(block, inTable);
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat) continue;
        for (const cell of row.cells) walk(cell.blocks, true);
      }
    }
  };
  for (const story of stories) walk(story, false);
}

/** The page's entry for every paragraph it draws. Answers already given stay the answers. */
function completeEntries(index: PageIndex): ReadonlyMap<string, Entry> {
  if (index.complete) return index.complete;
  const entries = new Map<string, Entry>();
  eachParagraphFragment(index.stories, (fragment, inTable) => {
    const entry = entryOf(fragment, inTable);
    for (const id of fragmentParagraphs(fragment)) mergeEntry(entries, id, entry);
  });
  for (const [id, entry] of index.sparse) if (entry) entries.set(id, entry);
  index.sparse.clear();
  index.complete = entries;
  if (observer) observer.completePages += 1;
  return entries;
}

/**
 * True when `fragment` draws paragraph `id`. Its own paragraph always; another one only when a
 * line, span or drawing names it, and then as the line segments decide (`fragmentParagraphs`),
 * because a line range alone may not own a segment.
 */
function draws(fragment: ParagraphFragmentRecord, id: string): boolean {
  if (fragment.paragraphId === id) return true;
  for (const line of fragment.lines ?? []) {
    if (
      line.range.paragraphId === id ||
      line.spans.some((span) => span.range.paragraphId === id) ||
      (line.drawings ?? []).some((drawing) => drawing.paragraphId === id)
    )
      return fragmentParagraphs(fragment).includes(id);
  }
  return false;
}

/**
 * The page's entry for paragraph `id`, as the complete index of the page holds it: the first
 * fragment that draws it, given the first empty style of a later one on the page. Tables that
 * draw no such paragraph are not entered.
 */
function pageEntry(index: PageIndex, id: string): Entry | undefined {
  if (index.complete) return index.complete.get(id);
  const known = index.sparse.get(id);
  if (known !== undefined) return known ?? undefined;
  if (index.sparse.size >= SPARSE_READS) return completeEntries(index).get(id);
  let found: Entry | undefined;
  /** True once the entry has an empty style: no later fragment changes it. */
  const walk = (blocks: readonly BlockFragmentRecord[], inTable: boolean): boolean => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        if (!draws(block, id)) continue;
        found = merged(found, entryOf(block, inTable));
        if (found.emptyStyle) return true;
        continue;
      }
      if (!tableFormattingMembers(block).has(id)) continue;
      for (const row of block.rows) {
        if (row.isHeaderRepeat) continue;
        for (const cell of row.cells) if (walk(cell.blocks, true)) return true;
      }
    }
    return false;
  };
  for (const story of index.stories) if (walk(story, false)) break;
  index.sparse.set(id, found ?? null);
  if (observer) observer.pageReads += 1;
  return found;
}

/** Index every paragraph of the loaded pages, keeping the requested paragraphs' answers. */
function promote(layout: SemanticLayout, state: LayoutIndex, progress: Map<string, number>) {
  for (const [requested, next] of progress) catchUp(layout, state, requested, next);
  for (let at = 0; at < state.frontier; at += 1)
    for (const [id, entry] of completeEntries(pageIndex(layout.pages[at]!)))
      if (!progress.has(id)) mergeEntry(state.entries, id, entry);
  state.progress = null;
  if (observer) observer.completeLayouts += 1;
}

/** Merge pages `next..frontier - 1` into `id`'s entry: what the complete index already holds. */
function catchUp(layout: SemanticLayout, state: LayoutIndex, id: string, next: number): void {
  for (let at = next; at < state.frontier; at += 1) {
    const entry = pageEntry(pageIndex(layout.pages[at]!), id);
    if (entry) mergeEntry(state.entries, id, entry);
  }
}

/** Share one immutable paragraph index across all formatting reads and editable stories. */
export function paragraphFormattingEntry(
  layout: SemanticLayout,
  id: string,
  requireEmptyStyle = false
): Entry | undefined {
  let state = byLayout.get(layout);
  if (!state) {
    state = { frontier: 0, entries: new Map(), progress: new Map() };
    byLayout.set(layout, state);
  }
  const ready = (): Entry | undefined => {
    const entry = state.entries.get(id);
    return entry && (!requireEmptyStyle || entry.emptyStyle) ? entry : undefined;
  };
  const progress = state.progress;
  if (progress && !progress.has(id) && progress.size >= SPARSE_READS)
    promote(layout, state, progress);
  if (state.progress) {
    catchUp(layout, state, id, state.progress.get(id) ?? 0);
    let entry = ready();
    // Load each page at most once, stopping when this read has its answer. A caret read
    // must not build formatting entries for every later page in a long document.
    while (!entry && state.frontier < layout.pages.length) {
      const page = pageEntry(pageIndex(layout.pages[state.frontier++]!), id);
      if (page) mergeEntry(state.entries, id, page);
      entry = ready();
    }
    state.progress.set(id, state.frontier);
    return entry ?? state.entries.get(id);
  }
  let entry = ready();
  while (!entry && state.frontier < layout.pages.length) {
    for (const [other, next] of completeEntries(pageIndex(layout.pages[state.frontier++]!)))
      mergeEntry(state.entries, other, next);
    entry = ready();
  }
  return entry ?? state.entries.get(id);
}
