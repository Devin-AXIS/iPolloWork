// Table-level edges participate in measurement even when tcBorders omits them.
// Keep authored borders separate: conflict resolution still needs their provenance.
import {
  resolveTableCellBorderGrid,
  type CellBorderBox,
  type TableBorderBox,
  type TableBorderSide,
  type ResolvedTableBorderEdge,
  type ResolvedCellBorders,
} from './table-borders.ts';
import { borderContentInset, ownTopBandWidthPt, simpleBandWidthPt } from './table-cell-geometry.ts';
import type { SemanticTableRow, SemanticTableCell } from './semantic-table.ts';
import { buildColumnOwnershipIndexes, ownerAt } from './table-border-ownership.ts';
import { resolveVMergeSpans } from './table-vmerge.ts';

/** Resolve physical coordinates without reversing the stored cell traversal order. */
export function physicalTableRows(
  rows: readonly SemanticTableRow[],
  columns: number,
  bidiVisual: boolean
): readonly SemanticTableRow[] {
  return bidiVisual
    ? rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          margins: { ...cell.margins, left: cell.margins.right, right: cell.margins.left },
          borders: { ...cell.borders, left: cell.borders.right, right: cell.borders.left },
          ...(cell.rowTableBorders
            ? {
                rowTableBorders: {
                  ...cell.rowTableBorders,
                  left: cell.rowTableBorders.right,
                  right: cell.rowTableBorders.left,
                },
              }
            : {}),
          logicalGridColumn: cell.gridColumn,
          gridColumn: Math.max(0, columns - cell.gridColumn - cell.gridSpan),
        })),
      }))
    : rows;
}

/**
 * Clearance each authored ROW reserves above its content, per cell, in points.
 *
 * A collapsed horizontal band is charged entirely to the row BELOW it, at the full width of
 * the widest rule painted across the boundary, and the row above is charged nothing. Every
 * column's stroke then starts at the shared boundary and runs DOWNWARD by its own width, so
 * a wider rule in one column reaches further into the row below without moving the boundary.
 *
 * Resolved per authored ROW, including rows made of `w:vMerge` continuation cells, which own
 * no content and therefore appear nowhere in the span-scoped content border grid.
 */
function resolveRowTopBands(
  rows: readonly SemanticTableRow[],
  table: TableBorderBox,
  resolved: readonly (readonly ResolvedCellBorders[])[],
  merged: ReadonlyMap<string, number>,
  columns: number
): readonly { readonly band: number; readonly ownsTop: boolean }[] {
  // Painted band width feeding each row, per grid column: the rule published by whichever
  // cell's span ENDS on the boundary above. A suppressed vMerge seam leaves it at zero.
  const bandPt = rows.map(() => new Float64Array(columns));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (let cellIndex = 0; cellIndex < rows[rowIndex]!.cells.length; cellIndex += 1) {
      const cell = rows[rowIndex]!.cells[cellIndex]!;
      if (cell.vMergeContinue) continue;
      const below = rowIndex + (merged.get(cell.id) ?? 1);
      const target = bandPt[below];
      if (!target) continue;
      for (const segment of resolved[rowIndex]![cellIndex]!.edgeSegments ?? []) {
        if (segment.side !== 'bottom') continue;
        const width = simpleBandWidthPt(segment.edge);
        const end = Math.min(segment.gridEnd, columns);
        for (let column = Math.max(0, segment.gridStart); column < end; column += 1)
          target[column] = Math.max(target[column]!, width);
      }
    }
  }
  // One boundary carries one content band, so the row's widest reserve sets it for every
  // cell: the captured mixed-width control charges `m3` and `m6` by their single 4pt column.
  return rows.map((row, rowIndex) => {
    let widest = 0;
    let ownsTop = rowIndex === 0;
    const tableSide = rowIndex === 0 ? table.top : table.insideH;
    for (const cell of row.cells) {
      const own = ownTopBandWidthPt(cell.borders.top, tableSide);
      if (own > 0) ownsTop = true;
      widest = Math.max(widest, own);
      const last = Math.min(cell.gridColumn + cell.gridSpan, columns);
      for (let column = cell.gridColumn; column < last; column += 1)
        widest = Math.max(widest, bandPt[rowIndex]?.[column] ?? 0);
    }
    return { band: widest, ownsTop };
  });
}

/** Resolve the same winners as paint before their clearance affects wrapping and row height. */
export function withTableContentBorders(
  rows: readonly SemanticTableRow[],
  table: TableBorderBox,
  columns: number,
  collapsed = true
): readonly SemanticTableRow[] {
  if (!collapsed) return separatedContentBorders(rows, table);
  const merged = resolveVMergeSpans(rows);
  const grid = rows.map((row) =>
    row.cells.map((cell) => ({
      ...cell,
      mergeRowSpan: merged.get(cell.id) ?? 1,
    }))
  );
  const ownership = buildColumnOwnershipIndexes(grid, columns);
  const resolved = resolveTableCellBorderGrid(grid, table, columns);
  // Continuation cells have no content of their own. A shared edge beside one must
  // clear the merged head's content box, even when it occurs below the head row.
  const headById = new Map<string, SemanticTableCell>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (const cell of rows[rowIndex]!.cells) {
      if (cell.vMergeContinue) continue;
      headById.set(cell.id, cell);
      const end = rowIndex + (merged.get(cell.id) ?? 1);
      for (let r = rowIndex + 1; r < end; r++) {
        const owner = ownerAt(ownership, r, cell.gridColumn);
        const continuation = owner && rows[r]?.cells[owner.cellIndex];
        if (continuation?.vMergeContinue) headById.set(continuation.id, cell);
      }
    }
  }
  const boxes = new Map<string, CellBorderBox>();
  for (const row of rows)
    for (const cell of row.cells) {
      const empty = (edge: TableBorderSide): TableBorderSide =>
        edge.state === 'none' ? edge : { state: 'omitted' };
      boxes.set(cell.id, {
        top: empty(cell.borders.top),
        bottom: empty(cell.borders.bottom),
        left: empty(cell.borders.left),
        right: empty(cell.borders.right),
      });
    }
  const include = (
    cell: SemanticTableCell,
    side: 'top' | 'left' | 'bottom' | 'right',
    edge: ResolvedTableBorderEdge
  ) => {
    const head = headById.get(cell.id) ?? cell;
    const box = boxes.get(head.id)!;
    const candidate: TableBorderSide = { state: 'edge', ...edge };
    const shared = side === 'top' || side === 'bottom';
    // One content rectangle must clear every incident interval, not just the interval
    // whose border has the largest conflict weight (compound rules can extend farther).
    if (
      box[side].state !== 'edge' ||
      borderContentInset(head.margins[side], candidate, shared, !shared, side === 'top') >
        borderContentInset(head.margins[side], box[side], shared, !shared, side === 'top')
    ) {
      boxes.set(head.id, { ...box, [side]: candidate });
    }
  };
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r]!.cells.length; c++) {
      const cell = rows[r]!.cells[c]!;
      for (const segment of resolved[r]![c]!.edgeSegments ?? []) {
        include(cell, segment.side, segment.edge);
        if (segment.side === 'right') {
          const column = cell.gridColumn + cell.gridSpan;
          for (let neighborRow = segment.gridStart; neighborRow < segment.gridEnd; neighborRow++) {
            const owner = ownerAt(ownership, neighborRow, column);
            const neighbor = owner && rows[neighborRow]?.cells[owner.cellIndex];
            if (neighbor) include(neighbor, 'left', segment.edge);
          }
        } else if (segment.side === 'bottom') {
          const neighborRow = r + (merged.get(cell.id) ?? 1);
          for (let column = segment.gridStart; column < segment.gridEnd; column++) {
            const owner = ownerAt(ownership, neighborRow, column);
            const neighbor = owner && rows[neighborRow]?.cells[owner.cellIndex];
            if (neighbor) include(neighbor, 'top', segment.edge);
          }
        }
      }
    }
  }
  const topBands = resolveRowTopBands(rows, table, resolved, merged, columns);
  // Content borders answer for the merged head's whole SPAN; band clearance answers for the
  // authored ROW, so a continuation cell carries one and not the other.
  return rows.map((row, index) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const { band, ownsTop } = topBands[index]!;
      // A row that states no top rule of its own, directly or through `w:insideH`, lets the
      // band of the row above share its top margin: its content starts at the wider of the
      // two rather than below both. Reference renders of `w:tcBorders` (ECMA-376 §17.4.66)
      // and `w:tcMar` (§17.4.43) show it in every compatibility mode, nested or not.
      const topBandClearancePt = ownsTop ? band : Math.max(0, band - cell.margins.top);
      return cell.vMergeContinue
        ? { ...cell, topBandClearancePt }
        : {
            ...cell,
            topBandClearancePt,
            contentBorders: boxes.get(cell.id)!,
            contentBottomIsOuter: index + (merged.get(cell.id) ?? 1) === rows.length,
          };
    }),
  }));
}

function separatedContentBorders(
  rows: readonly SemanticTableRow[],
  tableBox: TableBorderBox
): readonly SemanticTableRow[] {
  const side = (own: TableBorderSide, inherited: TableBorderSide) =>
    own.state === 'omitted' && inherited.state === 'edge' ? inherited : own;
  // A spaced table's outer borders draw its frame (`table-spacing-frame.ts`): every cell,
  // at the table's edge or not, takes the inside borders on all four sides.
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      // A row's `w:tblPrEx` borders replace the table's own for its cells.
      const table = cell.rowTableBorders ?? tableBox;
      return {
        ...cell,
        contentBorders: {
          top: side(cell.borders.top, table.insideH),
          bottom: side(cell.borders.bottom, table.insideH),
          left: side(cell.borders.left, table.insideV),
          right: side(cell.borders.right, table.insideV),
        },
      };
    }),
  }));
}
