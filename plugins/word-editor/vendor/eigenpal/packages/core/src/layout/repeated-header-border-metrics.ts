import { firstRowContentDeps, repeatBoundaryBandPt } from './table-fragment-content-insets.ts';
// A repeated header and its first complete body row share one measured boundary.
// These insets belong to one page occurrence. The authored borders never change.

import { resolveTableCellBorderGrid, type ResolvedTableBorderEdge } from './table-borders.ts';
import {
  borderContentInset,
  cellContentInsets,
  simpleBandWidthPt,
  type CellContentInsets,
} from './table-cell-geometry.ts';
import { canProbeBorderRows, hasTableMerge, physicalCells } from './table-border-probe.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import { repeatYieldsToClosingRule } from './table-terminal-border-plan.ts';
import { readOnlyBreakCache } from './paragraph-cache-peek.ts';
import { layoutRowFragment, type TableFlowDeps } from './semantic-table-layout.ts';
import {
  MAX_TABLE_COLUMNS,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';

const MAX_HEADER_ROWS = 64;

export interface RepeatedHeaderBorderPlan {
  readonly bodyRowId: string;
  readonly headerHeight: number;
  readonly bodyHeight: number;
  readonly deps: TableFlowDeps;
}

/**
 * Undefined retains the existing complex-row path. Null omits this repeat, also when the
 * exact row that would end the page below it fits there only without its bottom rule.
 * A plan guarantees that the complete candidate fits before any live placement.
 */
export function prepareRepeatedHeaderBorderPlan(
  structure: SemanticTableStructure,
  headers: readonly SemanticTableRow[],
  body: SemanticTableRow,
  left: number,
  top: number,
  bottom: number,
  baselineHeaderHeight: number,
  baselineBodyHeight: number,
  deps: TableFlowDeps
): RepeatedHeaderBorderPlan | null | undefined {
  if (repeatYieldsToClosingRule(structure, body, left, top + baselineHeaderHeight, bottom, deps))
    return null;
  if (
    structure.cellSpacingPt > 0 ||
    structure.float ||
    headers.length === 0 ||
    headers.length > MAX_HEADER_ROWS ||
    structure.columnWidthsPt.length > MAX_TABLE_COLUMNS ||
    ![left, top, bottom, baselineHeaderHeight, baselineBodyHeight].every(Number.isFinite) ||
    hasTableMerge(structure) ||
    (deps.pageExclusionZones?.().length ?? 0) > 0 ||
    !canProbeBorderRows([...headers, body], structure.columnWidthsPt.length)
  )
    return undefined;
  const boundaryCells = headers.reduce((sum, row) => sum + row.cells.length, body.cells.length);
  if (deps.borderOwnershipBudget && deps.borderOwnershipBudget.intervalsRemaining < boundaryCells)
    return undefined;
  // This lane does not change existing split-row pagination. Only an atomic row, or
  // a row that previously fit complete, takes the shared-boundary transaction. A
  // `w:cantSplit` row taller than the page splits, so it is not atomic here.
  const atomic =
    body.height.rule === 'exact' || (body.cantSplit && baselineBodyHeight <= bottom + 0.001);
  if (!atomic && baselineBodyHeight > bottom - top - baselineHeaderHeight + 0.001) return undefined;

  const lastHeader = headers[headers.length - 1]!;
  const headerCells = physicalCells(lastHeader);
  const bodyCells = physicalCells(body);
  // The existing resolver owns fallback, explicit nil and style/color tie rules.
  // This two-row view is safe only because merges and sparse ownership were excluded.
  const resolved = resolveTableCellBorderGrid(
    [headerCells, bodyCells],
    structure.tableBorders,
    structure.columnWidthsPt.length
  )[0]!;
  const insets = new Map<string, CellContentInsets>();
  const intervals: { start: number; end: number; edge: ResolvedTableBorderEdge }[] = [];
  // One shared boundary, charged entirely to the body row: the header reserves nothing.
  // Compound strokes keep their own extent geometry on both sides.
  for (let index = 0; index < headerCells.length; index += 1) {
    for (const segment of resolved[index]!.edgeSegments ?? []) {
      if (segment.side !== 'bottom') continue;
      intervals.push({ start: segment.gridStart, end: segment.gridEnd, edge: segment.edge });
    }
  }
  for (const [index, cell] of headerCells.entries()) {
    let inset = cell.margins.bottom;
    for (const segment of resolved[index]!.edgeSegments ?? []) {
      if (segment.side !== 'bottom' || simpleBandWidthPt(segment.edge) > 0) continue;
      inset = Math.max(
        inset,
        borderContentInset(cell.margins.bottom, { state: 'edge', ...segment.edge }, true)
      );
    }
    insets.set(cell.id, { ...cellContentInsets(cell, true), bottom: inset });
  }
  // `canProbeBorderRows` already refused sparse ownership, so one header cell covers each
  // body column.
  let intervalIndex = 0;
  // One boundary carries one content band: the widest reserve in the body row sets it. Before
  // mode 15 the row meets the repeated header's bottom rule; from mode 15 it keeps the band
  // of the row it was authored under. The ordinary repeat path applies the same rule.
  const headerBand = repeatBoundaryBandPt(structure, body, deps);
  let widestPt = headerBand ?? 0;
  if (headerBand === undefined)
    for (const cell of bodyCells)
      widestPt = Math.max(widestPt, cellContentInsets(cell, true).top - cell.margins.top);
  for (const cell of bodyCells) {
    let inset = cell.margins.top + widestPt;
    const end = cell.gridColumn + cell.gridSpan;
    while (intervalIndex < intervals.length && intervals[intervalIndex]!.end <= cell.gridColumn)
      intervalIndex++;
    for (
      let index = intervalIndex;
      index < intervals.length && intervals[index]!.start < end;
      index++
    ) {
      if (simpleBandWidthPt(intervals[index]!.edge) > 0) continue;
      inset = Math.max(
        inset,
        borderContentInset(
          cell.margins.top,
          { state: 'edge', ...intervals[index]!.edge },
          true,
          false,
          true
        )
      );
    }
    insets.set(cell.id, { ...cellContentInsets(cell, true), top: inset });
  }
  if (
    [lastHeader, body].every((row) =>
      row.cells.every((cell) => {
        const before = cellContentInsets(cell, true);
        const after = insets.get(cell.id)!;
        return before.top === after.top && before.bottom === after.bottom;
      })
    )
  )
    return undefined;
  const occurrenceDeps = firstRowContentDeps(structure, headers[0]!, {
    ...deps,
    cellContentInsets: insets,
  });
  let line = 0;
  const probeDeps: TableFlowDeps = {
    ...stripAnchorSinksForProbe(deps),
    // Reads only: a probe never retains a break, but it may reuse one placement measured.
    cache: readOnlyBreakCache(deps.cache),
    borderOwnershipBudget: undefined,
    vMergeResolveBudget: undefined,
    onCellBreakKey: undefined,
    cellContentInsets: occurrenceDeps.cellContentInsets,
    nextLineId: () => `probe-header-border-${line++}`,
  };
  let cursor = top;
  for (const row of headers) {
    const placed = layoutRowFragment(
      row,
      structure.columnWidthsPt,
      left,
      cursor,
      true,
      0,
      probeDeps
    );
    cursor = placed.bottom;
    if (placed.remainder !== null || cursor > bottom + 0.001) return null;
  }
  const headerHeight = cursor - top;
  const placed = layoutRowFragment(
    body,
    structure.columnWidthsPt,
    left,
    cursor,
    false,
    0,
    probeDeps
  );
  if (placed.remainder !== null || placed.bottom > bottom + 0.001) return null;
  return {
    bodyRowId: body.id,
    headerHeight,
    bodyHeight: placed.bottom - cursor,
    deps: occurrenceDeps,
  };
}
