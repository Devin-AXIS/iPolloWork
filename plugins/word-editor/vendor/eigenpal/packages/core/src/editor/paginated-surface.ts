import { pointerStoryTransitions } from './surface-pointer-stories.ts';
import { invalidatePointTargets } from './editor-point-target.ts';
import { bindSurfaceDragControllers } from './surface-drag-controllers.ts';
import {
  createUnsupportedElementProjection,
  unsupportedElementPaintOptions,
  validateUnsupportedElementRules,
} from './unsupported-element-state.ts';
import { DocumentSelectionHistory } from './document-selection-history.ts';
import { timedLayout, timedPress } from './surface-timing.ts';
import {
  armedFormatAt,
  armCaretFormat,
  type ArmedFormat,
  type CaretFormatSnapshot,
  restoreCaretFormatSnapshot,
  type PendingFormat,
} from './caret-format-state.ts';
import { CaretFormatHistory } from './caret-format-history.ts';
import { createTypedDirectionOps } from './surface-typed-direction.ts';
import {
  createSurfaceRevisionMarkup,
  revisionFacingPages,
  revisionParagraphMarkVisible,
} from './surface-revision-markup.ts';
import { createDrawingGestures } from './surface-drawing-gestures.ts';
import { createTextboxEditing } from './surface-textbox-editing.ts';
import { storyOutsideTextbox, textboxOwnerDeps } from './surface-textbox-owner.ts';
import { createCaretComplexScriptResolver } from './surface-complex-script.ts';
import { applySurfaceStrings } from './surface-accessibility.ts';
import { refreshWriteBlocked, registerRefreshComposition } from './refresh-write-guard.ts';
import { UNEXPLAINED_WRITE_REFUSAL, writeBlockReason } from './refresh-write-guard.ts';
import { createLegacyDropdownInteraction } from './surface-legacy-dropdown.ts';
import { listSeparatorEnter } from './list-separator-enter.ts';
import { browserInputPending } from './surface-input-pending.ts';
export { setPaginatedSurfaceScale } from './surface-scale.ts';
import { REPLICABLE_REVIEW_WRITES } from './surface-review-writes.ts';
import { listParagraphStyleId } from './surface-list-style.ts';
import { ensureSeparatorStyle } from './list-separator-style.ts';
import { armContentControlMenuDismiss } from './content-control-widget-dismiss.ts';
import { contentControlMenuAnchor } from './content-control-widget-anchor.ts';
import { createFormFieldShading } from './surface-form-field-shading.ts';
import {
  FIELD_CODE_INPUT_REFUSAL,
  selectionTouchesFieldCodeInput,
} from './surface-field-code-input.ts';
import {
  fullyProtectedTocParagraphs,
  tocControlId,
  tocForElement,
  tocEscapePosition,
  tocAtPosition,
  selectionTouchesTocRange,
  opTouchesTocRange,
  paragraphInBodyToc,
} from './surface-toc-ranges.ts';
import { tocBoundaryForLayout } from './surface-toc-boundary.ts';
import { resolveTocSources } from '../store/package/toc-sources.ts';
import { createTocCommands } from './surface-toc-commands.ts';
import {
  commandProtectionRefusal,
  createControlWriteRefusal,
  registerContentLockPolicy,
  registerFormFieldIdentity,
  writeRejectionReason,
} from './command-protection.ts';
import {
  browserDefaultMeasurer,
  createFontFaceUsage,
  registerSurfaceMeasurement,
  registerUsedFontFaces,
} from './surface-measurement.ts';
import {
  PROGRESSIVE_OPEN_FIRST_BLOCKS,
  completeProgressiveOpen,
  openingReveals,
  startOpeningSlices,
} from './surface-progressive-open.ts';
import { scrollBandIntoView, type ContentScrollOptions } from './surface-content-scroll.ts';
import { createDeferredLayout } from './surface-deferred-layout.ts';
import { createCanonicalLayout } from './surface-canonical-layout.ts';
import { drainLayoutSteps, type LayoutSteps } from '../layout/layout-steps.ts';
import { createReviewOrderIndex } from './surface-review-order.ts';
import { litReviewKeys, reviewItemsByKey } from './review-replacement-pairs.ts';
import { bodyBlockCountOf, bodyBlockLimitAfter, bodyBlocksOf } from '../layout/body-block-limit.ts';
import { snapshotLayoutSession } from '../layout/layout-session-snapshot.ts';
import { furnitureLaterSteps } from './surface-furniture-later.ts';
import {
  createContentControlWidgetSessions,
  contentControlValueOps,
  contentControlWidgetItems,
  contentControlWidgetDate,
  contentControlWidgetValue,
} from './content-control-widget-session.ts';
import { createContentControlPictureWidget } from './content-control-picture-widget.ts';
import {
  insertOwnerOf,
  promptInsertionLanding,
  typedInsertText,
} from './content-control-prompt-landing.ts';
import { createContentControlHover } from './content-control-hover.ts';
import {
  contentControlAtSelection,
  controlOutsidePrompt,
  memoizedContentControlSelection,
} from './content-control-at-selection.ts';
import { collapseHorizontalSelection as collapseSelection } from './surface-selection-collapse.ts';
import { createParagraphMarkVisibility } from './surface-paragraph-mark-visibility.ts';
import { saveSurfaceDocument, saveSurfaceDocumentSteps } from './docx-editor-save.ts';
import { applyTextFormOperation, applyTextFormSave } from './surface-text-form-apply.ts';
import { beginSurfaceCommit, withSplitSelection } from './surface-commit-state.ts';
import { createSurfaceDateLocale } from './surface-date-locale.ts';
import {
  buildContentControlCalendar,
  buildContentControlListMenu,
  focusContentControlCalendar,
  placeContentControlMenu,
  type ContentControlMenuHost,
} from './content-control-widget-menu.ts';
import { createLegacyCheckboxInteraction } from './surface-legacy-checkbox.ts';
import { createTextFormFieldInteraction } from './surface-text-form-fields.ts';
import { formsProtectionEnabled, sectionProtectsForms } from '@docx-editor.dev/core/store';
// Engine-owned paginated paragraph surface (composition root).
// Painted pages are the editable surface; seams live in sibling surface-*.ts modules.

/* eslint-disable max-lines -- composition root; seams live in surface-*.ts */

import { attributeTrackedOps, isDocumentEdit, isTrackedEdit } from './surface-tracked-ops.ts';
import { isMissingAuthorRefusal } from './docx-editor-author.ts';
import { openTreeSession, type TreeDocxSession } from '@docx-editor.dev/core/binding';
import {
  TOC_MAX_PAGE_PASSES,
  detectBodyTocs,
  findNode,
  isContentControl,
  parentNodeOf,
  ORIGIN_IDS,
  paragraphTextOf,
  parseTocInstruction,
  planTocEntries,
  resolveTocRowHeadings,
  validateTreeOp,
  type DetectedToc,
  type OoxmlElement,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { selectPastedDrawing } from './surface-chart-clipboard.ts';
import { createHiddenMarkEditing, type RevisionView } from './hidden-mark-joins.ts';
import { drawingSelectionPosition } from './surface-drawing-selection.ts';
import { syncActiveFieldShading } from './surface-field-shading.ts';
import {
  createLayoutScheduler,
  createLayoutSession,
  createParagraphLayoutCache,
  cellSelectionRects,
  formatPageNumber,
  emptyTocPlaceholderParagraphIds,
  paragraphFragmentsOf,
  reviewItemKey,
  reviewThreadRootOf,
  selectionRects,
  caretAt,
  contentControlHoldingParagraph,
  contentControlRecordsInPart,
  contentControlsInLayout,
  createDocumentLinkProjectors,
  resolveNumberingLevel,
  positionPastDeletion,
  withNumberingStyleLinks,
  type CellSelection,
  type ContentControlBoundaryRecord,
  type KeyedRange,
  type LayoutScope,
  type NavigationCommand,
  type ReviewItem,
  type ReviewRevisionKind,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
  paragraphTextFromLayout,
} from '@docx-editor.dev/core/layout';
import { attachListResolveChangeEvidence } from '../layout/list-resolve.ts';
import { rangesOnPages } from '../layout/selection-rects.ts';
import { paragraphStartPages, pastLeadingBreaks } from '../layout/paragraph-start-page.ts';
import { keyedRangeRectsWithTextboxes } from './textbox-presence-layout.ts';
import { refreshSurfaceRefFieldResults } from './surface-ref-field-refresh.ts';
import { type RevisionAuthorFilter } from '../layout/revision-projection.ts';
import { surfaceRevisionFilter } from './surface-unlisted-filter.ts';
import { createFurnitureFilterMemo } from './surface-furniture-filter.ts';
import { createRevisionAuthorVisibility } from './revision-author-visibility.ts';
import type { PaginatedSurfaceRuntimeOptions } from './surface-runtime-options.ts';
import { scopeSession, surfaceFieldResultsScope } from './field-results-scope.ts';
import { withSavedFieldResults } from './surface-saved-field-results.ts';
import { bindSurfaceViewport, type SurfaceViewportBinding } from './surface-viewport-binding.ts';
import { createSurfaceHostListeners } from './surface-host-listeners.ts';
import { hostTimers, hostWindowOf } from './host-realm.ts';
import { afterNextPaint, landingGuard } from './surface-composition-commit.ts';
import { createSurfaceHosting } from './surface-host-move.ts';
import { reviewItemsAtSelection } from '../store/store/review-items.ts';
import { mergedPredecessorsOf } from '../layout/line-segments.ts';
import type { CaretGeometry } from '../layout/semantic-interaction.ts';
import { paintSelectionOverlay, type OverlayRect } from '@docx-editor.dev/core/output';
// By module path, like the roster walk below: dropping a retained paint is an engine
// internal for the IME lane, not something the output barrel should offer consumers.
import {
  discardRetainedPaint,
  paintSemanticLayoutWithAuthorSlots,
} from '../output/semantic-paint.ts';
import { createInputMethodLane } from './surface-ime-deletion.ts';
// By module path: the roster walk is an engine internal, not part of the output barrel's
// public surface. See the note there.
import {
  createStableReviewAuthorSlots,
  type ReviewAuthorInfo,
} from '../output/revision-presentation.ts';
import { createSurfaceReviewAuthors, reviewItemAuthor } from './surface-review-authors.ts';
import { createPresenceColors } from './surface-presence-color.ts';
import {
  DEFAULT_DRAWING_PAINT_STRINGS,
  detachDrawingUrlRegistry,
  drawingPaintStringsCacheToken,
  type DrawingPaintStrings,
} from '../output/semantic-paint-drawings.ts';
import {
  breakMarkStringsCacheToken,
  breakMarkStringsFromTranslate,
} from '../output/semantic-break-marks.ts';
import {
  collaborationParagraphAt,
  localCollaborationSelection,
  paintRemoteSelections,
} from './surface-remote-selection.ts';
import type {
  ContentControlOps,
  DrawingSelectionIntent,
  OpenPaginatedResult,
  PaginatedSurfaceOptions,
  PaginatedSurfaceState,
  RemoteCaretLabelHost,
  ScaleMutableSurface,
  SurfaceEditingMode,
} from './paginated-surface-contract.ts';
import type { ExecResult, SelectionPin, ViewScope } from '../contracts/editor.ts';
import type { TableCommandPlan } from './table-command-plan.ts';
import { suggestingRefusalIn } from './surface-suggesting-structure.ts';
import { wholeTableDeletionPlan } from './table-select-plan.ts';
import {
  createSurfaceTableSelectHandle,
  type SurfaceTableSelectHandle,
} from './surface-table-select-handle.ts';
import {
  clampedToDocument,
  collapsedAt,
  cellsPlainText,
  orderedRangeOf,
  rangePlainText,
  surfaceSelectionMarkRects,
  type RangeDeletionPlan,
} from './surface-selection-ops.ts';
import {
  createBeforeInputHandler,
  createClipboardHandlers,
  createKeyDownHandler,
} from './surface-input.ts';
import { createSurfaceClipboardOps } from './surface-clipboard-ops.ts';
import { createSurfaceRangeEditOps } from './surface-range-edit.ts';
import { createSurfaceWordDeletion } from './surface-word-deletion.ts';
import {
  carriedSelectionOf,
  createRemoteCaret,
  historySelectionOf,
  mapSelectionAcrossText,
} from './surface-remote-caret.ts';
import { createNextStyleWrites } from './surface-next-style.ts';
import {
  createFurnitureSource,
  createSurfaceStyleDeps,
  applyPageOffsets,
  equalPageSets,
  equalSurfaceExtents,
  centreViewportOn,
  viewportCentreX,
  surfaceExtent,
  surfaceScroller,
  visiblePageSet,
  viewportPage,
  type SurfaceExtent,
} from './surface-pages.ts';
import {
  tryCreateBrowserImageDecodePort,
  createHeadlessImageDecodePort,
} from './browser-image-decode-port.ts';
import { createBrowserPaintImageUrlPort } from './browser-paint-image-url-port.ts';
import { createInlineDrawingLayoutBundle } from '../layout/inline-drawing-source.ts';
import {
  layoutDocumentViewSteps,
  type LayoutDocumentViewOptions,
} from '../layout/document-layout-coordinator.ts';
import { applyPagesEditableChrome } from './surface-view-mode.ts';
import { createSurfaceCaret } from './surface-caret.ts';
import { createSurfaceBookmarks, storyContentBox } from './surface-bookmarks.ts';
import { defaultTableLabel, type TableInteractionLabelKey } from './table-chrome.ts';
import { createSurfaceTableInteraction } from './surface-table-interaction.ts';
import { createSurfaceFormat } from './surface-format.ts';
import { createSurfaceFormatPainter } from './surface-format-painter.ts';
import { authoredRunPropertiesAt, type SurfaceProperty } from './surface-formatting.ts';
import { mergedRunWrite } from '../store/store/direct-properties.ts';
import { bindDirectionChord, createDirectionChordHandler } from './surface-direction-chord.ts';
import { createPointerController, type PointerController } from './surface-pointer.ts';
import {
  crossNoteWriteRefusal,
  followOpenNoteToHead,
  withinOpenNote,
} from './surface-note-story.ts';
import { absorbAtomicControls, leaveAtomicControl } from './surface-atomic-controls.ts';
import { createReviewViewState } from './surface-review-view.ts';
import { selectionsEqual } from './dom-selection.ts';
import { createSurfaceSelectionSync } from './surface-selection-sync.ts';
import { createSurfaceStructure } from './surface-structure.ts';
import { listDefinitionReads } from './list-level-geometry.ts';
// Deep import, not the store barrel: re-exporting a bound from there pulls the whole store
// namespace into the published editor-api surface for one number.
import { MIN_TABLE_COLUMN_WIDTH_TWIPS } from '../store/store/table-constraints.ts';
import { createFieldLinkRegistry } from './surface-field-links.ts';
import { createHyperlinkOps } from './surface-hyperlinks.ts';
import { createJournaledApply } from './surface-journaled-apply.ts';
import { createEquationInteraction, createEquationOps } from './surface-equations.ts';
import { createSurfaceNavigation } from './surface-navigation.ts';
import { drawingLinkByIdFromLayout } from './drawing-link-index.ts';
import {
  furnitureCaretHost,
  navigateInActiveScope,
  noteCaretHost,
  pointerHeaderFooterState,
  scopedDocumentOrder,
  setEditingModeChrome,
  setHeaderFooterEditingChrome,
  storyScopeOf,
  partOfNodeId,
  storyScopeOfNodeId,
  noteScopeIdInLayout,
} from './surface-scope.ts';
import { drawingSelectionIntentKey, memberIntent } from './group-member-selection.ts';
import { RANGE_SUFFIX, bandClassFor } from './surface-review-band-class.ts';
import { createCaretViewFollower, type CaretFollowMode } from './surface-caret-follow.ts';
import { createInPlaceReplacement } from './surface-replace-in-place.ts';
import {
  contentChildrenOf,
  contentControlSelectionRange,
} from './surface-content-control-range.ts';
import { createHeaderFooterOps } from './surface-hf-ops.ts';
import { createImageOps } from './surface-image-ops.ts';
import { createChartOps } from './surface-chart-ops.ts';
import {
  createHeaderFooterScopeController,
  isDocumentProtectionBatch,
} from './surface-hf-editing.ts';
import { createNoteOps } from './surface-note-ops.ts';
import { notePropertiesStateOf, notePreviewTextOf } from './surface-note-state.ts';
import { createDerivationPrewarmSteps, scheduleDerivationPrewarm } from './derivation-prewarm.ts';
import { runWithTransactionActor } from '../store/package/actor-scoped-ids.ts';
import {
  CommitHistoryGroup,
  runWithHistoryGroup,
  takeHistoryGroup,
} from './history-group-scope.ts';
import { TypingHistory } from './typing-history.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import { fontTableSerifHangulFace } from '../store/package/font-table-alternates.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { contentLockedOrBound, removalLocked, treeLockRefusal } from './content-control-locks.ts';
import { overlaySheet, sizeOverlaySheets } from './surface-overlay-sheet.ts';
import type { SurfaceOverlayFrame, SurfaceOverlayPainter } from './surface-overlay-sheet.ts';

export type {
  ContentControlOps,
  ContentControlSurfaceState,
  DrawingSelectionIntent,
  OpenPaginatedResult,
  PaginatedSurface,
  PaginatedSurfaceOptions,
  PaginatedSurfacePerf,
  PaginatedSurfaceState,
  ParagraphFlags,
  SurfaceParagraphFormat,
  ParagraphPropertyEdit,
  ParagraphTabStop,
  RemoteCaretLabelAnchor,
  RemoteCaretLabelHost,
  SectionBreakInsertType,
  ReviewWriteIntent,
  SurfaceFormatting,
} from './paginated-surface-contract.ts';
import { revisionDateNow } from '../automation/revision-date.ts';

/**
 * Mount a paginated surface over DOCX bytes.
 *
 * Returns a typed rejection rather than throwing: a failure here is a property of the file,
 * and a host must be able to tell "not a package" from "no body" without parsing an error
 * message.
 */
export function mountPaginatedSurface(
  container: HTMLElement,
  bytes: Uint8Array,
  options: PaginatedSurfaceOptions = {}
): OpenPaginatedResult {
  const runtimeOptions = options as PaginatedSurfaceRuntimeOptions;
  const fieldScope = surfaceFieldResultsScope(options);
  const opened =
    runtimeOptions.openedSession ??
    openTreeSession(bytes, {
      ...(options.reviewModel ? { reviewModel: options.reviewModel } : {}),
      ...(options.contentLockPolicy ? { contentLockPolicy: options.contentLockPolicy } : {}),
    });
  if (!opened.ok) {
    return {
      ok: false,
      reason: opened.reason,
      ...(opened.detail ? { detail: opened.detail } : {}),
      ...('limit' in opened && opened.limit ? { limit: opened.limit } : {}),
    };
  }
  const session = scopeSession(opened.session, fieldScope);
  let unsupportedProjection = createUnsupportedElementProjection(
    validateUnsupportedElementRules(options.unsupportedElementRules ?? [])
  );
  const reviewOrder = createReviewOrderIndex(session);
  const reviewOrderIndex = reviewOrder.index;
  const collaborationSession = options.collaborationModel?.session;
  let author = options.author;
  let scale = options.scale ?? 96 / 72;
  const tableLabelState = {
    resolve:
      options.tableInteractionLabel ?? ((key: TableInteractionLabelKey) => defaultTableLabel(key)),
  };
  const VIEWING_REFUSAL = 'the document is open for viewing';
  /** Document protection, as opposed to the reversible mode — the wording `gateCommand` uses. */
  const TOC_READ_ONLY_REFUSAL = 'the table of contents is generated and read-only';
  /** Set while formatting writes its ops outside a selected table of contents. */
  let formattingOutsideToc = false;
  // The glyphs a serif Korean face lacks fall back to serif faces, in paint and measurement.
  const serifHangulFace = fontTableSerifHangulFace(session.currentPackage());
  const defaultMeasurer = () =>
    browserDefaultMeasurer(container, scale, options.fontAlias, serifHangulFace);
  let defaults = options.measurer ? null : defaultMeasurer();
  const faceUsage = createFontFaceUsage();
  let measurer = faceUsage.wrap(options.measurer ?? defaults!.measurer);
  // Incremental layout machinery — without these every keystroke re-lays out the document.
  const layoutCache = createParagraphLayoutCache<never>();
  let layoutSession = createLayoutSession();
  function producerIdentity(): string {
    if (options.measurer) return options.producer ?? 'host-measurer';
    return `${options.producer ?? defaults?.producer ?? 'fixed-measurer'}@scale:${scale}`;
  }
  let producer = producerIdentity();
  // `lockedControlNavigation: 'atomic'`: inline controls with locked content are one caret unit.
  const atomicNavigation = options.lockedControlNavigation === 'atomic';
  // Construction only. Everything read at RUN time (focus, selection, listeners, timers)
  // resolves from `pagesLayer`, because `moveTo` can carry the pages to another window.
  const mountDocument = container.ownerDocument;

  const pagesLayer = mountDocument.createElement('div');
  const hostListeners = createSurfaceHostListeners(() => pagesLayer);
  pagesLayer.className = 'docx-pages';
  pagesLayer.style.position = 'relative';
  fieldScope.listeners(pagesLayer);

  // THE PAINTED PAGES ARE THE EDITABLE SURFACE.
  //
  // An offscreen input host cannot coexist with a selection on the page: a document has one
  // selection, so focusing the host destroys the page's, and a contenteditable host holding
  // focus with no selection inside it stops firing `beforeinput` at all — typing and
  // Backspace simply stopped working. Putting focus on the pages themselves gives the
  // browser one place for selection, caret, highlight, keystrokes and IME.
  //
  // The DOM is still a PICTURE: every mutation the browser proposes is prevented and
  // translated into a tree op, and each commit repaints from layout records, so a stray
  // edit cannot survive. Geometry still comes only from layout.
  pagesLayer.contentEditable = 'true';
  pagesLayer.spellcheck = false;
  pagesLayer.setAttribute('role', 'textbox');
  pagesLayer.setAttribute('aria-multiline', 'true');
  applySurfaceStrings(pagesLayer, options.translate);
  pagesLayer.style.outline = 'none';

  // The one highlight the browser cannot draw. A SIBLING of the pages, never a child: the
  // page painter sweeps anything it did not paint out of its own subtree, and a stray child
  // of a contenteditable is editable content a keystroke could land in.
  const overlayLayer = overlaySheet(mountDocument, 'docx-selection-overlay');

  // Commented text, highlighted the way Word highlights it. Its own layer OVER the pages —
  // under them the band is invisible, because a page paints an opaque sheet — and the band
  // multiplies rather than covers, which is what a real highlighter does: the yellow darkens
  // the paper and leaves the black glyphs black.
  const commentLayer = overlaySheet(mountDocument, 'docx-comment-overlay');
  // Host text highlights (search results, glossary terms): painted by a facade-owned painter.
  const highlightLayer = overlaySheet(mountDocument, 'docx-text-highlight-overlay');
  let highlightPainter: SurfaceOverlayPainter | null = null;
  const remoteSelectionLayer = overlaySheet(mountDocument, 'docx-remote-selection-overlay');
  const bookmarkLayer = overlaySheet(mountDocument, 'docx-bookmark-overlay');
  const tableFurnitureLayer = overlaySheet(mountDocument, 'docx-table-furniture', false);
  let drop: ReturnType<typeof bindSurfaceDragControllers> | null = null;
  const dropLayer = overlaySheet(mountDocument, 'docx-drop-overlay');
  const tableSelectLayer = overlaySheet(mountDocument, 'docx-table-select-layer', false);
  let tableSelectHandle: SurfaceTableSelectHandle | null = null;

  container.style.position = 'relative';
  // Stacking order over the pages, bottom first.
  const sheets = [
    tableFurnitureLayer,
    tableSelectLayer,
    commentLayer,
    bookmarkLayer,
    highlightLayer,
    remoteSelectionLayer,
    overlayLayer,
    dropLayer,
  ];
  container.replaceChildren(pagesLayer, ...sheets);

  const caret = createSurfaceCaret(
    pagesLayer,
    () => scale,
    () => {
      const active = hfScope?.getActive() ?? null;
      const activeNote = noteOps?.activeNoteScope() ?? null;
      const notePageIndex = noteOps?.activeNotePageIndex() ?? null;
      const scopedHost = active
        ? furnitureCaretHost(pagesLayer, active.pageIndex)
        : activeNote
          ? noteCaretHost(pagesLayer, activeNote.id, notePageIndex)
          : null;
      return {
        layout: editingLayout(),
        selection: hiddenMarks.shownSelection(selection),
        ...selectionSync.caretPreference(active?.pageIndex ?? notePageIndex ?? undefined),
        measurer,
        ...(armedAtCaret()
          ? {
              typingStyle: () => {
                const typingFormat = format.formatting();
                return typingFormat.fontSizeHalfPoints
                  ? {
                      fontSizePt: typingFormat.fontSizeHalfPoints / 2,
                      fontFamily: typingFormat.fontFamily,
                      bold: typingFormat.bold,
                      italic: typingFormat.italic,
                      verticalAlign: typingFormat.superscript
                        ? ('superscript' as const)
                        : typingFormat.subscript
                          ? ('subscript' as const)
                          : ('baseline' as const),
                    }
                  : null;
              },
            }
          : {}),
        scopedHost,
        ...(active
          ? { scopedHostKind: 'headerFooter' as const }
          : activeNote
            ? { scopedHostKind: 'note' as const }
            : {}),
        ...textboxEditing?.caretInput(currentLayout),
        // Viewing selects text but has nowhere to type: the native highlight, never a caret.
        suppress: editingMode === 'view',
      };
    }
  );

  const initialTocParagraphs = fullyProtectedTocParagraphs(session.part());
  const paragraphIds = session.paragraphIds();
  const firstParagraph =
    paragraphIds.find((paragraphId) => !initialTocParagraphs.has(paragraphId)) ??
    paragraphIds[0] ??
    '';
  let selection: SemanticSelection = runtimeOptions.initialSelection ?? {
    anchor: { paragraphId: firstParagraph, offset: 0 },
    head: { paragraphId: firstParagraph, offset: 0 },
  };
  /**
   * How the current selection came to address a drawing — Word's object-selection rule.
   *
   * A caret at a drawing's anchor offset is a TEXT caret unless something selected the
   * object: a pointer press on the painted drawing (`pointer`, carrying its id), or an
   * explicit host selection write that moved the caret (`programmatic`). Typing, caret keys,
   * and a press on anything else return it to `none`, so typing beside an anchored image
   * never rings it — and a fresh mount starts at `none`, so a document whose first run
   * anchors a drawing at offset zero does not open with the image selected.
   */
  let drawingIntent: DrawingSelectionIntent = runtimeOptions.initialDrawingSelectionIntent ?? {
    kind: 'none',
  };
  /** Move the intent and report once when it changes — the flip is observable state. */
  function setDrawingIntent(next: DrawingSelectionIntent, report: boolean): void {
    if (drawingSelectionIntentKey(next) === drawingSelectionIntentKey(drawingIntent)) return;
    drawingIntent = next;
    // Some transitions land on the exact offsets the selection already holds — a press on
    // the drawing at the untouched mount caret adopts an equal selection and publishes
    // nothing — so the flip must report itself for hosts to show or hide the ring.
    if (report) options.onChange?.(currentState());
  }
  /** Sibling of `selection`: rectangle of table cells, or null for ordinary text. */
  let cellSelection: CellSelection | null = null;
  let lastRejection: string | null = null;
  /**
   * Publish an early-return refusal. It does not EMIT: the facade treats a publish that moves
   * neither the selection nor the pending format as quiet, which a refusal is. What it does
   * do is invalidate the version-cached `snapshot()`, so the reason is there the moment
   * anyone reads it. Stored alone it was not — the snapshot kept its stale value until an
   * unrelated tick bumped the version, and then delivered a section break's message on a
   * caret move. Returns false so a refusing command can `return publishRefusal(reason)`.
   */
  function publishRefusal(reason: string): false {
    lastRejection = refuse(reason);
    options.onChange?.(currentState());
    return false;
  }
  /** Every refusal passes here once, raw, so the host's diagnostics can classify it. */
  function refuse(reason: string, raw = reason): string {
    options.onRejection?.(raw);
    return reason;
  }
  const reportEdit = (): void => options.onEdit?.(flushingTypeBuffer);
  const commitHistoryGroup = new CommitHistoryGroup();
  const typingHistory = new TypingHistory(() => session.currentPackage());
  const AUTHOR_WRITE_REFUSAL = 'suggesting needs an author before it can propose a change';
  /** Show-all content-control boundary chrome — surface furniture, never a layout input. */
  let showAllContentControls = false;
  /** Form-fill Tab navigation between editable controls. */
  let formFillMode = false;

  /**
   * A range pinned to stay VISIBLY selected while the focus is somewhere else.
   *
   * A document has one selection. The moment a panel focuses an input of its own, the browser
   * moves that selection into the input and the text the user highlighted stops looking
   * highlighted — which is exactly when they most need to see what the panel is about to act
   * on. Word and Google Docs both keep the range lit; this is how.
   *
   * It is a SIBLING of `selection`, not a replacement: the model selection is untouched, so
   * the op the panel finally runs still addresses the same characters. This only decides what
   * the overlay draws, and how long the panel is entitled to stay open.
   */
  let retainedSelection: SemanticSelection | null = null;
  const retainedSelections = new Map<SelectionPin, SemanticSelection>();

  function restoreLatestRetainedSelection(): void {
    retainedSelection = null;
    for (const retained of retainedSelections.values()) retainedSelection = retained;
  }

  /** Document-order comparison of two positions: negative, zero or positive. */
  function comparePositions(a: SemanticPosition, b: SemanticPosition): number {
    if (a.paragraphId === b.paragraphId) return a.offset - b.offset;
    const order = paragraphOrder();
    return order.indexOf(a.paragraphId) - order.indexOf(b.paragraphId);
  }

  /**
   * Drop the retained range once the caret leaves it.
   *
   * "Leaves" is inclusive of both edges, so clicking at either end of your own selection is
   * still inside it. A COLLAPSED retained position (Ctrl+K with nothing selected) is left the
   * moment the caret moves at all, which is the same rule with a zero-width range.
   */
  function releaseRetainedIfEscaped(next: SemanticSelection): void {
    if (!retainedSelection) return;
    const { from, to } = orderedRangeOf(editingLayout(), retainedSelection);
    const head = next.head;
    if (comparePositions(head, from) >= 0 && comparePositions(head, to) <= 0) return;
    retainedSelections.clear();
    retainedSelection = null;
  }

  // Stored caret formats are local preferences, anchored to one logical position.
  let pendingFormats: PendingFormat = null;
  const caretFormatHistory = new CaretFormatHistory<CaretFormatSnapshot>(
    collaborationSession ?? session
  );
  const documentSelectionHistory = new DocumentSelectionHistory(
    collaborationSession ?? session,
    () => selection,
    () => partOfNodeId(session, selection.head.paragraphId) ?? session.part(),
    () => session.packageRevision(),
    () => resolveSelectedDrawingRecord(surface)?.drawingNodeId ?? null,
    () => promptBoundary()
  );
  function moveDocumentHistory(direction: 'undo' | 'redo'): void {
    let mark: ReturnType<TreeDocxSession['undo']> = null;
    // The remote caret takes the commit a collaboration step makes for history, not a peer's.
    if (collaborationSession) remoteCaret.expectHistory(true);
    let result: ReturnType<DocumentSelectionHistory['step']>;
    const member = drawingIntent.kind === 'pointer' ? drawingIntent : null;
    try {
      result = documentSelectionHistory.step(direction, () => {
        if (collaborationSession) return collaborationSession[direction]();
        const revision = session.packageRevision();
        mark = session[direction]();
        return session.packageRevision() !== revision;
      });
    } finally {
      if (collaborationSession) remoteCaret.expectHistory(false);
    }
    if (!result.changed) return;
    reportEdit();
    // A shared undo restores the selection its step was made from, carried across the text
    // peers changed since.
    const carried =
      direction === 'undo' ? historySelectionOf(collaborationSession, collaborationPort) : null;
    restoreSelection(carried ?? result.selection ?? mark);
    retainPromptBoundary(result.outsidePromptId);
    // A chart or picture edit steps back with the object still selected, so the next undo,
    // the Chart pane, and the handles stay on it. `selectDrawing` refuses a drawing that the
    // step removed, and the caret then stays where the selection put it.
    if (!carried && result.selection && result.drawing) {
      surface.selectDrawing(result.drawing, result.selection.head.paragraphId);
      // A shape selected inside the group stays selected across its own undo and redo.
      if (member?.drawingNodeId === result.drawing && member.memberNodeId)
        surface.selectDrawingMember(member.memberNodeId);
    }
  }
  function restoreCaretFormat(value: CaretFormatSnapshot): void {
    selectionSync.noteModelMoved();
    flushLayout();
    const restored = restoreCaretFormatSnapshot(value, editingLayout(), paragraphOrder());
    setSelection(restored.selection);
    pendingFormats = restored.format;
    caret.update();
    options.onChange?.(currentState());
  }

  /** The armed pending properties, if the selection still sits where they were armed. */
  function pendingAtCaret(): readonly SurfaceProperty[] | null {
    return armedAtCaret()?.properties ?? null;
  }

  /** The full armed state — properties AND captured base — anchored at the current caret. */
  function armedAtCaret(): ArmedFormat | null {
    return armedFormatAt(pendingFormats, selection);
  }

  /** Discard pending caret formatting when `next` is not collapsed at its anchor. */
  function reconcilePendingWith(next: SemanticSelection): void {
    if (!pendingFormats) return;
    const at = pendingFormats.position;
    const stays =
      next.anchor.paragraphId === at.paragraphId &&
      next.anchor.offset === at.offset &&
      next.head.paragraphId === at.paragraphId &&
      next.head.offset === at.offset;
    if (!stays) pendingFormats = null;
  }

  /**
   * Apply an insertion together with the armed caret format, and — if the store refuses the
   * combined transaction — apply the insertion ALONE.
   *
   * THE KEYSTROKE IS NOT THE FORMAT'S HOSTAGE. The armed op rides the insert's transaction
   * so the two are one undo step, which means a property the store rejects would take the
   * typed characters down with it, silently, on every keystroke until the caret moved. Arm
   * time already refuses names outside the vocabulary; this covers everything it cannot see
   * — a malformed attribute value, a store rule that only fails against this document — and
   * degrades to "the format is forgotten", which is the promise this lane makes.
   */
  function withoutPendingOnRejection(
    withFormat: readonly TreeDocOp[],
    withoutFormat: readonly TreeDocOp[],
    mark: ReturnType<typeof selectionMark>,
    redoMark?: { paragraphId: string; start: number; end: number },
    packageEdits?: NonNullable<Parameters<TreeDocxSession['applyTreeOps']>[4]>['packageEdits']
  ): ReturnType<TreeDocxSession['applyTreeOps']> {
    const result = applyOps([...withFormat], mark, redoMark, storyScope(), true, packageEdits);
    if (withFormat.length === withoutFormat.length || !result.rejected) return result;
    return applyOps([...withoutFormat], mark, redoMark, storyScope(), true, packageEdits);
  }

  function consumePendingFormatOps(
    paragraphId: string,
    offset: number,
    length: number,
    /** The range the insert REPLACES, when the caller's insert stands in for one. */
    replacing?: { readonly start: number; readonly end: number }
  ): TreeDocOp[] {
    const replacementFormat = textboxEditing?.replacementFormatOps(paragraphId, offset, length);
    if (replacementFormat?.length) return replacementFormat;
    // A saved empty paragraph carries its typing face on the mark. It has no run
    // for the insertion operation to extend, so copy that face onto the first text.
    const armed =
      armedAtCaret() ??
      (textOf(selection.head.paragraphId).length === 0
        ? {
            base: [],
            properties: authoredRunPropertiesAt(
              partOfNodeId(session, selection.head.paragraphId) ?? session.part(),
              selection.head.paragraphId,
              selection.head.offset,
              revisionDisplayMode(),
              revisionFilter()
            ),
          }
        : null);
    if (!armed || length === 0 || (armed.properties.length === 0 && armed.base.length === 0))
      return [];
    // The insert this format rides RELOCATES past a deletion the caret rests in — the rule
    // `rangeDeletionPlan` applies through `positionPastDeletion`. The armed anchor must
    // follow the same relocation, or the two positions disagree by construction and the
    // armed ops silently vanish: bold armed inside a `w:del`, then a character typed there,
    // landed correctly and unbold. Identity everywhere else, so the exact-position check
    // still guards a consumer that aims somewhere the caret never was.
    //
    // A REPLACEMENT relocates further: `replacementOffset` also subtracts this author's own
    // retracted insertion, so an anchor sitting anywhere in the replaced range must map
    // through the SAME rule the caller's landing came from. The IME readback composes over
    // the caret's own pending text — the anchor sat at the range end, the landing did not,
    // and the armed format silently dropped on every composed replacement.
    const anchor = pendingFormats?.position ?? selection.head;
    const at =
      replacing &&
      anchor.paragraphId === paragraphId &&
      anchor.offset >= replacing.start &&
      anchor.offset <= replacing.end
        ? {
            paragraphId,
            offset: replacementOffset(
              { paragraphId, offset: replacing.start },
              { paragraphId, offset: replacing.end }
            ),
          }
        : positionPastDeletion(editingLayout(), anchor);
    if (at.paragraphId !== paragraphId || at.offset !== offset) return [];
    return [
      {
        op: 'setRunProperties',
        paragraphId,
        start: offset,
        end: offset + length,
        // Merged per attribute for the multi-setting properties, exactly as the selection
        // path does: a font armed at a caret and then typed must keep the run's other font
        // slots, or the two halves of one feature disagree.
        properties: mergedRunWrite(
          armed.base,
          armed.properties,
          complexScriptAtCaret(paragraphId, offset)
        ),
      },
    ];
  }

  /** Filled once selection sync exists; enter/exit need its noteModelMoved/mirror helpers. */
  let hfScope: ReturnType<typeof createHeaderFooterScopeController> | null = null;
  let noteOps: ReturnType<typeof createNoteOps> | null = null;
  let textboxEditing: ReturnType<typeof createTextboxEditing> | null = null;
  const editingLayout = () => textboxEditing?.layout(currentLayout) ?? currentLayout;
  const editingParagraphIds = () =>
    textboxEditing?.active() ? textboxEditing.paragraphIds() : session.paragraphIdsIn(storyScope());
  /**
   * Memo for `notePropertiesState`, keyed on the COMPLETE read set of
   * {@link notePropertiesStateOf}. `packageRevision` covers every publishing
   * mutation (story transact, lifecycle ops, undo/redo, `publishStoryWrite`
   * all bump it), but two kinds of input move without one. The open
   * header/footer occurrence is UI state: inheritance lets one part serve
   * several sections, so re-entering it from another section changes the
   * answer while the revision and the caret paragraph both stand still. And
   * shell installs (`replacePackageShell`, `installPackageSnapshot`) can swap
   * parts without a bump, so the parts the computation walks — body for
   * `w:sectPr` and note references, settings for `w:footnotePr`/`w:endnotePr`,
   * the notes parts for a note caret's citing paragraph — join by object
   * identity, for the same reason `currentPackage()` keys on identity rather
   * than revision. The selection OFFSET is deliberately absent: the
   * computation reads only the head paragraph id, and section membership
   * cannot change within one paragraph (pinned in
   * `__tests__/note-properties-section.test.ts`).
   */
  let notePropertiesCache: {
    readonly packageRevision: number;
    readonly paragraphId: string;
    readonly bodyPart: OoxmlPart;
    readonly settingsPart: OoxmlPart | null;
    readonly footnotesPart: OoxmlPart | null;
    readonly endnotesPart: OoxmlPart | null;
    readonly headerFooterOpen: boolean;
    readonly headerFooterRId: string | null;
    readonly headerFooterSectionIndex: number | null;
    readonly result: ReturnType<typeof notePropertiesStateOf>;
  } | null = null;
  const storyScope = () =>
    storyScopeOf(hfScope?.getActive() ?? null, noteOps?.activeNoteScope() ?? null);
  const noteScopeId = () => noteOps?.activeNoteScope()?.id ?? null;
  /**
   * The section a page belongs to, and where that section starts.
   *
   * A page is the only thing a pointer entry knows, and a header belongs to a SECTION: one
   * header may be referenced by several, and their page geometry can differ. Without this the
   * entry defaulted to section 0, so double-clicking the header on a landscape page answered
   * with the first section's portrait width — which is the ruler's clamp and the grid width
   * `insertTableOp` divides.
   *
   * A single-section document has no spans and every page belongs to section 0.
   */
  const sectionAtPage = (pageIndex: number): { sectionIndex: number; sectionStart: number } => {
    const spans = layoutSession.multi?.spans;
    let sectionIndex = 0;
    let sectionStart = 0;
    if (spans && spans.length > 0) {
      for (let index = 0; index < spans.length; index += 1) {
        const span = spans[index]!;
        sectionIndex = index;
        sectionStart = span.startIndex;
        if (pageIndex < span.startIndex + span.pageCount) break;
      }
    }
    return { sectionIndex, sectionStart };
  };
  /** The split's tail now: its own id, or the paragraph after the head once renamed. */
  const splitTailNow = (tail: string, head: string): string | null => {
    if (textboxEditing?.active()) {
      const ids = textboxEditing.paragraphIds();
      return ids.includes(tail) ? tail : (ids[ids.indexOf(head) + 1] ?? null);
    }
    // The minted tail id names its part, even after the paragraph takes another id.
    const part = partOfNodeId(session, tail) ?? partOfNodeId(session, head) ?? session.part();
    if (findNode(part, tail)) return tail;
    const owner = parentNodeOf(part, head);
    const index = owner ? owner.children.findIndex((child) => child.id === head) : -1;
    const next = owner && index >= 0 ? owner.children[index + 1] : undefined;
    return next?.kind === 'paragraph' ? next.id : null;
  };

  const hfOutsideBox = () => storyOutsideTextbox(textboxEditing, hfScope);
  const paragraphOrder = () => scopedDocumentOrder(editingLayout(), hfOutsideBox(), noteScopeId());
  const remoteCaret = createRemoteCaret({
    textOf: (id) => textOf(id),
    order: paragraphOrder,
    carried: () => carriedSelectionOf(collaborationSession),
  });
  // Phase timers, one slot per phase rather than a log: the state reports the LAST pass,
  // and a host that wants history samples `onChange`. `performance.now()` where the host
  // has one — monotonic, sub-millisecond — and wall clock where it does not (a bare test
  // runtime), which is fine for numbers only ever read by a human.
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  let lastLayoutMs = 0;
  let lastPaintMs = 0;
  let lastSelectionMs = 0;
  // Timings for diagnostics. Layout is told per pass by the deferred layout, background slices
  // included; the opening layout is not told, because the open reports its own duration.
  const onInputTiming = (event: Event): void => {
    if (timedPress(event)) options.onTiming?.('input', event.timeStamp);
  };

  // Style and numbering indexes are identity-memoized and shared by every story.
  const { styleCascade, numberingIndex, defaultTabStopPt, compatibilityMode } =
    createSurfaceStyleDeps(session);
  // Word's "style for following paragraph". Its own lane, because it is a question about
  // `styles.xml` rather than about the selection an Enter is standing in.
  const nextStyle = createNextStyleWrites({
    styleCascade,
    // A pure read: `partOfNodeId`, never `partFor`, which would permanently retain a story
    // store just to answer what style a paragraph is in.
    partOf: (paragraphId) => partOfNodeId(session, paragraphId) ?? session.part(),
  });
  let onDrawingResourcesChanged: (() => void) | null = null;
  const decodePort =
    options.imageDecodePort ??
    tryCreateBrowserImageDecodePort(mountDocument) ??
    createHeadlessImageDecodePort();
  const drawingBundle = createInlineDrawingLayoutBundle({
    session,
    decodePort,
    onResourcesChanged: () => onDrawingResourcesChanged?.(),
  });
  let drawingStrings: DrawingPaintStrings = options.drawingStrings ?? DEFAULT_DRAWING_PAINT_STRINGS;
  let breakMarkStrings = breakMarkStringsFromTranslate(options.translate);
  let tocLabels = options.tocLabels;
  /**
   * The insertion point, or null when the selection is not collapsed — a range has two ends
   * and is not "inside" anything, and a second background under one of them would read as a
   * second selection.
   *
   * Collapsed-ness ONLY. Focus and IME composition are the painted caret's own state, held in
   * `surface-caret.ts`, and are not consulted here — so field shading stays lit across a blur
   * and through a composition, which is what Word does with a field the caret is in.
   */
  const collapsedCaretPosition = (): { paragraphId: string; offset: number } | null => {
    if (
      selection.anchor.paragraphId !== selection.head.paragraphId ||
      selection.anchor.offset !== selection.head.offset
    ) {
      return null;
    }
    return { paragraphId: selection.head.paragraphId, offset: selection.head.offset };
  };
  const shadeFormFields = createFormFieldShading(session);
  const paintImageUrlPort = createBrowserPaintImageUrlPort({
    mintValidatedBytes: (handle, expectedContentId) =>
      drawingBundle.mintValidatedBytes(handle, expectedContentId),
  });
  // Layout, furniture, and formatting writes share the view's current projection (#497).
  let showFieldCodes = false;
  const reviewView = createReviewViewState(
    options.revisionDisplayMode,
    !!options.reviewModel,
    (mode) => surface.setRevisionDisplayMode(mode)
  );
  const reviewDisplayMode = reviewView.view;
  const revisionDisplayMode = reviewView.projection;
  const changeBarsMode = reviewView.changeBars;
  const revisionAuthorVisibility =
    runtimeOptions.revisionAuthorVisibility ??
    createRevisionAuthorVisibility(options.hiddenRevisionAuthors);
  const hiddenMarks = createHiddenMarkEditing({
    layout: editingLayout,
    part: () => session.partFor(storyScope()) ?? session.part(),
    view: revisionView,
  });
  const markupSettings = createSurfaceRevisionMarkup(
    options.revisionMarkup,
    () => surfaceRevisionFilter(reviewView, revisionAuthorVisibility, session),
    () => flushPendingInputAndLayout(),
    () => {
      furnitureSource = createCurrentFurnitureSource(revisionFilter());
      scheduler.invalidateAll(session.packageRevision(), 'revision-markup');
      scheduler.flush();
      render(false);
    }
  );
  const revisionFilter = markupSettings.filter;
  const complexScriptAtCaret = createCaretComplexScriptResolver(
    session,
    revisionDisplayMode,
    revisionFilter
  );
  const typedDirectionOps = createTypedDirectionOps(session, revisionDisplayMode, revisionFilter);
  const paragraphMarkVisible = (paragraphId: string): boolean => {
    const part = partOfNodeId(session, paragraphId) ?? session.part();
    return revisionParagraphMarkVisible(part, paragraphId, revisionDisplayMode(), revisionFilter());
  };

  let furnitureSource: ReturnType<typeof createFurnitureSource>;

  /**
   * The engine's ONE hyperlink trust boundary, handed to layout.
   *
   * The resolver reads the session's live relationships, so a link inserted this session
   * resolves immediately rather than only after a save and reopen. `hyperlinkTargetOf`
   * produces the sanitized projection; everything downstream — paint, click routing, the
   * popover, the clipboard — consumes only that.
   */
  const linkProjectors = createDocumentLinkProjectors(session);

  /**
   * The SAME boundary for HYPERLINK fields: the raw instruction target crosses
   * `sanitizeHref` inside the registry, which also remembers every minted record so a click
   * on the painted anchor resolves through `linkById` like a typed link's does.
   */
  const fieldLinks = createFieldLinkRegistry();
  type SurfaceFurnitureOptions = Parameters<typeof createFurnitureSource>[0];
  const furnitureFilters = createFurnitureFilterMemo();
  const createCurrentFurnitureSource = (
    authorFilter?: RevisionAuthorFilter,
    fieldCodes = showFieldCodes
  ): ReturnType<typeof createFurnitureSource> => {
    const source = createFurnitureSource({
      session: unsupportedProjection.view(session),
      measurer,
      producer,
      cache: layoutCache,
      ...{ styleCascade, numberingIndex, defaultTabStopPt, compatibilityMode },
      // Furniture answers the document's display mode, like the body does — and it is named
      // even when it is the default, because a lane that says nothing is treated as saying
      // "not All Markup", which is what keeps markup out of the resolved views.
      displayMode: revisionDisplayMode(),
      showFieldCodes: fieldCodes,
      revisionAuthorFilter: authorFilter,
      inlineDrawingLayoutForPart: (partName) => drawingBundle.contextForPart(partName),
      drawingLayoutTokenForPart: (partName) => drawingBundle.cacheTokenForPart(partName),
      drawingTokenForParagraphForPart: (partName, paragraph) =>
        drawingBundle.drawingTokenForParagraph(paragraph, partName),
      linkProjectors,
      projectFieldLink: (spec) => fieldLinks.project(spec),
    } satisfies SurfaceFurnitureOptions & Record<keyof SurfaceFurnitureOptions, unknown>);
    furnitureFilters.record(source, authorFilter);
    return source;
  };
  furnitureSource = createCurrentFurnitureSource(revisionFilter());

  interface LayoutDocumentContext {
    readonly authorFilter?: RevisionAuthorFilter;
    readonly layoutSession: ReturnType<typeof createLayoutSession>;
    readonly furnitureSource: ReturnType<typeof createCurrentFurnitureSource>;
    readonly live?: boolean; // Lays out as the live session does, not for a save.
  }

  /**
   * The session as every lane sees it: the mode rules applied to `applyTreeOps`.
   *
   * Gating one function inside this file was not enough. Breaks, lists, indent, section
   * properties, formatting, hyperlinks and the IME readback are their own lanes over the
   * SAME session, and each called `applyTreeOps` on it directly — so a "read-only" document
   * still took Ctrl-B, a page-orientation change and a bullet toggle, and suggesting mode
   * wrote an untracked tab or line break while the user believed they were proposing.
   * Wrapping the session is the only place that covers a lane nobody has written yet.
   */
  const gatedSession: TreeDocxSession = {
    ...session,
    // The SCOPE has to travel. `applyOps` defaults it to the open story, so dropping the
    // argument here silently rewrote every caller that named one — and the one caller that
    // needs to is section geometry, which pins `{ kind: 'body' }` because `w:sectPr` lives on
    // the body story and nowhere else. A header store has no `w:body`, so with the caret in a
    // header every page-setup write was refused as `tree-invariant`: the ruler snapped back and
    // Page Setup's Apply did nothing, with the dialog still reading the right section.
    applyTreeOps: (ops, before, after, scope, options) =>
      applyOps(ops, before, after, scope, true, options?.packageEdits),
    // List definitions mint `numId` on the package before the paragraph op names it, so
    // the typing transaction never binds an actor for that scan. Same wrap the hyperlink
    // mint uses.
    ensureListDefinition: (kind, geometry) =>
      runWithTransactionActor(collaborationSession?.identity.actorId, () =>
        session.ensureListDefinition(kind, geometry)
      ),
    applyPmDoc: (doc) => {
      if (editingMode === 'view') {
        return { committed: false, rejected: true, opCount: 0, reason: VIEWING_REFUSAL };
      }
      // Not "text-only" — replication carries the whole package. This path derives ordinary tree
      // ops and commits them through the same journaled transaction `applyTreeOps` uses, so the
      // mechanism is the proven one. What is unproven is the DERIVATION: no host in this repo
      // drives the editor through a ProseMirror doc, so no two-replica test covers a diff that
      // refuses or under-describes an edit. Admitting it would ship a replicated path nothing
      // exercises. Prove it, then lift it.
      if (collaborationSession) {
        return {
          committed: false,
          rejected: true,
          opCount: 0,
          reason: 'collaboration-pm-doc-unproven',
        };
      }
      if (selectionTouchesToc()) {
        return { committed: false, rejected: true, opCount: 0, reason: TOC_READ_ONLY_REFUSAL };
      }
      return session.applyPmDoc(doc);
    },
  };

  /** Finishes a paused opening prefix pass, and drops the opening; see `startOpeningSlices`. */
  let finishOpeningPass = (): void => undefined;
  let stopOpening = (): void => undefined;
  // The pages after the screen finish after the commit; see `surface-deferred-layout.ts`.
  const deferredLayout = createDeferredLayout({
    now,
    view: () => hostWindowOf(pagesLayer),
    pageAfterView: () => {
      const visible = visiblePages();
      return visible && visible.size > 0 ? Math.max(...visible) + 1 : undefined;
    },
    current: () => currentLayout,
    partial: () => openingBlockLimit !== null,
    revision: () => session.packageRevision(),
    publish: (layout) => fieldScope.wrap(() => publishLayout(layout))(),
    snapshot: () => snapshotLayoutSession(layoutSession),
    // Marks the container while later pages still show the previous layout.
    pendingChanged: (pending) =>
      container.toggleAttribute('data-docx-layout-pending', pending || openingBlockLimit !== null),
    passTimed: (ms) => options.onTiming?.('layout', ms),
  });
  let openingBlockLimit: number | null = runtimeOptions.progressiveOpen
    ? PROGRESSIVE_OPEN_FIRST_BLOCKS
    : null;
  let currentLayout = layoutOnce();
  // Declared before the first paint can run — `render` reads it.
  let revisionStyles = options.revisionStyles;
  const paragraphMarks = createParagraphMarkVisibility(
    options.showParagraphMarks ?? false,
    flushPendingInputAndLayout,
    () => render(false)
  );
  // Declared before the first paint, like `paragraphMarks`: `render` paints its marks.
  const bookmarks = createSurfaceBookmarks({
    session: gatedSession,
    storyScope,
    orderedRange: () => orderedRange(),
    writeRefusal: () => writeRefusal(true),
    commit: (run, selectionAfter) => commit(run, selectionAfter),
    // Show the text after a leading page break; `goTo` still selects the whole bookmark.
    goToPosition: (position, options) =>
      navigation.goToPosition(pastLeadingBreaks(editingLayout().pages, position), options),
    setSelection: (next) => setSelection(next),
    beforeChange: flushPendingInputAndLayout,
    repaint: () => render(false),
    options,
  });
  // The facade owns this across internal remounts of the SAME attached document. A direct
  // surface mount has no facade session, so it correctly starts a fresh assignment here.
  const stableAuthorSlots = runtimeOptions.reviewAuthorSlots ?? createStableReviewAuthorSlots();
  const reviewAuthors = createSurfaceReviewAuthors({
    layout: editingLayout,
    items: () => session.reviewItems(),
    styles: () => revisionStyles,
    slots: stableAuthorSlots,
  });
  function setPendingFormats(next: readonly SurfaceProperty[] | null): void {
    flushTypeBuffer();
    collaborationSession?.flushPendingJournals();
    const before = { selection, format: pendingFormats };
    const beforeStyle = JSON.stringify(format.formatting());
    const nextFormat = armCaretFormat(selection, pendingFormats, next, () =>
      authoredRunPropertiesAt(
        session.partFor(storyScope()) ?? session.part(),
        selection.head.paragraphId,
        selection.head.offset,
        revisionDisplayMode(),
        revisionFilter()
      )
    );
    if (nextFormat === undefined) return;
    pendingFormats = nextFormat;
    if (beforeStyle !== JSON.stringify(format.formatting())) {
      caretFormatHistory.record(
        before,
        { selection, format: pendingFormats },
        takeHistoryGroup(surface)
      );
    }
    typingHistory.end();
    // Not document state, but observable state: the toolbar's Bold must light up NOW,
    // and the snapshot cache invalidates on this report.
    caret.update();
    options.onChange?.(currentState());
  }

  const format = createSurfaceFormat({
    runFormatRefusal: () =>
      commandProtectionRefusal({ type: 'toggleMark', mark: 'bold' }, surface)?.reason ?? null,
    session: gatedSession,
    applyOutsideToc: (ops, apply) => {
      const kept = ops.filter((op) => !opTouchesToc(op));
      if (kept.length === 0) return apply(ops);
      formattingOutsideToc = true;
      try {
        return apply(kept);
      } finally {
        formattingOutsideToc = false;
      }
    },
    storyScope,
    paragraphOrder,
    layout: editingLayout,
    // Formatting reads the paragraph where the caret SHOWS; see `hidden-mark-joins.ts`.
    selection: () => hiddenMarks.shownSelection(selection),
    displayMode: () => revisionDisplayMode(),
    authorFilter: revisionFilter,
    paragraphMarkVisible,
    commit: (run, nextSelection, options) => commit(run, nextSelection, options),
    orderedRange: () => hiddenMarks.shownRange(orderedRange()),
    selectionMark: () => selectionMark(),
    textOf: (paragraphId) => textOf(paragraphId),
    selectedCells: () => cellSelection?.cellIds,
    defaultParagraphStyleId: () => styleCascade()?.defaultParagraphStyleId ?? null,
    defaultFontFamily: () => options.defaultFontFamily ?? null,
    pendingFormats: () => pendingAtCaret(),
    setPendingFormats,
  });
  const formatPainter = createSurfaceFormatPainter({
    session: gatedSession,
    storyScope,
    layout: editingLayout,
    selection: () => hiddenMarks.shownSelection(selection),
    displayMode: () => revisionDisplayMode(),
    authorFilter: revisionFilter,
    paragraphMarkVisible,
    commit: (run, nextSelection, commitOptions) => commit(run, nextSelection, commitOptions),
    orderedRange: () => hiddenMarks.shownRange(orderedRange()),
    selectionMark: () => selectionMark(),
    textOf: (paragraphId) => textOf(paragraphId),
    paragraphOrder,
    selectedCells: () => cellSelection?.cellIds,
    // The painter's collapsed-caret lane IS the stored-marks lane — no second arming path,
    // so a caret-painted format is discarded by a caret move like any other armed one.
    armPendingFormats: (properties) => setPendingFormats(properties),
    now,
    publish: () => {
      // The armed cursor is the ONLY thing on screen that says the next drag will paint,
      // and it lives on the pages layer rather than on a class the host owns — a host that
      // renders no toolbar still gets the affordance.
      const armed = formatPainter.state().mode !== 'off';
      if (armed) pagesLayer.dataset['formatPainter'] = '';
      else delete pagesLayer.dataset['formatPainter'];
      options.onChange?.(currentState());
    },
  });
  const structure = createSurfaceStructure({
    session: gatedSession,
    storyScope,
    headerFooterSectionIndex: () => hfScope?.getActive()?.sectionIndex,
    revisionDisplayMode,
    revisionAuthorFilter: revisionFilter,
    paragraphOrder,
    // A rectangle is not the range it stands in for — the same question `createSurfaceFormat`
    // asks. Without it, bulleting or indenting one selected column also hit the cells between
    // its corners in document order.
    selectedCells: () => cellSelection?.cellIds,
    editingMode: () => editingMode,
    publishRefusal,
    // RAW, on purpose: `orderedRange()` flushes pending input, and this is asked from `can`.
    caretParagraphId: () =>
      selection.anchor.paragraphId === selection.head.paragraphId &&
      selection.anchor.offset === selection.head.offset
        ? selection.head.paragraphId
        : null,
    layout: editingLayout,
    // Structural edits retain the armed typing format at the resulting caret.
    commit: (run, nextSelection, options) =>
      commit(run, nextSelection, {
        rearmPending: armedAtCaret() ?? undefined,
        ...(options?.keepCellSelection ? { keepCellSelection: true } : {}),
      }),
    orderedStart: () => orderedStart(),
    orderedRange: () => orderedRange(),
    selectionMark: () => selectionMark(),
    collapsedAt: (position) => collapsedAt(position),
    deleteSelectionPlan: () => deleteSelectionPlan(),
    typingSelectionPlan: () => typingSelectionPlan(),
    retainPromptBoundary: (id) => retainPromptBoundary(id),
    paragraphTextOf: (paragraphId) => textOf(paragraphId),
    // Resolved through `w:numStyleLink` the way LAYOUT resolves markers (§17.9.21):
    // against the raw index a delegating definition has no levels of its own, so every
    // level of Word's List Bullet / List Number styles read as missing and a plain
    // `setListLevel` was refused where layout would have rendered the marker fine.
    numberingLevelExists: (numId, level) =>
      resolveNumberingLevel(
        withNumberingStyleLinks(numberingIndex(), styleCascade()),
        numId,
        level
      ) !== null,
    ...listDefinitionReads(() => withNumberingStyleLinks(numberingIndex(), styleCascade())),
    styleCascade,
    defaultTabStopPt,
  });
  /** The contract's `replacementLanding`; the hyperlink lane reads the same rule. */
  function replacementLanding(paragraphId: string, start: number, end: number): number | null {
    if (editingMode !== 'suggest') return null;
    // A POSITIONAL READ, and it does not settle anything itself: flushing here would commit
    // buffered typing in the middle of a caller that had already captured the offsets it
    // builds ops from. Both callers settle first — the hyperlink lane through
    // `orderedRange()`, an automation batch at its own entry — which is where a flush belongs.
    return replacementOffset({ paragraphId, offset: start }, { paragraphId, offset: end });
  }

  const hyperlinks = createHyperlinkOps({
    session: gatedSession,
    collaborative: !!collaborationSession,
    // A HYPERLINK field is not a tree node, so its link resolves from the layout projection
    // plus the field-link registry rather than the typed tree walk.
    layout: editingLayout,
    fieldLinkById: (linkId) => fieldLinks.linkById(linkId),
    // Asked BEFORE the relationship is minted. The gated session refuses the ops in viewing mode
    // either way, but the mint is a package write that the refusal does not roll back — Ctrl+K in a
    // document open for reading left its target declared in `.rels`.
    refusesWrite: () => writeRefusal(true) !== null,
    withMintActor: (mint) => runWithTransactionActor(collaborationSession?.identity.actorId, mint),
    storyScope,
    // Non-null exactly when suggesting: the link lane then replaces with tracked ops.
    replacementLanding,
    insertionLanding: (paragraphId, offset) =>
      positionPastDeletion(editingLayout(), { paragraphId, offset }).offset,
    selection: () => selection,
    orderedRange: () => orderedRange(),
    selectionMark: () => selectionMark(),
    textOf: (paragraphId) => textOf(paragraphId),
    commit: (run, selectionAfter) => commit(run, selectionAfter),
  });
  const equations = createEquationOps({
    session: gatedSession,
    storyScope,
    editingMode: () => editingMode,
    writeRefusal: (op) => writeRefusal(true, [op]),
    trackedOps,
    selection: () => selection,
    selectionMark: () => selectionMark(),
    commit: (run, selectionAfter) => commit(run, selectionAfter),
  });
  /**
   * Put the surface in the story that holds `paragraphId`, for a JUMP.
   *
   * A bookmark or an internal link can name a paragraph in any story, and moving the caret
   * there while the scope stayed on the body left the two disagreeing: `activeScope` said
   * body, the caret sat on a paragraph the body store has never heard of, and every keystroke
   * after it was refused with nothing said. False means the story could not be opened, and the
   * caller must not jump anyway.
   */
  const enterStoryHolding = (paragraphId: string): boolean => {
    const scope = storyScopeOfNodeId(session, paragraphId, { kind: 'body' });
    if (scope.kind === 'body') {
      // Leaving is unconditional here, unlike entering: a body target is not somewhere
      // staying in the open story could help.
      noteOps?.exitNote();
      hfScope?.exitHeaderFooter();
      return true;
    }
    if (scope.kind === 'headerFooter') {
      const active = hfScope?.activeScope();
      if (active?.kind === 'headerFooter' && active.rId === scope.rId) return true;
      noteOps?.exitNote();
      return hfScope?.enterHeaderFooter({ rId: scope.rId }) ?? false;
    }
    // A notes PART holds every note, so the scope has to name the NOTE the paragraph is in,
    // and only the painted layout knows which one that is.
    const scopeId = noteScopeIdInLayout(currentLayout, paragraphId);
    if (!scopeId) return false;
    if (noteOps?.activeNoteScope()?.id === scopeId) return true;
    hfScope?.exitHeaderFooter();
    return noteOps?.enterNote(scopeId) ?? false;
  };

  const navigation = createSurfaceNavigation({
    pagesLayer,
    get container() {
      return container;
    },
    scale: () => scale,
    layout: editingLayout,
    bookmarks: () => session.bookmarks(),
    // Field-derived ids first: they are a closed `field-hyperlink:` namespace, and the typed
    // lane's tree walk could never answer for them.
    linkById: (linkId) => fieldLinks.linkById(linkId) ?? hyperlinks.linkById(linkId),
    drawingLinkById: (drawingNodeId) => drawingLinkByIdFromLayout(currentLayout, drawingNodeId),
    setSelection: (position) => setSelection(collapsedAt(position)),
    whenLaidOut: (position, retry) => laterOnOpening(position, retry),
    beginJump: () => beginReveal(),
    enterStoryFor: (paragraphId) => enterStoryHolding(paragraphId),
    isCollapsedSelection: () => selectionsEqual(selection, collapsedAt(selection.head)),
    onScrolled: () => rematerialize(),
    ...(options.onHyperlinkPopover ? { onPopover: options.onHyperlinkPopover } : {}),
  });
  const equationInteraction = createEquationInteraction({
    pagesLayer,
    equationById: (equationId) => equations.equationById(equationId),
    // `none`, and wrapped rather than passed by reference: activation is a press on the
    // equation, so the paper stays put under it.
    setSelection: (next) => setSelection(next, false, 'none'),
    ...(options.onEquationPopover ? { onPopover: options.onEquationPopover } : {}),
  });
  pagesLayer.addEventListener('contextmenu', onTocContextMenu);
  pagesLayer.addEventListener('click', onTocRowClick);
  pagesLayer.addEventListener('pointermove', onTocPointerMove);
  pagesLayer.addEventListener('pointerleave', onTocPointerLeave);
  const controlHover = createContentControlHover(pagesLayer);
  let desiredX: number | null = null;
  function layoutDocument(
    revision: number,
    scope?: LayoutScope,
    context?: LayoutDocumentContext,
    bodyBlockLimit?: number
  ): SemanticLayout {
    finishOpeningPass();
    deferredLayout.finish();
    return drainLayoutSteps(layoutDocumentSteps(revision, scope, context, bodyBlockLimit));
  }

  function* layoutDocumentSteps(
    revision: number,
    scope?: LayoutScope,
    context?: LayoutDocumentContext,
    bodyBlockLimit?: number
  ): LayoutSteps<SemanticLayout> {
    const activeAuthorFilter = context ? context.authorFilter : revisionFilter();
    const usesLive = !context || context.furnitureSource === furnitureSource;
    if (usesLive && furnitureFilters.moved(furnitureSource, activeAuthorFilter))
      furnitureSource = createCurrentFurnitureSource(activeAuthorFilter);
    const activeLayoutSession = context?.layoutSession ?? layoutSession;
    const activeFurnitureSource = usesLive || !context ? furnitureSource : context.furnitureSource;
    if (scope) attachListResolveChangeEvidence(activeLayoutSession, scope);
    // Any full layout of the live session completes an opening still in slices.
    if (!context && bodyBlockLimit === undefined) openingBlockLimit = null;
    drawingBundle.sync(session);
    return yield* layoutDocumentViewSteps({
      view: unsupportedProjection.view(session),
      revision,
      measurer,
      cache: layoutCache,
      session: activeLayoutSession,
      producer,
      styleCascade,
      defaultTabStopPt,
      numberingIndex,
      furniture: activeFurnitureSource,
      compatibilityMode,
      linkProjectors,
      projectFieldLink: (spec) => fieldLinks.project(spec),
      inlineDrawingLayout: drawingBundle.bodyContext,
      inlineDrawingLayoutForPart: (partName) => drawingBundle.contextForPart(partName),
      drawingTokenForParagraph: (paragraph) =>
        drawingBundle.drawingTokenForParagraph(paragraph, session.part().name),
      drawingTokenForParagraphForPart: (partName, paragraph) =>
        drawingBundle.drawingTokenForParagraph(paragraph, partName),
      // The part-level epoch that lets the section prepass memo trust the tokens above
      // without re-asking every paragraph on every pass.
      drawingLayoutEpoch: drawingBundle.cacheTokenForPart(session.part().name),
      drawingLayoutEpochForPart: (partName) => drawingBundle.cacheTokenForPart(partName),
      // The layout context key already folds the mode in (`|rev:<mode>`), so a surface
      // constructed `proposed` never shares cached pages with an `all-markup` one.
      displayMode: revisionDisplayMode(),
      showFieldCodes: context && !context.live ? false : showFieldCodes,
      fieldResults: fieldScope.mode,
      revisionAuthorFilter: activeAuthorFilter,
      bodyBlockLimit,
    } satisfies LayoutDocumentViewOptions & Record<keyof LayoutDocumentViewOptions, unknown>);
  }

  /** Build save-time PAGEREF numbers without mutating the active filtered layout. */
  function canonicalUnfilteredLayoutForSave(): SemanticLayout {
    return layoutDocument(session.packageRevision(), undefined, {
      layoutSession: createLayoutSession(),
      furnitureSource: createCurrentFurnitureSource(undefined, false),
    });
  }

  function layoutOnce(): SemanticLayout {
    const began = now();
    const layout = layoutDocument(
      session.packageRevision(),
      undefined,
      undefined,
      openingBlockLimit ?? undefined
    );
    lastLayoutMs = now() - began;
    return layout;
  }

  /** Timers on the pages' own window: an opener's timers are throttled while it is hidden. */
  const timers = hostTimers(() => pagesLayer);
  let deferredPublishRender: number | null = null;
  /** Nonzero while `commitNow` applies its ops; see `renderPublishedLayout`. */
  let commitRunDepth = 0;
  let commitPaintOwed = false;
  /** The layout the page shows: `currentLayout` until a paint is owed. */
  let paintedLayout: SemanticLayout | null = null;
  /** While an input method writes on the page, the layout it is held at; see `render`. */
  let heldLayout: SemanticLayout | null = null;

  // Armed once, after the first published render: the derivations a structural edit reads
  // populate their per-node memos in idle tasks instead of inside the first Enter. An edit
  // before the warm finishes stops it (the edit's own reads populate the new root), and
  // view mode never warms (nothing structural can be typed there).
  let cancelDerivationPrewarm: (() => void) | null = null;
  let derivationPrewarmArmed = false;

  function armDerivationPrewarmOnce(): void {
    if (derivationPrewarmArmed) return;
    derivationPrewarmArmed = true;
    const revisionAtArm = session.packageRevision();
    cancelDerivationPrewarm = scheduleDerivationPrewarm({
      steps: createDerivationPrewarmSteps(() => session.part()),
      shouldRun: () =>
        editingMode !== 'view' && session.editable && session.packageRevision() === revisionAtArm,
      hasPendingInput: hasPendingBrowserInput,
      schedule: (run, delayMs) => {
        const handle = timers.setTimeout(run, delayMs);
        return () => timers.clearTimeout(handle);
      },
    });
  }

  /** See `browserInputPending` for when to pass `includeContinuous`. */
  function hasPendingBrowserInput(includeContinuous = true): boolean {
    return browserInputPending(container, includeContinuous);
  }

  function renderPublishedLayout(): void {
    // Published from INSIDE a commit (a handler read geometry): `publishAfterCommit` paints it
    // with the post-edit caret; painting the pre-edit one here too doubled every edit's paint.
    if (commitRunDepth > 0) {
      commitPaintOwed = true;
      armDerivationPrewarmOnce();
      return;
    }
    if (!hasPendingBrowserInput()) {
      // `render()` retires any armed deferred publish render itself.
      render();
      armDerivationPrewarmOnce();
      return;
    }
    // Paint and DOM selection do not need to run once per event already waiting in the
    // browser's input queue. One task catches the view up to the newest published layout;
    // ordinary isolated edits still render synchronously through the branch above.
    if (deferredPublishRender !== null) return;
    deferredPublishRender = timers.setTimeout(
      fieldScope.wrap(() => {
        deferredPublishRender = null;
        // Superseded: a newer commit is already pending, so this layout is not the one the
        // user will see — its own publish paints and reports. Painting here anyway spent one
        // full render per flush batch on a frame one commit behind, and mirrored the newer
        // model selection into the older spans.
        if (scheduler.pending() !== null) return;
        render();
        armDerivationPrewarmOnce();
      }),
      0
    );
  }

  // ---- Batched typing ----------------------------------------------------
  //
  // A keystroke burst used to pay one commit + one synchronous layout PER
  // CHARACTER, so a backlog of N queued keys blocked the main thread for
  // N × flush. The DOM input pathway now appends plain `insertText` data here
  // and lands the whole buffer through ONE `type()` call — one transaction,
  // one tracked `w:ins`, one undo step, one layout flush. The flush task is a
  // plain `setTimeout(0)`: queued input events outrank timers, so every key
  // already waiting appends before the timer fires, and an isolated keystroke
  // still lands within the same event-loop turn.
  //
  // The buffer holds TEXT ONLY, no position: `type()` resolves the model
  // selection at flush time, and every other way the selection or document can
  // move flushes the buffer first (`commit` head-flush plus the explicit
  // flushes on selection, undo/redo, geometry reads, composition, save and
  // teardown), so the selection at flush time is the selection the first
  // buffered key saw.
  let typeBuffer = '';
  /** Lands composed text queued before the buffer, one land at a time (`landingGuard`). */
  let landComposedText = (): void => {};
  let typeFlushTimer: number | null = null;
  let flushingTypeBuffer = false;
  const landing = landingGuard();

  function flushTypeBuffer(): void {
    // Reentrancy first, timer second: a reentrant call (host code inside the
    // flush's own onChange enqueuing more text) must not clear the fresh timer
    // that new text just armed, or it would sit unflushed until an unrelated
    // flush point.
    if (flushingTypeBuffer || landing.active()) return;
    landing.wrap(landComposedText)();
    if (typeFlushTimer !== null) {
      timers.clearTimeout(typeFlushTimer);
      typeFlushTimer = null;
    }
    if (typeBuffer.length === 0) return;
    const text = typeBuffer;
    typeBuffer = '';
    flushingTypeBuffer = true;
    try {
      // `surface` is assigned below; a flush can only run once a caller holds it. The flush
      // binds the typing run's own group, never a grouped command's (`typing-history.ts`).
      runWithHistoryGroup(surface, typingHistory.groupAt(selection), () => surface.type(text));
      typingHistory.landed(selection);
    } catch (error) {
      // A throwing commit must not eat the keystrokes: put them back (ahead of
      // anything enqueued meanwhile, preserving order) for the next flush point.
      typeBuffer = text + typeBuffer;
      throw error;
    } finally {
      flushingTypeBuffer = false;
    }
  }

  function enqueueType(text: string): void {
    typeBuffer += text;
    if (typeFlushTimer !== null) return;
    typeFlushTimer = timers.setTimeout(
      fieldScope.wrap(() => {
        typeFlushTimer = null;
        flushTypeBuffer();
      }),
      0
    );
  }

  function commitProposedTextChange(
    kind: 'insertion' | 'deletion' | 'replacement',
    text: string,
    authorOverride?: string
  ): boolean {
    flushTypeBuffer();
    const writer = authorOverride?.trim() || author?.trim();
    if (!writer) return publishRefusal('tracked changes need a non-empty author');
    // Empty text would commit a phantom `w:ins` holding nothing — a tracked change the
    // review pane must carry with no content to show. A replacement that only removes is
    // a deletion. A newline is not a paragraph mark: written into `w:t` it renders as
    // whitespace while claiming to be a break. The facade's support gate refuses the same
    // SHAPES (docx-editor-support.ts), so the automation `can` and this `exec` agree; the
    // messages differ only in naming the kind versus the command.
    if (kind !== 'deletion' && text.length === 0)
      return publishRefusal(`${kind} requires non-empty text`);
    if (kind !== 'deletion' && /[\r\n\v\f\u2028\u2029]/.test(text))
      return publishRefusal(`${kind} requires text without a paragraph mark`);
    const revision = { author: writer, date: revisionDateNow() };
    const range = orderedRange();
    const collapsed =
      range.from.paragraphId === range.to.paragraphId && range.from.offset === range.to.offset;
    // A rectangle over a single EMPTY cell mirrors a collapsed text range, but it still
    // covers a cell the user selected — the keyboard replaces over it, so automation must.
    // REPLACEMENT only: it always carries its insert op. A deletion over an all-empty
    // rectangle would commit zero ops, so it keeps the refusal `can` gives it.
    if (kind !== 'insertion' && collapsed && !(kind === 'replacement' && cellSelection))
      return publishRefusal(`${kind} needs a non-collapsed selection`);
    // The deletion is tracked whatever the surface's editing mode is, so the plan computes
    // `replaceAt` as suggesting would — for THIS author, who may not be the configured one.
    // An insertion aimed INSIDE an existing deletion relocates past it in the store; the
    // caret math maps the same way here, or the next proposal lands before this one.
    const plan: RangeDeletionPlan =
      kind === 'insertion'
        ? {
            ops: [] as readonly TreeDocOp[],
            collapseTo: positionPastDeletion(editingLayout(), range.from),
          }
        : deleteSelectionPlan(writer);
    const ops = attributeTrackedOps(plan.ops, revision, formattingTracked());
    let caret = plan.collapseTo;
    if (kind === 'insertion' || kind === 'replacement') {
      // The plan's `replaceAt` owns the landing rule — after the struck words, in the last
      // surviving paragraph of the range — so the automation object model and the keyboard
      // agree, spanning selections included.
      const target = kind === 'replacement' ? (plan.replaceAt ?? plan.collapseTo) : plan.collapseTo;
      ops.push({
        op: 'insertText',
        paragraphId: target.paragraphId,
        offset: target.offset,
        text,
        revision,
      });
      caret = { paragraphId: target.paragraphId, offset: target.offset + text.length };
    }

    let committed = false;
    commit(
      () => {
        const result = applyOps(ops, selectionMark(), caretMark(caret));
        committed = result.committed;
        return result;
      },
      () => collapsedAt(caret)
    );
    return committed;
  }

  /** Run `body` with no caret follow inside it and none owed to a later paint. */
  function withoutCaretFollow(body: () => void): void {
    caretFollowPending = false;
    caretView.without(body);
    caretFollowPending = false;
  }

  const replaceTextInPlace = createInPlaceReplacement({
    settle: () => flushPendingInputAndLayout(),
    refuse: (reason) => publishRefusal(reason),
    storyParagraphs: () => paragraphOrder(),
    textOf: (paragraphId) => textOf(paragraphId),
    rangePlan: (range) => deleteRangePlan(range),
    insertionPoint: (position) => positionPastDeletion(editingLayout(), position),
    selection: () => selection,
    selectionMark: () => selectionMark(),
    commitWithoutFollow: (ops, mark, after) => {
      let committed = false;
      withoutCaretFollow(() =>
        commit(() => {
          const result = applyOps(ops, mark, mark, storyScope(), false);
          committed = result.committed;
          return result;
        }, after)
      );
      return committed;
    },
    flushLayout: () => flushLayout(),
    noteModelMoved: () => selectionSync.noteModelMoved(),
    selectionsEqual,
  });

  const scheduler = createLayoutScheduler({
    // The DOCUMENT's geometry, exactly as the first paint uses. Omitting it meant the first
    // paint honoured A4 and the first committed edit silently repaginated onto Letter — every
    // layout after the first comes through here rather than through `layoutOnce`.
    run: (scope: LayoutScope) => {
      const began = now();
      finishOpeningPass();
      deferredLayout.abandon();
      // An edit during an opening lays out the prefix so far; the opening slices go on after it.
      const steps = furnitureLaterSteps(
        layoutDocumentSteps(scope.revision, scope, undefined, openingBlockLimit ?? undefined),
        visiblePages()
      );
      const layout = deferredLayout.run(steps, scope.revision, timedLayout(scope));
      openingBlockLimit = bodyBlockLimitAfter(layoutSession, openingBlockLimit);
      lastLayoutMs = now() - began;
      return layout;
    },
    currentRevision: () => session.packageRevision(),
    // THE BACKSTOP, not the normal route. Every edit this surface makes still lays out
    // synchronously inside `commit`, because the next edit has to read current geometry —
    // and `flush` cancels whatever this armed, so the ordinary keystroke pays one timer
    // arm and one cancel, never a second pass.
    //
    // What it buys is the two cases that reach the scheduler without a synchronous flush
    // behind them. A commit from OUTSIDE this surface (undo, or another editor sharing the
    // store) only ever reached the screen through `publish`, and with nothing armed it
    // simply never got there: the model moved and the painted pages kept the old revision
    // for good. And when `flush` abandons a pass — stale, or cancelled mid-flight — it
    // carries the scope forward and re-arms, which was a no-op, so the surface sat on a
    // stale paint until some unrelated call happened to flush. That second one is how the
    // header caret bug stayed invisible: a paint one revision behind is exactly what makes
    // the post-edit caret unwritable.
    //
    // A timer rather than an animation frame, like the rest of this file: rAF does not fire
    // in a background tab, and a document that stops repainting when the tab is hidden is
    // the same stale-paint failure by another route.
    schedule: (run) => {
      const handle = timers.setTimeout(fieldScope.wrap(run), 0);
      return () => timers.clearTimeout(handle);
    },
    publish: (layout) => publishLayout(layout),
  });
  function publishLayout(layout: SemanticLayout): void {
    // Release the previous layout BEFORE the new one replaces it: the roster cache held it by
    // strong reference, and a 200-page graph kept beside the live one is tens of megabytes.
    // `layout: null` means "recompute on the next read" while keeping the map, which that read
    // compares against to decide whether the author set moved. The review queue goes with it.
    reviewAuthors.releaseLayout();
    currentLayout = layout;
    const carried = remoteCaret.map(selection);
    // Peers see this caret move too, or they keep painting it at the old offset. It is a model
    // move: until the next paint, the browser still shows the old caret, which must not win.
    if (carried !== selection) {
      selection = carried;
      selectionSync.noteModelMoved();
      publishLocalCollaborationSelection();
    }
    // Repaint from HERE, so a commit that never went through this surface — undo, or
    // another editor sharing the store — still reaches the screen. Otherwise the painted
    // pages keep showing a revision the model has already left.
    renderPublishedLayout();
    canonicalLayout.request();
  }
  // Footnote reserves as a one-pass layout finds them; see `surface-canonical-layout.ts`.
  const canonicalLayout = createCanonicalLayout({
    now,
    schedule: (run, delayMs) =>
      timers.clearTimeout.bind(null, timers.setTimeout(fieldScope.wrap(run), delayMs)),
    revision: () => session.packageRevision(),
    live: () => layoutSession,
    current: () => currentLayout,
    busy: () => deferredLayout.pending() || openingBlockLimit !== null,
    pass: (revision, fresh) =>
      layoutDocumentSteps(revision, undefined, {
        authorFilter: revisionFilter(),
        layoutSession: fresh,
        furnitureSource,
        live: true,
      }),
    createSession: createLayoutSession,
    adopt: (fresh, layout) => {
      layoutSession = fresh;
      publishLayout(layout);
    },
  });

  // A settled image resource reaches the screen on its own through a queued flush, so a burst
  // lays out once. A sliced opening's later slices and closing full layout read it anyway; a
  // flush then would finish the paused slice and relay the prefix in one task.
  let resourceFlushQueued = false;
  onDrawingResourcesChanged = () => {
    if (openingBlockLimit !== null) return;
    scheduler.invalidateAll(session.packageRevision(), 'drawing-resources');
    if (resourceFlushQueued) return;
    resourceFlushQueued = true;
    timers.setTimeout(
      fieldScope.wrap(() => {
        resourceFlushQueued = false;
        flushLayout();
      }),
      0
    );
  };

  // Every committed transaction, whatever produced it — this surface, undo, or another
  // editor sharing the store — reaches layout the same way.
  const unsubscribe = session.subscribe((modelChange) => {
    // Before anything downstream can read the index against the new revision.
    reviewOrder.retain(modelChange);
    if (
      modelChange.origin !== ORIGIN_IDS.mutationRemote &&
      modelChange.origin !== ORIGIN_IDS.mutationUndo &&
      modelChange.origin !== ORIGIN_IDS.mutationRedo
    )
      caretFormatHistory.noteEdit();
    // A commit from OUTSIDE this surface retires the armed typing format: the tree it was
    // armed against has moved, and the offsets it is anchored to no longer mean what they
    // did. This surface's own commits already cleared it before running their ops (and
    // re-arm afterwards, which happens after this fires), so this is only ever the
    // external case.
    pendingFormats = null;
    if (!flushingTypeBuffer) typingHistory.noteForeignChange(modelChange);
    if (modelChange.origin === ORIGIN_IDS.mutationRemote) {
      noteRemoteChange(modelChange);
      remoteCaret.note(
        selection,
        modelChange.dirty,
        currentLayout.revision === modelChange.fromRevision
      );
    } else remoteCaret.noteLocal();
    scheduler.notify(modelChange);
  });
  const collaborationPort = collaborationSession
    ? session.collaborationPort(collaborationSession.documentId)
    : null;
  // Attach happens at the END of mount, not here.
  //
  // A replica publishes shared state into the store synchronously on attach, which fires the
  // subscriber above, which reads bindings this function declares much further down. Attaching
  // at this point threw a temporal-dead-zone `ReferenceError` before the room could open, so
  // every session came up in `error` and the dialog never left "Reconnecting".
  let detachCollaboration: () => void = () => {};
  let unsubscribeCollaborationStatus: () => void = () => {};
  let remoteSelectionRenderingReady = false;
  // The host that renders its own remote-caret label content, when one registered. Part of
  // the painter's memo key by identity, so setting or clearing it rebuilds the labels.
  let remoteCaretLabelHost: RemoteCaretLabelHost | null = null;
  /**
   * The last payload handed to the session, so an unchanged caret publishes once.
   *
   * `null` means nothing has been published yet, which is distinct from the empty string a
   * WITHDRAWN selection hashes to — the first withdrawal has to reach the room. Declared with
   * the rest of the collaboration state, above every commit path that reads it: a commit
   * reaching a `let` further down would throw a temporal-dead-zone `ReferenceError` out of an
   * edit, which is how attaching the replica too early used to break the room.
   */
  let publishedCollaborationSelection: string | null = null;
  const unsubscribeRemoteSelections = collaborationSession
    ? collaborationSession.subscribeRemoteSelections(() => {
        if (remoteSelectionRenderingReady) renderRemoteSelections();
      })
    : () => {};

  function visiblePages(): ReadonlySet<number> | undefined {
    const set = visiblePageSet(container, currentLayout, selection, scale);
    const extra = hfScope?.getActive()?.pageIndex ?? selectionSync.selectionPageIndex();
    if (extra === undefined || set === undefined || set.has(extra)) return set;
    return new Set([...set, extra]);
  }

  /** A caller about to read painted geometry (scroll extent, the DOM) lands a paint a commit owes. */
  function payOwedPaint(): void {
    if (commitPaintOwed) render();
  }

  /** Publish any pending layout. Returns whether it did, so callers can avoid a double paint. */
  function flushLayout(): boolean {
    // Nothing pending means nothing committed since the last pass, so the layout in hand is
    // already current and re-running it would be pure waste.
    return scheduler.pending() ? scheduler.flush() : false;
  }

  /**
   * Above this, a commit that finds queued browser input hands layout to the scheduler's
   * own task instead of flushing synchronously. Below it, deferral buys nothing: the pass
   * is cheaper than the task split, and an isolated keystroke must keep today's fully
   * synchronous commit → layout → paint chain.
   */
  const INPUT_PRESSURE_LAYOUT_DEFER_MS = 8;

  /**
   * The commit tail: publish this commit's layout, synchronously on the common path.
   *
   * Under input pressure the flush used to be one unyielding task — transact, layout and
   * paint — so a keystroke arriving mid-flush waited for all three. When the browser already
   * holds queued DISCRETE input (a key, a click — never a mere mousemove) AND the previous
   * pass was expensive, layout is left to the scheduler's `setTimeout(0)` backstop (armed by
   * the commit's own `notify`), which runs layout+publish as its own task;
   * `renderPublishedLayout` may defer paint to a third. Every synchronous reader regains
   * current geometry through `flushLayout` at its own seam, and the deferred pass reads the
   * model as it is when it runs, so no pass is ever published stale.
   *
   * A REFUSED commit never defers, whatever the scheduler holds: the accumulator is shared
   * (a prior deferred commit, an external commit, a drawing-resource invalidation can all
   * have filled it), and the `render()` below is the one report of the refusal the host
   * gets — deferring it delayed `lastRejection`, or lost it to a later commit entirely.
   * `held` defers too: a queued composed insertion the next one in the queue publishes.
   */
  function publishAfterCommit(rejected: boolean, held = false): void {
    if (
      !rejected &&
      scheduler.pending() !== null &&
      (held || (lastLayoutMs > INPUT_PRESSURE_LAYOUT_DEFER_MS && hasPendingBrowserInput(false)))
    ) {
      return;
    }
    // A refusal reports now even inside another commit, which clears it before its own paint.
    if (!flushLayout() || (rejected && commitPaintOwed)) render();
  }

  /**
   * Land queued typing AND any deferred layout pass, so the caller reads current geometry.
   *
   * The one seam every synchronous reader shares — selection reads, navigation, geometry,
   * scope flips, the contract's `flushPendingInput`. Both halves are no-ops when nothing is
   * pending, so the common case costs two cheap checks.
   */
  function flushPendingInputAndLayout(): void {
    flushTypeBuffer();
    flushLayout();
  }

  /**
   * Land queued typing, any deferred layout pass AND any deferred paint. Returns whether a
   * paint happened, so a caller that must ALWAYS leave a fresh paint (the IME readback's
   * discarded-paint rebuild) can render once instead of twice.
   *
   * For lanes that are about to hand the painted DOM over or read it back — the IME: a
   * composition writes into whatever is on screen, and the readback diffs the painted text
   * against the model, so both must describe the committed revision before it starts.
   */
  function flushToPaint(): boolean {
    flushTypeBuffer();
    const published = flushLayout();
    // The flushes above render on their own synchronous paths; what can remain is only a
    // paint deferred under input pressure, and that is exactly what must land now.
    // `render()` retires the deferred timer itself.
    if (deferredPublishRender !== null || commitPaintOwed) {
      render();
      armDerivationPrewarmOnce();
      return true;
    }
    // Published with nothing deferred means `renderPublishedLayout` painted synchronously.
    return published;
  }

  /** TOC chrome is hover-projected; never sticky from caret/click. */
  let hoveredTocControlId: string | null = null;

  function tocControlIdOf(toc: ReturnType<typeof detectBodyTocs>[number]): string {
    return tocControlId(toc, session.part());
  }

  /**
   * Hover retints the chrome ALREADY PAINTED — it must never repaint the document.
   *
   * Chrome sends `mousedown` and then `contextmenu` for one right-click. Repainting on the
   * pointermove that enters a TOC replaced the node the gesture started on, and the
   * `contextmenu` that followed fired on a detached element, so it never bubbled to this
   * layer and the first right-click on a TOC did nothing at all. Painted DOM identity is
   * therefore stable across a hover change, and the attributes move instead.
   */
  function applyTocHoverChrome(): void {
    for (const chrome of pagesLayer.querySelectorAll<HTMLElement>(
      '.docx-content-control-chrome[data-docx-toc]'
    )) {
      if (chrome.getAttribute('data-docx-content-control') === hoveredTocControlId) {
        chrome.dataset.hover = '';
        chrome.dataset.boundaryVisible = '';
        continue;
      }
      delete chrome.dataset.hover;
      // Show-all keeps every boundary visible on its own account; only the hover-owned
      // visibility goes back off here.
      if (!showAllContentControls) delete chrome.dataset.boundaryVisible;
    }
  }

  function setHoveredTocControlId(next: string | null): void {
    if (hoveredTocControlId === next) return;
    hoveredTocControlId = next;
    applyTocHoverChrome();
  }

  function tocForGesture(event: MouseEvent) {
    return tocForElement(session.part(), gestureParagraphId(event), event.target as Element | null);
  }

  function onTocPointerMove(event: PointerEvent): void {
    const toc = tocForGesture(event);
    setHoveredTocControlId(toc ? tocControlIdOf(toc) : null);
  }

  /**
   * The paragraph a click or right-click landed on, resolved without trusting the target.
   *
   * A gesture that begins on a node some other pass then replaces arrives with a target
   * that is no longer in the tree, so `closest` finds nothing worth acting on. Hit-testing
   * the live tree at the same point keeps the gesture rather than dropping it.
   */
  function gestureParagraphId(event: MouseEvent): string | undefined {
    const target = event.target as Element | null;
    const direct = target?.isConnected
      ? target.closest<HTMLElement>('[data-paragraph-id]')
      : undefined;
    if (direct) return direct.dataset.paragraphId;
    const view = pagesLayer.ownerDocument;
    if (typeof view.elementFromPoint !== 'function') return undefined;
    const hit = view.elementFromPoint(event.clientX, event.clientY);
    return hit?.closest<HTMLElement>('[data-paragraph-id]')?.dataset.paragraphId;
  }

  function onTocPointerLeave(): void {
    setHoveredTocControlId(null);
  }

  function contentControlChromeOptions():
    | {
        readonly showAll?: boolean;
        readonly activeIds?: ReadonlySet<string>;
        readonly hoverIds?: ReadonlySet<string>;
        readonly checkedIds?: ReadonlySet<string>;
        readonly additionalBoundaries?: readonly ContentControlBoundaryRecord[];
        readonly tocControlIds?: ReadonlySet<string>;
        readonly suppressedIds?: ReadonlySet<string>;
        readonly readOnly?: boolean;
      }
    | undefined {
    const active = contentControlAtCaret();
    const emptyTocBeginIds = emptyTocPlaceholderParagraphIds(session.part());
    const tocs = detectBodyTocs(session.part());
    const tocBoundaries = tocs
      .map((toc) => {
        const entry = tocBoundaryForLayout(toc, currentLayout, session.part(), measurer);
        return entry ? { ...entry, empty: emptyTocBeginIds.has(toc.beginParagraphId) } : null;
      })
      .filter((entry) => entry !== null);
    const tocControlIds = new Set(tocBoundaries.map((entry) => entry.boundary.id));
    // An empty TOC is identified by its own placeholder box, which is the ONE box the
    // region gets: a second boundary rectangle and a label chip over an empty region read
    // as a rendering fault rather than as chrome.
    const suppressedIds = new Set(
      tocBoundaries.filter((entry) => entry.empty).map((entry) => entry.boundary.id)
    );
    for (const toc of tocs) {
      if (toc.contentControlId && tocControlIdOf(toc) !== toc.contentControlId)
        suppressedIds.add(toc.contentControlId);
    }
    // TOC regions never project caret-active chrome — hoverIds own their visibility.
    const activeIds = active && !tocControlIds.has(active.id) ? new Set([active.id]) : undefined;
    const hoverIds = hoveredTocControlId ? new Set([hoveredTocControlId]) : undefined;
    const checkedIds = new Set(
      contentControlsInLayout(currentLayout)
        .filter((control) => control.controlType === 'checkbox' && checkboxChecked(control.id))
        .map((control) => control.id)
    );
    const additionalBoundaries = tocBoundaries
      .filter((entry) => entry.additional && !entry.empty)
      .map((entry) => entry.boundary);
    // Read-only is a REASON to emit chrome, not a detail of it: with no chrome object the
    // painter still paints every widget, and an unchecked checkbox on a viewing-mode
    // document produced no other chrome to carry the flag.
    const readOnly = contentControlRefusal() !== null;
    if (
      !showAllContentControls &&
      !activeIds &&
      !hoverIds &&
      !readOnly &&
      checkedIds.size === 0 &&
      additionalBoundaries.length === 0 &&
      tocControlIds.size === 0
    ) {
      return undefined;
    }
    return {
      ...(readOnly ? { readOnly: true } : {}),
      ...(showAllContentControls ? { showAll: true } : {}),
      ...(activeIds ? { activeIds } : {}),
      ...(hoverIds ? { hoverIds } : {}),
      ...(checkedIds.size > 0 ? { checkedIds } : {}),
      ...(additionalBoundaries.length > 0 ? { additionalBoundaries } : {}),
      ...(tocControlIds.size > 0 ? { tocControlIds } : {}),
      ...(suppressedIds.size > 0 ? { suppressedIds } : {}),
    };
  }

  /** Innermost layout boundary under the caret, or null outside every control. */
  /**
   * The content control the caret is inside, or null.
   *
   * Two resolutions, because the boundary records the fast one needs exist for the body
   * alone. In the body, geometry: a paragraph can hold several inline controls and only the
   * caret's x/y says which. Anywhere else, the caret's own PARAGRAPH, walked in that story's
   * part — which is the honest answer where no records exist, and is what a block control
   * needs in any case.
   *
   * The story check is not an optimisation. Page-content coordinates mean nothing without
   * knowing whose box they are in: a header caret's y lands in the top band of the BODY
   * content box, so the geometry path answered with whichever body control sat there, and
   * `setValue` and `remove` then rewrote and deleted body content while the reader was
   * editing a header.
   */
  const bodyControlAtCaret = memoizedContentControlSelection(
    () => currentLayout,
    () => selection,
    () => resolveBodyContentControlAtCaret()
  );
  function contentControlAtCaret(): ContentControlBoundaryRecord | null {
    const outside = promptBoundary();
    if (outside)
      return controlOutsidePrompt(
        partOfNodeId(session, outside) ?? session.part(),
        outside,
        currentLayout
      );
    const scope = storyScope();
    return scope.kind === 'body' ? bodyControlAtCaret() : contentControlInStoryAtCaret(scope);
  }

  function resolveBodyContentControlAtCaret(): ContentControlBoundaryRecord | null {
    const found = contentControlAtSelection(currentLayout, selection, measurer);
    // Belt and braces: the records are the body's, so a match from another part is a bug in
    // the index rather than an answer, and must not become a write. A control a peer inserted
    // during a session has a logical id with no part name, so the part is looked up.
    if (!found) return null;
    return partOfNodeId(session, found.id)?.name === session.part().name ? found : null;
  }

  /**
   * The innermost control holding the caret's paragraph, in the open story's own part.
   *
   * Deepest wins, matching the geometry path's innermost-by-nesting rule: a control inside a
   * control is the one the caret is actually in.
   */
  function contentControlInStoryAtCaret(scope: StoryScope): ContentControlBoundaryRecord | null {
    const part = session.partFor(scope);
    if (!part) return null;
    return contentControlHoldingParagraph(part, selection.head.paragraphId);
  }

  /**
   * The control a given id names, in whichever story owns it.
   *
   * Looked up in the part the ID names, not in the body. Every read built on this — the lock
   * and binding gates, the tab index, a checkbox's state, a dropdown's items — answered as if
   * a control outside the body did not exist, so `disabledReason` refused every verb on one
   * with `notFound` while the control was plainly on screen.
   */
  function findControl(controlId: string): OoxmlElement | null {
    // From the PACKAGE, never `partFor`: this backs the lock and binding gates, the tab index,
    // a checkbox's state and a dropdown's items, all of them reads, and `partFor` would spend
    // one of the 64 story-store slots per part touched and never give it back.
    const part = partOfNodeId(session, controlId);
    const node = findNode(part ?? session.part(), controlId);
    if (!node || !isContentControl(node)) return null;
    return node;
  }

  function tabIndexOfControl(controlId: string): number | null {
    const control = findControl(controlId);
    if (!control) return null;
    for (const child of control.children) {
      if (child.kind === 'textValue') continue;
      if (
        (child as { kind?: string }).kind === 'contentControlProperties' ||
        child.localName === 'sdtPr'
      ) {
        for (const prop of child.children) {
          if (prop.kind === 'textValue' || prop.localName !== 'tabIndex') continue;
          const raw = prop.attributes.find((a) => a.localName === 'val')?.value;
          if (raw === undefined) return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        }
      }
    }
    return null;
  }

  /**
   * The controls Tab cycles, in the OPEN story.
   *
   * Built from the layout for the body, where the records carry document order, and from the
   * story's own part otherwise. Against the body's list a furniture caret's own control was
   * never in the roster, so its index was always -1 and 'next' landed unconditionally on the
   * first control in the document body — moving the caret out of the story while the scope
   * still said it was open, which refuses every keystroke after it.
   */
  function editableControlsInOrder(): ContentControlBoundaryRecord[] {
    const scope = storyScope();
    const storyPart = scope.kind === 'body' ? null : session.partFor(scope);
    // A notes PART holds every note; Tab, and the keystrokes after it, stay in the open one.
    const order = withinOpenNote(editingLayout(), noteScopeId(), paragraphOrder());
    const withinNote = scope.kind === 'notesPart' ? new Set(order) : undefined;
    const controls = storyPart
      ? [...contentControlRecordsInPart(storyPart, withinNote)]
      : [...contentControlsInLayout(currentLayout)];
    return controls
      .filter((control) => contentLockedOrBound(control) === null)
      .sort((a, b) => {
        const ta = tabIndexOfControl(a.id);
        const tb = tabIndexOfControl(b.id);
        if (ta !== null && tb !== null && ta !== tb) return ta - tb;
        if (ta !== null && tb === null) return -1;
        if (ta === null && tb !== null) return 1;
        return 0; // document order already from layout
      });
  }

  /**
   * Bring a position a lane TRAVELLED to into view, when it is in the reader's own story.
   *
   * Furniture scrolling is its own lane, which is why an open header, footer or note sits
   * this out — the same reason the caret follower does. The second test is the one that is
   * easy to miss: form-fill Tab enumerates the controls of EVERY story, so a body reader can
   * land on one in a header, and `revealPosition` resolves with no preferred page. One header
   * paragraph is laid out on every page that uses its variant, so that resolved the page-1
   * copy and threw the reader to the top of the document.
   */
  const { begin: beginReveal, later: laterOnOpening } = openingReveals(() => surface, {
    flushLayout: () => void flushLayout(),
    paragraphIds: () => session.paragraphIds(),
    scroller: () => surfaceScroller(container),
  });

  function revealTravelledTo(position: SemanticPosition): void {
    if (hfScope?.getActive() || noteOps?.activeNoteScope()) return;
    if (storyScopeOfNodeId(session, position.paragraphId, { kind: 'body' }).kind !== 'body') return;
    surface.revealPosition(position);
  }

  /**
   * Select the control's addressable content for form-fill replacement, and reveal it.
   *
   * Through `revealPosition` rather than the caret follow, which refuses a range. Tab in
   * form-fill mode is the caller, and the control it lands on is routinely off screen — the
   * mirror cannot even paint a selection on a page nothing built, so the field looked
   * unselected as well as unreachable.
   */
  function selectControlContent(controlId: string): boolean {
    const control = findControl(controlId);
    if (!control) return false;
    const range = contentControlSelectionRange(control, {
      contentChildrenOf,
      searchRoots: () =>
        (session.partFor(storyScopeOfNodeId(session, controlId, storyScope())) ?? session.part())
          .root.children,
    });
    if (!range) return false;
    const before = selection;
    // `none`, with the reveal below owning the scroll: an EMPTY control is a collapsed range,
    // which the ordinary rule follows as a caret — and follows without the story test the
    // reveal applies, so tabbing onto an empty header control threw the reader to page 1.
    setSelection(range, false, 'none');
    // The selection that LANDED, not the one asked for: a text form field inside the control
    // clamps the range to itself. And only when the write was not REFUSED, which a session
    // holding an invalid value does outright — asking both ways round so a `setSelection`
    // that one day short-circuits on an unchanged selection cannot silently stop the reveal.
    if (selection !== before || selectionsEqual(selection, range)) {
      revealTravelledTo(selection.anchor);
    }
    return true;
  }

  const listItemsOfControl = (id: string) =>
    contentControlWidgetItems(findControl(id), () => session.currentPackage());

  function checkboxChecked(controlId: string): boolean {
    const control = findControl(controlId);
    if (!control) return false;
    for (const child of control.children) {
      if (child.kind === 'textValue') continue;
      if (
        (child as { kind?: string }).kind !== 'contentControlProperties' &&
        child.localName !== 'sdtPr'
      ) {
        continue;
      }
      for (const prop of child.children) {
        if (prop.kind !== 'contentControlCheckbox') continue;
        for (const state of prop.children) {
          if (state.kind !== 'contentControlChecked') continue;
          const val = state.attributes.find((a) => a.localName === 'val')?.value;
          return !(val === '0' || val === 'false' || val === 'off');
        }
      }
    }
    return false;
  }

  const dateValueOfControl = (id: string) => contentControlWidgetDate(findControl(id));

  function setContentControlWidgetOpen(controlId: string, open: boolean): void {
    for (const chrome of pagesLayer.querySelectorAll<HTMLElement>('[data-docx-content-control]')) {
      if (chrome.getAttribute('data-docx-content-control') !== controlId) continue;
      if (open) chrome.dataset.open = '';
      else delete chrome.dataset.open;
    }
  }

  const pictureWidget = createContentControlPictureWidget({
    get document() {
      return pagesLayer.ownerDocument;
    },
    layer: pagesLayer,
    find: findControl,
    layout: editingLayout,
    selectDrawing: (drawingNodeId, paragraphId) =>
      surface.selectDrawing(drawingNodeId, paragraphId),
    allowed: (id) => !contentControlsOps.disabledReason(id, 'edit'),
    translate: (key) => translate?.(key) ?? key,
    replaceImage: (drawingNodeId, bytes, mime, commitGuard) =>
      surface.replaceImage(drawingNodeId, bytes, mime, {
        expectedPackageRevision: session.packageRevision(),
        commitGuard,
      }),
    setOpen: setContentControlWidgetOpen,
    reject: publishRefusal,
  });

  const widgetSessions = createContentControlWidgetSessions({
    find: findControl,
    allowed: (id) => !contentControlsOps.disabledReason(id, 'edit'),
    apply: (id, value) => contentControlsOps.setValue(id, value),
    items: listItemsOfControl,
    date: dateValueOfControl,
    checked: checkboxChecked,
    picture: pictureWidget.drawingOf,
    replaceImage: pictureWidget.replace,
    locale: () => dateLocale.get(),
    layer: pagesLayer,
    setOpen: setContentControlWidgetOpen,
    request: options.onRequestContentControlWidget,
  });

  let activeContentControlMenu: HTMLElement | null = null;
  let stopContentControlMenuDismiss: (() => void) | undefined;
  function closeContentControlMenu(menu: HTMLElement): void {
    if (activeContentControlMenu === menu) {
      activeContentControlMenu = null;
      stopContentControlMenuDismiss?.();
      stopContentControlMenuDismiss = undefined;
    }
    const controlId = menu.dataset.docxCcId;
    const restoreFocus = menu.contains(pagesLayer.ownerDocument.activeElement);
    menu.remove();
    if (controlId) setContentControlWidgetOpen(controlId, false);
    if (restoreFocus) pagesLayer.focus({ preventScroll: true });
  }

  function removeExistingContentControlMenu(): HTMLElement | null {
    widgetSessions.cancel();
    const existing = activeContentControlMenu;
    if (existing) closeContentControlMenu(existing);
    return existing;
  }

  /**
   * Record which TOC a right-click landed on, and otherwise LET IT THROUGH.
   *
   * The engine paints no menu of its own. A host's context menu is one primitive with one
   * set of rows, icons, shortcut column and keyboard model; a second panel painted here
   * would be a second place for all of that to drift, and it looked like one too. What the
   * engine owns is the part a host cannot work out for itself: a TOC refuses the caret, so
   * nothing in `selection` says which table of contents is under the pointer. That is what
   * this publishes.
   */
  function onTocContextMenu(event: MouseEvent): void {
    const toc = tocForGesture(event);
    const reachable = toc && (canRefreshToc(toc.id) || !removal.removeTocRefusal(toc.id));
    setContextTocId(reachable ? toc.id : null);
  }

  /** The TOC the last right-click addressed. Cleared by any other right-click or click. */
  let contextTocId: string | null = null;

  function setContextTocId(next: string | null): void {
    if (contextTocId === next) return;
    contextTocId = next;
    options.onChange?.(currentState());
  }

  function onTocRowClick(event: MouseEvent): void {
    if (event.button === 0) setContextTocId(null);
    if (event.button !== 0 || (event.target as Element | null)?.closest('a.docx-hyperlink')) return;
    // A range ends a drag (see the link lane).
    if (!selectionsEqual(selection, collapsedAt(selection.head))) return;
    const paragraphId = gestureParagraphId(event);
    if (!paragraphId) return;
    const toc = detectBodyTocs(session.part()).find((candidate) =>
      candidate.resultParagraphIds.includes(paragraphId)
    );
    if (!toc || tocForGesture(event)?.id !== toc.id) return;
    // The row names its own target through its anchor or its title. Reading the outline entry
    // that sits at the row's INDEX sends a click to the wrong heading the moment the cached
    // rows and the outline disagree, which is the normal state of a TOC that needs refreshing.
    const headings = resolveTocRowHeadings(
      session.part(),
      toc,
      session.documentOutline(),
      tocRegionOf(toc)
    );
    const headingParagraphId = headings[toc.resultParagraphIds.indexOf(paragraphId)];
    if (!headingParagraphId) return;
    event.preventDefault();
    navigation.goToPosition({ paragraphId: headingParagraphId, offset: 0 });
  }

  const contentControlMenuHost: ContentControlMenuHost = {
    get document() {
      return pagesLayer.ownerDocument;
    },
    locale: () => dateLocale.get(),
    translate: (key) => translate?.(key) ?? key,
    setValue: (controlId, value) => contentControlsOps.setValue(controlId, value),
    close: (menu) => closeContentControlMenu(menu),
  };

  function openContentControlWidget(controlId: string, kind: string): void {
    const reason = contentControlsOps.disabledReason(controlId, 'edit');
    if (reason) {
      lastRejection = refuse(reason);
      options.onChange?.(currentState());
      return;
    }
    pictureWidget.cancel();
    // Re-pressing the native widget toggles its current menu shut.
    if (removeExistingContentControlMenu()?.dataset.docxCcId === controlId) return;
    // A picture press selects the picture first, as in Word, so the host's image commands
    // address it whichever renderer takes the pick.
    if (kind === 'picture') pictureWidget.select(controlId);
    // A host renderer that took the session owns the interaction — for a checkbox too, so a
    // host can confirm, refuse or restyle a toggle instead of only watching it land.
    if (widgetSessions.open(controlId, kind)) return;
    if (kind === 'picture') return pictureWidget.pick(controlId);
    if (kind === 'checkbox') {
      contentControlsOps.setValue(controlId, checkboxChecked(controlId) ? 'false' : 'true');
      return;
    }
    const alias = contentControlsInLayout(currentLayout).find((c) => c.id === controlId)?.alias;
    let menu: HTMLElement;
    if (kind === 'dropdown' || kind === 'comboBox' || kind === 'buildingBlockGallery') {
      const items = listItemsOfControl(controlId);
      if (items.length === 0 && kind === 'dropdown') return;
      menu = buildContentControlListMenu(
        contentControlMenuHost,
        controlId,
        kind,
        items,
        alias,
        contentControlWidgetValue(findControl(controlId), items)
      );
    } else if (kind === 'date') {
      menu = buildContentControlCalendar(
        contentControlMenuHost,
        controlId,
        dateValueOfControl(controlId),
        alias
      );
    } else {
      return;
    }
    activeContentControlMenu = menu;
    placeContentControlMenu(
      menu,
      pagesLayer,
      contentControlMenuAnchor(
        currentLayout,
        scale,
        controlId,
        pagesLayer,
        materializedExtent?.pageOffsetX
      )
    );
    setContentControlWidgetOpen(controlId, true);
    stopContentControlMenuDismiss = armContentControlMenuDismiss(menu, () =>
      closeContentControlMenu(menu)
    );
    if (kind === 'date') focusContentControlCalendar(menu);
    else
      (
        menu.querySelector<HTMLElement>('input') ??
        menu.querySelector<HTMLElement>('[role=option][tabindex="0"]') ??
        menu.querySelector<HTMLElement>('button,[data-docx-part=empty]')
      )?.focus({ preventScroll: true });
  }

  const contentControlsOps: ContentControlOps = {
    setShowAll(show) {
      if (showAllContentControls === show) return;
      showAllContentControls = show;
      // Furniture-only: rebuild paint without a layout pass.
      render();
    },
    setFormFill(active) {
      if (formFillMode === active) return;
      formFillMode = active;
      options.onChange?.(currentState());
    },
    showAll: () => showAllContentControls,
    formFill: () => formFillMode,
    atCaret: () => contentControlAtCaret(),
    navigate(direction) {
      const editable = editableControlsInOrder();
      if (editable.length === 0) return false;
      const current = contentControlAtCaret();
      let index = current ? editable.findIndex((c) => c.id === current.id) : -1;
      if (direction === 'next') {
        index = index < 0 ? 0 : (index + 1) % editable.length;
      } else {
        index = index < 0 ? editable.length - 1 : (index - 1 + editable.length) % editable.length;
      }
      const target = editable[index]!;
      return selectControlContent(target.id);
    },
    setValue(controlId, value) {
      const reason = contentControlsOps.disabledReason(controlId, 'edit');
      if (reason) return publishRefusal(reason);
      // A gallery control's value is a building block name, resolved against the glossary.
      const ops = contentControlValueOps(
        findControl(controlId),
        () => session.currentPackage(),
        controlId,
        value
      );
      if (!ops) return publishRefusal('unknown-building-block');
      let committed = false;
      commit(() => {
        // `applyOps`, not `session.applyTreeOps`: this lane wrote straight past the mode
        // rules, so a checkbox in a document open for viewing still toggled and committed.
        // No selection check, because a control op names the control it edits: where the
        // reader's caret sits is a different question, and `contentControlRefusal` above
        // judges the write on exactly these terms.
        //
        // The STORY comes from the control's own id, not from the open scope and not from a
        // constant. Pinned to the body, this wrote body content while the reader was editing
        // a header, and a control in that header could never be written at all.
        const result = applyOps(
          ops,
          selectionMark(),
          undefined,
          storyScopeOfNodeId(session, controlId, storyScope()),
          false
        );
        committed = result.committed;
        return result;
      });
      return committed;
    },
    remove(controlId) {
      const id = controlId ?? contentControlAtCaret()?.id;
      if (!id) return publishRefusal('notFound');
      const reason = contentControlsOps.disabledReason(id, 'remove');
      if (reason) return publishRefusal(reason);
      let committed = false;
      commit(() => {
        const result = applyOps(
          [{ op: 'removeContentControl', controlId: id }],
          selectionMark(),
          undefined,
          storyScopeOfNodeId(session, id, storyScope()),
          false
        );
        committed = result.committed;
        return result;
      });
      return committed;
    },
    disabledReason(controlId, action) {
      // The MODE outranks every per-control property. Asked first because this one answer
      // reaches everything: the painted widget disables itself on it, the pointer lane skips
      // a widget carrying it, and the toolbar's remove row reports it.
      const refusal = contentControlRefusal();
      if (refusal !== null) return refusal;
      const record = contentControlsInLayout(currentLayout).find((c) => c.id === controlId);
      if (record) {
        return action === 'remove' ? removalLocked(record) : contentLockedOrBound(record);
      }
      const control = findControl(controlId);
      if (!control) return 'notFound';
      // Layout has not published a boundary yet — refuse conservatively from tree props.
      return treeLockRefusal(control, action);
    },
  };

  /** The pages layer's editable chrome, from the host's wish AND the mode. */
  const applyEditableChrome = (): void =>
    applyPagesEditableChrome(pagesLayer, hostEditable && editingMode !== 'view');

  function currentState(): PaginatedSurfaceState {
    return {
      revision: session.packageRevision(),
      pageCount: currentLayout.pages.length,
      selection,
      cellSelection,
      canUndo: caretFormatHistory.canUndo || (collaborationSession?.canUndo() ?? session.canUndo()),
      canRedo: caretFormatHistory.canRedo || (collaborationSession?.canRedo() ?? session.canRedo()),
      collaborationStatus: collaborationSession?.status() ?? 'inactive',
      lastRejection,
      // Reference-stable while unchanged: `pendingAtCaret` hands back the stored array,
      // so a host can compare states to see whether the armed format moved.
      pendingFormat: pendingAtCaret(),
      contentControls: {
        showAll: showAllContentControls,
        formFill: formFillMode,
        activeControlId: contentControlAtCaret()?.id ?? null,
      },
      contextTocId,
      formatPainter: formatPainter.state(),
      perf: {
        layoutMs: lastLayoutMs,
        paintMs: lastPaintMs,
        selectionMs: lastSelectionMs,
        placed: layoutSession.stats.placed,
        total: layoutSession.stats.total,
        reusedPages: layoutSession.stats.reusedPages,
        fullPasses: layoutSession.stats.fullPasses,
        staleDiscards: scheduler.staleDiscards,
        cancelledRuns: scheduler.cancelledRuns,
      },
    };
  }

  /** The set the current paint was built with, so a scroll can tell whether it must repaint. */
  let materializedSet: ReadonlySet<number> | undefined;
  /** Sizing the last paint used, so scroll can re-centre when the visible width band moves. */
  let materializedExtent: SurfaceExtent | undefined;
  /** An edit may move the caret within the same page without going through `setSelection`. */
  let caretFollowPending = false;
  /**
   * The scroller whose SIZE is being watched, and the observer watching it.
   *
   * Declared here, above the paint that re-checks them, so `watchScrollerSize` can never be
   * reached before its own state exists — the wiring below runs late, and a temporal dead
   * zone would be a ReferenceError thrown out of a repaint.
   */
  let viewportBinding: SurfaceViewportBinding | null = null;
  const hosting = createSurfaceHosting({
    pagesLayer,
    listeners: hostListeners,
    viewport: () => viewportBinding,
    container: () => container,
    setContainer: (next) => (container = next),
    destroyed: () => destroyed,
    scale: () => scale,
    settle: () => {
      flushToPaint();
      finishOpeningPass();
      deferredLayout.finish();
      removeExistingContentControlMenu();
      pictureWidget.cancel();
      pointer?.cancelGesture();
      drop?.clear();
      invalidatePointTargets(surface);
      tableInteraction.cancelDrag();
    },
    repaint: () => render(false),
    onHostMoved: (document) => options.onHostMoved?.(document),
  });

  function render(notifyChange = true): void {
    drop?.refresh();
    // Any render catches the screen up to `currentLayout`, so a paint deferred under input
    // pressure is performed BY this one rather than repeated a task later — a scroll repaint
    // during a deferral used to paint the same layout twice. The deferred render was also
    // the commit's only state report, so this render inherits its notify duty.
    if (deferredPublishRender !== null) {
      timers.clearTimeout(deferredPublishRender);
      deferredPublishRender = null;
      notifyChange = true;
    }
    hosting.heal();
    // THE PAGE IS THE INPUT METHOD'S UNTIL `compositionend`. A newer layout (a collaborator's
    // edit) would replace the nodes it is composing into; it is painted when the composition
    // ends, and the readback carries the composed text onto it (surface-composition-rebase).
    if (heldLayout !== null && currentLayout !== heldLayout) {
      commitPaintOwed = true;
      if (notifyChange) options.onChange?.(currentState());
      return;
    }
    // Parked: no viewport, so a paint would build every page into a holder nobody sees. State
    // still reports, and `moveTo` repaints in full.
    if (hosting.parked()) {
      commitPaintOwed = false;
      paintHighlights(); // keeps host highlights mapped through each revision
      if (notifyChange) options.onChange?.(currentState());
      return;
    }
    // Reading the DOM selection BEFORE the paint replaces the nodes it lives in is what makes
    // a repaint carry a gesture the queued `selectionchange` has not delivered yet, rather
    // than erase it — see `adoptBeforePaint`.
    commitPaintOwed = false;
    const adopted = selectionSync.adoptBeforePaint();
    const paintBegan = now();
    materializedSet = visiblePages();
    // Shared furniture: keep the visual occurrence on a built page before paint marks
    // `data-docx-hf-active`, so scroll cannot leave the caret host on a dematerialized sheet.
    hfScope?.reconcileOccurrence();
    const activeHf = hfScope?.getActive() ?? null;
    const contentControlChrome = contentControlChromeOptions();
    const emptyTocIds = emptyTocPlaceholderParagraphIds(session.part());
    paintedLayout = currentLayout;
    paintSemanticLayoutWithAuthorSlots(
      pagesLayer,
      currentLayout,
      {
        scale,
        readOnlyParagraphIds: fullyProtectedTocParagraphs(session.part()),
        ...(emptyTocIds.size > 0 ? { emptyTocPlaceholderIds: emptyTocIds } : {}),
        ...(options.fontAlias ? { fontAlias: options.fontAlias } : {}),
        serifHangulFace,
        ...(options.defaultFontFamily ? { defaultFontFamily: options.defaultFontFamily } : {}),
        materialize: materializedSet,
        ariaHidden: false,
        drawingStrings,
        ...unsupportedElementPaintOptions(unsupportedProjection, session),
        breakMarkStrings,
        ...(options.fieldShading ? { fieldShading: options.fieldShading } : {}),
        ...(revisionStyles !== undefined ? { revisionStyles } : {}),
        revisionMarkup: markupSettings.current(),
        facingPages: revisionFacingPages(settingsPartOf(session.currentPackage())),
        shadeFormFields: shadeFormFields(),
        showParagraphMarks: paragraphMarks.get(),
        changeBars: changeBarsMode(),
        changeBarsToggle: !!options.reviewModel,
        ...(paintImageUrlPort ? { imageUrlPort: paintImageUrlPort } : {}),
        ...(activeHf
          ? {
              activeHeaderFooterRId: activeHf.scope.rId,
              activeHeaderFooterPageIndex: activeHf.pageIndex,
            }
          : {}),
        ...(contentControlChrome ? { contentControlChrome } : {}),
      },
      reviewAuthors.get().value
    );
    // Paint just rebuilt every span, so the caret's field lost its mark with the old DOM.
    textboxEditing?.syncDom();
    syncActiveFieldShading(pagesLayer, collapsedCaretPosition(), { domReplaced: true });
    setHeaderFooterEditingChrome(container, pagesLayer, activeHf != null);
    // Viewing mode hides write affordances the painter cannot know about — today the
    // blank header/footer "double-click to add" band.
    setEditingModeChrome(container, editingMode);
    // The pages are absolutely positioned, so the layer has no intrinsic size and the
    // surface would collapse to zero — pages then escape whatever centres or scrolls it.
    // Size it from the records, which is the only place the extent is known.
    materializedExtent = surfaceExtent(currentLayout, materializedSet);
    applyPageOffsets(pagesLayer, currentLayout, materializedExtent, scale);
    pagesLayer.style.width = `${materializedExtent.width * scale}px`;
    pagesLayer.style.height = `${materializedExtent.height * scale}px`;
    container.style.width = `${materializedExtent.width * scale}px`;
    container.style.height = `${materializedExtent.height * scale}px`;
    const { width, height } = materializedExtent;
    sizeOverlaySheets(sheets, `${width * scale}px`, `${height * scale}px`);
    tableInteraction.update();
    // Sizing included: the style writes above invalidate layout, and the selection sync
    // right after is what forces the browser to resolve it. Splitting the timer here would
    // book the paint's own cost to the selection phase.
    lastPaintMs = now() - paintBegan;
    options.onTiming?.('paint', lastPaintMs);
    renderOverlay();
    renderRemoteSelections();
    renderCommentHighlights(true);
    bookmarks.paint(overlayFrame(bookmarkLayer));
    paintHighlights();
    // The surface may only now have been wrapped in its viewport, so the size watcher
    // re-resolves its target here rather than trusting what existed at mount.
    viewportBinding?.watchScrollerSize();
    selectionSync.mirrorToDom();
    followCaretIntoView(caretFollowPending);
    // SPENT either way. Kept alive through a suppressed pass it would only wait for the next
    // repaint — the reader's own wheel scroll — and yank the view to a caret they had just
    // scrolled away from, and nothing on the press path consumes it in between.
    caretFollowPending = false;
    // A scroll reports nothing — nothing about the document or the selection moved. Taking up
    // a pending gesture DID move the selection, so that pass has to report after all.
    if (notifyChange || adopted) options.onChange?.(currentState());
  }

  /**
   * Follow the viewport: scrolling must reveal BUILT pages, not shells.
   *
   * Materialization is decided at paint time, and without this it was only ever decided on a
   * COMMIT — scrolling a long document showed blank sheets until the next keystroke. A
   * scroll repaints only when the set of pages worth building actually changed, and it does
   * not report a state change: nothing about the document, selection or revision moved.
   */
  function rematerialize(): void {
    // The scroll-driven repaint can adopt a pending DOM gesture (adoptBeforePaint),
    // which moves the selection without passing `setSelection`'s buffer guard;
    // landing queued typing here first closes that window. The layout flush rides
    // along so the page set is chosen against current geometry when a commit
    // deferred its pass. Safe: this runs from a scheduled frame, never inside a
    // render.
    flushPendingInputAndLayout();
    const nextSet = visiblePages();
    const nextExtent = surfaceExtent(currentLayout, nextSet);
    if (
      materializedExtent &&
      equalPageSets(nextSet, materializedSet) &&
      equalSurfaceExtents(nextExtent, materializedExtent)
    ) {
      return;
    }
    render(false);
  }

  const caretView = createCaretViewFollower({
    storyScopeOpen: () => Boolean(hfScope?.getActive() || noteOps?.activeNoteScope()),
    selection: () => hiddenMarks.shownSelection(selection),
    layout: editingLayout,
    measurer: () => measurer,
    preferredPageIndex: () => selectionSync.selectionPageIndex(),
    preferredLineId: () => selectionSync.selectionLineId(),
    pagesLayer,
    get container() {
      return container;
    },
    scroller: () => surfaceScroller(container),
    scale: () => scale,
    scheduleRematerialize: () => viewportBinding?.schedule(),
  });

  function followCaretIntoView(force = false, mode: CaretFollowMode = 'caret'): void {
    caretView.follow(force, mode);
  }

  let editingMode: SurfaceEditingMode = options.editingMode ?? 'edit';
  /** The host's own `setEditable` wish, kept apart from the mode's — see `applyEditableChrome`. */
  let hostEditable = true;

  /** The main story. Named once so the automation entry cannot drift from the session default. */
  const BODY_STORY: StoryScope = Object.freeze({ kind: 'body' as const });

  /**
   * Commit ops, attributing them when the surface is suggesting.
   *
   * ONE interception point rather than an argument threaded through a dozen emit sites: the
   * ops are built all over this file, and a site that forgot to pass the attribution would
   * silently write an untracked edit in suggesting mode — the failure nobody notices until
   * the document has already lost the proposal.
   */
  const dateLocale = createSurfaceDateLocale(options.locale, flushTypeBuffer);
  let translate = options.translate;
  let textFormInteraction: ReturnType<typeof createTextFormFieldInteraction> | null = null;
  let legacyDropdownInteraction: ReturnType<typeof createLegacyDropdownInteraction> | null = null;
  let legacyCheckboxInteraction: ReturnType<typeof createLegacyCheckboxInteraction> | null = null;
  function applyOps(
    ops: readonly TreeDocOp[],
    selectionBefore?: Parameters<TreeDocxSession['applyTreeOps']>[1],
    selectionAfter?: Parameters<TreeDocxSession['applyTreeOps']>[2],
    // Defaulted, and therefore evaluated per call: every input path wants the story the
    // reader is in. Only a caller that ALREADY knows which story its ops address — an
    // automation handle names one — passes this, and then the reader's position is irrelevant.
    scope: StoryScope = storyScope(),
    checkSelection = true,
    packageEdits?: NonNullable<Parameters<TreeDocxSession['applyTreeOps']>[4]>['packageEdits']
  ): ReturnType<TreeDocxSession['applyTreeOps']> {
    // Every live lane reaches here inside `commit`, whose head-flush already ran, so this
    // is a defensive no-op — kept so a future direct caller still lands buffered typing
    // before its ops address the document.
    flushTypeBuffer();
    const refusal = writeRefusal(
      ops.some(isDocumentEdit) || !!packageEdits?.length,
      ops,
      checkSelection
    );
    if (refusal !== null) return { committed: false, rejected: true, opCount: 0, reason: refusal };
    // The scope resolves to `storyScope()` unless the caller named one, so an edit inside a
    // header, a footer or a note is applied to that story rather than to the body.
    const attributed = trackedOps(
      checkSelection && textFormInteraction ? textFormInteraction.annotate(ops) : ops
    );
    const result = applyJournaledOps(
      attributed,
      selectionBefore,
      selectionAfter,
      scope,
      packageEdits
    );
    if (checkSelection) textFormInteraction?.afterApply(result.committed);
    if (result.committed && attributed.some(isTrackedEdit)) {
      runtimeOptions.onTrackedChange?.();
    }
    return result;
  }

  const { apply: applyJournaledOps, noteRemoteChange } = createJournaledApply({
    session,
    collaboration: collaborationSession,
    historyGroup: () => commitHistoryGroup.value,
    defaultScope: () => storyScope(),
    canRepair: () => !destroyed && editingMode !== 'view' && session.editable,
    later: (task) => timers.setTimeout(fieldScope.wrap(task), 0),
  });

  /**
   * Why a write would be refused right now, or null when it would be allowed.
   *
   * ONE statement of the mode rules, asked by `applyOps` for every lane and asked once more by the
   * automation path — which has to know the answer BEFORE it builds its ops, because building them
   * can mint a hyperlink relationship, and a relationship survives a refusal. `edits` says whether
   * the write changes the document, which is the only thing the second rule needs from the ops.
   */
  function writeRefusal(
    edits: boolean,
    ops: readonly TreeDocOp[] = [],
    checkSelection = true
  ): string | null {
    // VIEWING refuses every write here rather than only at the facade. The keymap and
    // `beforeinput` are wired to this surface, not to `Editor.exec`, so a facade-only gate
    // left the document fully typeable while the toolbar reported it read-only.
    // The PROTECTION write is document-wide, so neither the view nor where the caret happens
    // to sit has anything to say about it. Without the second exemption a caret parked in a
    // table of contents refused it with a reason about the table of contents.
    if (refreshWriteBlocked(container)) return writeBlockReason(container);
    const protectionWrite = isDocumentProtectionBatch(ops);
    if (editingMode === 'view' && !protectionWrite) return VIEWING_REFUSAL;
    if (
      showFieldCodes &&
      edits &&
      checkSelection &&
      !protectionWrite &&
      selectionTouchesFieldCodeInput((id) => partOfNodeId(session, id), selection)
    )
      return FIELD_CODE_INPUT_REFUSAL;
    if (
      edits &&
      !protectionWrite &&
      ((checkSelection && !formattingOutsideToc && selectionTouchesToc()) ||
        ops.some((op) => opTouchesToc(op)))
    ) {
      return TOC_READ_ONLY_REFUSAL;
    }
    const crossNote = checkSelection
      ? crossNoteWriteRefusal(editingLayout(), noteScopeId(), selection, ops)
      : null;
    if (crossNote) return crossNote; // Typing or deletion across notes would merge them.
    // Without an author, refuse every suggested edit instead of writing untracked changes.
    if (editingMode === 'suggest' && !author?.trim() && edits) return AUTHOR_WRITE_REFUSAL;
    if (editingMode === 'suggest') return suggestingRefusalIn(session, author, ops);
    return null;
  }

  const contentControlRefusal = createControlWriteRefusal(
    () => writeRefusal(true, [], false),
    () => session.editable
  );

  /** Ops that create or extend a reviewable proposal. */
  /**
   * The ops that carry per-op revision attribution, spelled ONCE.
   *
   * `attributeTrackedOps` stamps exactly these and `isTrackedEdit` reports exactly these, so
   * a new revision-capable op added to one list but not the other would either write
   * untracked in suggesting mode — the #458 failure — or stop `onTrackedChange` firing.
   * Tabs and breaks are members because they are insertions too: passed through
   * unattributed, they serialized as a plain run beside the strike — an edit the review
   * pane could neither accept nor reject, in a document whose author believed everything
   * they did was a proposal. A page field and a note citation are members for the same
   * reason: the field's runs go into ONE `w:ins`, and the note's reference run is wrapped
   * while its body stays plain (rejecting the reference sweeps the body).
   *
   * `insertHyperlink` is deliberately NOT a member. The wrap carries no content of its
   * own; in suggesting mode the link lane replaces the selection with tracked ops first,
   * so the `w:hyperlink` only ever wraps this author's own `w:ins` — which is the
   * reviewable unit.
   *
   * The three PROPERTY ops are members for the reason the tabs and breaks are: passed
   * through unattributed they rewrote a `w:rPr` outright, so a suggester's Bold press was a
   * permanent edit with no card, nothing to reject, and — once formatting learned to reach
   * tracked text — a silent rewrite of another author's pending insertion (#495).
   */

  /** Whether this document wants its formatting changes recorded at all. */
  const formattingTracked = (): boolean =>
    markupSettings.current().trackFormatting && !session.trackingSettings().doNotTrackFormatting;
  /**
   * The author this edit will be attributed to, or undefined when it lands untracked.
   *
   * `CT_TrackChange` makes `@w:author` required, so with no author there is nothing valid
   * to write. The edit lands untracked rather than being refused: losing the user's typing
   * to a missing configuration value would be the worse failure. ONE answer, because a
   * lane that decides what to write by re-deriving this condition drifts from the lane
   * that decides how to attribute it.
   */
  function trackedAuthorOrNone(): string | undefined {
    const writer = author?.trim();
    return editingMode === 'suggest' && writer ? writer : undefined;
  }

  /** Where typed or composed text leaves the caret; a tracked insertion keeps the prompt. */
  function typedLanding(paragraphId: string, offset: number, length: number): number {
    const part = partOfNodeId(session, paragraphId) ?? session.part();
    const tracked = trackedAuthorOrNone() !== undefined;
    return promptInsertionLanding(part, paragraphId, offset, length, tracked);
  }

  /** Suggesting attributes text and structural row edits as Word tracked changes. */
  function trackedOps(ops: readonly TreeDocOp[], date = revisionDateNow()): TreeDocOp[] {
    const author = trackedAuthorOrNone();
    if (author === undefined) return [...ops];
    return attributeTrackedOps(ops, { author, date }, formattingTracked());
  }

  /**
   * The history mark for a caret, which is what REDO restores.
   *
   * `applyOps` takes it as its third argument and the store records it on the entry. Only
   * `type()` ever supplied one, so redo put the caret back where the edit STARTED — after
   * redoing Enter the next character went into the paragraph above the one it belonged to.
   */

  /** The view layout removes hidden-mark paragraphs in; see `hidden-mark-joins.ts`. */
  function revisionView(): RevisionView {
    return { displayMode: revisionDisplayMode(), authorFilter: revisionFilter() };
  }
  /** Backspace/Delete from a caret in a removed paragraph remove that paragraph first. */
  function removeCaretParagraph(direction: 'backward' | 'forward'): boolean {
    const edit = hiddenMarks.removedCaretEdit(selection.head, direction);
    if (edit === null) return false;
    const after = () => collapsedAt(edit.caret);
    commit(() => applyOps(edit.ops, selectionMark(), caretMark(edit.caret)), after);
    return true;
  }

  const wordDeletion = createSurfaceWordDeletion({
    selection: () => selection,
    layout: editingLayout,
    textOf: (paragraphId) => textOf(paragraphId),
    fieldBoundary: () => textFormInteraction?.wordDeletionBoundary,
    promptIsSelected: () => promptIsSelected(),
    deleteSelection: () => surface.deleteSelection(),
    deleteCharacter: (direction) =>
      direction === 'backward' ? surface.deleteBackward() : surface.deleteForward(),
    deleteAtomicControl,
    commitWord: (ops, caret) =>
      void commit(() => applyOps(ops, selectionMark()), caret && (() => collapsedAt(caret)), {
        rearmPending: armedAtCaret() ?? undefined,
      }),
  });

  /** Backspace / Delete at a chip or a prompt; see `surface-locked-control-delete.ts`. */
  function deleteAtomicControl(direction: 'backward' | 'forward', reach?: number): boolean {
    const step = atomicControlDeletion(direction, (at) => hiddenMarks.shown(at), reach);
    if (step?.kind === 'select') setSelection(step.selection);
    else if (step) {
      const armed = armedAtCaret() ?? undefined;
      const after = () => collapsedAt(step.collapseTo);
      commit(() => applyOps(step.ops, selectionMark(), caretMark(step.collapseTo)), after, {
        rearmPending: armed,
      });
    }
    return step !== null;
  }

  function caretMark(position: { paragraphId: string; offset: number }): {
    paragraphId: string;
    start: number;
    end: number;
  } {
    return { paragraphId: position.paragraphId, start: position.offset, end: position.offset };
  }

  /** The refusal (the refresh, reported, when the guard skips `run`), or null: landed or no-op. */
  function commit(...args: Parameters<typeof commitNow>): string | null {
    if (refreshWriteBlocked(container)) return refuse(writeBlockReason(container));
    const finish = beginSurfaceCommit(container);
    try {
      return commitNow(...args);
    } finally {
      finish();
    }
  }
  function commitNow(
    run: () => ReturnType<TreeDocxSession['applyPmDoc']> | boolean,
    selectionAfter?: () => SemanticSelection | null,
    options:
      | {
          readonly keepCellSelection?: boolean;
          readonly automation?: boolean;
          /**
           * Re-anchor this armed typing format at the POST-edit caret instead of retiring
           * it. Word's rule: Backspace, Delete and Enter keep the typing format — bold
           * pressed at a caret survives deleting a character or opening a new paragraph,
           * and applies to whatever is typed next there.
           */
          readonly rearmPending?: ArmedFormat;
          /** Queued composed text: it precedes the type buffer, and may leave its publish. */
          readonly composed?: { readonly publish: boolean };
        }
      | undefined = {}
  ): string | null {
    // Any batched typing lands first as its own transaction, so this edit sees
    // the document and selection the user saw. Reentrancy-guarded: the flush
    // itself commits through here with an empty buffer.
    if (!options?.composed) flushTypeBuffer();
    if (!flushingTypeBuffer) typingHistory.end();
    const finishSelectionHistory = documentSelectionHistory.begin();
    // An edit invalidates the rectangle: its cells' content has changed, and the collapsed
    // DOM selection it installed still points at the PRE-edit anchor. Left standing it kept
    // painting a highlight over text that had moved, kept suppressing selection adoption, and
    // kept feeding a stale cell list to the toolbar. Formatting is the one caller that
    // legitimately keeps it — Word leaves cells selected after Bold.
    if (!options?.keepCellSelection) cellSelection = null;
    // A committed edit retires the stored caret format unless the caller re-arms it below:
    // the consumers (`type()`, the IME readback) capture the properties BEFORE calling here,
    // and the caret-preserving edits (Backspace, Delete, Enter) pass `rearmPending`.
    pendingFormats = null;
    // Whatever the DOM selection holds, it was made against the text BEFORE this edit, so its
    // offsets stop meaning the same thing the moment the ops land. The render below must
    // write the model's selection out, never read the stale one back.
    selectionSync.noteModelMoved();
    // Ops go through the session, so the tree stays the only state. A refusal is surfaced
    // rather than silently dropped: the view is repainted from what the model actually
    // holds, so the user never keeps looking at an edit that will not be saved.
    // Open until the post-edit caret is installed: the review, automation and undo selection
    // thunks read layout too. A throw skips `publishAfterCommit`, so it pays an owed paint.
    commitRunDepth += 1;
    // Returned rather than read back from `lastRejection`, which a listener can move.
    let rejected: string | null = null;
    try {
      const result = commitHistoryGroup.around(
        surface,
        run,
        (r) => (typeof r === 'boolean' ? r : r.committed),
        !options?.automation
      );
      const rejection = typeof result === 'boolean' || !result.rejected ? null : result;
      if (rejection) {
        const raw = String(rejection.reason ?? UNEXPLAINED_WRITE_REFUSAL);
        rejected = lastRejection = refuse(writeRejectionReason(raw, session.settingsRoot()), raw);
      } else {
        lastRejection = null;
        if (typeof result === 'boolean' ? result : result.committed) reportEdit();
        // The post-edit selection is installed BEFORE the paint, so the single render below
        // paints the new pages, mirrors the new caret into the DOM and reports one state
        // change. Committing first and calling `setSelection` afterwards wrote the superseded
        // caret into the fresh DOM, wrote the browser selection twice, and reported every
        // edit twice — the second-largest cost of a keystroke after layout, because a host
        // re-derives toolbar formatting from each report. Supplied as a THUNK evaluated after
        // the ops: a caret landing in a `w:p` the commit minted cannot be computed before the
        // commit runs.
        const next = selectionAfter?.();
        if (next) {
          retireActivationPin();
          selection = next;
          // An edit placed a TEXT caret — typing beside an anchored image must not ring it.
          // Image property edits commit with no selectionAfter, so a resize or move drag
          // keeps its object selection, exactly as Word does.
          setDrawingIntent({ kind: 'none' }, false);
          desiredX = null;
          caretFollowPending = true;
        }
        // Re-anchor AFTER the post-edit caret is installed, so the armed format follows the
        // edit (Backspace moves it one left, Enter moves it into the new paragraph). Only a
        // collapsed caret can hold one — the same invariant arming enforces.
        const rearm = options?.rearmPending;
        if (rearm && rearm.properties.length > 0) {
          const { anchor, head } = selection;
          if (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset) {
            // The new anchor LAST: `armedAtCaret()` hands back the full armed record, and
            // its stale position must not override where the edit just put the caret.
            pendingFormats = { properties: rearm.properties, base: rearm.base, position: head };
          }
        }
      }
      // An edit moves the caret, and a caret move is presence. Published HERE rather than from
      // the paint: under input pressure `publishAfterCommit` hands layout to a later task, and
      // a remote caret must not wait on this author's repaint to stop pointing at a position
      // they have left.
      finishSelectionHistory();
      publishLocalCollaborationSelection();
    } catch (error) {
      if ((commitRunDepth -= 1) === 0 && commitPaintOwed) {
        try {
          render();
        } catch {
          // Report the commit's own error, not the paint's.
        }
      }
      throw error;
    }
    commitRunDepth -= 1;
    // A committed edit repaints through the scheduler's publish; a REFUSED one commits
    // nothing, so the surface still has to refresh the state it just changed. Under input
    // pressure the publish may hand layout+paint to the scheduler's own task — see
    // `publishAfterCommit`.
    publishAfterCommit(rejected !== null, options?.composed?.publish === false);
    return rejected;
  }

  /**
   * Whether every page the CURRENT selection touches has been built.
   *
   * Read from `materializedSet` rather than recomputed: deciding this from the viewport
   * would read `scrollTop`, and forcing a layout on a path that runs for every arrow key is
   * the kind of cost that does not show up until a long document is open. `undefined` means
   * nothing is virtualized and every page is built, which is the safe reading everywhere
   * else too.
   */
  function selectionPagesBuilt(): boolean {
    if (!materializedSet) return true;
    for (const position of [selection.anchor, selection.head]) {
      const caret = caretAt(editingLayout(), position);
      if (caret && !materializedSet.has(caret.pageIndex)) return false;
    }
    return true;
  }

  /**
   * Publish this author's caret to the room.
   *
   * EVERY caret move calls this, an edit's post-edit caret included. Presence used to be
   * published only by the paths that move the caret on purpose — a click, an arrow key,
   * entering a header — and never by a commit, which is how typing moves it. So a remote
   * caret did not lag behind a typing burst, it STOPPED: awareness still held the position
   * of the last click, every keystroke after it published nothing, and the peer painted that
   * stale position for as long as the author kept typing. A remote caret nobody is at is
   * worse than none, so an endpoint this surface cannot address publishes `null` — which
   * withdraws the caret at every peer — rather than leaving the last one standing.
   *
   * Addressing is two node-index lookups, not a document walk (see `paragraph-addresses.ts`),
   * and typing reaches this once per COMMIT, which the type buffer already coalesces.
   */
  function publishLocalCollaborationSelection(): void {
    const collaboration = collaborationSession;
    if (!collaboration) return;
    const next = collaborationPort
      ? localCollaborationSelection(
          cellSelection?.text ?? selection,
          (nodeId) => {
            const part = partOfNodeId(session, nodeId) ?? session.part();
            return collaborationParagraphAt(part, nodeId);
          },
          cellSelection ? 'cells' : undefined
        )
      : null;
    const key = next
      ? `${next.anchor.paragraphId}:${next.anchor.offset}|${next.head.paragraphId}:${next.head.offset}|${next.kind ?? ''}`
      : '';
    if (key === publishedCollaborationSelection) return;
    publishedCollaborationSelection = key;
    collaboration.setLocalSelection(next);
  }

  function setSelection(
    next: SemanticSelection,
    keepDesiredX = false,
    follow: CaretFollowMode = 'caret',
    pointerCaret?: CaretGeometry
  ): void {
    // Compared BEFORE the flush below, which can itself move the caret.
    const moved = !selectionsEqual(next, selection);
    if (
      textboxEditing?.active() &&
      (!textboxEditing.contains(next.anchor.paragraphId) ||
        !textboxEditing.contains(next.head.paragraphId))
    )
      textboxEditing.exit(false);
    // Buffered typing lands at the OLD caret before a MOVE takes effect —
    // typing then clicking must not teleport the typed text to the click. A
    // same-position set (the selection mirror re-adopting the caret it painted,
    // which a browser echoes after every keystroke) is not a move and must not
    // break the batch. A move also ends the typing run, even one that comes back later.
    if (moved) flushTypeBuffer();
    const fieldSelection = textFormInteraction?.beforeSelect(next);
    if (fieldSelection === null) return;
    if (moved) clearPromptBoundary();
    if (moved && !flushingTypeBuffer) {
      typingHistory.end();
      caretFormatHistory.endGroup();
    }
    next = fieldSelection ?? next;
    // Moving the caret discards a stored caret format — Word's rule. Landing back on the
    // exact armed position (the mirror re-adopting the same caret) keeps it.
    reconcilePendingWith(next);
    releaseRetainedIfEscaped(next);
    const previousActive = contentControlAtCaret()?.id ?? null;
    const previousToc = tocAtPosition(session.part(), selection.head)?.id;
    retireActivationPin();
    selection = next;
    followOpenNoteToHead(noteOps, editingLayout(), next, pointerCaret?.pageIndex); // Note follows.
    // Any plain selection cancels a rectangle. A caret placed by a click, a keystroke or an
    // edit is a text selection by definition, and leaving the rectangle behind would keep
    // painting cells that are no longer chosen.
    cellSelection = null;
    if (!keepDesiredX) desiredX = null;
    // THE MIRROR NEEDS NODES TO WRITE INTO, AND AN UNBUILT PAGE HAS NONE.
    //
    // A selection can land on a page virtualization has not built — an outline jump, a
    // search hit, any host driving the caret — and that is precisely the page it lands on,
    // since the reason to move the caret there is that the user is not looking at it yet.
    // The mirror then wrote into nodes that do not exist, which fails silently; the caret
    // stayed where it was, and the next repaint read the STALE DOM selection back and
    // overwrote the navigation entirely. Building the page first is what makes the write
    // land: `visiblePageSet` pins the pages the selection touches, so this paint brings the
    // target into existence wherever it is.
    if (!selectionPagesBuilt()) {
      // The MODEL is the newer of the two until that write lands, so this repaint must not
      // adopt the DOM selection it is about to replace — which is the very stale value the
      // navigation is trying to leave behind.
      selectionSync.noteModelMoved();
      // Held for a `none` caller: this render reaches the follower on its own terms, and a
      // caret on a page nothing has built reads as a page CHANGE — enough to scroll, which
      // is exactly what the press asking for `none` refused.
      if (follow === 'none') caretView.without(() => render(false));
      else render(false);
    }
    // SETTLED, not moved: this mirrors into the DOM on the next line, so the two agree before
    // any render can read them back — including a move raised earlier that no render has
    // carried out. `restoreSelection` raises the flag and only `flushLayout` takes it down, so
    // `undo` on an empty history left it up and disarmed the NEXT repaint, whenever it came.
    selectionSync.noteSelectionSettled();
    selectionSync.notePointerCaret(pointerCaret);
    // CLAIMED: this is the programmatic entry point — a host's `setSelection`, an opened
    // review card, an outline jump. The plain write refuses whenever the browser's selection
    // sits outside these pages, which is exactly the case when the request came from the
    // host's own chrome (a rail card takes focus on mousedown), and the range the caller
    // asked to SHOW then highlighted nothing at all. A pointer or keyboard move already owns
    // the selection, so claiming changes nothing for them. In Chromium this write can
    // also focus the contenteditable; passive remounts must not claim the selection.
    selectionSync.mirrorToDom(true);
    followCaretIntoView(true, follow);
    renderOverlay();
    // A dismissal is dismissed for where the caret WAS; any move re-asks the question, which
    // is how the reader reopens an item — by clicking back into its text.
    dismissedReviewKeys.clear();
    // The caret decides which item is OPEN, so a move re-classifies the bands. The rectangles
    // themselves are cached against the layout and are not recomputed here.
    renderCommentHighlights();
    // Content-control caret chrome is furniture keyed on the active control id. A caret move
    // into / out of a control must rebuild paint without a layout pass.
    const nextActive = contentControlAtCaret()?.id ?? null;
    const nextToc = tocAtPosition(session.part(), selection.head)?.id;
    if (previousActive !== nextActive || previousToc !== nextToc) {
      render(false);
    }
    publishLocalCollaborationSelection();
    options.onChange?.(currentState());
  }

  /**
   * The two-way selection mirror and the IME lane.
   *
   * Created HERE, after the commit path it drives and before the listeners it answers: every
   * function it is handed is a hoisted declaration, and nothing renders until the mount paint
   * at the end of this factory.
   */
  const selectionSync = createSurfaceSelectionSync({
    session,
    storyScope,
    pagesLayer,
    selection: () => selection,
    setSelection: (next) => setSelection(next),
    // The raw take-up, without the mirror or the report `setSelection` performs: the render
    // this runs inside is about to do both.
    adoptSelection: (next) => {
      const fieldSelection = textFormInteraction?.beforeSelect(next);
      if (fieldSelection === null) return;
      next = fieldSelection ?? next;
      if (!selectionsEqual(next, selection)) clearPromptBoundary();
      reconcilePendingWith(next);
      releaseRetainedIfEscaped(next);
      retireActivationPin();
      selection = next;
      followOpenNoteToHead(noteOps, editingLayout(), next);
      desiredX = null;
      caretFollowPending = true;
      // A gesture the queued `selectionchange` had not delivered still MOVED this caret, so
      // the room hears about it here too. The render around this one reports state and
      // repaints; presence is not part of either.
      publishLocalCollaborationSelection();
    },
    commit: (run) => commit(run),
    commitComposed: (run, next, publish) =>
      commit(run, () => (textFormInteraction ? textFormInteraction.beforeSelect(next) : next), {
        composed: { publish },
      }),
    later: (task) => afterNextPaint(timers, fieldScope.wrap(landing.wrap(task))),
    modelTextOf: (id) => paragraphTextOf(partOfNodeId(session, id) ?? session.part(), id),
    insertOwner: () => insertOwnerOf(contentControlAtCaret()),
    compositionUsesTyping: () => typingSelectionPlan().outsidePromptId !== undefined,
    promptLanding: typedLanding,
    // The composition readback writes through the SAME lane as every other edit. Calling the
    // session directly skipped `trackedOps` and `writeRefusal`, so IME text in suggesting
    // mode landed untracked — the reviewer proposing a change was editing the document —
    // and forms protection and content-control locks did not apply to it either.
    applyOps: (ops, mark, scope) => applyOps(ops, mark, undefined, scope),
    hasPendingInput: () => typeBuffer.length > 0,
    replacementOffset: (paragraphId, from, to) =>
      replacementOffset({ paragraphId, offset: from }, { paragraphId, offset: to }),
    render: () => render(),
    flushLayout: () => flushLayout(),
    flushToPaint: () => flushToPaint(),
    updateCaret: () => {
      caret.update();
      syncActiveFieldShading(pagesLayer, collapsedCaretPosition());
    },
    textOf: (paragraphId) => textOf(paragraphId),
    pendingFormatOps: (paragraphId, offset, length, replacing) =>
      consumePendingFormatOps(paragraphId, offset, length, replacing),
    selectionMark: () => selectionMark(),
    now,
    recordSelectionMs: (ms) => {
      lastSelectionMs = ms;
    },
    isGesturing: () => drawingIntent.kind === 'pointer' || (pointer?.dragging() ?? false),
    domSelection: () => (cellSelection ? collapsedAt(cellSelection.text.anchor) : selection),
    holdsCellSelection: () => cellSelection !== null,
    // `surface` is assigned below; a composition can only end once a caller holds it.
    replaceSelectionWith: (text) => surface.type(text),
    discardPaint: () => discardRetainedPaint(pagesLayer),
    // A revision of -1 says "not the model's": the readback then lands the model and rebases.
    paintedText: (paragraphId) => {
      const shown = paintedLayout ?? currentLayout;
      const current = shown === currentLayout && !commitPaintOwed && scheduler.pending() === null;
      // Through the open text box's projection, as `textOf` reads: its story is only there.
      return {
        text: paragraphTextFromLayout(textboxEditing?.layout(shown) ?? shown, paragraphId),
        revision: current ? session.packageRevision() : -1,
      };
    },
    holdPaint: (hold) => {
      heldLayout = hold ? (paintedLayout ?? currentLayout) : null;
    },
  });
  landComposedText = selectionSync.landComposed;

  hfScope = createHeaderFooterScopeController({
    session,
    layout: () => currentLayout,
    sectionAtPage,
    revisionDisplayMode,
    revisionAuthorFilter: revisionFilter,
    selection: () => selection,
    setScopeSelection: (next) => {
      // Entering or leaving a header/footer moves the caret ACROSS STORIES;
      // buffered body keystrokes must land in the body first, not the header.
      flushTypeBuffer();
      retireActivationPin();
      // The rest of what a caret move means, which this second entry point used to skip: an
      // armed typing format belongs to the position it was armed at, and a review card the
      // reader dismissed at one caret is not dismissed at the next. A round trip through a
      // header rearmed Bold on re-entry and left a card that would not reopen.
      reconcilePendingWith(next);
      dismissedReviewKeys.clear();
      selection = next;
      cellSelection = null;
      desiredX = null;
      publishLocalCollaborationSelection();
    },
    noteModelMoved: () => selectionSync.noteModelMoved(),
    render: () => render(),
    mirrorToDom: () => selectionSync.mirrorToDom(),
    notify: () => options.onChange?.(currentState()),
    materializedPages: () => materializedSet,
    entryRefused: () => editingMode === 'view',
    leaveOtherStories: () => {
      noteOps?.exitNote();
      textboxEditing?.exit();
    },
  });

  noteOps = createNoteOps({
    session,
    exitHeaderFooter: () => {
      hfScope?.exitHeaderFooter();
      textboxEditing?.exit();
    },
    applyOps,
    commit,
    selection: () => selection,
    selectionMark: () => selectionMark(),
    orderedStart: () => orderedStart(),
    deleteSelectionPlan: () => deleteSelectionPlan(),
    undo: () => surface.undo(),
    activeScope: () => {
      const frame = textboxEditing?.active();
      if (frame) return frame;
      const note = noteOps?.activeNoteScope();
      if (note) return note;
      return hfScope?.activeScope() ?? { kind: 'body' };
    },
    setActiveScopeBodyOrHf: (scope) => hfScope!.setActiveScope(scope),
    setSelection: (next) => setSelection(next),
    noteModelMoved: () => selectionSync.noteModelMoved(),
    // Flushed first: note ops render right after their own commit, whose pass may have
    // deferred under input pressure — the render must show the note it just created. The
    // publish paints on its own, so the explicit render only covers the nothing-pending case.
    render: () => {
      if (!flushLayout()) render();
    },
    revealNote: (scopeId) => {
      // The note just inserted only exists in the post-commit layout, which the commit
      // may have deferred under input pressure.
      flushLayout();
      for (const page of currentLayout.pages) {
        const note = [...(page.footnotes?.notes ?? []), ...(page.endnotes?.notes ?? [])].find(
          (candidate) => candidate.scopeId === scopeId
        );
        if (!note) continue;
        scrollToContentY(note.box.y, note.box.height, {
          block: 'nearest',
          offsetPx: 48,
        });
        return page.index;
      }
      return null;
    },
    notify: () => options.onChange?.(currentState()),
    lastRejection: () => lastRejection,
    setLastRejection: (reason) => {
      lastRejection = reason === null ? null : refuse(reason);
    },
  });

  function setCellSelection(next: CellSelection | null): void {
    // A rectangle installs its own text selection; queued typing lands at the
    // caret it was typed at first.
    if (next) flushTypeBuffer();
    cellSelection = next;
    if (next) {
      reconcilePendingWith(next.text);
      retireActivationPin();
      selection = next.text;
    }
    desiredX = null;
    // Settled, not moved: the mirror on the next line makes the two agree before any render
    // can read them back — the same reason `setSelection` says so.
    selectionSync.noteSelectionSettled();
    selectionSync.mirrorToDom();
    renderOverlay();
    // A dismissal is dismissed for where the caret WAS; any move re-asks the question, which
    // is how the reader reopens an item — by clicking back into its text.
    dismissedReviewKeys.clear();
    // The caret decides which item is OPEN, so a move re-classes the bands. The rectangles
    // themselves are cached against the layout and are not recomputed here.
    renderCommentHighlights();
    publishLocalCollaborationSelection();
    options.onChange?.(currentState());
  }

  /**
   * Comment bands, computed ONCE per layout and re-classed on a caret move.
   *
   * The rectangles depend only on the layout and the comment ranges, so recomputing them
   * because the caret moved would re-walk the document on every arrow key. What the caret
   * changes is which band is the active one, and that is a class.
   */
  let commentRectCache: {
    layout: SemanticLayout;
    revision: number;
    pages: ReadonlySet<number> | undefined;
    rects: readonly (OverlayRect & { key: string })[];
  } | null = null;

  /**
   * A small window around the caret, for when the real visible set is unknown.
   *
   * Not a guess at what is on screen — a bound. A band outside it is not drawn, and the next
   * paint with a real scroller draws it.
   */
  function caretPageWindow(): ReadonlySet<number> {
    const caret = caretAt(editingLayout(), selection.head);
    const centre = caret?.pageIndex ?? 0;
    const window_ = new Set<number>();
    for (let page = centre - 1; page <= centre + 1; page += 1) {
      if (page >= 0 && page < currentLayout.pages.length) window_.add(page);
    }
    return window_;
  }

  function commentRects(): readonly (OverlayRect & { key: string })[] {
    const revision = session.revision();
    // When the scroller is unknown — before mount, in a hidden container, in a host that is
    // not the packaged viewport — `materializedSet` is undefined, and "measure every band on
    // every page" is 30ms per keystroke on exactly the documents that can least afford it.
    // The caret's page and its neighbours are a bound that is always available.
    const pages = materializedSet ?? caretPageWindow();
    if (
      commentRectCache?.layout === currentLayout &&
      commentRectCache.revision === revision &&
      equalPageSets(commentRectCache.pages, pages)
    ) {
      return commentRectCache.rects;
    }
    // Skip an item that cannot be on screen, before measuring anything about it. The WHOLE
    // range, not its start: testing only the start dropped the band for a comment spanning
    // pages 1–5 the moment page 1 scrolled away. `keyedRangeRects` clips to the visible pages
    // anyway; this is only a pre-filter, and a false keep costs one range's measurement.
    const onScreen = pages ? rangesOnPages(currentLayout, pages) : () => true;
    const ranges: KeyedRange[] = [];
    for (const item of visibleReviewItems()) {
      if (item.kind === 'comment') {
        if (item.range === null) continue;
        if (!onScreen(item.range.start.paragraphId, item.range.end.paragraphId)) continue;
        ranges.push({
          key: reviewItemKey(item),
          from: { paragraphId: item.range.start.paragraphId, offset: item.range.start.offset },
          to: { paragraphId: item.range.end.paragraphId, offset: item.range.end.offset },
        });
        continue;
      }
      // Revisions are measured in the SAME pass and drawn only when active: tracked text
      // already carries an underline, a strike and a margin bar, so banding all of it would
      // repeat what the decoration says and leave a page of edits as one solid wash.
      // Custom-node cards take the same treatment — the chip tint already marks the node
      // persistently, so its band appears only while its card is open.
      const key = reviewItemKey(item);
      const itemRanges = item.kind === 'revision' ? item.ranges : item.range ? [item.range] : [];
      for (const [index, range] of itemRanges.entries()) {
        if (!onScreen(range.start.paragraphId, range.end.paragraphId)) continue;
        ranges.push({
          key: itemRanges.length === 1 ? key : `${key}${RANGE_SUFFIX}${index}`,
          from: { paragraphId: range.start.paragraphId, offset: range.start.offset },
          to: { paragraphId: range.end.paragraphId, offset: range.end.offset },
        });
      }
    }
    const byKey = keyedRangeRectsWithTextboxes(currentLayout, ranges, pages, measurer);
    const rects: (OverlayRect & { key: string })[] = [];
    for (const [key, found] of byKey) for (const rect of found) rects.push({ ...rect, key });
    commentRectCache = { layout: currentLayout, revision, pages, rects };
    return rects;
  }

  /** Which comment the caret is in, so its band reads as the open one. */
  /**
   * The items dismissed at THIS caret position, until the caret next moves.
   *
   * Lives HERE rather than in a host, because the band and the card must agree: the surface
   * paints one and publishes the other, and a copy of this flag on either side of that line
   * is a copy that can disagree.
   *
   * A SET, not one slot. Several cards can cover one position — `w:ins` wrapping `w:del` gives
   * an insertion and a deletion one identical range — and with a single slot closing the open
   * one simply promoted its twin: the reader pressed close, the other card opened, pressed
   * close again, and the first came back. It alternated forever, and the only way out was to
   * move the caret off the change. Closing a card now closes it, and the next one down is
   * offered exactly once.
   */
  const dismissedReviewKeys = new Set<string>();

  /**
   * Revision kinds the caret must not activate — the host rail's own exclusion filter,
   * mirrored here so the band and the visible cards stay one answer. Null means none.
   */
  let reviewActivationExclusions: ReadonlySet<ReviewRevisionKind> | null = null;
  let reviewActivationFormattingKinds: ReadonlySet<string> | undefined;

  /**
   * The item a host opened BY KEY, with the selection that opening it installed.
   *
   * The caret cannot name a card when two cards cover exactly the same characters, and OOXML
   * writes that shape routinely: `w:ins` wrapping `w:del` is content one reviewer added and
   * another struck, and the insertion and the deletion share one identical range. Classifying
   * by position picked whichever the queue listed first, so clicking either card lit up the
   * same one and the other was unreachable.
   *
   * Checked against the LIVE selection AND retired by any selection write that is not
   * activation's own. The value check alone was enough while the pin held a RANGE — no
   * click can reproduce two distinct positions, so a moved caret invalidated it by
   * inspection. A pin holding a CARET is exactly what a click produces, so a reader
   * returning to that offset would revive it, and the pin outranks the caret rule: an
   * ordinary click on the left edge of a nested change reopened the outer card instead of
   * the inner one it should classify to.
   */
  let activatedReview: {
    readonly key: string;
    readonly anchor: SemanticPosition;
    readonly head: SemanticPosition;
  } | null = null;
  /**
   * Set only while {@link activateReview} installs its own caret, so the write below does
   * not retire the pin it was just asked to raise.
   */
  let activationSelectionWrite = false;
  let allowExcludedReviewPin = false;
  /** Any selection the reader (or an edit) moves retires the pin. See {@link activatedReview}. */
  function retireActivationPin(): void {
    if (!activationSelectionWrite) activatedReview = null;
  }

  /** The pinned item, while its own selection is still the live one. */
  function activatedReviewItem(): ReviewItem | null {
    const pin = activatedReview;
    if (!pin || !selection) return null;
    const same = (a: SemanticPosition, b: SemanticPosition): boolean =>
      a.paragraphId === b.paragraphId && a.offset === b.offset;
    if (!same(selection.anchor, pin.anchor) || !same(selection.head, pin.head)) return null;
    const found = visibleReviewItems().find((item) => reviewItemKey(item) === pin.key);
    if (!found || (found.kind === 'custom' && !found.carded)) return null;
    // Explicit activation can inspect a resolved comment. The caret path below still ignores
    // resolved comments, so they never reopen from ordinary document navigation.
    if (
      found.kind === 'revision' &&
      reviewActivationExclusions !== null &&
      reviewActivationExclusions.has(found.revisionKind) &&
      (found.revisionKind !== 'format' ||
        reviewActivationFormattingKinds === undefined ||
        reviewActivationFormattingKinds.has(found.formattingKind ?? '')) &&
      !allowExcludedReviewPin
    ) {
      return null;
    }
    return found;
  }

  function activeReviewAtCaret(): ReviewItem | null {
    // An explicit activation outranks the caret's own reading of where it landed.
    const pinned = activatedReviewItem();
    if (pinned) return resolveReviewThread(pinned);
    if (!selection) return null;
    // An empty queue still builds the order index. NOT gated: the index's `partFor` reads are
    // what durably open the note stores on first render, and skipping them moved paraId
    // minting into the first note edit — where undo can no longer unwind it to opening bytes
    // (`story-parity-scope-transitions.test.ts`). The retention above makes the build a
    // once-per-structural-change cost rather than a per-keystroke one, which is the part that
    // was worth having.
    // The covering items, innermost first, minus the one the reader dismissed. Returning
    // null for a dismissed innermost item hid every item under it too: dismissing a comment
    // that wraps a revision meant the revision could never become active either.
    // A range selection activates only what it shares characters with (see the helper).
    const covering = reviewItemsAtSelection(
      visibleReviewItems(),
      selection.anchor,
      selection.head,
      reviewOrderIndex()
    ).filter(
      (item) =>
        !(item.kind === 'comment' && item.resolved) &&
        !dismissedReviewKeys.has(reviewItemKey(item)) &&
        // A custom node with no `reviewCard` has no card, so it never becomes the active one.
        !(item.kind === 'custom' && !item.carded) &&
        // Kinds the host's rail hides must not become active from a click: the band
        // would light a card nothing on screen renders (see the contract note on
        // `setReviewActivationExclusions`).
        !(
          item.kind === 'revision' &&
          reviewActivationExclusions !== null &&
          reviewActivationExclusions.has(item.revisionKind) &&
          (item.revisionKind !== 'format' ||
            reviewActivationFormattingKinds === undefined ||
            reviewActivationFormattingKinds.has(item.formattingKind ?? ''))
        )
    );
    const found = covering[0];
    if (!found) return null;
    return resolveReviewThread(found);
  }

  /**
   * A REPLY resolves to the card it renders inside — the comment it answers, or the tracked
   * change it answers. It has no card of its own, so returning it opened an item nothing on
   * screen was drawing: the reply box vanished from the very thing that had just been replied
   * to. Comment threads survived that by accident (the parent comes first in `comments.xml`
   * order and won the tie); a revision does not, because a comment outranks one outright at
   * equal width.
   *
   * Shared by the caret path and the pinned one: a host can activate a reply's key too, and
   * resolving it in only one of the two would have opened a card nothing draws.
   */
  function resolveReviewThread(found: ReviewItem): ReviewItem | null {
    if (found.kind !== 'comment') return found;
    const root = reviewThreadRootOf(visibleReviewItems(), found);
    // A root the reader DISMISSED takes its whole thread with it. Falling back to the reply
    // here painted the band active over a card that is not drawn — a reply renders inside its
    // root, so dismissing the root leaves nothing on screen to be active — and the reader who
    // closed the card watched the text stay highlighted as though it were still open.
    return dismissedReviewKeys.has(reviewItemKey(root)) ? null : root;
  }

  function visibleReviewItems(): readonly ReviewItem[] {
    return revisionAuthorVisibility.filterItems(session.reviewItems());
  }

  // Both presence-colour answers, and why they rank differently: see the module.
  const presenceColors = createPresenceColors({
    roster: reviewAuthors.get,
    styles: () => revisionStyles,
    slots: stableAuthorSlots,
  });
  const remotePresenceColor = presenceColors.forAuthor;
  const declaredPresenceColor = presenceColors.declaredFor;

  let commentHighlightLayout: SemanticLayout | null = null;
  let commentHighlightActiveKey: string | undefined;
  let commentHighlightAuthors: ReadonlyMap<string, ReviewAuthorInfo> | null = null;

  function renderCommentHighlights(force = false): void {
    const active = activeReviewAtCaret();
    // A replacement the review UI shows as one card lights both halves while either is open.
    const openKey = active && reviewItemKey(active);
    const activeKeys = litReviewKeys(visibleReviewItems, openKey, options.pairsReplacements?.());
    const activeKey = [...activeKeys].join('\n');
    // The roster is part of what these bands DRAW, so it belongs in what decides they can be
    // left alone. A full `render` forces this layer anyway, which is how a live colour change
    // reaches it today — but the unforced callers below (activation, exclusions) would happily
    // reuse bands resolved against a roster that had moved underneath them.
    const roster = reviewAuthors.get();
    if (
      !force &&
      commentHighlightLayout === currentLayout &&
      commentHighlightActiveKey === activeKey &&
      commentHighlightAuthors === roster.resolved
    ) {
      return;
    }
    // Once per paint, not once per rect: a decision spanning many lines asked the same
    // question for every one of them.
    const byKey = reviewItemsByKey(visibleReviewItems());
    const bands: OverlayRect[] = [];
    for (const rect of commentRects()) {
      const className = bandClassFor(rect.key, activeKeys, byKey);
      if (!className) continue;
      // WHOSE band, for CSS to key on. The rect's key is suffixed per range for a revision
      // covering several sites, so the author comes from the decision, as the class does.
      const decision = rect.key.split(RANGE_SUFFIX)[0]!;
      const item = byKey.get(decision);
      const name = item ? reviewItemAuthor(item) : null;
      const reviewAuthor = name === null || name === '' ? undefined : roster.resolved.get(name);
      // The author's own active background, on the OPEN revision's band only. The active
      // test repeats the class's — the decision, not the site — so a multi-range decision
      // tints every range it covers, and a comment band never takes a revision field.
      const activeBackground =
        item?.kind === 'revision' && activeKeys.has(decision)
          ? reviewAuthor?.style?.activeBackground
          : undefined;
      bands.push({
        ...rect,
        className,
        ...(reviewAuthor ? { reviewAuthor } : {}),
        ...(activeBackground !== undefined ? { activeBackground } : {}),
      });
    }
    paintSelectionOverlay(commentLayer, currentLayout, bands, {
      scale,
      ...(materializedExtent ? { pageOffsetX: materializedExtent.pageOffsetX } : {}),
    });
    commentHighlightLayout = currentLayout;
    commentHighlightActiveKey = activeKey;
    commentHighlightAuthors = roster.resolved;
  }

  /** Draw selected cells, retained text, or paragraph marks native selection cannot show. */
  function renderOverlay(): void {
    textFormInteraction?.update();
    tableSelectHandle?.update();
    const rects = cellSelection
      ? cellSelectionRects(currentLayout, cellSelection.cellIds)
      : retainedSelection
        ? selectionRects(editingLayout(), retainedSelection, paragraphOrder(), measurer)
        : surfaceSelectionMarkRects(editingLayout(), selection, paragraphOrder, measurer);
    paintSelectionOverlay(
      overlayLayer,
      currentLayout,
      rects,
      // Pages of differing width are centred individually, so the overlay has to carry the
      // same per-page offset the painter applied or a highlight in a landscape section would
      // sit beside the cells it describes.
      {
        scale,
        pageOffsetX: materializedExtent?.pageOffsetX,
        ...(cellSelection
          ? {}
          : {
              className: retainedSelection
                ? 'docx-retained-selection-rect'
                : 'docx-selection-mark-rect',
            }),
      }
    );
  }

  /** One rendered frame for an overlay painter, with the page painter's scale and offsets. */
  function overlayFrame(layer: HTMLElement): SurfaceOverlayFrame {
    return {
      layer,
      layout: currentLayout,
      revision: session.packageRevision(),
      scale,
      measurer,
      ...(materializedSet ? { pages: materializedSet } : {}),
      ...(materializedExtent ? { pageOffsetX: materializedExtent.pageOffsetX } : {}),
    };
  }

  function paintHighlights(): void {
    highlightPainter?.(overlayFrame(highlightLayer));
  }

  /** Draw ephemeral remote selections from semantic layout geometry. */
  function renderRemoteSelections(): void {
    if (!remoteSelectionRenderingReady) {
      remoteSelectionLayer.replaceChildren();
      return;
    }
    const collaboration = collaborationSession;
    if (!collaboration) {
      remoteSelectionLayer.replaceChildren();
      return;
    }
    // Drawn from `currentLayout`, which the held page does not show: the end paints it.
    if (heldLayout !== null && currentLayout !== heldLayout) return;
    paintRemoteSelections(remoteSelectionLayer, currentLayout, collaboration.remoteSelections(), {
      scale,
      pageOffsetX: materializedExtent?.pageOffsetX,
      ...(materializedSet ? { pages: materializedSet } : {}),
      // The review roster's answer, resolved per painted author. The painter folds what
      // this returns into its memo key, so a roster move repaints presence on the next
      // pass without a second invalidation channel.
      colorForAuthor: remotePresenceColor,
      declaredColorFor: declaredPresenceColor,
      labelHost: remoteCaretLabelHost,
      measurer,
    });
  }

  function targetToc(tocId?: string) {
    const tocs = detectBodyTocs(session.part());
    if (tocId) return tocs.find((toc) => toc.id === tocId) ?? null;
    // The right-click target first: a menu row carries no id, and in a document with two
    // tables of contents the caret cannot disambiguate them — it is never inside either.
    const pointed = contextTocId ? tocs.find((toc) => toc.id === contextTocId) : undefined;
    if (pointed) return pointed;
    const paragraphId = selection.head.paragraphId;
    return (
      tocs.find(
        (toc) =>
          toc.beginParagraphId === paragraphId ||
          toc.endParagraphId === paragraphId ||
          toc.resultParagraphIds.includes(paragraphId)
      ) ?? (tocs.length === 1 ? tocs[0]! : null)
    );
  }

  function selectionTouchesToc(): boolean {
    return selectionTouchesTocRange(session.part(), selection);
  }

  function opTouchesToc(op: TreeDocOp): boolean {
    return opTouchesTocRange(session.part(), op);
  }

  function tocParagraphIds(): ReadonlySet<string> {
    return new Set(
      detectBodyTocs(session.part()).flatMap((toc) => [
        toc.beginParagraphId,
        ...toc.resultParagraphIds,
        toc.endParagraphId,
      ])
    );
  }

  /** Every paragraph one TOC owns. Re-read per pass: a replace mints new result ids. */
  function tocRegionOf(toc: DetectedToc): ReadonlySet<string> {
    return new Set([toc.beginParagraphId, toc.endParagraphId, ...toc.resultParagraphIds]);
  }

  /** Painted lines the TOC regions occupy, which bounds the caret's escape from one. */
  function tocRegionLineCount(paragraphIds: ReadonlySet<string>): number {
    let lines = 0;
    for (const page of currentLayout.pages) {
      for (const fragment of paragraphFragmentsOf(page)) {
        if (paragraphIds.has(fragment.paragraphId)) lines += fragment.lines.length;
      }
    }
    return lines;
  }

  function pageNumbersFor(
    layout: SemanticLayout,
    paragraphIds: readonly string[]
  ): ReadonlyMap<string, string> {
    // A heading that opens with a page break starts on the page its text is painted on.
    const result = new Map<string, string>();
    for (const [id, page] of paragraphStartPages(layout.pages, new Set(paragraphIds))) {
      const source = page.pageFieldSource;
      result.set(id, formatPageNumber(source?.pageNumber ?? page.index + 1, source?.format));
    }
    return result;
  }

  const { canRefreshToc, pointAtToc, removal } = createTocCommands({
    session,
    editingMode: () => editingMode,
    target: targetToc,
    writeRefusal: (ops) => writeRefusal(true, ops, false),
    apply: (ops, before) => applyJournaledOps(ops, before, undefined, BODY_STORY),
    removed: () => setContextTocId(null),
    select: (at) => setSelection(collapsedAt(at)),
    pointedTocId: () => contextTocId,
    refuse: (reason, raw) => void (lastRejection = refuse(reason, raw)),
  });

  /**
   * The op behind Insert › Table, or null when the size is not one this engine authors.
   *
   * Column width is the caret SECTION's content width divided evenly, not the document's:
   * in a mixed-orientation document the table is about to live on the caret's page, and a
   * grid sized for another section's width is a table that overhangs its own margin.
   */
  function insertTableOp(rows: number, cols: number) {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) return null;
    const section = structure.sectionPropertiesAt(selection.head.paragraphId);
    const contentWidth =
      section.pageSize.widthTwips -
      section.margins.leftTwips -
      section.margins.rightTwips -
      section.margins.gutterTwips;
    // A section whose margins swallow the page still gets a usable table rather than a
    // refusal: the floor is the same minimum a column resize may drag to.
    const columnWidthTwips = Math.max(
      MIN_TABLE_COLUMN_WIDTH_TWIPS,
      Math.floor(contentWidth / cols)
    );
    return {
      op: 'insertTable' as const,
      beforeParagraphId: selection.head.paragraphId,
      rows,
      cols,
      columnWidthTwips,
    };
  }

  function canInsertTable(rows: number, cols: number): boolean {
    if (textboxEditing?.active()) return false;
    if (editingMode === 'view' || !session.editable) return false;
    const op = insertTableOp(rows, cols);
    // Validated against the part the CARET is in, the same part `applyOps` will write to.
    // Against the body part, a caret in a header named a paragraph that part has never heard
    // of, so the op was refused as `unknown-paragraph` before it was ever applied — and the
    // refusal reached the toolbar as a message about where tables may go.
    const part = session.partFor(storyScope()) ?? session.part();
    return op !== null && validateTreeOp(part, op) === null;
  }

  function insertTable(rows: number, cols: number): boolean {
    if (!canInsertTable(rows, cols)) return false;
    const op = insertTableOp(rows, cols);
    if (!op) return false;
    // The op publishes the first cell's paragraph as its caret hint, and that hint is the
    // whole point of the gesture — Word leaves you typing in cell one. Adopting it needs the
    // committed-caret subscription, the same way a table command plan does: without it the
    // pre-edit selection mark is restored and the caret stays in the anchor paragraph
    // BELOW the new table.
    let committedCaret: { readonly paragraphId: string; readonly start: number } | null = null;
    const unsubscribe = session.subscribe((change) => {
      if (change.caret) committedCaret = change.caret;
    });
    let committed = false;
    try {
      commit(
        () => {
          const applied = applyOps([op], selectionMark());
          if (!applied.committed) {
            lastRejection = refuse(
              applied.reason ?? 'the table could not be inserted here',
              applied.reason ?? 'table-insert-refused'
            );
          }
          committed = applied.committed;
          return applied;
        },
        () => {
          const caret = committedCaret;
          return caret
            ? collapsedAt({ paragraphId: caret.paragraphId, offset: caret.start })
            : null;
        }
      );
    } finally {
      unsubscribe();
    }
    return committed;
  }

  const INSERT_TOC_INSTRUCTION = 'TOC \\o "1-3" \\h';

  function insertTocOp() {
    const instruction = parseTocInstruction(INSERT_TOC_INSTRUCTION);
    if (!instruction) return null;
    const outline = session.documentOutline();
    const plan = planTocEntries(
      session.part(),
      outline,
      instruction,
      pageNumbersFor(
        surface.layout(),
        outline.map((entry) => entry.blockId)
      ),
      tocParagraphIds(),
      // Planning runs BEFORE the transaction, so no ambient actor is bound yet. Passed
      // explicitly, the `_Toc` names two peers mint concurrently land in separate stripes
      // instead of colliding on one name that then anchors both hyperlinks.
      collaborationSession?.identity.actorId
    );
    return {
      op: 'insertToc' as const,
      beforeParagraphId: selection.head.paragraphId,
      instruction: INSERT_TOC_INSTRUCTION,
      alias: tocLabels?.title ?? 'TOC',
      entries: plan.entries,
      bookmarksToCreate: plan.bookmarksToCreate,
    };
  }

  function canInsertToc(): boolean {
    if (editingMode === 'view' || !session.editable || selectionTouchesToc()) return false;
    const op = insertTocOp();
    return op !== null && validateTreeOp(session.part(), op) === null;
  }

  function insertToc(): boolean {
    if (!canInsertToc()) return false;
    const op = insertTocOp();
    if (!op) return false;
    const existing = new Set(detectBodyTocs(session.part()).map((toc) => toc.id));
    const inserted = applyJournaledOps([op], selectionMark(), undefined, BODY_STORY);
    if (!inserted.committed) {
      lastRejection = refuse(
        inserted.reason ?? 'the table of contents could not be inserted',
        inserted.reason ?? 'table-of-contents-refused'
      );
      return false;
    }
    const created = detectBodyTocs(session.part()).find((toc) => !existing.has(toc.id));
    return created ? refreshToc(created.id, 'pageNumbers') : true;
  }

  function refreshToc(tocId?: string, mode: 'entire' | 'pageNumbers' = 'entire'): boolean {
    let toc = targetToc(tocId);
    if (!toc || !canRefreshToc(toc.id)) return false;
    completeProgressiveOpen(surface); // Page numbers read the whole pagination.
    let layout = surface.layout();
    const outline = session.documentOutline();
    const sources = resolveTocSources(session.part(), outline, toc.instruction);
    if (!sources) return false;
    const outlineBlockIds = sources.map((entry) => entry.blockId);
    const before = pointAtToc(toc);

    if (mode === 'entire') {
      const plan = planTocEntries(
        session.part(),
        outline,
        toc.instruction,
        pageNumbersFor(layout, outlineBlockIds),
        tocRegionOf(toc),
        collaborationSession?.identity.actorId
      );
      const replaced = applyJournaledOps(
        [
          {
            op: 'replaceTocResult',
            tocId: toc.id,
            entries: plan.entries,
            bookmarksToCreate: plan.bookmarksToCreate,
          },
        ],
        before,
        undefined,
        BODY_STORY
      );
      if (!replaced.committed) {
        lastRejection = refuse(
          replaced.reason ?? 'the table of contents could not be refreshed',
          replaced.reason ?? 'table-of-contents-refused'
        );
        return false;
      }
      layout = surface.layout();
      toc = targetToc(toc.id);
      if (!toc) return true;
    }

    let previousSignature = '';
    for (let pass = 0; pass < TOC_MAX_PAGE_PASSES; pass += 1) {
      const numbers = pageNumbersFor(layout, outlineBlockIds);
      // Each row is rewritten from the heading IT names, read from the row's own anchor or
      // title. Pairing rows with plan entries by POSITION looks equivalent right after a full
      // replace and is wrong everywhere else: one heading added or removed since the cache was
      // written shifts every page number by one, silently, which is the exact state that
      // "update page numbers only" exists to repair.
      const headings = resolveTocRowHeadings(session.part(), toc, outline, tocRegionOf(toc));
      const updates = toc.resultParagraphIds.flatMap((paragraphId, index) => {
        const headingId = headings[index];
        const pageNumberText = headingId ? numbers.get(headingId) : undefined;
        return pageNumberText === undefined ? [] : [{ paragraphId, pageNumberText }];
      });
      if (updates.length === 0) break;
      const signature = updates
        .map((update) => `${update.paragraphId}\u0000${update.pageNumberText}`)
        .join('\u0001');
      if (signature === previousSignature) break;
      previousSignature = signature;
      const rewritten = applyJournaledOps(
        [{ op: 'rewriteTocPageNumbers', tocId: toc.id, updates }],
        before,
        undefined,
        BODY_STORY
      );
      if (!rewritten.committed) {
        if (rewritten.rejected) {
          lastRejection = refuse(
            rewritten.reason ?? 'the table of contents page numbers were refused',
            rewritten.reason ?? 'table-of-contents-refused'
          );
          return false;
        }
        break;
      }
      layout = surface.layout();
      toc = targetToc(toc.id) ?? toc;
    }

    return true;
  }

  /**
   * Rewrite stale REF field results in the body and note stories, so a save exports what
   * the pages paint. Planning is read-only — the note parts are read from the package,
   * never through `partFor`, which would durably open a notes store — so a document whose
   * results are already fresh commits no transaction, bumps no revision and adds no undo
   * entry. Every stale story commits together as ONE transaction and ONE undo unit
   * (`applyTreeOpsAtomic`): a refusal anywhere rolls the whole refresh back, so the saved
   * file can never mix refreshed and stale values, and a single undo restores the exact
   * pre-save document. Viewing and a non-editable session write nothing.
   *
   * COLLABORATIVE SESSIONS SKIP THE REFRESH: the collaboration gate admits only body
   * insert/delete text ops, so the rewrite cannot journal to peers. The save then exports
   * the cached results (the pre-refresh behavior; Word refreshes fields on open), and the
   * `false` return says so rather than claiming freshness.
   */
  function refreshRefFieldResults(): boolean {
    completeProgressiveOpen(surface); // PAGEREF results read the whole pagination.
    return refreshSurfaceRefFieldResults({
      session,
      editingMode,
      collaborationActive: collaborationSession !== undefined,
      reviewerFilterActive: revisionAuthorVisibility.filterForSession(session) !== undefined,
      layout: surface.layout(),
      canonicalUnfilteredLayout: canonicalUnfilteredLayoutForSave,
      styleCascade: styleCascade(),
      numberingIndex: numberingIndex(),
      displayMode: revisionDisplayMode(),
    });
  }

  // Which range a destructive or replacing gesture acts on, and where content replacing it
  // lands once a tracked strike has had its say. Wired ABOVE the surface object on purpose:
  // `createHeaderFooterOps` and `createImageOps` below take `deleteSelectionOps`,
  // `orderedStart` and `selectionMark` BY REFERENCE, eagerly, so these bindings have to
  // exist by the time that object literal is evaluated.
  const {
    selectionMark,
    orderedRange,
    orderedStart,
    textOf,
    atomicControlDeletion,
    selectionOverPrompts,
    promptIsSelected,
    splitEndsTheParagraph,
    deleteSelectionPlan,
    typingSelectionPlan,
    retainPromptBoundary,
    clearPromptBoundary,
    promptBoundary,
    deleteSelectionOps,
    deleteRangePlan,
    replacementOffset,
  } = createSurfaceRangeEditOps({
    session,
    layout: editingLayout,
    selection: () => selection,
    cellSelection: () => cellSelection,
    editingMode: () => editingMode,
    author: () => author,
    trackedDate: revisionDateNow,
    storyScope,
    paragraphOrder,
    flushPendingInputAndLayout,
    trackedAuthorOrNone,
    atParagraphEnd: (paragraphId, offset) => nextStyle.atParagraphEnd(paragraphId, offset),
    revisionView,
  });

  // Clipboard glue over the payload builder and the paste router. Also above the surface
  // object: `insertPlainText` is handed to `createBeforeInputHandler` by reference.
  const { insertPlainText, copyFlavoursNow, pasteRichNow, armForcePlainPaste } =
    createSurfaceClipboardOps({
      session,
      textFormFieldId: () => textFormInteraction?.fieldId() ?? null,
      typingSelectionPlan,
      retainPromptBoundary,
      insertOwner: () => insertOwnerOf(contentControlAtCaret()),
      richPasteAllowed: () => !textboxEditing?.active(),
      paragraphIds: editingParagraphIds,
      layout: editingLayout,
      cellSelection: () => cellSelection,
      editingMode: () => editingMode,
      storyScope,
      paragraphOrder,
      actorId: () => collaborationSession?.identity.actorId,
      collaborationGate: (ops, scope) => collaborationSession?.gateOperations(ops, scope) ?? null,
      now,
      flushPendingInputAndLayout,
      orderedRange,
      selectionMark,
      deleteSelectionPlan,
      consumePendingFormatOps,
      withoutPendingOnRejection,
      caretMark,
      suggestion: () => {
        const writer = trackedAuthorOrNone();
        return writer === undefined ? undefined : { author: writer, date: revisionDateNow() };
      },
      trackedOps,
      trackedChangeLanded: () => runtimeOptions.onTrackedChange?.(),
      revisionDisplayMode,
      commit,
      selectedDrawing: () => resolveSelectedDrawingRecord(surface),
      selectPastedDrawing: (id, paragraphId) => selectPastedDrawing(surface, id, paragraphId),
    });

  function applyRevisionAuthorVisibility(moved: boolean): void {
    if (!moved) return;
    notePropertiesCache = null;
    flushPendingInputAndLayout();
    furnitureSource = createCurrentFurnitureSource(revisionFilter());
    scheduler.invalidateAll(session.packageRevision(), 'tracked-change-filter');
    scheduler.flush();
    options.onChange?.(currentState());
  }

  let destroyed = false;
  const surface: ScaleMutableSurface = {
    session,
    // The internal gated write — see the `ScaleMutableSurface` note. The content-control
    // commands wrote `session.applyTreeOps` directly, which skipped the collaboration gate
    // and actor binding every other lane goes through.
    applyGatedTreeOps: (ops, before, after, scope) =>
      applyJournaledOps(ops, before, after, scope ?? storyScope()),
    storyScope,
    imageDecodePort: () => decodePort,
    textMeasurer: () => measurer,
    // Flushes first: a commit made straight on the session — undo, or another editor
    // sharing the store — must not leave a caller reading geometry for a revision the model
    // has left behind. Nothing pending makes this a plain read.
    layout: () => {
      flushPendingInputAndLayout();
      return currentLayout;
    },
    state: currentState,
    currentPage: (mode = 'caret') => {
      flushPendingInputAndLayout();
      if (mode === 'viewport') {
        const page = viewportPage(container, currentLayout, scale);
        if (page !== null) return page;
      }
      // An open header or footer repeats on every page it heads: the caret is on the open one.
      const furniture = hfScope?.getActive();
      if (furniture) return furniture.pageIndex + 1;
      const caret = caretAt(editingLayout(), selection.head);
      return caret ? caret.pageIndex + 1 : 1;
    },

    automationWriteRefusal: (ops, edits) =>
      writeRefusal(ops.some(isDocumentEdit) || edits, ops, false),
    setScale(nextScale) {
      if (!(nextScale > 0) || !Number.isFinite(nextScale)) return false;
      if (nextScale === scale) return true;

      const previous = { scale, defaults, measurer, producer, furnitureSource };

      // TOTAL by construction: a zoom click gets an answer, never an exception. Everything a
      // rescale touches — the anchor read, the measurer resolution, layout, paint — is inside
      // the guard, and the rollback carries its own.
      try {
        const scroller = surfaceScroller(container);
        // Preserve the viewport centre in layout coordinates across the reflow.
        const anchor = scroller
          ? {
              x: viewportCentreX(container, scroller, scale),
              y: (scroller.scrollTop - container.offsetTop + scroller.clientHeight / 2) / scale,
            }
          : null;
        scale = nextScale;
        if (!options.measurer) {
          defaults = defaultMeasurer();
          measurer = faceUsage.wrap(defaults.measurer);
        }
        producer = producerIdentity();
        furnitureSource = createCurrentFurnitureSource(revisionFilter());
        materializedSet = undefined;
        materializedExtent = undefined;
        commentRectCache = null;
        scheduler.invalidateAll(session.packageRevision(), 'zoom');
        scheduler.flush();
        payOwedPaint();
        if (scroller && anchor) {
          const targetTop = Math.max(
            0,
            anchor.y * scale + container.offsetTop - scroller.clientHeight / 2
          );
          const maxTop = Number.isFinite(scroller.scrollHeight)
            ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
            : null;
          centreViewportOn(container, scroller, anchor.x, scale);
          scroller.scrollTop = maxTop === null ? targetTop : Math.min(targetTop, maxTop);
          // The paint above chose its pages for the scroll offset the viewport had BEFORE the
          // restore. Building the destination band here keeps the zoom to one turn; leaving it
          // to the scroll listener showed the user shells for a frame.
          rematerialize();
        }
        return true;
      } catch {
        ({ scale, defaults, measurer, producer, furnitureSource } = previous);
        materializedSet = undefined;
        materializedExtent = undefined;
        commentRectCache = null;
        // NESTED, because the rollback lays out too: whatever failed the rescale can fail the
        // recovery, and the caller still has to be told "no". The previous paint stands, and
        // the next commit or scroll repaints it.
        try {
          scheduler.invalidateAll(session.packageRevision(), 'zoom-rollback');
          scheduler.flush();
        } catch {
          /* nothing left to try; the answer below is the whole contract */
        }
        return false;
      }
    },

    enqueueType,
    flushPendingInput: flushPendingInputAndLayout,

    type(text) {
      // Insert at the selection's START, not at its head. Deleting a selection removes the
      // range beginning at the start, so inserting at the head — which may be the far end —
      // puts the text where the removed characters used to be rather than where the user
      // was typing.
      const plan = typingSelectionPlan();
      // In SUGGESTING the deletion keeps the characters it strikes, so the replacement goes
      // after them — only then are the two halves adjacent, which is what lets the pane
      // fold them into one `Replaced "x" with "y"` card. The plan's `replaceAt` owns that
      // rule for every replacing lane, including where the range spans paragraph marks.
      const target = plan.replaceAt ?? plan.collapseTo;
      // Consume the stored caret format (armed only at a collapsed caret, so it cannot
      // coexist with the delete ops below): the typed range gets the caret run's own
      // properties plus the armed ones, in the SAME transaction — one undo step.
      const pendingOps = consumePendingFormatOps(target.paragraphId, target.offset, text.length);
      // The caret's own control OWNS the insert: at a control's trailing edge the store's
      // default lands beside it (right for a link), but Word keeps typing inside a control.
      const inside =
        !plan.outsidePromptId && plan.ops.length === 0
          ? insertOwnerOf(contentControlAtCaret())
          : undefined;
      const insertion = typedInsertText(target, text, inside);
      const insertOps: TreeDocOp[] = [
        ...plan.ops,
        plan.outsidePromptId && insertion.op === 'insertText'
          ? { ...insertion, bias: 'left' }
          : insertion,
      ];
      // Typing at a prompt's edge replaces the prompt, so the text lands where the prompt
      // began; a caret counted from the pressed offset sat past the paragraph's new end.
      const landing = typedLanding(target.paragraphId, target.offset, text.length);
      const redoMark = { paragraphId: target.paragraphId, start: landing, end: landing };
      // Letters in a right-to-left script start a `w:rtl` run, joined to the caret format.
      const formatOps = typedDirectionOps(target, landing, text, pendingOps);
      commit(
        () =>
          withoutPendingOnRejection(
            [...insertOps, ...formatOps],
            insertOps,
            selectionMark(),
            redoMark
          ),
        () => {
          retainPromptBoundary(plan.outsidePromptId);
          return collapsedAt({ paragraphId: target.paragraphId, offset: landing });
        }
      );
    },
    proposeTextChange: (kind, text, author) => commitProposedTextChange(kind, text, author),
    replaceTextInPlace,

    // The newline-aware sibling of `type`, declared below in this same scope. On the
    // contract because text arriving from OUTSIDE the editor — a paste from the clipboard,
    // whether the browser's own event delivered it or a menu row did — is not a lane the
    // input handlers should own privately.
    pointAt: (x, y) =>
      surface.activeScope().kind === 'frame' ? null : (pointer?.pointAt(x, y) ?? null),
    insertPlainText: (text: string) => insertPlainText(text),

    deleteBackward() {
      const tableDeletion = wholeTableDeletionPlan(editingLayout(), cellSelection, editingMode);
      if (tableDeletion) return void surface.applyTableCommandPlan(tableDeletion);
      if (textFormInteraction?.selectForDeletion('backward')) return;
      if (deleteAtomicControl('backward')) return;
      const plan = deleteSelectionPlan();
      if (plan.ops.length > 0) {
        commit(
          () => applyOps(plan.ops, selectionMark(), caretMark(plan.collapseTo)),
          () => collapsedAt(plan.collapseTo)
        );
        return;
      }
      if (removeCaretParagraph('backward')) return;
      // Word keeps the typing format across Backspace: bold armed at a caret survives
      // deleting the character before it, re-anchored where the caret lands.
      const armed = armedAtCaret() ?? undefined;
      const position = hiddenMarks.shown(selection.head);
      if (position.offset === 0) {
        // Backspace at the start of a paragraph pulls it into the previous one. Refusing
        // here made the key look broken: a caret at the paragraph start is where a user
        // presses Backspace precisely because they want the paragraphs merged.
        // A break the reader cannot SEE is not a break they can delete. In a resolved display
        // mode a tracked paragraph mark is already merged away on the page, so Backspace at
        // the start of a later member takes the character before it — the one under the
        // caret's left edge — instead of joining two paragraphs and carrying a mark revision
        // onto a paragraph nobody edited.
        for (const member of mergedPredecessorsOf(editingLayout(), position.paragraphId)) {
          const text = textOf(member);
          if (text.length === 0) continue;
          commit(
            () =>
              applyOps(
                [
                  {
                    op: 'deleteText',
                    paragraphId: member,
                    start: text.length - 1,
                    end: text.length,
                  },
                ],
                selectionMark(),
                caretMark({ paragraphId: member, offset: text.length - 1 })
              ),
            () => collapsedAt({ paragraphId: member, offset: text.length - 1 }),
            { rearmPending: armed }
          );
          return;
        }
        // Number first, then indent: Backspace reaches the paragraph break only after both.
        if (surface.removeListNumber(position.paragraphId)) return;
        if (surface.removeParagraphIndent(position.paragraphId)) return;
        const order = withinOpenNote(editingLayout(), noteScopeId(), paragraphOrder()); // Not past it.
        const index = order.indexOf(position.paragraphId);
        const previous = order[index - 1];
        if (!previous) return;
        // ONLY A SIBLING CAN BE JOINED. Document order walks straight into the last cell of a
        // table, so Backspace at the start of the paragraph after one built a join the store
        // is guaranteed to refuse — the key did nothing AND left `not-adjacent-siblings` on
        // the surface, where a host that surfaces refusals reported an error for an ordinary
        // Backspace. Word moves the caret into the last cell instead; doing nothing is the
        // half of that this lane can honestly promise.
        const joins = hiddenMarks.joinOps(previous, position.paragraphId);
        if (!joins) {
          setSelection(collapsedAt({ paragraphId: previous, offset: textOf(previous).length }));
          return;
        }
        const joinAt = textOf(previous).length;
        commit(
          () =>
            applyOps(joins, selectionMark(), caretMark({ paragraphId: previous, offset: joinAt })),
          () => collapsedAt({ paragraphId: previous, offset: joinAt }),
          { rearmPending: armed }
        );
        return;
      }
      commit(
        () =>
          applyOps(
            [
              {
                op: 'deleteText',
                paragraphId: position.paragraphId,
                start: position.offset - 1,
                end: position.offset,
              },
            ],
            selectionMark(),
            caretMark({ ...position, offset: position.offset - 1 })
          ),
        () => collapsedAt({ ...position, offset: position.offset - 1 }),
        { rearmPending: armed }
      );
    },

    splitParagraph() {
      // Enter REPLACES a selection, like every other insertion — splitting at the head left
      // the selected text in place and cut the paragraph at whichever end the user happened
      // to drag to. `replaceAt` puts the break AFTER the words a suggestion strikes, so the
      // strike and the proposed break read as one decision instead of two.
      const plan = deleteSelectionPlan();
      const position = plan.replaceAt ?? plan.collapseTo;
      // Enter carries the caret run's direct formatting even when no toolbar command is
      // armed (select text, resize it, then place the caret after it). An empty tail has
      // no run to inherit from. Capture authored properties only, so a heading's inherited
      // size does not override the following paragraph's style.
      const armed = armedAtCaret() ?? {
        properties: authoredRunPropertiesAt(
          partOfNodeId(session, position.paragraphId) ?? session.part(),
          position.paragraphId,
          position.offset,
          revisionDisplayMode(),
          revisionFilter()
        ),
        base: [],
      };
      // Word's `w:next`: Enter at the END of a paragraph starts one in the style that
      // paragraph's style names as its follower, which is what stops a heading from being
      // followed by a second heading.
      const endsParagraph = splitEndsTheParagraph(position);
      const tailStyleId = endsParagraph
        ? nextStyle.followerStyleId(position.paragraphId)
        : undefined;
      // Persist the insertion face on the marks of an end split. Stored marks alone
      // disappear on a click away and cannot give the empty tail its line height.
      // Only direct properties are copied, leaving the follower style free to inherit.
      const markProperties = mergedRunWrite(
        armed.base,
        armed.properties,
        complexScriptAtCaret(position.paragraphId, position.offset)
      );
      const markOps: TreeDocOp[] =
        endsParagraph && editingMode === 'edit' && markProperties.length > 0
          ? [
              {
                op: 'setParagraphMarkProperties',
                paragraphId: position.paragraphId,
                properties: markProperties,
              },
            ]
          : [];
      const splitOp: TreeDocOp = {
        op: 'splitParagraph',
        paragraphId: position.paragraphId,
        offset: position.offset,
        tailStyleId,
      };
      const separatorAuthor = trackedAuthorOrNone();
      const separatorRevision = separatorAuthor
        ? { author: separatorAuthor, date: revisionDateNow() }
        : undefined;
      const separatorStyles = session.documentStyles();
      const existingSeparatorStyle = listParagraphStyleId(separatorStyles);
      let separatorStyleId = existingSeparatorStyle ?? 'ListParagraph';
      const usedStyleIds = new Set(separatorStyles.map((style) => style.styleId));
      for (
        let suffix = 1;
        !existingSeparatorStyle && usedStyleIds.has(separatorStyleId);
        suffix++
      ) {
        separatorStyleId = `ListParagraph${suffix}`;
      }
      const separator =
        editingMode !== 'view' &&
        plan.ops.every((op) => op.op === 'deleteText' && op.paragraphId === position.paragraphId) &&
        tailStyleId === undefined
          ? listSeparatorEnter(
              partOfNodeId(session, position.paragraphId) ?? session.part(),
              currentLayout,
              position,
              markProperties,
              separatorStyleId,
              styleCascade(),
              separatorRevision,
              collaborationSession?.identity.actorId
            )
          : null;
      // Fragment insertion restores the head's properties from its first mark. Reapply
      // the captured face there; the tail already inherited it from the leading mark op.
      const separatorMarkOps: TreeDocOp[] = separatorRevision
        ? [
            {
              op: 'setParagraphMarkRevision',
              paragraphId: position.paragraphId,
              kind: 'ins',
              revision: separatorRevision,
            },
          ]
        : [];
      const insertionOps = separator ? [separator, ...markOps, ...separatorMarkOps] : [splitOp];
      const before = separator ? new Set(editingParagraphIds()) : null;
      withSplitSelection(
        session,
        position.paragraphId,
        (splitSelection) =>
          commit(
            () =>
              withoutPendingOnRejection(
                [...plan.ops, ...markOps, ...insertionOps],
                [...plan.ops, ...(separator ? [separator, ...separatorMarkOps] : [splitOp])],
                selectionMark(),
                undefined,
                separator && !existingSeparatorStyle
                  ? [
                      ensureSeparatorStyle(
                        styleCascade()?.defaultParagraphStyleId ?? null,
                        separatorStyleId
                      ),
                    ]
                  : undefined
              ),
            () => {
              if (!before) return splitSelection();
              const created = editingParagraphIds().filter((id) => !before.has(id));
              const tail = separator ? created.at(-1) : created[0];
              return tail ? collapsedAt({ paragraphId: tail, offset: 0 }) : null;
            },
            { rearmPending: armed }
          ),
        splitTailNow
      );
    },

    navigate(command, extend = false) {
      if (command === 'documentEnd') completeProgressiveOpen(surface); // The real end.
      // Arrow keys move from the caret AFTER the typed text, over the layout
      // that includes it.
      flushPendingInputAndLayout();
      if (
        !extend &&
        (command === 'left' || command === 'right') &&
        (selection.anchor.paragraphId !== selection.head.paragraphId ||
          selection.anchor.offset !== selection.head.offset)
      ) {
        // Collapse to the selected edge without taking another navigation step.
        const range = orderedRange();
        desiredX = null;
        const target = collapseSelection(
          editingLayout(),
          range,
          paragraphOrder(),
          command,
          measurer
        );
        setSelection(collapsedAt(target), true);
        return;
      }
      const layout = editingLayout();
      let moved = navigateInActiveScope(
        layout,
        hiddenMarks.shown(selection.head),
        command,
        desiredX,
        hfScope?.getActive() ?? null,
        noteScopeId(),
        measurer,
        selectionSync.selectionLineId()
      );
      if (!moved) return;
      const tocIds = tocParagraphIds();
      const outside = tocEscapePosition(
        session.part(),
        moved.position,
        ['left', 'wordLeft', 'lineStart', 'up', 'pageUp'].includes(command)
      );
      // The escape lands elsewhere, so the motion's caret (and its page) no longer applies.
      if (outside) moved = { ...moved, position: outside, caret: undefined };
      // Atomic navigation: a caret that landed INSIDE a locked inline control crosses it (or
      // takes its nearer edge) — for a Shift motion too, so the head selects the control whole
      // and Shift in the opposite direction shrinks it back to the anchor.
      if (atomicNavigation) {
        const crossed = leaveAtomicControl(layout, selection.head, moved.position);
        if (crossed !== moved.position) moved = { ...moved, position: crossed, caret: undefined };
      }
      if (tocAtPosition(session.part(), moved.position)) {
        if (extend) return;
        const backwards = new Set<NavigationCommand>([
          'left',
          'wordLeft',
          'lineStart',
          'up',
          'pageUp',
        ]);
        // The escape steps by LINE, never by character. A character step inside a row that
        // has any text at all lands in the same paragraph, and the loop's own "we did not
        // change paragraph" bail then fired on the first iteration: the caret could neither
        // enter the region nor cross it, so everything past a table of contents was
        // unreachable from the keyboard. A line step always leaves the row it starts on.
        const escape: NavigationCommand = backwards.has(command) ? 'up' : 'down';
        // One iteration per line the region occupies, plus slack for the landing line. The
        // loop breaks the moment it is outside, so an over-generous bound costs nothing.
        const limit = tocRegionLineCount(tocIds) + 4;
        for (let step = 0; step < limit; step += 1) {
          const next = navigateInActiveScope(
            editingLayout(),
            moved.position,
            escape,
            moved.desiredX,
            hfScope?.getActive() ?? null,
            noteScopeId(),
            measurer
          );
          // Only a position that does not move at all is a dead end. Comparing paragraph ids
          // alone treats ordinary movement within a row as one.
          if (
            !next ||
            (next.position.paragraphId === moved.position.paragraphId &&
              next.position.offset === moved.position.offset)
          ) {
            return;
          }
          moved = next;
          if (!tocAtPosition(session.part(), moved.position)) break;
        }
        if (tocAtPosition(session.part(), moved.position)) return;
      }
      desiredX = moved.desiredX;
      // Note continuations share one EditorScope across pages: retarget the visual
      // occurrence before selection/caret paint so the DOM host follows geometry.
      if (
        noteOps?.activeNoteScope() &&
        moved.pageIndex !== undefined &&
        Number.isInteger(moved.pageIndex)
      ) {
        noteOps.setActiveNotePageIndex(moved.pageIndex);
      }
      const anchor = extend ? hiddenMarks.shown(selection.anchor) : moved.position;
      const target = { anchor, head: moved.position };
      // A prompt is one unit for the caret, as in Word: arrowing into it selects the whole
      // prompt rather than parking the caret inside text the first keystroke replaces, which
      // left the buffered keystrokes after it aimed past the end of the shortened paragraph.
      // `head` for EVERY navigation, extending or not. The end the reader is moving has to
      // stay visible, and the mirror cannot paint a selection whose head sits on a page
      // virtualization never built — a shift-extended jump showed nothing selected at all
      // until the view followed it. A plain move is collapsed, where `head` and `caret` mean
      // the same thing, EXCEPT when it lands on a prompt and ABSORBS it: that is a range the
      // reader never dragged, so it is revealed by its start, where the next keystroke goes.
      // An extended range takes a locked control whole, even from an anchor a host placed inside
      // it; a plain move absorbs only prompts, as `leaveAtomicControl` already moved it out.
      const next =
        extend && !atomicNavigation
          ? target
          : absorbAtomicControls(layout, target, { atomic: extend && atomicNavigation });
      const absorbed = !extend && !selectionsEqual(next, target);
      const before = selection;
      setSelection(next, true, absorbed ? 'none' : 'head', absorbed ? undefined : moved.caret);
      // Landed, like every other reveal here: a form field holding an invalid value refuses
      // the write and pins the caret where the reader has to fix it.
      if (absorbed && (selection !== before || selectionsEqual(selection, next))) {
        revealTravelledTo(selection.anchor);
      }
    },

    deleteWordBackward: () => wordDeletion.deleteWord('backward'),
    deleteWordForward: () => wordDeletion.deleteWord('forward'),

    deleteForward() {
      if (textFormInteraction?.selectForDeletion('forward')) return;
      if (deleteAtomicControl('forward')) return;
      if (surface.deleteSelection() || removeCaretParagraph('forward')) return;
      // Delete keeps the typing format like Backspace does — the caret does not move, so
      // the armed format re-anchors in place.
      const armed = armedAtCaret() ?? undefined;
      const position = hiddenMarks.shown(selection.head);
      const text = textOf(position.paragraphId);
      if (position.offset < text.length) {
        commit(
          () =>
            applyOps(
              [
                {
                  op: 'deleteText',
                  paragraphId: position.paragraphId,
                  start: position.offset,
                  end: position.offset + 1,
                },
              ],
              selectionMark()
            ),
          undefined,
          { rearmPending: armed }
        );
        return;
      }
      // At the end of a paragraph, Delete pulls the NEXT one up — the mirror of Backspace at
      // offset zero, and the reason a document can be flattened without reaching for a mouse.
      if (paragraphOrder().at(-1) === position.paragraphId) completeProgressiveOpen(surface); // Its successor needs the rest of a large open laid out.
      const order = withinOpenNote(editingLayout(), noteScopeId(), paragraphOrder()); // Not past it.
      const next = order[order.indexOf(position.paragraphId) + 1];
      if (!next) return;
      // Unless the break is one a resolved view already merged away. The reader sees one
      // paragraph, so Delete takes the next CHARACTER, exactly as Backspace does at the other
      // side of the same invisible break — joining here would resolve a tracked decision the
      // keypress never named, and take the paragraph after it as well.
      if (mergedPredecessorsOf(editingLayout(), next).includes(position.paragraphId)) {
        const following = textOf(next);
        if (following.length === 0) return;
        commit(
          () =>
            applyOps([{ op: 'deleteText', paragraphId: next, start: 0, end: 1 }], selectionMark()),
          () => collapsedAt(position),
          { rearmPending: armed }
        );
        return;
      }
      commit(
        () =>
          applyOps(
            hiddenMarks.forwardJoinOps(position.paragraphId, next) ?? [
              { op: 'joinParagraphs', firstId: position.paragraphId, secondId: next },
            ],
            selectionMark()
          ),
        () => collapsedAt(position),
        { rearmPending: armed }
      );
    },

    ...structure,
    ...format,

    setSelection: (next) => {
      clearPromptBoundary();
      // An explicit host write that MOVES the caret is an intentional selection — a test or
      // an automation host addressing a drawing's anchor means the drawing. A same-position
      // write stays inert: the font-load remount restores the saved caret through here
      // during a plain open, and that restore must not select a drawing the user never did
      // (the carried initialDrawingSelectionIntent already preserves a real one).
      if (!selectionsEqual(next, selection)) setDrawingIntent({ kind: 'programmatic' }, false);
      remoteCaret.discard();
      setSelection(next);
    },

    selectDrawing(drawingNodeId, hostParagraphId) {
      flushLayout();
      const at = drawingSelectionPosition(currentLayout, drawingNodeId, hostParagraphId);
      if (!at) return false;
      const next = collapsedAt(at);
      setDrawingIntent({ kind: 'pointer', drawingNodeId }, selectionsEqual(next, selection));
      setSelection(next, true, 'none');
      documentSelectionHistory.noteSelectionAfterEdit();
      return resolveSelectedDrawingRecord(surface)?.drawingNodeId === drawingNodeId;
    },

    selectDrawingMember: (memberNodeId) =>
      memberIntent(session, drawingIntent, memberNodeId, (next) => setDrawingIntent(next, true)),

    revealPage(pageIndex, options) {
      // Flushed like its siblings below: a page the deferred pass creates is not findable
      // in the superseded layout, and "false" must mean "no such page", not "not yet".
      beginReveal();
      const page = currentLayout.pages.find((entry) => entry.index === pageIndex);
      if (!page && laterOnOpening(pageIndex, () => surface.revealPage(pageIndex, options)))
        return true;
      return page ? scrollToContentY(page.box.y, page.box.height, options) : false;
    },

    revealParagraph(paragraphId, options) {
      beginReveal();
      // The paragraph's own line, not the top of its page, and its text, not a leading page
      // break at the bottom of the page before: the heading is what the caller asked to see.
      const start = pastLeadingBreaks(editingLayout().pages, { paragraphId, offset: 0 });
      const caret = caretAt(editingLayout(), start);
      if (!caret && laterOnOpening(start, () => surface.revealParagraph(paragraphId, options)))
        return true;
      if (!caret) return false;
      const page = currentLayout.pages.find((entry) => entry.index === caret.pageIndex);
      if (!page) return false;
      // `contentBox`, not `box`: caret geometry is CONTENT-BOX relative — the painter parents
      // the caret into `.docx-page-content`, which starts one top margin down the sheet.
      // Against `box.y` every reveal undershot by exactly that margin (72pt on a 1" page), so
      // the target landed just under the fold and the reader had to scroll to see what they
      // had just jumped to.
      return scrollToContentY(page.contentBox.y + caret.y, caret.height, options);
    },

    revealPosition(position, options) {
      beginReveal();
      const caret = caretAt(editingLayout(), position);
      if (!caret && laterOnOpening(position, () => surface.revealPosition(position, options)))
        return true;
      if (!caret) return false;
      const page = currentLayout.pages.find((entry) => entry.index === caret.pageIndex);
      if (!page) return false;
      // 'nearest' by default; a header, footer or note line measures from its own story box.
      const y = storyContentBox(page, position.paragraphId).y + caret.y;
      return scrollToContentY(y, caret.height, { block: 'nearest', ...options });
    },

    setEditable(editable) {
      // The DOM affordance, not the document's own editability: `session.editable` says
      // whether the FILE can be round-tripped, and this says whether the user may type into
      // it right now. Both have to be true for an edit to land.
      hostEditable = editable;
      if (!editable) drop?.clear();
      if (!editable) textboxEditing?.exit();
      applyEditableChrome();
    },

    selectAll() {
      completeProgressiveOpen(surface); // The order below reads the whole layout.
      const ids = paragraphOrder();
      const first = ids[0];
      const last = ids[ids.length - 1];
      if (!first || !last) return;
      setSelection({
        anchor: { paragraphId: first, offset: 0 },
        head: { paragraphId: last, offset: textOf(last).length },
      });
    },

    hyperlinks,
    equations,
    contentControls: contentControlsOps,
    formatPainter,
    canInsertTable,
    insertTable,
    canInsertToc,
    insertToc,
    canRefreshToc,
    canEditTextFormField: () => textFormInteraction?.canEdit() ?? false,
    editTextFormField: () => textFormInteraction?.edit() ?? false,
    refreshToc,
    ...removal,
    refreshRefFieldResults,
    save: () => saveSurfaceDocument(surface, container, () => destroyed),
    saveSteps: () => saveSurfaceDocumentSteps(surface, container, () => destroyed),
    isInsideToc: (paragraphId) => paragraphInBodyToc(session.part(), paragraphId),
    retainSelection: () => {
      const pin = Symbol('selection-pin');
      retainedSelections.set(pin, selection);
      retainedSelection = selection;
      renderOverlay();
      return pin;
    },
    releaseSelection: (pin) => {
      if (!retainedSelections.delete(pin)) return;
      restoreLatestRetainedSelection();
      renderOverlay();
    },
    retainedSelection: () => retainedSelection,

    publishedLayout: () => currentLayout,

    drawingSelectionIntent: () => drawingIntent,

    overlayCoordinates: () =>
      Object.freeze({
        paintScale: scale,
        pageOffsetX: materializedExtent?.pageOffsetX ?? new Map<number, number>(),
      }),

    commitReviewOps: (run, intent) => {
      // The text the caret's paragraph held BEFORE the resolution, so the caret can be mapped
      // across what Accept or Reject removed. Clamping alone only fires when the paragraph
      // ends up shorter than the offset; a caret in the MIDDLE of a paragraph that shrank
      // silently re-points at different characters, and the next thing typed lands there.
      // The baseline is read from the LAYOUT, so buffered typing and a deferred pass must
      // land first or the diff runs against text the resolution never saw.
      flushPendingInputAndLayout();
      const caretParagraph = selection.head.paragraphId;
      const beforeText = textOf(caretParagraph);
      // No caret follow: a review write does not move the reader, even when the caret sits
      // off screen at an item a host opened with `reveal: false`.
      let refusal: string | null = null;
      withoutCaretFollow(() => {
        refusal = commit(
          // Reported as a RESULT, not a boolean: `commit` reads the refusal reason off it, and
          // a boolean made every refused accept clear `lastRejection` instead of setting it.
          () => {
            // Resolving a revision or writing a comment is a WRITE, so viewing refuses it here
            // too. These paths reach the store through the session directly rather than
            // through `applyOps`, so the lane gate above never sees them.
            if (editingMode === 'view') {
              return { committed: false, rejected: true, opCount: 0, reason: VIEWING_REFUSAL };
            }
            if (
              collaborationSession &&
              (intent === undefined || !REPLICABLE_REVIEW_WRITES.has(intent))
            ) {
              return {
                committed: false,
                rejected: true,
                opCount: 0,
                reason: 'experimental-collaboration-body-text-only',
              };
            }
            // The READINESS gate the typing lane asks (`applyJournaledOps`). Review writes
            // reach the store past `applyOps`, so without this a disconnected replica still
            // committed a comment locally and never replicated it. The ops are opaque here —
            // the callback builds them — so the gate sees an empty batch: its readiness and
            // attachment ladder still answers, which is the half this lane was missing.
            if (collaborationSession) {
              const collaborationRefusal = collaborationSession.gateOperations([], storyScope());
              if (collaborationRefusal) {
                return {
                  committed: false,
                  rejected: true,
                  opCount: 0,
                  reason: collaborationRefusal,
                };
              }
            }
            // Bound to the collaboration actor: review writes mint comment and content-control
            // ids outside `applyOps`, so nothing else would bind one. Two peers commenting on
            // the same snapshot would otherwise both take `w:id="${highest + 1}"`.
            const actor = collaborationSession?.identity.actorId;
            const result = runWithTransactionActor(actor, () => run(commitHistoryGroup.value));
            const reason = typeof result.reason === 'string' ? { reason: result.reason } : {};
            const ok = result.committed;
            return { committed: ok, rejected: !ok, opCount: 0, ...reason };
          },
          () => {
            // The layout is FLUSHED first, because the clamp needs post-edit lengths and this
            // thunk runs before the repaint. Resolving a revision can remove the very characters
            // the caret was in; an offset left past the end refuses every keystroke that follows
            // it, which is what made the document look frozen after an Accept.
            flushLayout();
            // Raise the flag AGAIN. It is one-shot, `commit` raised it before this thunk ran,
            // and the flush above consumed it — so the render that follows read the stale DOM
            // selection back over the clamp and the caret jumped to the paragraph start.
            selectionSync.noteModelMoved();
            // Clamped within the story the READER is in, for the reason `applyAutomationOps`
            // states below: the body's paragraph list is the wrong ruler while a header or a
            // note is open, and clamping to it moved the caret into the document while the
            // scope stayed on the furniture — after which every keystroke was refused as
            // `unknown-paragraph`. Accepting a header card is exactly that situation.
            const order = paragraphOrder();
            if (order.length === 0) return null;
            const mapped = mapSelectionAcrossText(
              selection,
              caretParagraph,
              beforeText,
              textOf(caretParagraph)
            );
            return clampedToDocument(editingLayout(), order, mapped);
          }
        );
      });
      return refusal;
    },

    revisionDisplayMode: reviewDisplayMode,
    replacementLanding,
    applyAutomationOps: (staged, scope, packageEdits, requiresReview = false, carry) => {
      // Automation shares edit gates and repainting but retains its capture policy.
      // Its explicit story remains independent of the reader's active story.
      let result: ReturnType<TreeDocxSession['applyTreeOps']> | null = null;
      const story = scope ?? BODY_STORY;
      const refusal = commit(
        () => {
          // THE GATE BEFORE THE OPS EXIST. Building them mints the relationship an external
          // hyperlink names, which changes the PACKAGE — outside the transaction, outside the undo
          // stack, and left behind by a refusal. Viewing is asked first, so a document open for
          // reading comes out of this byte-identical; `edits: false` keeps the question to the rule
          // that holds for every op, because a batch of tracked-change DECISIONS is not an edit and
          // `applyOps` below judges it on its own ops.
          const viewing = writeRefusal(false);
          if (viewing !== null) {
            return (result = { committed: false, rejected: true, opCount: 0, reason: viewing });
          }
          // The mint carries the edit rule with it: it IS an edit, so a mode that would refuse one
          // must refuse it, and refusing here means the relationship is never written.
          let refused: string | null = null;
          const ops = staged((url) => {
            const refusal = writeRefusal(true, [], false);
            // Bound to the collaboration actor for the same reason the mint is called out above:
            // it lands on the package outside the transaction, so nothing else would bind one, and
            // two peers linking at once would otherwise agree on `rId${max + 1}`.
            if (refusal === null) {
              return runWithTransactionActor(collaborationSession?.identity.actorId, () =>
                session.ensureHyperlinkRelationship(url, story)
              );
            }
            refused = refusal;
            return null;
          });
          if (ops === null) {
            return (result = {
              committed: false,
              rejected: true,
              opCount: 0,
              reason: refused ?? 'this engine will not author that hyperlink target',
            });
          }
          if (!options.reviewModel && (requiresReview || ops.some(isTrackedEdit))) {
            return (result = {
              committed: false,
              rejected: true,
              opCount: 0,
              reason: 'review-module-required',
            });
          }
          return (result = applyOps(ops, undefined, undefined, story, false, packageEdits));
        },
        () => {
          // Flushed before the clamp for the same reason `commitReviewOps` does it: the clamp
          // needs post-edit lengths, and this thunk runs before the repaint.
          flushLayout();
          selectionSync.noteModelMoved();
          // Clamped within the story the READER is in, which is not necessarily the story that
          // was just written. Clamping against the body's paragraphs while a header or a
          // footnote was open moved the caret into the document while the scope stayed on the
          // furniture, and the next keystroke — applied to the furniture story with a body
          // paragraph id — was refused as `unknown-paragraph`: the reader typed and nothing
          // happened. An empty order means the story is not painted yet; leaving the caret
          // alone is right there, because a clamp with nothing to clamp to is a caret reset.
          const order = paragraphOrder();
          if (order.length === 0) return null;
          return clampedToDocument(editingLayout(), order, carry?.(selection) ?? selection);
        },
        { automation: true }
      );
      // Null only when the refresh guard skipped the commit before the thunk ran.
      const reason = refusal ?? UNEXPLAINED_WRITE_REFUSAL;
      return result ?? { committed: false, rejected: true, opCount: 0, reason };
    },

    editingMode: () => editingMode,
    author: () => author,
    setAuthor: (nextAuthor) => {
      if (author === nextAuthor) return;
      flushTypeBuffer();
      author = nextAuthor;
      if (nextAuthor?.trim() && isMissingAuthorRefusal(lastRejection)) {
        lastRejection = null;
        options.onChange?.(currentState());
      }
    },
    setDrawingStrings: (strings) => {
      if (drawingStrings === strings) return;
      if (drawingPaintStringsCacheToken(drawingStrings) === drawingPaintStringsCacheToken(strings))
        return;
      drawingStrings = strings;
      flushPendingInputAndLayout();
      render(false);
    },
    setLocale: dateLocale.set,
    setTranslate: (next) => {
      if (translate === next) return;
      translate = next;
      applySurfaceStrings(pagesLayer, next);
      textFormInteraction?.update();
      const nextBreakStrings = breakMarkStringsFromTranslate(next);
      const labelsMoved =
        breakMarkStringsCacheToken(nextBreakStrings) !==
        breakMarkStringsCacheToken(breakMarkStrings);
      breakMarkStrings = nextBreakStrings;
      // Break labels paint only with paragraph marks; hidden ones repaint on the next toggle.
      if (labelsMoved && paragraphMarks.get()) {
        flushPendingInputAndLayout();
        render(false);
      }
    },
    setTocLabels: (labels) => {
      tocLabels = labels;
    },
    setEditingMode: (mode) => {
      // Text typed under the OLD mode commits under it — a buffered edit must
      // not silently become a suggestion (or a viewing-mode refusal). The layout
      // flush rides along so the mode repaint below is not one commit behind.
      flushPendingInputAndLayout();
      // A host wiring a mode control re-sends the value it already has — a controlled prop
      // re-synced in an effect, a dropdown re-picking the current row. Repainting every
      // materialized page for a mode that did not move is the cost `setRevisionStyles`
      // guards against for the same reason. The notify below still runs: a caller asking
      // for a mode is entitled to hear the state back.
      const moved = editingMode !== mode;
      editingMode = mode;
      if (moved) drop?.clear();
      // Viewing has no furniture EDITING scope. Switching while a header was open left the
      // body dimmed and inert under an active band and its whole options bar — a write UI
      // over a document that now refuses writes. Exiting repaints, so this runs first.
      // Suggesting keeps the box open: its typing is tracked like any other story's.
      if (moved && mode === 'view') textboxEditing?.exit();
      if (moved && mode === 'view') hfScope?.exitHeaderFooter();
      if (moved && mode === 'view') noteOps?.exitNote();
      // An armed format painter is a write surface too, and a more misleading one: the pages
      // keep the paint cursor and every release goes on building ops the session then
      // refuses. Released rather than left standing, so the affordance and the answer agree.
      if (moved && mode === 'view') formatPainter.disarm();
      // An open widget menu is a WRITE surface: a date picker left standing across the
      // switch still offered a value the new mode refuses. Nothing else closes it.
      removeExistingContentControlMenu();
      applyEditableChrome();
      // A mode change moves no content, so nothing else here repaints. The chrome class
      // still has to follow immediately: without this the blank header/footer band kept
      // inviting a double-click to add a story that viewing mode then refused.
      setEditingModeChrome(container, editingMode);
      // Painted chrome reads the mode too — content-control widgets disable themselves on
      // it, and table furniture re-derives from it — so the pages have to be rebuilt even
      // though not one character moved.
      if (moved) render(false);
      // The old refusal described the old mode. Left standing, a host rendering it showed
      // "the document is open for viewing" over a document that had just become editable.
      lastRejection = null;
      options.onChange?.(currentState());
    },

    revisionAuthors: () => reviewAuthors.get().value,
    setRevisionDisplayMode(mode) {
      if (destroyed || mode === reviewView.view()) return;
      flushPendingInputAndLayout();
      reviewView.set(mode);
      applyRevisionAuthorVisibility(true);
    },
    hiddenRevisionAuthors: () => revisionAuthorVisibility.hiddenAuthors,
    setRevisionAuthorVisible(author, visible) {
      applyRevisionAuthorVisibility(revisionAuthorVisibility.setVisible(author, visible));
    },
    setAllRevisionAuthorsVisible(visible) {
      applyRevisionAuthorVisibility(
        revisionAuthorVisibility.setAllVisible(reviewAuthors.get().value.keys(), visible)
      );
    },
    showAllRevisionAuthors() {
      applyRevisionAuthorVisibility(revisionAuthorVisibility.showAll());
    },
    setTrackedChangesFilter(predicate, mode) {
      applyRevisionAuthorVisibility(revisionAuthorVisibility.setPredicate(predicate, mode));
    },
    collaborationSession: () => collaborationSession ?? null,
    remotePresenceColor,
    setShowParagraphMarks: paragraphMarks.set,
    setRevisionMarkup: markupSettings.set,
    setUnsupportedElementRules: (rules) => {
      const projection = createUnsupportedElementProjection(validateUnsupportedElementRules(rules));
      projection.view(session).currentPackage();
      unsupportedProjection.view(session).currentPackage();
      const geometryUnchanged = projection.geometryKey() === unsupportedProjection.geometryKey();
      if (geometryUnchanged) {
        const paintChanged = projection.includePartial !== unsupportedProjection.includePartial;
        unsupportedProjection = projection;
        furnitureSource = createCurrentFurnitureSource(revisionFilter());
        if (paintChanged) render(false);
        return;
      }
      flushPendingInputAndLayout();
      unsupportedProjection = projection;
      furnitureSource = createCurrentFurnitureSource(revisionFilter());
      scheduler.invalidateAll(session.packageRevision(), 'unsupported-content');
      scheduler.flush();
      options.onChange?.(currentState());
    },
    setRevisionStyles: (colors) => {
      if (colors === revisionStyles) return;
      revisionStyles = colors;
      // Commit buffered input before adopting a pending DOM selection.
      flushPendingInputAndLayout();
      render(false);
    },

    setHighlightPainter(painter) {
      highlightPainter = painter;
      if (!painter) highlightLayer.replaceChildren();
      paintHighlights();
    },
    repaintHighlights: paintHighlights,

    setRemoteCaretLabelHost: (host) => {
      if (host === remoteCaretLabelHost) return;
      remoteCaretLabelHost = host;
      // Registration and unregistration both repaint: the first publish must fire without
      // waiting for awareness to move, and clearing the host restores the default name
      // labels. The painter keys its memo on the host's identity, so this is a rebuild,
      // never a skip — and a skipped paint later never re-publishes.
      renderRemoteSelections();
    },

    setReviewActivationExclusions(kinds, exclusionsOptions) {
      reviewActivationFormattingKinds = exclusionsOptions?.formattingKinds
        ? new Set(exclusionsOptions.formattingKinds)
        : undefined;
      reviewActivationExclusions = kinds === null ? null : new Set(kinds);
      // The active answer may have just changed with no caret move: repaint the bands and
      // tell the host, exactly as dismissing does.
      renderCommentHighlights();
      options.onChange?.(currentState());
    },

    caretClientRect: () => {
      flushLayout();
      return caret.clientRect();
    },
    remoteSelectionPending: () => remoteCaret.pending(),
    activeReviewKey: () => {
      const active = activeReviewAtCaret();
      return active ? reviewItemKey(active) : null;
    },
    activateReview: (key, next, activationOptions) => {
      // Reopening a card the reader dismissed has to clear the dismissal: activation can leave
      // the caret exactly where it already was, so nothing else would take it down and the card
      // would refuse to reopen however many times it was clicked.
      dismissedReviewKeys.clear();
      // The pin goes up BEFORE the selection is published, which is why the selection comes
      // through here rather than in a `setSelection` of the caller's own. Installed the other
      // way round, `setSelection` repainted the bands and fired `onChange` while the caret was
      // still the only evidence — so a host saw the WRONG twin reported active for one frame
      // and then a correction. One publish, one answer.
      allowExcludedReviewPin = activationOptions?.allowExcluded ?? false;
      activatedReview = next
        ? { key, anchor: next.anchor, head: next.head }
        : { key, anchor: selection.anchor, head: selection.head };
      if (next) {
        const install = (): void => {
          activationSelectionWrite = true;
          try {
            setSelection(next, false, activationOptions?.preventScroll ? 'none' : 'caret');
          } finally {
            activationSelectionWrite = false;
          }
        };
        // HELD for the whole write: the paint that builds an unbuilt destination page follows
        // on its own terms, and a nudge owed by earlier typing scrolls on the next repaint.
        if (activationOptions?.preventScroll) withoutCaretFollow(install);
        else install();
        return;
      }
      renderCommentHighlights();
      options.onChange?.(currentState());
    },
    /** The card {@link activateReview} pinned, while its own selection is still live. */
    activatedReviewKey: () =>
      activatedReviewItem() === null ? null : (activatedReview?.key ?? null),
    dismissActiveReview: () => {
      const active = activeReviewAtCaret();
      if (!active) return;
      dismissedReviewKeys.add(reviewItemKey(active));
      // The pin outranks the caret, so leaving it up meant a dismissed card reopened itself
      // on the very next read.
      activatedReview = null;
      renderCommentHighlights();
      options.onChange?.(currentState());
    },

    navigation,
    bookmarkEditing: bookmarks,

    bookmarks: () => session.bookmarks(),

    selectedText() {
      // A rectangle copies as a grid — tabs between cells, newlines between rows — because
      // the text range it stands in for would paste back as one run with the grid gone.
      // Each computed field reads as its painted result, not its one model unit.
      if (cellSelection) return cellsPlainText(currentLayout, cellSelection);
      const { from, to } = orderedRange();
      return rangePlainText(editingLayout(), from, to, paragraphOrder());
    },

    // Copy and cut hold the whole prompt the selection holds part of.
    copyFlavours: () => {
      const grown = selectionOverPrompts();
      if (grown) setSelection(grown);
      return copyFlavoursNow();
    },
    pasteRich: (text: string, html: string | null) => pasteRichNow(text, html),
    armForcePlainPaste,

    deleteSelection() {
      // A range that covers a content-locked control removes it, for every deleting lane.
      const ranged = !selectionsEqual(selection, collapsedAt(selection.head));
      if (ranged && deleteAtomicControl('backward')) return true;
      const plan = deleteSelectionPlan();
      if (plan.ops.length === 0) return false;
      commit(
        () => applyOps(plan.ops, selectionMark(), caretMark(plan.collapseTo)),
        () => collapsedAt(plan.collapseTo)
      );
      return true;
    },

    setCellSelection,
    layoutSession: () => layoutSession,

    undo: () => {
      // Undo is a WRITE. It reached the session directly, so a document the toolbar called
      // read-only silently rewound under the reader's hands — the one lane that walked past
      // `applyOps`, `applyPmDoc` and `commitReviewOps` alike.
      if (editingMode === 'view' || refreshWriteBlocked(container)) {
        lastRejection = refuse(VIEWING_REFUSAL);
        options.onChange?.(currentState());
        return;
      }
      // Batched typing becomes its own undo step BEFORE the rewind, so undo
      // first removes what was just typed rather than skipping past it.
      flushTypeBuffer();
      typingHistory.end();
      collaborationSession?.flushPendingJournals();
      caretFormatHistory.step('undo', restoreCaretFormat, () => moveDocumentHistory('undo'));
    },
    redo: () => {
      if (editingMode === 'view' || refreshWriteBlocked(container)) {
        lastRejection = refuse(VIEWING_REFUSAL);
        options.onChange?.(currentState());
        return;
      }
      flushTypeBuffer();
      typingHistory.end();
      collaborationSession?.flushPendingJournals();
      caretFormatHistory.step('redo', restoreCaretFormat, () => moveDocumentHistory('redo'));
    },
    sectionAtPage,
    activeScope: () => {
      const frame = textboxEditing?.active();
      if (frame) return frame;
      const note = noteOps?.activeNoteScope();
      if (note) return note;
      return hfScope!.activeScope();
    },
    setActiveScope: (scope: ViewScope) => {
      // Buffered typing belongs to the story it was typed in: it must land
      // BEFORE the active scope flips. A flush after the flip commits the burst
      // into the wrong story, or gets refused and silently drops it. Scope
      // entry resolves geometry from the layout, so a deferred pass lands too.
      flushPendingInputAndLayout();
      if (scope.kind === 'frame') return textboxEditing!.enter(scope);
      if (scope.kind !== 'body' && scope.kind !== 'headerFooter' && scope.kind !== 'note')
        return false;
      textboxEditing?.exit();
      if (scope.kind === 'note') return noteOps!.enterNote(scope.id);
      noteOps?.exitNote();
      return hfScope!.setActiveScope(scope);
    },
    insertNote: (noteKind) => {
      // Inserting a note ENTERS its story; same scope-flip rule as setActiveScope.
      flushPendingInputAndLayout();
      return noteOps!.insertNote(noteKind);
    },
    deleteNote: (noteKind, noteId) => noteOps!.deleteNote(noteKind, noteId),
    convertNote: (fromKind, noteId) => noteOps!.convertNote(fromKind, noteId),
    convertAllNotes: (fromKind) => noteOps!.convertAllNotes(fromKind),
    setNoteProperties: (args) => noteOps!.setNoteProperties(args),
    enterNote: (scopeId, position) => {
      flushPendingInputAndLayout();
      return noteOps!.enterNote(scopeId, position);
    },
    exitNote: () => {
      flushPendingInputAndLayout();
      return noteOps!.exitNote();
    },
    notePropertiesState: () => {
      // See notePropertiesCache for why each field is in the key.
      const paragraphId = surface.state().selection.head.paragraphId;
      const packageRevision = session.packageRevision();
      const pkg = session.currentPackage();
      const bodyPart = session.part();
      const settingsPart = settingsPartOf(pkg);
      const footnotesPart = resolveNotesPart(pkg, 'footnote');
      const endnotesPart = resolveNotesPart(pkg, 'endnote');
      const headerFooterOpen = surface.activeScope().kind === 'headerFooter';
      const hfState = surface.headerFooterState();
      const headerFooterRId = hfState?.rId ?? null;
      const headerFooterSectionIndex = hfState?.sectionIndex ?? null;
      const cached = notePropertiesCache;
      if (
        cached &&
        cached.packageRevision === packageRevision &&
        cached.paragraphId === paragraphId &&
        cached.bodyPart === bodyPart &&
        cached.settingsPart === settingsPart &&
        cached.footnotesPart === footnotesPart &&
        cached.endnotesPart === endnotesPart &&
        cached.headerFooterOpen === headerFooterOpen &&
        cached.headerFooterRId === headerFooterRId &&
        cached.headerFooterSectionIndex === headerFooterSectionIndex
      ) {
        return cached.result;
      }
      const result = notePropertiesStateOf(surface, revisionFilter());
      notePropertiesCache = {
        packageRevision,
        paragraphId,
        bodyPart,
        settingsPart,
        footnotesPart,
        endnotesPart,
        headerFooterOpen,
        headerFooterRId,
        headerFooterSectionIndex,
        result,
      };
      return result;
    },
    notePreviewText: (scopeId) => notePreviewTextOf(session, scopeId),
    applyTableCommandPlan(plan: TableCommandPlan): ExecResult {
      if (!plan.ok) {
        return { ok: false, code: plan.code, reason: plan.reason };
      }
      if (plan.selection.kind === 'selectCells') {
        setCellSelection(plan.selection.cells);
        return { ok: true, changed: false };
      }
      let committedCaret: {
        readonly paragraphId: string;
        readonly start: number;
        readonly end: number;
      } | null = null;
      const unsub = session.subscribe((change) => {
        if (change.caret) {
          committedCaret = change.caret;
        }
      });
      try {
        const selectionBefore = selectionMark();
        const adoptCaret = plan.selection.kind === 'adoptCommittedCaret';
        commit(
          () => applyOps(plan.ops, selectionBefore),
          adoptCaret
            ? () => {
                const caret = committedCaret;
                if (!caret) return null;
                return collapsedAt({
                  paragraphId: caret.paragraphId,
                  offset: caret.start,
                });
              }
            : undefined,
          plan.selection.kind === 'preserveSelection' ? { keepCellSelection: true } : undefined
        );
      } finally {
        unsub();
      }
      if (lastRejection) {
        return { ok: false, code: 'invalidArgs', reason: lastRejection };
      }
      return { ok: true, changed: true };
    },
    enterHeaderFooter: (args) => {
      // Land buffered body typing in the BODY before the scope flips to a
      // header/footer story (see setActiveScope). The band scroll below reads
      // the layout, so a deferred pass lands with it.
      flushPendingInputAndLayout();
      const entered = hfScope!.enterHeaderFooter(args);
      if (!entered) return entered;
      // A PROGRAMMATIC enter (review card, automation) must bring the band into view —
      // `followCaretIntoView` deliberately sits out while a furniture scope is open, and
      // the pointer path enters from a double-click that is by definition already on
      // screen. 'nearest' makes this a no-op in that already-visible case.
      const active = hfScope!.getActive();
      const page = active ? currentLayout.pages[active.pageIndex] : undefined;
      if (active && page) {
        const story = active.kind === 'header' ? page.header : page.footer;
        const bandY =
          story?.box.y ??
          (active.kind === 'header' ? page.box.y : page.box.y + page.box.height - 1);
        const bandHeight = story?.box.height ?? 1;
        scrollToContentY(bandY, bandHeight, { block: 'nearest' });
      }
      return entered;
    },
    exitHeaderFooter: () => {
      // Escape from a header lands buffered HEADER typing in the header first.
      flushPendingInputAndLayout();
      return hfScope!.exitHeaderFooter();
    },
    headerFooterState: () => hfScope!.headerFooterStateStable(session.packageRevision()),
    ...createHeaderFooterOps({
      applyOps,
      commit,
      deleteSelectionOps,
      deleteSelectionPlan: () => deleteSelectionPlan(),
      orderedStart,
      selectionMark,
      collapsedAt,
      isHeaderFooterOpen: () => hfScope?.getActive() !== null,
      lastRejection: () => lastRejection,
    }),
    ...createImageOps({
      session,
      applyOps,
      commit,
      storyScope,
      outsidePromptAt: (id, offset) =>
        !!promptBoundary() && selection.head.paragraphId === id && selection.head.offset === offset,
      selectionMark,
      editingMode: () => editingMode,
      author: () => author,
      trackedDate: revisionDateNow,
      decodePort: () => decodePort,
      actorId: () => collaborationSession?.identity.actorId,
    }),
    ...createChartOps({
      session,
      commit,
      storyScope,
      outsidePromptAt: (id, offset) =>
        !!promptBoundary() && selection.head.paragraphId === id && selection.head.offset === offset,
      editingMode: () => editingMode,
      actorId: () => collaborationSession?.identity.actorId,
    }),

    // `preventScroll`: the pages layer is the WHOLE document tall, and focusing it scrolls
    // it into view — to its top. The first click anywhere in a long document therefore
    // threw the reader back to page 1 before the caret it had just placed could be seen.
    // The caret is positioned from layout regardless, so nothing needs the browser's scroll.
    focus: () => {
      // An already-focused surface may have a newer native selection or active IME
      // composition. A redundant focus request must not overwrite either with the model.
      if (pagesLayer.ownerDocument.activeElement === pagesLayer) return;
      pagesLayer.focus({ preventScroll: true });
      // Returning from a toolbar input can place the browser caret at the document's
      // start. Restore the saved model range before selectionchange adopts that caret
      // and follows it into view (including when no formatting command was executed).
      selectionSync.mirrorToDom(true);
    },
    setTableInteractionLabel(resolver) {
      tableLabelState.resolve = resolver;
    },
    refreshTableInteractionLabels() {
      tableInteraction.refreshLabels();
    },
    moveTo: hosting.moveTo,
    park: hosting.park,
    parked: hosting.parked,
    hostElement: () => container,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopOpening();
      openingBlockLimit = null; // So cancelling a deferred pass clears the pending marker.
      deferredLayout.cancel();
      canonicalLayout.cancel();
      // Typed-but-unflushed text lands before teardown, so a detach-then-save
      // flow keeps the last keystrokes — all the way to a paint and its state
      // report: the final commit's `onChange` used to come from the synchronous
      // commit tail, and a deferral swallowed by `scheduler.cancel()` below
      // would silence the last keystrokes for an onChange-driven host.
      try {
        flushToPaint();
      } finally {
        pagesLayer.removeEventListener('pointerdown', onDrawingPointerGesture, { capture: true });
        pagesLayer.removeEventListener('keydown', onDrawingKeyGesture, { capture: true });
        pagesLayer.removeEventListener('keydown', onInputTiming, { capture: true });
        pagesLayer.removeEventListener('pointerdown', onInputTiming, { capture: true });
        pagesLayer.removeEventListener('beforeinput', onDrawingKeyGesture, { capture: true });
        pagesLayer.removeEventListener('keydown', onKeyDown);
        unbindDirectionChord();
        pagesLayer.removeEventListener('beforeinput', onBeforeInput as EventListener);
        pagesLayer.removeEventListener('copy', onCopy as EventListener);
        pagesLayer.removeEventListener('cut', onCut as EventListener);
        pagesLayer.removeEventListener('paste', onPaste as EventListener);
        pagesLayer.removeEventListener('compositionstart', onCompositionStart);
        inputMethod.repair.destroy();
        pagesLayer.removeEventListener('compositionend', onCompositionEnd);
        viewportBinding?.destroy();
        hostListeners.clear();
        hosting.destroy();
        // An open engine menu holds document-level dismiss listeners; a surface torn down
        // with its menu still up would leave them swallowing the next editor's Escape.
        removeExistingContentControlMenu();
        widgetSessions.destroy();
        pictureWidget.destroy();
        textFormInteraction?.destroy();
        legacyDropdownInteraction?.destroy();
        legacyCheckboxInteraction?.destroy();
        pointer?.destroy();
        drop?.destroy();
        tableInteraction.destroy();
        tableSelectHandle?.destroy();
        navigation.destroy();
        equationInteraction.destroy();
        selectionSync.destroy();
        pagesLayer.removeEventListener('contextmenu', onTocContextMenu);
        pagesLayer.removeEventListener('click', onTocRowClick);
        pagesLayer.removeEventListener('pointermove', onTocPointerMove);
        pagesLayer.removeEventListener('pointerleave', onTocPointerLeave);
        controlHover.destroy();
        // Drop pending layout work and stop listening BEFORE the DOM goes, or a commit from
        // another editor sharing this store would paint into a detached container.
        scheduler.cancel();
        if (deferredPublishRender !== null) timers.clearTimeout(deferredPublishRender);
        deferredPublishRender = null;
        if (cancelDerivationPrewarm) cancelDerivationPrewarm();
        cancelDerivationPrewarm = null;
        drawingBundle.dispose();
        detachDrawingUrlRegistry(pagesLayer);
        caret.destroy();
        unsubscribeRemoteSelections();
        unsubscribeCollaborationStatus();
        detachCollaboration();
        unsubscribe();
        container.replaceChildren();
      }
    },
  };

  /** After a shared undo: the selection the undone step was made from, else the change. */
  /**
   * Put the caret back where a reversed history entry left it.
   *
   * `null` means nothing moved — either the stack was empty or the entry recorded no
   * selection — so the caret stays where the user left it rather than jumping to the top.
   */
  function restoreSelection(
    mark: { paragraphId: string; start: number; end: number } | SemanticSelection | null
  ): void {
    // History restores text, input locale, and selection together. Retire pending typing
    // formats so the restored caret cannot inherit formatting armed against the old tree.
    pendingFormats = null;
    const formSelection = textFormInteraction?.restoreAfterHistory();
    if (!mark && formSelection) selection = formSelection;
    // The tree about to be published is not the one the DOM selection was made against, so
    // the flush below must not read it back: offsets in the reverted tree do not correspond
    // to offsets in the one that replaced it.
    selectionSync.noteModelMoved();
    flushLayout();
    if (!mark) {
      // Commands without selection metadata still need a caret within the restored tree.
      setSelection(clampedToDocument(editingLayout(), paragraphOrder(), selection));
      return;
    }
    if ('anchor' in mark) {
      const order = paragraphOrder();
      const local =
        !collaborationSession &&
        [mark.anchor, mark.head].every((p) => order.includes(p.paragraphId));
      setSelection(local ? mark : clampedToDocument(editingLayout(), order, mark));
      return;
    }
    const restored = {
      anchor: { paragraphId: mark.paragraphId, offset: mark.start },
      head: { paragraphId: mark.paragraphId, offset: mark.end },
    };
    // Another story's mark must stay outside the active editable region.
    setSelection(
      paragraphOrder().includes(mark.paragraphId)
        ? restored
        : clampedToDocument(editingLayout(), paragraphOrder(), restored)
    );
  }

  /**
   * Scroll the surface's container so a band of CONTENT space is in view.
   *
   * Layout coordinates, scaled here — never element measurement. The page a reveal is
   * asked for is usually one that has not been materialized yet, so it has no element to
   * read a position from; the records always know where it is.
   */
  function scrollToContentY(
    contentY: number,
    contentHeight: number,
    options?: ContentScrollOptions
  ): boolean {
    const scroller = surfaceScroller(container);
    if (!scroller || scroller.clientHeight === 0) return false;
    payOwedPaint();
    const top = contentY * scale + container.offsetTop;
    if (!scrollBandIntoView(scroller, top, contentHeight * scale, options)) return true;
    // Materialization follows the scroller, and a programmatic scroll fires `scroll`
    // asynchronously — repaint now so the revealed page is BUILT rather than a blank
    // sheet the caller has to scroll again to fill.
    rematerialize();
    return true;
  }

  // Event wiring lives HERE rather than in each host, so React, Vue and a plain page get
  // identical behaviour instead of three hand-written keymaps that drift. The handlers
  // themselves are factories over the surface interface: keys, clipboard and `beforeinput` in
  // surface-input.ts, the selection mirror and the IME lane in surface-selection-sync.ts.
  // The document-level selection listener runs in this editor's field-result mode too.
  const { onSelectionChange, onCompositionEnd } = fieldScope.methods({ ...selectionSync });
  // The IME owns the DOM from compositionstart on; buffered plain typing must be in the
  // document before that handover, not woven into the readback. The handover is of the
  // PAINTED DOM, so a layout pass or paint a commit deferred under input pressure must land
  // too: the readback diffs the painted text against the model, and a composition begun over
  // a stale paint reads the missing edit back as the IME's own (but not its own last commit).
  //
  // The pending USER selection is taken up FIRST, exactly as `onKeyDown` does. The flush's
  // render mirrors the model selection into the DOM — over the user's still-unadopted range
  // — and its `applyingSelection` echo guard is still up (it clears on a microtask) when
  // `onCompositionStart` performs its own mandatory adoption, which would skip it: the #383
  // lane choice would again be made from a selection the user no longer has.
  const onCompositionStart: typeof selectionSync.onCompositionStart = (...args) => {
    inputMethod.repair.stop();
    selectionSync.adoptBeforeInput();
    if (!selectionSync.continuesComposition()) flushToPaint();
    selectionSync.onCompositionStart(...args);
  };

  // The selection mirror uses this handle to avoid adopting selection mid-drag.
  let pointer: PointerController | null = null;
  const textFormRules = createTextFormFieldInteraction(
    {
      onRequest: options.onRequestTextFormField,
      onInvalidRequest: options.onRequestInvalidTextFormField,
      locale: dateLocale.get,
      translate: (key, params) => translate?.(key, params) ?? key,
      pagesLayer,
      get container() {
        return container;
      },
      listeners: hostListeners,
      part: (paragraphId?: string) =>
        partOfNodeId(session, paragraphId ?? selection.head.paragraphId) ?? session.part(),
      parts: () => session.storyParts(),
      protected: (paragraphId = selection.head.paragraphId) =>
        formsProtectionEnabled(session.settingsRoot()) &&
        sectionProtectsForms(partOfNodeId(session, paragraphId) ?? session.part(), paragraphId),
      selection: () => selection,
      // A mix of intents, so the lane states each: a press must not move the paper (an empty
      // FORMTEXT field is zero-length, so it arrives as a caret the ordinary rule WOULD
      // follow), while the caret restored after a dialog wants that rule.
      select: (next, pressed) => setSelection(next, false, pressed ? 'none' : 'caret'),
      // SEPARATE from `select`, because the FIELD a lane travels to is a range, which the
      // ordinary rule refuses. Tab and the edit command ask for it here.
      reveal: revealTravelledTo,
      editable: () => editingMode === 'edit' && !showFieldCodes,
      apply: (op) => applyTextFormOperation(op, commit, applyOps),
      save: (ops, next) =>
        applyTextFormSave(ops, next, {
          session,
          commit,
          refusal: () => writeRefusal(true, ops, false),
          gate: (values, scope) => collaborationSession?.gateOperations(values, scope) ?? null,
          collaborationActive: collaborationSession !== undefined,
        }),
    },
    runtimeOptions.initialTextFormInput
  );
  textFormInteraction = withSavedFieldResults(
    textFormRules,
    {
      part: (paragraphId) => partOfNodeId(session, paragraphId),
      selection: () => selection,
      select: (next) => setSelection(next),
      writable: () => editingMode !== 'view' && !showFieldCodes,
      compare: comparePositions,
    },
    fieldScope
  );
  registerFormFieldIdentity(surface, textFormInteraction.fieldId);
  registerContentLockPolicy(surface, options.contentLockPolicy);
  legacyCheckboxInteraction = createLegacyCheckboxInteraction({
    pagesLayer,
    part: (paragraphId?: string) =>
      partOfNodeId(session, paragraphId ?? selection.head.paragraphId) ?? session.part(),
    // Suggesting presses through, so the write path refuses the untracked toggle with a reason.
    editable: () => editingMode !== 'view' && !showFieldCodes,
    protected: (paragraphId) =>
      formsProtectionEnabled(session.settingsRoot()) &&
      sectionProtectsForms(partOfNodeId(session, paragraphId) ?? session.part(), paragraphId),
    selection: () => selection,
    // `none`: the toggle is a press on the control, so the paper stays put under it. A
    // range never scrolled anyway; stating it keeps one rule for every pointer lane, and
    // covers a zero-length field range that would arrive here as a caret.
    select: (next) => setSelection(next, false, 'none'),
    apply: (op) => applyTextFormOperation(op, commit, applyOps),
  });
  legacyDropdownInteraction = createLegacyDropdownInteraction({
    pagesLayer,
    settings: () => settingsPartOf(session.currentPackage()),
    part: (paragraphId) =>
      partOfNodeId(session, paragraphId ?? selection.head.paragraphId) ?? session.part(),
    editable: () => editingMode === 'edit' && !showFieldCodes,
    // Wrapped, not passed by reference: a bare `setSelection` forwards whatever arguments
    // the caller happens to have. `none` for the same reason as the checkbox above.
    select: (next) => setSelection(next, false, 'none'),
    canApply: (op) => session.editable && writeRefusal(true, [op], false) === null,
    history: (action) => surface[action](),
    apply: (op) => applyTextFormOperation(op, commit, applyOps),
  });
  const dispatchKeyDown = createKeyDownHandler(surface, {
    ...options,
    onToggleFieldCodes: () => {
      flushPendingInputAndLayout();
      showFieldCodes = !showFieldCodes;
      furnitureSource = createCurrentFurnitureSource(revisionFilter());
      scheduler.invalidateAll(session.packageRevision(), 'field-code-view');
      scheduler.flush();
    },
  });
  const directionChord = createDirectionChordHandler(
    surface,
    () => (partOfNodeId(session, selection.head.paragraphId) ?? session.part()).root
  );
  const onKeyDown = (event: KeyboardEvent): void => {
    selectionSync.noteKeyDown(event);
    directionChord.keydown(event);
    if (legacyDropdownInteraction?.keydown(event)) return;
    // The browser may have moved its caret without delivering the queued `selectionchange`
    // yet. Close that window before a command resolves its TreeDocOp from model selection.
    if (!event.defaultPrevented) selectionSync.adoptBeforeInput();
    if (legacyCheckboxInteraction?.keydown(event) || textFormInteraction?.keydown(event)) return;
    dispatchKeyDown(event);
  };
  const { onCopy, onCut, onPaste } = createClipboardHandlers(surface);
  const inputMethod = createInputMethodLane({
    pagesLayer,
    selection: () => selection,
    textOf,
    paragraphOrder,
    revision: () => session.packageRevision(),
    paintCurrent: () => !deferredPublishRender && !commitPaintOwed && typeBuffer.length === 0,
    flushToPaint,
    render,
    timers,
    sync: selectionSync,
  });
  const dispatchBeforeInput = createBeforeInputHandler(surface, {
    isComposing: () => selectionSync.isComposing(),
    insertPlainText,
    // The browser parked its own selection over the text a substitution replaced. Rewrite
    // the DOM selection now for a park that already happened, and flag the queued echo for
    // one that has not.
    onBrowserSelectionFixup: () => {
      selectionSync.mirrorToDom();
      selectionSync.noteBrowserSelectionFixup();
    },
    ...inputMethod.hooks,
  });
  const onBeforeInput = (event: InputEvent): void => {
    selectionSync.adoptBeforeInput();
    dispatchBeforeInput(event);
    if (!selectionSync.isComposing()) inputMethod.repair.watch(event);
  };

  // One header and footer entry for the pointer and the drawing presses: no scroll, unlike the
  // programmatic entry, because the press is already on screen.
  const storyTransitions = pointerStoryTransitions({
    viewing: () => editingMode === 'view',
    flush: flushPendingInputAndLayout,
    headerFooter: () => hfScope,
    notes: () => noteOps,
    sectionAtPage,
    blankHeaderFooter: () => ({
      session,
      layout: currentLayout,
      sectionAtPage,
      create: (op) => surface.applyHeaderFooterLifecycle?.(op),
      flushLayout,
    }),
  });
  const { onDrawingPointerGesture, onDrawingKeyGesture } = createDrawingGestures({
    surface,
    textbox: () => textboxEditing,
    intent: () => drawingIntent,
    setIntent: (intent) => setDrawingIntent(intent, true),
    behindDrawingAt: (x, y) => pointer?.behindDrawingAt(x, y) ?? null,
    enterStoryPage: (pageIndex) => {
      const active = pointerHeaderFooterState(hfScope?.getActive() ?? null);
      if (active) storyTransitions.enterHeaderFooter?.({ ...active, pageIndex });
    },
  });
  pagesLayer.addEventListener('pointerdown', onDrawingPointerGesture, { capture: true });
  pagesLayer.addEventListener('keydown', onDrawingKeyGesture, { capture: true });
  pagesLayer.addEventListener('beforeinput', onDrawingKeyGesture, { capture: true });
  pagesLayer.addEventListener('keydown', onInputTiming, { capture: true });
  pagesLayer.addEventListener('pointerdown', onInputTiming, { capture: true });
  pagesLayer.addEventListener('keydown', onKeyDown);
  const unbindDirectionChord = bindDirectionChord(pagesLayer, directionChord);
  pagesLayer.addEventListener('beforeinput', onBeforeInput as EventListener);
  pagesLayer.addEventListener('copy', onCopy as EventListener);
  pagesLayer.addEventListener('cut', onCut as EventListener);
  pagesLayer.addEventListener('paste', onPaste as EventListener);
  pagesLayer.addEventListener('compositionstart', onCompositionStart);
  pagesLayer.addEventListener('compositionend', onCompositionEnd);

  // Selection, scroll and viewport size, from whichever window the pages live in.
  viewportBinding = bindSurfaceViewport({
    pagesLayer,
    container: () => container,
    listeners: hostListeners,
    onSelectionChange,
    rematerialize: fieldScope.wrap(rematerialize),
  });

  textboxEditing = createTextboxEditing({
    session,
    pagesLayer,
    layout: () => currentLayout,
    selection: () => selection,
    setSelection: (next) => setSelection(next, false, 'none'),
    flush: flushPendingInputAndLayout,
    ...textboxOwnerDeps(session, sectionAtPage, () => ({ hfScope, noteOps })),
    // Suggesting enters a box too: its typing commits through `applyOps`, which tracks it.
    writable: () => hostEditable && editingMode !== 'view' && session.editable,
  });
  pointer = createPointerController(
    {
      onTextFormDoubleClick: (event) => textFormInteraction?.doubleClick(event) ?? false,
      onTextFormPointerUp: (event) => textFormInteraction?.pointerUp(event),
      pagesLayer,
      get container() {
        return container;
      },
      listeners: hostListeners,
      scale: () => scale,
      // Pages of differing width are centred individually, so a landscape page among
      // portrait ones is painted at an x its record does not carry. Without this the
      // transform reads every point on such a page shifted by that offset.
      pageOffsetX: (pageIndex) => materializedExtent?.pageOffsetX.get(pageIndex) ?? 0,
      // Flushed: the pointer maps a client point to a MODEL offset, and a pass a commit
      // deferred under input pressure would hand it the pre-edit offsets — a click during
      // a burst then wrote a caret shifted by the inserted length. Only ever a real pass
      // right after a deferring commit; every other call is a cheap no-op check. This is
      // an event-handler-only dep — no render path reads it — so it cannot re-enter paint.
      //
      // WITHOUT the caret follow that pass would carry: it would scroll to the TYPING caret
      // between the reader aiming and this reading the rect, and the press would land on
      // whatever slid under it. BOTH halves: the pending nudge is spent, because a paint this
      // flush defers to its own task would otherwise perform that scroll one task later —
      // between the two presses of a double click — and the flag is the only thing that pass
      // reads; the suppression covers the synchronous pass, where a page change would scroll
      // without the flag. The press places the caret itself, so nothing is left to show.
      layout: () => {
        caretFollowPending = false;
        caretView.without(flushLayout);
        return editingLayout();
      },
      measurer: () => measurer,
      selection: () => hiddenMarks.shownSelection(selection),
      // `none`: a press lands where the reader LOOKS, and moving the paper under a double
      // click sent its second press elsewhere — a blank footer band never opened.
      setSelection: (next, caret) => {
        clearPromptBoundary();
        setSelection(next, false, 'none', caret);
      },
      cellSelection: () => cellSelection,
      setCellSelection: (next) => setCellSelection(next),
      // `preventScroll`: the pages layer is the WHOLE document tall, and focusing it scrolls
      // it into view — to its top. The first click anywhere in a long document therefore
      // threw the reader back to page 1 before the caret it had just placed could be seen.
      // The caret is positioned from layout regardless, so nothing needs the browser's scroll.
      focus: () => pagesLayer.focus({ preventScroll: true }),
      // An armed format painter paints the selection the gesture just produced. Word's
      // gesture exactly: arm, then drag over the text that should take the formatting.
      onSelectionSettled: () => formatPainter.applyIfArmed(),
      activeHeaderFooter: () => pointerHeaderFooterState(hfOutsideBox()),
      ...storyTransitions,
      onContentControlWidget: (controlId, kind) => openContentControlWidget(controlId, kind),
      ...(options.reviewModel ? { onChangeBarToggle: reviewView.toggleByChangeBar } : {}),
      isReadOnlyPosition: (position) => tocAtPosition(session.part(), position) !== undefined,
    },
    {
      ...(options.pointer ? { mode: options.pointer } : {}),
      ...(atomicNavigation ? { atomicInlineControls: true } : {}),
    }
  );

  drop = bindSurfaceDragControllers(
    surface,
    pagesLayer,
    dropLayer,
    hostListeners,
    () => scale,
    () =>
      !destroyed && !hosting.parked() && hostEditable && editingMode !== 'view' && session.editable,
    options.onDragEvent,
    (next, caret) => setSelection(next, false, 'none', caret),
    (key) => translate?.(key)
  );

  const tableInteraction = createSurfaceTableInteraction({
    pagesLayer,
    furnitureLayer: tableFurnitureLayer,
    listeners: hostListeners,
    scale: () => scale,
    pageOffsetX: (pageIndex) => materializedExtent?.pageOffsetX.get(pageIndex) ?? 0,
    read: () => ({
      layout: currentLayout,
      storeRevision: session.packageRevision(),
      selection,
      cellSelection,
      editingMode,
      themeColors: session.documentThemeColors(),
    }),
    session: () => session,
    applyTableCommandPlan: (plan) => surface.applyTableCommandPlan(plan),
    label: (key) => tableLabelState.resolve(key),
  });
  tableSelectHandle = createSurfaceTableSelectHandle({
    pagesLayer,
    layer: tableSelectLayer,
    listeners: hostListeners,
    scale: () => scale,
    pageOffsetX: (pageIndex) => materializedExtent?.pageOffsetX.get(pageIndex) ?? 0,
    read: () => ({ layout: currentLayout, selection, editingMode }),
    label: (key) => tableLabelState.resolve(key),
    setCellSelection: (cells) => setCellSelection(cells),
    session: () => session,
    applyTableCommandPlan: (plan) => surface.applyTableCommandPlan(plan),
  });

  render();
  legacyDropdownInteraction?.sync();
  remoteSelectionRenderingReady = true;
  renderRemoteSelections();
  // The surface is fully constructed, so shared state can now be published through it.
  if (collaborationSession) {
    unsubscribeCollaborationStatus = collaborationSession.subscribeStatus(() => {
      options.onChange?.(currentState());
    });
  }
  if (collaborationSession && collaborationPort) {
    // `attach` runs inside the host's mount, so a session that throws here takes the whole editor
    // with it and the reader gets a blank page instead of a document. Destroying the session moves
    // it to `destroyed`, which hosts already render as out of sync — an honest "reload to rejoin"
    // beats both a blank page and a room that says it is connecting forever.
    try {
      detachCollaboration = collaborationSession.attach(collaborationPort);
    } catch {
      try {
        collaborationSession.destroy();
      } catch {
        // Already unusable; the surface still opens without a replica.
      }
    }
  }
  publishLocalCollaborationSelection();
  // The pages layer is created `contenteditable` unconditionally, so a surface OPENED in
  // viewing came up writable — a caret, an IME and a screen reader told the document takes
  // input. `setEditingMode` was the only path that re-derived it; opening is the other one.
  applyEditableChrome();
  // `setEditingMode` used to be wrapped here to append `tableInteraction.update()`, because
  // the setter did not repaint. It does now, and `render` updates the table furniture — so
  // the wrapper only hid the coupling from the setter that owns it.
  surface.setTableInteractionLabel = (resolver) => {
    tableLabelState.resolve = resolver;
    tableInteraction.refreshLabels();
    tableSelectHandle?.update();
  };
  registerUsedFontFaces(surface, faceUsage.faces);
  surface.refreshTableInteractionLabels = () => {
    tableInteraction.refreshLabels();
    tableSelectHandle?.update();
  };
  registerSurfaceMeasurement(
    surface,
    () => ({
      measurer: options.measurer,
      producer: options.producer,
      fontAlias: options.fontAlias,
      defaultFontFamily: options.defaultFontFamily,
    }),
    (next) => {
      options = { ...options, ...next };
      measurer = faceUsage.wrap(options.measurer ?? defaults!.measurer);
      producer = producerIdentity();
    },
    () => {
      if (destroyed) return;
      furnitureSource = createCurrentFurnitureSource(revisionFilter());
      materializedSet = undefined;
      materializedExtent = undefined;
      commentRectCache = null;
      scheduler.invalidateAll(session.packageRevision(), 'fonts');
      scheduler.flush();
    }
  );
  registerRefreshComposition(surface, () => selectionSync.isComposing());
  ({ finishPaused: finishOpeningPass, stop: stopOpening } = startOpeningSlices(
    surface,
    () => container,
    {
      pages: () => pagesLayer,
      now,
      destroyed: () => destroyed,
      limit: () => openingBlockLimit,
      setLimit: (limit) => (openingBlockLimit = limit),
      bodyBlockCount: () => bodyBlockCountOf(layoutSession),
      bodyBlock: (index) => bodyBlocksOf(layoutSession)?.[index],
      publish: (layout) => publishLayout(layout as SemanticLayout),
      inputPending: () => hasPendingBrowserInput(false),
      busy: () => deferredLayout.pending(),
      finishBusy: () => deferredLayout.finish(),
      composing: () => selectionSync.isComposing(),
      prefixPass: (limit) =>
        layoutDocumentSteps(session.packageRevision(), undefined, undefined, limit),
      finish: fieldScope.wrap(() => {
        // Cleared first: an edit since the last prefix can have added blocks past it.
        openingBlockLimit = null;
        scheduler.invalidateAll(session.packageRevision(), 'opening');
        scheduler.flush();
      }),
    },
    PROGRESSIVE_OPEN_FIRST_BLOCKS
  ));
  return { ok: true, surface: fieldScope.methods(surface) };
}
