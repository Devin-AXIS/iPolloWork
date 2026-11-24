/**
 * The public diagnostic vocabulary: stable codes and the buckets sizes and counts are reported
 * in. It lives in this neutral lane so a headless runtime can name a refusal without the editor
 * contracts; `contracts/diagnostics.ts` re-exports it for the editor's own types.
 */
import type { CollaborationFailureCode } from '../collaboration/index.ts';

/** Why a document could not be opened. @public */
export type DocumentOpenDiagnosticCode =
  | 'open.unsupported-source'
  | 'open.zip-corrupt'
  | 'open.zip-invalid-entry-name'
  | 'open.zip-entry-limit'
  | 'open.zip-size-limit'
  | 'open.zip-ratio-limit'
  | 'open.xml-malformed'
  | 'open.xml-dtd-forbidden'
  | 'open.xml-part-size-limit'
  | 'open.xml-depth-limit'
  | 'open.xml-element-limit'
  | 'open.invalid-limits'
  | 'open.content-types-invalid'
  | 'open.missing-main-document'
  | 'open.relationships-invalid'
  | 'open.relationship-limit'
  | 'open.part-limit'
  | 'open.failed';

/**
 * Why `save()` did not return the document: no document was loaded, the document changed while
 * a pending edit finished, or the save threw.
 *
 * @public
 */
export type DocumentSaveDiagnosticCode =
  'save.no-document' | 'save.document-changed' | 'save.failed';

/** Why an edit, a command or a tracked change was refused. @public */
export type EditDiagnosticCode =
  | 'edit.read-only'
  | 'edit.protected-content'
  | 'edit.suggesting-needs-author'
  | 'edit.review-module-required'
  | 'edit.tracked-drawing-delete-unsupported'
  | 'edit.tracked-structure-unsupported'
  | 'edit.tracked-operation-unsupported'
  | 'edit.tracking-mode-unsupported'
  | 'edit.tracking-author-required'
  | 'edit.comment-author-required'
  | 'edit.comment-author-mismatch'
  | 'edit.tracking-unsupported-host'
  | 'edit.revision-unsupported'
  | 'edit.tracking-required'
  | 'edit.tracked-image-replace-unsupported'
  | 'edit.tracked-deleted-text-only'
  | 'edit.tracked-foreign-revision-unsupported'
  | 'edit.tracked-own-pending-change'
  | 'edit.picture-selected'
  | 'edit.cross-structure-join'
  | 'edit.indivisible-content'
  | 'edit.field-structure'
  | 'edit.field-unsupported'
  | 'edit.field-result-unsupported'
  | 'edit.ooxml-unsupported'
  | 'edit.style-not-defined'
  | 'edit.no-styles-defined'
  | 'edit.section-mark'
  | 'edit.content-required'
  | 'edit.table-structure-unsupported'
  | 'edit.table-merge-not-rectangle'
  | 'edit.table-split-unsupported'
  | 'edit.table-insert-refused'
  | 'edit.table-of-contents-refused'
  | 'edit.unsupported-content'
  | 'edit.operation-unsupported'
  | 'edit.unsupported-story'
  | 'edit.unmapped-change'
  | 'edit.stale-target'
  | 'edit.invalid-argument'
  | 'edit.resource-limit'
  | 'edit.refresh-in-progress'
  | 'edit.preview-active'
  | 'edit.preview-unsupported'
  | 'edit.preview-composing'
  | 'edit.preview-diverged'
  | 'edit.read-after-commit'
  | 'edit.collaboration-not-ready'
  | 'edit.collaboration-text-limit'
  | 'edit.internal-invariant'
  | 'edit.refused';

/** Why accepting, rejecting or re-authoring a tracked change skipped an item. @public */
export type ReviewDiagnosticCode =
  | 'review.revision-unsupported'
  | 'review.incomplete-group'
  | 'review.retained-structure'
  | 'review.locked-content'
  | 'review.bound-content'
  | 'review.stale-revision';

/** Why a font did not load. The family name is never reported. @public */
export type FontDiagnosticCode =
  | 'font.shaper-unavailable'
  | 'font.load-failed'
  | 'font.missing'
  | 'font.integrity-mismatch'
  | 'font.malformed'
  | 'font.size-limit'
  | 'font.unsupported-face';

/**
 * Why the undo history did not group edits as one step. Informational: nothing was refused.
 *
 * @public
 */
export type HistoryDiagnosticCode =
  'history.split' | 'history.possible-ungrouped-gesture' | 'history.possible-fragmented-gesture';

/**
 * Why a performance summary needs attention. Informational: nothing was refused.
 *
 * @public
 */
export type PerformanceDiagnosticCode = 'performance.slow-interaction';

/** Why a custom node's stored payload could not be read. The node name is never reported. @public */
export type CustomNodeDiagnosticCode =
  'custom-node.payload-invalid' | 'custom-node.payload-missing';

/**
 * Why a collaboration session failed or refused work: `collab.` and the session's own public
 * {@link CollaborationFailureCode}, such as `collab.authentication-failed`.
 *
 * @public
 */
export type CollaborationDiagnosticCode = `collab.${CollaborationFailureCode}`;

/** Every public diagnostic code. Codes are stable: a new one is additive, none is renamed. @public */
export type DiagnosticCode =
  | DocumentOpenDiagnosticCode
  | DocumentSaveDiagnosticCode
  | EditDiagnosticCode
  | ReviewDiagnosticCode
  | FontDiagnosticCode
  | HistoryDiagnosticCode
  | CustomNodeDiagnosticCode
  | PerformanceDiagnosticCode
  | CollaborationDiagnosticCode;

/**
 * A coarse size, in powers of two, so a size cannot single out one document.
 * `'0-64KiB'` covers everything under 64 KiB; `'512MiB+'` everything above.
 *
 * @public
 */
export type ByteSizeBucket =
  | '0-64KiB'
  | '64-128KiB'
  | '128-256KiB'
  | '256-512KiB'
  | '512KiB-1MiB'
  | '1-2MiB'
  | '2-4MiB'
  | '4-8MiB'
  | '8-16MiB'
  | '16-32MiB'
  | '32-64MiB'
  | '64-128MiB'
  | '128-256MiB'
  | '256-512MiB'
  | '512MiB+';

/** A coarse count: `'0'`, `'1'`, `'2-9'`, `'10-99'`, `'100-999'`, `'1000+'`. @public */
export type CountBucket = '0' | '1' | '2-9' | '10-99' | '100-999' | '1000+';

/**
 * Which kind of package part a failure is in, by its role, never by its name: a part's real
 * name is file data. A name outside the standard layout reports `'other'`.
 *
 * @public
 */
export type DocumentPartKind =
  | 'package'
  | 'content-types'
  | 'relationships'
  | 'main-document'
  | 'glossary'
  | 'styles'
  | 'numbering'
  | 'settings'
  | 'web-settings'
  | 'font-table'
  | 'theme'
  | 'header'
  | 'footer'
  | 'footnotes'
  | 'endnotes'
  | 'comments'
  | 'people'
  | 'custom-xml'
  | 'document-properties'
  | 'media'
  | 'embedding'
  | 'other';

/**
 * The class of an unexpected exception, for a failure the engine did not name. The message is
 * never reported, because it can quote document content.
 *
 * @public
 */
export type DiagnosticErrorName =
  'Error' | 'TypeError' | 'RangeError' | 'ReferenceError' | 'SyntaxError' | 'other';

/** What a tracked-change request was asked to do. @public */
export type ReviewOperation = 'accept' | 'reject' | 'reassign';

/** The kind of a tracked change, as the review queue lists it. @public */
export type ReviewChangeKind =
  | 'insert'
  | 'delete'
  | 'replace'
  | 'moveFrom'
  | 'moveTo'
  | 'format'
  | 'paragraphMark'
  | 'structural';

/**
 * Which property change a formatting change is, by its OOXML element. A name outside this list
 * reports `'other'`.
 *
 * @public
 */
export type FormattingChangeKind =
  | 'rPrChange'
  | 'pPrChange'
  | 'sectPrChange'
  | 'tblPrChange'
  | 'tblPrExChange'
  | 'tblGridChange'
  | 'trPrChange'
  | 'tcPrChange'
  | 'numberingChange'
  | 'other';

/**
 * Where an exception the engine did not expect was caught: the mount of an open, a later layout
 * slice of an open, a command, a single review action, or an editing API batch.
 *
 * @public
 */
export type FailureStage =
  'open-mount' | 'open-layout' | 'command' | 'review-item' | 'automation' | 'save';
