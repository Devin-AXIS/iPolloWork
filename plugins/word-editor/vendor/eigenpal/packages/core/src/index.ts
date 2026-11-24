/**
 * `@docx-editor.dev/core` — the engine: contracts, layout, store, and the editor facade.
 *
 * One preservation model and one pipeline: bytes are read into a canonical typed-and-generic
 * OOXML tree, mutated only through the store's ops, laid out DOM-free, and painted onto pages
 * that ARE the editable surface. Content the engine does not model is carried losslessly rather
 * than dropped, so an unfamiliar document never locks editing.
 *
 * @example Create an editor over DOCX bytes
 * ```ts
 * import { createDocxEditor } from '@docx-editor.dev/core';
 *
 * const editor = createDocxEditor({ document: bytes });
 * editor.attach(element);
 * ```
 *
 * THIS ENTRY IS THE 80% PATH. Everything needed to stand up an editor over DOCX bytes,
 * measure it with real fonts, and drive it from chrome is here, so the common case is one
 * import. The subpaths (`./store`, `./layout`, `./output`, `./automation`, and the
 * `./contracts/*` declarations) stay available for the deeper work — walking the canonical
 * tree, running layout by hand, painting — and nothing here hides them.
 * If you want the editor already wired to a UI, use `@docx-editor.dev/react`.
 *
 * @packageDocumentation
 * @public
 */

// ─── Create an editor ────────────────────────────────────────────────────────
export {
  createDocxEditor,
  blankDocumentBytes,
  type BlankDocumentOptions,
  type DocxEditorInstance,
  type DocxEditorConfig,
} from './editor/index.ts';
// Map a range of `ParagraphText.acceptedText` to highlight ranges, for proofing tools.
export {
  acceptedOffsetFromText,
  acceptedTextRanges,
  textOffsetFromAccepted,
} from './editor/index.ts';

// What `DocxEditorConfig` accepts and `DocxEditorInstance` answers with, beyond the contract.
//
// Three names this entry point hands out are deliberately NOT re-exported, because each would
// drag a whole type graph onto the 80% path to make one escape hatch nameable:
//   - `PaginatedSurface` (`instance.surface`) reaches TreeDocOp, SemanticLayout and the session
//   - `ImageDecodePort` (`config.imageDecodePort`) reaches the image-resource limit vocabulary
//   - `OoxmlElement`/`OoxmlPart` reach the ~85-member canonical node union
// All are named at the subpath that owns them — `./editor` and `./store` — which is where a
// caller reaching for an internal already is. Using the members needs no import; only writing
// their types down does.
export type {
  ChromeMenu,
  ChromeMenuEntry,
  ChromeMenuId,
  ChromeMenuItemEntry,
  ChromeMenuSeparatorEntry,
  ChromeMenuSubmenuEntry,
  ContentLockPolicy,
  FieldResultsMode,
  FontShapingOptions,
  FontLoadFailureReason,
  FontResolutionRequest,
  FontMeasurementState,
  FontResolver,
  FontUrlSource,
  HyperlinkActivation,
  HyperlinkChromeHandlers,
  BookmarkMarkInfo,
  BookmarkMarkOptions,
  CommentDraftChromeHandlers,
  GoToChromeHandlers,
  LockedControlNavigation,
  SurfaceHyperlink,
} from './editor/index.ts';

// ─── The contract it implements ──────────────────────────────────────────────
//
// The WHOLE contract, not a chosen subset. Hand-listing it is how the entry point ended up
// handing out `CanResult` from `can()`, `TextMatch` from `findText()` and `TableContext` from
// `query()` while exporting none of the three: every addition to the contract had to be
// remembered here a second time, and none of them were. `contracts/editor` is type-only and
// already re-exports `./types`, `./interaction` and `./editor-hf-notes`, so this is the
// contract's transitive closure in one line and it cannot drift again.
export type * from './contracts/editor.ts';

// ─── Fonts: what line and page breaks are measured against ───────────────────
export {
  DEFAULT_FONT,
  WORD_DEFAULT_FONT,
  loadFonts,
  customFonts,
  type CustomFontsOptions,
  type CustomFontsResolver,
  createFontSource,
  FONT_RESOLVER_BRAND,
  FONT_RESOLVER_MARK_KEY,
  composeFontConfiguration,
  composeFontOrigins,
  deferFonts,
  defineFontResolver,
  isFontResolver,
  type ComposeFontOriginsOptions,
  type FontOrigin,
  type FontOriginFailure,
  type FontResolverMark,
  type MarkedFontResolver,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type LoadFontsRequest,
  type LoadFontsResult,
  type FontLoadFailure,
} from './editor/index.ts';
export type { FontConfiguration, FontSource, FontFaceRequest } from './contracts/editor.ts';
// The shape `snapshot().documentProtection` carries. Declared in the store lane, named here
// so a consumer of this package can type the field without reaching into a subpath.
export type {
  DocumentProtectionEdit,
  DocumentProtectionState,
} from './store/package/document-protection.ts';
// What the compare engine takes and returns: the original document as a package.
export type {
  ContentTypeIndex,
  OoxmlExternalTarget,
  OoxmlPackage,
  RelationshipRecord,
  TargetMode,
} from '@docx-editor.dev/core/store';

// ─── Chrome registry: what a toolbar is built from ───────────────────────────
export {
  CHROME_GROUPS,
  CHROME_MENUS,
  chromeMenuSlots,
  commandForSlot,
  commandForSlotValue,
  toolbarCommandState,
  runToolbarCommand,
  type ChromeSlotId,
  type ToolbarCommandState,
} from './editor/index.ts';
// Types the editor's public signatures hand out. The editor entry exports them too; listing
// them here lets a consumer of this entry name what `createDocxEditor` and its methods return.
export type {
  AttachOptions,
  BookmarkChromeHandlers,
  ChromeExportView,
  ChromePrintSettings,
  CollaborationModuleContribution,
  ContentControlWidgetChromeHandlers,
  ContentControlWidgetSession,
  EquationActivation,
  EquationChromeHandlers,
  SurfaceEquation,
  ImageDecodePort,
  ImageResourceLimits,
  InvalidTextFormFieldChromeHandlers,
  InvalidTextFormFieldSession,
  PopupChromeRegistrationOptions,
  ReviewAuthorInfo,
  ReviewPaneOptions,
  RevisionAuthorAssignments,
  RevisionAuthorStyle,
  RevisionMarkupChromeHandlers,
  RevisionMarkupOptions,
  RevisionStyles,
  ChartPaneChange,
  ColorPick,
  ColorPickerThemeSlot,
  ObjectSlotReadValueMap,
  ObjectSlotValueMap,
  TableChromeSlotId,
  ToolbarValueMap,
  ToolbarValueSlot,
} from './editor/index.ts';
export type { RevisionMarkupDialog, RevisionMarkupDialogHost } from './contracts/modules.ts';
export type { CompareDocumentsDialog, CompareDocumentsDialogHost } from './contracts/modules.ts';
export type {
  CompareDocumentsChromeHandlers,
  CompareDocumentsDialogSession,
  CompareDocumentsOutcome,
  CompareDocumentsRequest,
} from './contracts/compare-documents.ts';
export {
  COMPARE_DOCUMENTS_ACCEPT,
  compareDocumentsErrorKey,
} from './contracts/compare-documents.ts';
export type {
  ReplaceDocumentErrorCode,
  ReplaceDocumentOutcome,
  ReplaceDocumentRefusal,
  ReplaceDocumentRefusalReason,
  ReplaceDocumentRequest,
} from './contracts/replace-document.ts';

// ─── Capability modules (what `@docx-editor.dev/pro` implements) ─────────────
export type {
  CollectReviewItems,
  CompareDocumentsBackgroundEngine,
  CompareDocumentsBackgroundResult,
  CompareDocumentsEngine,
  CompareDocumentsEngineErrorCode,
  CompareDocumentsErrorCode,
  CompareDocumentsRefusalReason,
  CompareDocumentsEngineOptions,
  CompareDocumentsEngineResult,
  CompareDocumentsPhase,
  CompareDocumentsProgress,
  EditorModule,
  ReviewModelInput,
  ReviewModuleContribution,
  RevisionDisplayMode,
} from './contracts/modules.ts';

// ─── Anonymous diagnostics: stable codes, fixed hints, no document content ───
export { DIAGNOSTIC_SCHEMA_VERSION } from './contracts/diagnostics.ts';
export { diagnosticCodes, explainDiagnostic } from './automation/diagnostic-hints.ts';
export { diagnosticCauses } from './automation/diagnostic-context.ts';
export { diagnosticCommands } from './editor/diagnostic-commands.ts';
export {
  diagnosticCodeOfRefusal,
  reviewCodeOfRefusal,
  reviewCodeOfSkip,
} from './editor/diagnostic-codes.ts';

// ─── The document model and the edit/query vocabulary ────────────────────────
export type * from './contracts/types';
export type {
  ApplyResult,
  ContentControlSummary,
  DocEdit,
  DocEdits,
  DocQueries,
  DocQuery,
  DocQueryResults,
  ParagraphSummary,
} from './contracts/document.ts';

export {
  bindHistoryGroup,
  type HistoryGroupBinding,
  type HistoryGroupBindingOptions,
} from './editor/bind-history-group.ts';

export { runChromeExport, ChromeExportError } from './editor/chrome-export.ts';
export type {
  ChromeExportFormat,
  ChromeExportHandlers,
  ChromeExportResult,
} from './editor/chrome-export.ts';
export {
  runChromePrint,
  ChromePrintError,
  isChromePrintShortcut,
  initialChromePrintSettings,
  CHROME_PRINT_DISPLAY_MODES,
} from './editor/chrome-print.ts';
export type {
  ChromePrintErrorCode,
  ChromePrintJob,
  ChromePrintOptions,
  ResolvedChromePrintSettings,
} from './editor/chrome-print.ts';
