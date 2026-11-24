import type { AutomationOperation, AutomationOperationKind } from './operations.ts';

/** Operations that read. They never open a transaction. */
export const AUTOMATION_QUERY_OPERATIONS = [
  'getTables',
  'getTable',
  'getTableRows',
  'getTableCells',
  'getTableCell',
  'getMergedTableCell',
  'getTableCellProperties',
  'getTableCellBody',
  'getFields',
  'getField',
  'getFieldResult',
  'getInlinePictures',
  'getInlinePicture',
  'getShapes',
  'getShape',
  'getShapeBody',
  'getShapeFill',
  'getChangeTrackingMode',
  'getDocument',
  'getDocumentProperty',
  'getStyles',
  'getBody',
  'getParagraphs',
  'getRange',
  'getSpanParagraphs',
  'getText',
  'getSpanText',
  'getTextRanges',
  'getParagraphTextIfPresent',
  'getParagraphTextSpan',
  'expandSpan',
  'getReviewedText',
  'getParagraphId',
  'search',
  'getFont',
  'getParagraphFormat',
  'getParagraphBorders',
  'getStyle',
  'getSections',
  'getPageSetup',
  'getFurniture',
  'getNotes',
  'getNoteBody',
  'getNoteText',
  'getNoteKind',
  'getLists',
  'getListId',
  'getListById',
  'getListParagraphs',
  'getParagraphList',
  'getListLevel',
  'getHyperlink',
  'getBookmarks',
  'getBookmarkName',
  'getBookmarkRange',
  'getBookmarkNames',
  'getBookmarkRangeByName',
  'getComments',
  'getCommentReplies',
  'getCommentId',
  'getCommentAuthor',
  'getCommentDate',
  'getCommentText',
  'getCommentRange',
  'getCommentResolved',
  'getRevisions',
  'getRevisionType',
  'getRevisionAuthor',
  'getRevisionDate',
  'getRevisionRange',
  'getReviewItemRange',
  'getContentControls',
  'getContentControlById',
  'getContentControlsByTag',
  'getContentControlsByTitle',
  'getContentControlTag',
  'getContentControlTitle',
  'getContentControlFileId',
  'getContentControlSubtype',
  'getContentControlLock',
  'getContentControlIsBound',
  'getContentControlPlaceholderShown',
  'getContentControlTemporary',
  'getContentControlText',
  'getContentControlParagraphs',
  'getContentControlRange',
] as const satisfies readonly AutomationOperationKind[];

/** Operations that write. Every one of these goes through the single transaction path. */
export const AUTOMATION_COMMAND_OPERATIONS = [
  'removeDocumentInformation',
  'compareFromBase64',
  'replaceDocumentFromBase64',
  'setDocumentProperties',
  'insertTableRows',
  'insertTable',
  'updateTable',
  'updateTableCell',
  'splitTableCell',
  'setInlinePicture',
  'setShapeFill',
  'deleteInlinePicture',
  'insertField',
  'insertOoxml',
  'setFieldCode',
  'setFieldResult',
  'deleteField',
  'updateFieldResult',
  'insertInlinePicture',
  'insertBreak',
  'setChangeTrackingMode',
  'proposeInsertion',
  'proposeDeletion',
  'proposeReplacement',
  'insertText',
  'replaceSpan',
  'replaceStoryBlocks',
  'insertParagraph',
  'splitParagraph',
  'deleteParagraph',
  'selectSpan',
  'selectBookmark',
  'insertBookmark',
  'deleteBookmark',
  'setFont',
  'setParagraphFormat',
  'setStyle',
  'setPageSetup',
  'deleteNote',
  'setListLevel',
  'startNewList',
  'attachToList',
  'detachFromList',
  'setListLevelFormat',
  'insertListParagraph',
  'setHyperlink',
  'insertComment',
  'setCommentResolved',
  'setCommentText',
  'replyToComment',
  'deleteComment',
  'acceptRevision',
  'rejectRevision',
  'resolveRevisionBatch',
  'setRevisionAuthorBatch',
  'acceptAllRevisions',
  'rejectAllRevisions',
  'setContentControlValue',
  'setContentControlProperties',
  'deleteContentControl',
  'insertContentControlText',
  'insertContentControl',
  'insertCustomNode',
] as const satisfies readonly AutomationOperationKind[];

/**
 * Commands that commit as a PACKAGE transaction and therefore share a batch with nothing.
 *
 * A note's lifecycle rewrites several parts at once — the notes part, the references in every
 * story that cited it, the relationship and the content-type override — and the store publishes
 * that as its own undo unit rather than as ops inside a story transaction. Two of them, or one
 * beside a story command, would be two commits: two revisions, and a moment where half the
 * caller's batch is published. Refused while planning instead.
 *
 * Some operations are solitary only in some forms: an `insertBreak` with `Line` is a text write
 * and shares its batch, and some `updateTable` mutations travel alone. Classify one operation
 * with {@link isSolitaryAutomationCommand}, not by membership here.
 */
export const AUTOMATION_SOLITARY_OPERATIONS = [
  'removeDocumentInformation',
  'compareFromBase64',
  // A replacement rewrites every part, so a command beside it would address a document that
  // no longer exists when it commits.
  'replaceDocumentFromBase64',
  'insertTableRows',
  'resolveRevisionBatch',
  'setRevisionAuthorBatch',
  'insertTable',
  'insertInlinePicture',
  'insertBreak',
  'startNewList',
  'deleteNote',
  'insertComment',
  'setCommentResolved',
  'replyToComment',
  // A payload write is a package transaction of its own — the data part, the node inside it and
  // the body's control — so it shares a batch with nothing, for the same reason a reply does not.
  'insertCustomNode',
] as const satisfies readonly AutomationOperationKind[];

const SOLITARY: ReadonlySet<string> = new Set(AUTOMATION_SOLITARY_OPERATIONS);

/** Whether an operation must be the only one in its batch. */
export function isSolitaryAutomationCommand(operation: AutomationOperation): boolean {
  return (
    // A line break is an inline insertion, like text, so it shares its batch.
    (SOLITARY.has(operation.op) &&
      !(operation.op === 'insertBreak' && operation.breakType === 'Line')) ||
    (operation.op === 'updateTable' &&
      ['addRows', 'addColumns', 'deleteRows', 'deleteColumns', 'delete'].includes(
        operation.mutation.kind
      ))
  );
}

// Compile-time exhaustiveness: a new operation must be classified as a query or a command, or
// this fails to typecheck. Without it a new operation would default to "not a command" and
// silently skip the transaction path.
type _Unclassified = Exclude<
  AutomationOperationKind,
  (typeof AUTOMATION_QUERY_OPERATIONS)[number] | (typeof AUTOMATION_COMMAND_OPERATIONS)[number]
>;
const _operationsClassified: _Unclassified extends never ? true : ['unclassified', _Unclassified] =
  true;
void _operationsClassified;

const COMMANDS: ReadonlySet<string> = new Set(AUTOMATION_COMMAND_OPERATIONS);

/** Whether an operation writes. Drives the query/command split inside one batch. */
export function isAutomationCommand(operation: AutomationOperation): boolean {
  return COMMANDS.has(operation.op);
}
