// Active editing scope for the paginated surface (header/footer furniture).
//
// Body editing is the default. Opening a header/footer binds
// `EditorScope { kind: 'headerFooter'; rId }` and routes the same semantic input /
// formatting / IME / undo path at that story — never a parallel reduced editor.

import {
  caretAt,
  caretStopsForBlocks,
  documentOrder,
  moveCaret,
  paragraphFragmentsOf,
} from '@docx-editor.dev/core/layout';
import type {
  BlockFragmentRecord,
  CaretGeometry,
  HeaderFooterStoryRecord,
  LayoutBox,
  NavigationCommand,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  SemanticPosition,
  SemanticSelection,
  TextMeasurer,
} from '@docx-editor.dev/core/layout';
import type { EditorScope, ViewScope } from '../contracts/editor.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';
import type { OoxmlPart, StoryScope } from '@docx-editor.dev/core/store';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { hitStoryDrawingAtPoint, type StoryDrawingLayer } from '../layout/story-drawing-hit.ts';
import {
  hitAnchoredDrawingAtPoint,
  hitTestFragments,
  hitTestPage,
  hitTestTurnedInlineDrawing,
  pageAtY,
  pointInTextLine,
  type SemanticHit,
} from '../layout/semantic-hit-test.ts';
import { parseNoteScopeId } from '../store/package/note-nodes.ts';
import { sameNoteStory } from './surface-note-story.ts';
import { noteScopeIndexOf } from './layout-paragraph-indexes.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { logicalLineSegments } from '../layout/line-segments.ts';

export const SCOPE_BODY: ViewScope = Object.freeze({ kind: 'body' as const });

export type HeaderFooterViewScope = Extract<ViewScope, { kind: 'headerFooter' }>;

export interface ActiveHeaderFooterScope {
  readonly scope: HeaderFooterViewScope;
  /** Page whose furniture the user entered (preferred caret/hit target among shared copies). */
  readonly pageIndex: number;
  /**
   * Section the user opened (from `editHeaderFooter` / chrome). When absent, state derives
   * the section from resolution, preferring a declared slot over an inherited one.
   */
  readonly sectionIndex?: number;
  readonly kind: 'header' | 'footer';
  readonly variant: 'default' | 'first' | 'even';
  readonly partName: string;
  /** Body selection restored on exit. */
  readonly savedBodySelection: SemanticSelection;
}

export function isHeaderFooterScope(
  scope: EditorScope | ViewScope | null | undefined
): scope is HeaderFooterViewScope {
  return scope?.kind === 'headerFooter' && typeof scope.rId === 'string' && scope.rId.length > 0;
}

/**
 * The session reads {@link storyScopeOfNodeId} needs. A structural subset, so a caller can
 * hand it either the surface's session or the facade's.
 */
export type StoryScopeLookup = Pick<
  TreeDocxSessionView,
  'part' | 'headerFooterResolutionBySection' | 'partFor' | 'currentPackage' | 'storyParts'
>;

/**
 * The story a NODE lives in, which is what a write about that node must target.
 *
 * The open scope is a near-enough proxy most of the time and wrong exactly when it matters:
 * nothing binds a node id to it, so a verb invoked on a control, a chip or a paragraph the
 * reader is not currently standing in wrote against the wrong store — or, where the id came
 * from a body-only index, against body content the reader could not see.
 *
 * Answered from the id's own PART NAME. Node ids are minted `${partName}#${path}`, so the
 * question is constant-time and needs no store to be opened. That last part is load-bearing:
 * asking each scope for its paragraph list instead OPENS a story store, the store cap is 64,
 * and a store whose part is still in the package is never evicted — on a many-section
 * document that left later headers unopenable for the rest of the session.
 *
 * Falls back to `fallback` for an id no story claims, so the store refuses it rather than this.
 */
/**
 * The part a NODE lives in, WITHOUT opening a story store.
 *
 * `session.partFor(scope)` resolves a scope by opening that story's store, and an open store is
 * retained for as long as its part is in the package. The cap is 64. So routing a pure READ —
 * "is this control locked", "what is its tab index" — through `partFor` spent a permanent slot
 * per part touched, and an id naming no node at all still spent one, because the part name is
 * matched from the id's prefix before anything is looked up. Sixty-four such reads and no
 * further header could be opened for the rest of the session, silently.
 *
 * Read straight from the live package instead. Ids carry the canonical part name, so this is a
 * map lookup.
 *
 * A collaboration session names the nodes it creates by logical id, which carries no part name.
 * Those ids are looked up in each story part's node index, which opens no story store either.
 * A view without `storyParts` has no session ids, so it answers null for them.
 */
export function partOfNodeId(
  session: Pick<TreeDocxSessionView, 'currentPackage' | 'part'> &
    Partial<Pick<TreeDocxSessionView, 'storyParts'>>,
  nodeId: string | undefined
): OoxmlPart | null {
  if (nodeId === undefined) return null;
  const hash = nodeId.indexOf('#');
  if (hash === -1) {
    return session.storyParts?.().find((part) => findNode(part, nodeId) !== null) ?? null;
  }
  if (hash === 0) return null;
  return session.currentPackage().parts.get(nodeId.slice(0, hash)) ?? null;
}

/**
 * Whether two node ids live in the same story part. Two part-named ids compare their names,
 * a string scan that is cheap enough for every pointer move. A logical id from a session
 * names no part, so it is looked up; an id no part holds is in no story, and matches nothing.
 */
export function sameStoryPart(
  session: Pick<TreeDocxSessionView, 'currentPackage' | 'part' | 'storyParts'>,
  left: string,
  right: string
): boolean {
  const leftHash = left.indexOf('#');
  const rightHash = right.indexOf('#');
  if (leftHash > 0 && rightHash > 0) {
    return leftHash === rightHash && left.startsWith(right.slice(0, rightHash + 1));
  }
  const leftPart = partOfNodeId(session, left);
  return leftPart !== null && leftPart.name === partOfNodeId(session, right)?.name;
}

export function storyScopeOfNodeId(
  session: StoryScopeLookup,
  nodeId: string | undefined,
  fallback: StoryScope
): StoryScope {
  const hash = nodeId?.indexOf('#') ?? -1;
  // A session's logical id names no part, so its part is found in the story indexes.
  const partName =
    hash === -1 ? (partOfNodeId(session, nodeId)?.name ?? '') : nodeId!.slice(0, hash);
  return storyScopeOfPartName(session, partName, fallback);
}

/** The story a part holds: the body, a header or footer, or a notes part. */
export function storyScopeOfPartName(
  session: StoryScopeLookup,
  partName: string,
  fallback: StoryScope
): StoryScope {
  if (partName.length === 0 || partName === session.part().name) return { kind: 'body' };
  for (const section of session.headerFooterResolutionBySection()) {
    for (const slots of [section.headers, section.footers]) {
      for (const slot of slots.values()) {
        if (slot.partName === partName) return { kind: 'headerFooter', rId: slot.rId };
      }
    }
  }
  for (const noteKind of ['footnote', 'endnote'] as const) {
    if (session.partFor({ kind: 'notesPart', noteKind })?.name === partName) {
      return { kind: 'notesPart', noteKind };
    }
  }
  return fallback;
}

export function storyScopeOf(
  active: ActiveHeaderFooterScope | null,
  noteScope?: Extract<ViewScope, { kind: 'note' }> | null
): StoryScope {
  if (active) return { kind: 'headerFooter', rId: active.scope.rId };
  if (noteScope) {
    const parsed = parseNoteScopeId(noteScope.id);
    if (parsed) return { kind: 'notesPart', noteKind: parsed.noteKind };
  }
  return { kind: 'body' };
}

export function viewScopeOf(
  active: ActiveHeaderFooterScope | null,
  noteScope?: Extract<ViewScope, { kind: 'note' }> | null
): ViewScope {
  if (active) return active.scope;
  if (noteScope) return noteScope;
  return SCOPE_BODY;
}

/**
 * Paragraph fragments addressable under the active scope (body / HF / note). An open note
 * addresses every note of its kind, because the notes part is one story for selection (§17.11).
 */
export function scopedParagraphFragments(
  page: SemanticLayout['pages'][number],
  active: HeaderFooterScopeBinding | null,
  noteScopeId?: string | null
): ParagraphFragmentRecord[] {
  if (noteScopeId) {
    const notes: ParagraphFragmentRecord[] = [];
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) {
        if (!sameNoteStory(note.scopeId, noteScopeId)) continue;
        notes.push(...paragraphFragmentsFromBlocks(note.fragments));
      }
    }
    return notes;
  }
  if (!active) return paragraphFragmentsOf(page);
  const story = storyOnPage(page, active);
  if (!story) return [];
  return paragraphFragmentsFromBlocks(story.fragments);
}

export function storyOnPage(
  page: SemanticLayout['pages'][number],
  active: HeaderFooterScopeBinding
): HeaderFooterStoryRecord | undefined {
  const candidate = active.kind === 'header' ? page.header : page.footer;
  if (!candidate) return undefined;
  if (candidate.rId && candidate.rId === active.scope.rId) return candidate;
  if (!candidate.rId && candidate.partName === active.partName) return candidate;
  return undefined;
}

export function findStoryForRId(
  layout: SemanticLayout,
  rId: string
): {
  pageIndex: number;
  kind: 'header' | 'footer';
  story: HeaderFooterStoryRecord;
} | null {
  for (const page of layout.pages) {
    for (const kind of ['header', 'footer'] as const) {
      const story = page[kind];
      if (story?.rId === rId) return { pageIndex: page.index, kind, story };
    }
  }
  return null;
}

/** Binding fields the pointer layer needs without saved body selection. */
export type HeaderFooterScopeBinding = Pick<
  ActiveHeaderFooterScope,
  'scope' | 'pageIndex' | 'kind' | 'partName' | 'variant'
>;

export function storyMatchesBinding(
  story: HeaderFooterStoryRecord,
  active: HeaderFooterScopeBinding
): boolean {
  if (story.rId && story.rId === active.scope.rId) return true;
  if (!story.rId && story.partName === active.partName && story.kind === active.kind) return true;
  return false;
}

export function isBodyContentPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number
): boolean {
  const pageIndex = pageAtY(layout, sheet.y);
  const page = layout.pages[pageIndex];
  if (!page) return false;
  const x = sheet.x - pageOffsetX(pageIndex);
  const y = sheet.y;
  const box = page.contentBox;
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
}

export function hitTestStoryAtLocalPoint(
  layout: SemanticLayout,
  pageIndex: number,
  story: HeaderFooterStoryRecord,
  local: { readonly x: number; readonly y: number },
  options: { readonly measurer?: TextMeasurer } = {}
): SemanticHit | null {
  // The story's own drawings, as the body's: in front first, then the text, and a drawing
  // behind the text only outside every line of it.
  const page = layout.pages[pageIndex];
  const point = { x: story.box.x + local.x, y: story.box.y + local.y };
  const drawingAt = (layer: StoryDrawingLayer) =>
    page
      ? hitStoryDrawingAtPoint(story.anchoredDrawings, story.box, page.box, point, pageIndex, layer)
      : null;
  const front = drawingAt('front');
  if (front) return front;
  const text = hitTestFragments(layout, pageIndex, story.fragments, local, options);
  if (text && (text.onGlyphs || pointInTextLine(story.fragments, local))) return text;
  return drawingAt('behind') ?? text;
}

/**
 * The open header or footer's drawing at a sheet point, past the story band too: a watermark,
 * a logo, or a turned inline shape that reaches into the body is still the open story's. Any
 * page that shows the open story answers, as its band does; the hit names that page.
 */
export function activeStoryDrawingAtSheetPoint(
  layout: SemanticLayout,
  active: HeaderFooterScopeBinding,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number
): SemanticHit | null {
  const page = layout.pages[pageAtY(layout, sheet.y)];
  const story = page ? storyOnPage(page, active) : undefined;
  if (!page || !story) return null;
  const point = { x: sheet.x - pageOffsetX(page.index), y: sheet.y };
  const local = { x: point.x - story.box.x, y: point.y - story.box.y };
  return (
    hitStoryDrawingAtPoint(story.anchoredDrawings, story.box, page.box, point, page.index, 'any') ??
    hitTestTurnedInlineDrawing(layout, page.index, story.fragments, local)
  );
}

/**
 * Story-scoped caret stops for an open header/footer. Coordinates stay story-relative so
 * arrow navigation follows tab advances and projected field atoms without mixing body sheet
 * offsets.
 */
export function activeStoryCaretStops(
  layout: SemanticLayout,
  active: HeaderFooterScopeBinding,
  measurer?: TextMeasurer
): CaretGeometry[] | null {
  const page = layout.pages[active.pageIndex] ?? layout.pages[0];
  if (!page) return null;
  const story = storyOnPage(page, active);
  if (!story) return null;
  return caretStopsForBlocks(layout, active.pageIndex, story.fragments, measurer);
}

/** Caret stops per layout and note kind; arrow keys ask on every press. */
const noteStoryStopsCache = new WeakMap<
  SemanticLayout,
  Map<string, { readonly measurer?: TextMeasurer; readonly stops: CaretGeometry[] | null }>
>();

/**
 * Story-scoped caret stops for an open footnote/endnote, including continuations. The stops
 * cover every note of its kind, so arrows and Shift+arrows cross from one note to the next.
 *
 * For NAVIGATION only, so each stop is moved from its note's box onto the page: two notes on
 * one page each measure from their own top, and Page Up/Down compares heights across them.
 * The caret itself is placed by `caretAt`, which keeps the note-relative geometry.
 */
export function activeNoteCaretStops(
  layout: SemanticLayout,
  scopeId: string,
  measurer?: TextMeasurer
): CaretGeometry[] | null {
  const kind = parseNoteScopeId(scopeId)?.noteKind ?? scopeId;
  let byKind = noteStoryStopsCache.get(layout);
  const cached = byKind?.get(kind);
  if (cached && cached.measurer === measurer) return cached.stops;
  const stops: CaretGeometry[] = [];
  for (const page of layout.pages) {
    for (const area of [page.footnotes, page.endnotes]) {
      for (const note of area?.notes ?? []) {
        if (!sameNoteStory(note.scopeId, scopeId)) continue;
        for (const stop of caretStopsForBlocks(layout, page.index, note.fragments, measurer)) {
          stops.push({ ...stop, x: stop.x + note.box.x, y: stop.y + note.box.y });
        }
      }
    }
  }
  const result = stops.length > 0 ? stops : null;
  if (!byKind) noteStoryStopsCache.set(layout, (byKind = new Map()));
  byKind.set(kind, { ...(measurer ? { measurer } : {}), stops: result });
  return result;
}

/** Active `[data-docx-hf-active]` host for the preferred furniture page, if any. */
export function furnitureCaretHost(pagesLayer: HTMLElement, pageIndex: number): HTMLElement | null {
  return (
    pagesLayer.querySelector<HTMLElement>(
      `[data-page-index="${pageIndex}"] > [data-docx-hf-active]`
    ) ?? pagesLayer.querySelector<HTMLElement>('[data-docx-hf-active]')
  );
}

/** Painted note host for scoped caret geometry (which is relative to the note story). */
export function noteCaretHost(
  pagesLayer: HTMLElement,
  scopeId: string,
  preferredPageIndex?: number | null
): HTMLElement | null {
  const candidates = pagesLayer.querySelectorAll<HTMLElement>('[data-docx-note-scope]');
  let first: HTMLElement | null = null;
  for (const candidate of candidates) {
    if (candidate.dataset.docxNoteScope !== scopeId || !candidate.matches('[data-docx-note]')) {
      continue;
    }
    first ??= candidate;
    const pageIndex = Number(
      candidate.closest<HTMLElement>('[data-page-index]')?.dataset.pageIndex
    );
    if (preferredPageIndex !== null && pageIndex === preferredPageIndex) return candidate;
  }
  return first;
}

/**
 * Prefer the caller's visual occurrence when it still hosts the open story; otherwise the
 * lowest materialized page with that story, else the lowest page that paints it at all.
 *
 * Keeps one caret host after scroll/dematerialization without inventing a second selection.
 */
export function resolvePreferredFurniturePage(
  layout: SemanticLayout,
  active: HeaderFooterScopeBinding,
  materialized?: ReadonlySet<number>
): number {
  const hostsStory = (pageIndex: number): boolean => {
    const page = layout.pages[pageIndex];
    return !!page && !!storyOnPage(page, active);
  };
  if (
    hostsStory(active.pageIndex) &&
    (materialized === undefined || materialized.has(active.pageIndex))
  ) {
    return active.pageIndex;
  }
  let firstAny: number | null = null;
  for (const page of layout.pages) {
    if (!storyOnPage(page, active)) continue;
    if (firstAny === null) firstAny = page.index;
    if (materialized === undefined || materialized.has(page.index)) return page.index;
  }
  return firstAny ?? active.pageIndex;
}

/** Pointer-layer snapshot of an open furniture scope. */
export function pointerHeaderFooterState(active: ActiveHeaderFooterScope | null): {
  rId: string;
  pageIndex: number;
  kind: 'header' | 'footer';
  partName: string;
  variant: 'default' | 'first' | 'even';
} | null {
  if (!active) return null;
  return {
    rId: active.scope.rId,
    pageIndex: active.pageIndex,
    kind: active.kind,
    partName: active.partName,
    variant: active.variant,
  };
}

/** Screen-only chrome classes while a furniture scope is open (print CSS resets opacity). */
export function setHeaderFooterEditingChrome(
  container: HTMLElement,
  pagesLayer: HTMLElement,
  editing: boolean
): void {
  container.classList.toggle('docx-paginated-surface--hf-editing', editing);
  pagesLayer.classList.toggle('docx-pages--hf-editing', editing);
}

/**
 * Screen-only chrome for the editing mode.
 *
 * Viewing mode must show no WRITE affordance, and the blank header/footer band's
 * "double-click to add" hover is one the painter cannot know about. The class has to be
 * written on every mode change, not only on a repaint: `setEditingMode` moves the mode
 * without moving the document, so a reader who switched to Viewing kept the invitation
 * until some unrelated edit repainted the pages.
 */
export function setEditingModeChrome(container: HTMLElement, mode: SurfaceEditingMode): void {
  container.classList.toggle('docx-paginated-surface--viewing', mode === 'view');
}

/** Move the caret within body stops or an open furniture/note story's stops. */
export function navigateInActiveScope(
  layout: SemanticLayout,
  position: SemanticPosition,
  command: NavigationCommand,
  desiredX: number | null,
  active: HeaderFooterScopeBinding | null,
  noteScopeId?: string | null,
  measurer?: TextMeasurer,
  lineId?: string
): {
  position: SemanticPosition;
  desiredX: number | null;
  pageIndex?: number;
  /** The caret on the line the motion chose, when its offset also starts the next line. */
  caret?: CaretGeometry;
} | null {
  const storyStops = active
    ? activeStoryCaretStops(layout, active, measurer)
    : noteScopeId
      ? activeNoteCaretStops(layout, noteScopeId, measurer)
      : null;
  const moved = moveCaret(layout, position, command, desiredX, {
    ...(measurer ? { measurer } : {}),
    ...(storyStops ? { stops: storyStops } : {}),
    ...(lineId !== undefined ? { lineId } : {}),
  });
  if (!moved) return null;
  // Prefer an exact stop match so continuation-page geometry carries its pageIndex through
  // word/line gestures that rebuild the position without returning the stop itself. A stop on
  // the chosen line wins: a wrap offset has its stop on the next line.
  const stop =
    storyStops?.find(
      (candidate) =>
        candidate.position.paragraphId === moved.position.paragraphId &&
        candidate.position.offset === moved.position.offset &&
        (moved.lineId === undefined || candidate.lineId === moved.lineId)
    ) ??
    storyStops?.find(
      (candidate) =>
        candidate.position.paragraphId === moved.position.paragraphId &&
        candidate.position.offset === moved.position.offset
    );
  const pageIndex = stop?.pageIndex;
  // The line the motion chose travels as the caret's affinity, in every story.
  const caret =
    moved.lineId === undefined
      ? null
      : caretAt(layout, moved.position, {
          ...(measurer ? { measurer } : {}),
          ...(pageIndex !== undefined ? { preferredPageIndex: pageIndex } : {}),
          preferredLineId: moved.lineId,
        });
  return {
    position: moved.position,
    desiredX: moved.desiredX,
    ...(pageIndex !== undefined ? { pageIndex } : {}),
    ...(caret ? { caret } : {}),
  };
}

export function findNoteAtSheetPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number
): {
  pageIndex: number;
  scopeId: string;
  noteKind: 'footnote' | 'endnote';
  noteId: number;
  local: { x: number; y: number };
  fragments: readonly BlockFragmentRecord[];
} | null {
  for (const page of layout.pages) {
    const ox = pageOffsetX(page.index);
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) {
        const box = note.box;
        const left = box.x + ox;
        const top = box.y;
        if (
          sheet.x >= left &&
          sheet.x < left + box.width &&
          sheet.y >= top &&
          sheet.y < top + box.height
        ) {
          return {
            pageIndex: page.index,
            scopeId: note.scopeId,
            noteKind: note.noteKind,
            noteId: note.noteId,
            local: { x: sheet.x - left, y: sheet.y - top },
            fragments: note.fragments,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Word-style furniture activation band: the full header/footer margin region, not only
 * the flowed story box. Story content is often a thin strip inside a much taller margin;
 * clicks in that whitespace must still open the story.
 */
export function furnitureActivationBox(
  page: PageRecord,
  kind: 'header' | 'footer'
): LayoutBox | null {
  const story = page[kind];
  const content = page.contentBox;
  const sheet = page.box;
  if (kind === 'header') {
    const top = sheet.y;
    const bottom = content.y;
    const bandBottom = story ? Math.max(bottom, story.box.y + story.box.height) : bottom;
    const bandTop = story ? Math.min(top, story.box.y) : top;
    if (bandBottom <= bandTop) return null;
    return {
      x: content.x,
      y: bandTop,
      width: content.width,
      height: bandBottom - bandTop,
    };
  }
  const top = content.y + content.height;
  const bottom = sheet.y + sheet.height;
  const bandTop = story ? Math.min(top, story.box.y) : top;
  const bandBottom = story ? Math.max(bottom, story.box.y + story.box.height) : bottom;
  if (bandBottom <= bandTop) return null;
  return {
    x: content.x,
    y: bandTop,
    width: content.width,
    height: bandBottom - bandTop,
  };
}

/**
 * The header/footer margin band of a page that has NO story of that kind, or null.
 *
 * The counterpart of {@link findStoryAtSheetPoint} for blank furniture: Word lets a reader
 * double-click the empty top margin to create and open a header, and the hit test has to
 * answer from geometry because there is nothing painted to hit.
 */
export function findEmptyFurnitureBandAtSheetPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number
): { pageIndex: number; kind: 'header' | 'footer' } | null {
  for (const page of layout.pages) {
    // A blank parity sheet belongs to no section, so it has no header or footer to create.
    if (page.parityBlank) continue;
    const ox = pageOffsetX(page.index);
    for (const kind of ['header', 'footer'] as const) {
      if (page[kind]) continue;
      const band = furnitureActivationBox(page, kind);
      if (!band) continue;
      const left = band.x + ox;
      if (
        sheet.x >= left &&
        sheet.x < left + band.width &&
        sheet.y >= band.y &&
        sheet.y < band.y + band.height
      ) {
        return { pageIndex: page.index, kind };
      }
    }
  }
  return null;
}

export function findStoryAtSheetPoint(
  layout: SemanticLayout,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number
): {
  pageIndex: number;
  kind: 'header' | 'footer';
  story: HeaderFooterStoryRecord;
  local: { x: number; y: number };
} | null {
  for (const page of layout.pages) {
    const ox = pageOffsetX(page.index);
    for (const kind of ['header', 'footer'] as const) {
      const story = page[kind];
      if (!story) continue;
      // Prefer the tight story box when the point is inside it (correct local coords for
      // caret placement); otherwise accept the wider margin activation band.
      const tight = story.box;
      const band = furnitureActivationBox(page, kind) ?? tight;
      const left = band.x + ox;
      const top = band.y;
      if (
        sheet.x >= left &&
        sheet.x < left + band.width &&
        sheet.y >= top &&
        sheet.y < top + band.height
      ) {
        // Local coords stay relative to the story box origin so hit-testing / caret stops
        // remain story-relative even when the press landed in margin whitespace.
        return {
          pageIndex: page.index,
          kind,
          story,
          local: { x: sheet.x - (tight.x + ox), y: sheet.y - tight.y },
        };
      }
    }
  }
  return null;
}

/**
 * Whether a {@link findStoryAtSheetPoint} hit inside the page's content box belongs to the body.
 *
 * A negative `w:top` or `w:bottom` measures the body from the page edge, so a tall header or
 * footer paints over body lines. The activation band stays the margin region above or below
 * the content box. Inside the content box, a closed story takes the press only on its own
 * glyphs or anchored drawings with no body glyph under the point. The open story also keeps
 * its whitespace, so a press beside its text still places the caret there. A body anchored
 * drawing counts as body content, a behind-text one included. Footnote and endnote text in
 * the page's note area counts as body content too, so an open footer over a note gives the
 * press to the note.
 */
export function storyHitYieldsToBody(
  layout: SemanticLayout,
  storyHit: NonNullable<ReturnType<typeof findStoryAtSheetPoint>>,
  sheet: { readonly x: number; readonly y: number },
  pageOffsetX: (pageIndex: number) => number,
  storyIsActive: boolean,
  measurer?: TextMeasurer
): boolean {
  const page = layout.pages[storyHit.pageIndex];
  if (!page) return false;
  const box = page.contentBox;
  const x = sheet.x - pageOffsetX(page.index) - box.x;
  const y = sheet.y - box.y;
  if (x < 0 || x >= box.width || y < 0 || y >= box.height) return false;
  const options = measurer ? { measurer } : {};
  const { story, local } = storyHit;
  const onStory =
    hitAnchoredDrawingAtPoint(story.anchoredDrawings, local, page.index) !== null ||
    hitTestFragments(layout, page.index, story.fragments, local, options)?.onGlyphs === true;
  if (storyIsActive && onStory) return false;
  // The page walk answers a text-free page from a neighbour's geometry; that is not on glyphs here.
  const bodyHit = hitTestPage(layout, page.index, { x, y }, options);
  const note = findNoteAtSheetPoint(layout, sheet, pageOffsetX);
  const onBody =
    (bodyHit?.onGlyphs === true && bodyHit.pageIndex === page.index) ||
    (note?.pageIndex === page.index &&
      hitTestFragments(layout, page.index, note.fragments, note.local, options)?.onGlyphs === true);
  return storyIsActive ? onBody : onBody || !onStory;
}

/**
 * Document-order paragraph ids for the active scope (deduped across shared page copies).
 *
 * Body (no HF / no note) falls through to memoized {@link documentOrder} so per-keystroke
 * callers of `paragraphOrder()` reuse the semantic-interaction WeakMap instead of rebuilding
 * a Set+array over every page. HF and note scopes stay explicitly bounded to their story
 * fragments — those paths are small and must not leak body ids.
 */
export function scopedDocumentOrder(
  layout: SemanticLayout,
  active: HeaderFooterScopeBinding | null,
  noteScopeId?: string | null
): string[] {
  if (!active && !noteScopeId) return documentOrder(layout);
  // A note story is every note of its kind, so its order is cached per layout like the body's.
  const noteKind =
    !active && noteScopeId ? (parseNoteScopeId(noteScopeId)?.noteKind ?? null) : null;
  const cachedNotes = noteKind ? noteStoryOrderCache.get(layout)?.get(noteKind) : undefined;
  if (cachedNotes) return cachedNotes;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const page of layout.pages) {
    for (const fragment of scopedParagraphFragments(page, active, noteScopeId)) {
      // From the LINES, the way `documentOrder` reads the body. A resolved display mode lays a
      // run of paragraphs out as ONE fragment named after the survivor, and a paragraph missing
      // from this order compares as before every other one — which would put a selection
      // anchored in it at the top of the story.
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
  }
  if (noteKind) {
    let byKind = noteStoryOrderCache.get(layout);
    if (!byKind) noteStoryOrderCache.set(layout, (byKind = new Map()));
    byKind.set(noteKind, order);
  }
  return order;
}

/** Note story orders per layout and note kind; see {@link scopedDocumentOrder}. */
const noteStoryOrderCache = new WeakMap<SemanticLayout, Map<string, string[]>>();

export function clampSelectionToScope(
  layout: SemanticLayout,
  selection: SemanticSelection,
  active: HeaderFooterScopeBinding | null,
  noteScopeId?: string | null
): SemanticSelection {
  const order = scopedDocumentOrder(layout, active, noteScopeId);
  if (order.length === 0) return selection;
  const allowed = new Set(order);
  const clamp = (position: SemanticPosition): SemanticPosition => {
    if (allowed.has(position.paragraphId)) return position;
    return { paragraphId: order[0]!, offset: 0 };
  };
  return { anchor: clamp(selection.anchor), head: clamp(selection.head) };
}

function paragraphFragmentsFromBlocks(
  blocks: readonly BlockFragmentRecord[]
): ParagraphFragmentRecord[] {
  const found: ParagraphFragmentRecord[] = [];
  const visit = (list: readonly BlockFragmentRecord[]): void => {
    for (const block of list) {
      if (block.kind === 'paragraph') {
        found.push(block);
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat) continue;
        for (const cell of row.cells) visit(cell.blocks);
      }
    }
  };
  visit(blocks);
  return found;
}

/** The note whose painted fragments hold this paragraph, or null. */
export function noteScopeIdInLayout(layout: SemanticLayout, paragraphId: string): string | null {
  return noteScopeIndexOf(layout).get(paragraphId) ?? null;
}
