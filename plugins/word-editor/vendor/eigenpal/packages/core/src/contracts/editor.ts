import type { EditorPointPosition } from './editor-drop.ts';
export type { EditorPointPosition, EditorDropEvent, EditorHostDragEvent } from './editor-drop.ts';
import type { ResolvedRevisionMarkup } from './revision-markup.ts';
import type { CompareDocumentsRequest } from './compare-documents.ts';
import type { ReplaceDocumentRequest } from './replace-document.ts';
import type { ResolvedReviewPane } from './review-pane.ts';
/**
 * `@docx-editor.dev/core/contracts/editor` — the `Editor` contract adapters are written against.
 *
 * Commands go through `can` before `exec`; queries answer against the live, laid-out document.
 * Type-only declarations let adapters name the surface without importing the engine.
 *
 * @packageDocumentation
 * @public
 */

import type { ZoomMode } from './editor-zoom.ts';

/** Keys for the table furniture's accessible names, resolved by `tableInteractionLabel`. */
export type TableInteractionLabelKey =
  'table.insertRowBelow' | 'table.insertColumnRight' | 'table.selectTable';

export type { ZoomFitTarget, ZoomMode } from './editor-zoom.ts';
import type { TextMatch } from './editor-text-match.ts';
export type { ReplaceAllMatchesOutcome, TextMatch } from './editor-text-match.ts';
import type { EditorFontErrorCode, FontFaceRequest } from './editor-fonts.ts';
export type * from './editor-fonts.ts';
import type { EditorEvents } from './editor-events.ts';
import type { EditorAnchorNavigation, ScrollToAnchorOptions } from './editor-anchor.ts';
export type * from './editor-anchor.ts';
import type {
  EditorHighlights,
  HighlightRange,
  NavigateHighlightCommand,
} from './editor-highlights.ts';
import type { EditorSelectionRange, EditorSelectionReads } from './editor-selection-range.ts';
export type * from './editor-selection-range.ts';
export type * from './editor-highlights.ts';
import type { EditorParagraphText, ReplaceAcceptedTextCommand } from './editor-paragraph-text.ts';
export type * from './editor-paragraph-text.ts';
import type { HyperlinkInfo, PageSetup } from './editor-read-models.ts';
export type { HyperlinkInfo, PageSetup } from './editor-read-models.ts';
import type { EditorReviewHits } from './editor-review-hits.ts';
import type { ReviewItemQuery } from './editor-review-query.ts';
export type { ReviewItemQuery } from './editor-review-query.ts';
export type { DocumentOpenFailure, DocumentOpenFailureReason } from './editor-open-failure.ts';
import type { DocumentOpenFailure } from './editor-open-failure.ts';
import type { ReviewActivationOptions } from './review-activation.ts';
export type { ReviewActivationOptions } from './review-activation.ts';
import type { ReviewItemPlacement } from './editor-review-placement.ts';
export type {
  ReviewCommentPlacement,
  ReviewCustomPlacement,
  ReviewItemPlacement,
  ReviewItemPlacementBase,
  ReviewRevisionPlacement,
} from './editor-review-placement.ts';
export type { EditorReviewHits, ReviewItemHit } from './editor-review-hits.ts';
export type {
  DocumentChange,
  EditorEvents,
  EditorHostChange,
  EditorHostDocument,
  ParagraphsChangeEvent,
  ReviewChangesResolvedEvent,
  ReviewItemRevealEvent,
  ReviewItemRevealSource,
} from './editor-events.ts';
import type {
  DocumentEditingMode,
  ResolveReviewChangesOptions,
  SetReviewChangesAuthorOptions,
} from './editor-review.ts';
import type { ReviewDisplayMode } from '../layout/revision-projection.ts';
export type * from './editor-review.ts';
export type { RevisionBatchResult } from '../store/store/revision-batch.ts';
export type { RevisionAuthorResult } from '../store/store/revision-author-change.ts';
import type { ContentControlSummary, DocEdits, DocQueries, DocQueryResults } from './document.ts';
import type {
  CommentTextOptions,
  EditorExecOptions,
  EditorScope,
  HistoryGroup,
  HistoryGroupOptions,
  ViewScope,
} from './editor-scope.ts';
export type {
  CommentTextOptions,
  EditorExecOptions,
  EditorScope,
  HistoryGroup,
  HistoryGroupOptions,
  HistoryDiagnostic,
  HistoryGroupOutcome,
  ViewScope,
} from './editor-scope.ts';
// Type-only, so the adapters reach the review vocabulary through THIS contract rather than
// naming the store lane, which they are not allowed to import.
import type {
  ReviewItem,
  ReviewRevisionItem,
  ReviewRevisionKind,
} from '../store/store/review-items.ts';
import type { InteractionOutcome } from './interaction';
// The selection vocabulary the painted surface actually speaks. Type-only, and re-exported
// below for the same reason the review types are: an adapter is not allowed to import the
// layout lane, so a form it must construct has to be nameable from this contract.
import type { EditorSelection } from './editor-position.ts';
export type { EditorPosition, EditorSelection } from './editor-position.ts';
import type { CollaborationStatus } from '../collaboration/index.ts';
import type {
  ColorValue,
  ContentControlFilter,
  DocAnchor,
  DocRange,
  ParagraphFormatCommand,
  Rect,
  Revision,
  RunFormatting,
  SelectionPin,
  ExecErrorCode,
  ExecResult,
  Unsubscribe,
  Watermark,
  WatermarkState,
} from './types';
import type {
  EditorHeaderFooterCommands,
  EditorNoteCommands,
  HeaderFooterState,
  NotePropertiesState,
} from './editor-hf-notes.ts';
import type {
  EditorFormatPainterCommands,
  FormatPainterSurfaceState,
} from './editor-format-painter.ts';
import type { ImageWrapTarget } from '../store/package/drawing-projection.ts';
import type { DocumentProtectionState } from '../store/package/document-protection.ts';
import type { SupportedImageMime } from '../store/package/image-resources.ts';
import type { ImageCropPercent } from '../store/package/image-crop-units.ts';
import type { ImageContext, SelectedImageState } from './editor-image-state.ts';
import type { SetShapeFillCommand, SetShapeOutlineCommand } from './editor-shape-format.ts';
export type * from './editor-shape-format.ts';
import type {
  EditorChartCommands,
  EditorChartQueries,
  EditorChartQueryResults,
  SelectedChartState,
} from './chart.ts';
import type { BookmarkSummary, EditorBookmarkCommands } from './editor-bookmarks.ts';
export type * from './types';
export type * from './interaction';
export type * from './editor-hf-notes.ts';
export type * from './editor-format-painter.ts';
export type * from './editor-bookmarks.ts';
export type * from './editor-image-state.ts';
export type * from './diagnostics.ts';
export type * from './chart.ts';
export type { ImageCropPercent } from '../store/package/image-crop-units.ts';

// Everything below is named by a signature IN this file, so it has to be nameable FROM this
// file. An adapter is not allowed to import the layout or store lanes — that is the whole
// reason the review and drawing vocabulary is re-exported here rather than left where it is
// declared — so a type that leaks out through a return value but not through the export list
// is a member the adapter can call and cannot write down.
export type { CommentRecord } from '../store/store/comment-reads.ts';
export type {
  ReviewCommentItem,
  ReviewCustomItem,
  ReviewPosition,
  ReviewRange,
  ReviewRevisionItem,
} from '../store/store/review-items.ts';
export type { RevisionAddress } from '@docx-editor.dev/core/store';
export type { SemanticPosition, SemanticSelection } from '../layout/semantic-interaction.ts';
export type {
  DrawingHorizontalReferenceFrame,
  DrawingKind,
  DrawingLocks,
  DrawingPositionInput,
  DrawingVerticalReferenceFrame,
  ImageWrapTarget,
} from '../store/package/drawing-projection.ts';
export type {
  ImageResourceState,
  PreservedImageMime,
  RenderableImageMime,
  SupportedImageMime,
  ValidatedImageBytesHandle,
  VectorImageMime,
} from '../store/package/image-resources.ts';
export type {
  ContentControlSummary,
  DocEdits,
  DocQueries,
  DocQueryResults,
  ParagraphSummary,
} from './document.ts';

/**
 * An opaque handle to a loaded document — its stable identity and current
 * revision. The canonical authored state is the engine's `PackageModel`, NOT a
 * simplified tree; advanced automation (`DocxEditor.run(handle, …)`) addresses a
 * document through this handle rather than a serialized structure. Kept
 * deliberately minimal and open so it can carry more identity later without a
 * breaking change.
 */
export interface DocumentHandle {
  /** Package revision: rises for every edit, wherever it landed. Safe to compare. */
  readonly revision: number;
  /** The loaded document's identity: new on every `load()` (a reload too), kept across edits. */
  readonly loadId: string;
}

/**
 * What `createDocxEditor`/`load` accept as a document: raw DOCX bytes, an existing
 * in-memory `DocumentHandle` (shared/handed off), or `'blank'`. The engine is byte-native
 * (`PackageModel` is canonical); there is intentionally no structured-tree input,
 * which would be lossy against the canonical package.
 *
 * `'blank'` is Word's blank template, the same bytes `blankDocumentBytes()` returns from
 * `@docx-editor.dev/core/editor`. OMITTING the document is not a way to ask for an empty
 * one: with no document there is no editing surface, so every command refuses with "no
 * document is loaded" behind a loading screen waiting for bytes that are not coming.
 *
 * The two spellings serve different gestures. `'blank'` is a CONSTANT, so an adapter that
 * remounts on document identity holds one document — right for MOUNTING.
 * `blankDocumentBytes()` allocates, so it starts a fresh document every call — right for
 * File › New. Call the function into `load()` or host state, never inline in a prop,
 * where a new array per render rebuilds the editor per render.
 */
export type DocumentSource = ArrayBuffer | Uint8Array | DocumentHandle | 'blank';

/** Typed adapter error reported both through `onFontError` and accessible alert UI. */
export class EditorFontError extends Error {
  readonly name: string = 'EditorFontError';
  readonly code: EditorFontErrorCode;
  readonly request?: FontFaceRequest;
  readonly diagnostic?: string;

  constructor(
    code: EditorFontErrorCode,
    message: string,
    details: {
      readonly request?: FontFaceRequest;
      readonly diagnostic?: string;
      readonly cause?: unknown;
    } = {}
  ) {
    super(message, { cause: details.cause });
    this.code = code;
    this.request = details.request;
    this.diagnostic = details.diagnostic;
  }
}

/**
 * Whether a command would be accepted, and why not when it would not.
 *
 * The `reason` is the ENGINE's own words, which is what lets disabled chrome explain itself
 * instead of guessing — see `toolbarCommandState`.
 */
export type CanResult = { ok: true } | { ok: false; code: ExecErrorCode; reason: string };

/**
 * The engine's whole public surface: load and save, execute and query, observe and subscribe.
 *
 * Commands go through `can` before `exec` — the same check chrome uses to decide whether a
 * control is enabled, so a button and the engine never disagree about what is possible.
 *
 * `snapshot()` is version-cached: the same reference until state actually moves, with
 * reference-stable sub-objects, which is what makes it safe as a `useSyncExternalStore` source.
 *
 * @example
 * ```ts
 * const editor = createDocxEditor({ container });
 * editor.load(bytes);
 * if (editor.can({ type: 'toggleBold' }).ok) editor.exec({ type: 'toggleBold' });
 * const bytesOut = await editor.save();
 * ```
 */
export interface Editor
  extends
    EditorAnchorNavigation,
    EditorHighlights,
    EditorParagraphText,
    EditorReviewHits,
    EditorSelectionReads {
  /**
   * Load a new document (DOCX bytes, `'blank'`, or a handle), replacing the current one.
   *
   * A large document mounts behind one painted frame, so a loading screen keyed on
   * `snapshot().isOpening` can show instead of a frozen page; a small one mounts before
   * this returns. Callers that need the document synchronously do not have to care:
   * `save`, `exec` and `selectMatch` complete a scheduled open before they run.
   */
  load(document: DocumentSource): void;
  /**
   * Serialize the current document, finalizing pending text form values first.
   * Invalid input rejects with `EditorError.code === 'invalidArgs'` and remains editable.
   * Validation does not open a dialog. Other write refusals also reject the save.
   *
   * The bytes describe the document as it was when you called `save()`. The file is written
   * in short tasks, so input stays responsive while a long document saves, and edits made
   * meanwhile belong to the next save. Paragraphs and table rows unchanged since an earlier
   * save are not written again, so autosave after a small edit stays cheap.
   */
  save(): Promise<ArrayBuffer>;
  getDocumentHandle(): DocumentHandle;
  /** Create an explicit gesture handle; creates no undo entry. */
  beginHistoryGroup(): HistoryGroup;
  exec(command: EditorCommand, options?: EditorExecOptions): ExecResult;
  /** Dry run: reports whether `exec` would apply. Never reports `changed`. */
  can(command: EditorCommand, options?: EditorExecOptions): CanResult;
  /**
   * Dry run for byte commands that require {@link Editor.executeImageCommand}.
   * Generic {@link Editor.can} on `insertImage` / `replaceImage` refuses with an async-path
   * reason; this method answers whether async execution can proceed right now.
   */
  canExecuteImageCommand(
    command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>,
    options?: { scope?: EditorScope }
  ): CanResult;
  /** Insert or replace picture bytes as one package undo unit. */
  executeImageCommand(
    command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>
  ): Promise<ExecResult>;
  /**
   * Whether a formatting command is currently APPLIED at the selection — distinct from
   * `can`, which answers whether it may run.
   *
   * A toolbar must show that bold is on, and the repo's own guidance is that controls
   * reflect live editor state rather than being static. `can` cannot answer this, and the
   * legacy adapter answered it by reading a ProseMirror `EditorState` directly, which the
   * greenfield architecture forbids in adapters.
   *
   * The derivation EXISTS for marks and alignment: `toggleMark` bold/italic/underline/
   * strike answers from the snapshot's selection formatting (Word's agreement rule — true
   * only when the WHOLE selection carries the mark), and `setAlignment` compares the
   * command's `align` (with justify↔`both` mapped the way `exec` writes it) to the
   * selection's paragraph alignment. Every other command still returns `false`: it must
   * never return a value it has not actually derived from canonical state, and `false` is
   * the honest answer while a derivation does not exist.
   */
  isActive(command: EditorCommand, options?: { scope?: EditorScope }): boolean;

  // ── Capabilities the ported legacy UI asks for ──────────────────────────────────────
  //
  // The legacy React components read these from a ProseMirror `EditorState` or the old
  // document model. Adapters may do neither here, so each is a method on this contract,
  // implemented in the engine as a STUB returning the honest empty answer. The UI wires
  // to them today and lights up when the derivation lands, with no adapter change.
  //
  // Every one of these MUST return empty rather than a guess. A style list that invents
  // entries, or a comment count that is not real, is worse than a control that shows
  // nothing — see the `isActive` note above.

  /** Paragraph/character styles defined by the document, for the style picker. */
  getDocumentStyles(): readonly {
    readonly styleId: string;
    readonly name: string;
    readonly type: string;
    /**
     * How the style looks, so a picker can show each entry in its own face rather than a
     * list of identical rows. Presentation only, and already bounded for a CSS sink.
     */
    readonly preview: {
      readonly fontFamily: string | null;
      readonly fontSizePt: number | null;
      readonly bold: boolean;
      readonly italic: boolean;
      readonly color: string | null;
    };
  }[];

  /** Font families the document actually uses, for the font picker. */
  getDocumentFonts(): readonly string[];

  /**
   * Selectable standard and provider-supported families plus the configured catalog (the default face,
   * the Word-name families the substitution map stands in for, and host-registered
   * source families) merged with {@link getDocumentFonts}. Never empty — a brand-new
   * document offers the same standard choices. This does not report installed or loaded fonts.
   */
  getAvailableFonts(): readonly string[];

  /**
   * The document theme's ten picker colours (`a:clrScheme`) in Word's column order
   * (Background 1, Text 1, Background 2, Text 2, Accent 1-6), each a six-digit hex
   * without '#'. Empty when the document has no complete scheme — the picker then
   * falls back to a default palette.
   */
  getDocumentThemeColors(): readonly { readonly slot: string; readonly hex: string }[];

  /** Heading outline for the navigation panel, in document order. */
  getOutline(): readonly {
    readonly text: string;
    readonly level: number;
    readonly blockId: string;
  }[];

  /** Comment threads anchored in the document. */
  getComments(): readonly {
    readonly id: string;
    readonly text: string;
    readonly resolved: boolean;
  }[];

  /** Formatting at the current selection, for toolbar value display (font, size, colour,
   *  alignment, list state). `null` when nothing is selected or nothing is derivable. */
  getSelectionFormatting(): {
    readonly fontFamily?: string;
    readonly fontSizeHalfPoints?: number;
    readonly styleId?: string;
    readonly alignment?: string;
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly underline?: boolean;
  } | null;

  /**
   * Find across body, headers, footers, footnotes, endnotes, and selectable text boxes.
   *
   * The search narrows to the body and its selectable text boxes when other stories cannot open.
   * This includes viewing mode and surfaces without header, footer, or note entry methods.
   * Text boxes in footnotes and endnotes remain excluded until their drawings are selectable.
   *
   * Pass a match to `exec({ type: 'replaceMatch', match, text })` to replace it, which records a
   * tracked replacement in suggesting mode, or to {@link selectMatch} and then
   * {@link addComment} to comment on it. For headless or server use, see `body.search` in
   * `@docx-editor.dev/editor-api`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/tracked-replacement | Replace as a tracked change}
   */
  findMatches(
    query: string,
    options?: { readonly matchCase?: boolean; readonly wholeWord?: boolean }
  ): readonly TextMatch[];
  /** Find many terms in one pass, such as a glossary: one result list per term, in order. */
  findMatches(
    queries: readonly string[],
    options?: { readonly matchCase?: boolean; readonly wholeWord?: boolean }
  ): readonly (readonly TextMatch[])[];

  /**
   * Move the selection to a match — what a find dialog's next/previous do. Takes a
   * {@link TextMatch} or a {@link HighlightRange} you computed, and opens the header, footer,
   * or note that holds it, unlike `replaceMatch`, which edits a closed story in place. Refusals
   * match: `notFound` when the expected text moved, `invalidArgs` when `scope` is wrong.
   */
  selectMatch(match: TextMatch | HighlightRange): ExecResult;

  /** The image at the selection, for the image toolbar and transform controls. */
  getSelectedImage(): SelectedImageState | null;

  /** The table containing the selection, for the table toolbar. `null` outside a table. */
  getSelectedTable(): {
    readonly blockId: string;
    readonly rowCount: number;
    readonly columnCount: number;
    readonly cell: { readonly row: number; readonly column: number } | null;
  } | null;

  /** Live rectangular cell selection, if any. `null` when the caret is not in a cell rectangle. */
  getTableCellSelection(): {
    readonly tableId: string;
    readonly rows: { readonly from: number; readonly to: number };
    readonly columns: { readonly from: number; readonly to: number };
    readonly cellIds: readonly string[];
  } | null;

  /** Update table furniture aria labels without remounting the editor. */
  setTableInteractionLabel(resolver: (key: TableInteractionLabelKey) => string): void;

  /** Section page setup — size, orientation and margins — for the page-setup dialog. */
  getPageSetup(): PageSetup | null;

  /**
   * The watermark the document shows, read from the first section's headers; null when it
   * shows none. For a picture watermark's bytes, use `query({ type: 'watermark' })`.
   */
  getWatermark(): WatermarkState | null;

  /** Header/footer editing state: which region is being edited, if any. */
  getHeaderFooterState(): HeaderFooterState | null;

  /** Resolved and authored note properties for the caret section — properties dialog read-model. */
  getNotePropertiesState(): NotePropertiesState | null;

  /** Plain-text note preview for hover chrome. */
  getNotePreviewText(scopeId: string): string | null;

  /** Tracked changes in the document — body AND header/footer stories. */
  getTrackedChanges(): readonly {
    readonly id: string;
    readonly kind: string;
    readonly author?: string;
    /** Which story holds the change, so a consumer can group or filter by region. */
    readonly story?: 'body' | 'header' | 'footer' | 'footnote' | 'endnote';
  }[];

  /**
   * Every pending decision in the document, with where its card belongs.
   *
   * Derived from the document TREE, not from what is painted: a queue derived from laid-out
   * spans empties by half the moment the reader switches to a resolved display mode, and the
   * changes that vanished become unreachable from the surface meant to resolve them.
   *
   * `anchorY` comes from layout records. A surface must not measure painted DOM for it — that
   * is a repaint behind the document and fails outright during pagination.
   */
  getReviewItems(query?: ReviewItemQuery): readonly ReviewItemPlacement[];

  /**
   * Set the view-time tracked-change filter, or clear it with `null`.
   *
   * The predicate receives each full revision item. A false result renders that revision as
   * accepted by default. With `reject`, excluded content, moves, paragraph marks, and table-row
   * insertions/deletions use their rejected projection; formatting and other property-change
   * records keep their current values with revision markup hidden. Both modes are view-only: they
   * change no OOXML and do not change saved bytes. Calling this method again re-evaluates every
   * revision, even when the function reference is unchanged.
   */
  setTrackedChangesFilter(
    predicate: TrackedChangePredicate | null,
    mode?: TrackedChangeFilterMode
  ): void;

  /**
   * Custom-node definitions registered through `createDocxEditor({ modules })`, in
   * registration order.
   *
   * OPAQUE to the engine — the capability package that defined them narrows them back.
   * Published so chrome components can default to the registered definitions instead of
   * every surface taking the same `nodes` array and drifting.
   */
  getCustomNodeDefinitions(): readonly unknown[];
  /**
   * Report a custom-node diagnostic to the modules registered on THIS editor.
   *
   * The capability package raises these from its own read paths as well as from the review
   * derivation, and both have to reach the same listeners — the ones belonging to this instance.
   * Keeping the channel here rather than in the package is what stops two editors on one page
   * hearing about each other's documents.
   *
   * Opaque, like `getCustomNodeDefinitions`: what a diagnostic means belongs to whoever raised it.
   */
  reportCustomNodeDiagnostic(diagnostic: unknown): void;

  /**
   * How edits are written: directly, as suggestions, or not at all.
   *
   * Runtime state, unlike the construction-time `DocxEditorConfig.mode` — a reader who switches
   * to Viewing and back expects the same document, not a remount.
   */
  getEditingMode(): DocumentEditingMode;
  setEditingMode(mode: DocumentEditingMode): ExecResult;

  /**
   * Whether the review pane is showing its cards.
   *
   * Engine-owned, like zoom: the toolbar toggles it, the rail renders from it, and the
   * document shifts to make room for it. Three consumers, one answer.
   */
  isReviewPaneOpen(): boolean;

  /**
   * Layout points to CSS pixels, zoom included.
   *
   * Published because {@link ReviewItemPlacement.anchorY} is in the engine's own unit, and a
   * host that re-derived the factor would own a second copy of the points-to-pixels rule.
   * The first copy drifted the moment it was written: a rail that used zoom alone put every
   * card at three quarters of its true height.
   */
  getRenderScale(): number;

  /**
   * A counter that changes exactly when {@link getReviewItems} would return something new.
   *
   * Lets a subscriber re-derive on a real change rather than on every event.
   */
  getReviewRevision(): number;

  /**
   * Comment on the current selection.
   *
   * Anchored to the RETAINED range when there is one, so a compose box that took focus does
   * not lose the words it is about — that is what retention exists for. Refused on a
   * collapsed caret: a comment with no range has nothing to point at, and Word writes none.
   *
   * A refused write names its cause, as every review write does: `code: 'locked'` with
   * `'the document is open for viewing'` in viewing or under read-only protection, and
   * `code: 'unsupported'` with the external refresh sentence or a collaboration reason token
   * such as `'collaboration-session-not-ready'` (wait for the session, then retry). Branch on
   * `diagnosticCodeOfRefusal(result.reason, result.code)`, not on the text.
   *
   * Pass `options.historyGroup` to make the comment part of a larger undo step, such as a
   * review decision that also resolves changes. See {@link HistoryGroupOptions}.
   *
   * @example
   * ```ts
   * editor.addComment('Counter-proposal: 45 days.', { historyGroup: decision });
   * editor.addComment('Approved.', 'Legal team', { historyGroup: decision });
   * ```
   *
   * To comment on found text, select it first with {@link findMatches} and
   * {@link selectMatch}. In a React or Vue host with the review module, `useReview().comment`
   * calls this. For headless or server use, see `Range.insertComment` in
   * `@docx-editor.dev/editor-api`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/comment-on-found-text | Comment on found text}
   */
  addComment(text: string, options?: HistoryGroupOptions): ExecResult;
  /** {@link addComment} with an author for this call, overriding the configured author. */
  addComment(text: string, author?: string, options?: HistoryGroupOptions): ExecResult;

  /**
   * Card to document: a COLLAPSED caret at the range start, and a scroll to it. `null` clears it.
   *
   * REPORTS, like {@link acceptReviewItem} and for the same reason. Activation is refused for
   * an item with no resolvable range, for a kind the host's rail excluded (see
   * {@link setReviewActivationExclusions}), for a custom node without `reviewCard`, and when
   * the story it lives in will not open — and a host walking a queue with next/previous
   * controls has no other way to learn that a step did nothing. Consult {@link ReviewItemPlacement.activatable} to avoid asking.
   *
   * With `options.announce: true`, a call that lands fires `reviewItemReveal` with
   * `source: 'host'`, also when the item was already active, so the packaged review UI opens
   * the item's balloon or card. By default it fires nothing. A `null` key fires nothing.
   *
   * Pass `{ reveal: false }` to open the item without scrolling, for a host whose own list
   * drives the scroll. `useReview().setActive` calls this.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling | Accept or reject without scrolling}
   */
  setActiveReviewItem(key: string | null, options?: ReviewActivationOptions): ExecResult;

  /**
   * The key of the ACTIVATED review item: the one {@link setActiveReviewItem}, Next Change, or
   * Previous Change made active, while the caret stays in it.
   *
   * Two ideas of "active" exist. The caret-active item is the one the caret is in, however it
   * got there: `isActive` on the placements {@link getReviewItems} returns, and `activeKey` in
   * `useReview()`. The activated item is narrower: only an explicit activation sets it, so a
   * caret that merely lands in a change leaves this `null`. Open a balloon or card for the
   * activated item, and highlight the caret-active one.
   *
   * Pass the query you read items with, so the key matches theirs. By default a paired
   * replacement reports the pair's key; with `pairReplacements: false`, the key of the half
   * the caret is in. The value changes with the selection, so read it again on
   * `selectionChange`.
   *
   * @example
   * ```ts
   * editor.on('selectionChange', () => {
   *   const activated = editor.getActivatedReviewItemKey();
   *   if (activated !== null) showMyCard(activated);
   * });
   * ```
   */
  getActivatedReviewItemKey(query?: ReviewItemQuery): string | null;

  /**
   * Revision kinds the caret must never activate, or null for none.
   *
   * A host rail that hides some kinds (structural and format cards, typically) tells the
   * engine here, so a click on tracked text cannot activate a card the rail does not
   * render — the band would light and nothing on screen would answer it.
   * `formattingKinds` limits a format exclusion to those OOXML property-change names,
   * allowing other formatting decisions to retain sidebar activation.
   */
  setReviewActivationExclusions(
    kinds: readonly ReviewRevisionKind[] | null,
    options?: { readonly formattingKinds?: readonly string[] }
  ): void;

  /**
   * Accept or reject the revision behind a card.
   *
   * Every site carrying the revision's `(id, author, date)` triple resolves in ONE transaction
   * and one undo step: a tracked row insertion is `w:trPr/w:ins` on the row plus `w:cellIns`
   * on each cell, and resolving them separately would leave the row half-tracked.
   *
   * Refused for a card whose kind the engine cannot resolve structurally, which is why
   * `readOnly` is on the item — a surface should not offer the button in the first place.
   * Other refusals name their cause, as {@link addComment} describes. A change that resolves
   * only together with another change refuses with a reason led by `incomplete-group:`, and a
   * row that stays to keep a nested table with one led by `retained-structure:`. A change a
   * content control lock keeps refuses with `code: 'locked'` and a reason led by
   * `locked-content:`; one in a data-bound control with `code: 'bound'` and `bound-content:`.
   * `reviewCodeOfRefusal(result.reason)` names the review code of each. In a React or
   * Vue host, `useReviewRefusalMessage()` turns `useReview().lastRefusal` into a sentence.
   *
   * Neither call scrolls. In a React or Vue host with the review module, `useReview().accept`
   * and `useReview().reject` call these. For headless or server use, see `Revision.accept()`
   * and `Revision.reject()` in `@docx-editor.dev/editor-api`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling | Accept or reject without scrolling}
   */
  acceptReviewItem(key: string, options?: HistoryGroupOptions): ExecResult;
  /** The rejecting half of {@link acceptReviewItem}, with the same rules and options. */
  rejectReviewItem(key: string, options?: HistoryGroupOptions): ExecResult;

  /**
   * Resolve or reopen the comment thread behind a review card.
   *
   * The thread state is written through the same package transaction as every other comment
   * mutation, so `commentsExtended.xml`, Undo and save/reopen cannot disagree. Repeating the
   * state already on the item succeeds without adding an undo entry. A refusal names its cause,
   * as {@link addComment} describes.
   */
  setCommentResolved(key: string, resolved: boolean, options?: HistoryGroupOptions): ExecResult;

  /**
   * Replace the text of the comment, or of the reply, behind a review card.
   *
   * The body becomes one paragraph of plain text, as {@link addComment} writes it; a line break in
   * `text` does not start a new paragraph. The author, the date, the thread state, the replies and
   * the range the comment covers stay, so the comment keeps its place in its thread when the file
   * opens again. The write is one package transaction and one undo step, and it joins an open
   * history group. Text the card already shows succeeds without adding an undo entry.
   *
   * Requires the configured nonempty author to match the comment author exactly. This host
   * identity policy is not authentication. Refused on blank text, in viewing mode, and for
   * bodies with revisions or unsupported structures. Formatting becomes plain text.
   * Use {@link CommentTextOptions.expectedText} to preserve a draft when another edit arrives.
   */
  setCommentText(key: string, text: string, options?: CommentTextOptions): ExecResult;

  /**
   * Discard the item behind a card: the destructive half of the review verbs.
   *
   * On a COMMENT it deletes the thread — the `w:comment` body, the `w15:commentEx` record and
   * the story's range markers, in one transaction and therefore one undo step. Word deletes a
   * conversation rather than one remark, and a reply whose parent is gone has nothing left to
   * answer.
   *
   * On a REVISION it rejects the change, which is what discarding a suggestion means: the
   * proposal goes away and the document reads as it did before. Deliberately the same verb, so
   * a surface can put one "remove this" affordance on every card instead of branching.
   *
   * Refused on a custom node's card, which is informational, and on a revision kind the engine
   * cannot resolve — the same rule {@link rejectReviewItem} follows. Other refusals name their
   * cause, as {@link addComment} describes, and leave the open card and its draft open.
   */
  deleteReviewItem(key: string, options?: HistoryGroupOptions): ExecResult;

  /**
   * Reply to a review item.
   *
   * Against a comment this is a threaded reply. Against a REVISION it is a comment anchored
   * over that revision's range: OOXML gives `w:ins` and `w:del` no body and no thread, so
   * there is nowhere else for the text to live.
   *
   * The author is AMBIENT — `DocxEditorConfig.author`, the way the rest of the authored commands
   * source it — and the argument overrides it for one call. `CT_Comment` makes `@w:author`
   * required, so a reply with neither is refused rather than written as an empty attribute.
   * Other refusals name their cause, as {@link addComment} describes.
   *
   * In a React or Vue host with the review module, `useReview().reply` calls this. For
   * headless or server use, see `Comment.reply` in `@docx-editor.dev/editor-api`.
   */
  replyToReviewItem(key: string, text: string, options?: HistoryGroupOptions): ExecResult;
  /** {@link replyToReviewItem} with an author for this call, overriding the configured author. */
  replyToReviewItem(
    key: string,
    text: string,
    author?: string,
    options?: HistoryGroupOptions
  ): ExecResult;
  /**
   * Move editing into `scope`: the body, a header or footer, a note, or a text box (`frame`).
   *
   * A frame whose `owner` is a header or footer opens that story first and edits the box
   * inside it. The box is edited on the page of the open story when that story is already
   * open, otherwise on the page in view, otherwise on the first page that shows it. A frame
   * owned by a note, a box with rotated or vertical text, and a box holding a table are refused:
   * the scope stays where it was. Read {@link getActiveScope} to confirm the entry.
   */
  setActiveScope(scope: ViewScope): void;
  /** The scope editing is in, as {@link setActiveScope} last set it or a press moved it. */
  getActiveScope(): ViewScope;

  query<K extends keyof EditorQueries>(
    query: { type: K } & EditorQueries[K],
    options?: { scope?: EditorScope }
  ): EditorQueryResults[K];
  snapshot(options?: { scope?: EditorScope }): EditorSnapshot;

  getTotalPages(): number;
  /**
   * One-based page at the caret (default), or at the centre of the mounted scroll viewport.
   * Viewport mode falls back to the caret when no measurable viewport is attached.
   */
  getCurrentPage(mode?: 'viewport' | 'caret'): number;

  /**
   * Display scale of the painted pages. 1 is 100%.
   *
   * Zoom is ENGINE-OWNED rather than a host prop, so the toolbar's zoom control, the
   * scale a host paints at, and the factor hit testing divides by cannot disagree —
   * a host that scaled its own transform without telling the engine would land every
   * click at the wrong content point.
   */
  /**
   * Scroll a page or a block into view. Returns false when the target does not exist or
   * the host has no scroll container. During a large open, a target not laid out yet answers
   * true and scrolls once it is; input cancels that, and a page past the end never scrolls.
   */
  scrollToPage(pageNumber: number): boolean;
  /**
   * `options` takes the {@link ScrollToAnchorOptions} fields. `block` defaults to `'start'`
   * here (`scrollToAnchor` defaults to `'centerIfNeeded'`), `behavior` to `'instant'`, and
   * `offsetPx` to 24. An invalid option also returns false, and nothing scrolls.
   */
  scrollToBlock(blockId: string, options?: ScrollToAnchorOptions): boolean;
  // scrollToAnchor, highlightAnchor, and clearAnchorHighlight: see EditorAnchorNavigation.

  getZoom(): number;
  /**
   * Set the display scale. Values outside a sane range are rejected rather than
   * clamped silently, so a caller learns its input was refused.
   *
   * Also LEAVES any fit mode: a reader who picks 150% has said what they want, and a
   * viewport resize must not take it back off them. Call `setZoomMode` to go back.
   */
  setZoom(zoom: number): ExecResult;

  /** Whether the scale is a number the engine holds, or one it recomputes from the viewport. */
  getZoomMode(): ZoomMode;
  /**
   * Choose between holding a scale and tracking the viewport.
   *
   * `'auto'` is the shorthand for {@link ZoomMode}'s bounded page-width fit and the default
   * for a new editor: a window wide enough for the sheet stays at 100%, and a narrower one
   * shrinks rather than growing a horizontal scrollbar — down to 50%, past which the page
   * keeps a legible size and the scrollbar is the better trade. Refused (`invalidArgs`) for a
   * value that is not a mode, in the same spirit as `setZoom`.
   *
   * A fit tracks the scroller's CONTENT box, so anything that reserves width beside the page
   * — an open comments rail, a docked navigation pane — shrinks the document by exactly what
   * it took. Nothing else has to be told.
   */
  setZoomMode(mode: ZoomMode | 'auto'): ExecResult;

  // ─── Geometry ──────────────────────────────────────────────────────────────
  //
  // ONE MEMBER, deliberately. This contract used to carry a whole interaction and geometry
  // cluster — an interaction frame, hit testing, caret and selection rects, scroll extent,
  // typed pointer dispatch — and every one of them was a stub returning null, `[]` or
  // `unsupported`. Nothing called them, because there was nothing behind them to call.
  //
  // A stub is not a free placeholder here. `hitTest` returning `null` is indistinguishable
  // from the legitimate answer "you clicked the page margin", so a caller could not tell
  // unimplemented from no-target; `getPageGeometry` returning `[]` silently made Vue's
  // rulers render nothing at all, and nobody noticed for as long as it shipped. An API that
  // answers wrongly is worse than one that is absent, because absence is a compile error.
  //
  // The capability was never in this contract anyway: pointer hit testing lives in the
  // layout lane (`layout/semantic-hit-test.ts`) and the paginated surface calls it directly.
  // Re-exposing any of it here is a small wiring job on the day a host actually needs it.

  /**
   * Resolve client pixels in the active story without moving the selection.
   * Returns null outside that story, while detached, and for unsupported text boxes.
   * Pass the exact result to `insertImage.at` before the document or scope changes.
   */
  positionAtPoint(clientX: number, clientY: number): EditorPointPosition | null;
  /** Page boxes in stack coordinates, each with the text area the engine laid out.
   * `contentBox` is the page inset by the section margin. Rulers use it for margin zones.
   * The engine's margin is uniform, so do not present this as per-side fidelity.
   * Empty before the first layout, which is the honest answer rather than a guessed page. */
  getPageGeometry(): readonly { index: number; box: Rect; contentBox: Rect }[];
  /** Replaces the module-scope cache-invalidation calls adapters make today. */
  relayout(options?: { sync?: boolean }): void;
  focus(scope?: EditorScope): InteractionOutcome<void>;
  /** Pin the selection while chrome has focus. Returns null while detached. */
  retainSelection(): SelectionPin | null;
  /** Release only the pin installed by the matching {@link retainSelection} call. */
  releaseSelection(pin: SelectionPin): void;
  destroy(): void;

  on<E extends keyof EditorEvents>(event: E, handler: EditorEvents[E]): Unsubscribe;
}

/**
 * Open by declaration merging: extensions contribute keys from `core/plugin`.
 * `exec` resolves `{ type, ... }` through the extension registry, which is
 * already the production dispatch path.
 */
/**
 * In the editor a command targets the current selection unless told otherwise,
 * and authoring is ambient — the author comes from `DocxEditorConfig`/the session,
 * the way the Office JS API sources it from context — so the document layer's
 * required `target` and `author` both become optional here.
 */
export type EditorCommandShape<T> = {
  [K in keyof T]: Omit<T[K], 'target' | 'author'> &
    (T[K] extends { target: infer G } ? { target?: G } : unknown) &
    (T[K] extends { author: infer A } ? { author?: A } : unknown);
};

/**
 * One review card's data plus where it sits beside the page.
 *
 * Flat and presentation-ready ON PURPOSE. A card needs an author, initials, a date and some
 * text; deriving those from the canonical tree means walking runs and reading `w15:commentsEx`,
 * which is engine work. Handing an adapter the raw node and letting it walk would put document
 * derivation in the hosts — the one thing they are not allowed to own — and would have to be
 * written twice, once per framework. {@link item} stays for a host that wants more.
 */
export type { ReviewItem, ReviewRevisionKind };

/**
 * Decides whether one tracked change renders as markup.
 *
 * Return `true` to keep the revision visible as tracked markup. Return `false` to render it with
 * the selected {@link TrackedChangeFilterMode} without changing the document. The callback
 * receives the complete revision item, including its author, date, kind, text, ranges, nesting,
 * and resolution metadata.
 */
export type TrackedChangePredicate = (revision: ReviewRevisionItem) => boolean;

/** How revisions excluded by a tracked-changes predicate project into the view. */
export type TrackedChangeFilterMode = 'accept' | 'reject';

import type {
  TableBorderEdgeTarget,
  TableBorderSpec,
  TableCellVerticalAlignment,
  TableColumnDividerResizeTarget,
  TableColumnOccurrenceTarget,
  TableContext,
  TableRightEdgeResizeTarget,
  TableRowOccurrenceTarget,
} from './table-targets.ts';

/**
 * Table addressing — border targets and row/column/divider references.
 *
 * Re-exported rather than declared here so `editor.ts` stays under its line cap; see
 * `table-targets.ts`.
 */
export type {
  TableBorderEdgeTarget,
  TableBorderSpec,
  TableBorderStyle,
  TableBorderTarget,
  TableCellVerticalAlignment,
  TableColumnDividerResizeTarget,
  TableColumnOccurrenceTarget,
  TableContext,
  TableRightEdgeResizeTarget,
  TableRowOccurrenceTarget,
} from './table-targets.ts';

/**
 * Every command the editor accepts, keyed by name with its payload as the value.
 *
 * Extends the document-level {@link DocEdits} vocabulary with the things only a LIVE editor has:
 * selection, view state, chrome modes, header/footer and note editing. An interface rather than a
 * closed union so an extension can widen it by declaration merging.
 */
export interface EditorCommands
  extends
    EditorCommandShape<DocEdits>,
    EditorHeaderFooterCommands,
    EditorNoteCommands,
    EditorFormatPainterCommands,
    EditorBookmarkCommands,
    EditorChartCommands {
  /** Switch how edits are written. A view command: it changes no document state. */
  setEditingMode: { mode: DocumentEditingMode };
  /**
   * Show or hide the review pane.
   *
   * A view command rather than a document edit, and a COMMAND rather than a host flag so the
   * toolbar button gets its pressed state from the same place every other button does. Both
   * adapters and any host chrome read one answer.
   */
  toggleReviewPane: Record<never, never>;
  /** Open the local review settings dialog supplied by the review module. */
  openRevisionMarkupDialog: Record<never, never>;
  /** Open the Compare documents dialog supplied by the review module. */
  openCompareDocumentsDialog: Record<never, never>;
  /**
   * Compare the open document (the original) with a revised DOCX and record the differences in
   * it as tracked changes, as one undoable step. For hosts with their own file picker. The
   * result's `compareDocuments` field carries the revision count, or the refusal as a code to
   * translate (`compareDocuments.errors.<code>`).
   */
  compareDocuments: CompareDocumentsRequest;
  /** Replace the document with a DOCX file as one undoable edit; see {@link ReplaceDocumentRequest}. */
  replaceDocument: ReplaceDocumentRequest;
  /** Word's Show/Hide paragraph marks; presentation only. */
  toggleParagraphMarks: Record<never, never>;
  /** Word's Protect Document: enforce filling-in-forms protection, or lift the enforced one. */
  toggleDocumentProtection: Record<never, never>;
  /**
   * Navigate tracked changes, including hidden formatting balloons, and wrap at the end.
   *
   * A replacement is one stop in every review layout. A replacement is a deletion and the
   * touching insertion from the same author that took its place. Navigation lands on the
   * deletion, highlights both halves, and `reviewItemReveal` carries the pair's `pairKey`.
   *
   * Navigation steps through the changes {@link Editor.getReviewItems} returns, so a
   * reviewer or `setTrackedChangesFilter` filter applies. When a filter hides one half of a
   * replacement, the other half is a stop of its own.
   */
  navigateReviewChange: { direction: 'next' | 'previous' };
  /**
   * Select the next or previous mark of a highlight set, such as the next spelling issue, and
   * scroll it into view. Marks are taken in reading order across stories, as `getParagraphs()`
   * lists paragraphs, and navigation wraps at the end. Only marks that still cover their text
   * count. A collapsed caret at the start of a mark selects that mark first. With a mark
   * selected, open the context menu from the keyboard with Shift+F10 or the menu key.
   *
   * Returns `notFound` for an unknown set or a set without marks. It changes no document
   * content and no highlight.
   *
   * @example
   * ```ts
   * editor.exec({ type: 'navigateHighlight', name: 'spelling', direction: 'next' });
   * ```
   */
  navigateHighlight: NavigateHighlightCommand;
  /** Resolve eligible changes shown by the active filters, or an explicit scope, in one undo step. */
  resolveAllReviewChanges: ResolveReviewChangesOptions;
  /** Attribute eligible changes to another author, keeping them pending, in one undo step. */
  setReviewChangesAuthor: SetReviewChangesAuthorOptions;
  /** Change the review projection without accepting or rejecting document revisions. */
  setReviewDisplayMode: { mode: ReviewDisplayMode };
  toggleMark: { mark: string };
  setMarkAttr: { mark: string; attr: string; value: unknown };
  /**
   * Word's Clear All Formatting (Home > Font > the eraser).
   *
   * Takes direct CHARACTER formatting off the selected text, and resets every paragraph the
   * selection touches to the document's default paragraph style with its direct paragraph
   * properties dropped — alignment, indents, spacing, list membership. Character formatting
   * is a range and paragraph formatting is not, so a partial selection clears the text it
   * covers and still resets the paragraph it sits in, which is Word's split.
   *
   * Formatting inherited from a style is not touched: this removes what the document states
   * DIRECTLY, so the text falls back to what its style gives it rather than to nothing.
   *
   * A CHARACTER STYLE survives, and so do paragraph borders and hidden text. Those live
   * outside the property vocabulary an edit can name — a run's `w:rStyle`, `w:vanish` and
   * `w:bdr`, a paragraph's `w:pBdr` and `w:outlineLvl` — and are preserved rather than
   * dropped, which is where this stops short of Word: clearing a run that carries a
   * character style leaves that style's face on it.
   */
  clearFormatting: Record<never, never>;
  /**
   * Physical alignment on every paragraph the selection touches. A right-to-left paragraph
   * reaches its right margin with `w:jc="left"`, so the written value follows each
   * paragraph's direction.
   */
  setAlignment: { align: 'left' | 'center' | 'right' | 'justify' };
  /**
   * Word's Left-to-Right and Right-to-Left Text Direction: the base direction (`w:bidi`) of
   * every paragraph the selection touches, table cells included. `rtl` writes `w:bidi`.
   * `ltr` removes a direct `w:bidi`, and writes `w:bidi w:val="0"` only where a style would
   * otherwise make the paragraph right-to-left. Run text, run direction (`w:rtl`)
   * and `w:jc` are untouched: alignment and indents are leading and trailing sides, so a
   * start-aligned paragraph moves to the other margin with its direction.
   * A paragraph already in the requested direction is left as it is.
   */
  setParagraphDirection: { direction: 'ltr' | 'rtl' };
  /**
   * Word's Line Spacing, on every paragraph the selection touches.
   *
   * `value` is in the unit the RULE implies, which is the unit Word's own dialog uses:
   * LINES for `multiple` (1, 1.15, 1.5, 2), points for `exact` and `atLeast`. The
   * OOXML attribute is one number meaning two different quantities depending on
   * `w:lineRule`, and a caller should not have to know which.
   */
  setLineSpacing: { rule: 'multiple' | 'exact' | 'atLeast'; value: number };
  /**
   * Space above and below a paragraph, in points, on every paragraph the selection
   * touches. Omitting a field leaves it as authored; `null` clears it, which is how
   * Word's "Remove space before/after paragraph" differs from setting it to zero.
   */
  setParagraphSpacing: { beforePt?: number | null; afterPt?: number | null };
  /**
   * Exact paragraph indent, in twips, on every paragraph the selection touches.
   *
   * Omitting a field leaves it as authored; `null` clears it so the paragraph falls back to
   * its style, the same distinction `setParagraphSpacing` draws — a zero blocks the cascade,
   * a missing attribute does not.
   *
   * `firstLine` is ONE SIGNED offset from the left indent: negative IS the hanging indent.
   * OOXML spells it as two mutually exclusive attributes (`w:firstLine`/`w:hanging`, where
   * hanging wins per §17.3.1.12); collapsing them here means a caller cannot state a
   * contradiction, and matches the single signed value Word's own model keeps.
   */
  setIndent: {
    left?: number | null;
    right?: number | null;
    firstLine?: number | null;
  };
  /**
   * The Paragraph dialog as one command: alignment, indents, spacing, line spacing and
   * the five paragraph flags, applied to every paragraph the selection touches.
   *
   * ONE undo step, because a dialog is one gesture. The single-purpose commands beside it
   * (`setAlignment`, `setIndent`, `setLineSpacing`, `setParagraphSpacing`) stay the right
   * choice for a toolbar button; this is for chrome that changes several at once.
   */
  setParagraphFormat: ParagraphFormatCommand;

  toggleList: { kind: 'bullet' | 'ordered' };

  insertRow: { where: 'above' | 'below'; target?: TableRowOccurrenceTarget };
  insertColumn: { where: 'left' | 'right'; target?: TableColumnOccurrenceTarget };
  deleteRow: { target?: TableRowOccurrenceTarget };
  deleteColumn: { target?: TableColumnOccurrenceTarget };
  deleteTable: Record<never, never>;
  mergeCells: Record<never, never>;
  splitCell: { rows: number; cols: number };
  /** Selected-cell fill. `null` clears direct fill so the table-style cascade applies again. */
  setCellFill: { color: ColorValue | null };
  /** Vertically align content inside the selected table cells. */
  setTableCellVerticalAlignment: { alignment: TableCellVerticalAlignment };
  toggleHeaderRow: Record<never, never>;
  /**
   * Selected-cell borders. Concrete edge scopes require a complete spec;
   * `{ scope: 'none', target }` clears only that active edge target and MUST NOT carry `spec`.
   */
  setTableBorders:
    | { scope: 'none'; target: TableBorderEdgeTarget }
    | { scope: TableBorderEdgeTarget; spec: TableBorderSpec };

  /**
   * Commit an internal column-divider resize from an explicit pointer target.
   * Widths are twips for the adjacent pair; their sum must match the pre-drag total.
   */
  commitTableColumnDividerResize: {
    target: TableColumnDividerResizeTarget;
    leftWidthTwips: number;
    rightWidthTwips: number;
  };

  /**
   * Commit an outer-right table-edge resize from an explicit pointer target.
   * Updates the last grid column and overall table width together.
   */
  commitTableRightEdgeResize: {
    target: TableRightEdgeResizeTarget;
    columnWidthTwips: number;
    tableWidthTwips: number;
  };

  /**
   * Select a table region — the whole table, the current row, or the current column.
   * Legacy's table toolbar offers all three.
   */
  selectTableRegion: { region: 'table' | 'row' | 'column' };

  /**
   * Table-level properties from the table properties dialog: preferred width and
   * its unit (`dxa`, `pct`, `auto`), and horizontal justification. `null` clears a
   * property; omitting it leaves the current value alone.
   */
  setTableProperties: {
    width?: number | null;
    widthType?: string | null;
    justification?: 'left' | 'center' | 'right' | null;
  };

  // Page/section breaks go through the inherited `insertBreak`. The Office JS
  // API we intend to expose has a single insertBreak(breakType); the section
  // subtypes ride that open breakType — `section` and `sectionContinuous` are
  // there now, even / odd join them when layout skips their blank sheet.
  /**
   * Section-level page setup: the fields Word's Page Setup dialog and the rulers'
   * margin drags change. Twips throughout, matching OOXML. Every field is optional —
   * a margin drag sends one, the dialog sends several — and an omitted field is left
   * as it is rather than reset. `scope` is Word's "Apply to": `'document'` (the
   * default) writes every section; `'section'` writes only the section the selection
   * is in. An orientation change without explicit dimensions swaps each written
   * section's own dimensions, preserving distinct paper sizes.
   */
  setPageSetup: {
    pageWidth?: number;
    pageHeight?: number;
    marginTop?: number;
    marginRight?: number;
    marginBottom?: number;
    marginLeft?: number;
    orientation?: 'portrait' | 'landscape';
    scope?: 'document' | 'section';
  };

  /** Remove the selection paragraphs' tab stop at this position (twips); none there: `notFound`. */
  removeTabMark: { positionTwips: number };

  /**
   * Replace one match with `text`: a {@link TextMatch}, or a {@link HighlightRange} you
   * computed. An empty `text` deletes it. One undo step, which joins an open `historyGroup`.
   * In suggesting mode it is a tracked replacement under the editor's author, refused where
   * `proposeReplacement` would be. The active story, selection, and scroll stay put: a header,
   * footer, or note that is not open is edited in place, without opening it.
   * Without `scope`, the story comes from `blockId`; a `scope` naming another story returns
   * `invalidArgs`. A text box, or tracked deleted or moved text, returns `unsupported`. Expected
   * text (`expectedText`, else `text`) that the offsets no longer hold, or an unknown `blockId`,
   * returns `notFound` and changes nothing; find it again.
   *
   * On a server, use `range.insertText(text, 'Replace')` from `@docx-editor.dev/editor-api`.
   *
   * @example
   * ```ts
   * const [match] = editor.findMatches('30 days', { matchCase: true });
   * if (match) editor.exec({ type: 'replaceMatch', match, text: '45 days' });
   * const range = { blockId, start: 3, length: 5, expectedText: 'go to' };
   * const result = editor.exec({ type: 'replaceMatch', match: range, text: 'goes to' });
   * if (!result.ok && result.code === 'notFound') refreshSuggestions();
   * ```
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/tracked-replacement | Replace as a tracked change}
   */
  replaceMatch: { match: TextMatch | HighlightRange; text: string };

  /** Fix a range of `ParagraphText.acceptedText`, editing only the letters that differ. */
  replaceAcceptedText: ReplaceAcceptedTextCommand;

  /**
   * Replace every match of `query` with `text` (empty deletes) in one undo step, across the
   * stories {@link Editor.findMatches} searches; tracked in suggesting mode. Skips and refusals:
   * {@link ReplaceAllMatchesOutcome}. Refused past the search limit (`unsupported`).
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/tracked-replacement | Replace as a tracked change}
   */
  replaceAllMatches: {
    query: string;
    text: string;
    matchCase?: boolean;
    wholeWord?: boolean;
  };

  /**
   * How the selected image sits relative to text. `inline` flows in the line; the rest
   * are `wp:anchor` variants, with `squareLeft`/`squareRight` distinguishing which side
   * text wraps on. Legacy's vocabulary, unchanged.
   */
  setImageWrapType: {
    drawingNodeId?: string;
    expectedPackageRevision?: number;
    target:
      | 'inline'
      | 'square'
      | 'squareLeft'
      | 'squareRight'
      | 'tight'
      | 'through'
      | 'topAndBottom'
      | 'behind'
      | 'inFront';
    /** Where an inline image sat, so promoting it to an anchor keeps its place. */
    initialPositionEmu?: { horizontalEmu: number; verticalEmu: number };
  };

  /** Rotate or flip the selected image. Legacy composed these into a CSS transform. */
  transformImage: {
    drawingNodeId?: string;
    expectedPackageRevision?: number;
    action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV';
  };

  /** Anchor position of the selected floating image, from the position dialog. */
  setImagePosition: {
    drawingNodeId?: string;
    expectedPackageRevision?: number;
    horizontalEmu?: number;
    verticalEmu?: number;
    relativeToH?: string;
    relativeToV?: string;
  };

  /** Fill of the selected shape, text box, line or group. See {@link SetShapeFillCommand}. */
  setShapeFill: SetShapeFillCommand;
  /** Outline of the selected shape, text box, line or group. */
  setShapeOutline: SetShapeOutlineCommand;

  /** Size, alt text, crop, position, and border of the selected image, from the properties dialog. */
  setImageProperties: {
    /** Expected drawing node id captured when the dialog opened. */
    drawingNodeId?: string;
    /** Package revision captured when the dialog opened. */
    expectedPackageRevision?: number;
    /** Selection anchor captured when the dialog opened. */
    selectionParagraphId?: string;
    /** Selection offset captured when the dialog opened. */
    selectionOffset?: number;
    widthEmu?: number;
    heightEmu?: number;
    alt?: string;
    title?: string;
    description?: string;
    hyperlink?: string | null;
    crop?: ImageCropPercent;
    resetToNaturalSize?: boolean;
    wrap?: ImageWrapTarget;
    horizontalEmu?: number;
    verticalEmu?: number;
    relativeToH?: string;
    relativeToV?: string;
    borderWidthEmu?: number;
    borderColor?: ColorValue;
  };

  /**
   * Insert a raster image at the caret as one package undo unit.
   *
   * `widthPoints`/`heightPoints` are the extent to insert AT MOST: Word's insert rule, an
   * extent that does not fit where the caret flows (its cell, column, or page content box)
   * is scaled down proportionally to fit. Read the committed extent back from
   * `snapshot().image` or `getSelectedImage()`; use `setImageProperties` to enlarge past
   * the fit afterwards.
   */
  /** Insert a rectangular body textbox and enter its text. */
  insertTextBox: Record<never, never>;

  insertImage: {
    /** Exact result from `positionAtPoint` or a drop event; stale targets refuse the insert. */
    at?: EditorPointPosition;
    data: Uint8Array;
    mime: SupportedImageMime;
    widthPoints: number;
    heightPoints: number;
    expectedPackageRevision?: number;
    title?: string;
    description?: string;
    hyperlink?: string;
  };

  /** Replace the selected picture's bytes as one package undo unit. */
  replaceImage: {
    data: Uint8Array;
    mime?: SupportedImageMime;
    drawingNodeId?: string;
    expectedPackageRevision?: number;
  };

  /** Delete the selected picture drawing as one package undo unit. */
  deleteImage: {
    drawingNodeId?: string;
    expectedPackageRevision?: number;
  };

  /**
   * Replace the document watermark in every header the document shows; null removes it. One
   * undo step. Refuses with `invalidArgs` for an invalid option and `locked` in a protected
   * document; a refusal writes nothing. See {@link Watermark} for the options and defaults.
   */
  setWatermark: { watermark: Watermark | null };
  /** Insert a generated, hyperlink-enabled TOC for heading levels 1–3 at the selection. */
  insertToc: Record<never, never>;
  /** Open options for the selected or context-clicked legacy text form. */
  editTextFormField: Record<never, never>;
  refreshToc: { tocId?: string; mode?: 'entire' | 'pageNumbers' };
  /**
   * Remove a table of contents: its field, or the table of contents control around it with
   * its heading. Text before and after the field stays. Without `tocId`, removes the table of
   * contents last right-clicked, the one at the selection, or the only one. One undo step.
   * Refuses with `notFound` when there is none, and while suggesting.
   */
  removeToc: { tocId?: string };

  undo: Record<never, never>;
  redo: Record<never, never>;
  /**
   * Move the selection. Three accepted forms, and `can()` names all three when it refuses:
   * a collapsed paraId anchor, a range of two paraId anchors, or an anchor/head pair of
   * text positions. A text position takes `blockId`, or the older name `paragraphId`; a
   * position with neither, or with both naming different paragraphs, refuses `invalidArgs`.
   * A {@link EditorSelectionRange} read passes here unchanged.
   *
   * `{ anchor }` takes a {@link DocAnchor} rather than an {@link EditorPosition} because a
   * collapsed SEMANTIC position is spelled as a range whose anchor and head are equal, which
   * is what a caret already is.
   */
  setSelection: { anchor: DocAnchor } | { range: EditorSelection };

  // ── Selection and clipboard ─────────────────────────────────────────────────────────
  //
  // None of these is new capability: the surface has selected the whole document, read its
  // selected text and deleted a selection since it was written, and the browser's own
  // `copy`/`cut`/`paste` events on the pages layer already service the keyboard. They are
  // here so that a caller NAMING the operation — a right-click menu, a host's own button —
  // gets one honest `can()` for it, instead of composing it from `selectedText` +
  // `deleteText` and re-deriving enablement itself, differently, every time.

  /** Select the whole body. Word's Ctrl+A, as a command rather than only a keystroke. */
  selectAll: Record<never, never>;

  /**
   * Put the selected text on the clipboard. Reports `changed: false` — the document is
   * untouched.
   *
   * Refused at a collapsed selection: there is nothing to copy, and a live Copy row over an
   * empty selection silently no-ops.
   */
  copy: Record<never, never>;

  /**
   * Put the selected text on the clipboard and delete it. Refused at a collapsed selection,
   * and — unlike `copy` — in a read-only document.
   *
   * The clipboard write is dispatched but NOT awaited, and its failure does not fail the
   * command: the deletion has already happened by then, and reporting an edit as failed
   * because a clipboard write lost a race would be a lie about the document.
   */
  cut: Record<never, never>;

  /**
   * Insert the clipboard payload at the selection, replacing it.
   *
   * PAYLOAD COMES IN. `exec` is synchronous and reading the clipboard is not — it prompts
   * in Chrome and is refused outright by Firefox and Safari — so an engine-owned read
   * would have to either turn every command's result into a promise or lie about this
   * one's. The caller reads the clipboard inside the click or keystroke that asked for
   * the paste, which is where the permission gesture belongs, and hands the engine what
   * it read.
   *
   * `html`, when present, routes through the same fidelity order as the paste event:
   * an embedded fragment first, then the bounded external-HTML projection, then `text` —
   * degrading on any refusal. Without `html`, the plain lane inserts `text` with
   * newlines becoming real paragraph boundaries, as this command always has.
   */
  paste: { text: string; html?: string };

  /**
   * Insert `text` as if typed, whatever richer flavours the clipboard held.
   *
   * The plain twin `paste` deliberately lacked while there was no rich lane; with one,
   * "paste" and "paste without formatting" are two different user intentions
   * (Cmd+V / Cmd+Shift+V) and each needs a name a menu row can call.
   */
  pasteWithoutFormatting: { text: string };
}

/**
 * One command, as a discriminated union derived from {@link EditorCommands}.
 *
 * This is what `can` and `exec` take. Widening `EditorCommands` widens it automatically.
 */
export type EditorCommand = {
  [K in keyof EditorCommands]: { type: K } & EditorCommands[K];
}[keyof EditorCommands];

/**
 * Every query the editor answers, keyed by name with its arguments as the value.
 *
 * Extends {@link DocQueries} with the reads that only mean something against a live, laid-out
 * document: the selection, its formatting, the table or hyperlink under the caret.
 */
export interface EditorQueries extends DocQueries, EditorChartQueries {
  selection: Record<never, never>;
  selectionFormatting: Record<never, never>;
  tableContext: Record<never, never>;
  hyperlinkAt: { pos?: number; fallbackHref?: string };
  selectedText: Record<never, never>;
  watermark: Record<never, never>;
  splitCellConfig: Record<never, never>;
  contentControlAt: { filter?: ContentControlFilter };
  isInsideToc: { pos: number };
  trackedChanges: Record<never, never>;
  /** Every bookmark in the document, hidden ones included, in document order. */
  bookmarks: Record<never, never>;
}

/**
 * One query, as a discriminated union derived from {@link EditorQueries}.
 *
 * This is what `query` takes; {@link EditorQueryResults} says what each answers.
 */
export type EditorQuery = {
  [K in keyof EditorQueries]: { type: K } & EditorQueries[K];
}[keyof EditorQueries];

/** What each editor query returns. Keyed identically to `EditorQueries`. */
export interface EditorQueryResults extends DocQueryResults, EditorChartQueryResults {
  selection: DocRange | null;
  selectionFormatting: RunFormatting | null;
  tableContext: TableContext | null;
  hyperlinkAt: HyperlinkInfo | null;
  selectedText: string;
  watermark: Watermark | null;
  splitCellConfig: { maxRows: number; maxCols: number } | null;
  contentControlAt: ContentControlSummary | null;
  isInsideToc: boolean;
  trackedChanges: readonly Revision[];
  bookmarks: readonly BookmarkSummary[];
}

/**
 * A read model of the current editor state, safe to hand to framework
 * rendering. Named `EditorSnapshot` rather than `EditorState` so it never
 * collides with an editing engine's own state type.
 */
export interface EditorSnapshot {
  readonly scope: EditorScope;
  /** Whether the editor is still waiting for a document: no bytes handed over yet, and no
   *  parse failure. Bytes count from the moment they are supplied, not from the moment
   *  pages paint, so this stays false across a detach and remount. Safe to gate a mount
   *  point on — it never depends on one existing. */
  readonly isLoading: boolean;
  /**
   * Whether a supplied document is still on its way to painted pages. A large document
   * mounts behind one painted frame so a loading screen can show instead of a frozen page,
   * with the previous document (if any) still on screen. Show an overlay while it holds,
   * but gate only chrome on it, never the mount point, which must stay mounted for the open
   * to complete ({@link EditorSnapshot.isLoading} is the gate-safe flag). It turns false
   * when the first pages paint; they take input while the rest lay out. Optional and
   * additive: absent means the implementation has not derived it, read as `false`.
   */
  readonly isOpening?: boolean;
  readonly parseError: string | null;
  /**
   * Why the last supplied document did not open, or `null` while it opens or after it opened.
   * Unlike {@link EditorSnapshot.parseError}, it holds a stable code and never quotes the
   * file, so a host can show it to a person. `DocxEditor.OpenFailure` renders it. Optional
   * and additive: absent means the implementation has not derived it, read as `null`.
   */
  readonly openFailure?: DocumentOpenFailure | null;
  /** Whether the loaded document is being edited: a patchable document opened in edit mode. A
   *  read-only document (tables/SDTs/unpreservable) or `mode: 'view'` reports false. */
  readonly editable: boolean;
  readonly zoom: number;
  /**
   * Where {@link EditorSnapshot.zoom} came from.
   *
   * Both are needed, and neither implies the other: `zoom` is the resolved scale a ruler
   * multiplies by, `zoomMode` is what a zoom control has to show as selected. A menu that
   * ticked the entry matching the percentage would tick "75%" while the editor was tracking
   * the viewport and about to move off it.
   *
   * Optional and additive like `pageSetup`; absent means the implementation has not derived
   * it, and a consumer reads absent as a plain fixed scale.
   */
  readonly zoomMode?: ZoomMode;
  readonly selection: DocRange | null;
  /**
   * Whether the selection is a CARET rather than a range. `true` when nothing is loaded.
   *
   * Separate from `selection` because `DocRange` addresses paragraphs by paraId and carries
   * no offsets, so a caret and a range inside one paragraph are the same value there.
   * Answering this from `query({ type: 'selectedText' })` builds the whole selected string
   * to produce one bit, on every tick a host's selector runs.
   */
  readonly selectionCollapsed: boolean;
  /**
   * The selection with offsets, as {@link EditorSelectionReads.getSelectionRange} returns it.
   * Reference-stable while the selection does not move.
   */
  readonly selectionRange: EditorSelectionRange | null;
  readonly formatting: RunFormatting | null;
  readonly table: TableContext | null;
  /**
   * The table of contents the last right-click landed on, or null.
   *
   * NOT caret context, unlike `table`: a generated TOC refuses the caret outright, so a
   * right-click on it leaves the selection where it was, and a host's context menu could otherwise
   * never tell which table of contents it was opened over. Cleared by a right-click
   * anywhere else.
   */
  readonly tocContext: { readonly id: string } | null;
  readonly image: ImageContext | null;
  /** The selected chart, while exactly one chart drawing is selected; else null. */
  readonly chart: SelectedChartState | null;
  readonly page: { readonly current: number; readonly total: number };
  /**
   * Whether undo/redo have anything to apply, derived from the session's history.
   * Optional and additive: an implementation that has not derived them omits them,
   * and a consumer treats absent as `false` — the honest empty answer.
   */
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  /**
   * The section's page setup, reference-stable across ticks that did not change it.
   * Optional and additive like `canUndo`: absent means the implementation has not
   * derived it, `null` means no document is loaded.
   */
  readonly pageSetup?: PageSetup | null;
  /**
   * Whether the review pane is showing its cards.
   *
   * In the SNAPSHOT because chrome reflects it: the toolbar's comments button is pressed
   * while it is open, and a button reads its pressed state from the snapshot like every
   * other button. Kept off the snapshot it stayed pressed after the pane closed, because a
   * value-equal snapshot correctly refuses to re-render.
   */
  readonly reviewPaneOpen?: boolean;
  /**
   * The review pane settings in force: every field of `ReviewPaneOptions`, such as when the
   * pane opens by itself and what it does when its card column does not fit. Change them with
   * `setReviewPaneOptions`. Never saved. Always
   * set: an editor without a review module reports `DEFAULT_REVIEW_PANE`.
   */
  readonly reviewPane: ResolvedReviewPane;
  /** Whether Show/Hide paragraph marks is enabled. */
  readonly showParagraphMarks?: boolean;
  /** Whether bracket marks are shown at bookmarks. */
  readonly showBookmarks?: boolean;
  /** The document's `w:documentProtection`, as the file states it; null with no document. */
  readonly documentProtection?: DocumentProtectionState | null;
  /** The displayed revision projection. The document and its revision history stay unchanged. */
  readonly reviewDisplayMode?: ReviewDisplayMode;
  /** Resolved local viewer preferences. Never saved into the document. */
  readonly revisionMarkup: ResolvedRevisionMarkup;
  /**
   * Whether the document carries review content — tracked changes or comment
   * anchors — independent of any registered review module.
   *
   * The free tier's honest signal: revisions render in their final-state
   * projection there, so without this a host cannot tell its user "this
   * document has tracked changes" — the one fact the upsell hint needs.
   * Optional and additive like `canUndo`; derived cheaply from store
   * vocabulary and memoized per revision.
   */
  readonly hasReviewContent?: boolean;
  /** Authors whose revisions currently render as accepted and whose comments stay hidden. */
  readonly hiddenReviewAuthors?: readonly string[];
  /**
   * Lifecycle of the attached collaboration replica, or `'inactive'` when no
   * collaboration module is registered.
   *
   * The free tier's honest upsell signal: a host can render from this value
   * without importing `@docx-editor.dev/pro`. When a module is registered the
   * field follows the session's `status()`.
   */
  readonly collaborationStatus: CollaborationStatus | 'inactive';
  /**
   * How edits are written right now.
   *
   * In the snapshot for the same reason `reviewPaneOpen` is: the editing-mode control shows
   * it, and a control reads what it shows from the snapshot like every other control.
   */
  readonly editingMode?: DocumentEditingMode;
  /**
   * Why the last edit was refused, or null.
   *
   * The engine knew — `lastRejection` has been on the surface all along — and nothing
   * published it, so a keystroke refused because the document is open for viewing, or
   * because suggesting has no author to attribute a proposal to, looked to the user like
   * the editor had simply stopped responding.
   */
  readonly lastRejection?: string | null;
  /**
   * Document font families that are NOT AVAILABLE: declared by the document, but with no byte
   * source admitted, no redirect to an admitted face, nothing embedded, and nothing the platform
   * could resolve. Chrome shows a compatibility notice from this the way Word does.
   *
   * A family the app answers with a metric-compatible stand-in — Word's Times New Roman
   * with Liberation Serif — is AVAILABLE and stays out: the outlines differ, the advance
   * widths do not, so wrap and pagination land where Word puts them. The face a `w:sym`
   * names (MS Gothic for a checkbox, Wingdings for a bullet) stays out while each glyph it
   * draws has a Unicode equivalent, because any face can paint that. A `w:sym` face joins
   * when one of its glyphs is a private-use code point with no equivalent, because that
   * glyph shows as a missing-glyph box in every other face.
   *
   * Optional and additive like `canUndo`: absent means the implementation has not derived
   * it; empty means every family resolved (or no document is loaded).
   */
  readonly fontSubstitutions?: readonly string[];
  /**
   * Format painter arming, and the level of what it holds. Here for the same reason
   * `lastRejection` is: it moves no revision and no caret, so a mode the snapshot does not
   * carry is a mode no toolbar can reflect. Optional and additive.
   */
  readonly formatPainter?: FormatPainterSurfaceState;
}

/**
 * An error the engine raised, carrying a machine-readable `code` alongside the message.
 *
 * `code` is optional because an `Error` from deeper down (a parser, a codec) is surfaced as-is
 * rather than wrapped in a fabricated code. The editor's own codes: `invalidTarget` (`attach`
 * cannot mount there), `unsupported` (a source it refuses to open), and `hostCallback` (a host
 * callback such as a bookmark mark's `decorate` threw; the editor kept its default behavior).
 */
export interface EditorError extends Error {
  readonly code?: string;
}
