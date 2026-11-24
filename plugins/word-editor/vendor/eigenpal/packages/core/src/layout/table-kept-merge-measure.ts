// Measure closed vertical merges as one kept row group, without publishing layout effects.
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from './semantic-table-layout.ts';
import { vMergePlanFor } from './table-vmerge-plan.ts';
import { measuringFlowDeps } from './table-probe-deps.ts';
import { firstRowContentDeps } from './table-fragment-content-insets.ts';

/**
 * Heights of a closed group, with merged heads removed from their individual row heights.
 * A merge entering or leaving the group has no complete measurement here and is declined.
 */
export function measureKeptMergeRows(
  structure: SemanticTableStructure,
  rows: readonly SemanticTableRow[],
  start: number,
  end: number,
  left: number,
  deps: TableFlowDeps,
  heightOf: (index: number) => number
): readonly number[] | null {
  if (deps.pageExclusionZones?.().length) return null;
  if (rows[start]!.cells.some((cell) => cell.vMergeContinue)) return null;
  if (rows[end + 1]?.cells.some((cell) => cell.vMergeContinue)) return null;
  const group = rows.slice(start, end + 1);
  const first = group[0]!;
  const atTableStart = first === structure.rows[0];
  const firstRow = (row: SemanticTableRow) => atTableStart && row === first;
  const probeDeps = { ...deps, pageExclusionZones: undefined };
  const plan = vMergePlanFor(structure, left, 0, probeDeps, group, firstRow);
  if (!plan) return null;
  const heights: number[] = [];
  let top = 0;
  for (let index = 0; index < group.length; index += 1) {
    for (const span of plan.spansAt(index)) plan.accept(span, top);
    const row = group[index]!;
    const rowDeps = firstRow(row) ? firstRowContentDeps(structure, row, probeDeps) : probeDeps;
    let options = plan.rowOptions(index);
    let height: number;
    if (options) {
      const place = () =>
        layoutRowFragment(
          row,
          structure.columnWidthsPt,
          left,
          top,
          false,
          0,
          measuringFlowDeps(rowDeps, true),
          structure.cellSpacingPt,
          options
        );
      let placed = place();
      if (placed.remainder !== null) {
        plan.withdrawAt(index);
        options = plan.rowOptions(index);
        placed = place();
      }
      height = placed.record.box.height;
    } else {
      height = heightOf(start + index);
    }
    heights.push(height);
    top += height;
  }
  return heights;
}
