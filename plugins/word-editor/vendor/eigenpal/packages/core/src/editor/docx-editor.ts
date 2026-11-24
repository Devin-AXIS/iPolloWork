import { capturePointPosition, createEditorPointMembers } from './editor-point-target.ts';
import { createUnsupportedElementState } from './unsupported-element-state.ts';
import { createEditorEvents } from './editor-events.ts';
import { createEditorDiagnostics, reportEditorFontError } from './editor-diagnostics.ts';
import { surfaceFieldResultsScope } from './field-results-scope.ts';
import { createReviewDialogs } from './review-dialogs.ts';
import { withCompareOutcome } from './compare-documents-state.ts';
import * as replacing from './replace-document-command.ts';
import { queryEditorDocument, watermarkOf } from './docx-editor-query.ts';
import { refreshWriteBlocked, writeBlockRefusal } from './refresh-write-guard.ts';
import type { PaginatedSurfaceRuntimeOptions } from './surface-runtime-options.ts';
import { endEditorPreview, registerEditorPreviewHost } from './editor-preview.ts';
import { registerRefreshHost, type RefreshHost } from './document-refresh-host.ts';
import { reviewChangesLocked } from './command-protection.ts';
import { createPlacementKeeper, createReviewRanker } from './review-ranking.ts';
import { browserFallbackMeasurer, resolvedFontMeasurement } from './resolved-font-measurement.ts';
import { updateSurfaceMeasurement, usedFontFacesOf } from './surface-measurement.ts';
import { usedFamiliesCovered } from './font-face-usage.ts';
import { fontInstallKey } from './font-install-key.ts';
import {
  createLiveFontResolution,
  liveFontFamilies,
  requestFaces,
} from './live-font-resolution.ts';
import type { LiveFontRequest } from './live-font-resolution.ts';
import { createFontResolutionLifetime } from './font-resolution-lifetime.ts';
import { composeFontOrigins, defineFontResolver } from './font-resolver.ts';
import {
  createReviewCommands,
  reviewActivationRefusal,
  reviewModelOption,
} from './docx-editor-review-commands.ts';
import { isGroupedReviewWrite } from './review-document-decisions.ts';
import { canEditorViewCommand, createEditorViews } from './docx-editor-view-commands.ts';
import { bindPopupChromeRequests } from './text-form-field-chrome.ts';
import { completePendingSuggesting } from './opening-editing-mode.ts';
import { localEditAt, subscribeDocumentChanges } from './docx-editor-document-changes.ts';
import { attachTargetRefusal, hostWindowOf, registerEditorHost } from './host-realm.ts';
import { continueOpeningLayout, withOpeningRefresh } from './docx-editor-opening-layout.ts';
import { formattingCommandActive } from './docx-editor-active.ts';
import { createEditorScrolling } from './docx-editor-scroll.ts';
import { createAnchorNavigation } from './docx-editor-anchor-navigation.ts';
import { createTextHighlights } from './text-highlights.ts';
import { layoutReadingOrder, navigateHighlight } from './highlight-navigation.ts';
import { createReviewItemsAt } from './review-items-at.ts';
import { createParagraphTextReads } from './paragraph-text-read.ts';
import { reviewItemPlacement } from './review-placement-cache.ts';
import {
  findReviewPlacement,
  keyUnderQuery,
  narrowReviewItems,
  createPairedActivation,
  litReviewKeys,
  replacementPairHalves,
  reviewItemWithHalves,
  withRevealPairKey,
  withSkippedPairKeys,
} from './review-replacement-pairs.ts';
import { createDocumentProtectionCommands } from './docx-editor-protection.ts';
import {
  anchorLineY,
  firstReviewRange,
  reviewItemKey,
  type ReviewItem,
  type ReviewParagraphAnchor,
  type SemanticPosition,
  type SemanticSelection,
} from '../layout/index.ts';
import {
  createStableReviewAuthorSlots,
  type StableReviewAuthorSlots,
} from '../output/revision-presentation.ts';
import {
  createReviewAuthorCommands,
  createReviewRevisionTicker,
  createRevisionAuthorVisibility,
} from './revision-author-visibility.ts';
import type {
  DocumentEditingMode,
  ReviewActivationOptions,
  ReviewItemPlacement,
  ReviewItemQuery,
  ReviewRevisionKind,
} from '../contracts/editor.ts';
import { resolveEditorModules, type ReviewDisplayMode } from '../contracts/modules.ts';
import { createReviewPaneState } from './review-pane-state.ts';
import {
  NO_TRACKING_SETTINGS,
  type DocumentTrackingSettings,
} from '../store/package/tracking-settings.ts';
import type { StoryScope } from '@docx-editor.dev/core/store';
import { parseNoteScopeId } from '../store/package/note-nodes.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';
import { furnitureHomeOfItem, noteStoryScopeOfItem } from './review-item-story.ts';
import { partOfNodeId } from './surface-scope.ts';
import type {
  CanResult,
  DocumentHandle,
  EditorScope,
  EditorSnapshot,
  ExecResult,
  Unsubscribe,
  ViewScope,
} from '@docx-editor.dev/core/contracts/editor';
import { EditorFontError } from '@docx-editor.dev/core/contracts/editor';
import {
  FontResolutionError,
  HARD_MAX_FONT_BYTES,
  fontRequestKey,
  type TextMeasurer,
} from '@docx-editor.dev/core/layout';
import { createAnchorIndex, warmAnchorsWhenIdle } from './docx-editor-anchors.ts';
import type { PendingTextFormInput } from './surface-text-form-fields.ts';
import { saveEditorDocument } from './docx-editor-save.ts';
import {
  enterStoryPosition,
  findDocumentMatches,
  selectDocumentSearchMatch,
} from './docx-editor-story-navigation.ts';
import { noteScopeIndexOf, paragraphOrderOf } from './layout-paragraph-indexes.ts';
import {
  classifyCommand,
  deepFreezeValue,
  docRangeEqual,
  createTocContextCache,
  editorError,
  formattingEqual,
  normalizeSource,
  pageEqual,
  pageSetupEqual,
  selectionsMatch,
  snapshotsEqual,
  tableContextEqual,
} from './docx-editor-support.ts';
import { createDocumentOpenFailureState } from './document-open-failure.ts';
import { execEditorCommand } from './docx-editor-exec.ts';
import { replaceCommandRefusal } from './replace-command-capability.ts';
import { reviewItemSpan } from './review-item-span.ts';
import type { TextTarget } from './text-target.ts';
import { createMountHistoryGroups } from './editor-history-groups.ts';
import { createPublishSignal } from './surface-publish-signal.ts';
import { FORMAT_PAINTER_OFF } from './surface-format-painter-contract.ts';
import { proposalCapabilityRefusal } from './proposal-capability.ts';
import { createOpenScheduler } from './docx-editor-open-scheduler.ts';
import * as preparedOpen from './docx-editor-prepared-open.ts';
import { configSurfaceOptions } from './docx-editor-surface-config.ts';
import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import {
  customNodeDiagnosticReporter,
  sweepCustomNodePayloadsOnOpen,
} from './custom-node-wiring.ts';
import {
  currentPage as currentPageOf,
  pageSetupOf,
  pageSetupWhileOpening,
  gateCommand,
  runFormattingOf,
  selectionFormattingHalfPoints,
  selectionRangeOf,
  totalPages as totalPagesOf,
  tableContextOf,
  selectedTableOf,
} from './docx-editor-derive.ts';
import { commentTargetRangeOf } from './docx-editor-comment-resolution.ts';
import { createReviewWrites, type ReviewWriteDeps } from './docx-editor-review-writes.ts';
import { createDocumentReviewCommands } from './docx-editor-document-review.ts';
import { registerEditorAutomation } from './editor-automation-registry.ts';
import {
  canContentControlCommand,
  runContentControlCommand,
  gateModeOf,
  isContentControlEditorCommand,
} from './content-controls.ts';
import { imageContextEqual } from './image-state-rules.ts';
import { createChartStateCache } from './chart-commands.ts';
import {
  selectedImageStateOf,
  canExecuteImageCommand as canExecuteImageCommandOf,
  canAsyncImageCommand as canAsyncImageCommandOf,
  executeImageCommand as executeImageCommandOf,
  captureImageMutationPreconditions,
  verifyImageCommandIdentity,
  isImageCommand,
  imageCommandHasIdentityFields,
} from './docx-editor-images.ts';
import {
  createLayoutShaping,
  disposeLayoutShaping,
  sampleFontShapingOptions,
  toEditorFontError,
} from './font-configuration.ts';
import {
  composeFontConfiguration,
  normalizeFontResolverResult,
  type FontConfigurationBase,
  type FontConfigurationFragment,
} from './font-composition.ts';
import { splitDeferredAnswer } from '../layout/font-deferred.ts';
import {
  createLateFontArrival,
  lateFacesInstalled,
  lateFontOrigins,
  type LateFontDelivery,
} from './late-font-arrival.ts';
import { initializeHarfBuzz } from '../layout/harfbuzz-shaper.ts';
import { availableFontFamilies, configuredDefaultFontFamily } from './font-catalog.ts';
import { createFontPickHold } from './font-pick-hold.ts';
import {
  documentFontResolutionRequest,
  admittedDocumentSubstitutions,
  applyDocumentFontSubstitutions,
  fallbacksForMissingFamilies,
} from '../layout/document-font-substitution.ts';
import {
  boundedExplicitFontSources,
  embeddedFontDropError,
  embeddedFontSourcesAfterExplicit,
  explicitFontBudgetError,
} from './embedded-font-sources.ts';
import {
  coveredFontFamiliesOf,
  createLocalFontProbe,
  detectFontSubstitutions,
} from './font-availability.ts';
import { renderedAndUnmappedSymbolFaces } from './unmapped-symbol-faces.ts';
import { tryCreateBrowserCanvasContext } from './browser-canvas-context.ts';
import {
  fontFaceEnvironmentOf,
  admittedFontSources,
  registerEmbeddedFontFaces,
  type EmbeddedFontFaceRegistration,
} from './embedded-font-faces.ts';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
  type PaginatedSurfaceOptions,
  type RemoteCaretLabelHost,
} from './paginated-surface.ts';
import { scrollToDocumentStart } from './surface-pages.ts';
import { openBodyStoryOf, textboxHostParagraphOf } from './review-story-entry.ts';
import { createZoomLane, zoomFacadeMembers } from './docx-editor-zoom.ts';
import {
  type CommandRefusal,
  createSuggestingConfigurationReporter,
  documentTrackingAdoption,
  PRO_REVIEW_REASON,
  refusalOfEditingMode,
  resolveHostEditingMode,
  SUGGESTING_AUTHOR_REASON,
} from './opening-editing-mode.ts';
import { createRevisionStyleState, EMPTY_AUTHOR_SLOTS } from './revision-style-state.ts';
import { normalizeEditorAuthor } from './docx-editor-author.ts';
import {
  createDocxEditorHostConfigState,
  liveHostConfigSetters,
} from './docx-editor-host-config.ts';
import type { DocxEditorConfig, DocxEditorInstance } from './docx-editor-types.ts';
import { createSelectionRangeRead, selectionCollapsedOf } from './selection-range-read.ts';
export type {
  BookmarkChromeHandlers,
  DocxEditorConfig,
  DocxEditorInstance,
  EquationChromeHandlers,
  FontMeasurementState,
  HyperlinkChromeHandlers,
} from './docx-editor-types.ts';

/** The one frozen scope object every snapshot shares, so scope stays reference-equal. */
const SCOPE_BODY: EditorScope = Object.freeze({ kind: 'body' as const });
/** One frozen empty answer, so "nothing substituted" never mints a new reference. */
const EMPTY_FONT_SUBSTITUTIONS: readonly string[] = Object.freeze([]);

/**
 * Build an editor: the full `Editor` contract over a paginated surface.
 *
 * Construction is separate from mounting. Pass a `container` and the document mounts
 * immediately; omit it and nothing touches the DOM until `attach(el)` — the provider-first
 * shape. `detach()` parks the live document and a later `attach(el)` moves it in, with undo,
 * selection and collaboration intact, even into another window (a pop-out or an iframe).
 *
 * `snapshot()` is version-cached: the same reference until state actually moves, with
 * reference-stable sub-objects, so it is safe as a `useSyncExternalStore` source.
 *
 * @example
 * ```ts
 * const editor = createDocxEditor({ document: bytes, modules: [reviewModule()] });
 * editor.attach(element);
 * editor.on('change', () => setDirty(true));
 * ```
 *
 * @public
 */
export function createDocxEditor(config: DocxEditorConfig): DocxEditorInstance {
  const fontShaping = sampleFontShapingOptions(config.fontShaping);
  let refreshHost: RefreshHost | undefined = undefined;
  let deferredRefreshBytes: Uint8Array | null = null;
  /** A mounted refresh whose opening slices must finish before success is reported. */
  let openingRefreshBytes: Uint8Array | null = null;
  /** The opening document's session between the prepare and mount tasks, for font work. */
  let preparedFontSession: TreeDocxSessionView | null = null;
  let mountedSeq = -1;
  const stillOpening = () => preparedFontSession !== null;
  const hostConfig = createDocxEditorHostConfigState(config);
  let author = normalizeEditorAuthor(config.author);
  let container: HTMLElement | null = config.container ?? null;
  /**
   * The capability registry, resolved once — module registration is
   * construction-time and immutable for the instance's lifetime.
   */
  const modules = resolveEditorModules(config.modules);
  const reportDiagnostic = customNodeDiagnosticReporter(modules);
  const reviewEnabled = modules.review !== null;
  // Review pane view settings: seeded by the review module, changed by `setReviewPaneOptions`.
  const reviewPane = createReviewPaneState(modules.review?.pane, {
    enabled: reviewEnabled,
    changed: (value, previous) => {
      // Moving tracked changes into balloons can leave an open pane with nothing to list.
      if (
        reviewPaneOpen &&
        value.revisionsIn !== previous.revisionsIn &&
        !reviewPane.shows(surface?.session.reviewItems() ?? [])
      )
        reviewPaneOpen = false;
      bump();
      emitSelectionChange();
      zoomLane.refit();
    },
  });
  /** Document bytes waiting for a container — set when constructed or loaded detached. */
  let pendingBytes: Uint8Array | null = null;
  /** Pending input belongs to these exact remount bytes, including a deferred mount. */
  let pendingTextFormInputs = new WeakMap<Uint8Array, PendingTextFormInput>();
  /** Defers a big document's open behind a painted frame; see `docx-editor-open-scheduler.ts`. */
  const openScheduler = createOpenScheduler({
    mount: (bytes) => mountBytes(bytes),
    // Fonts resolved before the mount are laid out once, by the mount; see `preparedOpenHook`.
    prepare: preparedOpen.preparedOpenHook(
      () => preparedOpen.sessionOpenOptions(reviewModelOption(modules, reportDiagnostic), config),
      (bytes, session) => {
        if (deferredRefreshBytes === bytes) return null;
        preparedFontSession = session;
        return () => preparedFontSession === session;
      },
      () => liveFonts.schedule(true)
    ),
    scheduled: () => {
      bump();
      emitSelectionChange();
    },
    node: () => container,
  });
  /**
   * How edits are written. `mode: 'view'` opens in viewing; everything else starts editing
   * and the opening-mode decision below may move it. Declared here because the surface is
   * handed it at mount, and a document reload keeps the reader's choice.
   */
  let editingMode: DocumentEditingMode = hostConfig.mode() === 'view' ? 'viewing' : 'editing';

  /**
   * The host rail's activation filter, held here so a surface rebuilt on load or font
   * remount comes back up with it (the surface holds the working copy). Declared before
   * the first mount, which reads it.
   */
  let reviewActivationExclusions: readonly ReviewRevisionKind[] | null = null;
  let reviewActivationFormattingKinds: readonly string[] | undefined;
  let allowExcludedFormatNavigation = false;
  const pairedPin = createPairedActivation(reviewPane.pairsReplacements, () => surface);
  const reviewAuthorVisibility = createRevisionAuthorVisibility();
  // How tracked changes are coloured, replaceable live; a reload mounts with the latest.
  const revisionStyleState = createRevisionStyleState(config.revisionStyles);
  /**
   * Author colours belong to the loaded DOCUMENT, not to one surface instance.
   *
   * Font resolution and attach rebuild the surface from the same bytes. They reuse this
   * assignment. `loadBytes` replaces it before a true document load mounts.
   */
  let reviewAuthorSlots: StableReviewAuthorSlots = createStableReviewAuthorSlots();
  /**
   * True once the reader has moved the mode themselves.
   *
   * A document reload must not undo their choice: `w:trackRevisions` says what the FILE asks
   * for, and the reader saying otherwise outranks it for the rest of the session.
   */
  let readerChoseMode = false;
  /** True while the editor sits in viewing because a protection put it there, not the reader. */
  let engineAdoptedViewing = false;

  /** A refusal this facade made before the surface could see the request; see `snapshot`. */
  let facadeRejection: string | null = null;

  /** Suggesting's preconditions, read live: `author` moves through `setAuthor`. */
  const suggestingGuards = () => ({ reviewEnabled, hasAuthor: Boolean(author) });
  /** A runtime `setEditingMode('suggesting')` refused for the author alone, waiting for one. */
  let pendingSuggestingRequest = false;
  let pendingHostModeFallback: DocumentEditingMode | null = null;
  // Raises the configuration error once, from a later task (`destroyed` exists by then).
  const suggestingReporter = createSuggestingConfigurationReporter({
    stillMissing: () =>
      !destroyed && author === undefined && standingRejection(null) === SUGGESTING_AUTHOR_REASON,
    emit: (error) => emitError(error),
  });
  // Resolve the host's explicit opening mode before the first mount reads it.
  const openingModeDecision = hostConfig.openingModeDecision(suggestingGuards());
  if (openingModeDecision.mode !== null) editingMode = openingModeDecision.mode;
  if (openingModeDecision.rejection !== null) facadeRejection = openingModeDecision.rejection;
  suggestingReporter.report(openingModeDecision.rejection);

  let surface: PaginatedSurface | null = null;
  const unsupported = createUnsupportedElementState(config.unsupportedElementRules, () => surface);
  // Host chrome registered before attach, re-applied to every rebuilt surface (see mount).
  let remoteCaretLabelHost: RemoteCaretLabelHost | null = null;
  const openingIndicator = preparedOpen.openingIndicatorChrome(() => surface);
  const openFailure = createDocumentOpenFailureState(() => {
    bump();
    emitSelectionChange();
  });
  let unsubscribeSession: Unsubscribe | null = null;
  // What the last emitted tick reported, so a publish that moved nothing observable stays
  // quiet — and one that moved only surface state does not. See `surface-publish-signal.ts`.
  const publishSignal = createPublishSignal();
  /** One page-count notice per task, after the render that moved it. */
  let pagesNoticeQueued = false;
  const pagesNotice = (): void => {
    if (pagesNoticeQueued) return;
    pagesNoticeQueued = true;
    globalThis.queueMicrotask(() => {
      pagesNoticeQueued = false;
      if (!destroyed) emitSelectionChange();
    });
  };
  /** The revision the last surface publish showed; see the idle anchor warm-up. */
  let lastPublishedRevision: number | undefined;
  const views = createEditorViews({
    surface: () => surface,
    destroyed: () => destroyed,
    changed: () => (bump(), emitSelectionChange()),
    emitError: (error) => emitError(error),
    capability: (command) =>
      canEditorViewCommand(command, destroyed, reviewEnabled, editingModeRefusal),
  });
  let destroyed = false;

  /** The measurer built per LOAD from `config.fonts` plus the document's embedded faces. */
  let shapedMeasurer: TextMeasurer | undefined;
  let shapedProducer: string | undefined;
  /**
   * Browser registration for this document's embedded faces, under engine-minted aliases
   * (issue #78 — a file's own family name must never reach the page-global FontFaceSet).
   * Owned per load: a replaced document and `destroy()` remove exactly these faces.
   */
  let embeddedFaces: EmbeddedFontFaceRegistration | null = null;
  let disposeShapedFonts = (): void => {};
  let fontMeasurementEpoch = 0;
  function disposeEmbeddedFaces(): void {
    embeddedFaces?.dispose();
    embeddedFaces = null;
  }
  // Each async result belongs to one document load.
  let loadSeq = 0;
  let fontRequestSeq = 0;
  const fontLifetime = createFontResolutionLifetime();
  let configuredFonts = config.fonts;
  // Retain catalog metadata separately from byte admission and shaping.
  let resolvedFontConfiguration: FontConfigurationBase | undefined;
  const fontConfiguration = (): FontConfigurationBase | undefined =>
    typeof configuredFonts === 'function' ? resolvedFontConfiguration : configuredFonts;
  const liveFontDefaultFamily = () => configuredDefaultFontFamily(fontConfiguration());
  const textInOwnFonts = () =>
    usedFamiliesCovered(surface, liveFontDefaultFamily(), (family) => fontFamilyCovered(family));
  const liveFonts = createLiveFontResolution(
    () => {
      const session = preparedFontSession ?? surface?.session;
      if (destroyed || !session) return null;
      // A document still preparing has laid out nothing: the surface is the previous one.
      const laidOut = preparedFontSession ? undefined : surface;
      const caret = laidOut && (snapshotNow().formatting ?? undefined);
      const defaultFamily = liveFontDefaultFamily();
      return {
        generation: fontLifetime.generation,
        dynamic: typeof configuredFonts === 'function',
        families: () => liveFontFamilies(session, caret?.fontFamily, defaultFamily),
        faces: () =>
          requestFaces(laidOut ? usedFontFacesOf(laidOut) : undefined, defaultFamily, caret),
        defaultFamily,
      };
    },
    async (request, late?: LateFontDelivery) => {
      const target = preparedFontSession ? { session: preparedFontSession } : surface;
      lateFonts.settle(late); // quietly; every install exit announces below, refused or thrown
      try {
        if (target) await resolveDocumentFonts(loadSeq, target, request, late?.full);
      } finally {
        if (late && !destroyed) (bump(), emitSelectionChange());
      }
    }
  );
  let fontsResolving = false;
  let installedFontKey: string | undefined;
  const fontsDone = (): void => ((fontsResolving = false), bump());
  const lateFonts = createLateFontArrival({
    deliver: (generation, delivery) => liveFonts.deliver(generation, delivery),
    changed: () => (bump(), emitSelectionChange()),
    report: (cause) => reportFontError(toEditorFontError(cause)),
    editedAt: () => localEditAt(surface),
  });
  const fontHold = createFontPickHold({
    dynamic: () => typeof configuredFonts === 'function',
    shaping: () => !!shapedMeasurer,
    covered: (family) => fontFamilyCovered(family),
    served: () => fontConfiguration()?.supportedFamilies,
    asked: (family) => liveFonts.asked(family),
    requested: () =>
      surface ? liveFontFamilies(surface.session, undefined, liveFontDefaultFamily()) : [],
  });
  /**
   * Local-resolution probe for the compatibility notice, created against the attached
   * container's document and dropped with it — a probe answers for ONE platform's font
   * set, and headless (no container) honestly reports nothing substituted.
   */
  let localFontProbe: ((family: string) => boolean) | null = null;
  const documentFontsNow = () => surface?.session.documentFonts() ?? [];
  // Unfiltered until an on-demand answer says what is served; installed-only after that.
  const listable = (f: string) => (!!configuredFonts && !fontConfiguration()) || probeLocalFont(f);
  const probeLocalFont = (family: string): boolean => {
    if (!localFontProbe) {
      localFontProbe = createLocalFontProbe(
        container ? tryCreateBrowserCanvasContext(container.ownerDocument) : null
      );
    }
    return localFontProbe(family);
  };
  /**
   * Families the active document can be laid out in, from {@link coveredFontFamiliesOf}.
   * Rebuilt per load, because an on-demand resolver's coverage is not known until a
   * document has asked.
   */
  let coveredFontFamilies: ReadonlySet<string> = new Set();
  let documentSubstitutedFamilies: ReadonlySet<string> = new Set();
  const fontFamilyCovered = (family: string): boolean =>
    coveredFontFamilies.has(family.toLowerCase()) || embeddedFaces?.alias(family) !== undefined;
  /**
   * While font work is still in flight the answer would flicker: embedded faces register
   * at resolution, so a file whose own fonts are arriving must not flash a notice first.
   *
   * Report rendered glyph families, including projected marks. The detection helper
   * combines admitted document aliases with platform and metric-twin checks.
   */
  const deriveFontSubstitutions = (): readonly string[] => {
    if (!surface || fontsResolving || lateFonts.pending()) return EMPTY_FONT_SUBSTITUTIONS;
    return detectFontSubstitutions(
      renderedAndUnmappedSymbolFaces(surface.session),
      fontFamilyCovered,
      probeLocalFont,
      documentSubstitutedFamilies
    ).filter((family) => !fontHold.loading(family));
  };

  // ── State tick + cached snapshot ─────────────────────────────────────────────────────
  let stateVersion = 0;
  let cachedSnapshot: EditorSnapshot | null = null;
  let cachedAuthor: string | undefined;
  /** The caret the cached snapshot was derived for — see `snapshotNow`. */
  let cachedCaret: ReturnType<PaginatedSurface['state']>['selection'] | null = null;
  /** The document revision the cached snapshot was derived for — see `snapshotNow`. */
  let cachedRevision = -1;
  /** Monotonic mount generation for async image mutation preconditions. */
  let mountGeneration = 0;
  let cachedVersion = -1;
  /** Closed until a mounted review model confirms that the document has review content. */
  let reviewPaneOpen = false;
  let reviewDisplayMode: ReviewDisplayMode =
    config.reviewDisplayMode ?? (reviewEnabled ? 'all-markup' : 'proposed');
  if (!['all-markup', 'simple-markup', 'proposed', 'original'].includes(reviewDisplayMode))
    throw new TypeError('Invalid reviewDisplayMode');
  if (config.reviewDisplayMode && config.reviewDisplayMode !== 'proposed' && !reviewEnabled)
    throw new TypeError('reviewDisplayMode requires a review module');
  // Refused, not approximated: a collaboration session shares one unit per field.
  const fieldScope = surfaceFieldResultsScope({
    fieldResults: config.fieldResults,
    collaborationModel: modules.collaboration ?? undefined,
  });
  // Closures only: every dependency is read when a command runs, not at construction.
  const protection = createDocumentProtectionCommands({
    surface: () => surface,
    destroyed: () => destroyed,
    editingMode: () => editingMode,
    hostViewOnly: () => hostConfig.mode() === 'view',
    publish: () => {
      bump();
      emitSelectionChange();
    },
    decision: () => documentTrackingDecision(),
    tracking: documentTracking,
    adopt: (decision) => {
      facadeRejection = decision.rejection ?? standingRejection(null);
      if (decision.mode !== null) {
        engineAdoptedViewing = decision.mode === 'viewing';
        applyEditingMode(decision.mode);
      }
      bump();
      emitSelectionChange();
    },
  });

  /** Called at every place observable state can move. Derivation stays lazy. */
  function bump(): void {
    stateVersion += 1;
  }

  const events = createEditorEvents(snapshotNow, () => container?.ownerDocument ?? null);
  const { emitError, emitDocumentChange, emitSelectionChange } = events;
  const diagnostics = createEditorDiagnostics({
    modules,
    events,
    customNodes: reportDiagnostic,
    // A thrown open, at mount or in a later layout slice, is a refusal the reader sees.
    onOpenCrash: openFailure.crash,
  });
  const suggesting = () => editingMode === 'suggesting';

  const reviewDialogs = createReviewDialogs(config.revisionMarkup, {
    container: () => container,
    surface: () => surface,
    viewing: () => editingMode === 'viewing' || hostConfig.mode() === 'view',
    destroyed: () => destroyed,
    contribution: () => modules.review,
    translate: () => hostConfig.translate(),
    apply: (value) => {
      surface?.setRevisionMarkup(value);
      bump();
    },
    changed: (value) => {
      emitSelectionChange();
      events.emitRevisionMarkupChange(value);
    },
  });

  /** The pages now live in `document`: per-document fonts, the fit observer, and a report. */
  function followHost(document: Document): void {
    reviewDialogs.destroyDialogs(); // their pickers listen to the window they opened in
    embeddedFaces?.showIn(document);
    zoomLane.detach();
    zoomLane.attach();
    bump();
    emitSelectionChange();
  }

  /** Ends an open preview: it covers the surface this replaces, parks, or destroys. */
  let endPreview = (): void => {};
  function teardownSurface(): void {
    endPreview();
    reviewDialogs.destroyDialogs();
    unsubscribeSession?.();
    unsubscribeSession = null;
    surface?.destroy();
    surface = null;
    publishSignal.reset();
    mountGeneration += 1;
  }

  // The scale, the mode, and the fit that keeps them agreeing. Callbacks rather than values,
  // because both are replaced under it — a load rebuilds the surface, `attach` replaces the
  // container — and a lane handed either directly would go on rescaling the previous one.
  const zoomLane = createZoomLane(config, {
    container: () => container,
    surface: () => surface,
    bump,
    emitSelectionChange,
    reviewPaneScrolls: () => reviewPane.current().overflow === 'scroll',
  });
  const scaleOf = (): number => zoomLane.scale();
  const highlights = createTextHighlights({
    surface: () => surface,
    container: () => container,
    flushOpen: () => openScheduler.flush(),
    translate: () => hostConfig.translate() ?? null,
  });
  const selectionRead = createSelectionRangeRead(() => surface);
  const paragraphReads = createParagraphTextReads({
    surface: () => surface,
    fieldResults: fieldScope.mode,
  });

  function mountBytes(...args: Parameters<typeof mountBytesNow>): void {
    const refreshing = refreshHost?.source !== undefined;
    try {
      if (deferredRefreshBytes === args[0]) {
        deferredRefreshBytes = null;
        loadBytes(args[0], { immediate: true, continueDeferredRefresh: true });
        return;
      }
      mountBytesNow(...args);
      if (refreshing && surface && preparedOpen.stillOpening(surface))
        openingRefreshBytes = args[0];
      else refreshHost?.mounted(args[0]);
    } catch (error) {
      diagnostics.openCrashed(error);
      refreshHost?.mounted(args[0], error);
      if (!refreshing) throw error;
    }
  }

  /**
   * What the pages look like, apart from the document and the editing mode: shared by the
   * live mount and by a preview, so a preview paints exactly what a commit would. Never a
   * collaboration model or a callback, which belong to the live surface alone.
   */
  function displaySurfaceOptions(): PaginatedSurfaceRuntimeOptions {
    return {
      unsupportedElementRules: unsupported.current(),
      scale: scaleOf(),
      ...views.snapshot(),
      // What a run with no authored font is REPORTED as, matching what it is measured
      // as (`resolveFont`'s fallback below) — so a blank document's font box reads
      // "Calibri", not an em-dash.
      defaultFontFamily: configuredDefaultFontFamily(fontConfiguration()),
      translate: hostConfig.translate(),
      drawingStrings: hostConfig.drawingStrings(),
      locale: hostConfig.locale(),
      // Suggesting needs both: an author to attribute a proposal to, and the mode itself,
      // which survives a document reload because the reader chose it, not the file.
      ...(author ? { author } : {}),
      // Presentation policy for tracked changes, applied wherever revision markup paints.
      // The facade's state, not `config`: a reload keeps a live `setRevisionStyles`.
      ...(revisionStyleState.current() !== undefined
        ? { revisionStyles: revisionStyleState.current() }
        : {}),
      reviewAuthorSlots,
      revisionAuthorVisibility: reviewAuthorVisibility,
      revisionMarkup: reviewDialogs.markup.current(),
      ...preparedOpen.sessionOpenOptions(reviewModelOption(modules, reportDiagnostic), config),
      pairsReplacements: pairedPin.lightsPair,
      ...(shapedMeasurer
        ? { measurer: shapedMeasurer, ...(shapedProducer ? { producer: shapedProducer } : {}) }
        : {}),
      ...(embeddedFaces ? { fontAlias: fontHold.alias(embeddedFaces.alias) } : {}),
      ...configSurfaceOptions(config),
      ...(fieldScope.mode === 'editable' ? { fieldResults: fieldScope.mode } : {}),
    };
  }

  function mountBytesNow(
    bytes: Uint8Array,
    initialSelection?: SemanticSelection,
    initialTextFormInput?: PendingTextFormInput
  ): void {
    initialTextFormInput ??= pendingTextFormInputs.get(bytes);
    pendingTextFormInputs.delete(bytes);
    preparedFontSession = null;
    if (!container) {
      // Detached: no DOM work. The bytes wait for `attach`, which mounts them under
      // whatever measurer has resolved by then. A previous document's parse failure is
      // not THESE bytes' state — `attach` re-derives any real error. A parked surface goes.
      teardownSurface();
      pendingBytes = bytes;
      if (initialTextFormInput) pendingTextFormInputs.set(bytes, initialTextFormInput);
      openFailure.clear();
      diagnostics.openDeferred();
      bump();
      return;
    }
    diagnostics.openMounting();
    teardownSurface();
    let publishedReviewFilterState = reviewAuthorVisibility.stateKey;
    const result = mountPaginatedSurface(container, bytes, {
      ...displaySurfaceOptions(),
      ...views.surfaceOptions(),
      initialSelection,
      initialTextFormInput,
      editingMode:
        editingMode === 'suggesting' ? 'suggest' : editingMode === 'viewing' ? 'view' : 'edit',
      // The free engine renders the FINAL-STATE projection (Word's "No Markup"):
      // insertions applied, deletions hidden, lossless on save. Markup rendering is a
      // review-module display mode; with one registered the surface keeps the layout
      // default (`all-markup`), which is what the review rail annotates.
      revisionDisplayMode: reviewEnabled ? reviewDisplayMode : 'proposed',
      ...diagnostics.surfaceHooks(suggesting, () => surface),
      ...preparedOpen.takePreparedOpen(bytes),
      ...(modules.collaboration ? { collaborationModel: modules.collaboration } : {}),
      onHostMoved: followHost,
      onDragEvent: (kind, event, position) => {
        if (surface && container)
          events.emitDragEvent(kind, {
            event,
            position: capturePointPosition(surface, position),
          });
      },
      onTrackedChange: () => {
        if (reviewPaneOpen || !reviewPane.opensOnTrackedChange()) return;
        reviewPaneOpen = true;
        bump();
        emitSelectionChange();
      },
      tocLabels: hostConfig.tocLabels(),
      onChange: (state) => {
        // The mount-time render reports before `surface` is assigned; nothing observable
        // has changed at that point, so it is not a selection change.
        if (!surface) return;
        // A publish can change layout-derived state without moving the selection —
        // toggling bold moves formatting agreement, not the caret. Worse, a `change`
        // handler may have read `snapshot()` MID-COMMIT (the session notifies before the
        // layout publishes) and cached a derivation against the layout this publish just
        // replaced. Either way the cache is stale: bump unconditionally. A value-equal
        // re-derivation returns the previous snapshot reference, so a no-op publish costs
        // one comparison, never a spurious re-render.
        bump();
        protection.sync();
        liveFonts.schedule();
        // Only a publish that moved no revision: an edit's publish reaches the rail through
        // `change`, which rebuilds the anchors anyway, and warming those too only made garbage.
        const publishedRevision = surface?.session.packageRevision();
        const revisionMoved = publishedRevision !== lastPublishedRevision;
        lastPublishedRevision = publishedRevision;
        if (reviewEnabled && container && surface && !revisionMoved) {
          const published = surface;
          warmAnchorsWhenIdle(published, hostWindowOf(container), () => {
            // Nothing to anchor without review items: the rail skips the index then too.
            if (surface === published && published.session.reviewItems().length > 0)
              anchorIndexOf(published.publishedLayout());
          });
        }
        const displayModeMoved =
          reviewEnabled && reviewDisplayMode !== surface.revisionDisplayMode();
        if (displayModeMoved) reviewDisplayMode = surface.revisionDisplayMode();
        const reviewVisibilityMoved =
          publishedReviewFilterState !== reviewAuthorVisibility.stateKey || displayModeMoved;
        publishedReviewFilterState = reviewAuthorVisibility.stateKey;
        // The caret is not the only observable thing that moves: an armed typing format, an
        // open furniture story, how a drawing came to be selected and the format painter's
        // arming all move without it, and each has no other channel to a host.
        const moved = publishSignal.moved(state, surface);
        if (!reviewVisibilityMoved && moved === 'nothing') return;
        // Only the page count: a background layout, still inside its render. Heard after it,
        // so a host reading the snapshot cannot commit buffered typing in the middle of one.
        if (!reviewVisibilityMoved && moved === 'pages') pagesNotice();
        else emitSelectionChange();
      },
    } as PaginatedSurfaceOptions & { readonly onTrackedChange?: () => void });
    if (!result.ok) {
      openFailure.reject(result.reason, result.limit, result.detail);
      // Failure is observable state too: `snapshot().parseError` moved.
      bump();
      // The message names the reason only: `detail` can quote the file, and hosts log errors.
      emitError(editorError(result.reason, `failed to open document: ${result.reason}`));
      diagnostics.openRejected(result.reason, result.limit, result.detail);
      return;
    }
    openFailure.clear();
    surface = result.surface;
    embeddedFaces?.showIn(container.ownerDocument);
    mountedSeq = loadSeq;
    // A refresh or recovery mounts different content: node ids no longer name the same text.
    highlights.attach(surface, refreshHost?.source !== undefined);
    // Before anything can publish: the mount decides the mode itself just below, and a sync
    // firing in between would decide a second time and clear what the first one published.
    protection.prime();
    // Once the review model exists, show the pane when it found content and the module allows.
    reviewPaneOpen = reviewEnabled && reviewPane.opensOnLoad(surface.session.reviewItems());
    publishSignal.adopt(surface);
    if (pendingHostModeFallback !== null) applyHostModeDecision(pendingHostModeFallback, false);
    else adoptDocumentTracking();
    sweepCustomNodePayloadsOnOpen(surface, modules);
    // A large open ends at the mount; its remaining pages lay out behind the live pages.
    const opened = surface;
    if (!preparedOpen.stillOpening(opened)) diagnostics.openSettled(opened);
    else
      continueOpeningLayout(
        opened,
        withOpeningRefresh(
          {
            current: () => surface,
            view: () => hostWindowOf(container),
            slice: (run) => diagnostics.continueOpen(run),
            settled: () => diagnostics.openSettled(opened),
          },
          {
            take: () => [openingRefreshBytes, (openingRefreshBytes = null)][0],
            crashed: (error) => diagnostics.openCrashed(error),
            mounted: (bytes, error) => refreshHost?.mounted(bytes, error),
          }
        )
      );
    mountGeneration += 1;
    // A surface is rebuilt on load and on the font remount, and it comes up editable. The
    // engine's own guards refuse the WRITE, but the pages layer stays `contenteditable`
    // without this — so a document open for viewing still drew a caret, still opened an IME,
    // and still told a screen reader it was writable. Reads the CURRENT mode, not just the
    // constructed one, so a remount after `setEditingMode('viewing')` comes up right.
    surface.setEditable(editingMode !== 'viewing');
    // Same remount rule for the host's caret-label host and opening indicator: a rebuilt
    // surface that forgot them would fall back to the default name labels and spinner.
    if (remoteCaretLabelHost !== null) surface.setRemoteCaretLabelHost(remoteCaretLabelHost);
    openingIndicator.adopt(surface);
    // Same remount rule for the host's activation filter: the rail set it once, and a
    // rebuilt surface that forgot it would activate cards the rail does not render.
    if (reviewActivationExclusions !== null) {
      surface.setReviewActivationExclusions(reviewActivationExclusions, {
        formattingKinds: reviewActivationFormattingKinds,
      });
    }
    // `result.surface`, not the reassignable `surface`: this subscription is THIS session's.
    unsubscribeSession = subscribeDocumentChanges(result.surface, {
      refitIfPageResized: () => zoomLane.refitIfPageResized(),
      bump,
      emit: emitDocumentChange,
      wantsParagraphs: events.hasParagraphsChangeHandlers,
      emitParagraphs: events.emitParagraphsChange,
      defer: (run) => events.defer(run, true),
    });
    refreshHost?.contentMounted(bytes);
    // The page's size is only knowable now — it comes from this document's section properties
    // — so a fit mode resolves here. Synchronous on purpose: it lands in the same task as the
    // mount, so the browser paints once at the fitted scale, not at 100% and then corrected.
    //
    // AFTER the subscription above, because a fit that moves the scale EMITS, and a host
    // handler that throws from that emit would otherwise abort this function with the surface
    // assigned but `unsubscribeSession` unset — an editor that types but never re-renders.
    zoomLane.attach();
    // The document arrived: an external store subscribed to `change`/`selectionChange`
    // must learn about it, exactly as it learns about any later commit. Without these a
    // store bound before `load()` never re-reads and keeps rendering "no document".
    bump();
    emitDocumentChange({
      revision: surface.session.packageRevision(),
      source: refreshHost?.source ?? 'load',
    });
    emitSelectionChange();
    liveFonts.schedule(true);
  }

  /** A NEW document: forget the previous document's measurer, then mount. */
  function loadBytes(
    bytes: Uint8Array,
    options: { immediate?: boolean; continueDeferredRefresh?: boolean } = {}
  ): void {
    const immediate = options.immediate ?? false;
    // Completing an earlier deferred refresh is not a new host request.
    if (!options.continueDeferredRefresh) fontRequestSeq += 1;
    // A deferred refresh re-enters from its scheduled mount. Keep that scheduler alive
    // so its remaining opening slices clear the preview and restore pointer input.
    if (!immediate) {
      openScheduler.cancel();
      openingRefreshBytes = null;
    }
    // Keep the live font resources intact until a deferred refresh actually mounts.
    openFailure.clear();
    preparedFontSession = null;
    deferredRefreshBytes = null;
    if (refreshHost?.source && !immediate && container && openScheduler.shouldYield(bytes)) {
      deferredRefreshBytes = bytes;
      openScheduler.schedule(bytes);
      return;
    }
    pendingTextFormInputs = new WeakMap();
    diagnostics.openStarted(bytes);
    // The previous document can leave its comments pane open. Close it before a deferred
    // open publishes `isOpening`, so the loading page uses the full centred workspace.
    reviewPaneOpen = false;
    loadSeq += 1;
    const lifetime = fontLifetime.advance();
    try {
      reviewAuthorSlots = createStableReviewAuthorSlots();
      reviewAuthorVisibility.showAll();
      forgetFonts();
      lateFonts.clear();
      // BEFORE the mount, so the initial paint materializes the pages actually in view.
      // Only here, never in `mountBytes`: the font remount and `attach` re-enter that
      // function for the SAME document and must keep the reader's place.
      if (container && !refreshHost?.source) scrollToDocumentStart(container);
      // A big live open yields a frame first and drops the old document now: no stale chrome.
      if (!immediate && container && openScheduler.shouldYield(bytes)) {
        teardownSurface();
        openScheduler.schedule(bytes);
      } else mountBytes(bytes);
    } finally {
      lifetime.cancelPrevious();
    }
  }

  /**
   * Drop every installed face and the answer that chose them. An on-demand answer describes the
   * document (or font origin) that asked for it: carried on, it would offer stale families in
   * the font picker. A superseded resolution's stale guard refuses to touch state, so the flag
   * resets here, or a load that starts no font work reports `resolving: true` forever.
   */
  function forgetFonts(): void {
    shapedMeasurer = undefined;
    shapedProducer = undefined;
    resolvedFontConfiguration = undefined;
    coveredFontFamilies = new Set();
    documentSubstitutedFamilies = new Set();
    disposeEmbeddedFaces();
    disposeShapedFonts();
    disposeShapedFonts = () => {};
    ((fontsResolving = false), fontHold.clear());
  }

  /** {@link forgetFonts}, then measure the mounted document with the fallback measurer. */
  function fallBackToDefaultFonts(): void {
    forgetFonts();
    if (surface) {
      const fallback = browserFallbackMeasurer(container, scaleOf(), surface.session);
      const producer = `${fallback.producer}+fonts:${++fontMeasurementEpoch}`;
      const defaultFontFamily = configuredDefaultFontFamily(fontConfiguration());
      const measurement = { measurer: fallback.measurer, producer, defaultFontFamily };
      updateSurfaceMeasurement(surface, { ...measurement, fontAlias: undefined }, false);
    }
    bump();
    emitSelectionChange();
  }

  function reportFontError(
    error: EditorFontError,
    sequence = loadSeq,
    generation = fontLifetime.generation
  ): void {
    reportEditorFontError(
      error,
      { config, events, diagnostics },
      () => !destroyed && sequence === loadSeq && generation === fontLifetime.generation
    );
  }

  // Fonts resolve per load: explicit sources beat embedded faces, then substitutions.
  // A large open shapes between prepare/mount; otherwise it remeasures the fixed measurer later.
  // Refused faces report and drop; remaining faces admit, or fixed measurement keeps editing usable.
  async function resolveDocumentFonts(
    seq: number,
    mounted: { readonly session: preparedOpen.FontSession },
    asked: LiveFontRequest,
    late?: FontConfigurationFragment
  ): Promise<void> {
    const lifetime = fontLifetime.capture();
    const current = () => !destroyed && seq === loadSeq && lifetime.current();
    const reportForLoad = (error: EditorFontError) =>
      reportFontError(error, seq, lifetime.generation);
    const configured = configuredFonts;
    const embedded = mounted.session.embeddedFonts();
    // The zero-config, nothing-embedded common case does NO font work at all: no
    if (!configured && embedded.length === 0) return;
    if (late && lateFacesInstalled(late, resolvedFontConfiguration)) return;
    if (!late && !resolvedFontConfiguration) initializeHarfBuzz().catch(() => {});
    fontsResolving = true;
    bump();
    try {
      // On-demand configurations resolve HERE rather than at construction, which is the
      // whole point of the function form: the document is parsed and mounted by now, so
      // the resolver is told what the file actually asks for and can skip everything
      // else. A resolver that throws lands in this function's catch and degrades to the
      // fixed measurer, exactly like a failed byte source.
      const { plan: documentFonts, request: documentRequest } = documentFontResolutionRequest(
        mounted.session,
        asked,
        fontConfiguration()
      );
      const request = { ...documentRequest, signal: lifetime.signal };
      // Installed families keep their own face; only missing ones fall back. Without a canvas
      // to probe with (headless), nothing counts as installed.
      const canProbe =
        !!container && tryCreateBrowserCanvasContext(container.ownerDocument) !== null;
      const fallbacks = canProbe
        ? fallbacksForMissingFamilies(documentFonts.fallbacks, probeLocalFont)
        : documentFonts.fallbacks;
      const onOriginFailure = ({ cause }: { cause: unknown }) =>
        reportForLoad(toEditorFontError(cause));
      const answer = late
        ? await composeFontOrigins(lateFontOrigins(late, resolvedFontConfiguration), request, {
            onOriginFailure,
          })
        : typeof configured !== 'function'
          ? configured
          : resolvedFontConfiguration
            ? await composeFontOrigins(
                [resolvedFontConfiguration, defineFontResolver((next) => configured(next))],
                request,
                { onOriginFailure }
              )
            : await configured(request);
      const { now: raw, later } = answer ? splitDeferredAnswer(answer) : { now: answer };
      const explicit: FontConfigurationBase | undefined =
        typeof configured === 'function' || late ? normalizeFontResolverResult(raw) : raw;
      // Awaiting handed control back: this load may have been superseded (or the editor
      // destroyed) while the resolver ran; installing its answer would overwrite newer fonts.
      if (!current()) {
        if (seq === loadSeq && lifetime.current()) fontsResolving = false;
        return;
      }
      resolvedFontConfiguration = raw;
      if (later) lateFonts.track(later, raw, lifetime.generation, current);
      if (
        embedded.length === 0 &&
        (!explicit || (raw?.supportedFamilies?.length && !normalizeFontResolverResult(raw)))
      ) {
        fontsDone();
        emitSelectionChange();
        return;
      }
      const maxFontBytes =
        (explicit && 'maxFontBytes' in explicit ? explicit.maxFontBytes : undefined) ??
        HARD_MAX_FONT_BYTES;
      const boundedExplicit = boundedExplicitFontSources(explicit?.sources ?? [], maxFontBytes);
      const initialExplicitSources = boundedExplicit.sources;
      for (const source of boundedExplicit.dropped) {
        reportForLoad(explicitFontBudgetError(source));
      }
      let fromDocument = embeddedFontSourcesAfterExplicit(
        embedded,
        initialExplicitSources,
        maxFontBytes
      );
      // Once, on whatever path this load exits by. The set is not final until the refusal
      // loop settles — a rejected explicit source hands budget back and un-drops an
      // embedded face — so it cannot be reported eagerly, and the loop `await`s twice, so
      // a throw in there must not take the diagnostics with it. `finally` plus this flag
      // gives both: latest set, reported exactly once.
      let documentDropsReported = false;
      const reportDocumentDrops = (): void => {
        if (documentDropsReported) return;
        documentDropsReported = true;
        for (const drop of fromDocument.dropped) {
          reportForLoad(embeddedFontDropError(drop));
        }
      };
      let fonts = applyDocumentFontSubstitutions(
        composeFontConfiguration(
          { epoch: seq, ...explicit, sources: initialExplicitSources },
          fromDocument
        ),
        documentFonts,
        fallbacks
      );
      // A face request that brought no new bytes keeps the installed fonts: no relayout.
      const installKey = `${seq}\u0001${lifetime.generation}\u0001${fontInstallKey(fonts)}`;
      if (installKey === installedFontKey)
        return (reportDocumentDrops(), fontsDone(), emitSelectionChange());
      // Nothing to shape: the fixed measurer stays. An app that DID supply a
      // configuration deserves to hear that it contributed no usable source (every
      // fetch failed, or the fragment was substitutions-only against no document
      // faces) rather than a byte-limit error from the validator.
      if (fonts.sources.length === 0) {
        reportDocumentDrops();
        fontsDone();
        if (explicit) {
          reportForLoad(
            new EditorFontError(
              'missing',
              'the supplied font configuration contains no usable sources; the fixed measurer stays in effect'
            )
          );
        }
        return;
      }
      let shaping = await createLayoutShaping(fonts, undefined, fontShaping);
      // A newer load (or a destroy) landed while this one awaited: the shaping can never
      // be installed, so release its wasm objects rather than dropping it unreferenced,
      // and clear the in-flight flag only if this load is still the current one. Reads
      // `shaping` at call time, so it disposes whichever snapshot the caller just built.
      const supersededNow = (): boolean => {
        if (current()) return false;
        disposeLayoutShaping(shaping);
        if (seq === loadSeq && lifetime.current()) fontsResolving = false;
        return true;
      };
      if (supersededNow()) return;
      // Every "nothing survived" exit: report the drops, release the shaping that will
      // never be installed, and leave the fixed measurer in place.
      const bailToFixed = (superseded?: typeof shaping): void => {
        reportDocumentDrops();
        if (superseded) disposeLayoutShaping(superseded);
        fontsDone();
      };
      // Per-face degradation, reported: an embedded face the validator refused still
      // resolves — to a typed error. Probing here (map lookups, no shaping work) is what
      // turns a silent fixed-measurer fallback into a diagnosable one.
      const refusedIn = (snapshot: typeof shaping, composed: typeof fonts) => {
        const refused = new Set<string>();
        for (const source of composed.sources ?? []) {
          const resolved = snapshot.fonts.resolve(source.request);
          if (resolved instanceof FontResolutionError) {
            reportForLoad(toEditorFontError(resolved));
            refused.add(fontRequestKey(source.request));
          }
        }
        return refused;
      };
      const refusedRequests = refusedIn(shaping, fonts);
      // A refused direct face is worse than no face. Composition drops a substitution
      // whenever a direct source exists, so recompose without every refused request.
      try {
        if (refusedRequests.size > 0) {
          const explicitSurvivors = initialExplicitSources.filter(
            (source) => !refusedRequests.has(fontRequestKey(source.request))
          );
          const rejectedExplicit = explicitSurvivors.length !== initialExplicitSources.length;
          if (rejectedExplicit) {
            fromDocument = embeddedFontSourcesAfterExplicit(
              embedded,
              explicitSurvivors,
              maxFontBytes
            );
          }
          const embeddedSurvivors = fromDocument.sources.filter(
            (source) => rejectedExplicit || !refusedRequests.has(fontRequestKey(source.request))
          );
          const superseded = shaping;
          fonts = applyDocumentFontSubstitutions(
            composeFontConfiguration(
              { epoch: seq, ...explicit, sources: explicitSurvivors },
              { sources: embeddedSurvivors }
            ),
            documentFonts,
            fallbacks
          );
          if (fonts.sources.length === 0) return bailToFixed(superseded);
          shaping = await createLayoutShaping(fonts, undefined, fontShaping);
          disposeLayoutShaping(superseded);
          if (supersededNow()) return;
          const refusedAfterRebuild = refusedIn(shaping, fonts);
          if (refusedAfterRebuild.size > 0) {
            const admittedExplicit = explicitSurvivors.filter(
              (source) => !refusedAfterRebuild.has(fontRequestKey(source.request))
            );
            const admittedEmbedded = fromDocument.sources.filter(
              (source) => !refusedAfterRebuild.has(fontRequestKey(source.request))
            );
            const rejected = shaping;
            fonts = applyDocumentFontSubstitutions(
              composeFontConfiguration(
                { epoch: seq, ...explicit, sources: admittedExplicit },
                { sources: admittedEmbedded }
              ),
              documentFonts,
              fallbacks
            );
            if (fonts.sources.length === 0) return bailToFixed(rejected);
            shaping = await createLayoutShaping(fonts, undefined, fontShaping);
            disposeLayoutShaping(rejected);
            if (supersededNow()) return;
          }
        }
      } finally {
        reportDocumentDrops();
      }
      // Paint-side twin, BEFORE the remount: only ADMITTED faces, as the validated copies.
      // App sources register too, or paint would draw a name in whatever the platform picks
      // over shaped metrics. Aliases keep that safe; see `embedded-font-faces.ts`.
      const admitted = admittedFontSources(fonts.sources, shaping.fonts);
      const registration = await registerEmbeddedFontFaces(
        admitted,
        fontFaceEnvironmentOf(container?.ownerDocument),
        fonts.substitutions ?? []
      );
      if (!current()) {
        registration.dispose();
        supersededNow();
        return;
      }
      const previous = {
        embeddedFaces,
        coveredFontFamilies,
        documentSubstitutedFamilies,
        shapedMeasurer,
        shapedProducer,
        disposeShapedFonts,
      };
      try {
        embeddedFaces = registration;
        if (container) registration.showIn(container.ownerDocument); // it may have moved meanwhile
        coveredFontFamilies = coveredFontFamiliesOf(admitted, fonts.substitutions ?? []);
        documentSubstitutedFamilies = admittedDocumentSubstitutions(
          fonts,
          documentFonts,
          shaping.fonts,
          explicit?.substitutions
        );
        fontHold.release(fontFamilyCovered); // a picked family whose face arrived shows in it
        const paintAlias = fontHold.alias(embeddedFaces?.alias);
        const fallbackResolution = browserFallbackMeasurer(
          container,
          scaleOf(),
          mounted.session,
          paintAlias
        );
        const measurement = resolvedFontMeasurement(
          shaping,
          fonts,
          fallbackResolution,
          scaleOf(),
          ++fontMeasurementEpoch,
          (error) => current() && reportForLoad(error),
          fontHold.family
        );
        shapedMeasurer = measurement.measurer;
        shapedProducer = measurement.producer;
        fontsResolving = false;
        if (surface && mountedSeq === seq) {
          updateSurfaceMeasurement(surface, {
            measurer: shapedMeasurer,
            producer: shapedProducer,
            fontAlias: paintAlias,
            defaultFontFamily: configuredDefaultFontFamily(fontConfiguration()),
          });
        }
        if (!current()) {
          registration.dispose();
          disposeLayoutShaping(shaping);
          return;
        }
      } catch (error) {
        if (current()) {
          ({
            embeddedFaces,
            coveredFontFamilies,
            documentSubstitutedFamilies,
            shapedMeasurer,
            shapedProducer,
            disposeShapedFonts,
          } = previous);
        }
        registration.dispose();
        disposeLayoutShaping(shaping);
        throw error;
      }
      disposeShapedFonts = () => disposeLayoutShaping(shaping);
      installedFontKey = installKey;
      previous.disposeShapedFonts();
      previous.embeddedFaces?.dispose();
      bump();
      emitSelectionChange();
    } catch (error) {
      if (!current()) return;
      fontsDone();
      reportForLoad(toEditorFontError(error));
    }
  }

  /** The right-click TOC context, reference-stable while the id holds — see support. */
  const tocContextOf = createTocContextCache();
  const chartStateOf = createChartStateCache();

  function deriveSnapshot(): EditorSnapshot {
    const state = surface?.state() ?? null;
    const scope = surface?.activeScope?.() ?? SCOPE_BODY;
    return {
      scope,
      // "No document to work with, and nothing went wrong" — NOT "nothing painted". Bytes
      // count once handed over, pending (`pendingBytes`) or mounted (`surface`), so this
      // survives a detach/remount. That is load-bearing: a host may legitimately gate its
      // `DocxEditor.Content` on this flag, and a definition that only cleared once pages
      // painted would deadlock — nothing paints until Content mounts, and Content never
      // mounts while the flag is set. A parse failure clears it too; a document that
      // cannot open is not still arriving, and `parseError` is how that is reported.
      // A scheduled open counts as "bytes handed over" too, or a host gating its mount
      // point on this flag would unmount the container the scheduled mount needs.
      isLoading:
        openFailure.parseError === null &&
        surface === null &&
        pendingBytes === null &&
        !openScheduler.isScheduled(),
      // A supplied document on its way to painted pages. OVERLAY state only — gate
      // chrome on it, never the mount point; `isLoading` remains the gate-safe flag.
      isOpening: openScheduler.isScheduled() && !refreshHost?.source,
      parseError: openFailure.parseError,
      openFailure: openFailure.failure,
      // The LIVE mode, not only the construction-time one: hosts gate their chrome on this,
      // and it read `true` while every command was being refused with `locked`.
      editable:
        surface !== null &&
        surface.session.editable &&
        hostConfig.mode() !== 'view' &&
        editingMode !== 'viewing' &&
        !(container && refreshWriteBlocked(container)),
      zoom: zoomLane.zoom(),
      zoomMode: zoomLane.mode(),
      selection: selectionRangeOf(surface),
      selectionCollapsed: selectionCollapsedOf(state),
      selectionRange: selectionRead.selectionRange(),
      formatting: runFormattingOf(surface),
      table: tableContextOf(surface),
      tocContext: tocContextOf(state?.contextTocId ?? null),
      image: selectedImageStateOf(surface),
      chart: chartStateOf(surface),
      page: { current: currentPageOf(surface), total: totalPagesOf(surface) },
      canUndo: state?.canUndo ?? false,
      canRedo: state?.canRedo ?? false,
      pageSetup: pageSetupWhileOpening(openScheduler, surface),
      reviewPaneOpen,
      reviewPane: reviewPane.current(),
      ...views.snapshot(),
      documentProtection: protection.state(),
      revisionMarkup: reviewDialogs.markup.current(),
      reviewDisplayMode:
        surface && reviewEnabled ? surface.revisionDisplayMode() : reviewDisplayMode,
      hasReviewContent: surface?.session.hasReviewContent() ?? false,
      hiddenReviewAuthors: reviewAuthorVisibility.hiddenAuthorList,
      collaborationStatus: state?.collaborationStatus ?? 'inactive',
      editingMode,
      // A standing configuration refusal must not be hidden by an older surface refusal.
      lastRejection: facadeRejection ?? state?.lastRejection ?? null,
      fontSubstitutions: deriveFontSubstitutions(),
      // Reference-stable from the surface, and a shared frozen constant when there is no
      // surface — the snapshot cache below compares this field with `===`.
      formatPainter: state?.formatPainter ?? FORMAT_PAINTER_OFF,
    };
  }

  /**
   * The cached read model. Derives at most once per state tick, deep-freezes, and reuses
   * the previous `formatting`/`page` sub-objects (or the whole previous snapshot) when
   * value-equal, so references only change when values do.
   */
  let cachedFontConfiguration: FontConfigurationBase | undefined;
  let snapshotRetries = 0;
  function snapshotNow(): EditorSnapshot {
    if (cachedSnapshot && cachedVersion === stateVersion) return cachedSnapshot;
    const previous = cachedSnapshot;
    const fontsUnmoved = fontConfiguration() === cachedFontConfiguration;
    cachedFontConfiguration = fontConfiguration();
    const chromeSettled = views.chromeSettled(); // always called, so its counter resets
    const authorUnmoved = author === cachedAuthor && chromeSettled;
    cachedAuthor = author;
    const caret = surface?.state().selection ?? null;
    const caretUnmoved = selectionsMatch(caret, cachedCaret);
    cachedCaret = caret;
    const revision = surface?.session.packageRevision() ?? -1;
    const documentUnmoved = revision === cachedRevision;
    cachedRevision = revision;
    const entryVersion = stateVersion;
    const fresh = deriveSnapshot();
    // A derive that reads layout can land buffered typing, which moves state it already read.
    // Derive the moved state instead of caching a torn one. Bounded: a flush lands once.
    if (stateVersion !== entryVersion && snapshotRetries < 2) {
      snapshotRetries += 1;
      try {
        return snapshotNow();
      } finally {
        snapshotRetries -= 1;
      }
    }
    let next: EditorSnapshot = fresh;
    if (previous) {
      const formatting = formattingEqual(fresh.formatting, previous.formatting)
        ? previous.formatting
        : fresh.formatting;
      const page = pageEqual(fresh.page, previous.page) ? previous.page : fresh.page;
      const pageSetup = pageSetupEqual(fresh.pageSetup ?? null, previous.pageSetup ?? null)
        ? previous.pageSetup
        : fresh.pageSetup;
      const selection = docRangeEqual(fresh.selection, previous.selection)
        ? previous.selection
        : fresh.selection;
      const image = imageContextEqual(fresh.image, previous.image) ? previous.image : fresh.image;
      const table = tableContextEqual(fresh.table, previous.table) ? previous.table : fresh.table;
      const fontSubstitutions =
        previous.fontSubstitutions !== undefined &&
        fresh.fontSubstitutions !== undefined &&
        previous.fontSubstitutions.length === fresh.fontSubstitutions.length &&
        fresh.fontSubstitutions.every((family, i) => previous.fontSubstitutions![i] === family)
          ? previous.fontSubstitutions
          : fresh.fontSubstitutions;
      next = { ...fresh, formatting, page, pageSetup, selection, image, table, fontSubstitutions };
      // Reuse the previous REFERENCE only when neither the caret NOR the document moved.
      //
      // The snapshot is a lossy projection: `selection` is paragraph-granular (a
      // `DocRange` addresses paragraphs by `w14:paraId`, never by offset), and nothing in
      // it names the document revision. So two genuinely different states — a caret move
      // WITHIN a paragraph, a structural edit at an unmoved caret — derive value-equal
      // snapshots, and a host subscribed through `useSyncExternalStore` never re-renders —
      // freezing every control whose state is a question the snapshot does not carry,
      // because `toolbarCommandState` re-asks `Editor.can`/`isActive` only on a store tick.
      // A structure-only edit at an unmoved caret leaves every compared field equal.
      if (
        snapshotsEqual(next, previous) &&
        caretUnmoved &&
        documentUnmoved &&
        authorUnmoved &&
        fontsUnmoved
      ) {
        next = previous;
      }
    }
    cachedSnapshot = deepFreezeValue(next);
    cachedVersion = stateVersion;
    return cachedSnapshot;
  }

  if (config.document) {
    const bytes = normalizeSource(config.document);
    if (bytes) loadBytes(bytes);
    else {
      emitError(editorError('unsupported', openFailure.refuseSource(config.document)));
      diagnostics.openRejected('unsupported');
    }
  }

  /**
   * A counter that moves when the queue could differ, and not otherwise.
   *
   * The extracted ticker watches both store revisions, surface identity, active item, pane,
   * selection placement and reviewer filter. A monotonic tick lets subscribers compare with
   * `!==` without seeing a value repeat after undo or a new document load.
   */
  const reviewRevision = createReviewRevisionTicker({
    surface: () => surface,
    activeKey: activeReviewKeyNow,
    paneOpen: () => reviewPaneOpen,
    selectionAnchor: () => selectionPlacement()?.anchorY ?? null,
    authorFilterKey: () => reviewAuthorVisibility.stateKey,
  });

  // The surface derives the active card from its caret and explicit selection pin.
  // Sharing that answer keeps card state and painted highlights consistent.
  /** Shared by the placement flag and activation: an addressable, non-excluded range with a card. */
  function reviewItemActivatable(item: ReviewItem): boolean {
    if (firstReviewRange(item) === null || (item.kind === 'custom' && !item.carded)) return false;
    return !(
      item.kind === 'revision' &&
      reviewActivationExclusions !== null &&
      reviewActivationExclusions.includes(item.revisionKind) &&
      (item.revisionKind !== 'format' ||
        reviewActivationFormattingKinds === undefined ||
        reviewActivationFormattingKinds.includes(item.formattingKind ?? ''))
    );
  }
  const anchorIndexOf = createAnchorIndex((id) => textboxHostParagraphOf(surface, id));

  // Which header, footer, or notes part a card lives in, from the part name its range carries.
  const furnitureHomeOf = (item: ReviewItem) => furnitureHomeOfItem(surface?.session, item);
  const noteStoryScopeOf = (item: ReviewItem) => noteStoryScopeOfItem(surface?.session, item);

  /**
   * The note a card's range sits in, as the scope id `enterNote` takes.
   *
   * A note is a story like a header, but it is addressed by the NOTE rather than by the
   * part: one `footnotes.xml` holds every footnote, and entering it means entering one of
   * them. So the walk is part → note → its paragraphs, and the answer is the note whose
   * subtree holds the card's paragraph.
   */
  function noteHomeOf(item: ReviewItem): string | null {
    const range = firstReviewRange(item);
    const layout = surface?.publishedLayout();
    if (!range || !layout) return null;
    return noteScopeIndexOf(layout).get(range.start.paragraphId) ?? null;
  }

  /** The story a card's range lives in, for a write that must land in that part. */
  function storyScopeOfReviewItem(item: ReviewItem): StoryScope {
    const home = furnitureHomeOf(item);
    if (home !== null) return { kind: 'headerFooter', rId: home.rId };
    return noteStoryScopeOf(item) ?? { kind: 'body' };
  }

  function commentTargetRange(): { from: SemanticPosition; to: SemanticPosition } | null {
    return commentTargetRangeOf({
      surface,
      bodyOrder: () => {
        const layout = surface?.publishedLayout();
        return layout ? paragraphOrderOf(layout) : new Map();
      },
      openStoryOrder: openStoryParagraphOrder,
    });
  }

  /** The story the reader has open, in the vocabulary the store's writes take. */
  function openStoryScope(): StoryScope {
    const scope = surface?.activeScope();
    if (scope?.kind === 'headerFooter') return { kind: 'headerFooter', rId: scope.rId };
    if (scope?.kind === 'note') {
      const parsed = parseNoteScopeId(scope.id);
      if (parsed) return { kind: 'notesPart', noteKind: parsed.noteKind };
    }
    return { kind: 'body' };
  }

  /**
   * The story a PARAGRAPH lives in, which is what a write about that paragraph must target.
   *
   * The open scope is a near-enough proxy most of the time and wrong exactly when it
   * matters: nothing binds the selection to it, so a host that sets a body selection while
   * a header is open got an affordance offering to comment and a write that was then
   * refused. Paragraph ids are part-qualified, so the range answers this by itself.
   */
  function storyScopeOfParagraph(paragraphId: string): StoryScope {
    if (!surface) return { kind: 'body' };
    // From the id's own PART NAME. Asking each story for its paragraph list instead would resolve
    // every scope in turn, and resolving a scope OPENS a story store: one call opened every header
    // and footer in the document, and the store cap (64) is a permanent ceiling because a store
    // whose part is still in the package is never evicted. On a 40-section document that left 18
    // headers unopenable for the rest of the session — commenting in a footnote broke header
    // editing. A logical id from a collaboration session names no part; the story indexes find it.
    const hash = paragraphId.indexOf('#');
    const partName =
      hash === -1 ? partOfNodeId(surface.session, paragraphId)?.name : paragraphId.slice(0, hash);
    if (partName === undefined) return openStoryScope();
    if (partName.length === 0 || partName === surface.session.part().name) {
      return { kind: 'body' };
    }
    for (const section of surface.session.headerFooterResolutionBySection()) {
      for (const slots of [section.headers, section.footers]) {
        for (const slot of slots.values()) {
          if (slot.partName === partName) return { kind: 'headerFooter', rId: slot.rId };
        }
      }
    }
    for (const noteKind of ['footnote', 'endnote'] as const) {
      if (resolveNotesPart(surface.session.currentPackage(), noteKind)?.name === partName) {
        return { kind: 'notesPart', noteKind };
      }
    }
    // Unknown to every story: fall back to where the reader is, which is what the write
    // would have used anyway, and let the store refuse it.
    return openStoryScope();
  }

  /** Paragraph order of the story the reader currently has open, empty for the body. */
  function openStoryParagraphOrder(): ReadonlyMap<string, number> {
    if (!surface) return new Map();
    const story = openStoryScope();
    if (story.kind === 'body') return new Map();
    const index = new Map<string, number>();
    for (const [position, id] of surface.session.paragraphIdsIn(story).entries()) {
      index.set(id, position);
    }
    return index;
  }

  /** Where a comment on the current selection would sit. */
  function selectionPlacement(): { readonly anchorY: number; readonly pageIndex: number } | null {
    // STILL LOAD-BEARING, though it covers less than it used to. Activation leaves a
    // collapsed caret, and `commentTargetRange` already declines a collapsed selection — so
    // the ordinary case needs no help. What this catches is the RETAINED range: a reader who
    // had text selected, then opened a card whose caret landed inside it, would otherwise be
    // offered a second comment on a selection they are no longer looking at. Asked of the
    // SURFACE, which owns the pin and invalidates it by value the moment the reader selects
    // anything else; a copy kept here was written on only one of activation's three branches,
    // so a header or note card still offered to comment on itself. `commentTargetRange` stays
    // untouched, so replying over the activated text still works.
    if (surface && surface.activatedReviewKey() !== null) return null;
    const range = commentTargetRange();
    const layout = surface?.publishedLayout();
    if (!range || !layout) return null;
    const anchor = anchorIndexOf(layout).get(range.from.paragraphId);
    if (!anchor) return null;
    return {
      pageIndex: anchor.pageIndex,
      anchorY: anchor.contentY + anchorLineY(anchor, range.from.paragraphId, range.from.offset),
    };
  }

  /** Which item is open, as the SURFACE reports it — it also paints the band. */
  function activeReviewKeyNow(): string | null {
    return surface?.activeReviewKey() ?? null;
  }

  const rankReviewItems = createReviewRanker();
  const keepPlacements = createPlacementKeeper<ReviewItemPlacement>();

  /** The queue plus geometry, per call; the session memoizes the queue per revision. */
  function reviewPlacements(query?: ReviewItemQuery): readonly ReviewItemPlacement[] {
    if (!reviewEnabled) return [];
    // Kind exclusion and default replacement pairing; see `review-replacement-pairs.ts`.
    const visible = reviewAuthorVisibility.filterItems(surface?.session.reviewItems() ?? []);
    const items = narrowReviewItems(visible, query);
    const withPlacement = query?.placement !== false;
    let anchors: ReadonlyMap<string, ReviewParagraphAnchor> | null = null;
    if (withPlacement && items.length > 0) {
      const layout = surface?.publishedLayout() ?? null;
      if (layout) anchors = anchorIndexOf(layout);
    }
    const activeKeys = litReviewKeys(() => visible, activeReviewKeyNow(), pairedPin.lightsPair());
    // The queue ranks furniture stories after the whole body (tree order), but the rail
    // stacks cards top-down and never moves one UP past its anchor — a header card sorted
    // after page 40's cards would render at the rail's bottom, pages away from the header
    // it annotates. Reorder by the page a card sits beside; within a page, header cards
    // first, then body cards in document order, then footer cards. The sort is stable, so
    // body cards keep the tree order the queue promised.
    const groupOf = (item: ReviewItem): number => {
      const home = furnitureHomeOf(item);
      return home === null ? 1 : home.kind === 'header' ? 0 : 2;
    };
    const revision = surface?.session.packageRevision() ?? -1;
    const ranking = rankReviewItems(items, anchors, revision, groupOf);
    const { geometries, order } = ranking;
    const locked = reviewChangesLocked(surface);
    return keepPlacements(
      items,
      anchors !== null,
      order.map((position) => {
        const item = items[position]!;
        return reviewItemPlacement(item, {
          anchorY: geometries[position]?.y ?? null,
          pageIndex: geometries[position]?.pageIndex ?? null,
          // A paired replacement opens through its deletion, so both halves must be openable.
          activatable: reviewItemWithHalves(item).every(reviewItemActivatable),
          isActive:
            activeKeys.size > 0 &&
            reviewItemWithHalves(item).some((part) => activeKeys.has(reviewItemKey(part))),
          locked,
        });
      })
    );
  }

  /** What the OPEN document asks for, or nothing when no document is mounted. */
  function documentTracking(): DocumentTrackingSettings {
    return surface?.session.trackingSettings() ?? NO_TRACKING_SETTINGS;
  }

  /**
   * Enter suggesting mode when the DOCUMENT asked for it — `w:trackRevisions` asks, and
   * enforced trackedChanges protection requires. What overrides what, and why a refusal
   * is published, lives with the decision: `documentTrackingAdoption` in
   * `opening-editing-mode.ts`.
   */
  function documentTrackingDecision(currentMode = editingMode, readerChoice = readerChoseMode) {
    const tracking = documentTracking();
    return documentTrackingAdoption({
      ...suggestingGuards(),
      viewOnly: hostConfig.mode() === 'view',
      hostChoseMode: hostConfig.mode() !== undefined,
      readerChoseMode: readerChoice,
      currentMode,
      trackRevisions: tracking.trackRevisions,
      restrictedToTrackedChanges: tracking.restrictedToTrackedChanges,
      restrictedToForms: tracking.restrictedToForms,
      restrictedToReadOnly: tracking.restrictedToReadOnly,
      restrictedToComments: tracking.restrictedToComments,
      engineAdoptedViewing,
    });
  }

  function applyEditingMode(next: DocumentEditingMode): void {
    pendingHostModeFallback = null;
    editingMode = next;
    surface?.setEditingMode(
      next === 'suggesting' ? 'suggest' : next === 'viewing' ? 'view' : 'edit'
    );
    surface?.setEditable(next !== 'viewing');
  }

  /** Re-derive document, active-mode, pending-request, then host refusals on each mount. */
  function standingRejection(documentRejection: string | null): string | null {
    if (documentRejection !== null) return documentRejection;
    if (editingMode === 'suggesting' && author === undefined) return SUGGESTING_AUTHOR_REASON;
    if (pendingSuggestingRequest) return SUGGESTING_AUTHOR_REASON;
    return readerChoseMode ? null : hostConfig.openingModeDecision(suggestingGuards()).rejection;
  }

  function adoptDocumentTracking(): void {
    const decision = documentTrackingDecision();
    facadeRejection = standingRejection(decision.rejection);
    if (decision.mode === null) return;
    engineAdoptedViewing = decision.mode === 'viewing';
    applyEditingMode(decision.mode);
  }

  /** A deferred open must resolve host intent against the incoming document, not the old one. */
  function applyHostModeDecision(fallback: DocumentEditingMode = 'editing', publish = true): void {
    if (openScheduler.isScheduled()) {
      pendingHostModeFallback = fallback;
      return;
    }
    pendingHostModeFallback = null;
    const decision = resolveHostEditingMode(
      hostConfig.mode(),
      suggestingGuards(),
      documentTracking(),
      editingMode,
      fallback,
      engineAdoptedViewing
    );
    // This lane decides too, so it records what it adopted.
    engineAdoptedViewing = decision.mode === 'viewing' && hostConfig.mode() !== 'view';
    if (decision.mode !== editingMode) applyEditingMode(decision.mode);
    facadeRejection = standingRejection(decision.rejection);
    suggestingReporter.report(decision.configurationRejection);
    if (publish) {
      bump();
      emitSelectionChange();
    }
  }

  /** Why `setEditingMode(mode)` is refused right now, or null: ONE ladder for `can` and `exec`. */
  function editingModeRefusal(mode: DocumentEditingMode): CommandRefusal | null {
    const viewOnly = hostConfig.mode() === 'view';
    return refusalOfEditingMode(viewOnly, suggestingGuards, documentTracking, mode);
  }

  const reviewCommands = createReviewCommands({
    surface: () => surface,
    enabled: () => reviewEnabled,
    destroyed: () => destroyed,
    viewing: () => editingMode === 'viewing',
    placements: reviewPlacements,
    authorVisibility: reviewAuthorVisibility,
    scope: storyScopeOfReviewItem,
    reveal: (event) => events.emitReviewItemReveal(withRevealPairKey(reviewPlacements, event)),
    // The pair keys read the placements, so only a decision someone listens to pays for them.
    resolved: (event) => {
      if (events.hasReviewChangesResolvedHandlers())
        events.emitReviewChangesResolved(withSkippedPairKeys(reviewPlacements, event));
    },
    activate: (key, allowExcludedFormat) => {
      allowExcludedFormatNavigation = allowExcludedFormat ?? false;
      try {
        return editor.setActiveReviewItem(key, { announce: false });
      } finally {
        allowExcludedFormatNavigation = false;
      }
    },
    setDisplayMode: (mode) => {
      reviewDisplayMode = mode;
      surface?.setRevisionDisplayMode(mode);
      bump();
      emitSelectionChange();
    },
    report: { diagnostics, tracked: () => editingMode === 'suggesting' },
  });
  const { resolveReviewItem } = reviewCommands;

  const historyGroups = createMountHistoryGroups(
    () => ({ mounted: !!surface && !!container, generation: mountGeneration }),
    events.emitHistoryDiagnostic,
    () => JSON.stringify(surface?.state().selection)
  );
  const reviewWriteDeps: ReviewWriteDeps = {
    reviewEnabled,
    historyGroups,
    surface: () => surface,
    author: () => author,
    editingMode: () => editingMode,
    commentTargetRange,
    storyScopeOfParagraph,
    storyScopeOfReviewItem,
    noteHomeOf,
    placements: reviewPlacements,
    resolveReviewItem,
    bump,
  };
  const reviewWrites = createReviewWrites(reviewWriteDeps);
  const documentReview = createDocumentReviewCommands(
    reviewWriteDeps,
    reviewWrites,
    reviewCommands
  );
  const editor: DocxEditorInstance = {
    beginHistoryGroup() {
      openScheduler.flush();
      return historyGroups.begin();
    },
    get mountGeneration() {
      return mountGeneration;
    },
    get surface() {
      return surface;
    },

    ...views.popupChrome.setters,

    stateVersion: () => stateVersion,

    fontMeasurement: () => ({
      measurer: shapedMeasurer && !stillOpening() ? ('shaped' as const) : ('fixed' as const),
      resolving: fontsResolving || stillOpening() || (lateFonts.pending() && !textInOwnFonts()),
      ...(shapedMeasurer && shapedProducer && !stillOpening() ? { producer: shapedProducer } : {}),
    }),

    async setFonts(fonts) {
      if (destroyed) throw editorError('destroyed', 'a destroyed editor cannot replace fonts');
      const request = ++fontRequestSeq;
      openScheduler.flush();
      surface?.flushPendingInput();
      if (destroyed || request !== fontRequestSeq) return;
      const lifetime = fontLifetime.advance();
      const live = () => !destroyed && lifetime.current();
      try {
        configuredFonts = fonts;
        resolvedFontConfiguration = undefined;
        fontsResolving = false;
        lateFonts.clear();
        // Removal drops the host faces now. A replacement keeps the current faces painted
        // until the new ones install, so the pages lay out once, not twice.
        if (!fonts) fallBackToDefaultFonts();
      } finally {
        lifetime.cancelPrevious();
      }
      const replaced = disposeShapedFonts;
      if (live()) await liveFonts.schedule(true);
      // Nothing new installed (no usable sources, or a failure): the replaced faces go anyway.
      if (fonts && live() && disposeShapedFonts === replaced) fallBackToDefaultFonts();
    },

    attach(el, options) {
      const refusal = attachTargetRefusal(el);
      if (refusal) return emitError(editorError('invalidTarget', refusal));
      if (container !== el) refreshHost?.invalidate();
      if (destroyed) {
        // Terminal by design: React StrictMode double-invokes effects, and a component
        // that destroyed its instance must create a new one rather than resurrect this.
        emitError(
          editorError('destroyed', 'this editor was destroyed; create a new instance to remount')
        );
        return;
      }
      if (surface && container === el) return surface.moveTo(el, options); // re-binds if moved
      // A scheduled open is the newer document, so it outranks the surface on screen.
      const reclaimed = openScheduler.cancel();
      if (reclaimed) {
        teardownSurface();
        pendingBytes = reclaimed;
      }
      // BEFORE the container moves: the observer watches a scroller found through the OLD one.
      zoomLane.detach();
      container = el;
      localFontProbe = null; // a probe answers for one document's font set
      if (surface) {
        endPreview();
        surface.moveTo(el, options);
        mountGeneration += 1;
        followHost(el.ownerDocument);
        return;
      }
      const bytes = pendingBytes;
      pendingBytes = null;
      // A mount bumps the tick and emits change/selectionChange itself. A big document
      // yields one painted frame first, instead of freezing the commit the attach ran in.
      if (bytes && openScheduler.shouldYield(bytes)) openScheduler.schedule(bytes);
      else if (bytes) mountBytes(bytes);
      else bump();
    },

    detach() {
      refreshHost?.invalidate();
      if (destroyed) return;
      // Before the container goes: the observer watches an element found THROUGH it.
      zoomLane.detach();
      // A scheduled open (newer) replaces the surface; otherwise it PARKS for the next attach.
      const reclaimed = openScheduler.cancel();
      if (reclaimed) {
        teardownSurface();
        pendingBytes = reclaimed;
      } else if (surface) {
        // Its settings draft belongs to chrome in the element being left.
        reviewDialogs.destroyDialogs();
        endPreview();
        surface.park();
        mountGeneration += 1;
      }
      container = null;
      localFontProbe = null;
      bump();
      emitSelectionChange();
    },

    load(document) {
      const bytes = normalizeSource(document);
      if (!bytes) {
        // A handle is identity, not content, and an unrecognized string is a typo. A mounted
        // document stays; with none, the refusal is what the reader sees.
        const mounted = surface !== null || pendingBytes !== null || openScheduler.isScheduled();
        emitError(editorError('unsupported', openFailure.refuseSource(document, mounted)));
        diagnostics.openRejected('unsupported');
        return;
      }
      refreshHost?.invalidate();
      highlights.reset();
      loadBytes(bytes);
    },

    save() {
      // A save inside the open's yield window sees the just-loaded document: mount now.
      openScheduler.flush();
      return saveEditorDocument(surface, surface?.hostElement() ?? container, () => surface);
    },

    getDocumentHandle(): DocumentHandle {
      // Package revision and load identity; see `document-handle.ts`.
      return replacing.documentHandleOf(surface);
    },

    exec(command, options) {
      // Before every command path: a history group a command cannot join is refused, not ignored.
      const refusal = writeBlockRefusal(container, command) ?? historyGroups.gate(command, options);
      if (refusal) return replacing.withOutcome(command, withCompareOutcome(command, refusal));
      // A command inside the yield window addresses the just-loaded document: mount now.
      // (`can` does NOT flush — chrome polls it per render; a read must not defeat the yield.)
      openScheduler.flush();
      const reviewDialog = reviewDialogs.exec(command);
      if (reviewDialog) return reviewDialog;
      const dialog = views.dialog(command, true);
      if (dialog) return dialog;
      if (command.type === 'replaceDocument') return replacing.exec(command, surface, container);
      if (command.type === 'navigateHighlight') {
        const marks = surface ? highlights.marksOf(command.name) : null;
        return navigateHighlight(
          command,
          marks,
          layoutReadingOrder(surface?.publishedLayout() ?? null),
          selectionRead.members.getSelectionRange(),
          (range) =>
            surface
              ? selectDocumentSearchMatch(surface, range)
              : { ok: false, code: 'notFound', reason: 'no document is loaded' }
        );
      }
      historyGroups.note(command);
      if (command.type === 'setMarkAttr' && command.mark === 'fontFamily')
        fontHold.pick(command.value, snapshotNow().formatting?.fontFamily);
      // A view command: it edits nothing, so it runs before the document gate, and it works
      // on a document that failed to open — the pane is still the reader's to close. Not on a
      // DESTROYED editor, though: there is no reader left.
      const viewCapability = views.capability(command);
      if (destroyed && viewCapability && !viewCapability.ok) return viewCapability;
      if (command.type === 'setEditingMode') {
        const refusal = editingModeRefusal(command.mode);
        if (refusal !== null) {
          // Refused, not entered-then-mute (#692). The one refusal an author lifts is
          // remembered and published, so `setAuthor` completes it and the snapshot says why.
          if (refusal.reason === SUGGESTING_AUTHOR_REASON) {
            pendingSuggestingRequest = true;
            facadeRejection = refusal.reason;
            suggestingReporter.report(refusal.reason);
            bump();
            emitSelectionChange();
          }
          return refusal;
        }
        readerChoseMode = true;
        pendingSuggestingRequest = false;
        facadeRejection = null;
        // The surface decides what an op becomes and whether the browser offers edits.
        applyEditingMode(command.mode);
        bump();
        emitSelectionChange();
        return { ok: true, changed: false };
      }
      const toggled = views.toggle(command);
      if (toggled) return toggled;
      if (command.type === 'toggleReviewPane') {
        if (!reviewEnabled) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
        reviewPaneOpen = !reviewPaneOpen;
        bump();
        emitSelectionChange();
        return { ok: true, changed: false };
      }
      const protectionResult = protection.exec(command);
      if (protectionResult) return protectionResult;
      // A review write binds its history group; the document vocabulary's run their methods.
      const reviewResult =
        documentReview.exec(command, options) ??
        (surface && isGroupedReviewWrite(command)
          ? historyGroups.run(surface, command, options, () => reviewCommands.exec(command)!)
          : reviewCommands.exec(command));
      if (reviewResult) return reviewResult;
      if (isContentControlEditorCommand(command)) {
        // The LIVE mode, not the constructed one — see `gateModeOf`.
        return runContentControlCommand(command, surface, gateModeOf(editingMode), options);
      }
      // Viewing refuses every EDIT, reversibly — the reader chose it and can choose again.
      // Checked HERE as well as in `can`, because a host that calls `exec` directly is not
      // required to ask first and must not get a write it was told it could not have.
      //
      // Mutating only. A blanket refusal also blocked `selectAll` and `copy`, which is a
      // viewer that cannot select or copy the document it exists to show — and it disagreed
      // with the construction-time `mode: 'view'` path, which has always gated on `mutating`
      // through `gateCommand`. Same visible state, two behaviours.
      const viewingGate = classifyCommand(command);
      if (editingMode === 'viewing' && viewingGate.supported && viewingGate.mutating) {
        return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
      }
      const gated = gateCommand(command, surface, hostConfig.modeForGate(), options);
      if (!gated.ok) return gated.refusal;
      const mounted = surface!;
      // Package revision covers body, furniture stories, and lifecycle ops; body-only
      // revision would report HF / create-header edits as `changed: false`.
      const before = mounted.session.packageRevision();

      return historyGroups.run(mounted, command, options, () => {
        const result = execEditorCommand(mounted, command, {
          ...(gated.tablePlan ? { admittedTablePlan: gated.tablePlan } : {}),
          editor,
          translate: hostConfig.translate(),
        });
        if (result) return result;
        // `changed` is read from the model, not assumed: reporting `changed: true` where the
        // document did not move would be a lie. It answers for the DOCUMENT, not for
        // observable state — a mark toggled at a collapsed caret ARMS the typing format
        // (`toggleRunProperty`), which moves the snapshot and fires a tick while committing
        // nothing, so it correctly reports `changed: false`. Package revision covers body,
        // furniture stories, and lifecycle ops; body-only revision would miss HF edits.
        return { ok: true, changed: mounted.session.packageRevision() !== before };
      });
    },

    can(command, options): CanResult {
      const blocked = writeBlockRefusal(container, command);
      if (blocked) return blocked;
      const reviewDialog = reviewDialogs.can(command);
      if (reviewDialog) return reviewDialog;
      const dialog = views.dialog(command, false);
      if (dialog) return dialog;
      const historyRefusal = historyGroups.gate(command, options);
      if (historyRefusal) return historyRefusal;
      if (command.type === 'replaceDocument') return replacing.can(command, surface, container);
      if (command.type === 'insertImage' || command.type === 'replaceImage') {
        if (destroyed) return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
        if (options?.scope) {
          const scoped = gateCommand(command, surface, hostConfig.modeForGate(), options);
          if (!scoped.ok) return scoped.refusal;
        }
        return canAsyncImageCommandOf(command, surface);
      }
      const viewCapability = views.capability(command);
      if (viewCapability) return viewCapability;
      const protectionCapability = protection.can(command);
      if (protectionCapability) return protectionCapability;
      const reviewCapability = documentReview.can(command) ?? reviewCommands.can(command);
      if (reviewCapability) return reviewCapability;
      if (isContentControlEditorCommand(command)) {
        return canContentControlCommand(command, surface, gateModeOf(editingMode), options);
      }
      // Viewing refuses every EDIT, the same way `mode: 'view'` does at construction — but
      // reversibly, because the reader chose it and can choose again. Mutating only, so a
      // reader can still select and copy; see the note at the `exec` twin.
      const viewingSupport = classifyCommand(command);
      if (editingMode === 'viewing' && viewingSupport.supported && viewingSupport.mutating) {
        return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
      }
      const gated = gateCommand(command, surface, hostConfig.modeForGate(), options);
      if (!gated.ok) return gated.refusal;
      const replaceRefusal = replaceCommandRefusal(command, surface!, (id) =>
        editor.getParagraphText(id)
      );
      if (replaceRefusal) return replaceRefusal;
      const proposal = proposalCapabilityRefusal(command, surface!, author);
      if (proposal) return proposal;
      if (isImageCommand(command) && imageCommandHasIdentityFields(command)) {
        const pre = captureImageMutationPreconditions(editor);
        if (pre) {
          const identity = verifyImageCommandIdentity(editor, command, pre);
          if (identity) return identity;
        }
      }
      return { ok: true };
    },

    // Derived for marks and alignment from the cached snapshot's formatting — Word's
    // agreement rule, the same one `toggleRunProperty` toggles against. Everything else
    // stays honest-false until its derivation exists.
    isActive(command) {
      const marksActive = views.isActive(command);
      if (marksActive !== null) return marksActive;
      if (command.type === 'toggleDocumentProtection') return protection.isActive();
      if (command.type === 'setReviewDisplayMode') return reviewDisplayMode === command.mode;
      if (command.type === 'toggleReviewPane') return reviewPaneOpen;
      if (command.type === 'setEditingMode') return editingMode === command.mode;
      return formattingCommandActive(
        command,
        surface ? snapshotNow().formatting : null,
        (kind) => surface?.isListActive(kind) ?? false
      );
    },

    // Real derivations from the canonical trees (session-memoized), no longer stubs.
    getDocumentStyles: () => surface?.session.documentStyles() ?? [],
    getDocumentFonts: documentFontsNow,
    // The picker's list: configured and document families, and presets this platform has.
    getAvailableFonts: () =>
      availableFontFamilies(fontConfiguration(), documentFontsNow(), listable),
    getDocumentThemeColors: () => surface?.session.documentThemeColors() ?? [],
    getOutline: () => surface?.session.documentOutline() ?? [],
    getComments: () => [],

    // Reads the SAME unified derivation as `snapshot().formatting` (one code path),
    // reshaped to this member's declared vocabulary (half-points).
    getSelectionFormatting: () =>
      selectionFormattingHalfPoints(surface ? snapshotNow().formatting : null),

    findMatches: ((query, options) =>
      findDocumentMatches(
        surface,
        editingMode,
        highlights.noteMatches,
        query,
        options
      )) as DocxEditorInstance['findMatches'],

    // Selection uses the match's model address and then reveals its paragraph.
    selectMatch(match: TextTarget): ExecResult {
      // Same rule as `exec`: a selection aimed into the yield window lands, not refuses.
      openScheduler.flush();
      if (!surface) {
        return { ok: false, code: 'notFound', reason: 'no document is loaded' };
      }
      return selectDocumentSearchMatch(surface, match);
    },

    getSelectedImage: () => snapshotNow().image,
    getSelectedTable: () => selectedTableOf(surface),

    getTableCellSelection: () => {
      const cells = surface?.state().cellSelection;
      if (!cells) return null;
      return {
        tableId: cells.tableId,
        rows: cells.rows,
        columns: cells.columns,
        cellIds: cells.cellIds,
      };
    },

    setTableInteractionLabel(resolver) {
      surface?.setTableInteractionLabel(resolver);
    },

    canExecuteImageCommand(command, options) {
      if (destroyed) return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
      if (options?.scope) {
        const gated = gateCommand(command, surface, hostConfig.modeForGate(), options);
        if (!gated.ok) return gated.refusal;
      }
      return canExecuteImageCommandOf(command, surface);
    },

    executeImageCommand(command) {
      if (destroyed)
        return Promise.resolve({ ok: false, code: 'notFound', reason: 'the editor was destroyed' });
      return executeImageCommandOf(editor, command);
    },

    getPageSetup: () => pageSetupOf(surface),

    getWatermark: () => watermarkOf(surface),
    getTrackedChanges: () =>
      (surface?.session.reviewItems() ?? [])
        .filter((item) => item.kind === 'revision')
        .map((item) => {
          const home = furnitureHomeOf(item);
          return {
            id: item.id,
            kind: item.kind === 'revision' ? item.revisionKind : 'revision',
            ...(item.kind === 'revision' && item.author ? { author: item.author } : {}),
            // From the PART, so a note whose id the file omits still names its story.
            story:
              home !== null ? home.kind : (noteStoryScopeOf(item)?.noteKind ?? ('body' as const)),
          };
        }),

    getReviewItems: (query?: ReviewItemQuery) => reviewPlacements(query),
    getCustomNodeDefinitions: () => modules.customNodes,
    reportCustomNodeDiagnostic: reportDiagnostic,

    ...reviewWrites,

    getSelectionPlacement: () => selectionPlacement(),

    isReviewPaneOpen: () => reviewPaneOpen,

    getEditingMode: () => editingMode,
    getReviewAuthors: () =>
      revisionStyleState.authorsFor(surface?.revisionAuthors() ?? EMPTY_AUTHOR_SLOTS),
    ...createReviewAuthorCommands(reviewAuthorVisibility, {
      enabled: reviewEnabled,
      surface: () => surface,
      notify: () => {
        bump();
        emitSelectionChange();
      },
    }),
    setTrackedChangesFilter(predicate, mode) {
      if (surface) return surface.setTrackedChangesFilter(predicate, mode);
      if (!reviewAuthorVisibility.setPredicate(predicate, mode)) return;
      bump();
      emitSelectionChange();
    },
    getConfiguredAuthor: () => author ?? null,
    setAuthor(nextAuthor) {
      const normalized = normalizeEditorAuthor(nextAuthor);
      if (author === normalized) return;
      author = normalized;
      surface?.setAuthor(author);
      // Preserve pending host intent and adopted document modes across author-only changes.
      if (author !== undefined && pendingSuggestingRequest) {
        pendingSuggestingRequest = false;
        const pending = completePendingSuggesting(editingModeRefusal('suggesting'));
        if (pending.enter) {
          readerChoseMode = true;
          applyEditingMode('suggesting');
        } else {
          facadeRejection = pending.rejection;
          bump();
          emitSelectionChange();
          return;
        }
      } else if (!readerChoseMode) {
        const fallback = pendingHostModeFallback ?? editingMode;
        applyHostModeDecision(hostConfig.mode() === undefined ? fallback : 'editing');
        return;
      }
      facadeRejection = standingRejection(null);
      suggestingReporter.report(facadeRejection);
      bump();
      emitSelectionChange();
    },
    setMode(nextMode) {
      if (!hostConfig.setMode(nextMode)) return;
      readerChoseMode = false;
      pendingSuggestingRequest = false;
      applyHostModeDecision();
    },
    ...liveHostConfigSetters(hostConfig, {
      surface: () => surface,
      bump,
      emitSelectionChange,
    }),
    presenceColorFor: (name) => surface?.remotePresenceColor(name) ?? 'var(--doc-accent)',
    collaborationSession: () => surface?.collaborationSession() ?? null,
    getReviewAuthorStyle: (author) => revisionStyleState.styleFor(author),
    setOpeningIndicatorHost: openingIndicator.set,
    setRemoteCaretLabelHost(host) {
      remoteCaretLabelHost = host;
      // Tolerated detached: the host waits here and applies on the next mount.
      surface?.setRemoteCaretLabelHost(host);
    },
    setReviewPaneOptions: reviewPane.set,
    setRevisionMarkup: reviewDialogs.markup.set,
    setRevisionMarkupChrome: reviewDialogs.markup.register,
    setCompareDocumentsChrome: reviewDialogs.compare.register,
    setUnsupportedElementRules: unsupported.set,
    setRevisionStyles(colors) {
      revisionStyleState.set(colors);
      surface?.setRevisionStyles(colors);
      // Presentation state moved: bump so snapshot readers re-render, and broadcast the
      // way a mode change does, so subscribed hooks hear it.
      bump();
      emitSelectionChange();
    },
    setEditingMode: (mode) => editor.exec({ type: 'setEditingMode', mode }),

    getReviewRevision: () => reviewRevision(),
    getActivatedReviewItemKey: (query) =>
      keyUnderQuery(reviewPlacements, surface?.activatedReviewKey() ?? null, query),

    setActiveReviewItem(key: string | null, options?: ReviewActivationOptions): ExecResult {
      // Dismissing is the only thing a key of `null` can mean here. A card the reader closed
      // stays closed until the caret next moves, and closing also drops the activation pin —
      // so the answer goes back to the caret rather than to the card that was just closed.
      if (key === null) {
        surface?.dismissActiveReview();
        bump();
        emitSelectionChange();
        return { ok: true, changed: false };
      }
      if (!surface) {
        return { ok: false, code: 'notFound', reason: 'no document is open' };
      }
      // The span offsets taken from the placements below outlive this call twice over — they
      // become the selection AND the activation pin, which then validates itself against that
      // selection by value. Queued typing landing afterwards would shift the caret out from
      // under a pin that had just recorded where it was, and the card the reader opened would
      // close by itself. Same rule as `commentTargetRange` and `replyToReviewItem`.
      surface.flushPendingInput();
      const item = findReviewPlacement(reviewPlacements, key)?.item;
      if (!item) {
        return { ok: false, code: 'notFound', reason: 'no review item with that key' };
      }
      // The surface knows only store items: a paired replacement opens as its deletion.
      const halves = replacementPairHalves(item);
      const pinKey = pairedPin.set(halves ? reviewItemKey(halves.deletion) : null) ?? key;
      const range = firstReviewRange(item);
      if (!range) {
        return {
          ok: false,
          code: 'unsupported',
          reason: 'this review item has no resolvable range',
        };
      }
      // The rail's own exclusion filter. Refused OUT LOUD rather than by falling through to
      // a selection nothing lights up: the caret would land on the text, no card would open,
      // and a host stepping through its queue would see the viewport move and the active key
      // stay put with nothing to explain it.
      if (
        !reviewItemWithHalves(item).every(reviewItemActivatable) &&
        !(
          allowExcludedFormatNavigation &&
          item.kind === 'revision' &&
          item.revisionKind === 'format'
        )
      ) {
        return {
          ok: false,
          code: 'unsupported',
          reason: reviewActivationRefusal(item),
        };
      }
      // A card whose range lives in a header/footer opens that scope, exactly as Word does:
      // the body selection cannot address a furniture paragraph, so setting it would only
      // clamp the caret to some unrelated body position. The mounted `enterHeaderFooter`
      // reveals the band on the way. Falls THROUGH to the announcement below — returning
      // here left the rail unre-rendered, so the header card never lit up.
      const home = item ? furnitureHomeOf(item) : null;
      // A note is a story on the same terms — one `footnotes.xml` holds every footnote, so
      // its scope names the NOTE rather than the part. Without this the note's own
      // paragraph id went to a body selection, which clamps it to an unrelated position.
      const note = home === null && item ? noteHomeOf(item) : null;
      if (home !== null || note !== null) {
        const target =
          home !== null
            ? { kind: 'headerFooter' as const, rId: home.rId, furnitureKind: home.kind }
            : { kind: 'note' as const, id: note! };
        const entered = enterStoryPosition(surface, target, range.start);
        if (!entered.ok) return entered;
      } else {
        // Card to document. The caret may be parked in a furniture or note scope from the
        // PREVIOUS card — leave it first, exactly as the pointer path does, or the body
        // selection below gets clamped inside the open story and no body card can ever
        // become active again. A change in a text box opens that box (`review-story-entry.ts`).
        openBodyStoryOf(surface, (reviewItemSpan(item!) ?? range).start);
        // A CARET AT THE START, not a selection over the span. Opening a card asks to look at
        // a change: the open item draws its own `--active` band, and a selection would add a
        // second highlight and leave the reader holding a range one keystroke from replacing
        // the text under review. The caret still MOVES to the start of the span, so the
        // keyboard, `activeReviewKey` and the reveal below follow it, as for header, footer
        // and note cards.
        const span = reviewItemSpan(item!) ?? range;
        const caret = { paragraphId: span.start.paragraphId, offset: span.start.offset };
        // Through `activateReview`, not `setSelection`: the card this opens has to be named
        // before the selection is published, or the surface reports whichever card the caret
        // classifies to — the wrong twin, when two cards share one span — for one frame.
        // No caret follow: the reveal below owns the scroll. Following the caret first scrolled
        // the minimum, so `centerIfNeeded` found the item on screen and parked it at the edge,
        // and `reveal: false` scrolled anyway.
        surface.activateReview(
          pinKey,
          { anchor: caret, head: caret },
          { allowExcluded: allowExcludedFormatNavigation, preventScroll: true }
        );
        // Focus-independent by design: the rail card focused itself on mousedown, which is exactly
        // what keeps the caret-follow scroll from ever firing here. `centerIfNeeded` by default,
        // not `nearest`: opening a card the reader can already see must not yank the page, but a
        // card 20 pages away scrolled the MINIMUM distance parked the change flush against the
        // bottom edge — the reader arrived looking at the last line of the window rather than at
        // the edit they had just asked to see. A host whose own list drives the scroll passes
        // `reveal: false` and gets the caret move without the engine competing for the viewport.
        const reveal = options?.reveal ?? 'centerIfNeeded';
        if (reveal !== false) surface.revealPosition?.(span.start, { block: reveal });
      }
      // A header, footer or note card pins here instead: those branches install the selection
      // themselves, inside the scope they open, so there is nothing to hand down. The body
      // branch above has already pinned with its own selection.
      if (home !== null || note !== null)
        surface.activateReview(pinKey, undefined, {
          allowExcluded: allowExcludedFormatNavigation,
        });
      // ANNOUNCED, exactly as dismissing is. Opening a card is observable state of its own,
      // and the surface's `onChange` deliberately stays quiet when the caret did not move —
      // which is precisely this case whenever the card is reopened after being DISMISSED:
      // dismissing leaves the caret inside the range, so setting it back to the range start
      // moves nothing, no `selectionChange` was emitted, and the rail never re-rendered. The
      // engine considered the card open and the reader was looking at a closed one that would
      // not respond to any number of further clicks.
      bump();
      emitSelectionChange();
      if (options?.announce === true)
        events.emitReviewItemReveal(withRevealPairKey(reviewPlacements, { key, source: 'host' }));
      // `changed: false` — activation moves the caret and the open card, and neither is
      // document state. A host must not mark its document dirty for opening a card.
      return { ok: true, changed: false };
    },

    setReviewActivationExclusions(
      kinds: readonly ReviewRevisionKind[] | null,
      options?: { readonly formattingKinds?: readonly string[] }
    ) {
      reviewActivationExclusions = kinds === null ? null : [...kinds];
      reviewActivationFormattingKinds = options?.formattingKinds
        ? [...options.formattingKinds]
        : undefined;
      surface?.setReviewActivationExclusions(reviewActivationExclusions, {
        formattingKinds: reviewActivationFormattingKinds,
      });
    },

    getHeaderFooterState: () => surface?.headerFooterState() ?? null,
    getNotePropertiesState: () => surface?.notePropertiesState?.() ?? null,
    getNotePreviewText: (scopeId) => surface?.notePreviewText?.(scopeId) ?? null,
    setActiveScope(scope: ViewScope) {
      if (surface?.setActiveScope(scope)) bump();
    },
    getActiveScope: (): ViewScope => surface?.activeScope() ?? { kind: 'body' },

    query: (query) => queryEditorDocument(surface, () => snapshotNow().formatting, query),

    snapshot: () => snapshotNow(),

    getTotalPages: () => totalPagesOf(surface),
    getCurrentPage: (mode) => currentPageOf(surface, mode),

    ...createEditorScrolling(
      () => surface,
      () => openScheduler.flush(),
      () => container
    ),
    ...createAnchorNavigation(
      () => editor,
      () => refreshHost,
      () => openScheduler.flush()
    ),

    ...zoomFacadeMembers(zoomLane, () => surface),
    ...highlights.members,
    ...selectionRead.members,
    ...createReviewItemsAt({ frame: highlights.frame, placements: reviewPlacements }),
    ...paragraphReads,
    ...createEditorPointMembers(
      () => surface,
      () => !!container && !destroyed
    ),
    focus(scope?: EditorScope) {
      // Same yield-window rule as `exec`: focusing the just-loaded document mounts it.
      openScheduler.flush();
      if (!surface) {
        return { ok: false, code: 'invalidTarget', reason: 'no document is loaded' };
      }
      // The ARGUMENT was declared and ignored, so `focus({kind:'body'})` — the obvious call
      // for a host trying to leave an open header — reported success and changed nothing.
      // Refused rather than silently dropped when the scope cannot be opened. `all` is a
      // reading scope with no caret home, so it is not a thing to focus.
      if (scope && scope.kind === 'all') {
        return { ok: false, code: 'invalidTarget', reason: 'the all scope cannot take focus' };
      }
      if (scope && !surface.setActiveScope(scope)) {
        return { ok: false, code: 'invalidTarget', reason: 'that scope cannot be opened' };
      }
      surface.focus();
      return { ok: true, value: undefined };
    },

    destroy() {
      refreshHost?.invalidate();
      destroyed = true;
      fontLifetime.dispose();
      lateFonts.clear();
      suggestingReporter.dispose();
      openScheduler.cancel();
      zoomLane.detach();
      disposeEmbeddedFaces();
      disposeShapedFonts();
      disposeShapedFonts = () => {};
      teardownSurface();
      highlights.dispose();
      container = null;
      pendingBytes = null;
      pendingTextFormInputs = new WeakMap();
      mountGeneration += 1;
      bump();
      diagnostics.dispose();
      events.clear();
    },

    on: events.on,
  };

  refreshHost = registerRefreshHost(editor, {
    surface: () => surface,
    container: () => container,
    collaboration: () => modules.collaboration !== null,
    load: loadBytes,
    changed: () => {
      bump();
      emitSelectionChange();
    },
    cancelLoad: () => {
      deferredRefreshBytes = null;
      openingRefreshBytes = null;
      openScheduler.cancel();
    },
  });
  diagnostics.attach(editor, suggesting);
  // Host calls read and write saved field results in this editor's mode.
  const instance = fieldScope.methods(editor);
  registerEditorHost(instance, () => container);
  registerEditorAutomation(instance, historyGroups, modules.review?.compareDocuments);
  bindPopupChromeRequests(instance, views.popupChrome);
  endPreview = () => endEditorPreview(instance);
  registerEditorPreviewHost(instance, {
    deferEvents: events.defer,
    displayOptions: displaySurfaceOptions,
    changed: () => {
      bump();
      emitSelectionChange();
    },
  });
  return instance;
}
