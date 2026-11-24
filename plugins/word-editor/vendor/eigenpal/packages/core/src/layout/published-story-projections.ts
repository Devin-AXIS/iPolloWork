// The published header and footer stories of page-field finalize, and the projectors kept
// beside them: what lets a reused sheet re-project when the pagination moves, and what lets an
// edit leave the headers and footers away from the screen for later (`withFurnitureLater`).

import { carryFurnitureReadCaches } from './furniture-read-caches.ts';
import type { FieldPageContext } from './field-page-furniture.ts';
import type { HeaderFooterStoryRecord, PageRecord, SemanticLayout } from './semantic-records.ts';

/** Story projector retained past finalize, with the context its published text was projected under. */
export interface RetainedStoryProjection {
  readonly context: FieldPageContext;
  readonly projector: (context: FieldPageContext) => HeaderFooterStoryRecord;
  /**
   * Cumulative sheet-stack Y offset between where the projector places the story and where
   * the published record sits. A NUMBER, not a composed closure: a sheet that survives many
   * tail shifts folds each shift into this one value, so re-projection stays one projector
   * call plus one translation however long the reuse lineage gets.
   */
  readonly dy: number;
}

/**
 * Projectors of PUBLISHED story records, keyed on the stripped record finalize minted.
 *
 * Finalize strips `pageFieldProjector` from what it publishes, but incremental layout reuses
 * published sheets whole: a later pass that changes the page count hands those stripped
 * records straight back to finalize, which then has nothing to re-project NUMPAGES through —
 * the reused footer kept the old `of Y` text. Retaining the projector on the side (with the
 * context it last ran under) lets finalize keep an unchanged-context story by identity and
 * re-project it when the pagination moved underneath it. Weak on the story record, so a story
 * that falls out of the layout takes its projector with it. The projector holds only its
 * story's placement (`section-page-furniture.ts`), not the pass that placed the sheet.
 *
 * INVARIANT: anything that CLONES a published field-bearing story record must carry this
 * entry onto the clone ({@link carryStrippedPageFieldProjection}) — a published story leaves
 * no data trace of its field needs, so an orphaned clone silently keeps stale text.
 * `remapPage` is the one cloner today.
 */
export const strippedStoryProjections = new WeakMap<
  HeaderFooterStoryRecord,
  RetainedStoryProjection
>();

/**
 * True when two projection contexts substitute identical values for every page field.
 *
 * Compares EVERY dimension of {@link FieldPageContext}, so it must grow in lockstep with
 * that interface: a context field this misses compares as "same context" and finalize keeps
 * a reused story's stale text. Needs-blind on purpose — finalize does not know which fields
 * a published story reads, so it re-projects on any moved dimension; the story layout's own
 * per-token cache absorbs the re-layout when the story's text did not actually change.
 */
export function sameFieldPageContext(a: FieldPageContext, b: FieldPageContext): boolean {
  return (
    a.pageNumber === b.pageNumber &&
    a.pageCount === b.pageCount &&
    (a.sectionPageCount ?? a.pageCount) === (b.sectionPageCount ?? b.pageCount) &&
    a.format === b.format &&
    (a.sheetNumber ?? a.pageNumber) === (b.sheetNumber ?? b.pageNumber)
  );
}

/**
 * Pages whose already-published header and footer may keep their text for now, set while an
 * edit lays out; see {@link withFurnitureLater}.
 */
let furnitureLater: ((pageIndex: number) => boolean) | null = null;

/** Whether the header and footer of page `pageIndex` may keep their text for now. */
export function furnitureWaits(pageIndex: number): boolean {
  return furnitureLater?.(pageIndex) === true;
}

/**
 * Run `layout` letting a published header or footer on a page `later` names keep the text it
 * was projected under, instead of projecting it again for a new page count or page number.
 * Adding a page to a long document whose footer shows the page count otherwise lays out every
 * footer of the document inside the keystroke. The host projects them afterwards with
 * {@link completeFurniture}; until then a page off the screen can show its previous numbers.
 * A story that has never been projected is always projected.
 */
export function withFurnitureLater<T>(later: (pageIndex: number) => boolean, layout: () => T): T {
  const outer = furnitureLater;
  furnitureLater = later;
  try {
    return layout();
  } finally {
    furnitureLater = outer;
  }
}

/**
 * The story projected for a stale one, once {@link completeFurniture} has projected it: a later
 * finalize that meets the stale record again (a reused page, a session's previous layout)
 * takes this instead of projecting a second time.
 */
export const completedStories = new WeakMap<HeaderFooterStoryRecord, HeaderFooterStoryRecord>();

/** A context no page has: a story published under it reads as stale until completed. */
const NO_PAGE_CONTEXT: FieldPageContext = { pageNumber: -1, pageCount: -1, sheetNumber: -1 };

/** The live story each deferred one was published for, so completing it serves the live one too. */
const deferredFrom = new WeakMap<HeaderFooterStoryRecord, HeaderFooterStoryRecord>();

/**
 * A story never projected for this page count, published for now as its pass laid it out (its
 * section's own page numbers), without its projector and stale until completed.
 */
export function deferLiveStory(
  story: HeaderFooterStoryRecord,
  projector: (context: FieldPageContext) => HeaderFooterStoryRecord
): HeaderFooterStoryRecord {
  const { pageFieldProjector: _drop, ...kept } = story;
  void _drop;
  strippedStoryProjections.set(kept, { context: NO_PAGE_CONTEXT, projector, dy: 0 });
  deferredFrom.set(kept, story);
  return kept;
}

/** The page-field context finalize projects `page` under, among `pageCount` pages. */
export function pageFieldContextOf(page: PageRecord, pageCount: number): FieldPageContext {
  const source = page.pageFieldSource;
  return {
    pageNumber: source?.pageNumber ?? page.index + 1,
    pageCount,
    sectionPageCount: source?.sectionPageCount ?? pageCount,
    ...(source?.format ? { format: source.format } : {}),
    sheetNumber: page.index + 1,
  };
}

/** Whether a published story was projected under another context than `context`. */
export function storyStale(
  story: HeaderFooterStoryRecord | undefined,
  context: FieldPageContext
): boolean {
  const retained = story && strippedStoryProjections.get(story);
  return !!retained && !sameFieldPageContext(retained.context, context);
}

/** Whether `page`, one of `pageCount`, shows a header or footer projected for another context. */
export function pageFurnitureStale(page: PageRecord, pageCount: number): boolean {
  const context = pageFieldContextOf(page, pageCount);
  return storyStale(page.header, context) || storyStale(page.footer, context);
}

/**
 * A finalized page of an earlier pass, for reuse by identity: undefined when an edit left its
 * header or footer with the numbers of another page count (see {@link withFurnitureLater}).
 */
export function currentFinal(pages: readonly PageRecord[], index: number): PageRecord | undefined {
  const page = pages[index];
  return page && !pageFurnitureStale(page, pages.length) ? page : undefined;
}

/** `story` projected again under `context`, through the projector retained for it. */
function reprojectStory(
  story: HeaderFooterStoryRecord,
  context: FieldPageContext
): HeaderFooterStoryRecord {
  const done = completedStories.get(story);
  if (done && !storyStale(done, context)) return done;
  const retained = strippedStoryProjections.get(story)!;
  const { pageFieldProjector: _drop, box, ...rest } = retained.projector(context);
  void _drop;
  const placed: HeaderFooterStoryRecord = {
    ...rest,
    box: retained.dy === 0 ? box : { ...box, y: box.y + retained.dy },
  };
  strippedStoryProjections.set(placed, { ...retained, context });
  completedStories.set(story, placed);
  const live = deferredFrom.get(story);
  if (live) completedStories.set(live, placed);
  return placed;
}

/**
 * `layout` with the headers and footers {@link withFurnitureLater} left stale on pages
 * `[from, to)` projected; `layout` itself when none is.
 */
export function completeFurniture(layout: SemanticLayout, from = 0, to = Infinity): SemanticLayout {
  const pageCount = layout.pages.length;
  let pages: PageRecord[] | null = null;
  for (let index = from; index < Math.min(to, pageCount); index += 1) {
    const page = layout.pages[index]!;
    const context = pageFieldContextOf(page, pageCount);
    const header = storyStale(page.header, context)
      ? reprojectStory(page.header!, context)
      : page.header;
    const footer = storyStale(page.footer, context)
      ? reprojectStory(page.footer!, context)
      : page.footer;
    if (header === page.header && footer === page.footer) continue;
    pages ??= [...layout.pages];
    pages[index] = {
      ...page,
      ...(header !== undefined ? { header } : {}),
      ...(footer !== undefined ? { footer } : {}),
    };
  }
  if (!pages) return layout;
  const completed = { ...layout, pages };
  carryFurnitureReadCaches(layout, completed);
  return completed;
}
