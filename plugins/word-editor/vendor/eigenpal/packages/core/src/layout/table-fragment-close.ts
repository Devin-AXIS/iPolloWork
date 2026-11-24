// Closing one page fragment of a table in the body flow: the row that ends it takes its closing
// rule, merged text carried between rows is published, the rows are finalized, and the
// fragment record gets its box, geometry, and budget proof.
//
// Split out of `table-flow-pagination.ts`, which decides where rows go. This module only turns
// the rows of a fragment that has ended into the record that gets painted.

import { finalizeTableRows, type TableFlowDeps } from './semantic-table-layout.ts';
import { fragmentClosingGapPt } from './table-cell-spacing.ts';
import { isSettledPreviousRow } from './table-row-placement-reuse.ts';
import { fragmentCloseDeps, refreshTerminalRow } from './table-flow-row-state.ts';
import { annotateTableFragmentGeometry } from './semantic-table-interaction.ts';
import { shiftTableFragment } from './table-fragment-finalize.ts';
import { budgetsHaveHeadroom, withBudgetProof } from './table-budget-proof.ts';
import { tableFloatOriginY, type TableVerticalAnchorFrames } from './table-float-position.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import type { MergedTextCarry } from './table-vmerge-boundary.ts';
import type { VMergeFragmentCarry } from './table-vmerge-fragment-carry.ts';

export interface TableFragmentClose {
  readonly structure: SemanticTableStructure;
  readonly tableId: string;
  readonly fragmentIndex: number;
  readonly rows: TableRowFragmentRecord[];
  readonly sourceRows: SemanticTableRow[];
  readonly completeSourceRows: ReadonlySet<SemanticTableRow>;
  readonly occurrenceInsets: Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  /** The bottom of the frame this fragment fills: a page break closes its gap no lower. */
  readonly frameBottom: number;
  readonly deps: TableFlowDeps;
  readonly carry: MergedTextCarry;
  readonly fragmentCarry: VMergeFragmentCarry | undefined;
  readonly rowOrdinals: Map<string, number>;
  readonly shiftAnchor: (paragraphId: string, dy: number) => void;
  readonly outOfFlow: boolean;
  /** Present for a positioned table aligned once its height is known. */
  readonly verticalFrames: TableVerticalAnchorFrames | undefined;
  readonly stackTop: number | undefined;
}

/** The finished fragment, and how far the closing row moved the flow cursor. */
export function closeTableFragmentRows(input: TableFragmentClose): {
  readonly fragment: TableFragmentRecord;
  readonly cursorDelta: number;
} {
  const { structure, occurrenceInsets, deps: tableDeps, fragmentCarry } = input;
  let { rows, sourceRows } = input;
  const closeDeps = fragmentCloseDeps(structure, rows, sourceRows, tableDeps);
  const terminalDelta = refreshTerminalRow(
    structure,
    rows,
    sourceRows,
    input.completeSourceRows,
    occurrenceInsets,
    input.left,
    input.bottom,
    closeDeps
  );
  if (fragmentCarry)
    ({ rows, sources: sourceRows } = fragmentCarry.publish(
      rows,
      sourceRows,
      occurrenceInsets,
      input.left
    ));
  ({ rows, sources: sourceRows } = input.carry.publish(rows, sourceRows, occurrenceInsets));
  let finalized = input.carry.finish(
    finalizeTableRows(
      rows,
      structure,
      sourceRows,
      tableDeps.borderOwnershipBudget,
      tableDeps.vMergeResolveBudget,
      undefined,
      input.shiftAnchor,
      closeDeps,
      occurrenceInsets,
      new Set(rows.filter(isSettledPreviousRow))
    )
  );
  if (fragmentCarry) finalized = fragmentCarry.finish(finalized);
  const last = finalized[finalized.length - 1]!;
  const lastBottom = last.box.y + last.box.height;
  // Measured from the finalized last row, at a break and at the table's end alike.
  const closingPt = fragmentClosingGapPt(
    structure.cellSpacingPt,
    sourceRows.at(-1),
    input.frameBottom - lastBottom
  );
  const fragment = annotateTableFragmentGeometry(
    {
      kind: 'table',
      ...(input.outOfFlow ? { outOfFlow: true as const } : {}),
      id: `${input.tableId}#f${input.fragmentIndex}`,
      tableId: input.tableId,
      fragmentIndex: input.fragmentIndex,
      rows: finalized,
      box: {
        x: input.left,
        y: input.top,
        width: structure.columnWidthsPt.reduce((sum, columnWidth) => sum + columnWidth, 0),
        height: lastBottom + closingPt - input.top,
      },
    },
    structure.columnWidthsPt,
    0,
    input.rowOrdinals
  );
  // A positioned table's alignment needs its final height, so it moves once complete.
  const positioned =
    input.outOfFlow && structure.float && input.verticalFrames && input.stackTop === undefined
      ? shiftTableFragment(
          fragment,
          tableFloatOriginY(
            structure.float,
            fragment.box.height,
            input.verticalFrames,
            tableDeps.styleCascade?.doNotBreakWrappedTables
          ) - fragment.box.y,
          input.shiftAnchor
        )
      : fragment;
  return {
    fragment: withBudgetProof(positioned, budgetsHaveHeadroom(tableDeps)),
    cursorDelta: terminalDelta ?? 0,
  };
}
