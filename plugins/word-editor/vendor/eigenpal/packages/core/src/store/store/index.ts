// Semantic document store — the canonical-tree lane (document-engine section 4).
// The legacy PackageModel store (DocOps, DocumentStore, history periphery) was deleted
// with the legacy editor pipeline; `TreeDocumentStore` over the ordered OOXML tree is
// the only store.
export {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  applyTreeOp,
  inlineControlEndingAt,
  inlineControlStartingAt,
  paragraphOffsetIndex,
  paragraphTextOf,
  validateTreeOp,
  TREE_DOC_OP_KINDS,
  type ImpactClass,
  type InlineControlSpan,
  type OffsetSpan,
  type OoxmlProperty,
  type TabStopWrite,
  type ParagraphOffsetIndex,
  type Segment,
  type TreeDocOp,
  type TreeDocOpKind,
  type DrawingTreeDocOp,
  type ShapeFillInput,
  type ShapeOutlineDash,
  type ShapeOutlineInput,
  type ShapeThemeColorInput,
  type ShapeThemeColorName,
  type TreeOpEffect,
  type TreeOpRejection,
  type TreeOpResult,
} from './tree-ops.ts';
export { segmentsOfCopy as segmentsOf } from './tree-op-segments.ts';
export {
  extractFragmentPackage,
  type FragmentCoverage,
  type FragmentExtractRejection,
  type FragmentExtractResult,
} from './clipboard-fragment-extract.ts';
export {
  mergeFragmentIntoPackage,
  type FragmentMergeRejection,
  type FragmentMergeResult,
} from './clipboard-fragment-merge.ts';
export {
  MAX_FRAGMENT_DECODED_BYTES,
  applyFragmentPaste,
  type FragmentPasteInput,
  type FragmentPasteEnd,
  type FragmentPasteResult,
} from './tree-package-fragment.ts';
export {
  TreeDocumentStore,
  type SelectionMark,
  type TransactionContext as TreeTransactionContext,
  type TransactOptions as TreeTransactOptions,
  type TransactResult as TreeTransactResult,
  type TreeDocumentStoreOptions,
  type TreeModelChange,
  type TreeStoryRef,
} from './tree-store.ts';
export {
  DEFAULT_MAX_EDITABLE_STORY_PARTS,
  TreePackageStore,
  type PackageTransactResult,
  type StoryResolveResult,
  type StoryScope,
  type StoryTargetRejection,
  type TreePackageStoreOptions,
} from './tree-package-store.ts';
export type { RemotePackageAttribution } from './tree-package-remote.ts';
export {
  addPackageComment,
  deletePackageComments,
  setPackageCommentResolved,
  setPackageCommentText,
  setPackageCommentTexts,
  type PackageCommentDelete,
} from './comment-package-write.ts';
export { insertPackageCustomNode, removePackageCustomNode } from './custom-node-package-write.ts';
export { refreshBoundContent } from './bound-content-refresh.ts';
export { nextCommentId } from './comment-id-mint.ts';
export {
  addComment,
  setCommentResolved,
  setCommentText,
  commentPartNameOf,
  commentsExtendedPartNameOf,
  hasCommentPart,
  type AddCommentRequest,
  type AddCommentResult,
  type CommentAnchorRequest,
  type SetCommentResolvedResult,
  type SetCommentTextResult,
} from './comment-writes.ts';
export {
  MAX_CUSTOM_NODE_LABEL_LENGTH,
  MAX_CUSTOM_NODE_PAYLOAD_LENGTH,
  customNodePayloadsByControl,
  customNodePayloadsOf,
  insertCustomNodeWrite,
  removeCustomNodeWrite,
  sweepCustomNodePayloads,
  type CustomNodePayloadRead,
  type CustomNodePayloadWrite,
  type CustomNodeSweepOutcome,
  type CustomNodeSweepResult,
  type CustomNodeWriteRejection,
  type CustomNodeWriteResult,
  type InsertCustomNodeWrite,
} from './custom-node-writes.ts';
export {
  AUTHORABLE_PARAGRAPH_PROPERTIES,
  AUTHORABLE_RUN_PROPERTIES,
  authoredProperties,
  directParagraphMarkProperties,
  directParagraphProperties,
  formatOwnedRunIds,
  formattableRanges,
  isAuthorableRunProperty,
  mergedFontProperty,
  mergedMultiSettingProperty,
  mergedParagraphMarkProperties,
  mergedProperties,
  propertyContainer,
  runAddressRanges,
  runPropertyEdits,
  runsCovering,
  type RunPropertyEdit,
} from './direct-properties.ts';
export {
  DEFAULT_FORMATTING_DISPLAY_MODE,
  type FormattingDisplayMode,
  type FormattingRevisionAuthorFilter,
} from './formattable-runs.ts';
export { collectRevisionSites, type RevisionAddress } from './tree-op-revisions.ts';
export { LEVEL_INDENT_ATTRIBUTES } from './tree-op-list-level-indent.ts';
export { healedTableView } from './tree-op-table-heal.ts';
export type { RevisionSiteRefusal } from './revision-site-refusal.ts';
export {
  commentAnchorsOfStory,
  commentsOfPart,
  threadStateOfPart,
  W15_NAMESPACE_URI,
  type CommentAnchor,
  type CommentPosition,
  type CommentRecord,
  type CommentThreadState,
} from './comment-reads.ts';
export {
  collectReviewItems,
  commentBodyText,
  commentInitials,
  commentItemsOf,
  deepParagraphOrderOfPart,
  linkRevisionReplies,
  locateSites,
  paragraphOrderOfPart,
  revisionItemsOf,
  type LinkableReviewItem,
} from './review-reads.ts';
export {
  firstReviewRange,
  reviewItemKey,
  reviewItemRanges,
  type ReviewCommentItem,
  type ReviewCustomItem,
  type ReviewItem,
  type ReviewModelInput,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
  type ReviewRevisionKind,
} from './review-items.ts';
export {
  SEARCH_MATCH_LIMIT,
  SEARCH_QUERY_MAX,
  findOccurrences,
  foldCase,
  isSearchableQuery,
  isWholeWord,
  type TextMatchOptions,
  type TextOccurrence,
  type TextOccurrences,
} from './text-match.ts';
export {
  drawingOpImpact,
  isDrawingTreeDocOp,
  validateDrawingOp,
  wrapTargetToAnchorSpec,
} from './tree-op-drawings.ts';
export {
  allocateDrawingPropertyId,
  withBinaryPart,
  withEmbeddedImage,
  withoutUnreferencedImagePart,
  type DrawingPropertyIdResult,
} from '../package/drawing-package-edit.ts';
export {
  IMAGE_WRAP_TARGETS,
  projectDrawing,
  type DrawingKind,
  type DrawingLocks,
  type DrawingPositionInput,
  type ImageWrapTarget,
  type SourceCrop,
} from '../package/drawing-projection.ts';
export type { ImageResourceState, SupportedImageMime } from '../package/image-resources.ts';
export type { DiagramPartResolver, DiagramParts } from '../package/diagram-parts.ts';
export type { ChartPart, ChartPartResolver, ChartThemeFaces } from '../package/chart-parts.ts';
export type { ChartexPart, ChartexPartResolver } from '../package/chartex-parts.ts';

export { textFormFieldsOf, type TextFormFieldRange } from './text-form-fields.ts';
export {
  legacyCheckboxFieldsOf,
  type LegacyCheckboxFieldRange,
  type SetLegacyCheckboxOp,
} from './legacy-checkbox-fields.ts';
export { type InsertBuildingBlockOp } from './building-block-insert.ts';
export {
  type InsertParagraphBesideTableOp,
  type InsertTableOp,
  type MoveTableOp,
} from './table-placement-op-types.ts';
export {
  enclosedBookmarkDeletions,
  withoutBookmarkInPart,
  type BookmarkOpPosition,
  type DeleteBookmarkOp,
  type InsertBookmarkOp,
} from './tree-op-bookmarks.ts';
export { materializeGlossaryPlaceholders } from './placeholder-materialize.ts';

export { formsProtectionEnabled, sectionProtectsForms } from './tree-op-content-controls.ts';

export type { InsertTextOp, DeleteTextOp } from './text-edit-op-types.ts';
export type { InsertComplexFieldOp, InsertPageFieldOp } from './tree-op-field-insert.ts';
export type { SetFieldResultOp } from './tree-op-field-result-write.ts';
export type { InsertEquationOp } from './tree-op-equation-insert.ts';
export type {
  ParagraphBorderEdgeName,
  ParagraphBorderEdgeWrite,
  SetParagraphBordersOp,
} from './tree-op-paragraph-borders.ts';
export type { SetTextFormFieldDefaultOp } from './text-form-fields.ts';

export { type TextFormFieldOptions, type TextFormFieldType } from './text-form-field-options.ts';
export type { CommitTextFormFieldOp } from './text-form-fields.ts';

export {
  planRevisionBatch,
  type RevisionBatchEntry,
  type RevisionBatchResult,
  type RevisionBatchSkipReason,
  type RevisionBatchSkipDetail,
} from './revision-batch.ts';
export {
  planRevisionAuthorChange,
  type RevisionAuthorEntry,
  type RevisionAuthorResult,
  type RevisionAuthorSkipReason,
} from './revision-author-change.ts';
export type { HistoryGroup } from './history-group.ts';

export {
  observeHistoryGroup,
  reportHistoryGroup,
  type HistoryCaptureKind,
} from './history-group.ts';

export type { SetLegacyDropdownOp } from './legacy-dropdown-fields.ts';

export { normalizeCommentBodyText } from './comment-body.ts';
