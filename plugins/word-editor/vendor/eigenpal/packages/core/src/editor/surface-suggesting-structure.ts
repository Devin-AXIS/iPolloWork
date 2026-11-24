import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { findNode } from '../store/package/ooxml-edit.ts';
import { isOwnPendingTableInsertion } from '../store/store/table-authoring-plan.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import { partOfNodeId } from './surface-scope.ts';
import { SUGGESTING_CELL_STRUCTURE_REFUSAL } from './table-cell-structure-plan.ts';

export const SUGGESTING_TABLE_MOVE_REFUSAL =
  'suggesting cannot move a table; stop suggesting to move it';

export const SUGGESTING_FORM_FIELD_VALUE_REFUSAL =
  'suggesting cannot change a form field checkbox or dropdown; stop suggesting to change it';

export const SUGGESTING_TABLE_DELETE_REFUSAL =
  'suggesting cannot delete a whole table; stop suggesting to delete it, or delete its rows one at a time';

/** Whether a block id names a `w:tbl`, in whichever part of the package holds it. */
export function tableLookupIn(
  session: Pick<TreeDocxSessionView, 'currentPackage' | 'part' | 'storyParts'>
): (blockId: string) => boolean {
  return (blockId) => {
    const part = partOfNodeId(session, blockId);
    return part !== null && findNode(part, blockId)?.kind === 'table';
  };
}

/** Whether a table is the author's own pending insertion, in whichever part holds it. */
export function ownProposedTableIn(
  session: Pick<TreeDocxSessionView, 'currentPackage' | 'part' | 'storyParts'>,
  author: string | undefined
): (tableId: string) => boolean {
  return (tableId) => {
    const part = author?.trim() ? partOfNodeId(session, tableId) : null;
    return part !== null && isOwnPendingTableInsertion(part.root, tableId, author!);
  };
}

/** {@link suggestingStructureRefusal} for ops against a session, by the suggesting author. */
export function suggestingRefusalIn(
  session: Pick<TreeDocxSessionView, 'currentPackage' | 'part' | 'storyParts'>,
  author: string | undefined,
  ops: readonly TreeDocOp[]
): string | null {
  return suggestingStructureRefusal(
    ops,
    tableLookupIn(session),
    ownProposedTableIn(session, author)
  );
}

/** Refuse structural writes that cannot create tracked changes. */
export function suggestingStructureRefusal(
  ops: readonly TreeDocOp[],
  isTable: (blockId: string) => boolean,
  /** Merge and split join the author's own proposed table, so they track there. */
  isOwnProposedTable: (tableId: string) => boolean = () => false
): string | null {
  // Outright note removal deletes both its reference and body without a tracked change.
  // Strike the reference instead; accepting that strike removes the body.
  // Note conversion and property edits remain direct because they remove no content.
  if (ops.some((op) => op.op === 'deleteNote')) {
    return 'suggesting cannot delete a note outright; strike its reference to propose the deletion';
  }
  // Removing a control with its content has no tracked form either; refuse it the same way.
  const removesControl = (op: TreeDocOp) =>
    op.op === 'removeContentControl' && op.keepContent === false;
  if (ops.some(removesControl)) {
    return 'suggesting cannot remove a content control outright';
  }
  // Removing a table of contents has no tracked form either.
  if (ops.some((op) => op.op === 'removeToc')) {
    return 'suggesting cannot remove a table of contents outright';
  }
  // Cell merge and split track only inside the author's own proposed table, where the new
  // structure joins that insertion. Anywhere else, applying them would be untracked.
  const restructuresCells = (op: TreeDocOp) =>
    (op.op === 'mergeTableCells' || op.op === 'splitTableCell') && !isOwnProposedTable(op.tableId);
  if (ops.some(restructuresCells)) return SUGGESTING_CELL_STRUCTURE_REFUSAL;
  // A tracked table deletion would mark every row deleted, but the store refuses a tracked
  // deletion of the last live row, so a whole-table deletion has no tracked form.
  if (ops.some((op) => op.op === 'deleteBlock' && isTable(op.blockId))) {
    return SUGGESTING_TABLE_DELETE_REFUSAL;
  }
  if (ops.some((op) => op.op === 'moveTable')) return SUGGESTING_TABLE_MOVE_REFUSAL;
  // A legacy checkbox or dropdown keeps its state in the field's `w:ffData`, which has no
  // tracked form. Refused rather than written untracked.
  if (ops.some((op) => op.op === 'setLegacyCheckbox' || op.op === 'setLegacyDropdown')) {
    return SUGGESTING_FORM_FIELD_VALUE_REFUSAL;
  }
  return null;
}
