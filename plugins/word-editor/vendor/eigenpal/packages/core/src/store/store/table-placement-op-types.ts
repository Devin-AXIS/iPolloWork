// Ops that place a whole table among its story's blocks.

import type { RevisionAttributionInput } from './tree-op-revision-attribution.ts';

export interface InsertTableOp {
  /**
   * Insert a fresh empty table immediately before a block-level paragraph.
   *
   * Before, never after, so the anchor paragraph stays as the block that follows the
   * table: a `w:tbl` is not a valid final child of a story container, and two tables
   * that end up adjacent merge into one when the file is reopened. When the anchor's
   * previous sibling is already a table, a separating empty paragraph is authored with
   * it for the same reason.
   */
  readonly op: 'insertTable';
  readonly beforeParagraphId: string;
  readonly rows: number;
  readonly cols: number;
  /** Width of every grid column, in twips. The caller divides the content width. */
  readonly columnWidthTwips: number;
  /** Propose the complete table through native row and cell insertion revisions. */
  readonly revision?: RevisionAttributionInput;
}

export interface MoveTableOp {
  /**
   * Move a table to just before another block of the same parent, keeping every node id.
   *
   * Ids are kept so a peer's concurrent edit inside the table survives the move; a
   * delete and re-insert would mint a new table and drop it. An empty paragraph is minted
   * on either side that would otherwise touch another table, for the reason in
   * {@link InsertTableOp}. No tracked form exists, so suggesting mode refuses it.
   */
  readonly op: 'moveTable';
  readonly tableId: string;
  readonly beforeBlockId: string;
}

export interface InsertParagraphBesideTableOp {
  /**
   * Insert a paragraph holding `text` just before or just after a block-level table.
   *
   * For a table that opens or closes its story, where no paragraph of the same parent sits
   * on that side to split.
   */
  readonly op: 'insertParagraphBesideTable';
  readonly tableId: string;
  readonly where: 'before' | 'after';
  readonly text: string;
  /** Propose the paragraph and its text as a tracked insertion. */
  readonly revision?: RevisionAttributionInput;
}
