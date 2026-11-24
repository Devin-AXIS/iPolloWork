/**
 * `@docx-editor.dev/core/automation` — the host protocol document automation runs against.
 *
 * One interface with two implementations: a headless host owning bytes it opened, and a browser
 * host borrowing the live editor's session. Both answer the same operations identically, because
 * the operations are implemented once above this protocol.
 *
 * Everything here is transport-shaped — a handle is a NAME, never a pointer — so the same host
 * works behind a worker port, an HTTP boundary, or nothing at all.
 *
 * @packageDocumentation
 * @public
 */
// The automation lane: one transport-neutral host port for document automation.
//
// An automation object model — the batching, promise-shaped API a script or an agent
// programs against — needs exactly two things from the engine: a way to name objects in a
// document, and a way to send an ordered batch of reads and writes at it. Everything else
// about it is transport. This lane is that port, and nothing above it.
//
// It is DELIBERATELY the same port for a server and for a live editor. Two hand-written
// hosts would be two document models, and the second one always ends up deriving authority
// from whatever it can see — painted DOM, a projection, a cached read — which is how a
// scripted edit and a typed edit stop agreeing. Here both hosts hand this lane a
// `AutomationDocumentPort` over the SAME canonical package and the SAME
// `TreeDocumentStore.transact` write path, and every read and every operation is
// implemented once, above the port.
//
// Neutral means neutral: no DOM, no framework, no Node builtin, no editor lane. The lane's
// own tsconfig omits the DOM lib so a `document` reference here cannot compile, and
// `__tests__/automation-lane-boundary.test.ts` walks the lane's real import graph.

// The protocol: what a host is, what a batch is, and what can go wrong.
export type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationCapabilities,
  AutomationChangeEvent,
  AutomationError,
  AutomationErrorCode,
  AutomationHandle,
  AutomationHandleRef,
  AutomationHost,
  AutomationObjectKind,
  AutomationOperationResult,
  AutomationSaveResult,
  AutomationSpan,
  AutomationUnsubscribe,
  AutomationValue,
  AutomationEndpoint,
} from './protocol.ts';

// Sections: page geometry in points, and what a write may author on one section.
export type {
  AutomationPageOrientation,
  AutomationPageSetupRead,
  AutomationPageSetupWrite,
} from './sections.ts';

// Which story a handle names: the body, a header or footer variant, or one note.
export {
  HEADER_FOOTER_VARIANTS,
  type AutomationStoryId,
  type AutomationShapeOwnerStory,
} from './stories.ts';

// Reads and payloads the operation vocabulary hands back.
export type { AutomationAuthoringOperation } from './authoring-operations.ts';
export type { AutomationContentControlOperation } from './content-control-operations.ts';
export type { AutomationInlinePictureRead, AutomationInlinePictureWrite } from './pictures.ts';
export type { AutomationShapeRead, AutomationShapeType } from './shapes.ts';
export type {
  AutomationShapeFillRead,
  AutomationShapeFillType,
  AutomationShapeFillWrite,
} from './shape-fill.ts';
export type {
  AutomationListBullet,
  AutomationListLevelFormat,
  AutomationListNumbering,
} from './list-authoring.ts';
export type { AutomationTableMutation } from './tables.ts';
export type { AutomationStyleKind, AutomationStyleRead } from './style-listing.ts';

// Formatting: what a span agrees about its characters, and what a write may author.
export type {
  AutomationAlignment,
  AutomationLineSpacingRule,
  AutomationReadingOrder,
  AutomationFontRead,
  AutomationFontWrite,
  AutomationParagraphFormatRead,
  AutomationParagraphFormatWrite,
} from './formatting.ts';
export type {
  AutomationBorderColorIndex,
  AutomationBorderLineStyle,
  AutomationBorderLineWidth,
  AutomationParagraphBorderAssignment,
  AutomationParagraphBorderEdge,
  AutomationParagraphBorderProperty,
  AutomationParagraphBorderRead,
  AutomationParagraphBordersWrite,
} from './paragraph-borders.ts';

// The operation vocabulary.
export {
  AUTOMATION_COMMAND_OPERATIONS,
  AUTOMATION_QUERY_OPERATIONS,
  AUTOMATION_SOLITARY_OPERATIONS,
  isAutomationCommand,
  isSolitaryAutomationCommand,
  type AutomationContentControlLock,
  type AutomationContentControlRangeLocation,
  type AutomationContentControlScope,
  type AutomationContentControlSubtype,
  type AutomationContentControlValue,
  type AutomationOperation,
  type AutomationOperationKind,
  type AutomationParagraphRef,
  type AutomationPoint,
  type AutomationSearchOptions,
  type AutomationSelectionMode,
  type AutomationSpanRef,
  type AutomationTextProjection,
  type AutomationCustomNodePayload,
} from './operations.ts';

// The headless host. The browser host adapter ships from the editor subpath, because it takes
// a live editor; both are built on the same internal composition factory, which is
// deliberately NOT exported — a consumer that could compose its own host over its own port
// could build the second document model this lane exists to make unnecessary.
export {
  createServerAutomationHost,
  SERVER_AUTOMATION_CAPABILITIES,
  type ServerAutomationHostOptions,
  type ServerAutomationHostRejection,
  type ServerAutomationHostResult,
} from './server-host.ts';
// `ServerAutomationHostOptions.contentLockPolicy` takes it.
export type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
// `ServerAutomationHostOptions.compareDocuments` takes it.
export type {
  CompareDocumentsEngine,
  CompareDocumentsEngineErrorCode,
  CompareDocumentsErrorCode,
  CompareDocumentsRefusalReason,
  CompareDocumentsEngineOptions,
  CompareDocumentsEngineResult,
} from '../contracts/document-compare.ts';

export {
  createAutomationPaginationProvider,
  type AutomationPaginationOptions,
  paginationSnapshotOf,
  type AutomationPaginationSnapshot,
  type AutomationPaginationProvider,
} from './pagination.ts';

export type {
  RevisionBatchResult,
  RevisionBatchEntry,
  RevisionBatchSkipReason,
  RevisionBatchSkipDetail,
} from '../store/store/revision-batch.ts';
export type { RevisionSiteRefusal } from '../store/store/revision-site-refusal.ts';
export type {
  RevisionAuthorEntry,
  RevisionAuthorResult,
  RevisionAuthorSkipReason,
} from '../store/store/revision-author-change.ts';

// Anonymous diagnostics: the store reasons' public codes and the delivery path both hosts share.
export {
  byteSizeBucket,
  countBucket,
  createDiagnosticEmitter,
  openDiagnosticCode,
  reviewCodeOfSkip,
  reviewDiagnosticCode,
  storeEditDiagnosticCode,
  type DiagnosticEmitter,
  type DiagnosticPayload,
} from './diagnostics.ts';
export {
  diagnosticCodes,
  explainDiagnostic,
  type DiagnosticExplanation,
} from './diagnostic-hints.ts';
export {
  diagnosticCause,
  diagnosticCauses,
  diagnosticErrorName,
  documentPartKind,
  exceptionCause,
  reviewSkipOfReason,
} from './diagnostic-context.ts';
export type {
  ByteSizeBucket,
  CollaborationDiagnosticCode,
  CountBucket,
  CustomNodeDiagnosticCode,
  DiagnosticCode,
  DiagnosticErrorName,
  DocumentOpenDiagnosticCode,
  DocumentPartKind,
  DocumentSaveDiagnosticCode,
  FailureStage,
  FormattingChangeKind,
  ReviewChangeKind,
  ReviewOperation,
  EditDiagnosticCode,
  FontDiagnosticCode,
  HistoryDiagnosticCode,
  PerformanceDiagnosticCode,
  ReviewDiagnosticCode,
} from './diagnostic-vocabulary.ts';

// The editor's history group handle, by type only, so an automation runtime can name it
// without depending on the editor lane.
export type { HistoryGroup, HistoryGroupOutcome } from '../contracts/editor-scope.ts';
