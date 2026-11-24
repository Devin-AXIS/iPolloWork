/**
 * @docx-editor.dev/react
 *
 * React adapter for the DOCX editor. A thin renderer over the `Editor`
 * contract from `@docx-editor.dev/core`: it supplies DOM and paints
 * the engine's positioned display list, and holds no editing-engine state.
 *
 * @packageDocumentation
 * @public
 */

export { VERSION } from './version';

export type { MaybeRefOrGetter } from './maybe-ref-or-getter';
export type { DocxEditorChildren } from './docx-editor-children';

export { DocxEditor, type DocxEditorNamespace } from './components/DocxEditor';

// Provider-first composition layer: the primitives behind `DocxEditor` (also reachable
// as `DocxEditor.Root` / `.Viewport` / `.Content`) and the hooks a custom chrome is
// built from.
export {
  DocxEditorRoot,
  type DocxEditorRootProps,
  type DocxEditorRootListeners,
  type ProvideDocxEditorResult,
  provideDocxEditor,
} from './editor/DocxEditorRoot';
export { DocxEditorViewport, type DocxEditorViewportProps } from './editor/DocxEditorViewport';
export { DocxEditorContent, type DocxEditorContentProps } from './editor/DocxEditorContent';
export { DocxEditorWindow, type DocxEditorWindowProps } from './editor/DocxEditorWindow';
export { DocxEditorEquation } from './editor/DocxEditorEquation';
export {
  DocxEditorLoading,
  DocxEditorLoadingSpinner,
  type DocxEditorLoadingComponent,
  type DocxEditorLoadingProps,
  type DocxEditorLoadingSpinnerProps,
} from './editor/DocxEditorLoading';
export { useDocxEditor, ReviewRailContext, type ReviewRailRegistry } from './editor/context';
export { useEditorState, editorStateActiveSubscriptionCount } from './editor/useEditorState';
export { notificationYieldsToTask } from './editor/deferred-notifier';
export { useScopeClassName } from './editor/scope-context';
export {
  useEditorColorMode,
  type ResolvedColorMode,
  type UseEditorColorModeReturn,
} from './editor/color-mode-context';
export { LOADING_SNAPSHOT } from './editor/loading-snapshot';
// Context-fed chrome parts (also reachable as `DocxEditor.HorizontalRuler` /
// `.VerticalRuler` / `.DocumentOutline`): thin reactive wrappers over the props-driven
// ruler and outline components, fed from the provided editor.
export {
  DocxEditorHorizontalRuler,
  DocxEditorVerticalRuler,
  type DocxEditorRulerProps,
} from './editor/DocxEditorRulers';
export {
  DocxEditorDocumentOutline,
  type DocxEditorDocumentOutlineProps,
} from './editor/DocxEditorOutline';
export {
  ChartInsert,
  DocxEditorChartPane,
  DocxEditorSidePanel,
  ToolbarChartInsert,
  usePaneRequest,
  useSelectedChart,
  type ChartInsertPartComponent,
  type ChartInsertProps,
  type DocxEditorChartPaneProps,
  type DocxEditorSidePanelProps,
  type UseSelectedChartReturn,
} from './editor/charts';
export {
  DocxEditorShapePane,
  useSelectedShape,
  type DocxEditorShapePaneProps,
  type UseSelectedShapeReturn,
} from './editor/shapes';
export * from './editor/objects';
export {
  ColorPicker,
  type ColorPickerCompound,
  type ColorPickerContentProps,
  type ColorPickerHexInputProps,
  type ColorPickerNoColorProps,
  type ColorPickerRootProps,
  type ColorPickerSwatchProps,
  type ColorPickerTriggerProps,
  type ColorPickerValue,
} from './editor/color/ColorPicker';
// The names a host needs to place shape and chart controls of its own.
export {
  PANE_SECTIONS,
  SHAPE_OUTLINE_DASHES,
  SHAPE_OUTLINE_WIDTHS,
  paneSections,
} from '@docx-editor.dev/core/editor';
export type {
  ColorPick,
  ObjectSlotReadValueMap,
  ObjectSlotValueMap,
  ObjectToggleSlotId,
  PaneSection,
  PaneSectionId,
  PaneSectionIds,
  ShapeOutlineDash,
} from '@docx-editor.dev/core/editor';
export type {
  SelectedShapeCommand,
  ShapeFillState,
  ShapeFormatState,
  ShapeOutlineState,
  ShapePaneChange,
} from '@docx-editor.dev/core/editor';
// The chart names a custom chart pane needs (`useSelectedChart`), so it imports from one package.
export { CHART_TYPE_CHOICES, chartTypeLabelKey } from '@docx-editor.dev/core/editor';
export {
  acceptedOffsetFromText,
  acceptedTextRanges,
  textOffsetFromAccepted,
} from '@docx-editor.dev/core/editor';
export type {
  ChartColor,
  ChartData,
  ChartFormat,
  ChartFormatChange,
  ChartPaneChange,
  ChartType,
  SelectedChartCommand,
  SelectedChartState,
} from '@docx-editor.dev/core/editor';
export {
  DocxEditorPageSetupDialog,
  type DocxEditorPageSetupDialogProps,
} from './editor/DocxEditorPageSetup';
export {
  DocxEditorParagraphDialog,
  type DocxEditorParagraphDialogProps,
} from './editor/DocxEditorParagraphDialog';
export {
  DocxEditorWatermarkDialog,
  useWatermarkDialog,
  type DocxEditorWatermarkDialogProps,
  type UseWatermarkDialogReturn,
  type WatermarkDialogFieldName,
} from './editor/DocxEditorWatermark';
export {
  DEFAULT_WATERMARK_PRESETS,
  type WatermarkDialogFields,
  type WatermarkDialogKind,
  type WatermarkDialogLayout,
} from './editor/watermark-dialog-model';
export { useWatermark, type UseWatermarkReturn } from './editor/useWatermark';
export {
  DocxEditorBookmarkDialog,
  useBookmarkDialog,
  type BookmarkDialogFields,
  type DocxEditorBookmarkDialogProps,
  type UseBookmarkDialogReturn,
} from './editor/DocxEditorBookmark';
export {
  DocxEditorSplitCellDialog,
  useSplitCellDialog,
  type DocxEditorSplitCellDialogProps,
  type SplitCellDialogFields,
  type UseSplitCellDialogReturn,
} from './editor/DocxEditorSplitCell';
export { useBookmarks, type UseBookmarksReturn } from './editor/useBookmarks';
export {
  DocxEditorFontNotice,
  type DocxEditorFontNoticeProps,
} from './editor/DocxEditorFontNotice';
export {
  DocxEditorOpenFailure,
  DocxEditorOpenFailureAction,
  useOpenFailure,
  type DocxEditorOpenFailureActionProps,
  type DocxEditorOpenFailureComponent,
  type DocxEditorOpenFailureContext,
  type DocxEditorOpenFailureMessage,
  type DocxEditorOpenFailureProps,
  type UseOpenFailureOptions,
  type UseOpenFailureReturn,
} from './editor/DocxEditorOpenFailure';
// The review PANE lives in `@docx-editor.dev/pro/react` (the review capability is
// module-gated). What this package exports are the integration points the pro pane —
// or any external chrome — composes with: the rail registry the Viewport and rulers
// reserve gutter space through, the in-tree Slot, and the locale binding.
// The gutter the Viewport reserves for that rail — the pane composes with it to pick a
// presentation the reservation can actually hold (the full column, or the compact strip).
export {
  REVIEW_MARKERS_GUTTER,
  REVIEW_PANE_GUTTER,
  reviewGutter,
  useReviewGutter,
  type ReviewGutter,
  type ReviewGutterInput,
} from './editor/review-gutter';
export { Slot, type SlotProps } from './editor/toolbar/Slot';
export {
  LocaleProvider,
  useChromeDir,
  useTranslation,
  type LocaleProviderProps,
  type TranslationKey,
} from './i18n';
export { useChromeTranslate, type ChromeTranslate } from './i18n';
// The navigation pane (also reachable as `DocxEditor.Navigation`): the compound over the
// left gutter, its parts, and the hooks a custom pane is built from. The pane FLOATS
// — it displaces the page only when the gutter is too narrow to hold it, and
// `navigationShift` is that rule as a pure function a host can reuse or test.
export {
  DocxEditorNavigation,
  NavigationClose,
  NavigationFind,
  NavigationGoTo,
  NavigationHeader,
  NavigationHeadings,
  NavigationTab,
  NavigationTabs,
  NavigationTitle,
  NavigationToggle,
  NAVIGATION_PANE_GAP,
  NAVIGATION_PANE_INSET,
  NAVIGATION_PANE_MIN_PAGE_ROOM,
  NAVIGATION_PANE_WIDTH,
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIGHLIGHT_PRIORITY,
  SEARCH_HIGHLIGHT_SET,
  SEARCH_MATCH_LIMIT,
  navigationPaneOverlays,
  navigationPaneReservation,
  navigationShift,
  useDocumentOutline,
  useDocumentSearch,
  useGoToBookmark,
  useNavigationPane,
  useNavigationShift,
  type DocxEditorNavigationNamespace,
  type DocxEditorNavigationProps,
  type NavigationPartProps,
  type NavigationShiftInput,
  type NavigationTabProps,
  type NavigationTabValue,
  type OutlineHeading,
  type OutlineHeadingItem,
  type UseDocumentOutlineResult,
  type DocumentSearchFindOptions,
  type DocumentSearchHighlight,
  type DocumentSearchNavigateOptions,
  type DocumentSearchOptions,
  type UseDocumentSearchOptions,
  type UseDocumentSearchResult,
  type GoToBookmarkProblem,
  type UseGoToBookmarkOptions,
  type UseGoToBookmarkReturn,
  type UseNavigationPaneOptions,
  type UseNavigationPaneResult,
} from './editor/navigation';
export {
  DocxEditorHeaderFooterChrome,
  type DocxEditorHeaderFooterChromeProps,
} from './editor/DocxEditorHeaderFooter';
export { DocxEditorNotesChrome, type DocxEditorNotesChromeProps } from './editor/DocxEditorNotes';
export { useHeaderFooterState, type HeaderFooterState } from './editor/useHeaderFooterState';
export {
  useNotePropertiesState,
  useNoteScopeState,
  type NotePropertiesState,
} from './editor/useNoteScopeState';
// The link popover (also reachable as `DocxEditor.HyperLink`) and its headless hook. The
// parts live on the namespace statics; a host that wants a different panel takes the hook.
export {
  DocxEditorHyperLink,
  type DocxEditorHyperLinkNamespace,
  type HyperLinkActionProps,
  type HyperLinkPartProps,
  type HyperLinkProps,
} from './editor/DocxEditorHyperLink';
// The right-click menu (also reachable as `DocxEditor.ContextMenu`): the compound over the
// painted surface and its rows. The rows ARE the menu bar's rows — one row presentation,
// two panels — so only the parts unique to this surface are exported bare.
export {
  DocxEditorContextMenu,
  ContextMenuCopy,
  ContextMenuCopyFormatting,
  ContextMenuCut,
  ContextMenuCellVerticalAlignment,
  ContextMenuDelete,
  ContextMenuItem,
  ContextMenuStart,
  ContextMenuPaste,
  ContextMenuPasteFormatting,
  ContextMenuPasteWithoutFormatting,
  ContextMenuSelectAll,
  ContextMenuDeleteTable,
  ContextMenuDeleteTableColumn,
  ContextMenuDeleteTableRow,
  ContextMenuInsertColumnLeft,
  ContextMenuInsertColumnRight,
  ContextMenuMergeCells,
  ContextMenuSplitCell,
  ContextMenuSelectTable,
  ContextMenuInsertRowAbove,
  ContextMenuInsertRowBelow,
  ContextMenuRefreshToc,
  ContextMenuRefreshTocPageNumbers,
  ContextMenuRemoveToc,
  useContextMenuAnchor,
  useContextMenuHighlights,
  useContextMenuTarget,
  type ContextMenuAnchor,
  type ContextMenuCommandProps,
  type ContextMenuContextValue,
  type ContextMenuItemProps,
  type ContextMenuStartProps,
  type ContextMenuTableRowProps,
  type DocxEditorContextMenuNamespace,
  type DocxEditorContextMenuProps,
} from './editor/contextmenu';
export {
  useHyperlinkPopup,
  useHyperlinkPopupInstance,
  isFieldLink,
  type HyperlinkPopupAnchor,
  type HyperlinkPopupMode,
  type HyperlinkPopupState,
  type UseHyperlinkPopupResult,
} from './editor/useHyperlinkPopup';
// Opening a document: the fetch, the fonts and the cancellation every host was writing by
// hand before `DocxEditor` could be given anything to render.
export {
  useDocxSource,
  type DocxFontOrigin,
  type DocxFontsInput,
  type DocxFontsSource,
  type DocxSource,
  type UseDocxSourceOptions,
  type UseDocxSourceResult,
} from './editor/useDocxSource';
// One stable `fonts` prop out of any number of origins, eager or on demand.
export { useFonts, type FontsInput } from './editor/useFonts';
export {
  useContentControl,
  useContentControlInstance,
  CONTENT_CONTROL_SLOTS,
  type ContentControlInspectorState,
  type ContentControlLock,
  type ContentControlSlotId,
  type UseContentControlResult,
} from './editor/useContentControl';
export {
  DocxEditorContentControl,
  type DocxEditorContentControlNamespace,
  type ContentControlActionProps,
  type ContentControlPartProps,
  type ContentControlProps,
} from './editor/DocxEditorContentControl';
export { useReviewAuthors } from './editor/useReviewAuthors';
export {
  DocxEditorAuthorStyle,
  DocxEditorColorByChangeType,
  type DocxEditorAuthorStyleProps,
} from './editor/DocxEditorAuthorStyle';
export { useZoom, type UseZoomResult } from './editor/useZoom';
export { useEditorCaret, type EditorCaret } from './editor/useEditorCaret';
export { useEditorCommand, type EditorCommandState } from './editor/useEditorCommand';
export {
  useEditorValueCommand,
  type EditorValueCommandState,
  type ImageWrapTarget,
} from './editor/useEditorValueCommand';
export {
  DocxEditorImagePropertiesDialog,
  ImageInsertProvider,
  ImageInsertTrigger,
  ImageWrap,
  ImageAltText,
  ImagePropertiesTrigger,
  ToolbarImageProperties,
  normalizeImageBytes,
  type DocxEditorImagePropertiesDialogProps,
  type ImagePropertiesTriggerProps,
  type NormalizedImagePayload,
} from './editor/images';
export {
  DocxEditorPageNumber,
  type DocxEditorPageNumberProps,
  PageNumberTranslationContext,
} from './editor/DocxEditorPageNumber';
export {
  useScopedChromeAnchor,
  type ScopedChromeAnchor,
  type ScopedChromeAnchorPlacement,
} from './editor/useScopedChromeAnchor';
export {
  ToolbarContext,
  useToolbarContext,
  useToolbarLabel,
  useToolbarLabelFor,
  type ToolbarContextValue,
} from './editor/toolbar/toolbar-context';
export { useEditorEvent } from './editor/useEditorEvent';
export { useCommentDraftRequest } from './editor/useCommentDraftRequest';
export {
  useEditorHostDocument,
  type UseEditorHostDocumentReturn,
} from './editor/useEditorHostDocument';
export {
  HIGHLIGHT_REFRESH_MS,
  useHighlights,
  type HighlightSource,
  type UseHighlightsReturn,
} from './editor/useHighlights';
export { useHighlightAt } from './editor/useHighlightAt';
export { usePageSetup, type PageSetupUpdate, type UsePageSetupReturn } from './editor/usePageSetup';
export {
  useParagraphFormat,
  type ParagraphFlagState,
  type ParagraphFormatRead,
  type ParagraphFormatUpdate,
  type ParagraphTabStop,
  type UseParagraphFormatReturn,
} from './editor/useParagraphFormat';
export {
  useParagraphIndent,
  type IndentUpdate,
  type UseParagraphIndentReturn,
} from './editor/useParagraphIndent';

// The compound toolbar (also reachable as `DocxEditor.Toolbar`): default set with
// in-place slot overrides, generic Button, and the font-family compound + hook. The
// concrete part components live on the namespace statics; the index exports the
// namespace, the hook, and the part prop types (the existing `Toolbar`/`ToolbarButton`
// exports below keep their names, so the new parts are not re-exported bare).
export {
  DocxEditorToolbar,
  useFontFamily,
  useParagraphStyle,
  useTableBorderTargetLabel,
  type DocxEditorToolbarNamespace,
  type DocxEditorToolbarProps,
  type ToolbarActionProps,
  type ToolbarAlignmentComponent,
  type FontFamilyItemProps,
  type FontFamilyNamespace,
  type FontFamilyPartProps,
  type FontFamilyProps,
  type ParagraphStyleItemProps,
  type ParagraphStyleNamespace,
  type ParagraphStyleOption,
  type ParagraphStylePartProps,
  type ParagraphStyleProps,
  type ToolbarButtonProps,
  type DocxEditorToolbarGroupProps,
  type DocxEditorToolbarSlotProps,
  type ToolbarPartComponent,
  type ToolbarPartProps,
  type ToolbarReviewersProps,
  type ToolbarSeparatorProps,
  type ToolbarSlotPartComponent,
  type ToolbarSlotPartProps,
  type ToolbarTranslate,
  type UseFontFamilyResult,
  type UseParagraphStyleResult,
  type TableBorderColorNamespace,
  type TableBorderStyleNamespace,
  type TableBorderTargetNamespace,
  type TableBorderWidthNamespace,
  type TableCellFillNamespace,
  type TableChromeItemProps,
  type TableChromePartComponent,
  type TableChromePartProps,
} from './editor/toolbar';

// The compound menu bar (also reachable as `DocxEditor.Menu`): File · Format · Insert ·
// Review · Help, derived FROM `CHROME_MENUS` so a row and its toolbar twin cannot describe the same
// capability differently. The parts live on the namespace statics; the index exports the
// namespace and the part prop types.
export {
  DocxEditorMenu,
  type DocxEditorMenuNamespace,
  type DocxEditorMenuProps,
  type MenuActionProps,
  type MenuGroupProps,
  type MenuId,
  type MenuItemBaseProps,
  type MenuItemProps,
  type MenuPartComponent,
  type MenuProps,
  type MenuReportIssueProps,
  type MenuReviewersProps,
  type MenuRowProps,
  type MenuSeparatorProps,
  type MenuSubmenuBaseProps,
  type MenuSubmenuProps,
  type MenuTableGridProps,
} from './editor/menu';

// The shared engine helpers both adapters expose, so the two package surfaces
// match (enforced by `bun run check:export-parity`).
export {
  CHROME_GROUPS,
  CHROME_MENUS,
  chromeMenuSlots,
  commandForSlot,
  runToolbarCommand,
  toolbarCommandState,
  type ChromeMenu,
  type ChromeMenuEntry,
  type ChromeMenuId,
  type ChromeMenuItemEntry,
  type ChromeMenuSeparatorEntry,
  type ChromeMenuSubmenuEntry,
  type ChromeSlotId,
  type ToolbarCommandState,
} from '@docx-editor.dev/core/editor';
export { PaginatedDocxEditor } from './components/PaginatedDocxEditor';
export { PaginatedDocxEditorShell } from './components/PaginatedDocxEditorShell';
export type { PaginatedDocxEditorShellProps } from './components/PaginatedDocxEditorShell';
export type {
  PaginatedDocxEditorHandle,
  PaginatedDocxEditorExpose,
  PaginatedDocxEditorProps,
} from './components/PaginatedDocxEditor';
export { EditorFontError } from './types';
export type {
  DocxEditorProps,
  DocxEditorRef,
  EditorMode,
  ReviewAuthorInfo,
  RevisionAuthorAssignments,
  RevisionAuthorStyle,
  RevisionStyles,
  EditorFontErrorCode,
  FontConfiguration,
  FontFaceRequest,
  FontSource,
  FontSourceSubstitution,
} from './types';
// The font-composition surface, re-exported so the 80% path (fonts package + adapter)
// never needs a core import.
export {
  MAX_RESOLVER_FAMILIES,
  DEFAULT_FONT,
  WORD_DEFAULT_FONT,
  composeFontConfiguration,
  composeFontOrigins,
  createFontSource,
  deferFonts,
  defineFontResolver,
  isFontResolver,
  loadFonts,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type FontLoadFailure,
  type FontLoadFailureReason,
  type FontOrigin,
  type FontResolutionRequest,
  type FontResolver,
  type FontResolverMark,
  type MarkedFontResolver,
  type FontUrlSource,
  type LoadFontsRequest,
  type LoadFontsResult,
} from '@docx-editor.dev/core/editor';

// Re-export the contract types a consumer needs to drive the editor.
export type {
  AnchorHighlightAnimation,
  AnchorHighlightOptions,
  ClearAnchorHighlightOptions,
  DocumentOpenFailure,
  DocumentOpenFailureReason,
  HighlightHit,
  HighlightKind,
  NavigateHighlightCommand,
  HighlightOptions,
  HighlightRange,
  HighlightRect,
  HighlightResult,
  TextMatch,
  Editor,
  EditorCommand,
  EditorQuery,
  EditorSnapshot,
  EditorScope,
  PageSetup,
  AcceptedTextRange,
  ParagraphText,
  ParagraphsChangeEvent,
  ParagraphTextProofing,
  ParagraphTextReadOptions,
  ParagraphTextSpan,
  ReplaceAcceptedTextCommand,
  ScrollToAnchorOptions,
  Watermark,
  WatermarkState,
} from '@docx-editor.dev/core/contracts/editor';
export type { DocxDocument } from '@docx-editor.dev/core/contracts/types';

export {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  type ToolbarProps,
  type SelectionFormatting,
  type FormattingAction,
} from './components/Toolbar';
export type { TableAction } from './components/ui/TableToolbar';
export type { FontOption } from './lib/fontOptions';
export type { ListState, ListType } from './lib/listState';
export type { ParagraphAlignment } from './components/ui/AlignmentButtons';
export type { DocumentStyleSummary } from './lib/stylePreview';
export type { DocxEditorRefCallback } from './docx-editor-ref-callback';
export { DocxEditorShell } from './components/DocxEditor/DocxEditorShell';
export { TitleBar, MenuBar, DocumentName, Logo, TitleBarRight } from './components/TitleBar';
export { PageIndicator, type PageIndicatorProps } from './components/DocxEditor/PageIndicator';
export {
  DocumentOutline,
  OUTLINE_BUTTON_LEFT_OFFSET,
  OUTLINE_BUTTON_RESERVED_SPACE,
  OUTLINE_LEFT_OFFSET,
  OUTLINE_RESERVED_SPACE,
} from './components/DocumentOutline';
export { HorizontalRuler, type HorizontalRulerProps } from './components/ui/HorizontalRuler';
export { VerticalRuler, RULER_WIDTH, type VerticalRulerProps } from './components/ui/VerticalRuler';
export {
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from './rulerTicks';
export { useEditorSnapshot } from './useEditorSnapshot';

export type {
  DialogPartProps,
  DialogCustomizationProps,
  UseDialogReturn,
} from './editor/dialog-parts';
export type { DocxEditorPopups } from './editor/popup-config';
export { definePopup, type DocxEditorPopup } from './editor/popup-renderer';
export {
  usePageSetupDialog,
  type PageSetupDialogFields,
  type UsePageSetupDialogReturn,
} from './editor/DocxEditorPageSetup';
export {
  useParagraphDialog,
  type UseParagraphDialogReturn,
} from './editor/DocxEditorParagraphDialog';
export {
  DocxEditorTextFormFieldDialog,
  useTextFormFieldDialog,
  type TextFormFieldDialogFields,
  type DocxEditorTextFormFieldDialogProps,
  type UseTextFormFieldDialogReturn,
} from './editor/DocxEditorTextFormFieldDialog';

export {
  DocxEditorImageAltTextPopup,
  type DocxEditorImageAltTextPopupProps,
} from './editor/images/ImageAltText';
export {
  DocxEditorNotePropertiesDialog,
  type DocxEditorNotePropertiesDialogProps,
} from './editor/DocxEditorNotes';
export {
  DocxEditorNotePreview,
  DocxEditorNotesContextMenu,
  type DocxEditorNotePreviewProps,
  type DocxEditorNotesContextMenuProps,
} from './editor/note-popup-parts';

export {
  DocxEditorContentControlWidget,
  type DocxEditorContentControlWidgetProps,
  type DocxEditorContentControlWidgetNamespace,
} from './editor/DocxEditorContentControlWidget';
export {
  useContentControlWidget,
  type UseContentControlWidgetResult,
  type ContentControlWidgetEntry,
} from './editor/content-control-widget/context';
export {
  type DocxEditorContentControlWidgetPartProps,
  type ContentControlWidgetDayProps,
  type ContentControlWidgetItemProps,
  type ContentControlWidgetPictureProps,
} from './editor/content-control-widget/parts';
export {
  DocxEditorInvalidTextFormFieldDialog,
  type DocxEditorInvalidTextFormFieldDialogProps,
} from './editor/DocxEditorInvalidTextFormFieldDialog';
export {
  DocxEditorImageInsertErrorDialog,
  type DocxEditorImageInsertErrorDialogProps,
} from './editor/images/ImageInsertErrorDialog';

export { useHistoryGroup, type UseHistoryGroupReturn } from './editor/useHistoryGroup';

export { createDocumentRefresh, DocumentRefreshError } from '@docx-editor.dev/core/editor';
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
} from '@docx-editor.dev/core/editor';

export type { ChromeExportHandlers, ChromeExportFormat } from '@docx-editor.dev/core/editor';

export {
  DocxEditorExportDialog,
  type DocxEditorExportDialogProps,
} from './editor/DocxEditorExportDialog';

export {
  DocxEditorPrintDialog,
  type DocxEditorPrintDialogProps,
} from './editor/DocxEditorPrintDialog';

export {
  DocxEditorRevisionMarkup,
  type DocxEditorRevisionMarkupProps,
} from './editor/DocxEditorRevisionMarkup';

export type {
  RevisionMarkupOptions,
  RevisionMarkupDialogSession,
  RevisionMarkupChromeHandlers,
  ResolvedRevisionMarkup,
  RevisionMarkupColor,
  RevisionMarkupNamedColor,
  RevisionMarkupMark,
  RevisionDeletionMark,
  RevisionChangedLinesMark,
  ReviewDisplayMode,
} from '@docx-editor.dev/core/editor';

export {
  DocxEditorRevisionMarkupDialog,
  useRevisionMarkupDialog,
  type DocxEditorRevisionMarkupDialogProps,
  type UseRevisionMarkupDialogReturn,
} from './editor/DocxEditorRevisionMarkupDialog';

export type {
  CompareDocumentsChromeHandlers,
  CompareDocumentsDialogSession,
  CompareDocumentsEngineErrorCode,
  CompareDocumentsErrorCode,
  CompareDocumentsRefusalReason,
  CompareDocumentsOutcome,
  CompareDocumentsRequest,
  ReplaceDocumentErrorCode,
  ReplaceDocumentOutcome,
  ReplaceDocumentRefusal,
  ReplaceDocumentRefusalReason,
  ReplaceDocumentRequest,
} from '@docx-editor.dev/core/editor';

export {
  DocxEditorCompareDocumentsDialog,
  useCompareDocumentsDialog,
  type CompareDocumentsDialogValues,
  type DocxEditorCompareDocumentsDialogProps,
  type UseCompareDocumentsDialogReturn,
} from './editor/DocxEditorCompareDocumentsDialog';

export type {
  DrawingGraphicKind,
  DrawingSupport,
  DrawingSupportIssue,
} from '@docx-editor.dev/core/store';
export type {
  UnsupportedElement,
  UnsupportedElementLayout,
  UnsupportedElementRule,
} from '@docx-editor.dev/core/editor';
export {
  DocxEditorUnsupportedElement,
  type DocxEditorUnsupportedElementProps,
} from './editor/DocxEditorUnsupportedElement';
