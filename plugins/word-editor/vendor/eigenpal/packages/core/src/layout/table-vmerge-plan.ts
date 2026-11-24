// The vertical-merge height plan for one table, probed by ordinary row layout.

import { measureRowHeight, type TableFlowDeps } from './semantic-table-layout.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import { planTableVMergeHeights, type VMergeRowHeights } from './table-vmerge-heights.ts';

/**
 * The vMerge plan for one table, probed by row layout. `rows` narrows it to the rows the
 * caller actually places — the paginator plans over the BODY rows, so a merge is never
 * planned against a repeated header copy.
 */
export const vMergePlanFor = (
  structure: SemanticTableStructure,
  left: number | (() => number),
  depth: number,
  deps: TableFlowDeps,
  rows?: readonly SemanticTableRow[],
  isFragmentFirstRow?: (row: SemanticTableRow) => boolean
): VMergeRowHeights | null =>
  deps.measuringOnly === true
    ? null
    : planTableVMergeHeights(
        rows ? { ...structure, rows } : structure,
        left,
        depth,
        deps,
        (row, cols, atLeft, atDepth, rowDeps, spacing, merge, top) =>
          measureRowHeight(
            row,
            cols,
            atLeft,
            atDepth,
            isFragmentFirstRow?.(row) ? firstRowContentDeps(structure, row, rowDeps) : rowDeps,
            spacing,
            merge,
            top
          ),
        isFragmentFirstRow
          ? (row) => (isFragmentFirstRow(row) ? 'outer-top' : 'shared-top')
          : undefined
      );
