// Queries over the laid-out record graph (layout lane).
//
// Split out of semantic-records.ts, which is at its line cap. That module DECLARES the
// record shapes; this one only reads them — the depth-first fragment walks every consumer
// flattens per read, the line lookups caret navigation runs, and the content-control
// collapses. Re-exported from semantic-records.ts so importers keep one entry point.

import type {
  AnchoredDrawingRecord,
  BlockFragmentRecord,
  ContentControlBoundaryRecord,
  ContentControlLock,
  HeaderFooterStoryRecord,
  InlineDrawingRecord,
  LayoutBox,
  LineRecord,
  NoteAreaRecord,
  NoteStoryRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from './semantic-records.ts';
import { headerFooterAnchoredDrawingOrigin } from './header-footer-drawing-origin.ts';

/**
 * Depth-first paragraph fragments of one page, in reading order.
 *
 * Table interiors flatten through rows and cells; header-repeat rows are skipped unless
 * asked for, so interaction sees each caret stop exactly once while paint sees everything.
 */
export function paragraphFragmentsOf(
  page: PageRecord,
  includeHeaderRepeats = false
): ParagraphFragmentRecord[] {
  return paragraphFragmentsOfBlocks(page.fragments, includeHeaderRepeats);
}

/**
 * Depth-first paragraph fragments of one block list, in reading order.
 *
 * The same walk as {@link paragraphFragmentsOf} for fragment lists that do not sit on the
 * page directly — a header/footer story's fragments, a note story's.
 */
/**
 * Memoized per fragments array and variant: page fragment arrays are identity-stable
 * across incremental passes while every consumer (hit testing, selection, notes) flattens
 * them per read, which made the flatten itself a per-keystroke cost on long documents.
 */
const paragraphFragmentsMemos = new WeakMap<
  readonly BlockFragmentRecord[],
  { withRepeats?: ParagraphFragmentRecord[]; withoutRepeats?: ParagraphFragmentRecord[] }
>();

export function paragraphFragmentsOfBlocks(
  blocks: readonly BlockFragmentRecord[],
  includeHeaderRepeats = false
): ParagraphFragmentRecord[] {
  let memo = paragraphFragmentsMemos.get(blocks);
  const slot = includeHeaderRepeats ? 'withRepeats' : 'withoutRepeats';
  const cached = memo?.[slot];
  if (cached) return cached;
  const found: ParagraphFragmentRecord[] = [];
  const visitBlocks = (list: readonly BlockFragmentRecord[]): void => {
    for (const block of list) {
      if (block.kind === 'paragraph') {
        found.push(block);
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat && !includeHeaderRepeats) continue;
        for (const cell of row.cells) visitBlocks(cell.blocks);
      }
    }
  };
  visitBlocks(blocks);
  if (!memo) {
    memo = {};
    paragraphFragmentsMemos.set(blocks, memo);
  }
  memo[slot] = found;
  return found;
}

/** Every line in a layout, in reading order — the order caret navigation walks. */
export function linesOf(layout: SemanticLayout): LineRecord[] {
  const lines: LineRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) lines.push(...fragment.lines);
  }
  return lines;
}

/** Anchored drawings on one body page (page-content coordinates). */
export function anchoredDrawingsOf(page: PageRecord): readonly AnchoredDrawingRecord[] {
  return page.anchoredDrawings ?? [];
}

/** The fragment-plus-anchored-drawings shape every laid-out story shares. */
export interface StoryDrawingHost {
  /** Root story fragments in their published reading order. */
  readonly fragments: readonly BlockFragmentRecord[];
  /** Story-level positioned drawings, when that story supports anchors. */
  readonly anchoredDrawings?: readonly AnchoredDrawingRecord[];
}

/** Root story kinds published directly from one page record. @public */
export type SemanticRootStoryKind =
  'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'note-separator';

/** Story containing a visited semantic record. @public */
export type SemanticStoryKind = SemanticRootStoryKind | 'textbox';

/**
 * One root story in the engine's complete published page/story order.
 *
 * The story discriminant preserves the precise published host type so exporters can consume
 * furniture and note metadata without casting or searching the page graph a second time.
 * @public
 */
export type SemanticStoryVisit =
  | {
      readonly page: PageRecord;
      readonly story: 'body';
      readonly host: PageRecord;
      /** Absolute story bounds; body records are relative to the page content box. */
      readonly box: LayoutBox;
      /** Absolute origin to add to story-relative fragment and drawing coordinates. */
      readonly origin: Readonly<{ x: number; y: number }>;
      readonly noteScopeId: null;
      readonly noteAreaKind: null;
    }
  | {
      readonly page: PageRecord;
      readonly story: 'header' | 'footer';
      readonly host: HeaderFooterStoryRecord;
      readonly box: LayoutBox;
      readonly origin: Readonly<{ x: number; y: number }>;
      readonly noteScopeId: null;
      readonly noteAreaKind: null;
    }
  | {
      readonly page: PageRecord;
      readonly story: 'footnote' | 'endnote';
      readonly host: NoteStoryRecord;
      readonly box: LayoutBox;
      readonly origin: Readonly<{ x: number; y: number }>;
      readonly noteScopeId: string;
      readonly noteAreaKind: NoteAreaRecord['kind'];
    }
  | {
      readonly page: PageRecord;
      readonly story: 'note-separator';
      readonly host: NonNullable<NoteAreaRecord['separator']>;
      readonly box: LayoutBox;
      readonly origin: Readonly<{ x: number; y: number }>;
      readonly noteScopeId: null;
      readonly noteAreaKind: NoteAreaRecord['kind'];
    };

const EMPTY_STORY_BOX = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

function storyGeometry(box: LayoutBox | undefined): {
  readonly box: LayoutBox;
  readonly origin: Readonly<{ x: number; y: number }>;
} {
  // Published records always carry geometry. The fallback keeps record-only tooling defensive
  // when handed a deliberately partial synthetic layout (common in focused consumer tests).
  const resolved = box ?? EMPTY_STORY_BOX;
  return { box: resolved, origin: Object.freeze({ x: resolved.x, y: resolved.y }) };
}

type StoryFieldRole = 'story' | 'metadata';

// Adding a page field cannot silently bypass the canonical story walk: it must first be
// classified here, and every field classified as a story must also enter the traversed set.
const PAGE_RECORD_FIELD_ROLES = {
  id: 'metadata',
  index: 'metadata',
  box: 'metadata',
  contentBox: 'metadata',
  fragments: 'story',
  columnSeparators: 'metadata',
  pageBorders: 'metadata',
  anchoredDrawings: 'story',
  header: 'story',
  footer: 'story',
  footnotes: 'story',
  endnotes: 'story',
  noteStream: 'metadata',
  parityBlank: 'metadata',
  pageFieldSource: 'metadata',
  hasBodyPageFields: 'metadata',
  contentControls: 'metadata',
} as const satisfies Record<keyof PageRecord, StoryFieldRole>;

type PageStoryField = {
  [
    Key in keyof typeof PAGE_RECORD_FIELD_ROLES
  ]: (typeof PAGE_RECORD_FIELD_ROLES)[Key] extends 'story' ? Key : never;
}[keyof typeof PAGE_RECORD_FIELD_ROLES];

const TRAVERSED_PAGE_STORY_FIELDS = {
  fragments: true,
  anchoredDrawings: true,
  header: true,
  footer: true,
  footnotes: true,
  endnotes: true,
} as const satisfies Record<PageStoryField, true>;
const PAGE_STORY_FIELDS = Object.freeze(
  Object.keys(TRAVERSED_PAGE_STORY_FIELDS) as PageStoryField[]
);

const NOTE_AREA_FIELD_ROLES = {
  kind: 'metadata',
  placement: 'metadata',
  box: 'metadata',
  separator: 'story',
  notes: 'story',
  continuationNotice: 'story',
  fallbackReason: 'metadata',
} as const satisfies Record<keyof NoteAreaRecord, StoryFieldRole>;

type NoteAreaStoryField = {
  [Key in keyof typeof NOTE_AREA_FIELD_ROLES]: (typeof NOTE_AREA_FIELD_ROLES)[Key] extends 'story'
    ? Key
    : never;
}[keyof typeof NOTE_AREA_FIELD_ROLES];

const TRAVERSED_NOTE_AREA_STORY_FIELDS = {
  separator: true,
  notes: true,
  continuationNotice: true,
} as const satisfies Record<NoteAreaStoryField, true>;
const NOTE_AREA_STORY_FIELDS = Object.freeze(
  Object.keys(TRAVERSED_NOTE_AREA_STORY_FIELDS) as NoteAreaStoryField[]
);

void PAGE_RECORD_FIELD_ROLES;
void TRAVERSED_PAGE_STORY_FIELDS;
void NOTE_AREA_FIELD_ROLES;
void TRAVERSED_NOTE_AREA_STORY_FIELDS;

function forEachNoteAreaStory(
  page: PageRecord,
  area: NoteAreaRecord,
  storyKind: 'footnote' | 'endnote',
  visit: (story: SemanticStoryVisit) => void
): void {
  const noteAreaKind =
    area.kind ?? (storyKind === 'footnote' ? ('footnotes' as const) : ('endnotes' as const));
  for (const field of NOTE_AREA_STORY_FIELDS) {
    switch (field) {
      case 'separator':
      case 'continuationNotice':
        if (area[field]) {
          visit({
            page,
            story: 'note-separator',
            host: area[field],
            ...storyGeometry(area[field].box),
            noteScopeId: null,
            noteAreaKind,
          });
        }
        break;
      case 'notes':
        for (const note of area.notes) {
          // The PageRecord field is the page-level authority for the published story kind. This
          // keeps traversal deterministic even for defensive records whose redundant metadata
          // is absent or inconsistent.
          switch (storyKind) {
            case 'footnote':
              visit({
                page,
                story: 'footnote',
                host: note,
                ...storyGeometry(note.box),
                noteScopeId: note.scopeId,
                noteAreaKind,
              });
              break;
            case 'endnote':
              visit({
                page,
                story: 'endnote',
                host: note,
                ...storyGeometry(note.box),
                noteScopeId: note.scopeId,
                noteAreaKind,
              });
              break;
            default:
              storyKind satisfies never;
          }
        }
        break;
      default:
        field satisfies never;
    }
  }
}

/** Visit all root stories on one page through the single exhaustive story authority. @internal */
export function forEachPageStory(
  page: PageRecord,
  visit: (story: SemanticStoryVisit) => void
): void {
  for (const field of PAGE_STORY_FIELDS) {
    switch (field) {
      case 'fragments':
        visit({
          page,
          story: 'body',
          host: page,
          ...storyGeometry(page.contentBox),
          noteScopeId: null,
          noteAreaKind: null,
        });
        break;
      case 'anchoredDrawings':
        // Anchors are body-story content already reached through the page host above.
        break;
      case 'header':
        if (page.header) {
          visit({
            page,
            story: 'header',
            host: page.header,
            ...storyGeometry(page.header.box),
            noteScopeId: null,
            noteAreaKind: null,
          });
        }
        break;
      case 'footer':
        if (page.footer) {
          visit({
            page,
            story: 'footer',
            host: page.footer,
            ...storyGeometry(page.footer.box),
            noteScopeId: null,
            noteAreaKind: null,
          });
        }
        break;
      case 'footnotes':
        if (page.footnotes) forEachNoteAreaStory(page, page.footnotes, 'footnote', visit);
        break;
      case 'endnotes':
        if (page.endnotes) forEachNoteAreaStory(page, page.endnotes, 'endnote', visit);
        break;
      default:
        field satisfies never;
    }
  }
}

/** Visit every root story in a semantic layout, preserving page/story order. @public */
export function forEachSemanticStory(
  layout: SemanticLayout,
  visit: (story: SemanticStoryVisit) => void
): void {
  for (const page of layout.pages) forEachPageStory(page, visit);
}

/** Location of one paragraph fragment within a recursively painted story graph. @public */
export interface StoryParagraphFragmentContext {
  /** Absolute origin of the immediate story containing this record. */
  readonly storyOrigin: Readonly<{ x: number; y: number }>;
  /** Zero for the supplied story; increments for every textbox boundary. */
  readonly textboxDepth: number;
  /** Drawing whose textbox directly owns this fragment, or null for the root story. */
  readonly textboxOwner: TextboxOwnerRecord | null;
  /** Root-to-leaf owning drawings, empty for the supplied story. */
  readonly textboxPath: readonly TextboxOwnerRecord[];
}

/** A drawing that owns a text-box story: anchored, or inline on a line. @public */
export type TextboxOwnerRecord = InlineDrawingRecord | AnchoredDrawingRecord;

/** Location of one drawing within a recursively painted story graph. @public */
export interface StoryDrawingContext extends StoryParagraphFragmentContext {
  /** Enclosing paragraph for an inline drawing; null for a story-level anchor. */
  readonly paragraph: ParagraphFragmentRecord | null;
  /** Enclosing line for an inline drawing; null for a story-level anchor. */
  readonly line: LineRecord | null;
}

/**
 * Text-box stories descended per {@link forEachStoryDrawing} walk before it stops.
 *
 * Sits ABOVE layout's construction ceiling (`MAX_TEXTBOX_STORY_NESTING`, 4) on purpose:
 * records deeper than the ceiling cannot be built, so the bound is defensive, not policy.
 * Layout builds these records and a cycle should be impossible — which is the reason to
 * bound the walk rather than to trust it, since the cost of the bound is nothing.
 */
const MAX_STORY_DRAWING_WALK_DEPTH = 16;
const ZERO_STORY_ORIGIN = Object.freeze({ x: 0, y: 0 });

function textboxStoryOrigin(
  origin: Readonly<{ x: number; y: number }>,
  drawing: TextboxOwnerRecord,
  offset: Readonly<{ x: number; y: number }>,
  placedDrawingOrigin?: Readonly<{ x: number; y: number }>
): Readonly<{ x: number; y: number }> {
  const placed = placedDrawingOrigin ?? { x: origin.x + drawing.x, y: origin.y + drawing.y };
  return Object.freeze({
    x: placed.x + offset.x,
    y: placed.y + offset.y,
  });
}

interface OwnedTextboxStory {
  readonly story: import('./textbox-story-layout.ts').TextboxStoryLayout;
  /** Origin of the story's content box inside the drawing extent. */
  readonly offset: Readonly<{ x: number; y: number }>;
}

/**
 * Every text-box story a drawing carries: its own, then each group member's, at the member
 * box. One list for every walk, so no consumer can see one kind of story and miss the other.
 */
export function ownedTextboxStories(drawing: TextboxOwnerRecord): readonly OwnedTextboxStory[] {
  const stories: OwnedTextboxStory[] = [];
  if (drawing.textboxStory) {
    stories.push({
      story: drawing.textboxStory,
      offset: drawing.textboxStory.contentOffset ?? ZERO_STORY_ORIGIN,
    });
  }
  for (const member of drawing.groupTextboxStories ?? []) {
    const contentOffset = member.story.contentOffset ?? ZERO_STORY_ORIGIN;
    stories.push({
      story: member.story,
      offset: { x: member.box.x + contentOffset.x, y: member.box.y + contentOffset.y },
    });
  }
  return stories;
}

type RootDrawingOrigin = (drawing: AnchoredDrawingRecord) => Readonly<{ x: number; y: number }>;

/**
 * Visit every drawing record one story paints — line drawings, anchored drawings, and the
 * drawings inside each text-box story, anchored or inline, recursively.
 *
 * The ONE recursive walk shared by furniture invalidation, export resource settlement,
 * exporter provenance, and paint reconciliation. A drawing missed here can otherwise leave a
 * permanent placeholder or have a live resource revoked. Table interiors flatten through rows
 * and cells.
 */
export function forEachStoryDrawing(
  story: StoryDrawingHost,
  visit: (
    drawing: InlineDrawingRecord | AnchoredDrawingRecord,
    context: StoryDrawingContext
  ) => void,
  rootOrigin: Readonly<{ x: number; y: number }> = ZERO_STORY_ORIGIN,
  rootDrawingOrigin?: RootDrawingOrigin
): void {
  const visitBlock = (block: BlockFragmentRecord, context: StoryParagraphFragmentContext): void => {
    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const inner of cell.blocks) visitBlock(inner, context);
        }
      }
      return;
    }
    for (const line of block.lines) {
      for (const drawing of line.drawings ?? []) {
        visit(drawing, { ...context, paragraph: block, line });
        // An inline text box is a story too, placed where the line puts its extent.
        const stories = ownedTextboxStories(drawing);
        if (stories.length === 0 || drawing.accessibility.hidden) continue;
        for (const owned of stories) {
          visitStory(
            owned.story,
            context.textboxDepth + 1,
            Object.freeze([...context.textboxPath, drawing]),
            textboxStoryOrigin(context.storyOrigin, drawing, owned.offset)
          );
        }
      }
    }
  };
  function visitStory(
    inner: StoryDrawingHost,
    depth: number,
    textboxPath: readonly TextboxOwnerRecord[],
    storyOrigin: Readonly<{ x: number; y: number }>
  ): void {
    if (depth > MAX_STORY_DRAWING_WALK_DEPTH) return;
    const context: StoryParagraphFragmentContext = {
      storyOrigin,
      textboxDepth: depth,
      textboxOwner: textboxPath[textboxPath.length - 1] ?? null,
      textboxPath,
    };
    for (const drawing of inner.anchoredDrawings ?? []) {
      visit(drawing, { ...context, paragraph: null, line: null });
      // A text box is a story of its own, nested in the drawing that anchors it.
      for (const owned of ownedTextboxStories(drawing)) {
        visitStory(
          owned.story,
          depth + 1,
          Object.freeze([...textboxPath, drawing]),
          textboxStoryOrigin(
            storyOrigin,
            drawing,
            owned.offset,
            depth === 0 ? rootDrawingOrigin?.(drawing) : undefined
          )
        );
      }
    }
    for (const fragment of inner.fragments) visitBlock(fragment, context);
  }
  visitStory(story, 0, Object.freeze([]), rootOrigin);
}

/** Drawing layer relative to its owning story's text. @public */
export type SemanticDrawingLayer = 'behind-text' | 'inline' | 'in-front-of-text';

/**
 * One drawing in bounded graph-enumeration order with exporter-grade provenance.
 *
 * Enumeration is deliberately not paint order: story anchors (and nested textboxes) are visited
 * before inline line drawings. Renderers use `paintLayer` plus record geometry to compose layers.
 * @public
 */
export interface SemanticDrawingVisit extends StoryDrawingContext {
  /** Physical page carrying this drawing occurrence. */
  readonly page: PageRecord;
  /** Immediate story classification; `textbox` after textbox descent. */
  readonly story: SemanticStoryKind;
  /** Root story from which textbox descent began. */
  readonly rootStory: SemanticRootStoryKind;
  /** Note scope for drawings in note stories; null elsewhere. */
  readonly noteScopeId: string | null;
  /** Owning note-area kind for note/separator drawings; null elsewhere. */
  readonly noteAreaKind: NoteAreaRecord['kind'] | null;
  /** Precise root host and absolute origin for story-relative geometry. */
  readonly root: SemanticStoryVisit;
  /** Absolute origin of this drawing's extent in page-stack coordinates. */
  readonly drawingOrigin: Readonly<{ x: number; y: number }>;
  /** Absolute painted bounds, including effects and clipping. */
  readonly absolutePaintBounds: LayoutBox;
  /** Absolute pointer/hit bounds. */
  readonly absoluteHitBounds: LayoutBox;
  /** Layer relative to text in the immediate owning story. */
  readonly paintLayer: SemanticDrawingLayer;
  /** Published drawing record; inline visits also carry paragraph and line. */
  readonly drawing: InlineDrawingRecord | AnchoredDrawingRecord;
}

/** Visit every drawing through the canonical root-story and recursive textbox walks. @public */
export function forEachSemanticDrawing(
  layout: SemanticLayout,
  visit: (drawing: SemanticDrawingVisit) => void
): void {
  forEachSemanticStory(layout, (root) => {
    const { page, story: rootStory, host, noteScopeId, noteAreaKind } = root;
    const rootDrawingOrigin: RootDrawingOrigin | undefined =
      rootStory === 'header' || rootStory === 'footer'
        ? (drawing) =>
            headerFooterAnchoredDrawingOrigin(drawing, root.origin, {
              x: page.box.x,
              y: page.box.y,
            })
        : undefined;
    forEachStoryDrawing(
      host,
      (drawing, context) => {
        const drawingOrigin =
          drawing.kind === 'anchoredDrawing' && context.textboxDepth === 0 && rootDrawingOrigin
            ? rootDrawingOrigin(drawing)
            : Object.freeze({
                x: context.storyOrigin.x + drawing.x,
                y: context.storyOrigin.y + drawing.y,
              });
        const absoluteBox = (box: LayoutBox): LayoutBox =>
          Object.freeze({
            x: drawingOrigin.x + box.x - drawing.x,
            y: drawingOrigin.y + box.y - drawing.y,
            width: box.width,
            height: box.height,
          });
        visit({
          page,
          story: context.textboxDepth === 0 ? rootStory : 'textbox',
          rootStory,
          noteScopeId,
          noteAreaKind,
          root,
          drawingOrigin,
          absolutePaintBounds: absoluteBox(drawing.paintBounds),
          absoluteHitBounds: absoluteBox(drawing.hitBounds),
          paintLayer:
            drawing.kind === 'inlineDrawing'
              ? 'inline'
              : drawing.behindDocument
                ? 'behind-text'
                : 'in-front-of-text',
          drawing,
          ...context,
        });
      },
      root.origin,
      rootDrawingOrigin
    );
  });
}

/**
 * Visit every paragraph fragment one story paints — its own (table interiors flattened,
 * header repeats included) and the fragments inside each anchored drawing's text-box story,
 * recursively.
 *
 * The fragment sibling of {@link forEachStoryDrawing}, sharing its depth bound, for
 * consumers that read per-paragraph published fields (list markers) rather than drawings.
 * The furniture list-marker token walks with this; a fragment it misses leaves a reused
 * page showing a stale marker.
 */
export function forEachStoryParagraphFragment(
  story: StoryDrawingHost,
  visit: (fragment: ParagraphFragmentRecord, context: StoryParagraphFragmentContext) => void,
  rootOrigin: Readonly<{ x: number; y: number }> = ZERO_STORY_ORIGIN,
  rootDrawingOrigin?: RootDrawingOrigin
): void {
  const visitStory = (
    inner: StoryDrawingHost,
    depth: number,
    textboxPath: readonly TextboxOwnerRecord[],
    storyOrigin: Readonly<{ x: number; y: number }>
  ): void => {
    if (depth > MAX_STORY_DRAWING_WALK_DEPTH) return;
    for (const fragment of paragraphFragmentsOfBlocks(inner.fragments, true)) {
      visit(fragment, {
        storyOrigin,
        textboxDepth: depth,
        textboxOwner: textboxPath[textboxPath.length - 1] ?? null,
        textboxPath,
      });
      for (const line of fragment.lines) {
        for (const drawing of line.drawings ?? []) {
          const stories = ownedTextboxStories(drawing);
          if (stories.length === 0 || drawing.accessibility.hidden) continue;
          for (const owned of stories) {
            visitStory(
              owned.story,
              depth + 1,
              Object.freeze([...textboxPath, drawing]),
              textboxStoryOrigin(storyOrigin, drawing, owned.offset)
            );
          }
        }
      }
    }
    for (const drawing of inner.anchoredDrawings ?? []) {
      // A text box is a story of its own, nested in the drawing that anchors it.
      for (const owned of ownedTextboxStories(drawing)) {
        visitStory(
          owned.story,
          depth + 1,
          Object.freeze([...textboxPath, drawing]),
          textboxStoryOrigin(
            storyOrigin,
            drawing,
            owned.offset,
            depth === 0 ? rootDrawingOrigin?.(drawing) : undefined
          )
        );
      }
    }
  };
  visitStory(story, 0, Object.freeze([]), rootOrigin);
}

/** Every fragment belonging to one paragraph, in order, across page boundaries. */
export function fragmentsOfParagraph(
  layout: SemanticLayout,
  paragraphId: string
): ParagraphFragmentRecord[] {
  const fragments: ParagraphFragmentRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      if (fragment.paragraphId === paragraphId) fragments.push(fragment);
    }
  }
  return fragments.sort((a, b) => a.fragmentIndex - b.fragmentIndex);
}

/** The line containing a model position, or null when the position is not laid out. */
export function lineAtPosition(
  layout: SemanticLayout,
  paragraphId: string,
  offset: number,
  /** Lines to test, when the caller already knows which ones can carry the paragraph. */
  candidates?: Iterable<LineRecord>
): LineRecord | null {
  for (const line of candidates ?? linesOf(layout)) {
    // The part of the line this paragraph OWNS. A resolved display mode lays merged
    // paragraphs out on shared lines, and the half the line is not named after would
    // otherwise never match — its spans are there, its name is not.
    let start = line.range.paragraphId === paragraphId ? line.range.start : Number.NaN;
    let end = line.range.paragraphId === paragraphId ? line.range.end : Number.NaN;
    for (const span of line.spans) {
      if (span.range.paragraphId !== paragraphId) continue;
      start = Number.isNaN(start) ? span.range.start : Math.min(start, span.range.start);
      end = Number.isNaN(end) ? span.range.end : Math.max(end, span.range.end);
    }
    // An inline drawing is an ATOM with an offset of its own and no span to speak for it, so
    // a half that opens with a picture began at the picture, one offset before its first
    // character. Without this the caret there resolved to no line, and the image it was
    // sitting on could not be selected.
    for (const drawing of line.drawings ?? []) {
      if (drawing.paragraphId !== paragraphId) continue;
      start = Number.isNaN(start) ? drawing.start : Math.min(start, drawing.start);
      end = Number.isNaN(end) ? drawing.start + 1 : Math.max(end, drawing.start + 1);
    }
    if (Number.isNaN(start)) continue;
    // End-inclusive on the last line of a paragraph, so a caret at the very end resolves.
    if (offset >= start && offset <= end) return line;
  }
  return null;
}

/** Every content-control boundary on a layout, preferring the layout-level list. */
export function contentControlsOfLayout(
  layout: SemanticLayout
): readonly ContentControlBoundaryRecord[] {
  return layout.contentControls ?? [];
}

/**
 * Axis-aligned union of boxes, or null when the list is empty.
 *
 * Used when a control's content spans several fragments or spans on one page.
 */
export function unionLayoutBoxes(boxes: readonly LayoutBox[]): LayoutBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Collapse raw + ancestor locks into one `ST_Lock` vocabulary value. */
export function effectiveContentControlLock(
  locks: readonly ContentControlLock[]
): ContentControlLock {
  let content = false;
  let removal = false;
  for (const lock of locks) {
    if (lock === 'contentLocked' || lock === 'sdtContentLocked') content = true;
    if (lock === 'sdtLocked' || lock === 'sdtContentLocked') removal = true;
  }
  if (content && removal) return 'sdtContentLocked';
  if (content) return 'contentLocked';
  if (removal) return 'sdtLocked';
  return 'unlocked';
}
