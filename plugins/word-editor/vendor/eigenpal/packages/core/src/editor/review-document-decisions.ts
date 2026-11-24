import type { EditorCommand } from '../contracts/editor.ts';

type BulkReviewCommand = Extract<EditorCommand, { type: 'resolveAllReviewChanges' }>;

/**
 * The bulk decision behind `acceptAllRevisions` and `rejectAllRevisions`, or `null` for any
 * other command.
 *
 * Both are the document vocabulary's spelling of a decision over every tracked change in every
 * story, so they run as `resolveAllReviewChanges` with `scope: 'document'`: the same gates, the
 * same undo step and the same result. Reviewer filters are a view, so they do not narrow it.
 * The payload is empty by contract; anything an untyped caller adds is not read.
 */
export function documentReviewDecisionOf(command: EditorCommand): BulkReviewCommand | null {
  if (command.type === 'acceptAllRevisions')
    return { type: 'resolveAllReviewChanges', action: 'accept', scope: 'document' };
  if (command.type === 'rejectAllRevisions')
    return { type: 'resolveAllReviewChanges', action: 'reject', scope: 'document' };
  return null;
}

/** Whether a command is a review write that binds a history group. */
export function isGroupedReviewWrite(command: EditorCommand): boolean {
  return (
    command.type === 'resolveAllReviewChanges' ||
    command.type === 'setReviewChangesAuthor' ||
    command.type === 'acceptAllRevisions' ||
    command.type === 'rejectAllRevisions'
  );
}
