/**
 * `@docx-editor.dev/core/editor` — the editor facade and its chrome vocabulary.
 *
 * `createDocxEditor` implements the full `Editor` contract over a paginated surface, and the
 * chrome registry (`CHROME_GROUPS`, `ChromeSlotId`) is the toolbar taxonomy both adapters derive
 * their default arrangement from. Enabled state has exactly one source — `toolbarCommandState`,
 * which asks the engine — so a control and the engine can never disagree.
 *
 * @packageDocumentation
 * @public
 */
// Lane: editor. Responsibilities and dependency rules:
// docs/architecture/production-engine-packages.md.
//
// Browser composition root: composes the typed OOXML tree session, layout pagination,
// and the paginated surface into the PM-free Editor contract.

export type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
export type { FontShapingOptions } from '../layout/font-shaping-policy.ts';
export type { TrackedChangeFilterMode, TrackedChangePredicate } from '../contracts/editor.ts';
export type {
  ShapeColorValue,
  ShapeFillState,
  ShapeFormatState,
  ShapeOutlineState,
  ShapeThemeColor,
  ShapeThemeColorName,
  ShapeOutlineDash,
} from '../contracts/editor.ts';
export {
  createLayoutShaping,
  disposeLayoutShaping,
  toEditorFontError,
} from './font-configuration.ts';
export { LOADING_SNAPSHOT } from './loading-snapshot.ts';
export {
  MAX_RESOLVER_FAMILIES,
  DEFAULT_FONT,
  WORD_DEFAULT_FONT,
  composeFontConfiguration,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type FontResolutionRequest,
  type FontResolver,
} from './font-composition.ts';
export {
  FONT_RESOLVER_BRAND,
  FONT_RESOLVER_MARK_KEY,
  composeFontOrigins,
  defineFontResolver,
  isFontResolver,
  type ComposeFontOriginsOptions,
  type FontOrigin,
  type FontOriginFailure,
  type FontResolverMark,
  type MarkedFontResolver,
} from './font-resolver.ts';
export { deferFonts } from '../layout/defer-fonts.ts';
export { blankDocumentBytes, type BlankDocumentOptions } from './blank-document.ts';
export { keepScrollAtInlineEnd } from './scroll-inline-end.ts';
export {
  placeContextMenu,
  placeSubmenu,
  revealMenuItem,
  showInTopLayer,
  submenuKeys,
} from './submenu-placement.ts';
export { hostDirectionOf, observeHostDirection } from './host-direction.ts';
export { clipboardDropLandsText, clipboardPasteLandsContent } from './clipboard-file-lane.ts';
export {
  copyEditorStyles,
  openEditorWindow,
  type EditorWindow,
  type OpenEditorWindowOptions,
} from './editor-window.ts';
export { storyLabelTop } from './story-label-placement.ts';
export { textboxFrameReason } from './textbox-overlay-frame.ts';
export {
  editorHostDocument,
  editorHostElement,
  editorHostWindow,
  hostDocumentOf,
  hostTimers,
  hostWindowOf,
  isDomNode,
  isElementNode,
  isHTMLElementNode,
  isInputEvent,
  isKeyboardEvent,
  isMouseEvent,
  isPointerEvent,
  isTextNode,
  type HostTimers,
  type HostWindow,
} from './host-realm.ts';
/**
 * The part a node id names, read from the live package.
 *
 * Published because a module building on the surface needs a way to reach a node's own part for
 * a READ without opening — and permanently retaining — that story's store.
 */
export { partOfNodeId } from './surface-scope.ts';
/**
 * How a section-addressed op names the section a caret is in.
 *
 * Published because `PaginatedSurface.sectionAnchorParagraphAt` returns it, and a host typing
 * against that member could otherwise not name what it gets back.
 */
export type { SectionAnchor } from './section-scope.ts';
export { customFonts, type CustomFontsOptions, type CustomFontsResolver } from './custom-fonts.ts';
export {
  createFontSource,
  loadFonts,
  type FontLoadFailure,
  type FontLoadFailureReason,
  type FontUrlSource,
  type LoadFontsRequest,
  type LoadFontsResult,
} from './load-fonts.ts';
export {
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from './ruler-ticks.ts';
export {
  dragIndent,
  handlePosition,
  rulerMarginTicks,
  rulerTabPosition,
  snapTwips,
  SNAP_TWIPS_CM,
  SNAP_TWIPS_INCH,
  TWIPS_PER_CM,
  TWIPS_PER_INCH,
  type RulerDragOptions,
  type RulerIndent,
  type RulerIndentHandle,
  type RulerMarginTick,
  type RulerPageMetrics,
} from './ruler-indent.ts';
export {
  chromeProbeForSlot,
  chromeSlotIsToggle,
  commandForSlot,
  commandForSlotValue,
  commandForTableChromeSlotValue,
  runSave,
  runTableChromeCommand,
  runTableCommand,
  runToolbarCommand,
  tableChromeToolbarState,
  tableCommandToolbarState,
  toolbarCommandState,
  toolbarCommandStates,
  type RunTableChromeCommandResult,
  type ToolbarCommandState,
} from './toolbar-commands.ts';
export { editorCommandKey } from './command-key.ts';
export {
  arrangeToolbarGroups,
  collapseOrder,
  toolbarGroupPriority,
  toolbarPanelPlacement,
  toolbarPopupLeft,
  TOOLBAR_COLLAPSE_ORDER,
  TOOLBAR_OVERFLOW_HYSTERESIS,
  TOOLBAR_OVERFLOW_LEADING_GROUPS,
  orderToolbarOverflowSections,
  TOOLBAR_PANEL_EDGE_MARGIN,
  TOOLBAR_PINNED_GROUPS,
  type ToolbarHostGroupPlacement,
  type ToolbarPanelPlacement,
} from './toolbar-fit.ts';
export {
  barRoomWidth,
  controlsOverflow,
  readAvailableWidth,
  readColumnGap,
  readInlineMargins,
  readToolbarRow,
  separatorLeadingCost,
  trailingGapCost,
  type BarRoomInput,
  type ToolbarRowMemory,
  type ToolbarRowReading,
} from './toolbar-measure.ts';
export {
  sameItemOverflow,
  TOOLBAR_HOST_ITEM,
  TOOLBAR_ITEM_ATTRIBUTE,
  toolbarGroupItems,
  toolbarGroupsKey,
  toolbarHostPanelShown,
  toolbarItemKey,
  toolbarOverflowItems,
  toolbarShownCount,
  type ToolbarFitGroup,
  type ToolbarItemFitInput,
  type ToolbarItemOverflow,
} from './toolbar-item-fit.ts';
export { chordLetter, isGoToChord } from './chord-letter.ts';
export { tableCommandState } from './docx-editor-derive.ts';
export {
  applyTableChromePick,
  DEFAULT_TABLE_CHROME_DRAFT,
  defaultTableLabel,
  isTableChromeSlot,
  probeTableChromeCommand,
  TABLE_BORDER_STYLE_OPTIONS,
  TABLE_BORDER_TARGET_OPTIONS,
  TABLE_BORDER_WIDTH_OPTIONS,
  TABLE_CHROME_SLOT_IDS,
  tableChromeLabelKeyForTarget,
  tableChromeIconPaths,
  tableChromeVisible,
  type TableBorderTargetValue,
  type TableBorderStyleOption,
  type TableBorderTargetOption,
  type TableBorderWidthOption,
  type TableChromeDraft,
  type TableChromePick,
  type TableChromeSlotId,
  type TableInteractionLabelKey,
} from './table-chrome.ts';

export {
  CHROME_GROUPS,
  CHROME_MENUS,
  CHROME_UNAVAILABLE_KEY,
  chromeControlCount,
  chromeMenuSlots,
  chromeSlotId,
  defaultChromeGroups,
  formattingBarChromeGroups,
  type FormattingBarOptions,
  type ChromeControl,
  type ChromeControlId,
  type ChromeControlState,
  type ChromeGroup,
  type ChromeGroupId,
  type ChromeMenu,
  type ChromeMenuEntry,
  type ChromeMenuId,
  type ChromeMenuItemEntry,
  type ChromeMenuSeparatorEntry,
  type ChromeMenuSubmenuEntry,
  type ChromeSlotId,
} from './chrome-controls.ts';
export {
  mountPaginatedSurface,
  type DrawingSelectionIntent,
  type OpenPaginatedResult,
  type PaginatedSurface,
  type PaginatedSurfaceOptions,
  type PaginatedSurfaceState,
  type ParagraphFlags,
  type SurfaceParagraphFormat,
  type ParagraphPropertyEdit,
  type ParagraphTabStop,
  type RemoteCaretLabelAnchor,
  type RemoteCaretLabelHost,
  type SectionBreakInsertType,
  type ReviewWriteIntent,
  type SurfaceFormatting,
} from './paginated-surface.ts';
export type { OpeningIndicatorHost } from './surface-opening-indicator.ts';
export type { SurfacePointHit } from './surface-pointer.ts';
// `PaginatedSurface` extends it, so its indent and list members need the name.
export type { SurfaceIndentAndListOps } from './surface-indent-list-contract.ts';
// `PaginatedSurface.removeTocRefusal` answers with it.
export type { TocRemovalRefusal } from './surface-toc-commands.ts';
export {
  createDocxEditor,
  type DocxEditorInstance,
  type DocxEditorConfig,
  type EquationChromeHandlers,
  type HyperlinkChromeHandlers,
  type BookmarkChromeHandlers,
} from './docx-editor.ts';
// `DocxEditorInstance.fontMeasurement()` returns it, so the lane that exports the instance
// has to export the answer too.
export type {
  AttachOptions,
  BookmarkMarkInfo,
  BookmarkMarkOptions,
  CommentDraftChromeHandlers,
  FontMeasurementState,
  GoToChromeHandlers,
} from './docx-editor-types.ts';
export type { BookmarkMarkOptionsSource } from './bookmark-chrome.ts';
// `DocxEditorConfig.fieldResults` takes it.
export type { FieldResultsMode } from '../store/package/field-result-mode.ts';
// `DocxEditorConfig.contentLockPolicy` takes it.
export type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
// `DocxEditorConfig.lockedControlNavigation` takes it.
export type { LockedControlNavigation } from './paginated-surface-options.ts';
// Automation over an editor that is already open. The protocol itself lives in the neutral
// automation subpath — only the adapter that needs a live editor ships from here, and only as
// a factory: there is no composition hook a consumer could point at a second document model.
export {
  BROWSER_AUTOMATION_CAPABILITIES,
  createBrowserAutomationHost,
  type BrowserAutomationHost,
  type HistoryGroupRun,
} from './automation-host.ts';
// `BrowserAutomationHost.highlightRangeOf` takes a span, which these types spell out.
export type {
  AutomationEndpoint,
  AutomationHandle,
  AutomationHandleRef,
  AutomationObjectKind,
  AutomationSpan,
} from '../automation/index.ts';
// The fork a browser automation preview paints from. Internal to the editor-api runtime.
export {
  beginEditorPreview,
  editorPreviewActive,
  type EditorPreviewFork,
  type EditorPreviewRefusal,
} from './editor-preview.ts';
export {
  reportAutomationException,
  reportAutomationRefusal,
  reportAutomationReviewSkip,
} from './editor-diagnostics.ts';
export type { ReviewDiagnosticCode, ReviewOperation } from '../automation/diagnostic-vocabulary.ts';
// The capability seam: what `createDocxEditor({ modules })` accepts and what a
// capability package (the pro review module) implements.
export {
  resolveEditorModules,
  type CollectReviewItems,
  type CompareDocumentsBackgroundEngine,
  type CompareDocumentsBackgroundResult,
  type CompareDocumentsEngine,
  type CompareDocumentsEngineErrorCode,
  type CompareDocumentsErrorCode,
  type CompareDocumentsRefusalReason,
  type CompareDocumentsEngineOptions,
  type CompareDocumentsEngineResult,
  type CompareDocumentsPhase,
  type CompareDocumentsProgress,
  type EditorModule,
  type EditorModuleRegistry,
  type ReviewModelInput,
  type ReviewDisplayMode,
  type ReviewModuleContribution,
  type CollaborationModuleContribution,
} from '../contracts/modules.ts';
export {
  applyThemeShade,
  applyThemeTint,
  lowerColorValueForBorder,
  lowerColorValueForFill,
  resolveColorValueToCss,
  resolveThemeColorHex,
  validateThemeModifier,
} from './color-value-lower.ts';
export type { ColorLowerResult } from './color-value-lower.ts';
export {
  canExecuteImageCommand,
  captureImageMutationPreconditions,
  executeImageCommand,
  selectedImageStateOf,
  computeMovedImagePosition,
  computeResizedImageExtentEmu,
  isStaleImageInteractionCommit,
  pointsToEmu,
  emuToOverlayPoints,
  IMAGE_OVERLAY_NUDGE_PT,
  IMAGE_OVERLAY_NUDGE_SHIFT_PT,
  EMU_PER_POINT,
  type ImageContext,
  type SelectedImageState,
  type ImageInteractionSession,
  type ImageOverlayScrollPort,
  type ImageResizeHandle,
  type SelectedDrawingOverlayTarget,
} from './docx-editor-images.ts';
export { selectedDrawingOverlayTargetOf } from './drawing-overlay-target.ts';
export { historyShortcutOf, type HistoryShortcutKeys } from './history-shortcut.ts';
export { surfaceExtent, type SurfaceExtent } from './surface-pages.ts';
// The fit's vocabulary — only the part an adapter actually needs, so the published surface
// stays something we can keep. The two canonical modes, because a zoom control has to render
// its own selected state and must not respell a mode the engine already names; the two
// comparisons, because that state is a value comparison and re-deriving it per adapter is how
// a menu ends up ticking a row the editor is not in; and the range, because chrome bounds its
// own inputs. Everything else here is internal until something outside core asks for it.
export {
  AUTO_ZOOM_MODE,
  FIT_WIDTH_ZOOM_MODE,
  ZOOM_MAX,
  ZOOM_MIN,
  resolveZoomMode,
  REVIEW_MARKERS_GUTTER_PX,
  reviewPaneEntitledZoom,
  sameZoomMode,
} from './zoom-fit.ts';
export {
  editorInstanceScope,
  hasOpenNestedPopup,
  listenForOutsidePress,
  listenForPopupEscape,
  listenForPopupFocusLeave,
  type OutsidePressOptions,
  type PopupEscapeOptions,
  type PopupFocusLeaveOptions,
} from './popup-escape.ts';
export {
  focusMenuItemForKey,
  listenForMenuDismiss,
  noteMenuScopeOf,
  type MenuDismissOptions,
} from './note-context-menu.ts';
export {
  computeImageResizeResult,
  createImageOverlayScrollPort,
  cssPixelsToLayoutPoints,
  layoutPointsToCssPixels,
  overlayFrameCssBox,
  overlayFrameToSheetCssPixels,
  overlayHostOrigin,
  resizePreservesAspect,
  surfacePaintScale,
  finalizeImageOverlayInteraction,
  type AnchorFrameOrigin,
  type ImageResizeResult,
  type FinalizedImageOverlayInteraction,
  type OverlayFrameRect,
  type SurfaceOverlayCoordinates,
} from './surface-overlay-coordinates.ts';
export type { OverlayFrameTurn } from './shape-drawings.ts';
export {
  IMAGE_WRAP_TARGETS,
  type ImageWrapTarget,
  type DrawingPositionInput,
} from '../store/package/drawing-projection.ts';
export {
  DRAWING_REL_FROM_H,
  DRAWING_REL_FROM_V,
  propertiesCommandHasPositionFields,
  positionInputFromPropertiesCommand,
  validateDrawingPositionInput,
  validateSetImagePositionCommand,
} from '../store/package/drawing-position-input.ts';
export {
  cropPercentFromCropPermille,
  cropPercentFromPermille,
  cropPercentFromSourceCrop,
  cropPermilleFromCropPercent,
  cropPermilleFromPercent,
  sourceCropFromCropPercent,
  validateImageCropPercent,
  type ImageCropPercent,
  type ImageCropPermille,
} from '../store/package/image-crop-units.ts';
export {
  resolveSvgIntrinsicSize,
  sniffImageMime,
  validateRasterHeader,
  type ImageDecodePort,
  type RenderableImageMime,
  type SupportedImageMime,
  type VectorImageMime,
} from '../store/package/image-resources.ts';
export {
  DEFAULT_IMAGE_RESOURCE_LIMITS,
  resolveImageResourceLimits,
  type ImageResourceLimits,
} from '../store/runtime/limits.ts';
export type { HyperlinkOps, SurfaceHyperlink } from './surface-hyperlinks.ts';
export type { SurfaceInsertImageInput } from './surface-image-ops.ts';
export {
  equationAtPosition,
  type EquationActivation,
  type EquationOps,
  type SurfaceEquation,
} from './surface-equations.ts';
export type { HyperlinkActivation, SurfaceNavigation } from './surface-navigation.ts';
// The types an adapter needs to CALL the surface, re-exported from the composition root.
// Adapters may depend on this package and not on the layout lane, so a host reaching into
// `engine-layout` for a parameter type would be reaching past the boundary for a name.
export type {
  SectionProperties,
  SectionVerticalAlign,
  NavigationCommand,
  SemanticPosition,
  SemanticSelection,
  TextMeasurer,
} from '@docx-editor.dev/core/layout';
// Same reason: `PaginatedSurfaceOptions.fieldShading` is typed by it.
export type { FieldShadingMode } from '../output/semantic-paint.ts';
// And `DocxEditorConfig.revisionStyles`, `getReviewAuthors` by these.
export type {
  ReviewAuthorInfo,
  RevisionAuthorAssignments,
  RevisionAuthorStyle,
  RevisionStyles,
} from '../output/revision-presentation.ts';
// The adapters render custom components over unsupported content through these.
export {
  observeUnsupportedElements,
  type UnsupportedElement,
  type UnsupportedElementHost,
  type UnsupportedElementLayout,
  type UnsupportedElementRule,
} from '../output/unsupported-elements.ts';

export type {
  TextFormFieldDialogSession,
  TextFormFieldChromeHandlers,
} from './text-form-field-session.ts';

export type {
  ParagraphFlagState,
  ParagraphFormatRead,
  ParagraphFormatUpdate,
} from './paragraph-dialog-types.ts';
export {
  twipsToInches,
  formatInches,
  inchesToTwips,
  type TabAlignment,
  type TabLeaderName,
  TAB_ALIGNMENT_LABELS,
  type SpecialIndent,
  specialOf,
  signedFirstLineOf,
  type ParagraphDialogFields,
  seedFields,
  type ParagraphDialogMixed,
  type ParagraphFlagKey,
  NO_MIXED_FIELDS,
  mixedFieldsOf,
  sameTabStops,
  changedFields,
  alignmentAfterDirectionChange,
  withTabStop,
  trapTabWithin,
} from './paragraph-dialog-fields.ts';
export {
  SPLIT_CELL_FALLBACK_MAX,
  initialSplitCellCounts,
  readSplitCellCounts,
  type SplitCellCountProblem,
  type SplitCellCounts,
  type SplitCellLimits,
} from './split-cell-dialog-model.ts';
export { TEXT_FORM_FORMATS } from '../store/store/text-form-field-options.ts';

export type {
  PopupChromeRegistrationOptions,
  ContentControlWidgetSession,
  ContentControlWidgetChromeHandlers,
  InvalidTextFormFieldSession,
  InvalidTextFormFieldChromeHandlers,
} from './popup-sessions.ts';
export {
  calendarMonth,
  calendarMonthTitle,
  calendarWeekdays,
  firstDayOfWeek,
  isoDateOf,
  parseIsoDate,
  shiftMonth,
} from './content-control-calendar.ts';
export type {
  CalendarDay,
  CalendarMonth,
  CalendarMonthOptions,
} from './content-control-calendar.ts';

export {
  calendarDateForKey,
  calendarDateText,
  calendarDateFromText,
} from './content-control-calendar.ts';
export {
  positionContentControlPopup,
  observeContentControlPopup,
  contentControlPopupKeyDown,
} from './content-control-popup-behavior.ts';
export { createContentControlListNavigation } from './content-control-list-navigation.ts';
export type { ContentControlListNavigation } from './content-control-list-navigation.ts';

export { calendarMonthNames } from './content-control-calendar.ts';

export { contentControlPopupOpener } from './content-control-popup-behavior.ts';
export { CONTENT_CONTROL_PICTURE_ACCEPT } from './content-control-picture-widget.ts';

export {
  bindHistoryGroup,
  type HistoryGroupBinding,
  type HistoryGroupBindingOptions,
} from './bind-history-group.ts';

export {
  commandExecOptions,
  type EditorCommandExecute,
  type ToolbarValueMap,
  type ToolbarValueSlot,
  type ToolbarSlotValue,
} from './toolbar-values.ts';
export {
  LINE_SPACING_PRESETS,
  lineSpacingMenuRowLabel,
  lineSpacingMenuRows,
  type LineSpacingMenuRow,
  type LineSpacingMenuValue,
} from './line-spacing-menu.ts';

export { createDocumentRefresh, DocumentRefreshError } from './document-refresh.ts';
export { HIGHLIGHT_REFRESH_MS, watchHighlights } from './watch-highlights.ts';
export {
  acceptedOffsetFromText,
  acceptedTextRanges,
  textOffsetFromAccepted,
} from './paragraph-text-ranges.ts';
export type {
  HighlightSource,
  HighlightWatch,
  WatchHighlightsOptions,
} from './watch-highlights.ts';
export { goToHeading } from './heading-navigation.ts';
export {
  createDocumentSearch,
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIGHLIGHT_PRIORITY,
  SEARCH_HIGHLIGHT_SET,
  SEARCH_MATCH_LIMIT,
} from './document-search.ts';
export type {
  DocumentSearch,
  DocumentSearchFindOptions,
  DocumentSearchHighlight,
  DocumentSearchNavigateOptions,
  DocumentSearchOptions,
  DocumentSearchState,
} from './document-search.ts';
export type {
  DocumentRefresh,
  DocumentRefreshState,
  RefreshSubmission,
  RefreshUpdate,
  RefreshRefusal,
  RefreshRefusalFields,
  RefreshRefusalReason,
  RefreshUpdateMode,
  RefreshResult,
  RefreshFailureCode,
  RefreshChange,
  RefreshChangeInput,
  RefreshLocation,
  RefreshHighlightOptions,
  RefreshHighlightAnimation,
  ClearRefreshHighlightsOptions,
  NavigateToChangeOptions,
} from './document-refresh.ts';
export type {
  AnchorHighlightAnimation,
  AnchorHighlightOptions,
  ClearAnchorHighlightOptions,
  HighlightHit,
  HighlightKind,
  NavigateHighlightCommand,
  HighlightOptions,
  HighlightRange,
  HighlightRect,
  HighlightResult,
  AcceptedTextRange,
  ParagraphText,
  ParagraphsChangeEvent,
  ReviewItemHit,
  ScrollPlacement,
  ScrollToAnchorOptions,
  ParagraphTextProofing,
  ParagraphTextReadOptions,
  ParagraphTextSpan,
  ReplaceAcceptedTextCommand,
  HistoryGroup,
  HistoryGroupOptions,
  CommentTextOptions,
  // What `getDocumentHandle` returns and `replaceDocument` takes as `expected`.
  DocumentHandle,
  // What `findMatches` returns and `selectMatch`/`replaceMatch` take.
  TextMatch,
  ReplaceAllMatchesOutcome,
} from '../contracts/editor.ts';

export { runChromeExport, ChromeExportError } from './chrome-export.ts';
export type {
  ChromeExportView,
  ChromePrintSettings,
  ChromeExportFormat,
  ChromeExportHandlers,
  ChromeExportResult,
} from './chrome-export.ts';
export {
  runChromePrint,
  ChromePrintError,
  isChromePrintShortcut,
  initialChromePrintSettings,
  CHROME_PRINT_DISPLAY_MODES,
} from './chrome-print.ts';
export type {
  ChromePrintErrorCode,
  ChromePrintJob,
  ChromePrintOptions,
  ResolvedChromePrintSettings,
} from './chrome-print.ts';

export {
  DEFAULT_REVIEW_PANE,
  resolveReviewPane,
  reviewPaneListsItem,
} from '../contracts/review-pane.ts';
export type {
  CommentMarkerStyle,
  ResolvedReviewPane,
  ReviewPaneItemFields,
  ReviewPaneOpening,
  ReviewPaneOptions,
  ReviewPaneOverflow,
  RevisionDisplay,
} from '../contracts/review-pane.ts';
export {
  DEFAULT_REVISION_MARKUP,
  REVISION_MARKUP_COLORS,
  resolveRevisionMarkup,
} from '../contracts/revision-markup.ts';
export type {
  RevisionMarkupOptions,
  RevisionMarkupDialogSession,
  RevisionMarkupChromeHandlers,
  ResolvedRevisionMarkup,
  RevisionMarkupNamedColor,
  RevisionMarkupColor,
  RevisionMarkupMark,
  RevisionDeletionMark,
  RevisionChangedLinesMark,
  RevisionMarkupStyle,
  RevisionMarkupTextStyle,
} from '../contracts/revision-markup.ts';
export type { RevisionMarkupDialog, RevisionMarkupDialogHost } from '../contracts/modules.ts';
export type { CompareDocumentsDialog, CompareDocumentsDialogHost } from '../contracts/modules.ts';
export type {
  CompareDocumentsChromeHandlers,
  CompareDocumentsDialogSession,
  CompareDocumentsOutcome,
  CompareDocumentsRequest,
} from '../contracts/compare-documents.ts';
export {
  COMPARE_DOCUMENTS_ACCEPT,
  compareDocumentsErrorKey,
} from '../contracts/compare-documents.ts';
export type {
  ReplaceDocumentErrorCode,
  ReplaceDocumentOutcome,
  ReplaceDocumentRefusal,
  ReplaceDocumentRefusalReason,
  ReplaceDocumentRequest,
} from '../contracts/replace-document.ts';
export {
  COMPARE_DOCUMENTS_PHASE_ATTRIBUTE,
  focusCompareDocumentsControl,
} from './compare-documents-focus.ts';

/** The watermark shape box that `setWatermark` writes, for previews. */
export {
  DEFAULT_WATERMARK_FONT,
  watermarkShapeBox,
  type WatermarkSize,
} from './watermark-geometry.ts';

/** The Bookmark dialog's list order and name rules, shared by the React and Vue dialogs. */
export {
  bookmarkDialogInitialName,
  bookmarkDialogNameState,
  bookmarkDialogRows,
  goToBookmarkGroups,
  goToBookmarkMatch,
  goToBookmarkRows,
  goToBookmarkTarget,
  type BookmarkDialogNameState,
  type GoToBookmarkGroup,
  type BookmarkSortOrder,
} from './bookmark-dialog-model.ts';

export { unsupportedElementRuleMatches } from '../layout/unsupported-content-types.ts';

export type {
  DrawingGraphicKind,
  DrawingSupport,
  DrawingSupportIssue,
} from '../store/package/drawing-support.ts';

export { drawingPreviewDocx } from './drawing-preview.ts';
export type {
  DrawingPreviewPackageLimits,
  DrawingPreviewPackageResult,
} from '../store/package/drawing-preview-package.ts';
export {
  CHART_INSERT_CHOICES,
  chartTypeLabelKey,
  chartTypeIconPaths,
  listenPaneRequests,
  requestPane,
  takePaneRequest,
  takePaneRequestFor,
  openChartPaneFor,
  chartPaneAvailable,
  openChartPaneAt,
  paneAvailable,
  type EditorPaneId,
  type PaneRequest,
  type PaneRequestListenerOptions,
  type PaneRequestOptions,
} from './chart-chrome.ts';
export {
  CHART_LEGEND_CHOICES,
  CHART_STANDARD_COLORS,
  CHART_THEME_SLOTS,
  CHART_TYPE_CHOICES,
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  chartAxisTitleLabels,
  chartColorCommand,
  chartColorGrid,
  chartColorLabel,
  chartColorOfPick,
  chartColorPick,
  chartColorPickOf,
  chartColorPicks,
  chartPaneCommand,
  chartPaneDraftContinues,
  chartPaneDraftKey,
  chartPaneNumericX,
  chartPickHex,
  chartRowFocusAfterRemove,
  chartSeriesNote,
  chartThemeHexes,
  chartTitleCommand,
  chartTypeChangeNote,
  chartTypeHint,
  chartValueText,
  focusChartPane,
  focusChartSwatch,
  moveChartSwatchFocus,
  nextChartCategoryLabel,
  parseChartValue,
  type ChartColorPick,
  type ChartPaneChange,
  type ChartPaneResult,
  type ChartSwatch,
  type ChartTranslate,
} from './chart-pane.ts';
export {
  editSelectedChartData,
  execSelectedChart,
  readSelectedChart,
  type SelectedChartCommand,
  type SelectedChartView,
} from './selected-chart.ts';
export {
  openShapePane,
  paneTitleKey,
  selectionPane,
  shapePaneAvailable,
  sidePanelPane,
} from './shape-chrome.ts';
export {
  SHAPE_OUTLINE_WIDTHS,
  shapeColorPick,
  shapeFillPick,
  shapeOutlinePick,
  shapeFillEditable,
  shapeFillLabelKey,
  shapeFillSummary,
  shapeOutlineSummary,
  shapeHexText,
  shapePaneColorHex,
  shapePaneCommand,
  shapeSwatchCurrent,
  shapeTransparencyText,
  shapeWidthText,
  SHAPE_OUTLINE_DASHES,
  shapeDashLabelKey,
  shapeDashValue,
  type ShapePaneChange,
  type ShapePaneError,
  type ShapePaneResult,
} from './shape-pane.ts';
export {
  editSelectedShape,
  execSelectedShape,
  readSelectedShape,
  sameSelectedShape,
  type SelectedShapeCommand,
  type SelectedShapeView,
} from './selected-shape.ts';
export {
  COLOR_PICKER_STANDARD_COLORS,
  COLOR_PICKER_THEME_SLOTS,
  colorPickerGrid,
  colorPickFromHexText,
  colorPickHex,
  colorPickIsCurrent,
  colorPickLabel,
  colorPickOf,
  colorPickTheme,
  documentThemeHexes,
  alignColorPickerPopover,
  focusColorSwatch,
  moveColorSwatchFocus,
  type ColorPick,
  type ColorPickerGrid,
  type ColorPickerThemeSlot,
  type ColorPickerTranslate,
  type ColorSwatch,
} from './color-picker.ts';
export {
  CHART_AXES_OFF_REASON,
  CHART_NO_AXES_REASON,
  chartSlotIsToggle,
  commandForObjectSlotValue,
  isChartChromeSlot,
  isObjectChromeSlot,
  isShapeChromeSlot,
  objectSlotOptions,
  objectSlotValue,
  type ChartChromeSlotId,
  type ObjectSlotReadValueMap,
  type ObjectSlotValueMap,
  type ObjectToggleSlotId,
  type ShapeChromeSlotId,
} from './object-chrome-slots.ts';
export {
  PANE_SECTIONS,
  paneSections,
  paneSlots,
  type PaneSection,
  type PaneSectionId,
  type PaneSectionIds,
} from './pane-sections.ts';
export type { SurfaceChartOps } from './surface-chart-ops.ts';
export type {
  ChartCopySource,
  ChartIntentResult,
  ChartLanes,
  DuplicateChartInput,
  InsertChartInput,
} from '../store/store/tree-package-charts.ts';
export type {
  ChartColor,
  ChartColorEntry,
  ChartData,
  ChartDataCategory,
  ChartDataKind,
  ChartDataRead,
  ChartDataSeries,
  ChartFormat,
  ChartFormatChange,
  ChartFormatRead,
  ChartLegendPosition,
  ChartThemeColor,
  ChartType,
  ChartWorkbookState,
  NewChartData,
  SelectedChartState,
} from '../contracts/chart.ts';

export { editorDropHandled } from './surface-drop.ts';
export type {
  SemanticHit,
  SemanticHitDrawing,
  TableCellAddress,
} from '../layout/semantic-hit-test.ts';
export type { CaretGeometry } from '../layout/semantic-interaction.ts';
export type {
  EditorPointPosition,
  EditorDropEvent,
  EditorHostDragEvent,
} from '../contracts/editor-drop.ts';
export { canMoveInlineImage, beginInlineImageDrag } from './inline-image-drag.ts';
export {
  drawingFramePressTarget,
  type DrawingFramePress,
  passDrawingFramePress,
} from './drawing-overlay-press.ts';
export { leaveGroupMember } from './group-member-selection.ts';
