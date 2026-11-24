import type { UnsupportedElementRule } from '../layout/unsupported-content-types.ts';
import type { ResolvedRevisionMarkup } from '../contracts/revision-markup.ts';
// paginated-surface.ts implements and re-exports this public surface contract.
import type { SurfaceParagraphFormat, ParagraphPropertyEdit } from './paragraph-format-contract.ts';
import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { BookmarkIndex, SelectionMark } from '@docx-editor.dev/core/store';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import type {
  SelectionPin,
  TrackedChangeFilterMode,
  TrackedChangePredicate,
  ViewScope,
  TableInteractionLabelKey,
} from '../contracts/editor.ts';
import type { ReviewDisplayMode } from '../layout/revision-projection.ts';
import type { RevisionStyles } from '../output/revision-presentation.ts';
import type { HyperlinkOps } from './surface-hyperlinks.ts';
import type { EquationOps } from './surface-equations.ts';
import type { TocRemovalRefusal } from './surface-toc-commands.ts';
import type { SurfaceNavigation } from './surface-navigation.ts';
import type {
  CellSelection,
  NavigationCommand,
  SectionProperties,
  SemanticLayout,
  SemanticPosition,
  SemanticSelection,
} from '@docx-editor.dev/core/layout';

/**
 * How an edit is written.
 *
 * `'suggest'` is the one that changes what the ops MEAN: the same keystroke becomes a `w:ins`
 * and the same Backspace becomes a `w:del` over the words it would have removed. `'view'`
 * refuses edits outright.
 */
export type SurfaceEditingMode = 'edit' | 'suggest' | 'view';

import type { ReviewWriteIntent } from './review-write-intent.ts';
import type { SurfaceOverlayPainter } from './surface-overlay-sheet.ts';
import type {
  ContentControlOps,
  ContentControlSurfaceState,
} from './surface-content-control-contract.ts';
import type {
  FormatPainterOps,
  FormatPainterSurfaceState,
} from './surface-format-painter-contract.ts';
import type { PaginatedSurfacePerf } from './surface-perf-contract.ts';
import type { SurfaceIndentAndListOps } from './surface-indent-list-contract.ts';
import type { SurfaceChartOps } from './surface-chart-ops.ts';
export type { ReviewWriteIntent, ContentControlOps, ContentControlSurfaceState };
export type {
  FormatPainterLevel,
  FormatPainterMode,
  FormatPainterPaintResult,
} from './surface-format-painter-contract.ts';
export type { FormatPainterOps, FormatPainterSurfaceState };
export type { PaginatedSurfacePerf };

import type { RemoteCaretLabelAnchor, RemoteCaretLabelHost } from './surface-remote-caret-label.ts';
export type { RemoteCaretLabelAnchor, RemoteCaretLabelHost };

import type { PaginatedSurfaceOptions } from './paginated-surface-options.ts';
import type { SurfaceBookmarks } from './surface-bookmarks.ts';

export type { PaginatedSurfaceOptions } from './paginated-surface-options.ts';

import type {
  DrawingSelectionIntent,
  PaginatedSurfaceState,
  RevealOptions,
  SurfaceFormatting,
} from './paginated-surface-state.ts';

export type {
  SurfaceFormatting,
  RevealOptions,
  DrawingSelectionIntent,
  PaginatedSurfaceState,
} from './paginated-surface-state.ts';

/**
 * Where the section after an inserted break begins — Word's Layout > Breaks menu.
 *
 * `evenPage` / `oddPage` sections from a file paginate with their blank parity sheet, but
 * inserting one is not offered here.
 *
 * @public
 */
export type SectionBreakInsertType = 'nextPage' | 'continuous';

/**
 * The mounted, painted, editable document — the layer `createDocxEditor` builds its contract on.
 *
 * The painted pages ARE the editable surface: they are `contenteditable`, but the DOM is a
 * picture. Browser mutations are prevented and re-expressed as tree ops, and selection maps only
 * through `data-paragraph-id`/`data-start`, never through DOM node identity.
 *
 * Every write goes through the guarded mutation path on this object. Reaching past it into
 * `session` to apply ops directly bypasses the layout invalidation and the caret bookkeeping.
 */
export interface PaginatedSurface extends SurfaceIndentAndListOps, SurfaceChartOps {
  readonly session: TreeDocxSessionView;
  /** The collaboration replica a `collaborationModule` attached, or null. */
  collaborationSession(): import('../collaboration/index.ts').EditorCollaborationSession | null;
  storyScope(): import('@docx-editor.dev/core/store').StoryScope;
  imageDecodePort(): import('../store/package/image-resources.ts').ImageDecodePort;
  applyDrawingOps(
    ops: readonly import('../store/store/tree-op-types.ts').DrawingTreeDocOp[]
  ): TreeApplyResult;
  applyImageProperties(
    input: import('../store/store/tree-package-images.ts').ApplyImagePropertiesInput
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;
  deleteImage(
    drawingNodeId: string
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;
  insertImage(
    input: import('./surface-image-ops.ts').SurfaceInsertImageInput
  ): Promise<import('../store/store/tree-package-images.ts').ImageIntentResult>;
  replaceImage(
    drawingNodeId: string,
    bytes: Uint8Array,
    mime: import('../store/package/image-resources.ts').SupportedImageMime,
    options: {
      readonly expectedPackageRevision: number;
      readonly commitGuard?: () => boolean;
    }
  ): Promise<import('../store/store/tree-package-images.ts').ImageIntentResult>;
  pointAt(clientX: number, clientY: number): import('./surface-pointer.ts').SurfacePointHit | null;
  layout(): SemanticLayout;
  /** The measurer layout uses; sizes engine-authored shapes such as a watermark. */
  textMeasurer?(): import('../layout/semantic-records.ts').TextMeasurer;
  state(): PaginatedSurfaceState;
  /** One-based page at the caret, or at the centre of the mounted viewport. */
  currentPage(mode?: 'viewport' | 'caret'): number;
  type(text: string): void;
  /** Author one explicit tracked text change without changing the editing mode. */
  proposeTextChange(
    kind: 'insertion' | 'deletion' | 'replacement',
    text: string,
    author?: string
  ): boolean;
  /** Replace a paragraph range of the active story in place; suggesting tracks it. */
  replaceTextInPlace(paragraphId: string, start: number, end: number, text: string): boolean;
  /**
   * Queue plain typed text for a batched commit at the caret.
   *
   * The DOM input lane's entry: a burst of keystrokes appends here and lands through ONE
   * `type()` call — one transaction, one undo step, one layout flush — when the queue drains.
   * Every surface mutation, selection or scope move, geometry read, composition start and
   * teardown flushes first. Code reading `session` directly sits BELOW the buffer and must
   * call {@link flushPendingInput}, as save/detach do. `type()` stays synchronous.
   */
  enqueueType(text: string): void;
  /**
   * Land any queued typed text now, as its own transaction, AND publish any layout pass a
   * commit deferred under input pressure — so the caller reads current text and current
   * geometry at one seam. Both halves are no-ops when nothing is pending, which is the
   * common case: an isolated commit lays out synchronously in its own tail, and deferral
   * only happens when the browser reports queued input behind an expensive pass.
   */
  flushPendingInput(): void;
  /**
   * Insert text whose newlines are PARAGRAPH BOUNDARIES, in one commit.
   *
   * `type` writes its argument into run text verbatim, so a newline reaching it is a
   * control character the store refuses — which vetoes the whole transaction and makes
   * the insert do nothing at all. This is the lane for text that arrives from outside the
   * editor (a paste, a drop), where line breaks are structure rather than characters.
   *
   * Plain text only, by construction: no markup is parsed and no DOM is built from the
   * payload, whatever its origin.
   */
  insertPlainText(text: string): void;
  deleteBackward(): void;
  /** Delete forward — the Delete key, and `deleteContentForward` from an IME. */
  deleteForward(): void;
  /** Delete to the previous word boundary — Alt/Ctrl+Backspace. */
  deleteWordBackward(): void;
  /** Delete to the next word boundary — Alt/Ctrl+Delete. */
  deleteWordForward(): void;
  splitParagraph(): void;
  /** A tab character as a `w:tab` element, not a literal tab in the run text. */
  insertTab(): void;
  /** A `w:br` — Shift+Enter, a line break inside the same paragraph. */
  insertLineBreak(): void;
  /** A `w:br w:type="page"` — Ctrl+Enter, a hard page break inside the paragraph. */
  insertPageBreak(): void;
  /** Select the whole document. */
  selectAll(): void;
  /**
   * Turn the browser's editing affordance on the pages layer on or off.
   *
   * The facade's `mode` gates COMMANDS, which stops `exec` but not the keyboard: the pages
   * layer is `contentEditable` and binds `beforeinput` itself, so a document the facade
   * called read-only still accepted typing straight into it. Read-only has to reach the
   * surface to be true.
   */
  setEditable(editable: boolean): void;
  /**
   * Scroll a page, or the page a paragraph sits on, into view. Returns whether it
   * scrolled — false when the target is not laid out, or the surface is not inside a
   * scroll container, so a caller can tell "no such target" from "done".
   *
   * The geometry comes from the LAYOUT, never from the DOM: a page that has not been
   * materialized yet has no element to measure, and that is exactly the page a reveal is
   * usually asked for. `revealParagraph` scrolls to the paragraph's own line rather than
   * the top of its page, so a heading deep in a page lands in view.
   */
  revealPage(pageIndex: number, options?: RevealOptions): boolean;
  revealParagraph(paragraphId: string, options?: RevealOptions): boolean;
  /**
   * Scroll an exact position into view — `revealParagraph` for a caret that is not at
   * offset 0. Focus-independent and virtualization-safe like every reveal: geometry
   * comes from the layout and the target page is materialized on the way. Defaults to
   * `block: 'nearest'`, so an already-visible target never yanks the viewport.
   */
  revealPosition(position: SemanticPosition, options?: RevealOptions): boolean;
  /** Set the selection directly, for a host driving the surface programmatically. */
  setSelection(next: SemanticSelection): void;
  /**
   * Select one painted drawing at its host paragraph, as a pointer press would.
   *
   * False when the layout paints no such drawing on that paragraph, in which case nothing
   * moves: the caller decides what to do rather than being left mid-way.
   */
  selectDrawing(drawingNodeId: string, hostParagraphId: string): boolean;
  /**
   * Select one shape inside the selected group, as a second press on the group does, or the
   * group again with null. False when no group is selected or it holds no such shape.
   */
  selectDrawingMember(memberNodeId: string | null): boolean;
  /**
   * Select a rectangle of table cells, or clear one with null.
   *
   * The equivalent text range is installed alongside it, so `state().selection` stays valid
   * for every reader that does not know rectangles exist.
   */
  setCellSelection(next: CellSelection | null): void;
  /**
   * Toggle a run property over the selection, e.g. `b`, `i`, `u`.
   *
   * AT A COLLAPSED CARET this ARMS the property instead of writing it — Word's stored
   * marks. Nothing reaches the document until the next characters are typed there, and
   * those take the armed format; the armed state shows in `formatting()` and in
   * `state().pendingFormat` immediately, so a toolbar reflects the press. It survives the
   * caret-preserving edits (Backspace, Delete, Enter) and IME composition, and is
   * discarded when the caret moves elsewhere or the document is undone. A property the
   * store cannot author is refused at arm time rather than left to poison the keystroke.
   * Returns the document's refusal reason, or null when the write landed, armed, or did nothing.
   */
  toggleRunProperty(localName: string, attributes?: Record<string, string>): string | null;
  /**
   * SET a run property over the selection, rather than toggling it.
   *
   * Font family, size and colour are values, not switches: picking Arial twice must leave
   * the text in Arial, which a toggle would not. Arms at a collapsed caret on the same
   * terms as `toggleRunProperty`, and returns a refusal the same way.
   */
  setRunProperty(localName: string, attributes?: Record<string, string>): string | null;
  /**
   * Several run properties over the selection in ONE transaction: the store accepts or
   * refuses them together, and they undo as one step. `setRunProperty` is this with a
   * single entry.
   */
  setRunProperties(
    entries: readonly { localName: string; attributes?: Record<string, string> }[]
  ): string | null;
  /**
   * Set a property on every paragraph the selection touches — alignment, style, spacing.
   *
   * `mergeAttributes` keeps the attributes the call does not name, for the properties that
   * carry several independent settings in one element: `w:spacing` holds the line rule and
   * the space before and after, so a line-spacing pick must not delete the space-before. A
   * null-valued attribute removes just that one.
   */
  setParagraphProperty(
    localName: string,
    attributes?: Record<string, string | null>,
    options?: Pick<
      ParagraphPropertyEdit,
      'mergeAttributes' | 'physicalAlignment' | 'paragraphDirection'
    >
  ): void;
  /**
   * Several paragraph properties in ONE transaction, so a dialog is one undo step.
   *
   * `setParagraphProperty` is this with a single entry. A dialog that fired one call per
   * field would leave the user pressing Ctrl+Z five times to undo one OK, and would paint
   * four intermediate layouts on the way.
   */
  setParagraphProperties(entries: readonly ParagraphPropertyEdit[]): void;
  /**
   * The Paragraph dialog as ONE write: alignment, indents, spacing, line spacing and the
   * five paragraph flags, over every paragraph the selection touches.
   *
   * One transaction, so pressing OK is one undo step and the page repaints once. An omitted
   * field is left as authored; `null` where the type allows it REMOVES the setting so the
   * style supplies it again. Returns whether anything was written.
   */
  setParagraphFormat(update: SurfaceParagraphFormat): boolean;
  /**
   * Word's Clear All Formatting: direct run properties off the selected text, and every
   * paragraph the selection touches back to the default style with its direct paragraph
   * properties and mark dropped.
   *
   * Only what the document states DIRECTLY — formatting inherited from a style survives, so
   * the text falls back to its style rather than to nothing. Properties an op cannot name
   * (`w:rStyle`, `w:lang`, `w:sectPr`, `w:pBdr`) are preserved for the same reason every
   * other write preserves them.
   */
  clearFormatting(): void;
  /**
   * Formatting as it stands at the selection, for a toolbar to reflect.
   *
   * With a typing format armed at the caret this reports what the NEXT characters typed
   * will look like, not what the document holds — which is the answer a toolbar wants and
   * the one Word gives.
   */
  formatting(): SurfaceFormatting;
  /**
   * The section the document declares: page size, margins, columns, orientation.
   *
   * What a ruler is made of, and what pagination is measured against.
   */
  sectionProperties(): SectionProperties;
  /**
   * The section GOVERNING one paragraph — what a ruler or dialog reflects when the caret sits
   * in a multi-section document.
   *
   * Body content answers for itself, whatever story is open. A header or footer belongs to the
   * section that names its relationship, and a note to the section holding its reference mark.
   * An id nothing settles falls back to the FIRST section: the tail is the document-wide answer
   * and is wrong for everything not on the last page.
   */
  sectionPropertiesAt(paragraphId: string): SectionProperties;
  /**
   * How a section-addressed op should name the section `paragraphId` is in.
   *
   * `w:sectPr` lives on the body story, so such an op can only name body content — and a caret
   * in a header or a note is not body content. Passing that caret straight through made every
   * section write from furniture fail `unknown-paragraph`.
   */
  sectionAnchorParagraphAt(paragraphId: string): import('./section-scope.ts').SectionAnchor;
  /**
   * Write section page-setup fields — size, orientation, margins — as ONE undoable
   * transaction. Twips throughout; omitted fields are left as authored. With
   * `anchorParagraphId` only that paragraph's governing section is written (Word's
   * "Apply to: This section"); without it, every section. Returns whether the write
   * committed (a hostile value is refused by the op layer).
   */
  setSectionProperties(update: {
    readonly pageWidthTwips?: number;
    readonly pageHeightTwips?: number;
    readonly orientation?: 'portrait' | 'landscape';
    readonly marginTopTwips?: number;
    readonly marginRightTwips?: number;
    readonly marginBottomTwips?: number;
    readonly marginLeftTwips?: number;
    readonly anchorParagraphId?: string;
  }): boolean;
  /**
   * Insert a section break at the caret: the paragraph splits, and the head ends a new
   * section cloning the governing section's page setup — Word's Layout > Breaks. One
   * undoable step. Returns whether the break committed.
   *
   * `breakType` says where the section AFTER the break begins: `'nextPage'` (the default,
   * Word's Next Page) starts a new sheet, `'continuous'` keeps it on the sheet the
   * previous section ended, which is how a mid-page column or margin change is authored.
   */
  insertSectionBreak(breakType?: SectionBreakInsertType): boolean;
  /**
   * Why {@link insertSectionBreak} would refuse this kind right now, or `null`.
   *
   * THE authority for the BREAK's own questions, so `Editor.can` and the write cannot answer
   * those differently. Both halves are things only the surface knows: the LIVE editing mode
   * (a document that declares `w:trackRevisions` opens suggesting without anyone passing a
   * mode, and Review > Track Changes moves it again afterwards), and the paragraph the break
   * would actually land in — which for a range in suggesting mode is past the struck words,
   * not the selection's head.
   *
   * NOT the deletion's questions. A break replaces the selection first, and that deletion can
   * cross content a control holds or a region protected some other way; only the store sees
   * that, and it sees it at write time. So a range whose landing is fine while its deletion
   * is not answers `null` here and refuses at the press — as every other replacing command in
   * the engine does, less loudly. Story scope is gated separately again, because a caret in a
   * header refuses every break kind for a different reason.
   */
  sectionBreakRefusal(breakType?: SectionBreakInsertType): string | null;
  /** The layout session, so a host or a test can see how much work a pass actually did. */
  layoutSession(): {
    readonly stats: {
      readonly placed: number;
      readonly total: number;
      readonly reusedPages: number;
    };
  };
  /**
   * The hyperlink lane: what link the caret is in, and the insert / retarget / unlink verbs.
   *
   * Every verb is one `transact`, so it is one undo step. Targets going IN are host-supplied
   * and pass the package's own URL allowlist; targets coming OUT are the sanitized
   * projection, so a caller cannot accidentally hand a refused scheme to a sink.
   */
  readonly hyperlinks: HyperlinkOps;
  readonly equations: EquationOps;
  /**
   * Content-control chrome, form-fill navigation, and value / remove verbs.
   *
   * Value and remove commit through `session.applyTreeOps` — the same write path as typing.
   * Show-all and form-fill are surface chrome and never reflow layout.
   */
  readonly contentControls: ContentControlOps;
  /** Word's Format Painter: capture, apply, and the transient armed mode. */
  readonly formatPainter: FormatPainterOps;
  /** Whether a `rows`×`cols` table can be inserted at the caret. */
  canInsertTable(rows: number, cols: number): boolean;
  /**
   * Insert an empty `rows`×`cols` table at the caret, columns evenly dividing the content
   * width of the caret's section, and leave the caret in the first cell.
   */
  insertTable(rows: number, cols: number): boolean;
  /** Whether the addressed (or caret-local) body TOC can be refreshed. */
  canRefreshToc(tocId?: string): boolean;
  /** Whether a generated body TOC can be inserted before the caret paragraph. */
  canInsertToc(): boolean;
  /** Insert and populate a generated body TOC before the caret paragraph. */
  insertToc(): boolean;
  /** Refresh cached TOC entries and/or page numbers through the two-pass layout pipeline. */
  canEditTextFormField(): boolean;
  editTextFormField(): boolean;
  refreshToc(tocId?: string, mode?: 'entire' | 'pageNumbers'): boolean;
  /**
   * Why the addressed (or right-clicked, or caret-local) body TOC cannot be removed now, or
   * null when it can: `notFound` when there is none, `unsupported` with the reason otherwise.
   */
  removeTocRefusal(tocId?: string): TocRemovalRefusal | null;
  /**
   * Remove a body TOC: its field, or the table of contents control around it with its
   * heading. Text before and after the field stays. One undo step. Refused while suggesting.
   */
  removeToc(tocId?: string): boolean;
  /**
   * Rewrite stale REF field results in the body, footnote and endnote stories so a save
   * exports what the pages paint. Fresh results commit nothing (no transaction, no revision
   * bump, no undo entry); a rewrite is ONE transaction and ONE undo unit across every stale
   * part. Viewing, a non-editable session, and a collaborative session write nothing — the
   * collaboration gate cannot journal the rewrite, so those saves export cached results and
   * the call returns false.
   */
  refreshRefFieldResults(): boolean;
  /**
   * Commit pending form input, refresh REF results, and serialize the document.
   * Throws an error with code `invalidArgs` for invalid form values, or `invalidState`
   * during an active edit. Retry after the edit finishes. A destroyed surface throws
   * with code `destroyed`. Does not change focus.
   */
  save(): Uint8Array;
  /**
   * {@link save} in steps a caller can pause between. Everything `save` does before it
   * serializes happens at the call, and the document is captured then.
   */
  saveSteps(): Generator<void, Uint8Array>;
  /** Whether a body paragraph belongs to a detected TOC boundary or cached result. */
  isInsideToc(paragraphId: string): boolean;
  /**
   * Bookmark jumps and the ONE external-activation gate. A host's popover "open" action
   * calls `openExternal`; nothing else in the engine may call `window.open`.
   */
  readonly navigation: SurfaceNavigation;
  /** List, add, delete and jump to bookmarks, and show their marks. */
  readonly bookmarkEditing: SurfaceBookmarks;
  /**
   * Pin the current selection so it stays VISIBLY selected while focus is elsewhere.
   *
   * A document has one selection: the moment a panel focuses an input of its own the browser
   * takes the highlight off the text, which is when the user most needs to see what the panel
   * is about to act on. This draws the range on the engine's own overlay instead, so it
   * survives the focus move. The MODEL selection is untouched — the op the panel finally runs
   * addresses the same characters it always would.
   *
   * The pin releases itself when the caret leaves the range (either edge counts as inside),
   * which is what lets a host close its panel on "the user clicked somewhere else" without
   * every adapter reimplementing that comparison.
   */
  retainSelection(): SelectionPin;
  /** Drop one owned pin. Another owner's pin remains visible. */
  releaseSelection(pin: SelectionPin): void;
  /** The pinned range, or null once it was released or escaped. */
  retainedSelection(): SemanticSelection | null;
  /**
   * How edits are written right now.
   *
   * Lives on the SURFACE, not on the store. The store's write vocabulary stays explicit —
   * an op says whether it is tracked — and the surface is the one thing that knows a
   * keystroke happened, so it is the right place to decide what that keystroke becomes.
   */
  editingMode(): SurfaceEditingMode;
  setEditingMode(mode: SurfaceEditingMode): void;
  /** Set the ambient author after buffered text commits under the previous author. */
  setAuthor(author: string | undefined): void;
  /** The ambient author tracked edits and review writes record, or undefined. */
  author(): string | undefined;
  /** Replace localized drawing labels and repaint materialized pages. */
  setDrawingStrings(
    strings: import('../output/semantic-paint-drawings.ts').DrawingPaintStrings
  ): void;
  /** Update shared form-control labels without replacing open dialogs. */
  setTranslate(translate: PaginatedSurfaceOptions['translate']): void;
  /** Set regional conventions for subsequent date input without reformatting stored values. */
  setLocale(locale: string | undefined): void;
  /** Replace the localized title used by later TOC insertions. */
  setTocLabels(labels: NonNullable<PaginatedSurfaceOptions['tocLabels']>): void;
  /**
   * Every author with a revision in the CURRENT layout, mapped to Word's colour slot by
   * order of first appearance. One map instance per layout, so a caller can key caches on
   * its identity.
   */
  revisionAuthors(): ReadonlyMap<string, number>;
  /** Reviewers currently projected as accepted, without changing the document. */
  hiddenRevisionAuthors(): ReadonlySet<string>;
  /** Show one reviewer's markup, or render that reviewer's changes as accepted. */
  setRevisionAuthorVisible(author: string, visible: boolean): void;
  /** Show or hide every reviewer in one layout pass. */
  setAllRevisionAuthorsVisible(visible: boolean): void;
  /** Clear the reviewer filter in one layout pass. */
  showAllRevisionAuthors(): void;
  /** Apply a view-time predicate over complete tracked-change items. */
  setTrackedChangesFilter(
    predicate: TrackedChangePredicate | null,
    mode?: TrackedChangeFilterMode
  ): void;
  /** The presence colour the caret paints for `name`, sanitized as the paint sink is. */
  remotePresenceColor(name: string): string | undefined;
  /**
   * Replace how tracked changes are coloured, live. Paint-level: the pages repaint without
   * remeasuring a line, and the caret, selection and undo history stay where they are.
   */
  setRevisionMarkup(settings: ResolvedRevisionMarkup): void;
  setRevisionStyles(colors: RevisionStyles | undefined): void;
  setUnsupportedElementRules(rules: readonly UnsupportedElementRule[]): void;
  /** Toggle paragraph-end furniture without layout or document changes. */
  setShowParagraphMarks(show: boolean): void;
  /**
   * Hand remote-caret label content to the host, or take it back with `null`.
   *
   * With a host set, the engine still creates and positions each label (same class, same
   * presence colour) but leaves it empty, marks it `data-docx-remote-actor`, and calls
   * {@link RemoteCaretLabelHost.publish} after every paint that rebuilt the labels.
   * Registration and unregistration repaint immediately, so the first publish fires
   * without waiting for awareness to move and unregistering restores the default
   * collaborator-name labels.
   */
  setRemoteCaretLabelHost(host: RemoteCaretLabelHost | null): void;
  /**
   * Install the painter for host text highlights, or remove it with `null`. The surface calls
   * it after every render and once on installation, with the frame it just painted.
   */
  setHighlightPainter(painter: SurfaceOverlayPainter | null): void;
  /** Call the installed highlight painter against the current frame. */
  repaintHighlights(): void;
  /**
   * Commit ops that came from automation, through the gate a keystroke goes through.
   *
   * The narrow entry an automation host writes with, and the reason it needs one: reaching
   * `session.applyTreeOps` past this skips the editing-mode gate entirely — a document open for
   * viewing accepts a scripted edit, and a suggesting document records one as a permanent
   * change with no proposal and no author. Here, viewing refuses, suggesting attributes, the
   * refusal reason is reported like any other, and the pages repaint from the commit.
   *
   * The ops address the story the CALLER named, whatever story the reader is in: the caller
   * identified its target before calling, so following the caret into a header would write
   * somewhere else entirely. They default to the body rather than to the reader's story.
   *
   * They arrive as a BUILDER, given a way to mint the relationship an external hyperlink names.
   * That mint changes the package outside the transaction and outside the undo stack, so it must not
   * happen until the mode has allowed the write — a link minted while the batch was still being
   * planned left its target in a read-only document's `.rels`. A builder answering null means the
   * target is one this engine will not author, and the write is refused having changed nothing.
   */
  applyAutomationOps(
    staged: (relate: (url: string) => string | null) => readonly TreeDocOp[] | null,
    scope?: StoryScope,
    packageEdits?: readonly ((
      pkg: import('../store/package/ooxml-package.ts').OoxmlPackage
    ) => import('../store/package/ooxml-package.ts').OoxmlPackage)[],
    requiresReview?: boolean,
    /**
     * Carry the reader's selection across the committed ops, before it is clamped to the open
     * story. Omitted, the selection keeps its offsets.
     */
    carry?: (selection: SemanticSelection) => SemanticSelection
  ): TreeApplyResult;
  /**
   * Which revision halves this surface is SHOWING.
   *
   * Read by the automation adapter so the object model's formatting reaches the same runs the
   * toolbar does. A range's offsets cover every revision half whatever the view does with
   * them, so with markup on, a selection over a struck word means one thing to a reader and
   * would mean another to a script that assumed the resolved result.
   */
  revisionDisplayMode(): ReviewDisplayMode;
  /** Change the review display without accepting, rejecting, or changing author filters. */
  setRevisionDisplayMode(mode: ReviewDisplayMode): void;
  /**
   * Where a replacement for `[start, end)` of a paragraph lands, or null when the edit would
   * not be tracked.
   *
   * Non-null exactly when suggesting: the struck words stay, so the replacement goes past
   * them, minus whatever of the range was this author's own pending insertion, which leaves.
   * The SAME rule every replacing lane of the keyboard reads, exposed so the automation object
   * model aims a scripted `Replace` where typing does and can answer the span it wrote.
   */
  replacementLanding(paragraphId: string, start: number, end: number): number | null;
  /**
   * Commit review ops — accept, reject, a new comment — through the SAME path a keystroke
   * takes: layout, paint, and a caret clamped to what the document now holds.
   *
   * `intent` names WHICH review write this is, so a lane that judges them can tell them apart.
   * The callback is opaque, and a replica admits only the writes proven to replicate — see
   * {@link ReviewWriteIntent}.
   *
   * Applying them straight to the session skipped all three. Rejecting an insertion left the
   * pages painting text the tree no longer had, every card anchored where it used to be, and
   * the caret past the end of the paragraph — after which every keystroke was refused with
   * `offset-out-of-range` until the user happened to click somewhere else.
   *
   * Returns null when the write went through, and otherwise why it did not: the external
   * refresh when the write guard skipped the commit, a gate's reason (viewing, collaboration)
   * when `run` never ran, or the reason `run` reported. A `run` that commits nothing without a
   * reason counts as refused (`'rejected'`). Gate and `run` reasons also become
   * `lastRejection`; a skipped refresh changes nothing, `lastRejection` included.
   *
   * `run` receives the store history token of this commit, for the store write it performs.
   */
  commitReviewOps(
    run: (historyToken: symbol | undefined) => {
      readonly committed: boolean;
      readonly reason?: unknown;
    },
    intent?: ReviewWriteIntent
  ): string | null;
  /**
   * The layout as last PUBLISHED, without forcing pending work.
   *
   * `layout()` flushes first, which is right for a caller that is about to act on geometry
   * and wrong for one that merely decorates it. The review rail read through `layout()` and
   * so forced a synchronous full pass on every keystroke — eleven seconds per read on a
   * 2432-block document. A card whose anchor is one frame stale is invisible; the paint that
   * follows the flush republishes it.
   */
  publishedLayout(): SemanticLayout;
  /**
   * How the current selection came to address a drawing, if it does at all.
   *
   * Word's rule: a caret NEXT TO a floating object is a text caret, never an object selection —
   * only clicking the object (or a host selection write) selects it. The engine's selection is a
   * caret at the anchor offset either way, so offsets cannot tell them apart; this is the
   * discriminator. `none` for a fresh mount (the initial caret routinely coincides with a drawing
   * anchored at offset zero) and after typing, caret keys, or a press on a non-drawing. `pointer`
   * names the drawing the press landed on, so a stale press cannot claim a later one.
   */
  drawingSelectionIntent(): DrawingSelectionIntent;
  /**
   * Paint-scale coordinate context for overlay chrome.
   *
   * Internal seam — not part of the public editor contract. Image overlay uses the same
   * `zoom * 96/72` scale and per-page horizontal offsets the painter applied.
   */
  overlayCoordinates(): import('./surface-overlay-coordinates.ts').SurfaceOverlayCoordinates;
  /**
   * The insertion point at the selection head in client pixels, as the painted caret places
   * it, whether or not it paints right now. Null when the head is not on a painted page.
   * Runs a pending layout pass first, so the geometry and a carried caret are current. Typed
   * characters still buffered under input pressure stay buffered, as they stay unpainted.
   */
  caretClientRect(): import('../contracts/editor-highlights.ts').HighlightRect | null;
  /**
   * Whether a remote commit is waiting for the next layout pass to carry the selection. Until
   * it runs, `state().selection` addresses the text from before that commit.
   */
  remoteSelectionPending(): boolean;
  /**
   * The comment, tracked change or carded custom node the caret is in, as the painted bands
   * report it. A custom node without `reviewCard` is never the answer: it has no card.
   *
   * ONE source for "which item is open". The band under the text and the card beside it are
   * two views of the same answer, and deriving it twice let them disagree — the card closed
   * while the text stayed highlighted.
   */
  activeReviewKey(): string | null;
  /**
   * Open THIS item, named by key, for as long as `selection` stays the live one.
   *
   * Without it the caret is the only evidence of which card is open, and a caret cannot name a
   * card when two cards cover exactly the same characters: `w:ins` wrapping `w:del` — content
   * one reviewer added and another struck — gives the insertion and the deletion one identical
   * range, and every click on either card classified back to whichever the queue happened to
   * list first. The reader clicked "Deleted" and watched "Added" light up.
   *
   * A key, not a position, because the position is precisely what is ambiguous. It holds only
   * while the selection matches; a pointer or keyboard move hands the answer back to the caret,
   * which is what lets the reader step out of a card by clicking away from it.
   *
   * `selection` is what activation wants installed, and it is installed HERE rather than by a
   * `setSelection` of the caller's own so that the pin is up before anything is published. The
   * other order repainted the bands and reported state while the caret was still the only
   * evidence, so a host saw the wrong twin active for one frame and then a correction. Omit it
   * to pin against the live selection, which is what a header or note scope has already set.
   * `preventScroll` installs `selection` with no scroll, now or on a later repaint.
   */
  activateReview(
    key: string,
    selection?: SemanticSelection,
    options?: { readonly allowExcluded?: boolean; readonly preventScroll?: boolean }
  ): void;
  /**
   * The key {@link activateReview} pinned, or null once its selection is no longer live.
   *
   * Exists so nothing outside the surface keeps its own copy of "the selection came from
   * opening a card". `selectionPlacement` needs that fact to stay quiet about offering a
   * comment on text the reader only selected by opening a card over it, and the copy it used to
   * keep was set on one of activation's three branches, so a header card offered to comment on
   * itself.
   */
  activatedReviewKey(): string | null;
  /**
   * Close the open item until the caret next moves.
   *
   * What a click on the canvas means. The caret does not move when someone clicks the grey
   * around the page, so nothing else would ever put the item away.
   */
  dismissActiveReview(): void;
  /**
   * Revision kinds the CARET must not activate, or null for none.
   *
   * The review rail filters what it renders (structural and format cards are hidden by
   * default), but {@link activeReviewKey} used to compute over the unfiltered queue — a
   * click on tracked text under a format change activated a card the rail does not draw,
   * and nothing on screen lit up. A host that filters its list tells the surface, so the
   * band and the visible cards stay one answer.
   */
  setReviewActivationExclusions(
    kinds: readonly import('@docx-editor.dev/core/store').ReviewRevisionKind[] | null,
    options?: { readonly formattingKinds?: readonly string[] }
  ): void;
  /**
   * `bookmarkName -> position` over the current revision, for resolving an internal link.
   * First in document order wins a duplicate name, matching Word.
   */
  bookmarks(): BookmarkIndex;
  /** The selected text, for copy and cut. */
  selectedText(): string;
  /**
   * Every clipboard flavour for the current selection: plain text, and the interop HTML
   * carrying the embedded fragment when the selection is a body-story range. A cell rectangle
   * answers grid text plus a flattened table; `html` is null where only plain text should be
   * written. One selected chart copies whole and names its drawing in `chartDrawingNodeId`,
   * which a cut deletes. A chart inside a wider selection refuses as `'chart-content'`, another
   * object as `'unsupported-content'`.
   */
  copyFlavours(): {
    readonly text: string;
    readonly html: string | null;
    readonly reason?: 'unsupported-content' | 'chart-content';
    readonly chartDrawingNodeId?: string;
  };
  /**
   * Route one paste payload by fidelity: embedded fragment, then external HTML, then
   * plain text. Unsupported object fragments refuse without fallback. Other decode, read,
   * or apply failures can degrade. Suggesting mode, non-body
   * stories and an armed force-plain all land on the plain lane. False when the payload
   * landed on no lane at all (nothing to insert).
   */
  pasteRich(text: string, html: string | null): boolean;
  /** The next paste routes plain, whatever its payload carries (Cmd+Shift+V). */
  armForcePlainPaste(): void;
  /** Remove the selection, if any. Returns whether anything was deleted. */
  deleteSelection(): boolean;
  navigate(command: NavigationCommand, extend?: boolean): void;
  /** Reverse the last history entry and put the caret back where it was made. */
  undo(): void;
  redo(): void;
  /**
   * Refresh table insertion furniture labels without remounting or relayout.
   *
   * @public
   */
  refreshTableInteractionLabels(): void;
  focus(): void;
  /**
   * Refresh table insertion furniture labels without remounting the surface.
   *
   * @public
   */
  setTableInteractionLabel(resolver: (key: TableInteractionLabelKey) => string): void;
  /**
   * Move the painted pages into `container`, which may belong to another document: a pop-out
   * window or an iframe. The session, undo history, selection and collaboration replica stay
   * as they are; only the DOM and the document- and window-level listeners move. Open
   * content-control menus close.
   */
  moveTo(container: HTMLElement, options?: { readonly focus?: boolean }): void;
  /**
   * Take the pages out of their container and keep them, with all editing state, for a later
   * `moveTo`. A parked surface still accepts commands and remote edits; it paints into a
   * private, disconnected holder until it moves again.
   */
  park(): void;
  /** Whether the surface is parked: mounted nowhere, state kept. */
  parked(): boolean;
  /** The element the pages are in now: the host's, or a private holder while parked. */
  hostElement(): HTMLElement;
  destroy(): void;
  /**
   * The section a painted page belongs to, and the page that section starts on.
   *
   * Published because opening a furniture story without a page opens it without a section, and
   * the section is what the ruler clamps to and what a new table's grid is divided from. One
   * header part can serve several sections, so only the page settles which one the reader is
   * looking at.
   */
  sectionAtPage(pageIndex: number): { sectionIndex: number; sectionStart: number };
  /** Active editing view — body, or an open header/footer story by rId. */
  activeScope(): ViewScope;
  /** Activate a view scope. Returns false when a header/footer rId cannot be opened. */
  setActiveScope(scope: ViewScope): boolean;
  /**
   * Open a header/footer story for editing on the painted surface.
   * Refuses dangling / unknown relationship ids.
   */
  enterHeaderFooter(args: {
    readonly rId: string;
    readonly pageIndex?: number;
    readonly sectionIndex?: number;
    readonly kind?: 'header' | 'footer';
    readonly variant?: 'default' | 'first' | 'even';
    readonly position?: import('@docx-editor.dev/core/layout').SemanticPosition;
  }): boolean;
  /** Leave furniture editing and restore the prior body selection. */
  exitHeaderFooter(): void;
  /** Chrome read-model for the open furniture scope, or null when editing the body. */
  headerFooterState(): {
    readonly editing: 'header' | 'footer' | null;
    readonly sectionIndex: number;
    readonly variant?: 'default' | 'first' | 'even';
    readonly rId?: string;
    readonly partName?: string;
    readonly inherited?: boolean;
    readonly titlePage?: boolean;
    readonly evenAndOddHeaders?: boolean;
    readonly headerDistanceTwips?: number;
    readonly footerDistanceTwips?: number;
  } | null;
  /**
   * Commit one package-level furniture lifecycle op (create/delete/link/unlink/options).
   * Flushes layout so the next enter/rebind sees the new resolution.
   */
  applyHeaderFooterLifecycle(op: {
    readonly op:
      | 'createHeaderFooter'
      | 'deleteHeaderFooter'
      | 'linkToPrevious'
      | 'unlinkFromPrevious'
      | 'setSectionFurnitureOptions'
      | 'setDocumentProtection'
      | 'setWatermark';
    readonly sectionIndex?: number;
    /** `setWatermark` only: the new watermark, or null to remove it. */
    readonly watermark?:
      import('../store/package/watermark-package.ts').PackageWatermarkWrite | null;
    /** `setDocumentProtection` only: enforce filling-in-forms protection, or lift it. */
    readonly enforce?: boolean;
    readonly kind?: 'header' | 'footer';
    readonly variant?: 'default' | 'first' | 'even';
    readonly titlePage?: boolean;
    readonly evenAndOddHeaders?: boolean;
    readonly headerDistanceTwips?: number;
    readonly footerDistanceTwips?: number;
  }): { readonly ok: true } | { readonly ok: false; readonly reason: string };
  /** Insert an allowlisted page field at the caret in the open HF story. */
  insertPageField(field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y'): boolean;
  /** Insert a footnote/endnote at the body caret. */
  insertNote(noteKind: 'footnote' | 'endnote'): boolean;
  deleteNote(noteKind: 'footnote' | 'endnote', noteId: number): boolean;
  convertNote(fromKind: 'footnote' | 'endnote', noteId: number): boolean;
  convertAllNotes(fromKind: 'footnote' | 'endnote'): boolean;
  setNoteProperties(args: {
    readonly scope: 'document' | 'section';
    readonly sectionIndex?: number;
    readonly footnote?: {
      readonly numFmt?: string;
      readonly numRestart?: string;
      readonly position?: string;
      readonly numStart?: number;
    };
    readonly endnote?: {
      readonly numFmt?: string;
      readonly numRestart?: string;
      readonly position?: string;
      readonly numStart?: number;
    };
  }): boolean;
  enterNote(scopeId: string, position?: { paragraphId: string; offset: number }): boolean;
  exitNote(): void;
  /** Resolved/authored note properties for the caret section — chrome read-model. */
  notePropertiesState(): import('./surface-note-state.ts').NotePropertiesStateSnapshot | null;
  /** Plain-text preview for hover chrome — never returns markup. */
  notePreviewText(scopeId: string): string | null;
  /** Commit one table-command plan as a single store transaction. */
  applyTableCommandPlan(
    plan: import('./table-command-plan.ts').TableCommandPlan
  ): import('../contracts/editor.ts').ExecResult;
}

/**
 * What opening a document produced: a mounted surface, or a refusal.
 *
 * A result rather than a throw, because every refusal here comes from FILE input — a package the
 * bounded reader rejected, a part that exceeded a limit — and a malformed upload should surface
 * as a message the host can show rather than an exception it has to catch.
 */
export type OpenPaginatedResult =
  | { readonly ok: true; readonly surface: PaginatedSurface }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly detail?: string;
      /** The resource limit the package crossed, when the reason is a size refusal. */
      readonly limit?: string;
    };

export type {
  ParagraphDisagreements,
  ParagraphFlags,
  ParagraphTabStop,
  ParagraphPropertyEdit,
  SurfaceParagraphFormat,
} from './paragraph-format-contract.ts';

/** The surface with the internal members that other editor modules reach by cast. */
export type ScaleMutableSurface = PaginatedSurface & {
  setScale(nextScale: number): boolean;
  /**
   * Why the mode rules would refuse these automation ops now, or null: the check
   * `applyAutomationOps` makes, without writing. A preview fork asks it so it refuses what a
   * commit would.
   */
  automationWriteRefusal(ops: readonly TreeDocOp[], packageEdits: boolean): string | null;
  /**
   * The gated, attributed session write for command lanes that live OUTSIDE this file —
   * today the content-control commands. Same collaboration gate and actor attribution as
   * the typing lane (`applyJournaledOps`); the command's own mode/lock gate has already
   * run. Internal, reached by cast like `setScale` — see `applyGatedSurfaceTreeOps` in
   * `content-controls.ts` for the accessor.
   */
  applyGatedTreeOps(
    ops: readonly TreeDocOp[],
    selectionBefore?: SelectionMark | null,
    selectionAfter?: SelectionMark | null,
    scope?: StoryScope
  ): TreeApplyResult;
};
