// A width change that grows the LAST row of a page fragment, re-placed without paginating.
//
// The paginator places that row unsplit when its natural height fits the page band, and it
// fits here by construction. The next row was not placed on this page before the change. It
// still starts the next page when it fits a page but not the room below the grown row, its
// own bottom edge cannot fit either, and it cannot split there. That is the row-move rule
// `paginateTableInFlowSteps` applies first, evaluated with the same probes at the new cursor. Every
// other rule there only adds moves. Once the row moves, the next page starts from the same
// state as before, so every later row keeps its page, top and height.
//
// When the fragment closes, the paginator measures the grown row again with its own bottom
// edge and keeps that height when the same lines fit (`prepareTerminalBorderPlan`); this
// module applies the same correction. Every probe uses the paginator's band for the page,
// which a footnote reserve shortens. Anything it cannot prove returns null, and the caller
// runs the full table layout.

import { prepareTerminalBorderPlan, sameTerminalContent } from './table-terminal-border-plan.ts';
import { probeRowFragmentProgress } from './table-row-progress-probe.ts';
import { rowKeepsWithNext } from './table-row-keeps.ts';
import { initialCellCursors, type TableFlowDeps } from './semantic-table-layout.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

type TableFragment = Extract<BlockFragmentRecord, { kind: 'table' }>;

/**
 * The body band of a page whose last table fragment may grow, or null when it is unknown.
 * `band` is the paginator's own bottom for that page, note reserve included: the content
 * box alone does not carry the reserve, and a section's pages do not carry note areas.
 */
export function growthBandOf(
  page: PageRecord,
  fragment: TableFragment,
  next: TableFragment | undefined,
  band: number
): number | null {
  if (!Number.isFinite(band) || band <= 0) return null;
  // Endnote areas and note-only sheets are not body flow; column regions have their own band.
  if (page.endnotes || page.noteStream || page.columnSeparators || page.parityBlank) return null;
  if (page.fragments[page.fragments.length - 1] !== fragment) return null;
  // The table continues on the next page, so nothing follows the fragment on this one.
  if (!next || next.fragmentIndex !== fragment.fragmentIndex + 1) return null;
  return band;
}

/** The first body row the next fragment places, when that fragment opens with it whole. */
export function nextFragmentOpening(next: TableFragment): TableRowFragmentRecord | null {
  const first = next.rows.find((row) => !row.isHeaderRepeat);
  return first && !first.isContinuation ? first : null;
}

/** Whether `row` and the row before it keep no group the grown height would reprice. */
export function rowGrowthKeepsNothing(
  row: SemanticTableRow,
  previous: SemanticTableRow,
  deps: TableFlowDeps
): boolean {
  return (
    !rowKeepsWithNext(row, deps.styleCascade) && !rowKeepsWithNext(previous, deps.styleCascade)
  );
}

/**
 * Whether the paginator moves `next` to the next page when it reaches `top`: the row fits a
 * page but not the room below `top`, its own bottom edge does not fit there, and it is kept
 * whole or cannot start every cell. `measure` is the paginator's natural row height.
 */
export function nextRowMovesAt(
  structure: SemanticTableStructure,
  next: SemanticTableRow,
  left: number,
  top: number,
  bottom: number,
  deps: TableFlowDeps,
  measure: (row: SemanticTableRow, top: number, deps: TableFlowDeps) => number
): boolean {
  if (!(top > 0)) return false;
  // Probes report no cell break keys: the full pass records only committed placements.
  const rowDeps: TableFlowDeps = { ...deps, onCellBreakKey: undefined, rowAtPageStart: false };
  const natural = measure(next, top, rowDeps);
  if (natural > bottom + 0.001 || top + natural <= bottom + 0.001) return false;
  if (prepareTerminalBorderPlan(structure, next, left, top, bottom, rowDeps)) return false;
  if (next.cantSplit || next.height.rule === 'exact') return true;
  return !probeRowFragmentProgress(
    next,
    structure.columnWidthsPt,
    left,
    top,
    bottom,
    false,
    0,
    rowDeps,
    initialCellCursors(next),
    structure.cellSpacingPt,
    { requireEveryCell: true }
  );
}

/**
 * The grown row as the paginator closes its fragment: measured again with its own bottom
 * edge, and given that height when the same lines fit (`closeTableFragment`).
 */
export function closeGrownRow(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  record: TableRowFragmentRecord,
  insets: ReadonlyMap<string, CellContentInsets> | undefined,
  left: number,
  bottom: number,
  deps: TableFlowDeps
): { record: TableRowFragmentRecord; insets: ReadonlyMap<string, CellContentInsets> | undefined } {
  const terminal = prepareTerminalBorderPlan(structure, row, left, record.box.y, bottom, {
    ...deps,
    onCellBreakKey: undefined,
    cellContentInsets: insets ?? deps.cellContentInsets,
  });
  if (!terminal || !sameTerminalContent(record, terminal.probe)) return { record, insets };
  return {
    record: {
      ...record,
      box: { ...record.box, height: terminal.height },
      cells: record.cells.map((cell) => ({
        ...cell,
        box: { ...cell.box, height: terminal.height - (cell.box.y - record.box.y) },
      })),
    },
    insets: terminal.deps.cellContentInsets,
  };
}

/** Same row, cells and paragraphs at the same top; only line content and height may differ. */
export function sameRowMembership(a: TableRowFragmentRecord, b: TableRowFragmentRecord): boolean {
  if (
    a.id !== b.id ||
    a.rowIndex !== b.rowIndex ||
    a.isHeaderRow !== b.isHeaderRow ||
    a.isHeaderRepeat !== b.isHeaderRepeat ||
    !!a.isContinuation !== !!b.isContinuation ||
    !!a.hasContinuation !== !!b.hasContinuation ||
    a.box.y !== b.box.y ||
    a.cells.length !== b.cells.length
  )
    return false;
  return a.cells.every((cell, index) => {
    const other = b.cells[index]!;
    return (
      cell.id === other.id &&
      cell.rowSpan === other.rowSpan &&
      cell.vMergeContinue === other.vMergeContinue &&
      !!cell.paintInert === !!other.paintInert &&
      cell.box.y === other.box.y &&
      cell.blocks.length === other.blocks.length &&
      cell.blocks.every((block, at) => {
        const next = other.blocks[at]!;
        return (
          block.kind === 'paragraph' &&
          next.kind === 'paragraph' &&
          block.paragraphId === next.paragraphId &&
          block.fragmentIndex === next.fragmentIndex &&
          block.lines.every((line) => !line.drawings?.length) &&
          next.lines.every((line) => !line.drawings?.length)
        );
      })
    );
  });
}

/** Body lines a row places, as the flow line counter counts them. */
export function rowLineCount(row: TableRowFragmentRecord): number {
  let count = 0;
  for (const cell of row.cells)
    for (const block of cell.blocks) if (block.kind === 'paragraph') count += block.lines.length;
  return count;
}
