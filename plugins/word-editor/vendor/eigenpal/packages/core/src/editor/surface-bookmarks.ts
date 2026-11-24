// Bookmarks on the paginated surface: list them, add one at the selection, delete one, jump to
// one, and show where they are.
//
// THE NAME IS DOCUMENT-WIDE. A bookmark can live in the body, a header, a footer or a note, and
// one name means one bookmark across all of them. Adding a name that another story already
// declares moves it: the other story's markers are removed and the new pair is written in the
// story the selection is in, in ONE transaction, so the move is one undo step.
//
// THE MARKS ARE FURNITURE. With "Show bookmarks" on, a gray bracket is painted at each visible
// bookmark's start and end, and an I-beam at a point bookmark, in an overlay sheet BESIDE the
// pages. Nothing is added to the editable DOM, so selection mapping, hit testing and the caret
// never see the marks, and they are never part of the document or its export. They print only
// when the host asks (`BookmarkMarkOptions.print`). Hidden bookmarks (names starting with an
// underscore) are not shown unless the host includes them. Marks are painted in the main text,
// headers and footers (on every page that shows them), footnotes and endnotes. The sheet
// takes no pointer events, but a host can turn them on for one mark (a tooltip): a press on a
// mark then never reaches the pages, so it cannot move the caret.

import { caretAt, type CaretGeometry } from '@docx-editor.dev/core/layout';
import type { SurfaceOverlayFrame } from './surface-overlay-sheet.ts';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  bookmarkNameKey,
  bookmarkNameProblem,
  listBookmarks,
  withoutBookmarkInPart,
  type BookmarkNameProblem,
  type OoxmlPackage,
  type BookmarkRecord,
  type OoxmlPart,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type {
  BookmarkPlace,
  BookmarkStory,
  BookmarkSummary,
} from '../contracts/editor-bookmarks.ts';
import type { BookmarkMarkInfo, BookmarkMarkOptions } from './docx-editor-types.ts';
import type { PaginatedSurfaceOptions } from './paginated-surface-options.ts';
import { storyScopeOfPartName, type StoryScopeLookup } from './surface-scope.ts';
import { noteOnPage, storyContentBox } from './surface-story-geometry.ts';

export { storyContentBox };

/** What the bookmark lane reads from and writes through. */
export interface SurfaceBookmarkDeps {
  readonly session: StoryScopeLookup & {
    storyParts(): readonly OoxmlPart[];
    packageRevision(): number;
    paragraphIdsIn(scope?: StoryScope): string[];
    applyTreeOps(
      ops: readonly TreeDocOp[],
      before?: unknown,
      after?: unknown,
      scope?: StoryScope,
      options?: { readonly packageEdits?: readonly ((pkg: OoxmlPackage) => OoxmlPackage)[] }
    ): { readonly committed: boolean; readonly reason?: string };
  };
  readonly storyScope: () => StoryScope;
  readonly orderedRange: () => {
    readonly from: { readonly paragraphId: string; readonly offset: number };
    readonly to: { readonly paragraphId: string; readonly offset: number };
  };
  /** Why a write cannot happen at the selection now, or null. */
  readonly writeRefusal: () => string | null;
  readonly commit: (run: () => boolean, selectionAfter?: () => SemanticSelection | null) => void;
  /** Jump; with `orShow`, a story that cannot be opened is only scrolled to (`'shown'`). */
  readonly goToPosition: (
    position: { paragraphId: string; offset: number },
    options?: { readonly orShow?: boolean; readonly center?: boolean }
  ) => boolean | 'shown';
  readonly setSelection: (selection: SemanticSelection) => void;
  /** Settle pending input and layout before the marks change. */
  readonly beforeChange: () => void;
  readonly repaint: () => void;
  /** `showBookmarks`: whether the marks start shown; `bookmarkMarks`: the host's mark options. */
  readonly options: Pick<PaginatedSurfaceOptions, 'showBookmarks' | 'bookmarkMarks'>;
}

/** One painted mark: which bookmark, which edge, and where. */
export interface BookmarkMark extends BookmarkMarkInfo {
  readonly paragraphId: string;
  readonly offset: number;
  /**
   * The header or footer part of a mark painted on every page that shows that header or
   * footer. Its geometry is relative to that story's box on each page.
   */
  readonly repeats?: string;
}

/** The surface's bookmark lane. */
export interface SurfaceBookmarks {
  /** Every bookmark in the document: body first, then headers, footers and notes. */
  list(): readonly BookmarkSummary[];
  /** Why `insert(name)` would be refused now, or null. */
  insertRefusal(name: string): string | null;
  /** Bookmark the selection under `name`, moving a bookmark that already has it. */
  insert(name: string): boolean;
  /** Remove the bookmark with this name, compared without case, and its copies. */
  remove(name: string): boolean;
  /** Keep the first bookmark with this name and remove its copies, in one transaction. */
  keepFirst(name: string): boolean;
  /** Why a bookmark write cannot happen now, or null. */
  writeRefusal(): string | null;
  /** Select the bookmark's range and scroll it into view. */
  goTo(name: string): boolean;
  /** Whether the marks are shown. */
  shown(): boolean;
  setShown(shown: boolean): void;
  /** Paint the marks for one rendered frame. */
  paint(frame: SurfaceOverlayFrame): void;
}

const PROBLEM_REASONS: Record<BookmarkNameProblem, string> = {
  empty: 'a bookmark needs a name',
  tooLong: 'a bookmark name has at most 40 characters',
  invalidStart: 'a bookmark name starts with a letter',
  invalidCharacter: 'a bookmark name holds only letters, digits and underscores',
};

/** Why a name cannot be written, as a refusal reason, or null. */
export function bookmarkNameRefusal(name: string): string | null {
  const problem = bookmarkNameProblem(name);
  if (problem) return PROBLEM_REASONS[problem];
  // Hidden names are for the application's own bookmarks; a person names a visible one.
  return name.startsWith('_') ? 'a bookmark name starts with a letter' : null;
}

const listCache = new WeakMap<OoxmlPart, readonly BookmarkRecord[]>();

function recordsOf(part: OoxmlPart): readonly BookmarkRecord[] {
  let records = listCache.get(part);
  if (!records) {
    records = listBookmarks(part);
    listCache.set(part, records);
  }
  return records;
}

/** A header or footer part's root says which; notes say their kind in the scope. */
function placeOf(scope: StoryScope, part: OoxmlPart): BookmarkPlace {
  if (scope.kind === 'body') return 'body';
  if (scope.kind === 'notesPart') return scope.noteKind;
  return part.root.localName === 'ftr' ? 'footer' : 'header';
}

function storyOf(scope: StoryScope): BookmarkStory {
  if (scope.kind === 'body') return 'body';
  return scope.kind === 'headerFooter' ? 'headerFooter' : 'note';
}

export function createSurfaceBookmarks(deps: SurfaceBookmarkDeps): SurfaceBookmarks {
  let visible = deps.options.showBookmarks === true;
  // The sheet of the last paint. A destroyed or parked surface has taken it out of the page,
  // and repaints itself in full when it comes back, so new options repaint only a live one.
  let sheet: HTMLElement | null = null;
  deps.options.bookmarkMarks?.onChange(() => {
    if (visible && sheet?.isConnected) deps.repaint();
  });

  type Located = {
    readonly record: BookmarkRecord;
    readonly scope: StoryScope;
    readonly partName: string;
    readonly place: BookmarkPlace;
  };
  // Read once per set of story parts: the dialog and the marks ask on every render. Keyed by
  // the parts themselves, not a revision number, so a collaborator's edit that replaces a part
  // is seen at once.
  let cache: { readonly parts: readonly OoxmlPart[]; readonly entries: readonly Located[] } | null =
    null;
  const located = (): readonly Located[] => {
    const parts = deps.session.storyParts();
    if (
      cache?.parts.length === parts.length &&
      cache.parts.every((part, index) => part === parts[index])
    )
      return cache.entries;
    const entries: Located[] = [];
    for (const part of parts) {
      // From the part, not the node id: a collaborator's marker ids name no part.
      const scope = storyScopeOfPartName(deps.session, part.name, { kind: 'body' });
      const place = placeOf(scope, part);
      for (const record of recordsOf(part)) {
        entries.push({ record, scope, partName: part.name, place });
      }
    }
    cache = { parts, entries };
    return entries;
  };

  const find = (name: string) => {
    const key = bookmarkNameKey(name);
    return located().find((entry) => bookmarkNameKey(entry.record.name) === key) ?? null;
  };

  const write = (
    op: TreeDocOp,
    scope: StoryScope,
    packageEdits: readonly ((pkg: OoxmlPackage) => OoxmlPackage)[] = []
  ): boolean => {
    let committed = false;
    deps.commit(() => {
      committed = deps.session.applyTreeOps([op], undefined, undefined, scope, {
        packageEdits,
      }).committed;
      return committed;
    });
    return committed;
  };

  const insertRefusal = (name: string): string | null =>
    bookmarkNameRefusal(name) ?? deps.writeRefusal();

  /** Whether the selection's start is inside a bookmark of the story the selection is in. */
  const holdsSelection = (): ((record: BookmarkRecord, scope: StoryScope) => boolean) => {
    const at = deps.orderedRange().from;
    const story = JSON.stringify(deps.storyScope());
    let order: Map<string, number> | undefined;
    const indexOf = (paragraphId: string) =>
      (order ??= new Map(
        deps.session.paragraphIdsIn(deps.storyScope()).map((id, index) => [id, index])
      )).get(paragraphId) ?? -1;
    const point = (paragraphId: string, offset: number) =>
      paragraphId === at.paragraphId
        ? [0, offset - at.offset]
        : [indexOf(paragraphId) - indexOf(at.paragraphId), 0];
    return (record, scope) => {
      if (JSON.stringify(scope) !== story) return false;
      const [startParagraph, startOffset] = point(record.start.paragraphId, record.start.offset);
      const [endParagraph, endOffset] = point(record.end.paragraphId, record.end.offset);
      const startsBefore = startParagraph! < 0 || (startParagraph === 0 && startOffset! <= 0);
      const endsAfter = endParagraph! > 0 || (endParagraph === 0 && endOffset! >= 0);
      return startsBefore && endsAfter;
    };
  };

  return {
    list() {
      const holds = holdsSelection();
      // One row per name: the first in document order answers, and counts the copies that
      // concurrent edits left in any story.
      const copies = new Map<string, number>();
      for (const { record } of located()) {
        const key = bookmarkNameKey(record.name);
        copies.set(key, (copies.get(key) ?? 0) + record.copies);
      }
      const seen = new Set<string>();
      const rows: BookmarkSummary[] = [];
      for (const { record, scope, place } of located()) {
        const key = bookmarkNameKey(record.name);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(
          Object.freeze({
            name: record.name,
            hidden: record.hidden,
            story: storyOf(scope),
            place,
            order: rows.length,
            empty:
              record.start.paragraphId === record.end.paragraphId &&
              record.start.offset === record.end.offset,
            atSelection: holds(record, scope),
            duplicates: (copies.get(key) ?? 1) - 1,
          })
        );
      }
      return rows;
    },
    insertRefusal,
    insert(name) {
      if (insertRefusal(name)) return false;
      const scope = deps.storyScope();
      const range = deps.orderedRange();
      const key = bookmarkNameKey(name);
      // One name, one bookmark: the name leaves every other story in the same transaction,
      // so the move is one undo step and a refused insert takes nothing away.
      const elsewhere = new Set(
        located()
          .filter(
            (entry) =>
              bookmarkNameKey(entry.record.name) === key &&
              JSON.stringify(entry.scope) !== JSON.stringify(scope)
          )
          .map((entry) => entry.partName)
      );
      return write(
        {
          op: 'insertBookmark',
          name,
          start: { paragraphId: range.from.paragraphId, offset: range.from.offset },
          end: { paragraphId: range.to.paragraphId, offset: range.to.offset },
        },
        scope,
        [...elsewhere].map((partName) => (pkg) => withoutBookmarkInPart(pkg, partName, name))
      );
    },
    remove(name) {
      const entry = find(name);
      if (!entry || deps.writeRefusal() !== null) return false;
      // Copies a merge left in other stories go in the same transaction.
      const key = bookmarkNameKey(name);
      const elsewhere = new Set(
        located()
          .filter(
            (other) =>
              bookmarkNameKey(other.record.name) === key && other.partName !== entry.partName
          )
          .map((other) => other.partName)
      );
      return write(
        { op: 'deleteBookmark', name },
        entry.scope,
        [...elsewhere].map((partName) => (pkg) => withoutBookmarkInPart(pkg, partName, name))
      );
    },
    keepFirst(name) {
      const first = find(name);
      if (!first || deps.writeRefusal() !== null) return false;
      const key = bookmarkNameKey(name);
      const elsewhere = new Set(
        located()
          .filter(
            (other) =>
              bookmarkNameKey(other.record.name) === key && other.partName !== first.partName
          )
          .map((other) => other.partName)
      );
      const edits = [...elsewhere].map(
        (partName) => (pkg: OoxmlPackage) => withoutBookmarkInPart(pkg, partName, name)
      );
      // Copies in the first's own part go by op, which keeps the first pair's nodes, so two
      // collaborators who both do this remove the same nodes and converge on one bookmark.
      if (first.record.copies > 1)
        return write({ op: 'deleteBookmark', name, keepFirst: true }, first.scope, edits);
      if (edits.length === 0) return false;
      let committed = false;
      deps.commit(() => {
        committed = deps.session.applyTreeOps([], undefined, undefined, first.scope, {
          packageEdits: edits,
        }).committed;
        return committed;
      });
      return committed;
    },
    writeRefusal: () => deps.writeRefusal(),
    goTo(name) {
      const entry = find(name);
      if (!entry) return false;
      const { start, end } = entry.record;
      // A header, footer or note the document cannot open (read-only) is shown, not entered.
      // Centered, as a Find result is: a jump to the top edge lands under the chrome there.
      const went = deps.goToPosition(start, { orShow: true, center: true });
      if (!went) return false;
      if (went === true) deps.setSelection({ anchor: start, head: end });
      return true;
    },
    shown: () => visible,
    setShown(next) {
      if (next === visible) return;
      deps.beforeChange();
      visible = next;
      deps.repaint();
    },
    paint(frame) {
      sheet = frame.layer;
      if (!visible) {
        frame.layer.replaceChildren();
        return;
      }
      const options = deps.options.bookmarkMarks?.current() ?? {};
      frame.layer.classList.toggle('docx-bookmark-overlay--print', options.print === true);
      const include = options.include ?? 'visible';
      const marks: BookmarkMark[] = [];
      const seen = new Set<string>();
      for (const { record, scope, partName } of located()) {
        // Only the bookmark a name means: copies a merge left are not shown.
        const key = bookmarkNameKey(record.name);
        if (seen.has(key)) continue;
        seen.add(key);
        const info = { name: record.name, hidden: record.hidden, story: storyOf(scope) };
        if (include === 'visible' ? record.hidden : include !== 'all' && !include(info)) continue;
        const point =
          record.start.paragraphId === record.end.paragraphId &&
          record.start.offset === record.end.offset;
        const repeats = scope.kind === 'headerFooter' ? partName : undefined;
        if (point) {
          marks.push({ ...info, edge: 'point', ...record.start, repeats });
          continue;
        }
        marks.push(
          { ...info, edge: 'start', ...record.start, repeats },
          { ...info, edge: 'end', ...record.end, repeats }
        );
      }
      paintBookmarkMarks(frame, marks, options.decorate, deps.options.bookmarkMarks?.reportError);
    },
  };
}

/** Caret geometry per layout: one layout object per revision, released with it. */
const placementCache = new WeakMap<object, Map<string, CaretGeometry | null>>();

const guardedSheets = new WeakSet<HTMLElement>();

/**
 * Keep a press on a mark from reaching the pages. Marks ignore the pointer unless a host turns
 * it on for a tooltip; then a mousedown must not move the caret or the selection. A host form
 * control placed in a mark keeps its default.
 */
function guardSheetPresses(sheet: HTMLElement): void {
  if (guardedSheets.has(sheet)) return;
  guardedSheets.add(sheet);
  sheet.addEventListener('mousedown', (event) => {
    const target = event.target as { readonly localName?: string } | null;
    const name = target?.localName;
    if (name === 'input' || name === 'select' || name === 'textarea') return;
    event.preventDefault();
  });
}

/**
 * Paint bracket marks over the pages. Geometry comes from layout, the same `caretAt` the caret
 * uses, so a mark sits exactly where a caret at that position would. The mark's height is the
 * line's; its width and stroke come from the stylesheet (`--doc-bookmark-mark-*`), scaled by
 * the zoom the layer carries.
 */
export function paintBookmarkMarks(
  frame: Parameters<SurfaceBookmarks['paint']>[0],
  marks: readonly BookmarkMark[],
  decorate?: BookmarkMarkOptions['decorate'],
  onError?: (error: unknown) => void
): void {
  const { layer, layout, scale } = frame;
  const document = layer.ownerDocument;
  guardSheetPresses(layer);
  layer.style.setProperty('--docx-bookmark-scale', String(scale));
  const painted: HTMLElement[] = [];
  const pageIndexes = frame.pages ? [...frame.pages] : layout.pages.map((_page, index) => index);
  let placements = placementCache.get(layout);
  if (!placements) placementCache.set(layout, (placements = new Map()));
  const cached = placements;
  for (const mark of marks) {
    const position = { paragraphId: mark.paragraphId, offset: mark.offset };
    // A header or footer is laid out once and shown on each page that uses it, so its marks
    // are placed once per painted page. Each answer is kept for this layout: a scroll that
    // repaints the same layout asks again for the same places.
    const at = (offset: number, pageIndex?: number) => {
      const key = `${mark.paragraphId}:${offset}:${pageIndex ?? ''}`;
      if (cached.has(key)) return cached.get(key)!;
      const geometry = caretAt(
        layout,
        { paragraphId: mark.paragraphId, offset },
        {
          ...(frame.measurer ? { measurer: frame.measurer } : {}),
          ...(pageIndex !== undefined ? { preferredPageIndex: pageIndex } : {}),
        }
      );
      cached.set(key, geometry);
      return geometry;
    };
    const sites = mark.repeats
      ? pageIndexes.map((pageIndex) => at(position.offset, pageIndex))
      : [at(position.offset)];
    const placed = new Set<number>();
    for (const geometry of sites) {
      if (!geometry || !(geometry.height > 0) || placed.has(geometry.pageIndex)) continue;
      if (frame.pages && !frame.pages.has(geometry.pageIndex)) continue;
      const page = layout.pages[geometry.pageIndex];
      if (!page) continue;
      const offsetX = frame.pageOffsetX?.get(geometry.pageIndex) ?? 0;
      // Body lines measure from the content box. Header, footer and note lines measure from
      // their own story's box on this page; a note that continues measures from this page's
      // part of it.
      const story = mark.repeats
        ? [page.header, page.footer].find((entry) => entry?.partName === mark.repeats)
        : mark.story === 'note'
          ? noteOnPage(page, mark.paragraphId)
          : undefined;
      if ((mark.repeats || mark.story === 'note') && !story) continue;
      const origin = story?.box ?? page.contentBox;
      placed.add(geometry.pageIndex);
      let element: HTMLElement = document.createElement('div');
      element.className = `docx-bookmark-mark docx-bookmark-mark--${mark.edge}`;
      // In right-to-left text the bracket opens the other way: the text it encloses lies to
      // the left of a start and to the right of an end. The neighbouring character says which.
      const inward = mark.edge === 'end' ? position.offset - 1 : position.offset + 1;
      const neighbour =
        inward >= 0 ? at(inward, mark.repeats ? geometry.pageIndex : undefined) : null;
      if (
        neighbour?.lineId === geometry.lineId &&
        (mark.edge === 'end' ? neighbour.x > geometry.x : neighbour.x < geometry.x)
      ) {
        element.classList.add('docx-bookmark-mark--rtl');
      }
      const info: BookmarkMarkInfo = {
        name: mark.name,
        hidden: mark.hidden,
        story: mark.story,
        edge: mark.edge,
      };
      // A host callback that throws keeps the default mark and does not stop the paint.
      try {
        element = decorate?.(element, info) ?? element;
      } catch (error) {
        onError?.(error);
      }
      // Whatever came back is placed the same way and stays out of editing and selection.
      element.dataset.bookmarkName = mark.name;
      element.dataset.bookmarkHidden = String(mark.hidden);
      element.dataset.bookmarkEdge = mark.edge;
      element.dataset.bookmarkStory = mark.story;
      element.dataset.docxMarker = '';
      element.setAttribute('contenteditable', 'false');
      element.style.position = 'absolute';
      element.style.left = `${(origin.x + geometry.x + offsetX) * scale}px`;
      element.style.top = `${(origin.y + geometry.y) * scale}px`;
      element.style.height = `${geometry.height * scale}px`;
      painted.push(element);
    }
  }
  layer.replaceChildren(...painted);
}
