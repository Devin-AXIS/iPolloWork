import type { SurfaceCaretInput } from './surface-caret.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import { authoredRunPropertiesAt } from './surface-formatting.ts';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { ViewScope } from '../contracts/editor.ts';
import { translateParagraphFragment } from '../layout/paragraph-frame.ts';
import type { SemanticLayout, SemanticSelection } from '../layout/index.ts';
import { storyParagraphs } from '../store/package/story-blocks.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';
import {
  textboxDrawingOnPage,
  type TextboxDrawingRecord,
} from '../layout/textbox-drawing-records.ts';
import { furnitureTextboxDrawingsOnPage } from '../layout/furniture-textbox-records.ts';
import { textboxTakesCaret } from './textbox-caret-rules.ts';

type FrameScope = Extract<ViewScope, { kind: 'frame' }>;
type FurnitureOwner = { readonly kind: 'headerFooter'; readonly rId: string };

/** Where a text box being edited sits: its page, its record, and its extent's content origin. */
interface Placement {
  readonly pageIndex: number;
  readonly drawing: TextboxDrawingRecord;
  readonly origin: Readonly<{ x: number; y: number }>;
  /** The furniture story kind of a header or footer box. */
  readonly kind?: 'header' | 'footer';
}

/**
 * Where the box of `scope` sits in `layout`. A body box sits on one page. A header or footer
 * box repeats on every page that shows its story, so the preferred page wins when it shows it.
 */
function placementOf(
  layout: SemanticLayout,
  scope: FrameScope,
  preferredPage?: number
): Placement | null {
  const owner = scope.owner;
  if (!owner) {
    for (const page of layout.pages) {
      const drawing = textboxDrawingOnPage(page, scope.drawingNodeId);
      if (drawing) return { pageIndex: page.index, drawing, origin: drawing };
    }
    return null;
  }
  if (owner.kind !== 'headerFooter') return null;
  const candidate = preferredPage === undefined ? undefined : layout.pages[preferredPage];
  const preferred = candidate?.index === preferredPage ? candidate : undefined;
  for (const page of preferred ? [preferred, ...layout.pages] : layout.pages) {
    const found = furnitureTextboxDrawingsOnPage(page).find(
      (record) =>
        record.drawing.drawingNodeId === scope.drawingNodeId &&
        (record.rId === undefined || record.rId === owner.rId)
    );
    if (found)
      return {
        pageIndex: page.index,
        drawing: found.drawing,
        origin: found.origin,
        kind: found.kind,
      };
  }
  return null;
}

/**
 * The text area of the header or footer box under a press on the pressed sheet, topmost
 * first. With the stories closed, only a double press counts, and a box behind the text
 * never does: the body text over it keeps the press.
 */
function furnitureContentAt(
  element: Element | null,
  press: { readonly clientX: number; readonly clientY: number; readonly double: boolean },
  openRId: string | undefined
): Element | null {
  if (!press.double && openRId === undefined) return null;
  const sheet = element?.closest('[data-page-index]');
  if (!sheet) return null;
  // Text of the open story keeps a press over a box behind it: the text is in front.
  const onOpenText =
    openRId !== undefined && !!element?.closest('[data-docx-hf-active] [data-start]');
  const contents = [...sheet.querySelectorAll('.docx-drawing-textbox-content')].reverse();
  for (const content of contents) {
    const layer = content.closest('[data-docx-hf], [data-docx-hf-front], [data-docx-hf-behind]');
    const behind = !!layer?.hasAttribute('data-docx-hf-behind');
    if (!layer || (behind && (openRId === undefined || onOpenText))) continue;
    const rect = content.getBoundingClientRect();
    if (
      press.clientX >= rect.left &&
      press.clientX <= rect.right &&
      press.clientY >= rect.top &&
      press.clientY <= rect.bottom
    )
      return content;
  }
  return null;
}

/**
 * The first sheet in view, or undefined when none is (or nothing is laid out). In view means
 * inside the editor's scroll viewport, or the window's when the editor has none.
 */
function visiblePageIndex(pagesLayer: HTMLElement): number | undefined {
  const scroller = pagesLayer.closest('.docx-editor__scroll-container');
  const view = scroller?.getBoundingClientRect() ?? {
    top: 0,
    bottom: pagesLayer.ownerDocument.defaultView?.innerHeight ?? 0,
  };
  for (const sheet of pagesLayer.querySelectorAll<HTMLElement>('.docx-page[data-page-index]')) {
    const rect = sheet.getBoundingClientRect();
    if (rect.bottom > view.top && rect.top < view.bottom) return Number(sheet.dataset.pageIndex);
  }
  return undefined;
}

/**
 * Reuse the surface's text input and history with a textbox's own paragraph geometry.
 *
 * A box in a header or footer is edited inside that story: entering it opens the story first,
 * which keeps writes, undo and collaboration on the story's part, and the box edits on the
 * page it was entered from.
 */
export function createTextboxEditing(deps: {
  session: TreeDocxSessionView;
  pagesLayer: HTMLElement;
  layout(): SemanticLayout;
  selection(): SemanticSelection;
  setSelection(selection: SemanticSelection): void;
  flush(): void;
  /** Leave the note and any header or footer other than `owner`. */
  leaveOtherStories(owner?: FurnitureOwner): void;
  writable(): boolean;
  /** The part a node id names, without opening a story for it. */
  partOf(nodeId: string): OoxmlPart | null;
  headerFooter: {
    /** The open header or footer story, and the page it is edited on. */
    active(): { readonly rId: string; readonly pageIndex: number } | null;
    enter(rId: string, pageIndex: number, kind: 'header' | 'footer'): boolean;
  };
}) {
  let active: FrameScope | null = null;
  let activePage: number | undefined;
  let saved: SemanticSelection | null = null;
  let cached: { base: SemanticLayout; id: string; layout: SemanticLayout } | null = null;
  const boxPartOf = (scope: FrameScope) =>
    scope.owner ? deps.partOf(scope.drawingNodeId) : deps.session.part();
  const storyOf = (scope: FrameScope) => {
    const part = boxPartOf(scope);
    return part
      ? textboxStoriesInPart(part).find(
          (story) => story.root.id === scope.id && story.drawingNodeId === scope.drawingNodeId
        )
      : undefined;
  };
  const root = () => active && storyOf(active);
  /** A box whose header or footer closed under it is no longer being edited. */
  const ownerOpen = (scope: FrameScope) =>
    !scope.owner ||
    (scope.owner.kind === 'headerFooter' && deps.headerFooter.active()?.rId === scope.owner.rId);
  const syncDom = () => {
    // A deleted box returns the caret to where it was; a closed story already placed it.
    if (active && !ownerOpen(active)) {
      exit(false);
      return;
    }
    if (active && !root()) {
      exit();
      return;
    }
    // The open story can move after pagination or viewport materialization changes.
    // Keep the box's bindings and cached caret geometry on that same occurrence.
    const owner = active?.owner;
    const open = owner?.kind === 'headerFooter' ? deps.headerFooter.active() : null;
    if (open && activePage !== open.pageIndex) {
      activePage = open.pageIndex;
      cached = null;
    }
    for (const box of deps.pagesLayer.querySelectorAll<HTMLElement>('.docx-drawing-textbox')) {
      // A header or footer box repeats on every page of its story; only the copy on the page
      // it is edited on binds, so the native selection and focus stay with the engine caret.
      const editing =
        box.dataset.drawingNodeId === active?.drawingNodeId &&
        (activePage === undefined ||
          box.closest('[data-page-index]')?.getAttribute('data-page-index') === String(activePage));
      const was = box.dataset.docxTextboxActive;
      // Kept elements carry their last state; a repainted box comes with inert bindings.
      if (was === String(editing)) continue;
      box.dataset.docxTextboxActive = String(editing);
      box.contentEditable = editing ? 'true' : 'false';
      box.setAttribute('role', editing ? 'textbox' : 'img');
      if (editing) {
        box.removeAttribute('aria-hidden');
        box.setAttribute('aria-multiline', 'true');
      } else {
        box.removeAttribute('aria-multiline');
        if (!box.hasAttribute('aria-label')) box.setAttribute('aria-hidden', 'true');
        if (was !== 'true') continue;
      }
      for (const bound of box.querySelectorAll<HTMLElement>('[data-textbox-paragraph-id]')) {
        if (editing) bound.dataset.paragraphId = bound.dataset.textboxParagraphId;
        else delete bound.dataset.paragraphId;
      }
    }
  };
  const exit = (restore = true) => {
    if (!active) return;
    deps.flush();
    active = null;
    activePage = undefined;
    cached = null;
    syncDom();
    if (restore && saved) deps.setSelection(saved);
    saved = null;
  };
  const enter = (scope: FrameScope, pageIndex?: number): boolean => {
    if (scope.owner && scope.owner.kind !== 'headerFooter') return false;
    if (!deps.writable()) return false;
    deps.flush();
    const part = boxPartOf(scope);
    const story =
      part &&
      textboxStoriesInPart(part).find(
        (candidate) =>
          candidate.root.id === scope.id &&
          candidate.drawingNodeId === scope.drawingNodeId &&
          candidate.hostParagraphId === scope.hostParagraphId
      );
    const open = deps.headerFooter.active();
    const owner = scope.owner as FurnitureOwner | undefined;
    // A box in the open story edits on its page; otherwise on the page in view, so an entry
    // from code opens the copy the reader looks at rather than the first one.
    const preferred =
      pageIndex ??
      (owner
        ? open?.rId === owner.rId
          ? open.pageIndex
          : visiblePageIndex(deps.pagesLayer)
        : undefined);
    const placed = placementOf(deps.layout(), scope, preferred);
    const drawing = placed?.drawing;
    if (!part || !story || !placed || !drawing || !textboxTakesCaret(part, story.root.id, drawing))
      return false;
    const first = drawing.textboxStory.fragments[0];
    if (!first || first.kind !== 'paragraph') return false;
    if (active?.id === scope.id && activePage === (owner ? placed.pageIndex : undefined))
      return true;
    exit();
    // A header or footer box edits inside its story: open that story on the box's page, so
    // the open band and the section it edits are the box's.
    if (owner && (open?.rId !== owner.rId || open.pageIndex !== placed.pageIndex)) {
      if (!placed.kind || !deps.headerFooter.enter(owner.rId, placed.pageIndex, placed.kind))
        return false;
    }
    deps.leaveOtherStories(owner);
    saved = deps.selection();
    active = scope;
    activePage = owner ? placed.pageIndex : undefined;
    cached = null;
    syncDom();
    const position = { paragraphId: first.paragraphId, offset: first.range.start };
    deps.setSelection({ anchor: position, head: position });
    return true;
  };
  const placement = (base: SemanticLayout) =>
    active ? placementOf(base, active, activePage) : null;
  let refused: { readonly drawingNodeId: string; readonly hostParagraphId: string } | null = null;
  /**
   * The frame scope of the text box drawing `drawingNodeId`: a body box, or a header or footer
   * box on `pageIndex` (or the first page that shows it), with the story it belongs to.
   */
  const scopeOfDrawing = (
    drawingNodeId: string,
    pageIndex?: number
  ): {
    readonly scope: FrameScope;
    readonly pageIndex?: number;
    readonly kind?: 'header' | 'footer';
  } | null => {
    const body = textboxStoriesInPart(deps.session.part()).find(
      (candidate) => candidate.drawingNodeId === drawingNodeId
    );
    if (body)
      return {
        scope: {
          kind: 'frame',
          id: body.root.id,
          drawingNodeId,
          hostParagraphId: body.hostParagraphId,
        },
      };
    const part = deps.partOf(drawingNodeId);
    const owned =
      part &&
      textboxStoriesInPart(part).find((candidate) => candidate.drawingNodeId === drawingNodeId);
    if (!owned) return null;
    const layout = deps.layout();
    const at = pageIndex === undefined ? undefined : layout.pages[pageIndex];
    const pages = at && at.index === pageIndex ? [at, ...layout.pages] : layout.pages;
    for (const page of pages) {
      const record = furnitureTextboxDrawingsOnPage(page).find(
        (found) => found.drawing.drawingNodeId === drawingNodeId
      );
      if (!record?.rId) continue;
      return {
        scope: {
          kind: 'frame',
          id: owned.root.id,
          drawingNodeId,
          hostParagraphId: owned.hostParagraphId,
          owner: { kind: 'headerFooter', rId: record.rId },
        },
        pageIndex: page.index,
        kind: record.kind,
      };
    }
    return null;
  };
  return {
    active: () => active,
    replacementFormatOps(paragraphId: string, offset: number, length: number): TreeDocOp[] {
      const { anchor, head } = deps.selection();
      const part = active && boxPartOf(active);
      if (
        !part ||
        length === 0 ||
        (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset)
      )
        return [];
      const properties = authoredRunPropertiesAt(part, paragraphId, offset);
      return properties.length
        ? [{ op: 'setRunProperties', paragraphId, start: offset, end: offset + length, properties }]
        : [];
    },
    enter: (scope: FrameScope) => enter(scope),
    exit,
    syncDom,
    contains: (paragraphId: string) => {
      const story = root();
      return !!story && storyParagraphs(story.root).some((p) => p.id === paragraphId);
    },
    paragraphIds: () => {
      const story = root();
      return story ? storyParagraphs(story.root).map((p) => p.id) : [];
    },
    caretInput(
      base: SemanticLayout
    ): Partial<Pick<SurfaceCaretInput, 'scopedHost' | 'scopedHostKind' | 'scopedOrigin'>> {
      const placed = placement(base);
      if (!placed) return {};
      const id = placed.drawing.drawingNodeId;
      // The box on the page being edited: a header box is painted once per page.
      const box = [...deps.pagesLayer.querySelectorAll<HTMLElement>('.docx-drawing-textbox')].find(
        (element) =>
          element.dataset.drawingNodeId === id &&
          element.closest<HTMLElement>('[data-page-index]')?.dataset.pageIndex ===
            String(placed.pageIndex)
      );
      const host = box?.querySelector<HTMLElement>('.docx-drawing-textbox-content');
      if (!host) return {};
      const story = placed.drawing.textboxStory;
      return {
        scopedHost: host,
        scopedHostKind: 'textbox',
        scopedOrigin: {
          x: placed.origin.x + story.contentOffset.x,
          y: placed.origin.y + story.contentOffset.y,
        },
      };
    },
    layout(base: SemanticLayout): SemanticLayout {
      if (!active) return base;
      if (cached?.base === base && cached.id === active.id) return cached.layout;
      const placed = placement(base);
      const story = placed?.drawing.textboxStory;
      // Only the page being edited carries the story, so a header box shared by many pages
      // lays its paragraphs out once.
      const fragments =
        placed && story
          ? story.fragments.flatMap((fragment) =>
              fragment.kind === 'paragraph'
                ? [
                    translateParagraphFragment(
                      fragment,
                      placed.origin.x + story.contentOffset.x,
                      placed.origin.y + story.contentOffset.y
                    ),
                  ]
                : []
            )
          : [];
      const layout: SemanticLayout = {
        ...base,
        pages: base.pages.map((page) => ({
          ...page,
          header: undefined,
          footer: undefined,
          footnotes: undefined,
          endnotes: undefined,
          anchoredDrawings: [],
          fragments: active!.owner
            ? page.index === placed?.pageIndex
              ? fragments
              : []
            : textboxDrawingOnPage(page, active!.drawingNodeId)
              ? fragments
              : [],
        })),
      };
      cached = { base, id: active.id, layout };
      return layout;
    },
    /** Enter the text box of a selected drawing, as Enter on a selected box does. */
    enterDrawing(drawingNodeId: string): boolean {
      const open = deps.headerFooter.active();
      const target = scopeOfDrawing(drawingNodeId, open?.pageIndex);
      return !!target && enter(target.scope, target.pageIndex);
    },
    /**
     * A header or footer box that a press reached but whose text cannot take a caret (turned
     * text, vertical text, a table). The press selects it as an object instead, so the reader
     * sees which box it is; taking it clears it.
     */
    takeRefusedPress(): {
      readonly drawingNodeId: string;
      readonly hostParagraphId: string;
    } | null {
      const taken = refused;
      refused = null;
      return taken;
    },
    /**
     * Enter the box a press lands in. A header or footer box paints inert while its story is
     * closed, so the press reaches the body under it; `press` finds it by geometry instead: a
     * double press enters it, as it opens a header, and a single press does once the story
     * is open.
     */
    preparePointer(
      element: Element | null,
      press?: { readonly clientX: number; readonly clientY: number; readonly double: boolean }
    ): boolean {
      refused = null;
      const content =
        element?.closest('.docx-drawing-textbox-content') ??
        (press ? furnitureContentAt(element, press, deps.headerFooter.active()?.rId) : null);
      const id = content?.closest<HTMLElement>('[data-drawing-node-id]')?.dataset.drawingNodeId;
      const pageIndex = Number(
        content?.closest<HTMLElement>('[data-page-index]')?.dataset.pageIndex
      );
      const target = id
        ? scopeOfDrawing(id, Number.isInteger(pageIndex) ? pageIndex : undefined)
        : null;
      if (target && enter(target.scope, target.pageIndex)) return true;
      exit(false);
      const owner = target?.scope.owner;
      if (
        target &&
        owner?.kind === 'headerFooter' &&
        target.kind &&
        target.pageIndex !== undefined
      ) {
        // Open the story the box belongs to, so the box can be selected inside it.
        const open = deps.headerFooter.active();
        const opened =
          (open?.rId === owner.rId && open.pageIndex === target.pageIndex) ||
          deps.headerFooter.enter(owner.rId, target.pageIndex, target.kind);
        if (opened)
          refused = {
            drawingNodeId: target.scope.drawingNodeId,
            hostParagraphId: target.scope.hostParagraphId,
          };
      }
      return false;
    },
  };
}
