import { numericWidthProofOf } from './numeric-width-proof-cache.ts';
import {
  createTableWidthFitEnvelope,
  tableWidthEnvelopeHolds,
  type TableWidthFitEnvelope,
} from './table-width-fit-envelope.ts';
import { placeCellFromWidthRecipe, type CellWidthPlacement } from './table-cell-width-placement.ts';
import { sumCols } from './table-cell-spacing.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import type { TableRowFragmentRecord } from './semantic-records.ts';

export interface BodyWidthRow {
  readonly source: SemanticTableRow;
  readonly baseline: TableRowFragmentRecord;
  readonly cells: readonly CellWidthPlacement[];
}

export interface BodyWidthGroup {
  /** Caller-owned scalar key covering every non-width break and projection dependency. */
  readonly dependencyKey: string;
  readonly rows: readonly BodyWidthRow[];
  readonly fit: TableWidthFitEnvelope;
}

/** Capture complete ordinary body rows; headers and partial rows stay on the full path. */
export function createBodyWidthGroup(
  rows: readonly BodyWidthRow[],
  columnCount: number,
  dependencyKey: string
): BodyWidthGroup | null {
  if (rows.length === 0 || rows.length > 256) return null;
  const builder = createTableWidthFitEnvelope(columnCount);
  const captured: BodyWidthRow[] = [];
  for (const row of rows) {
    const { source, baseline, cells } = row;
    if (
      source.isHeader ||
      baseline.isHeaderRow ||
      baseline.isHeaderRepeat ||
      baseline.isContinuation ||
      baseline.hasContinuation ||
      source.id !== baseline.id ||
      cells.length !== source.cells.length ||
      cells.length !== baseline.cells.length
    )
      return null;
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index]!;
      if (
        cell.baseline !== baseline.cells[index] ||
        cell.baseline.id !== source.cells[index]!.id ||
        cell.constraint.gridColumn !== cell.baseline.gridColumn ||
        cell.constraint.gridSpan !== cell.baseline.gridSpan ||
        cell.constraint.gridColumn !== source.cells[index]!.gridColumn ||
        cell.constraint.gridSpan !== source.cells[index]!.gridSpan ||
        !(cell.numericLines
          ? builder.addNumeric(numericWidthProofOf(cell.numericLines)!, cell.constraint)
          : builder.add(cell.pending, cell.constraint))
      )
        return null;
    }
    // Placed span coordinates are rebuilt from pending spans. Retaining them here would
    // keep a second complete painted table alive for the lifetime of the group.
    // Finalization derives borders from authored cells, so old border geometry is discarded.
    const recipes = cells.map((cell) => {
      const block = cell.baseline.blocks[0]!;
      if (block.kind !== 'paragraph') return cell;
      return {
        ...cell,
        baseline: {
          ...cell.baseline,
          borders: undefined,
          blocks: [{ ...block, lines: block.lines.map((line) => ({ ...line, spans: [] })) }],
        },
      };
    });
    captured.push({ source, baseline: { ...baseline, cells: [] }, cells: recipes });
  }
  const fit = builder.finish();
  return fit ? { dependencyKey, rows: captured, fit } : null;
}

/** Source/dependency validation and grouped width fit, without creating placed geometry. */
export function bodyWidthGroupHolds(
  group: BodyWidthGroup,
  sources: readonly SemanticTableRow[],
  columns: readonly number[],
  left: number,
  dependencyKey: string
): boolean {
  return (
    dependencyKey === group.dependencyKey &&
    sources.length === group.rows.length &&
    sources.every((source, index) => source === group.rows[index]!.source) &&
    tableWidthEnvelopeHolds(group.fit, columns, left)
  );
}

/**
 * Build from the original recipes every time; never chain previous transformed views.
 * The caller must finalize borders with the surrounding rows and annotate fragment geometry.
 */
export function materializeBodyWidthGroup(
  group: BodyWidthGroup,
  sources: readonly SemanticTableRow[],
  columns: readonly number[],
  left: number,
  dependencyKey: string
): TableRowFragmentRecord[] | null {
  if (!bodyWidthGroupHolds(group, sources, columns, left, dependencyKey)) return null;
  const width = sumCols(columns, 0, columns.length);
  const rows: TableRowFragmentRecord[] = [];
  for (const row of group.rows) {
    const cells = [];
    for (const recipe of row.cells) {
      const cell = placeCellFromWidthRecipe(recipe, columns, left);
      if (!cell) return null;
      cells.push(cell);
    }
    rows.push({ ...row.baseline, cells, box: { ...row.baseline.box, x: left, width } });
  }
  return rows;
}
