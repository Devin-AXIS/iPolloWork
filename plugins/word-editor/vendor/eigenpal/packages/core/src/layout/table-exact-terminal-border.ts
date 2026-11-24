// Reserve the outer rule of an exact row that closes a page fragment outside its authored
// content box. The table's last row always closes its fragment. Any other exact row closes one
// when the next row does not follow it on the page: it then ends the page with the table's
// bottom rule (not the inside rule), and that rule needs room below the authored height too.
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { canProbeBorderRows } from './table-border-probe.ts';
import { effectiveBorderSide } from './table-border-cascade.ts';
import { cellContentInsets, type CellContentInsets } from './table-cell-geometry.ts';
import type {
  SemanticTableCell,
  SemanticTableRow,
  SemanticTableStructure,
} from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

interface TerminalBorderBudget {
  readonly row: SemanticTableRow;
  readonly widthPt: number;
}

// Resolved structures are immutable. Keep refused shapes cached as well as supported ones.
const budgets = new WeakMap<SemanticTableStructure, TerminalBorderBudget | null>();
const closingBudgets = new WeakMap<SemanticTableRow, TerminalBorderBudget | null>();

// `deps` is the table's resolved flow deps: float-band deps, or the cell deps from the reader.
export function tableTerminalDeps(
  structure: SemanticTableStructure,
  deps: TableFlowDeps
): TableFlowDeps {
  if (deps.tableNestingOffset || deps.textBoxStory) return deps;
  let budget = budgets.get(structure);
  if (budget === undefined) {
    budget = readTerminalBudget(structure);
    budgets.set(structure, budget);
  }
  return budget ? { ...deps, exactTerminalBorder: budget } : deps;
}

/**
 * Deps in which `row`, an exact row other than the table's last, closes its page fragment with
 * the table's bottom rule below its authored height. `deps` itself for any other row or shape.
 * Only the occurrence that ends a fragment takes these deps.
 */
export function closingRowDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  if (deps.tableNestingOffset || deps.textBoxStory || deps.exactTerminalBorder?.row === row)
    return deps;
  let budget = closingBudgets.get(row);
  if (budget === undefined) {
    budget = readClosingBudget(structure, row);
    closingBudgets.set(row, budget);
  }
  return budget ? { ...deps, exactTerminalBorder: budget } : deps;
}

function exactShape(structure: SemanticTableStructure, row: SemanticTableRow): boolean {
  return (
    row.height.rule === 'exact' &&
    Number.isFinite(row.height.valuePt) &&
    row.height.valuePt > 0 &&
    structure.cellSpacingPt === 0 &&
    !structure.float
  );
}

// A merge across the break carries its cell to the next page. That shape keeps its rule inside.
function readClosingBudget(
  structure: SemanticTableStructure,
  row: SemanticTableRow
): TerminalBorderBudget | null {
  const next = structure.rows[structure.rows.indexOf(row) + 1];
  if (
    !next ||
    !exactShape(structure, row) ||
    row.cells.some((cell) => cell.headsVerticalMerge || cell.vMergeContinue) ||
    next.cells.some((cell) => cell.vMergeContinue) ||
    !canProbeBorderRows([row], structure.columnWidthsPt.length)
  )
    return null;
  return closingBudget(structure, row);
}

function readTerminalBudget(structure: SemanticTableStructure): TerminalBorderBudget | null {
  const row = structure.rows.at(-1);
  if (!row || !exactShape(structure, row)) return null;

  // Merge continuations still have bounded content. Only this eligibility view clears them.
  const probeRows = structure.rows.map((source) =>
    source.cells.some((cell) => cell.vMergeContinue)
      ? {
          ...source,
          cells: source.cells.map((cell) =>
            cell.vMergeContinue ? { ...cell, vMergeContinue: false } : cell
          ),
        }
      : source
  );
  if (!canProbeBorderRows(probeRows, structure.columnWidthsPt.length)) return null;
  return closingBudget(structure, row);
}

// The closing rule owns this extent. The table's top rule does not constrain it.
function closingBudget(
  structure: SemanticTableStructure,
  row: SemanticTableRow
): TerminalBorderBudget | null {
  let width: number | undefined;
  for (const cell of row.cells) {
    const edge = effectiveBorderSide(
      cell.borders.bottom,
      (cell.rowTableBorders ?? structure.tableBorders).bottom
    );
    if (
      edge.state !== 'edge' ||
      // Every one-band line style (ECMA-376 §17.18.2) closes an exact row as a single rule
      // does: thick, the dash family, and the patterned and compound bands. Double and triple
      // rules keep their own extent geometry.
      edge.style === 'double' ||
      edge.style === 'triple' ||
      !Number.isFinite(edge.widthPt) ||
      edge.widthPt <= 0 ||
      edge.widthPt > 12
    )
      return null;
    if (width !== undefined && edge.widthPt !== width) return null;
    width = edge.widthPt;
  }
  return width && width > 0 ? { row, widthPt: width } : null;
}

/**
 * Deps in which the exact `row`, opening a continuation fragment, grows by `extensionPt` above
 * its authored box. The fragment's top rule replaces the narrower inside rule the row reserved
 * below the row above it, and only that difference is new. The table's first row already
 * reserves the top rule, so it gains nothing.
 */
export function withExactOpeningExtension(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps,
  extensionPt: number
): TableFlowDeps {
  return extensionPt > 0.001 &&
    row !== structure.rows[0] &&
    exactShape(structure, row) &&
    !deps.tableNestingOffset &&
    !deps.textBoxStory
    ? { ...deps, exactOpeningExtension: { row, pt: extensionPt } }
    : deps;
}

export function exactOpeningExtensionPt(row: SemanticTableRow, deps: TableFlowDeps): number {
  return deps.exactOpeningExtension?.row === row ? deps.exactOpeningExtension.pt : 0;
}

export function exactTerminalBorderPt(row: SemanticTableRow, deps: TableFlowDeps): number {
  return deps.exactTerminalBorder?.row === row ? deps.exactTerminalBorder.widthPt : 0;
}

/** `heightOf` plus the terminal rule, for pricing rows that must also hold the rule. */
export function withRule(
  heightOf: (row: SemanticTableRow) => number,
  tableDeps: TableFlowDeps
): (row: SemanticTableRow) => number {
  return (row) => heightOf(row) + exactTerminalBorderPt(row, tableDeps);
}

// The room the terminal rule needs when deciding whether the row starts here. A row that does
// not fit with its rule moves to the next page. At a page start (or below repeated headers
// only, which mode 15 omits first: `repeatYieldsToTerminalRule`) moving cannot help, so the
// row stays and its rule crosses the bottom margin. Only the table's terminal row can need
// room, so other rows never build their row deps here.
export function ruleRoomPt(
  row: SemanticTableRow,
  tableDeps: TableFlowDeps,
  rowDeps: () => TableFlowDeps
): number {
  if (exactTerminalBorderPt(row, tableDeps) === 0) return 0;
  const deps = rowDeps();
  return deps.rowAtPageStart ? 0 : exactTerminalBorderPt(row, deps);
}

/**
 * Whether a repeated header group yields to the table's terminal exact row on a continuation
 * page: the row, placed at `bodyTop` below the group, would end past `bottom` with its rule.
 * Equality fits. Mode 15 and later omit the repeat, so the row starts the page; earlier modes
 * keep the repeat and the rule crosses the bottom margin (see `ruleRoomPt`). The omission
 * applies even when the rule also crosses the margin without the repeat.
 */
export function repeatYieldsToTerminalRule(
  row: SemanticTableRow,
  bodyTop: number,
  bottom: number,
  deps: TableFlowDeps
): boolean {
  const rule = exactTerminalBorderPt(row, deps);
  return (
    rule > 0 &&
    row.height.rule === 'exact' &&
    hasCompatibilityRule(deps.compatibilityMode, 'repeatedHeaderYieldsToTerminalRule') &&
    bodyTop + row.height.valuePt + rule > bottom + 0.001
  );
}

export function endRowInsets(
  cell: SemanticTableCell,
  deps: TableFlowDeps,
  terminalBorderPt: number,
  rowTop: number,
  maxBottom: number,
  cellSpacingPt: number
): CellContentInsets {
  const insets =
    deps.cellContentInsets?.get(cell.id) ?? cellContentInsets(cell, cellSpacingPt === 0);
  const height = deps.exactTerminalBorder?.row.height;
  // The caller already checks row identity, repetition, continuation, depth, and spacing.
  const applies =
    terminalBorderPt > 0 &&
    height?.rule === 'exact' &&
    rowTop + height.valuePt <= maxBottom + 0.001;
  // The closing stroke sits below the authored box, outside its bottom margin.
  return applies ? { ...insets, bottom: cell.margins.bottom } : insets;
}
